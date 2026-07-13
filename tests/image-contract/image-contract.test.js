import assert from 'node:assert/strict';
import { copyFile, mkdir, mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { spawn, spawnSync } from 'node:child_process';
import { createServer } from 'node:net';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { chromium } from 'playwright';
import { PDFDocument } from 'pdf-lib';

import { buildViewerHtml, loadSlides } from '../../scripts/build-viewer.js';
import { parseCliArgs as parseValidateCliArgs } from '../../scripts/validate-slides.js';
import {
  LOCAL_ASSET_PREFIX,
  buildSlideRuntimeHtml,
  classifyImageSource,
  extractCssUrls,
} from '../../src/image-contract.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const FIXTURES_DIR = path.join(__dirname, '..', 'fixtures', 'image-contract');
const REPO_ROOT = path.join(__dirname, '..', '..');

function fixturePath(name) {
  return path.join(FIXTURES_DIR, name);
}

function runNodeScript(relativePath, args = [], cwd = REPO_ROOT, env = process.env) {
  return new Promise((resolvePromise, rejectPromise) => {
    const child = spawn(process.execPath, [path.join(REPO_ROOT, relativePath), ...args], {
      cwd,
      env,
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (chunk) => {
      stdout += chunk.toString();
    });
    child.stderr.on('data', (chunk) => {
      stderr += chunk.toString();
    });
    child.on('error', rejectPromise);
    child.on('close', (code) => {
      resolvePromise({ code: code ?? 1, stdout, stderr });
    });
  });
}

function canEncodeVideoFixtures() {
  const probe = spawnSync('ffmpeg', ['-version'], { encoding: 'utf8' });
  if (probe.error?.code === 'ENOENT') {
    return false;
  }
  return probe.status === 0;
}

function runFfmpeg(args) {
  return new Promise((resolvePromise, rejectPromise) => {
    const child = spawn('ffmpeg', args, {
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    let stderr = '';
    child.stderr.on('data', (chunk) => {
      stderr += chunk.toString();
    });
    child.on('error', rejectPromise);
    child.on('close', (code) => {
      if (code === 0) {
        resolvePromise();
        return;
      }
      rejectPromise(new Error(`ffmpeg failed (${code})\n${stderr}`));
    });
  });
}

async function createVideoFixtureDeck(workspace, {
  videoSrc = './assets/example.mp4',
  posterSrc = './assets/poster.svg',
  createVideoAsset = true,
  sourceTags = [],
} = {}) {
  const slidesDir = path.join(workspace, 'slides');
  const assetsDir = path.join(slidesDir, 'assets');
  await mkdir(assetsDir, { recursive: true });

  if (createVideoAsset) {
    await runFfmpeg([
      '-y',
      '-f',
      'lavfi',
      '-i',
      'color=c=red:s=160x90:d=1',
      '-pix_fmt',
      'yuv420p',
      path.join(assetsDir, 'example.mp4'),
    ]);
  }

  await writeFile(
    path.join(assetsDir, 'poster.svg'),
    [
      '<svg xmlns="http://www.w3.org/2000/svg" width="160" height="90" viewBox="0 0 160 90">',
      '  <rect width="160" height="90" fill="#1D4ED8"/>',
      '</svg>',
    ].join('\n'),
    'utf8',
  );

  const sourceHtml = sourceTags
    .map((source) => `    <source src="${source}" type="video/mp4">`)
    .join('\n');

  await writeFile(
    path.join(slidesDir, 'slide-01.html'),
    `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <style>
    html, body { margin: 0; padding: 0; background: #111827; }
    body {
      width: 960px;
      height: 540px;
      overflow: hidden;
      display: flex;
      align-items: center;
      justify-content: center;
    }
    video {
      width: 480px;
      height: 270px;
      display: block;
      background: #000;
    }
  </style>
</head>
<body>
  <video controls poster="${posterSrc}" src="${videoSrc}">
${sourceHtml}
  </video>
</body>
</html>`,
    'utf8',
  );

  return slidesDir;
}

function findAvailablePort() {
  return new Promise((resolvePromise, rejectPromise) => {
    const server = createServer();
    server.once('error', rejectPromise);
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      if (!address || typeof address === 'string') {
        server.close(() => rejectPromise(new Error('Failed to allocate a test port.')));
        return;
      }

      const { port } = address;
      server.close((error) => {
        if (error) {
          rejectPromise(error);
          return;
        }
        resolvePromise(port);
      });
    });
  });
}
async function waitForServer(port, processRef, outputRef) {
  const started = Date.now();

  while (Date.now() - started < 15000) {
    if (processRef.exitCode !== null) {
      throw new Error(`editor server exited early: ${processRef.exitCode}\n${outputRef.value}`);
    }

    try {
      const response = await fetch(`http://127.0.0.1:${port}/api/slides`);
      if (response.ok) return;
    } catch {
      // retry
    }

    await new Promise((resolvePromise) => setTimeout(resolvePromise, 150));
  }

  throw new Error(`editor server did not become ready\n${outputRef.value}`);
}

test('image contract helpers classify supported and discouraged sources', () => {
  assert.equal(LOCAL_ASSET_PREFIX, './assets/');
  assert.deepEqual(extractCssUrls('url("./assets/a.png"), url(https://example.com/b.png)'), [
    './assets/a.png',
    'https://example.com/b.png',
  ]);
  assert.deepEqual(classifyImageSource('./assets/example.svg'), { kind: 'local-asset-path' });
  assert.deepEqual(classifyImageSource('../shared/logo.png'), { kind: 'noncanonical-relative-path' });
  assert.deepEqual(classifyImageSource('/Users/demo/Desktop/photo.png'), { kind: 'absolute-filesystem-path' });
  assert.deepEqual(classifyImageSource('/assets/example.svg'), { kind: 'root-relative-path' });
  assert.deepEqual(classifyImageSource('blob:https://example.com/demo'), { kind: 'other-scheme' });
});

test('buildSlideRuntimeHtml injects base href and runtime diagnostics', () => {
  const html = buildSlideRuntimeHtml('<html><head></head><body><img src="./assets/example.svg"></body></html>', {
    baseHref: 'file:///tmp/deck/',
    slideFile: 'slide-01.html',
  });

  assert.match(html, /<base data-slides-grab-runtime="base" href="file:\/\/\/tmp\/deck\/">/);
  assert.match(html, /<script data-slides-grab-runtime="diagnostics">/);
  assert.match(html, /\[slides-grab:image\]/);
  assert.match(html, /missing local asset/);
});

test('build-viewer injects slide runtime html for local assets', () => {
  const slides = loadSlides(fixturePath('positive-local-asset'));
  const viewerHtml = buildViewerHtml(slides);

  assert.equal(slides.length, 1);
  assert.match(slides[0].html, /<base data-slides-grab-runtime="base" href="\.\//);
  assert.match(viewerHtml, /srcdoc="/);
  assert.match(viewerHtml, /\[slides-grab:image\]/);
});

test('validator CLI args still parse slides-dir', () => {
  assert.deepEqual(parseValidateCliArgs(['--slides-dir', 'decks/demo']), {
    slidesDir: 'decks/demo',
    format: 'concise',
    mode: 'presentation',
    help: false,
    slides: [],
  });
});

test('validate passes for the canonical ./assets contract fixture', async () => {
  const result = await runNodeScript('scripts/validate-slides.js', ['--slides-dir', fixturePath('positive-local-asset'), '--format', 'json-full']);
  assert.equal(result.code, 0, result.stderr || result.stdout);

  const report = JSON.parse(result.stdout);
  assert.equal(report.summary.failedSlides, 0);
  assert.equal(report.summary.passedSlides, 1);
  assert.equal(report.slides[0].summary.criticalCount, 0);
});

test('validate passes for body background-image with canonical ./assets URL', async () => {
  const result = await runNodeScript('scripts/validate-slides.js', ['--slides-dir', fixturePath('body-background-local-asset'), '--format', 'json-full']);
  assert.equal(result.code, 0, result.stderr || result.stdout);

  const report = JSON.parse(result.stdout);
  assert.equal(report.summary.failedSlides, 0);
  assert.equal(report.slides[0].summary.criticalCount, 0);
});
test('validate reports missing local assets and discouraged path forms', async () => {
  const missing = await runNodeScript('scripts/validate-slides.js', ['--slides-dir', fixturePath('missing-local-asset'), '--format', 'json-full']);
  assert.equal(missing.code, 1);
  const missingReport = JSON.parse(missing.stdout);
  assert.equal(missingReport.slides[0].critical.some((issue) => issue.code === 'missing-local-asset'), true);

  const remoteOnly = await runNodeScript('scripts/validate-slides.js', ['--slides-dir', fixturePath('remote-only-asset'), '--format', 'json-full']);
  assert.equal(remoteOnly.code, 1);
  const remoteOnlyReport = JSON.parse(remoteOnly.stdout);
  assert.equal(remoteOnlyReport.slides[0].critical.some((issue) => issue.code === 'remote-image-url'), true);

  const unsupported = await runNodeScript('scripts/validate-slides.js', ['--slides-dir', fixturePath('unsupported-paths'), '--format', 'json-full']);
  assert.equal(unsupported.code, 1);
  const unsupportedReport = JSON.parse(unsupported.stdout);
  assert.equal(unsupportedReport.slides[0].critical.some((issue) => issue.code === 'absolute-filesystem-image-path'), true);
  assert.equal(unsupportedReport.slides[0].critical.some((issue) => issue.code === 'root-relative-image-path'), true);
  assert.equal(unsupportedReport.slides[0].warning.some((issue) => issue.code === 'noncanonical-relative-image-path'), true);
  assert.equal(unsupportedReport.slides[0].critical.some((issue) => issue.code === 'remote-image-url'), true);
  assert.equal(unsupportedReport.slides[0].critical.some((issue) => issue.code === 'unsupported-background-image'), true);
});

test('validate passes for canonical local video assets under ./assets', async (t) => {
  if (!canEncodeVideoFixtures()) {
    return t.skip('ffmpeg is required for video fixture generation');
  }

  const workspace = await mkdtemp(path.join(os.tmpdir(), 'slides-grab-video-contract-pass-'));

  try {
    const slidesDir = await createVideoFixtureDeck(workspace);
    const result = await runNodeScript('scripts/validate-slides.js', ['--slides-dir', slidesDir, '--format', 'json-full']);
    assert.equal(result.code, 0, result.stderr || result.stdout);

    const report = JSON.parse(result.stdout);
    assert.equal(report.summary.failedSlides, 0);
    assert.equal(report.slides[0].summary.criticalCount, 0);
  } finally {
    await rm(workspace, { recursive: true, force: true }).catch(() => {});
  }
});

test('validate and html2pdf block unsupported video asset paths', async (t) => {
  if (!canEncodeVideoFixtures()) {
    return t.skip('ffmpeg is required for video fixture generation');
  }

  const workspace = await mkdtemp(path.join(os.tmpdir(), 'slides-grab-video-contract-fail-'));

  try {
    const missingSlidesDir = await createVideoFixtureDeck(path.join(workspace, 'missing'), {
      createVideoAsset: false,
    });
    const missing = await runNodeScript('scripts/validate-slides.js', ['--slides-dir', missingSlidesDir, '--format', 'json-full']);
    assert.equal(missing.code, 1);
    const missingReport = JSON.parse(missing.stdout);
    assert.equal(missingReport.slides[0].critical.some((issue) => issue.code === 'missing-local-video-asset'), true);

    const remoteSlidesDir = await createVideoFixtureDeck(path.join(workspace, 'remote'), {
      videoSrc: 'https://example.com/demo.mp4',
    });
    const remote = await runNodeScript('scripts/validate-slides.js', ['--slides-dir', remoteSlidesDir, '--format', 'json-full']);
    assert.equal(remote.code, 1);
    const remoteReport = JSON.parse(remote.stdout);
    assert.equal(remoteReport.slides[0].critical.some((issue) => issue.code === 'remote-video-url'), true);

    const mixedSlidesDir = await createVideoFixtureDeck(path.join(workspace, 'mixed-src-source'), {
      videoSrc: 'https://example.com/direct.mp4',
      sourceTags: ['./assets/example.mp4'],
    });
    const mixed = await runNodeScript('scripts/validate-slides.js', ['--slides-dir', mixedSlidesDir, '--format', 'json-full']);
    assert.equal(mixed.code, 1);
    const mixedReport = JSON.parse(mixed.stdout);
    assert.equal(mixedReport.slides[0].critical.some((issue) => issue.code === 'remote-video-url'), true);

    const blobSlidesDir = await createVideoFixtureDeck(path.join(workspace, 'blob'), {
      videoSrc: 'blob:https://example.com/demo',
    });
    const blob = await runNodeScript('scripts/validate-slides.js', ['--slides-dir', blobSlidesDir, '--format', 'json-full']);
    assert.equal(blob.code, 1);
    const blobReport = JSON.parse(blob.stdout);
    assert.equal(blobReport.slides[0].critical.some((issue) => issue.code === 'unsupported-video-url-scheme'), true);

    const blocked = await runNodeScript('scripts/html2pdf.js', ['--slides-dir', remoteSlidesDir, '--output', path.join(workspace, 'blocked.pdf')]);
    assert.equal(blocked.code, 1);
    assert.match(blocked.stderr, /remote-video-url/);

    const blockedBlob = await runNodeScript('scripts/html2pdf.js', ['--slides-dir', blobSlidesDir, '--output', path.join(workspace, 'blocked-blob.pdf')]);
    assert.equal(blockedBlob.code, 1);
    assert.match(blockedBlob.stderr, /unsupported-video-url-scheme/);

    const blobPosterSlidesDir = await createVideoFixtureDeck(path.join(workspace, 'blob-poster'), {
      posterSrc: 'blob:https://example.com/poster',
    });
    const blobPoster = await runNodeScript('scripts/validate-slides.js', ['--slides-dir', blobPosterSlidesDir, '--format', 'json-full']);
    assert.equal(blobPoster.code, 1);
    const blobPosterReport = JSON.parse(blobPoster.stdout);
    assert.equal(blobPosterReport.slides[0].critical.some((issue) => issue.code === 'unsupported-image-url-scheme'), true);

    const blockedBlobPoster = await runNodeScript('scripts/html2pdf.js', ['--slides-dir', blobPosterSlidesDir, '--output', path.join(workspace, 'blocked-blob-poster.pdf')]);
    assert.equal(blockedBlobPoster.code, 1);
    assert.match(blockedBlobPoster.stderr, /unsupported-image-url-scheme/);
  } finally {
    await rm(workspace, { recursive: true, force: true }).catch(() => {});
  }
});

test('html2pdf exports the canonical ./assets fixture and blocks invalid decks in preflight', async () => {
  const workspace = await mkdtemp(path.join(os.tmpdir(), 'slides-grab-image-contract-pdf-'));
  const outputPath = path.join(workspace, 'deck.pdf');

  try {
    const success = await runNodeScript('scripts/html2pdf.js', ['--slides-dir', fixturePath('positive-local-asset'), '--output', outputPath]);
    assert.equal(success.code, 0, success.stderr || success.stdout);

    const info = await stat(outputPath);
    assert.ok(info.size > 0);
    const pdfDoc = await PDFDocument.load(await readFile(outputPath));
    assert.equal(pdfDoc.getPageCount(), 1);

    const blocked = await runNodeScript('scripts/html2pdf.js', ['--slides-dir', fixturePath('missing-local-asset'), '--output', outputPath]);
    assert.equal(blocked.code, 1);
    assert.match(blocked.stderr, /PDF export blocked by slide validation/i);
    assert.match(blocked.stderr, /missing-local-asset/);

    const blockedRootRelative = await runNodeScript('scripts/html2pdf.js', ['--slides-dir', fixturePath('unsupported-paths'), '--output', outputPath]);
    assert.equal(blockedRootRelative.code, 1);
    assert.match(blockedRootRelative.stderr, /root-relative-image-path/);

    const blockedRemote = await runNodeScript('scripts/html2pdf.js', ['--slides-dir', fixturePath('remote-only-asset'), '--output', outputPath]);
    assert.equal(blockedRemote.code, 1);
    assert.match(blockedRemote.stderr, /remote-image-url/);
  } finally {
    await rm(workspace, { recursive: true, force: true }).catch(() => {});
  }
});

test('built viewer loads ./assets images inside srcdoc slides', { concurrency: false }, async () => {
  const fixtureDir = fixturePath('positive-local-asset');
  const viewerPath = path.join(fixtureDir, 'viewer.html');

  let browser;
  try {
    const buildResult = await runNodeScript('scripts/build-viewer.js', ['--slides-dir', fixtureDir]);
    assert.equal(buildResult.code, 0, buildResult.stderr || buildResult.stdout);

    browser = await chromium.launch({ headless: true });
    const page = await browser.newPage();
    await page.goto(pathToFileURL(viewerPath).href, { waitUntil: 'load' });

    const frame = page.frameLocator('.slide-frame').first();
    await frame.locator('#hero').waitFor();
    const naturalWidth = await frame.locator('#hero').evaluate((img) => img.naturalWidth);
    assert.ok(naturalWidth > 0);
  } finally {
    if (browser) {
      await browser.close();
    }
    await rm(viewerPath, { force: true }).catch(() => {});
  }
});

test('editor server serves canonical local assets under /slides/assets', { concurrency: false }, async () => {
  const workspace = await mkdtemp(path.join(os.tmpdir(), 'slides-grab-editor-assets-'));
  const slidesDir = path.join(workspace, 'slides');
  const sourceDir = fixturePath('positive-local-asset');
  const port = await findAvailablePort();

  await mkdir(path.join(slidesDir, 'assets'), { recursive: true });
  await copyFile(path.join(sourceDir, 'slide-01.html'), path.join(slidesDir, 'slide-01.html'));
  await copyFile(path.join(sourceDir, 'assets', 'example.svg'), path.join(slidesDir, 'assets', 'example.svg'));

  const output = { value: '' };
  const server = spawn(process.execPath, [path.join(REPO_ROOT, 'scripts', 'editor-server.js'), '--port', String(port)], {
    cwd: workspace,
    env: {
      ...process.env,
      PPT_AGENT_PACKAGE_ROOT: REPO_ROOT,
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  server.stdout.on('data', (chunk) => {
    output.value += chunk.toString();
  });
  server.stderr.on('data', (chunk) => {
    output.value += chunk.toString();
  });

  let browser;
  try {
    await waitForServer(port, server, output);

    const assetResponse = await fetch(`http://127.0.0.1:${port}/slides/assets/example.svg`);
    assert.equal(assetResponse.ok, true);

    browser = await chromium.launch({ headless: true });
    const page = await browser.newPage();
    await page.goto(`http://127.0.0.1:${port}/slides/slide-01.html`, { waitUntil: 'load' });
    const naturalWidth = await page.locator('#hero').evaluate((img) => img.naturalWidth);
    assert.ok(naturalWidth > 0);

    const servedHtml = await readFile(path.join(slidesDir, 'slide-01.html'), 'utf8');
    assert.doesNotMatch(servedHtml, /<base href="\/slides\/">/);
  } finally {
    if (browser) {
      await browser.close().catch(() => {});
    }
    server.kill('SIGTERM');
    await rm(workspace, { recursive: true, force: true }).catch(() => {});
  }
});
