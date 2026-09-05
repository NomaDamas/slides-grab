import assert from 'node:assert/strict';
import test from 'node:test';
import { spawn } from 'node:child_process';
import { cp, mkdtemp, readFile, rm } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import os from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';
import { getAvailablePort } from './test-server-helpers.js';

const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const SOURCE_DECK = join(REPO_ROOT, 'decks', 'dejavu-ditto-90s');
const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';

async function startEditor(slidesDir) {
  const port = await getAvailablePort();
  const output = { value: '' };
  const child = spawn(process.execPath, [
    join(REPO_ROOT, 'scripts', 'editor-server.js'),
    '--port',
    String(port),
    '--slides-dir',
    slidesDir,
    '--editor',
    'html',
  ], {
    cwd: REPO_ROOT,
    env: { ...process.env, PPT_AGENT_PACKAGE_ROOT: REPO_ROOT },
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  await new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error(`editor startup timeout\n${output.value}`)), 15_000);
    const onData = (chunk) => {
      output.value += chunk.toString();
      if (!output.value.includes(`Local:       http://localhost:${port}`)) return;
      clearTimeout(timeout);
      resolve();
    };
    child.stdout.on('data', onData);
    child.stderr.on('data', onData);
    child.once('exit', (code) => {
      clearTimeout(timeout);
      reject(new Error(`editor exited with ${code}\n${output.value}`));
    });
  });
  return { child, port };
}

async function clickFrameElement(page, selector, clickCount = 1, offset = null, modifiers = []) {
  const rect = await page.evaluate((targetSelector) => {
    const frame = document.querySelector('#slide-iframe');
    const target = frame.contentDocument.querySelector(targetSelector);
    if (!target) throw new Error(`frame element not found: ${targetSelector}`);
    const frameRect = frame.getBoundingClientRect();
    const targetRect = target.getBoundingClientRect();
    const scaleX = frameRect.width / frame.contentDocument.body.getBoundingClientRect().width;
    const scaleY = frameRect.height / frame.contentDocument.body.getBoundingClientRect().height;
    return {
      x: frameRect.x + targetRect.x * scaleX,
      y: frameRect.y + targetRect.y * scaleY,
      width: targetRect.width * scaleX,
      height: targetRect.height * scaleY,
    };
  }, selector);
  await page.mouse.click(
    rect.x + (offset?.x ?? rect.width / 2),
    rect.y + (offset?.y ?? rect.height / 2),
    { clickCount, modifiers },
  );
}

test('turns the recent deck into movable, resizable, editable HTML objects', async () => {
  const workspace = await mkdtemp(join(os.tmpdir(), 'html-canvas-deck-'));
  const slidesDir = join(workspace, 'deck');
  await cp(SOURCE_DECK, slidesDir, { recursive: true });
  const { child, port } = await startEditor(slidesDir);
  let browser;
  try {
    browser = await chromium.launch({ headless: true });
    const page = await browser.newPage({ viewport: { width: 1600, height: 1000 } });
    await page.goto(`http://localhost:${port}`, { waitUntil: 'domcontentloaded' });
    await page.click('#tool-mode-select');
    await page.waitForFunction(() => document.querySelector('#slide-iframe')?.contentDocument?.querySelector('.rule'));
    await page.waitForFunction(() => /editable objects/.test(document.querySelector('#object-renderer-status')?.textContent || ''));

    const objectCount = await page.$eval('#object-renderer-status', (node) => Number(node.textContent.match(/(\d+) editable/)?.[1]));
    assert.ok(objectCount >= 20, `expected a fully indexed slide, got ${objectCount}`);

    const initialCaptionY = await page.evaluate(() => {
      const caption = document.querySelector('#slide-iframe').contentDocument.querySelector('.cap');
      return Math.round(caption.getBoundingClientRect().y);
    });
    const initialFrame = await page.evaluate(() => {
      const frame = document.querySelector('#slide-iframe').contentDocument.querySelector('.ph');
      const rect = frame.getBoundingClientRect();
      return { x: Math.round(rect.x), y: Math.round(rect.y) };
    });
    await clickFrameElement(page, '.ph', 1, { x: 2, y: 2 });
    await page.waitForFunction(() => document.querySelector('#mini-tag')?.textContent === '<div>');
    const selected = await page.locator('#object-selected-box').boundingBox();
    assert.ok(selected);
    await page.mouse.move(selected.x + selected.width / 2, selected.y + selected.height / 2);
    await page.mouse.down();
    await page.mouse.move(selected.x + selected.width / 2 + 24, selected.y + selected.height / 2 + 12, { steps: 4 });
    await page.mouse.up();
    const movedFrame = await page.evaluate(() => {
      const frame = document.querySelector('#slide-iframe').contentDocument.querySelector('.ph');
      const rect = frame.getBoundingClientRect();
      return { x: Math.round(rect.x), y: Math.round(rect.y) };
    });
    assert.ok(movedFrame.x > initialFrame.x);
    assert.ok(movedFrame.y > initialFrame.y);
    const captionYAfterFrameMove = await page.evaluate(() => {
      const caption = document.querySelector('#slide-iframe').contentDocument.querySelector('.cap');
      return Math.round(caption.getBoundingClientRect().y);
    });
    assert.ok(Math.abs(captionYAfterFrameMove - initialCaptionY) <= 1, 'moving a flow child must not reflow its siblings');

    await clickFrameElement(page, '.ph img');
    const imageSelection = await page.locator('#object-selected-box').boundingBox();
    assert.ok(imageSelection);
    await page.keyboard.down('Alt');
    await clickFrameElement(page, '.ph img');
    await page.keyboard.up('Alt');
    const parentSelection = await page.locator('#object-selected-box').boundingBox();
    const selectedTagAfterAlt = await page.$eval('#mini-tag', (node) => node.textContent);
    assert.ok(parentSelection.height > imageSelection.height, `Alt-click should cycle from child image to parent frame; selected=${selectedTagAfterAlt}`);

    await clickFrameElement(page, '.ph img');
    const imageHandle = await page.locator('#object-selected-box [data-object-handle="se"]').boundingBox();
    assert.ok(imageHandle);
    await page.mouse.move(imageHandle.x + 4, imageHandle.y + 4);
    await page.mouse.down();
    await page.mouse.move(imageHandle.x + 34, imageHandle.y + 24, { steps: 4 });
    await page.mouse.up();
    const resizedImage = await page.evaluate(() => {
      const image = document.querySelector('#slide-iframe').contentDocument.querySelector('.ph img');
      const rect = image.getBoundingClientRect();
      return { width: Math.round(rect.width), height: Math.round(rect.height) };
    });
    assert.ok(resizedImage.width > 400);
    assert.ok(resizedImage.height > 152);

    await clickFrameElement(page, '.rule.thin');
    await page.waitForFunction(() => document.querySelector('#mini-tag')?.textContent === '<div>');
    const thinRuleBox = await page.locator('#object-selected-box').boundingBox();
    const thinRuleRect = await page.evaluate(() => {
      const rule = document.querySelector('#slide-iframe').contentDocument.querySelector('.rule.thin');
      const rect = rule.getBoundingClientRect();
      return { x: rect.x, y: rect.y, width: rect.width, height: rect.height, id: rule.dataset.slideObjectId };
    });
    assert.ok(thinRuleBox);
    assert.ok(thinRuleBox.height <= 2, `thin rule should remain line-like: ${JSON.stringify({ thinRuleBox, thinRuleRect })}`);
    const thinRuleHandle = await page.locator('#object-selected-box [data-object-handle="e"]').boundingBox();
    assert.ok(thinRuleHandle);
    await page.mouse.move(thinRuleHandle.x + 4, thinRuleHandle.y + 4);
    await page.mouse.down();
    await page.mouse.move(thinRuleHandle.x + 24, thinRuleHandle.y + 4, { steps: 3 });
    await page.mouse.up();
    const resizedThinRule = await page.evaluate(() => {
      const rule = document.querySelector('#slide-iframe').contentDocument.querySelector('.rule.thin');
      const rect = rule.getBoundingClientRect();
      return { width: Math.round(rect.width), height: Math.round(rect.height) };
    });
    assert.equal(resizedThinRule.height, 1);
    assert.ok(resizedThinRule.width > Math.round(thinRuleRect.width));

    await clickFrameElement(page, 'h1', 2);
    await page.waitForFunction(() => document.querySelector('#slide-iframe').contentDocument.querySelector('h1')?.isContentEditable);
    await page.keyboard.type('Editable deck title');
    await page.keyboard.press('Enter');
    await page.keyboard.type('Second line');
    const saveResponse = page.waitForResponse((response) => (
      response.url().includes('/api/slides/slide-01.html/save')
      && response.request().method() === 'POST'
    ));
    await page.keyboard.press('Escape');
    await page.waitForFunction(() => document.querySelector('#slide-iframe').contentDocument.querySelector('h1')?.textContent.includes('Editable deck title'));
    assert.equal((await saveResponse).status(), 200);

    const saved = await readFile(join(slidesDir, 'slide-01.html'), 'utf8');
    assert.match(saved, /Editable deck title/);
    assert.match(saved, /Editable deck title<br>Second line/);
    assert.doesNotMatch(saved, /<h1[^>]*>[^]*<div>Second line<\/div>/);
    assert.match(saved, /data-slide-object-id=/);
    assert.match(saved, /position: absolute/);
    assert.doesNotMatch(saved, /slides-grab-html-canvas/);
  } finally {
    if (browser) await browser.close();
    child.kill('SIGTERM');
    await rm(workspace, { recursive: true, force: true });
  }
});

test('indexes every visible object across all recent deck slides without duplicate ids', async () => {
  const workspace = await mkdtemp(join(os.tmpdir(), 'html-canvas-all-slides-'));
  const slidesDir = join(workspace, 'deck');
  await cp(SOURCE_DECK, slidesDir, { recursive: true });
  const { child, port } = await startEditor(slidesDir);
  let browser;
  try {
    browser = await chromium.launch({ headless: true });
    const page = await browser.newPage({ viewport: { width: 1600, height: 1000 } });
    await page.goto(`http://localhost:${port}`, { waitUntil: 'domcontentloaded' });
    await page.click('#tool-mode-select');

    for (let slideIndex = 0; slideIndex < 5; slideIndex += 1) {
      await page.waitForFunction((expected) => document.querySelector('#slide-counter')?.textContent?.startsWith(`${expected} /`), slideIndex + 1);
      await page.waitForFunction((expected) => {
        const frame = document.querySelector('#slide-iframe');
        return frame?.src?.includes(`slide-0${expected}.html`)
          && frame.contentDocument?.body
          && frame.contentDocument.body.dataset.slideObjectId;
      }, slideIndex + 1);
      await page.waitForFunction(() => /editable objects/.test(document.querySelector('#object-renderer-status')?.textContent || ''));
      const audit = await page.evaluate(() => {
        const doc = document.querySelector('#slide-iframe').contentDocument;
        const view = doc.defaultView;
        const visible = [doc.body, ...doc.body.querySelectorAll('*')].filter((element) => {
          const tag = element.tagName?.toLowerCase();
          if (['html', 'head', 'script', 'style', 'link', 'meta', 'noscript'].includes(tag)) return false;
          if (element.hasAttribute('data-slides-grab-runtime')) return false;
          const style = view.getComputedStyle(element);
          const rect = element.getBoundingClientRect();
          return style.display !== 'none'
            && style.visibility !== 'hidden'
            && Number.parseFloat(style.opacity || '1') > 0
            && rect.width > 0
            && rect.height > 0;
        });
        const ids = visible.map((element) => element.dataset.slideObjectId);
        return {
          visibleCount: visible.length,
          indexedCount: ids.filter(Boolean).length,
          uniqueCount: new Set(ids.filter(Boolean)).size,
          missing: visible.filter((element) => !element.dataset.slideObjectId).map((element) => element.tagName),
          onePixelObjects: visible.filter((element) => {
            const rect = element.getBoundingClientRect();
            return rect.width <= 1 || rect.height <= 1;
          }).length,
        };
      });
      assert.equal(audit.indexedCount, audit.visibleCount, `slide ${slideIndex + 1} missing ${audit.missing.join(', ')}`);
      assert.equal(audit.uniqueCount, audit.indexedCount, `slide ${slideIndex + 1} has duplicate object ids`);
      if (slideIndex === 0 || slideIndex === 4) assert.ok(audit.onePixelObjects > 0);
      if (slideIndex < 4) await page.click('#btn-next');
    }
  } finally {
    if (browser) await browser.close();
    child.kill('SIGTERM');
    await rm(workspace, { recursive: true, force: true });
  }
});

test('irreversibly freezes layout HTML into independent editable objects', async () => {
  const workspace = await mkdtemp(join(os.tmpdir(), 'html-canvas-freeze-'));
  const slidesDir = join(workspace, 'deck');
  await cp(SOURCE_DECK, slidesDir, { recursive: true });
  const { child, port } = await startEditor(slidesDir);
  let browser;
  try {
    browser = await chromium.launch({ headless: true });
    const page = await browser.newPage({ viewport: { width: 1600, height: 1000 } });
    await page.goto(`http://localhost:${port}`, { waitUntil: 'domcontentloaded' });
    await page.click('#tool-mode-select');
    await page.waitForFunction(() => document.querySelector('#slide-iframe')?.contentDocument?.querySelector('.photos'));

    const saveResponse = page.waitForResponse((response) => (
      response.url().includes('/api/slides/slide-01.html/save')
      && response.request().method() === 'POST'
    ));
    await page.click('#freeze-flat-scene');
    assert.equal((await saveResponse).status(), 200);
    const savedAfterFreeze = await readFile(join(slidesDir, 'slide-01.html'), 'utf8');
    const savedObjectCount = (savedAfterFreeze.match(/data-slide-object-id=/g) || []).length;
    assert.ok(savedObjectCount >= 8, `saved flat objects=${savedObjectCount}`);
    await page.waitForFunction(() => document.querySelector('#slide-iframe')?.contentDocument?.body?.dataset?.slidesGrabFlatScene === '1');
    await page.waitForFunction(() => document.querySelector('#slide-iframe')?.contentDocument?.querySelectorAll('[data-slide-object-id]').length >= 8);

    const frozen = await page.evaluate(() => {
      const doc = document.querySelector('#slide-iframe').contentDocument;
      const objects = Array.from(doc.querySelectorAll('[data-slide-object-id]'));
      const title = objects.find((element) => element.tagName === 'H1');
      const images = objects.filter((element) => element.tagName === 'IMG');
      return {
        count: objects.length,
        flexCount: objects.filter((element) => getComputedStyle(element).display === 'flex').length,
        titleText: title?.textContent,
        imageCount: images.length,
        allAbsolute: objects.every((element) => getComputedStyle(element).position === 'absolute'),
        nonAbsolute: objects.filter((element) => getComputedStyle(element).position !== 'absolute')
          .map((element) => ({ tag: element.tagName, id: element.dataset.slideObjectId, position: getComputedStyle(element).position })),
        originalContainers: Boolean(doc.querySelector('.mast, .stage, .photos, .ph-col, .bottom')),
      };
    });
    assert.ok(frozen.count >= 8, JSON.stringify(frozen));
    assert.equal(frozen.flexCount, 0);
    assert.equal(frozen.imageCount, 2);
    assert.match(frozen.titleText, /Ditto\./);
    assert.equal(frozen.allAbsolute, true, JSON.stringify(frozen.nonAbsolute));
    assert.equal(frozen.originalContainers, false);

    await clickFrameElement(page, 'h1');
    await page.waitForFunction(() => document.querySelector('#mini-tag')?.textContent === '<h1>');
    await page.locator('#popover-text-input').fill('Final human edit');
    const textSave = page.waitForResponse((response) => (
      response.url().includes('/api/slides/slide-01.html/save')
      && response.request().method() === 'POST'
    ));
    await page.click('#popover-apply-text');
    assert.equal((await textSave).status(), 200);

    const imageBefore = await page.evaluate(() => {
      const image = document.querySelector('#slide-iframe').contentDocument.querySelector('img');
      const rect = image.getBoundingClientRect();
      return { x: Math.round(rect.x), y: Math.round(rect.y) };
    });
    await clickFrameElement(page, 'img');
    const box = await page.locator('#object-selected-box').boundingBox();
    assert.ok(box);
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await page.mouse.down();
    await page.mouse.move(box.x + box.width / 2 + 36, box.y + box.height / 2 + 20, { steps: 4 });
    await page.mouse.up();
    const imageAfter = await page.evaluate(() => {
      const image = document.querySelector('#slide-iframe').contentDocument.querySelector('img');
      const rect = image.getBoundingClientRect();
      return { x: Math.round(rect.x), y: Math.round(rect.y) };
    });
    assert.ok(imageAfter.x > imageBefore.x);
    assert.ok(imageAfter.y > imageBefore.y);

    const saved = await readFile(join(slidesDir, 'slide-01.html'), 'utf8');
    assert.match(saved, /data-slides-grab-flat-scene="1"/);
    assert.match(saved, /Final human edit/);
    assert.doesNotMatch(saved, /class="(?:mast|stage|photos|ph-col|bottom)"/);
  } finally {
    if (browser) await browser.close();
    child.kill('SIGTERM');
    await rm(workspace, { recursive: true, force: true });
  }
});

test('uses the native HTML-in-Canvas renderer when supported by Chrome', {
  skip: !existsSync(CHROME),
}, async () => {
  const workspace = await mkdtemp(join(os.tmpdir(), 'html-canvas-native-'));
  const slidesDir = join(workspace, 'deck');
  await cp(SOURCE_DECK, slidesDir, { recursive: true });
  const { child, port } = await startEditor(slidesDir);
  let browser;
  try {
    browser = await chromium.launch({
      headless: true,
      executablePath: CHROME,
      args: ['--enable-blink-features=CanvasDrawElement', '--enable-features=CanvasDrawElement'],
    });
    const page = await browser.newPage({ viewport: { width: 1600, height: 1000 } });
    await page.goto(`http://localhost:${port}`, { waitUntil: 'domcontentloaded' });
    await page.waitForFunction(() => document.querySelector('#slide-iframe')?.contentDocument?.querySelector('.rule'));
    await page.waitForFunction(() => document.querySelector('#slide-iframe').contentDocument.querySelector('#slides-grab-html-canvas')?.dataset.renderer === 'native');
    assert.match(await page.$eval('#object-renderer-status', (node) => node.textContent), /Native HTML-in-Canvas/);
    await page.click('#tool-mode-select');
    await clickFrameElement(page, 'h1', 2);
    await page.waitForFunction(() => document.querySelector('#slide-iframe').contentDocument.querySelector('h1')?.isContentEditable);
    await page.keyboard.type('Native canvas title');
    const saveResponse = page.waitForResponse((response) => (
      response.url().includes('/api/slides/slide-01.html/save')
      && response.request().method() === 'POST'
    ));
    await page.keyboard.press('Escape');
    assert.equal((await saveResponse).status(), 200);
    const undoResponse = page.waitForResponse((response) => (
      response.url().includes('/api/slides/slide-01.html/save')
      && response.request().method() === 'POST'
    ));
    await page.keyboard.press('Control+Z');
    assert.equal((await undoResponse).status(), 200);
    await page.waitForFunction(() => document.querySelector('#slide-iframe').contentDocument.querySelector('#slides-grab-html-canvas')?.dataset.renderer === 'native');
    const runtimeCount = await page.evaluate(() => (
      document.querySelector('#slide-iframe').contentDocument.querySelectorAll('#slides-grab-html-canvas').length
    ));
    assert.equal(runtimeCount, 1);
    const saved = await readFile(join(slidesDir, 'slide-01.html'), 'utf8');
    assert.doesNotMatch(saved, /Native canvas title/);
    assert.doesNotMatch(saved, /slides-grab-html-canvas/);
  } finally {
    if (browser) await browser.close();
    child.kill('SIGTERM');
    await rm(workspace, { recursive: true, force: true });
  }
});
