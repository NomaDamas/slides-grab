import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtemp, mkdir, readFile, writeFile, rm } from 'node:fs/promises';
import os from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';
import { chromium } from 'playwright';
import { getAvailablePort } from './test-server-helpers.js';

const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function writeSlides(workspace) {
  const slidesDir = join(workspace, 'slides');
  await mkdir(slidesDir, { recursive: true });
  await writeFile(join(slidesDir, 'slide-01.html'), `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <style>
    html, body { margin: 0; padding: 0; width: 960px; height: 540px; overflow: hidden; }
    .wrap { position: absolute; inset: 0; width: 960px; height: 540px; }
    h1 { position: absolute; left: 40px; top: 32px; margin: 0; width: 280px; height: 48px; font-size: 40px; }
    .card { position: absolute; left: 120px; top: 90px; width: 360px; height: 240px; background: #f8fafc; }
    .target { position: absolute; left: 32px; top: 28px; width: 120px; height: 80px; background: #60a5fa; }
  </style>
</head>
<body>
  <div class="wrap"><h1>Deck title</h1><div class="card"><div class="target">Nested box</div></div></div>
</body>
</html>`, 'utf8');
}

async function waitForServerReady(port, child, outputRef) {
  const started = Date.now();
  while (Date.now() - started < 20000) {
    if (child.exitCode !== null) throw new Error(`server exited early: ${child.exitCode}\n${outputRef.value}`);
    try {
      const res = await fetch(`http://localhost:${port}/api/slides`);
      if (res.ok) return;
    } catch {}
    await sleep(150);
  }
  throw new Error(`server did not become ready\n${outputRef.value}`);
}

async function withEditorPage(prefix, callback) {
  const workspace = await mkdtemp(join(os.tmpdir(), prefix));
  await writeSlides(workspace);

  const port = await getAvailablePort();
  const serverOutput = { value: '' };
  const server = spawn(process.execPath, [join(REPO_ROOT, 'scripts', 'editor-server.js'), '--port', String(port)], {
    cwd: workspace,
    env: { ...process.env, PPT_AGENT_PACKAGE_ROOT: REPO_ROOT },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  server.stdout.on('data', (chunk) => { serverOutput.value += chunk.toString(); });
  server.stderr.on('data', (chunk) => { serverOutput.value += chunk.toString(); });

  let browser;
  try {
    await waitForServerReady(port, server, serverOutput);
    browser = await chromium.launch({ headless: true });
    const page = await browser.newPage({ viewport: { width: 1600, height: 1000 } });
    await page.goto(`http://localhost:${port}/`, { waitUntil: 'domcontentloaded' });
    await page.waitForSelector('#draw-layer');
    await page.waitForTimeout(800);
    await page.click('#tool-mode-select');

    const drawLayer = await page.locator('#draw-layer').boundingBox();
    assert.ok(drawLayer, 'draw layer not found');
    await callback(page, drawLayer, workspace);
  } finally {
    if (browser) await browser.close().catch(() => {});
    server.kill('SIGTERM');
    await sleep(400);
    await rm(workspace, { recursive: true, force: true }).catch(() => {});
  }
}

async function readTargetRect(page) {
  return page.$eval('#slide-iframe', (frame) => {
    const target = frame.contentDocument?.querySelector('.target');
    if (!target) return null;
    const rect = target.getBoundingClientRect();
    return {
      x: Math.round(rect.left),
      y: Math.round(rect.top),
      width: Math.round(rect.width),
      height: Math.round(rect.height),
    };
  });
}

async function readTargetBackground(page) {
  return page.$eval('#slide-iframe', (frame) => {
    const target = frame.contentDocument?.querySelector('.target');
    return target ? frame.contentWindow.getComputedStyle(target).backgroundColor : '';
  });
}

async function waitForTargetBackground(page, expected) {
  await page.waitForFunction((wanted) => {
    const frame = document.querySelector('#slide-iframe');
    const target = frame?.contentDocument?.querySelector('.target');
    return target ? frame.contentWindow.getComputedStyle(target).backgroundColor === wanted : false;
  }, expected);
  assert.equal(await readTargetBackground(page), expected);
}

async function waitForTargetRect(page, expected) {
  await page.waitForFunction((wanted) => {
    const frame = document.querySelector('#slide-iframe');
    const target = frame?.contentDocument?.querySelector('.target');
    if (!target) return false;
    const rect = target.getBoundingClientRect();
    return Math.round(rect.left) === wanted.x
      && Math.round(rect.top) === wanted.y
      && Math.round(rect.width) === wanted.width
      && Math.round(rect.height) === wanted.height;
  }, expected);
  assert.deepEqual(await readTargetRect(page), expected);
}

async function readSelectedTag(page) {
  return page.$eval('#mini-tag', (node) => node.textContent || '');
}

async function readTitleText(page) {
  return page.$eval('#slide-iframe', (frame) => {
    const title = frame.contentDocument?.querySelector('h1');
    return title?.textContent || '';
  });
}

async function dragCenter(page, box, dx, dy, steps = 4) {
  const x = box.x + box.width / 2;
  const y = box.y + box.height / 2;
  await page.mouse.move(x, y);
  await page.mouse.down();
  await page.mouse.move(x + dx, y + dy, { steps });
  await page.mouse.up();
}

test('keeps nested objects cursor-aligned when clicking, dragging, and resizing in select mode', { concurrency: false }, async () => {
  await withEditorPage('editor-object-transform-e2e-', async (page, drawLayer, workspace) => {
    await page.mouse.click(drawLayer.x + 160, drawLayer.y + 126);
    await page.waitForFunction(() => getComputedStyle(document.querySelector('#object-selected-box')).display !== 'none');

    const initialRect = { x: 152, y: 118, width: 120, height: 80 };
    await waitForTargetRect(page, initialRect);

    const selectedBox = await page.locator('#object-selected-box').boundingBox();
    assert.ok(selectedBox, 'selected object box not found');
    await page.mouse.click(selectedBox.x + selectedBox.width / 2, selectedBox.y + selectedBox.height / 2);
    assert.deepEqual(await readTargetRect(page), initialRect, 'plain click should not move the selected object');

    await dragCenter(page, selectedBox, 40, 24);
    await waitForTargetRect(page, { x: 192, y: 142, width: 120, height: 80 });

    await page.keyboard.press('Control+Z');
    await waitForTargetRect(page, initialRect);
    await page.keyboard.press('Control+Y');
    await waitForTargetRect(page, { x: 192, y: 142, width: 120, height: 80 });

    const seHandle = await page.locator('#object-selected-box [data-object-handle="se"]').boundingBox();
    assert.ok(seHandle, 'south-east handle not found');
    await dragCenter(page, seHandle, 30, 20);
    await waitForTargetRect(page, { x: 192, y: 142, width: 150, height: 100 });

    await page.locator('#popover-bg-color-input').fill('#22c55e');
    await waitForTargetBackground(page, 'rgb(34, 197, 94)');
    await page.keyboard.press('Control+Z');
    await waitForTargetBackground(page, 'rgb(96, 165, 250)');
    await page.keyboard.press('Control+Y');
    await waitForTargetBackground(page, 'rgb(34, 197, 94)');

    const resizedBox = await page.locator('#object-selected-box').boundingBox();
    assert.ok(resizedBox, 'resized object box not found');
    await dragCenter(page, resizedBox, -180, -130, 6);
    await waitForTargetRect(page, { x: 12, y: 12, width: 150, height: 100 });

    const escapedBox = await page.locator('#object-selected-box').boundingBox();
    assert.ok(escapedBox, 'escaped object box not found');
    await dragCenter(page, escapedBox, 220, 160, 6);
    await waitForTargetRect(page, { x: 232, y: 172, width: 150, height: 100 });

    await page.waitForTimeout(600);
    const savedHtml = await readFile(join(workspace, 'slides', 'slide-01.html'), 'utf8');
    assert.match(savedHtml, /background-color: rgb\(34, 197, 94\)/);
    assert.doesNotMatch(savedHtml, /data-slides-grab-runtime|\[slides-grab:image\]|<base href="\/slides\/">/);

    await page.evaluate(async () => {
      const frame = document.querySelector('#slide-iframe');
      const html = `<!DOCTYPE html>\n${frame.contentDocument.documentElement.outerHTML.replace('Deck title', 'External title')}`;
      const res = await fetch('/api/slides/slide-01.html/save', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ slide: 'slide-01.html', html }),
      });
      if (!res.ok) throw new Error(`save failed ${res.status}`);
      frame.src = frame.src;
    });
    await page.waitForFunction(() => {
      const frame = document.querySelector('#slide-iframe');
      return frame?.contentDocument?.querySelector('h1')?.textContent === 'External title';
    });
    await page.keyboard.press('Control+Z');
    await page.waitForTimeout(150);
    assert.equal(await readTitleText(page), 'External title');
  });
});

test('clears blank slide selection and allows title reselection after a background click', { concurrency: false }, async () => {
  await withEditorPage('editor-object-select-e2e-', async (page, drawLayer) => {
    await page.mouse.click(drawLayer.x + 70, drawLayer.y + 58);
    await page.waitForFunction(() => (document.querySelector('#mini-tag')?.textContent || '') === '<h1>');
    assert.equal(await readSelectedTag(page), '<h1>');

    await page.mouse.click(drawLayer.x + 900, drawLayer.y + 500);
    await page.waitForFunction(() => getComputedStyle(document.querySelector('#object-selected-box')).display === 'none');
    assert.equal(await page.$eval('#selected-object-mini', (node) => getComputedStyle(node).display), 'none');

    await page.mouse.click(drawLayer.x + 70, drawLayer.y + 58);
    await page.waitForFunction(() => (document.querySelector('#mini-tag')?.textContent || '') === '<h1>');
    assert.equal(await readSelectedTag(page), '<h1>');
  });
});
