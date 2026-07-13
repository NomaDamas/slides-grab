import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';

import { chromium } from 'playwright';
import { generateImageNativeSlides } from '../../src/image-native.js';
import { getAvailablePort } from './test-server-helpers.js';

const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const EDITOR_SERVER = join(REPO_ROOT, 'scripts', 'editor-server.js');

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function createHtmlWorkspace() {
  const workspace = await mkdtemp(join(os.tmpdir(), 'editor-client-html-'));
  const slidesDir = join(workspace, 'slides');
  await mkdir(slidesDir, { recursive: true });
  await writeFile(join(slidesDir, 'slide-01.html'), `<!doctype html>
<html><head><style>html,body{margin:0;width:960px;height:540px}.frame{padding:48px}h1{font-size:64px}</style></head>
<body><div class="frame"><h1>HTML editor</h1><p>Semantic slide content</p></div></body></html>`, 'utf8');
  return workspace;
}

async function createImageWorkspace() {
  const workspace = await mkdtemp(join(os.tmpdir(), 'editor-client-image-'));
  const outlinePath = join(workspace, 'slide-outline.md');
  await writeFile(outlinePath, '# Demo\n\n## Slide 1: Hero\n- Fact: image editor\n', 'utf8');
  await generateImageNativeSlides({ outlinePath, slidesDir: join(workspace, 'slides'), provider: 'dry-run' });
  return workspace;
}

function spawnEditorServer(workspace, port, editorType) {
  const output = { value: '' };
  const child = spawn(process.execPath, [EDITOR_SERVER, '--editor', editorType, '--port', String(port)], {
    cwd: workspace,
    env: { ...process.env, PPT_AGENT_PACKAGE_ROOT: REPO_ROOT },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  child.stdout.on('data', (chunk) => { output.value += chunk.toString(); });
  child.stderr.on('data', (chunk) => { output.value += chunk.toString(); });
  return { child, output };
}

async function waitForServerReady(port, child, outputRef) {
  const started = Date.now();
  while (Date.now() - started < 15_000) {
    if (child.exitCode !== null) throw new Error(`server exited early: ${child.exitCode}\n${outputRef.value}`);
    try {
      const res = await fetch(`http://localhost:${port}/api/config`);
      if (res.ok) return;
    } catch {}
    await sleep(100);
  }
  throw new Error(`server did not become ready\n${outputRef.value}`);
}

async function stopChild(child) {
  if (child.exitCode !== null) return;
  child.kill('SIGTERM');
  await new Promise((resolve) => {
    const timer = setTimeout(resolve, 4_000);
    child.once('exit', () => {
      clearTimeout(timer);
      resolve();
    });
  });
}

async function drawBbox(page) {
  const drawLayer = await page.locator('#draw-layer').boundingBox();
  assert.ok(drawLayer, 'draw layer not found');
  await page.mouse.move(drawLayer.x + drawLayer.width * 0.08, drawLayer.y + drawLayer.height * 0.08);
  await page.mouse.down();
  await page.mouse.move(drawLayer.x + drawLayer.width * 0.82, drawLayer.y + drawLayer.height * 0.48, { steps: 6 });
  await page.mouse.up();
  await page.waitForFunction(() => /1 pending/.test(document.querySelector('#bbox-count')?.textContent || ''));
}

function blockSlidesUntilReleased(page) {
  let releaseSlides = () => {};
  let markSlidesRequested = () => {};
  const gate = new Promise((resolve) => { releaseSlides = resolve; });
  const requested = new Promise((resolve) => { markSlidesRequested = resolve; });
  return {
    requested,
    releaseSlides,
    install: () => page.route('**/api/slides', async (route) => {
      markSlidesRequested();
      await gate;
      await route.continue();
    }),
  };
}

test('HTML editor configures the HTML-only surface before slides load', { concurrency: false }, async () => {
  const workspace = await createHtmlWorkspace();
  const port = await getAvailablePort();
  const server = spawnEditorServer(workspace, port, 'html');
  let browser;
  let releaseSlides = () => {};

  try {
    await waitForServerReady(port, server.child, server.output);
    browser = await chromium.launch({ headless: true });
    const page = await browser.newPage({ viewport: { width: 1600, height: 1000 } });
    const blockedSlides = blockSlidesUntilReleased(page);
    releaseSlides = blockedSlides.releaseSlides;
    await blockedSlides.install();
    await page.goto(`http://localhost:${port}/`, { waitUntil: 'domcontentloaded' });
    await blockedSlides.requested;
    await page.waitForTimeout(50);

    assert.equal(await page.locator('body').getAttribute('data-editor-type'), 'html');
    assert.equal(await page.title(), 'HTML Editor - slides-grab');
    assert.match(await page.locator('.brand').textContent(), /HTML Editor/);
    assert.equal(await page.locator('#apply-mode-select').count(), 0);
    assert.equal(await page.locator('#tool-mode-draw').isVisible(), true);
    assert.equal(await page.locator('#tool-mode-select').isVisible(), true);
    assert.equal(await page.locator('#model-section').isVisible(), true);
    assert.equal(await page.locator('#image-provider-section').isVisible(), false);
    assert.match(await page.locator('#editor-hint').textContent(), /HTML Editor/);
    assert.match(await page.locator('#btn-send').textContent(), /HTML Edit/);
  } finally {
    releaseSlides();
    if (browser) await browser.close().catch(() => {});
    await stopChild(server.child);
    await rm(workspace, { recursive: true, force: true });
  }
});

test('image editor configures the image-only surface before slides load', { concurrency: false }, async () => {
  const workspace = await createImageWorkspace();
  const port = await getAvailablePort();
  const server = spawnEditorServer(workspace, port, 'image');
  let browser;
  let releaseSlides = () => {};

  try {
    await waitForServerReady(port, server.child, server.output);
    browser = await chromium.launch({ headless: true });
    const page = await browser.newPage({ viewport: { width: 1600, height: 1000 } });
    const blockedSlides = blockSlidesUntilReleased(page);
    releaseSlides = blockedSlides.releaseSlides;
    await blockedSlides.install();
    await page.goto(`http://localhost:${port}/`, { waitUntil: 'domcontentloaded' });
    await blockedSlides.requested;
    await page.waitForTimeout(50);

    assert.equal(await page.locator('body').getAttribute('data-editor-type'), 'image');
    assert.equal(await page.title(), 'Image Editor - slides-grab');
    assert.match(await page.locator('.brand').textContent(), /Image Editor/);
    assert.equal(await page.locator('#apply-mode-select').count(), 0);
    assert.equal(await page.locator('#tool-mode-draw').isVisible(), true);
    assert.equal(await page.locator('#tool-mode-select').isVisible(), false);
    assert.equal(await page.locator('#model-section').isVisible(), false);
    assert.equal(await page.locator('#image-provider-section').isVisible(), true);
    assert.equal(await page.locator('#select-toolbar').isVisible(), false);
    assert.equal(await page.locator('#popover-apply-text').isVisible(), false);
    assert.equal(await page.locator('#toggle-bold').isVisible(), false);
    assert.match(await page.locator('#editor-hint').textContent(), /Image Editor/);
    assert.match(await page.locator('#btn-send').textContent(), /Regenerate Image/);
  } finally {
    releaseSlides();
    if (browser) await browser.close().catch(() => {});
    await stopChild(server.child);
    await rm(workspace, { recursive: true, force: true });
  }
});

test('image editor remains image-only when /api/config fails', { concurrency: false }, async () => {
  const workspace = await createImageWorkspace();
  const port = await getAvailablePort();
  const server = spawnEditorServer(workspace, port, 'image');
  let browser;

  try {
    await waitForServerReady(port, server.child, server.output);
    browser = await chromium.launch({ headless: true });
    const page = await browser.newPage({ viewport: { width: 1600, height: 1000 } });
    await page.route('**/api/config', (route) => route.fulfill({
      status: 503,
      contentType: 'application/json',
      body: JSON.stringify({ error: 'injected config failure' }),
    }));
    await page.goto(`http://localhost:${port}/`, { waitUntil: 'domcontentloaded' });
    await page.waitForFunction(() => /1\s*\/\s*1/.test(document.querySelector('#slide-counter')?.textContent || ''));

    assert.equal(await page.locator('body').getAttribute('data-editor-type'), 'image');
    assert.equal(await page.title(), 'Image Editor - slides-grab');
    assert.equal(await page.locator('#tool-mode-select').isVisible(), false);
    assert.equal(await page.locator('#model-section').isVisible(), false);
    assert.equal(await page.locator('#image-provider-section').isVisible(), true);
  } finally {
    if (browser) await browser.close().catch(() => {});
    await stopChild(server.child);
    await rm(workspace, { recursive: true, force: true });
  }
});

test('image editor sends provider-only image payloads with empty XPath targets', { concurrency: false }, async () => {
  const workspace = await createImageWorkspace();
  const port = await getAvailablePort();
  const server = spawnEditorServer(workspace, port, 'image');
  let browser;

  try {
    await waitForServerReady(port, server.child, server.output);
    browser = await chromium.launch({ headless: true });
    const page = await browser.newPage({ viewport: { width: 1600, height: 1000 } });
    const capturedBodies = [];
    await page.route('**/api/apply', async (route) => {
      capturedBodies.push(JSON.parse(route.request().postData() || '{}'));
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ success: true, runId: 'image-client-run', mode: 'image', message: 'ok' }),
      });
    });
    await page.goto(`http://localhost:${port}/`, { waitUntil: 'domcontentloaded' });
    await page.waitForFunction(() => /1\s*\/\s*1/.test(document.querySelector('#slide-counter')?.textContent || ''));

    if (await page.locator('#apply-mode-select').count()) {
      await page.selectOption('#apply-mode-select', 'image');
    }
    await page.selectOption('#image-provider-select', 'nano-banana');
    await drawBbox(page);
    await page.fill('#prompt-input', 'Regenerate this image region.');
    await page.click('#btn-send');
    await page.waitForFunction(() => /ok/i.test(document.querySelector('#status-message')?.textContent || ''));

    assert.equal(capturedBodies.length, 1);
    assert.deepEqual({
      mode: capturedBodies[0].mode,
      provider: capturedBodies[0].provider,
      hasModel: 'model' in capturedBodies[0],
      targets: capturedBodies[0].selections[0].targets,
    }, {
      mode: 'image',
      provider: 'nano-banana',
      hasModel: false,
      targets: [],
    });
  } finally {
    if (browser) await browser.close().catch(() => {});
    await stopChild(server.child);
    await rm(workspace, { recursive: true, force: true });
  }
});
