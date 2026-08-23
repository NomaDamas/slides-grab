import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdir, mkdtemp, writeFile, rm } from 'node:fs/promises';
import os from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';
import { chromium } from 'playwright';
import { getAvailablePort } from './test-server-helpers.js';

const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const VIEWPORT = { width: 1600, height: 900 };

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function writeCardNewsSlide(workspace) {
  const slidesDir = join(workspace, 'slides');
  await mkdir(slidesDir, { recursive: true });
  await writeFile(join(slidesDir, 'slide-01.html'), `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <style>
    html, body { margin: 0; padding: 0; width: 960px; height: 960px; overflow: hidden; background: #111827; }
    .wrap { box-sizing: border-box; width: 960px; height: 960px; padding: 36px; background: #f59e0b; }
    h1 { margin: 0; font-size: 48px; color: #111827; }
    p { margin: 16px 0 0 0; font-size: 24px; color: #111827; }
  </style>
</head>
<body>
  <div class="wrap">
    <h1>CARD TOP MARKER</h1>
    <p>card-news preview clip probe</p>
  </div>
</body>
</html>`, 'utf8');
}

async function writePresentationSlide(workspace) {
  const slidesDir = join(workspace, 'slides');
  await mkdir(slidesDir, { recursive: true });
  await writeFile(join(slidesDir, 'slide-01.html'), `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <style>
    html, body { margin: 0; padding: 0; width: 960px; height: 540px; overflow: hidden; background: #111827; }
    .wrap { box-sizing: border-box; width: 960px; height: 540px; padding: 36px; background: #38bdf8; }
    h1 { margin: 0; font-size: 48px; color: #0f172a; }
  </style>
</head>
<body>
  <div class="wrap"><h1>PRESENTATION TOP MARKER</h1></div>
</body>
</html>`, 'utf8');
}

async function waitForServerReady(port, child, outputRef) {
  const started = Date.now();
  while (Date.now() - started < 20000) {
    if (child.exitCode !== null) {
      throw new Error(`server exited early: ${child.exitCode}\n${outputRef.value}`);
    }
    try {
      const res = await fetch(`http://127.0.0.1:${port}/api/config`);
      if (res.ok) return res.json();
    } catch {
      // retry until the editor binds
    }
    await sleep(150);
  }
  throw new Error(`server did not become ready\n${outputRef.value}`);
}

async function measurePreview(page, expectedFrame) {
  await page.waitForSelector('#slide-wrapper');
  await page.waitForFunction((frame) => {
    const wrapper = document.querySelector('#slide-wrapper');
    if (!wrapper) return false;
    const heightOk = wrapper.style.height === `${frame.height}px`;
    const scaled = /scale\(/.test(wrapper.style.transform || '');
    const box = wrapper.getBoundingClientRect();
    return heightOk && scaled && box.width > 0 && box.height > 0;
  }, expectedFrame);

  return page.evaluate(() => {
    const stage = document.querySelector('#slide-stage');
    const wrapper = document.querySelector('#slide-wrapper');
    const st = stage.getBoundingClientRect();
    const wr = wrapper.getBoundingClientRect();
    const origin = getComputedStyle(wrapper).transformOrigin;
    return {
      cutTop: st.y - wr.y,
      cutBottom: (wr.y + wr.height) - (st.y + st.height),
      origin,
      stage: { x: st.x, y: st.y, width: st.width, height: st.height },
      wrapper: { x: wr.x, y: wr.y, width: wr.width, height: wr.height },
      layoutHeight: wrapper.offsetHeight,
      transform: wrapper.style.transform,
    };
  });
}

async function withEditor({ prefix, mode, writeSlides, expectedFrame, screenshotName }, fn) {
  const workspace = await mkdtemp(join(os.tmpdir(), prefix));
  await writeSlides(workspace);

  const port = await getAvailablePort();
  const serverOutput = { value: '' };
  const args = [
    join(REPO_ROOT, 'scripts', 'editor-server.js'),
    '--port', String(port),
    '--mode', mode,
  ];
  const server = spawn(process.execPath, args, {
    cwd: workspace,
    env: { ...process.env, PPT_AGENT_PACKAGE_ROOT: REPO_ROOT },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  server.stdout.on('data', (chunk) => { serverOutput.value += chunk.toString(); });
  server.stderr.on('data', (chunk) => { serverOutput.value += chunk.toString(); });

  let browser;
  try {
    const config = await waitForServerReady(port, server, serverOutput);
    browser = await chromium.launch({ headless: true });
    const page = await browser.newPage({ viewport: VIEWPORT });
    await page.goto(`http://127.0.0.1:${port}/`, { waitUntil: 'domcontentloaded' });
    const metrics = await measurePreview(page, expectedFrame);

    const evidenceDir = process.env.ULW_EVIDENCE_DIR;
    if (evidenceDir) {
      await mkdir(evidenceDir, { recursive: true });
      await page.screenshot({ path: join(evidenceDir, screenshotName), fullPage: false });
      await writeFile(
        join(evidenceDir, screenshotName.replace(/\.png$/, '.json')),
        `${JSON.stringify({ mode, config, metrics, viewport: VIEWPORT }, null, 2)}\n`,
        'utf8',
      );
    }

    await fn({ config, metrics, page });
  } finally {
    if (browser) await browser.close().catch(() => {});
    server.kill('SIGTERM');
    await sleep(200);
    await rm(workspace, { recursive: true, force: true }).catch(() => {});
  }
}

test('card-news editor preview is not clipped at the top at 1600x900', { concurrency: false }, async () => {
  await withEditor({
    prefix: 'editor-card-news-clip-',
    mode: 'card-news',
    writeSlides: writeCardNewsSlide,
    expectedFrame: { width: 960, height: 960 },
    screenshotName: 'card-news-1600x900.png',
  }, async ({ config, metrics }) => {
    assert.equal(config.slideMode, 'card-news');
    assert.equal(config.framePx.width, 960);
    assert.equal(config.framePx.height, 960);
    assert.ok(
      metrics.cutTop <= 0.5,
      `card-news preview clipped at top by ${metrics.cutTop}px (origin=${metrics.origin})`,
    );
    assert.ok(
      metrics.cutBottom <= 0.5,
      `card-news preview clipped at bottom by ${metrics.cutBottom}px`,
    );
    assert.ok(Math.abs(metrics.wrapper.width - metrics.wrapper.height) < 1, 'card-news frame should stay square after scale');
  });
});

test('presentation editor preview still fits the stage at 1600x900', { concurrency: false }, async () => {
  await withEditor({
    prefix: 'editor-presentation-clip-',
    mode: 'presentation',
    writeSlides: writePresentationSlide,
    expectedFrame: { width: 960, height: 540 },
    screenshotName: 'presentation-1600x900.png',
  }, async ({ config, metrics }) => {
    assert.equal(config.slideMode, 'presentation');
    assert.equal(config.framePx.width, 960);
    assert.equal(config.framePx.height, 540);
    assert.ok(
      metrics.cutTop <= 0.5,
      `presentation preview clipped at top by ${metrics.cutTop}px (origin=${metrics.origin})`,
    );
    assert.ok(
      metrics.cutBottom <= 0.5,
      `presentation preview clipped at bottom by ${metrics.cutBottom}px`,
    );
  });
});
