import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import test from 'node:test';
import { chromium } from 'playwright';
import sharp from 'sharp';

import { buildViewerHtml, loadSlides } from '../../scripts/build-viewer.js';
import { renderSlideToPdf } from '../../scripts/html2pdf.js';
import { createPassAReport, createPassBReport } from '../helpers/design-gate-fixtures.js';
import { designGateArgs, runSlidesGrabCli } from '../helpers/design-gate-cli.js';
import { extractZipEntry } from '../helpers/figma-fixtures.js';

const REPO_ROOT = path.resolve(import.meta.dirname, '../..');
const ACTIVE_CLASS = 'slides-grab-motion-active';

function viewerSlideHtml(label) {
  return `<!doctype html>
<html>
<head>
  <meta charset="utf-8">
  <style>
    @keyframes motion-contract-pulse {
      from { opacity: 0.8; }
      to { opacity: 1; }
    }
    [data-motion-root].${ACTIVE_CLASS} {
      animation: motion-contract-pulse 40ms linear;
    }
  </style>
</head>
<body>
  <div data-motion-root>
    <p>${label}</p>
  </div>
  <script>
    const root = document.querySelector('[data-motion-root]');
    root.dataset.animationStarts = '0';
    root.addEventListener('animationstart', () => {
      root.dataset.animationStarts = String(Number(root.dataset.animationStarts) + 1);
    });
  </script>
</body>
</html>`;
}

function staticExportSlideHtml() {
  return `<!doctype html>
<html>
<head>
  <meta charset="utf-8">
  <style>
    html.dynamic-at-load body { background: #ff0000; }
    html.static-at-load body { background: #00ff00; }
    html, body { width: 720pt; height: 405pt; margin: 0; overflow: hidden; }
  </style>
  <script>
    const mode = document.documentElement.dataset.motion || 'dynamic';
    document.documentElement.dataset.motionAtLoad = mode;
    document.documentElement.classList.add(mode + '-at-load');
  </script>
</head>
<body>
  <div data-motion-root>
    <h1>Static export contract</h1>
  </div>
</body>
</html>`;
}

function reducedMotionSlideHtml() {
  return `<!doctype html>
<html>
<head>
  <meta charset="utf-8">
  <style>
    @keyframes motion-contract-loop {
      from { transform: translateX(0); }
      to { transform: translateX(100px); }
    }
    [data-motion-root] { animation: motion-contract-loop 10s linear infinite; }
  </style>
</head>
<body>
  <div data-motion-root>
    <p>Reduced motion</p>
  </div>
</body>
</html>`;
}

async function waitForMotionState(locator, active, minimumStarts) {
  await locator.evaluate((root, expected) => new Promise((resolve, reject) => {
    const deadline = Date.now() + 5000;
    const check = () => {
      const hasActiveClass = root.classList.contains(expected.activeClass);
      const starts = Number(root.dataset.animationStarts || 0);
      if (hasActiveClass === expected.active && starts >= expected.minimumStarts) {
        resolve();
      } else if (Date.now() > deadline) {
        reject(new Error(`motion state did not settle: active=${hasActiveClass}, starts=${starts}`));
      } else {
        requestAnimationFrame(check);
      }
    };
    check();
  }), { active, activeClass: ACTIVE_CLASS, minimumStarts });
}

async function centerPixel(pngBytes) {
  const { data, info } = await sharp(pngBytes).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  const offset = (Math.floor(info.height / 2) * info.width + Math.floor(info.width / 2)) * info.channels;
  return Array.from(data.subarray(offset, offset + 4));
}

function extractSlideImage(pptxBytes) {
  const relationships = extractZipEntry(
    pptxBytes,
    'ppt/slides/_rels/slide1.xml.rels',
  ).toString('utf-8');
  const imageName = relationships.match(/Target="\.\.\/media\/([^\"]+)"/)?.[1];
  assert.ok(imageName, 'slide image relationship is missing');
  return extractZipEntry(pptxBytes, `ppt/media/${imageName}`);
}

async function writeStaticDeck(root) {
  const slidesDir = path.join(root, 'slides');
  await mkdir(slidesDir, { recursive: true });
  await writeFile(path.join(slidesDir, 'slide-01.html'), staticExportSlideHtml());
  return slidesDir;
}

test('viewer activates only the current slide and restarts motion on re-entry', { concurrency: false }, async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'slides-grab-motion-viewer-'));
  const slidesDir = path.join(root, 'slides');
  let browser;

  try {
    await mkdir(slidesDir);
    await Promise.all([
      writeFile(path.join(slidesDir, 'slide-01.html'), viewerSlideHtml('First')),
      writeFile(path.join(slidesDir, 'slide-02.html'), viewerSlideHtml('Second')),
    ]);
    await writeFile(path.join(slidesDir, 'viewer.html'), buildViewerHtml(loadSlides(slidesDir)));

    browser = await chromium.launch({ headless: true });
    const page = await browser.newPage();
    await page.goto(pathToFileURL(path.join(slidesDir, 'viewer.html')).href, { waitUntil: 'load' });

    const first = page.frameLocator('.slide-frame').nth(0).locator('[data-motion-root]');
    const second = page.frameLocator('.slide-frame').nth(1).locator('[data-motion-root]');
    await waitForMotionState(first, true, 1);
    await waitForMotionState(second, false, 0);

    await page.locator('#btn-next').click();
    await waitForMotionState(first, false, 1);
    await waitForMotionState(second, true, 1);

    await page.locator('#btn-prev').click();
    await waitForMotionState(first, true, 2);
    await waitForMotionState(second, false, 1);
  } finally {
    if (browser) await browser.close();
    await rm(root, { recursive: true, force: true });
  }
});

test('viewer keeps the complete static state when reduced motion is requested', { concurrency: false }, async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'slides-grab-motion-reduced-'));
  const slidesDir = path.join(root, 'slides');
  let browser;

  try {
    await mkdir(slidesDir);
    await writeFile(path.join(slidesDir, 'slide-01.html'), reducedMotionSlideHtml());
    await writeFile(path.join(slidesDir, 'viewer.html'), buildViewerHtml(loadSlides(slidesDir)));

    browser = await chromium.launch({ headless: true });
    const context = await browser.newContext({ reducedMotion: 'reduce' });
    const page = await context.newPage();
    await page.goto(pathToFileURL(path.join(slidesDir, 'viewer.html')).href, { waitUntil: 'load' });

    const motionRoot = page.frameLocator('.slide-frame').locator('[data-motion-root]');
    await motionRoot.waitFor();
    assert.equal(
      await motionRoot.evaluate((element) => getComputedStyle(element).animationName),
      'none',
    );
  } finally {
    if (browser) await browser.close();
    await rm(root, { recursive: true, force: true });
  }
});

test('PNG export enters static motion mode before slide JavaScript runs', { concurrency: false }, async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'slides-grab-motion-png-'));

  try {
    const slidesDir = await writeStaticDeck(root);
    const outputDir = path.join(root, 'png');
    execFileSync(process.execPath, [
      'scripts/html2png.js',
      '--slides-dir', slidesDir,
      '--output-dir', outputDir,
      '--resolution', '720p',
    ], { cwd: REPO_ROOT, stdio: 'pipe' });

    assert.deepEqual(await centerPixel(await readFile(path.join(outputDir, 'slide-01.png'))), [0, 255, 0, 255]);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('PDF capture enters static motion mode before slide JavaScript runs', { concurrency: false }, async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'slides-grab-motion-pdf-'));
  let browser;

  try {
    const slidesDir = await writeStaticDeck(root);
    browser = await chromium.launch({ headless: true });
    const page = await browser.newPage();
    const result = await renderSlideToPdf(page, 'slide-01.html', slidesDir, {
      mode: 'capture',
      resolution: '720p',
    });

    assert.equal(await page.evaluate(() => document.documentElement.dataset.motionAtLoad), 'static');
    assert.deepEqual(await centerPixel(result.pngBytes), [0, 255, 0, 255]);
  } finally {
    if (browser) await browser.close();
    await rm(root, { recursive: true, force: true });
  }
});

test('raster PPTX export captures the static final state', { concurrency: false }, async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'slides-grab-motion-pptx-'));

  try {
    const slidesDir = await writeStaticDeck(root);
    const outputPath = path.join(root, 'motion.pptx');
    const passAPath = path.join(root, 'pass-a.md');
    const passBPath = path.join(root, 'pass-b.md');
    await writeFile(passAPath, createPassAReport(slidesDir));
    await writeFile(passBPath, createPassBReport(slidesDir));
    runSlidesGrabCli(designGateArgs(slidesDir, passAPath, passBPath));
    runSlidesGrabCli([
      'convert',
      '--slides-dir', slidesDir,
      '--output', outputPath,
      '--engine', 'raster',
      '--resolution', '720p',
    ]);

    const slideImage = extractSlideImage(await readFile(outputPath));
    assert.deepEqual(await centerPixel(slideImage), [0, 255, 0, 255]);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
