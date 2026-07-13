import assert from 'node:assert/strict';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import test from 'node:test';
import { chromium } from 'playwright';

import { buildViewerHtml, findSlideFiles, inlineLocalAssetsForSrcdoc, loadSlides, parseCliArgs } from '../../scripts/build-viewer.js';

test('build-viewer CLI supports card-news mode', () => {
  assert.deepEqual(parseCliArgs([]), { slidesDir: 'slides', mode: 'presentation', help: false });
  assert.equal(parseCliArgs(['--mode', 'card-news']).mode, 'card-news');
  assert.throws(() => parseCliArgs(['--mode']), /missing value/i);
  assert.throws(() => parseCliArgs(['--mode', 'story']), /unknown --mode value/i);
});

test('buildViewerHtml uses square frame dimensions for card-news mode', () => {
  const html = buildViewerHtml([{ file: 'slide-01.html', html: '<!doctype html><html><body></body></html>' }], { slideMode: 'card-news' });

  assert.match(html, /width: 720pt;/);
  assert.match(html, /height: 720pt;/);
});

test('loadSlides keeps srcdoc base relative to generated viewer', async () => {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), 'build-viewer-relative-base-'));

  try {
    await writeFile(path.join(tempDir, 'slide-01.html'), '<!doctype html><html><body><h1>Slide</h1></body></html>');

    const [slide] = loadSlides(tempDir);

    assert.match(slide.html, /<base data-slides-grab-runtime="base" href="\.\/">/);
    assert.doesNotMatch(slide.html, /file:\/\//);
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
});

test('inlineLocalAssetsForSrcdoc inlines images but leaves local videos relative', async () => {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), 'build-viewer-inline-assets-'));

  try {
    await mkdir(path.join(tempDir, 'assets'));
    await writeFile(path.join(tempDir, 'assets', 'chart.png'), Buffer.from([0x89, 0x50, 0x4e, 0x47]));
    await writeFile(path.join(tempDir, 'assets', 'clip.mp4'), Buffer.from([0x00, 0x00, 0x00, 0x18]));
    const slidePath = path.join(tempDir, 'slide-01.html');
    const html = inlineLocalAssetsForSrcdoc(
      '<img src="./assets/chart.png"><video src="./assets/clip.mp4" poster="./assets/chart.png"></video>',
      slidePath,
    );

    assert.match(html, /<img src="data:image\/png;base64,/);
    assert.match(html, /poster="data:image\/png;base64,/);
    assert.match(html, /<video src="\.\/assets\/clip\.mp4"/);
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
});

test('built viewer executes slide chart scripts without exposing parent document access', async () => {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), 'build-viewer-chart-sandbox-'));
  let browser;

  try {
    const html = buildViewerHtml([
      {
        file: 'slide-01.html',
        html: `<!doctype html>
<html>
<body>
  <canvas id="chart" width="80" height="40"></canvas>
  <script>
    const context = document.getElementById('chart').getContext('2d');
    context.fillStyle = '#2563EB';
    context.fillRect(0, 0, 80, 40);
    window.parentAccessBlocked = false;
    try {
      parent.document.body.dataset.viewerEscaped = 'true';
    } catch {
      window.parentAccessBlocked = true;
    }
  </script>
</body>
</html>`,
      },
    ]);
    await writeFile(path.join(tempDir, 'viewer.html'), html);

    browser = await chromium.launch({ headless: true });
    const page = await browser.newPage();
    await page.goto(pathToFileURL(path.join(tempDir, 'viewer.html')).href, { waitUntil: 'load' });

    const chart = page.frameLocator('.slide-frame').first().locator('#chart');
    // The parent 'load' event can fire before the sandboxed iframe finishes
    // executing its inline paint script, so wait for the canvas to actually paint.
    await chart.evaluate((canvas) => new Promise((resolve, reject) => {
      const deadline = Date.now() + 5000;
      const check = () => {
        const painted = canvas.getContext('2d').getImageData(10, 10, 1, 1).data[3] !== 0;
        if (painted) resolve();
        else if (Date.now() > deadline) reject(new Error('canvas never painted'));
        else requestAnimationFrame(check);
      };
      check();
    }));

    const result = await chart.evaluate((canvas) => {
      const pixel = Array.from(canvas.getContext('2d').getImageData(10, 10, 1, 1).data);
      return {
        pixel,
        parentAccessBlocked: window.parentAccessBlocked,
      };
    });

    assert.deepEqual(result.pixel, [37, 99, 235, 255]);
    assert.equal(result.parentAccessBlocked, true);
    assert.equal(await page.locator('body').evaluate((body) => body.dataset.viewerEscaped), undefined);
  } finally {
    if (browser) {
      await browser.close();
    }
    await rm(tempDir, { recursive: true, force: true });
  }
});

test('findSlideFiles honors the slide-*.html deck contract and ignores viewer artifacts', async () => {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), 'build-viewer-slides-'));

  try {
    await Promise.all([
      writeFile(path.join(tempDir, 'slide-10.html'), ''),
      writeFile(path.join(tempDir, 'slide-2.html'), ''),
      writeFile(path.join(tempDir, 'slide-alpha.html'), ''),
      writeFile(path.join(tempDir, 'Slide-03.HTML'), ''),
      writeFile(path.join(tempDir, 'viewer.html'), ''),
      writeFile(path.join(tempDir, 'notes.html'), ''),
    ]);

    assert.deepEqual(findSlideFiles(tempDir), [
      'slide-2.html',
      'Slide-03.HTML',
      'slide-10.html',
      'slide-alpha.html',
    ]);
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
});
