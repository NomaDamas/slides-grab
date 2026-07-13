import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtemp, mkdir, writeFile, readFile, rm } from 'node:fs/promises';
import os from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';
import { getAvailablePort } from './test-server-helpers.js';
import { chromium } from 'playwright';

const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function writeSlides(workspace) {
  const slidesDir = join(workspace, 'slides');
  await mkdir(slidesDir, { recursive: true });

  const html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <style>
    html, body { margin: 0; padding: 0; width: 960px; height: 540px; overflow: hidden; }
    .wrap { width: 960px; height: 540px; padding: 48px; box-sizing: border-box; }
    h1 { margin: 0; font-size: 56px; }
    p { margin: 20px 0 0 0; font-size: 24px; }
  </style>
</head>
<body>
  <div class="wrap">
    <h1>Hello World</h1>
    <p>UI bbox e2e</p>
  </div>
</body>
</html>`;

  await writeFile(join(slidesDir, 'slide-01.html'), html, 'utf8');
  await writeFile(join(slidesDir, 'slide-02.html'), html.replace('UI bbox e2e', 'UI bbox e2e slide2'), 'utf8');
}

async function waitForServerReady(port, child, outputRef) {
  const started = Date.now();
  while (Date.now() - started < 20000) {
    if (child.exitCode !== null) {
      throw new Error(`server exited early: ${child.exitCode}\n${outputRef.value}`);
    }

    try {
      const res = await fetch(`http://localhost:${port}/api/slides`);
      if (res.ok) return;
    } catch {
      // retry
    }

    await sleep(150);
  }

  throw new Error(`server did not become ready\n${outputRef.value}`);
}

test('supports multi-bbox selection and delete in the persistent inspector bbox flow', { concurrency: false }, async () => {
  const workspace = await mkdtemp(join(os.tmpdir(), 'editor-ui-e2e-'));
  await writeSlides(workspace);

  const port = await getAvailablePort();
  const serverOutput = { value: '' };
  const serverScriptPath = join(REPO_ROOT, 'scripts', 'editor-server.js');
  const server = spawn(process.execPath, [serverScriptPath, '--port', String(port)], {
    cwd: workspace,
    env: {
      ...process.env,
      PPT_AGENT_PACKAGE_ROOT: REPO_ROOT,
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  server.stdout.on('data', (chunk) => {
    serverOutput.value += chunk.toString();
  });
  server.stderr.on('data', (chunk) => {
    serverOutput.value += chunk.toString();
  });

  let browser;
  try {
    await waitForServerReady(port, server, serverOutput);

    browser = await chromium.launch({ headless: true });
    const page = await browser.newPage({ viewport: { width: 1600, height: 1000 } });
    await page.goto(`http://localhost:${port}/`, { waitUntil: 'domcontentloaded' });

    await page.waitForSelector('#draw-layer');
    await page.waitForTimeout(800);
    assert.equal(await page.locator('#editor-sidebar').count(), 1, 'persistent editor sidebar should be present');
    assert.equal(await page.locator('#editor-sidebar').isVisible(), true, 'persistent editor sidebar should be visible');
    assert.equal(await page.locator('#bbox-toolbar').isVisible(), true, 'bbox toolbar should be visible in draw mode');
    const sendUsesNeutralStyle = await page.$eval('#btn-send', (el) => !el.classList.contains('sidebar-btn-primary'));
    assert.equal(sendUsesNeutralStyle, true, 'send button should no longer use accent-primary styling');
    const promptTag = await page.$eval('#prompt-input', (el) => el.tagName);
    assert.equal(promptTag, 'TEXTAREA', 'bbox prompt should stay a textarea in the persistent inspector');
    const bodyFont = await page.evaluate(() => getComputedStyle(document.body).fontFamily);
    assert.match(bodyFont, /Pretendard/i);
    assert.ok(!/Geist/i.test(bodyFont), `unexpected body font stack: ${bodyFont}`);

    const drawLayer = await page.locator('#draw-layer').boundingBox();
    assert.ok(drawLayer, 'draw layer not found');

    // draw bbox #1
    await page.mouse.move(drawLayer.x + drawLayer.width * 0.08, drawLayer.y + drawLayer.height * 0.08);
    await page.mouse.down();
    await page.mouse.move(drawLayer.x + drawLayer.width * 0.42, drawLayer.y + drawLayer.height * 0.24, { steps: 6 });
    await page.mouse.up();

    // draw bbox #2
    await page.mouse.move(drawLayer.x + drawLayer.width * 0.20, drawLayer.y + drawLayer.height * 0.34);
    await page.mouse.down();
    await page.mouse.move(drawLayer.x + drawLayer.width * 0.66, drawLayer.y + drawLayer.height * 0.62, { steps: 6 });
    await page.mouse.up();

    await page.waitForFunction(() => {
      const el = document.querySelector('#bbox-count');
      return el && /2 pending/.test(el.textContent || '');
    });

    await page.locator('.bbox-item').first().click();
    await page.locator('.bbox-item.selected .bbox-delete').click();

    await page.waitForFunction(() => {
      const el = document.querySelector('#bbox-count');
      return el && /1 pending/.test(el.textContent || '');
    });

    const clearInWrapper = await page.evaluate(() => {
      const btn = document.querySelector('#btn-clear-bboxes');
      return !!btn && !!btn.closest('#slide-wrapper') && !btn.closest('.composer');
    });
    assert.equal(clearInWrapper, true, 'clear button should be in slide wrapper');

    const capturedBodies = [];
    await page.route('**/api/apply', async (route) => {
      const req = route.request();
      capturedBodies.push(JSON.parse(req.postData() || '{}'));
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          success: true,
          runId: 'run-ui-e2e',
          code: 0,
          message: 'ok',
        }),
      });
    });

    await page.fill('#prompt-input', 'Change heading text.');
    await page.click('#btn-send');

    await page.waitForFunction(() => {
      const el = document.querySelector('#status-message');
      return el && /ok/i.test(el.textContent || '');
    });

    await page.waitForFunction(() => document.querySelectorAll('.bbox-item.review').length === 1);
    assert.equal(await page.locator('.bbox-item.pending').count(), 0);

    assert.equal(capturedBodies.length, 1, 'first apply payload was not captured');
    assert.equal(capturedBodies[0].slide, 'slide-01.html');
    assert.ok(Array.isArray(capturedBodies[0].selections));
    assert.equal(capturedBodies[0].selections.length, 1);
    assert.ok(Array.isArray(capturedBodies[0].selections[0].targets));

    await page.locator('.bbox-item.review').first().click();
    await page.locator('.bbox-item.selected [data-box-rerun]').click();
    await page.waitForFunction(() => document.querySelectorAll('.bbox-item.pending').length === 1);

    await page.fill('#prompt-input', 'Run once more.');
    await page.click('#btn-send');
    await page.waitForFunction(() => document.querySelectorAll('.bbox-item.review').length === 1);
    assert.equal(capturedBodies.length, 2);
    assert.equal(capturedBodies[1].selections.length, 1);

    await page.locator('.bbox-item.review').first().click();
    await page.locator('.bbox-item.selected [data-box-check]').click();
    await page.waitForFunction(() => document.querySelectorAll('.bbox-item').length === 0);
    await page.waitForFunction(() => {
      const el = document.querySelector('#bbox-count');
      return el && /0 pending/.test(el.textContent || '');
    });
  } finally {
    if (browser) {
      await browser.close().catch(() => {});
    }
    server.kill('SIGTERM');
    await sleep(400);
    await rm(workspace, { recursive: true, force: true }).catch(() => {});
  }
});

test('keeps bbox prompt draft and model state per slide session', { concurrency: false }, async () => {
  const workspace = await mkdtemp(join(os.tmpdir(), 'editor-ui-session-e2e-'));
  await writeSlides(workspace);

  const port = await getAvailablePort();
  const serverOutput = { value: '' };
  const serverScriptPath = join(REPO_ROOT, 'scripts', 'editor-server.js');
  const server = spawn(process.execPath, [serverScriptPath, '--port', String(port)], {
    cwd: workspace,
    env: {
      ...process.env,
      PPT_AGENT_PACKAGE_ROOT: REPO_ROOT,
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  server.stdout.on('data', (chunk) => {
    serverOutput.value += chunk.toString();
  });
  server.stderr.on('data', (chunk) => {
    serverOutput.value += chunk.toString();
  });

  let browser;
  try {
    await waitForServerReady(port, server, serverOutput);

    browser = await chromium.launch({ headless: true });
    const page = await browser.newPage({ viewport: { width: 1600, height: 1000 } });
    await page.goto(`http://localhost:${port}/`, { waitUntil: 'domcontentloaded' });

    await page.waitForSelector('#draw-layer');
    await page.waitForTimeout(800);

    // slide-01
    await page.selectOption('#model-select', 'gpt-5.6-terra');
    await page.fill('#prompt-input', 'slide-01 prompt');

    // slide-02
    await page.click('#btn-next');
    await page.waitForFunction(() => {
      const counter = document.querySelector('#slide-counter');
      return counter && /2\s*\/\s*2/.test(counter.textContent || '');
    });
    await page.selectOption('#model-select', 'gpt-5.6-terra');
    await page.fill('#prompt-input', 'slide-02 prompt');

    // back to slide-01
    await page.click('#btn-prev');
    await page.waitForFunction(() => {
      const counter = document.querySelector('#slide-counter');
      return counter && /1\s*\/\s*2/.test(counter.textContent || '');
    });

    const restoredModel = await page.$eval('#model-select', (el) => el.value);
    assert.equal(restoredModel, 'gpt-5.6-terra');
    const restoredPrompt = await page.$eval('#prompt-input', (el) => el.value);
    assert.equal(restoredPrompt, 'slide-01 prompt');

    await page.click('#btn-next');
    await page.waitForFunction(() => {
      const counter = document.querySelector('#slide-counter');
      return counter && /2\s*\/\s*2/.test(counter.textContent || '');
    });
    const slide2Model = await page.$eval('#model-select', (el) => el.value);
    const slide2Prompt = await page.$eval('#prompt-input', (el) => el.value);
    assert.equal(slide2Model, 'gpt-5.6-terra');
    assert.equal(slide2Prompt, 'slide-02 prompt');

  } finally {
    if (browser) {
      await browser.close().catch(() => {});
    }
    server.kill('SIGTERM');
    await sleep(400);
    await rm(workspace, { recursive: true, force: true }).catch(() => {});
  }
});

test('recovers removed gpt-5.5 localStorage state to the GPT-5.6 Sol default', { concurrency: false }, async () => {
  const workspace = await mkdtemp(join(os.tmpdir(), 'editor-ui-stale-model-e2e-'));
  await writeSlides(workspace);
  const port = await getAvailablePort();
  const serverOutput = { value: '' };
  const serverScriptPath = join(REPO_ROOT, 'scripts', 'editor-server.js');
  const server = spawn(process.execPath, [serverScriptPath, '--port', String(port)], {
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
    const initialModels = page.waitForResponse((response) => response.url().endsWith('/api/models') && response.ok());
    await page.goto(`http://localhost:${port}/`, { waitUntil: 'domcontentloaded' });
    await initialModels;

    await page.evaluate(() => localStorage.setItem('slides-grab-editor-model', 'gpt-5.5'));
    const reloadedModels = page.waitForResponse((response) => response.url().endsWith('/api/models') && response.ok());
    await page.reload({ waitUntil: 'domcontentloaded' });
    await reloadedModels;
    await page.waitForFunction(() => document.querySelector('#model-select')?.value === 'gpt-5.6-sol');

    assert.equal(await page.locator('#model-select').inputValue(), 'gpt-5.6-sol');
    assert.equal(await page.evaluate(() => localStorage.getItem('slides-grab-editor-model')), 'gpt-5.6-sol');
  } finally {
    if (browser) await browser.close().catch(() => {});
    server.kill('SIGTERM');
    await sleep(400);
    await rm(workspace, { recursive: true, force: true }).catch(() => {});
  }
});

test('supports direct object selection through the persistent inspector and switching back to bbox mode', { concurrency: false }, async () => {
  const workspace = await mkdtemp(join(os.tmpdir(), 'editor-ui-direct-edit-e2e-'));
  await writeSlides(workspace);

  const port = await getAvailablePort();
  const serverOutput = { value: '' };
  const serverScriptPath = join(REPO_ROOT, 'scripts', 'editor-server.js');
  const server = spawn(process.execPath, [serverScriptPath, '--port', String(port)], {
    cwd: workspace,
    env: {
      ...process.env,
      PPT_AGENT_PACKAGE_ROOT: REPO_ROOT,
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  server.stdout.on('data', (chunk) => {
    serverOutput.value += chunk.toString();
  });
  server.stderr.on('data', (chunk) => {
    serverOutput.value += chunk.toString();
  });

  let browser;
  try {
    await waitForServerReady(port, server, serverOutput);

    browser = await chromium.launch({ headless: true });
    const page = await browser.newPage({ viewport: { width: 1600, height: 1000 } });
    await page.goto(`http://localhost:${port}/`, { waitUntil: 'domcontentloaded' });

    await page.waitForSelector('#draw-layer');
    await page.waitForSelector('#slide-iframe');
    await page.waitForTimeout(800);

    await page.click('#tool-mode-select');
    await page.waitForFunction(() => {
      const textInput = document.querySelector('#popover-text-input');
      const sizeInput = document.querySelector('#popover-size-input');
      const emptyHint = document.querySelector('#select-empty-hint');
      const selectToolbar = document.querySelector('#select-toolbar');
      return textInput && sizeInput && emptyHint && selectToolbar
        && !selectToolbar.hasAttribute('hidden')
        && textInput.disabled
        && sizeInput.disabled
        && /click an object/i.test(emptyHint.textContent || '');
    });
    const selectedMiniVisible = await page.$eval('#selected-object-mini', (el) => getComputedStyle(el).display !== 'none');
    assert.equal(selectedMiniVisible, false, 'selected object summary should stay hidden before selection');

    const drawLayer = await page.locator('#draw-layer').boundingBox();
    assert.ok(drawLayer, 'draw layer not found');

    await page.mouse.click(
      drawLayer.x + drawLayer.width * 0.22,
      drawLayer.y + drawLayer.height * 0.18,
    );

    await page.waitForFunction(() => {
      const textInput = document.querySelector('#popover-text-input');
      const colorInput = document.querySelector('#popover-text-color-input');
      const sizeInput = document.querySelector('#popover-size-input');
      const selectedMini = document.querySelector('#selected-object-mini');
      return textInput && colorInput && sizeInput && selectedMini
        && !textInput.disabled
        && !colorInput.disabled
        && !sizeInput.disabled
        && getComputedStyle(selectedMini).display !== 'none';
    });

    await page.fill('#popover-text-input', 'Quarterly Update');
    await page.click('#popover-apply-text');

    await page.fill('#popover-size-input', '64');
    await page.click('#popover-apply-size');

    await page.$eval('#popover-text-color-input', (el) => {
      el.value = '#112233';
      el.dispatchEvent(new Event('input', { bubbles: true }));
      el.dispatchEvent(new Event('change', { bubbles: true }));
    });

    await page.$eval('#popover-bg-color-input', (el) => {
      el.value = '#fee2e2';
      el.dispatchEvent(new Event('input', { bubbles: true }));
      el.dispatchEvent(new Event('change', { bubbles: true }));
    });

    await page.waitForFunction(() => {
      const boldBtn = document.querySelector('#toggle-bold');
      return boldBtn
        && boldBtn.classList.contains('active')
        && boldBtn.getAttribute('aria-pressed') === 'true';
    });
    await page.click('#toggle-bold');
    await page.waitForFunction(() => {
      const boldBtn = document.querySelector('#toggle-bold');
      const frame = document.querySelector('#slide-iframe');
      const heading = frame?.contentDocument?.querySelector('h1');
      if (!boldBtn || !heading || !frame.contentWindow) return false;
      const fontWeight = frame.contentWindow.getComputedStyle(heading).fontWeight;
      const isBold = Number(fontWeight) >= 600 || /bold/i.test(fontWeight);
      return !boldBtn.classList.contains('active')
        && boldBtn.getAttribute('aria-pressed') === 'false'
        && !isBold;
    });
    await page.click('#toggle-bold');
    await page.waitForFunction(() => {
      const boldBtn = document.querySelector('#toggle-bold');
      const frame = document.querySelector('#slide-iframe');
      const heading = frame?.contentDocument?.querySelector('h1');
      if (!boldBtn || !heading || !frame.contentWindow) return false;
      const fontWeight = frame.contentWindow.getComputedStyle(heading).fontWeight;
      const isBold = Number(fontWeight) >= 600 || /bold/i.test(fontWeight);
      return boldBtn.classList.contains('active')
        && boldBtn.getAttribute('aria-pressed') === 'true'
        && isBold;
    });
    await page.click('#toggle-strike');
    await page.click('#align-center');

    await page.waitForFunction(() => {
      const status = document.querySelector('#status-message');
      return status && /saved|updated/i.test(status.textContent || '');
    });

    const frameHeading = page.frameLocator('#slide-iframe').locator('h1');
    await assert.doesNotReject(async () => frameHeading.waitFor());
    assert.equal(await frameHeading.textContent(), 'Quarterly Update');

    const headingStyles = await frameHeading.evaluate((node) => {
      const styles = window.getComputedStyle(node);
      return {
        color: styles.color,
        backgroundColor: styles.backgroundColor,
        fontWeight: styles.fontWeight,
        textDecorationLine: styles.textDecorationLine,
        textAlign: styles.textAlign,
        fontSize: styles.fontSize,
      };
    });

    assert.match(headingStyles.color, /17,\s*34,\s*51/);
    assert.match(headingStyles.backgroundColor, /254,\s*226,\s*226/);
    assert.ok(Number(headingStyles.fontWeight) >= 600 || /bold/i.test(headingStyles.fontWeight));
    assert.match(headingStyles.textDecorationLine, /line-through/);
    assert.equal(headingStyles.textAlign, 'center');
    assert.equal(headingStyles.fontSize, '64px');

    const savedHtml = await readFile(join(workspace, 'slides', 'slide-01.html'), 'utf8');
    assert.match(savedHtml, /Quarterly Update/);
    assert.match(savedHtml, /font-size:\s*64px/i);
    assert.match(savedHtml, /text-align:\s*center/i);
    assert.match(savedHtml, /line-through/i);
    assert.match(savedHtml, /font-weight:\s*(700|bold)/i);
    assert.match(savedHtml, /(rgb\(17,\s*34,\s*51\)|#112233)/i);
    assert.match(savedHtml, /(rgb\(254,\s*226,\s*226\)|#fee2e2)/i);

    await page.click('#tool-mode-draw');
    await page.mouse.move(drawLayer.x + drawLayer.width * 0.08, drawLayer.y + drawLayer.height * 0.10);
    await page.mouse.down();
    await page.mouse.move(drawLayer.x + drawLayer.width * 0.40, drawLayer.y + drawLayer.height * 0.24, { steps: 6 });
    await page.mouse.up();

    await page.waitForFunction(() => {
      const el = document.querySelector('#bbox-count');
      return el && /1 pending/.test(el.textContent || '');
    });
  } finally {
    if (browser) {
      await browser.close().catch(() => {});
    }
    server.kill('SIGTERM');
    await sleep(400);
    await rm(workspace, { recursive: true, force: true }).catch(() => {});
  }
});

test('suppresses slide arrow navigation while focus is inside editor form controls', { concurrency: false }, async () => {
  const workspace = await mkdtemp(join(os.tmpdir(), 'editor-ui-keyboard-nav-e2e-'));
  await writeSlides(workspace);

  const port = await getAvailablePort();
  const serverOutput = { value: '' };
  const serverScriptPath = join(REPO_ROOT, 'scripts', 'editor-server.js');
  const server = spawn(process.execPath, [serverScriptPath, '--port', String(port)], {
    cwd: workspace,
    env: {
      ...process.env,
      PPT_AGENT_PACKAGE_ROOT: REPO_ROOT,
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  server.stdout.on('data', (chunk) => {
    serverOutput.value += chunk.toString();
  });
  server.stderr.on('data', (chunk) => {
    serverOutput.value += chunk.toString();
  });

  let browser;
  try {
    await waitForServerReady(port, server, serverOutput);

    browser = await chromium.launch({ headless: true });
    const page = await browser.newPage({ viewport: { width: 1600, height: 1000 } });
    await page.goto(`http://localhost:${port}/`, { waitUntil: 'domcontentloaded' });

    await page.waitForSelector('#draw-layer');
    await page.waitForSelector('#slide-counter');
    await page.waitForTimeout(800);

    await page.focus('#model-select');
    await page.keyboard.press('ArrowRight');
    await page.waitForTimeout(150);
    await page.waitForFunction(() => {
      const counter = document.querySelector('#slide-counter');
      return counter && /1\s*\/\s*2/.test(counter.textContent || '');
    });

    await page.click('#tool-mode-select');

    const drawLayer = await page.locator('#draw-layer').boundingBox();
    assert.ok(drawLayer, 'draw layer not found');
    await page.mouse.click(
      drawLayer.x + drawLayer.width * 0.22,
      drawLayer.y + drawLayer.height * 0.18,
    );

    await page.waitForFunction(() => {
      const textInput = document.querySelector('#popover-text-input');
      const sizeInput = document.querySelector('#popover-size-input');
      return textInput && sizeInput && !textInput.disabled && !sizeInput.disabled;
    });

    await page.focus('#popover-text-input');
    await page.keyboard.press('ArrowRight');
    await page.waitForTimeout(150);
    await page.waitForFunction(() => {
      const counter = document.querySelector('#slide-counter');
      return counter && /1\s*\/\s*2/.test(counter.textContent || '');
    });

    await page.focus('#popover-size-input');
    await page.keyboard.press('ArrowLeft');
    await page.waitForTimeout(150);
    await page.waitForFunction(() => {
      const counter = document.querySelector('#slide-counter');
      return counter && /1\s*\/\s*2/.test(counter.textContent || '');
    });

    await page.mouse.click(
      drawLayer.x + drawLayer.width * 0.75,
      drawLayer.y + drawLayer.height * 0.75,
    );
    await page.keyboard.press('ArrowRight');
    await page.waitForFunction(() => {
      const counter = document.querySelector('#slide-counter');
      return counter && /2\s*\/\s*2/.test(counter.textContent || '');
    });

    await page.keyboard.press('ArrowLeft');
    await page.waitForFunction(() => {
      const counter = document.querySelector('#slide-counter');
      return counter && /1\s*\/\s*2/.test(counter.textContent || '');
    });
  } finally {
    if (browser) {
      await browser.close().catch(() => {});
    }
    server.kill('SIGTERM');
    await sleep(400);
    await rm(workspace, { recursive: true, force: true }).catch(() => {});
  }
});

test('keeps the persistent inspector beside the slide in a 16:9 viewport', { concurrency: false }, async () => {
  const workspace = await mkdtemp(join(os.tmpdir(), 'editor-ui-toolbox-layout-e2e-'));
  await writeSlides(workspace);

  const port = await getAvailablePort();
  const serverOutput = { value: '' };
  const serverScriptPath = join(REPO_ROOT, 'scripts', 'editor-server.js');
  const server = spawn(process.execPath, [serverScriptPath, '--port', String(port)], {
    cwd: workspace,
    env: {
      ...process.env,
      PPT_AGENT_PACKAGE_ROOT: REPO_ROOT,
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  server.stdout.on('data', (chunk) => {
    serverOutput.value += chunk.toString();
  });
  server.stderr.on('data', (chunk) => {
    serverOutput.value += chunk.toString();
  });

  let browser;
  try {
    await waitForServerReady(port, server, serverOutput);

    browser = await chromium.launch({ headless: true });
    const page = await browser.newPage({ viewport: { width: 1496, height: 768 } });
    await page.goto(`http://localhost:${port}/`, { waitUntil: 'domcontentloaded' });

    await page.waitForSelector('#editor-sidebar');
    await page.waitForSelector('#slide-wrapper');
    await page.waitForTimeout(500);

    const navHeight = await page.$eval('.nav-bar', (el) => parseFloat(getComputedStyle(el).height));
    const statusHeight = await page.$eval('.status-bar', (el) => parseFloat(getComputedStyle(el).height));
    const stageBox = await page.locator('#slide-stage').boundingBox();
    assert.equal(await page.locator('#editor-sidebar').count(), 1, 'persistent editor sidebar should be present');
    const sidebarBox = await page.locator('#editor-sidebar').boundingBox();
    const wrapperBox = await page.locator('#slide-wrapper').boundingBox();
    assert.ok(stageBox, 'slide stage not found');
    assert.ok(sidebarBox, 'editor sidebar not found');
    assert.ok(wrapperBox, 'slide wrapper not found');
    assert.ok(sidebarBox.width >= 300 && sidebarBox.width <= 380, `unexpected sidebar width: ${sidebarBox.width}`);
    assert.ok(stageBox.width >= wrapperBox.width, 'slide stage should contain the slide frame');
    assert.ok(sidebarBox.x >= wrapperBox.x + (wrapperBox.width * 0.9), 'sidebar should stay to the right of the slide frame');
    assert.ok(navHeight <= 48, `nav should stay compact, got ${navHeight}`);
    assert.ok(statusHeight <= 36, `status bar should stay compact, got ${statusHeight}`);

    await page.click('#tool-mode-select');
    await page.waitForFunction(() => {
      const button = document.querySelector('#tool-mode-select');
      const toolbar = document.querySelector('#select-toolbar');
      return button && toolbar && button.classList.contains('active') && !toolbar.hasAttribute('hidden');
    });
  } finally {
    if (browser) {
      await browser.close().catch(() => {});
    }
    server.kill('SIGTERM');
    await sleep(400);
    await rm(workspace, { recursive: true, force: true }).catch(() => {});
  }
});
