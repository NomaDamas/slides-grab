import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import PptxGenJS from 'pptxgenjs';

import { createPassAReport, createPassBReport } from '../helpers/design-gate-fixtures.js';
import { extractZipEntry } from '../helpers/figma-fixtures.js';
import { createSlideHtml, designGateArgs, runSlidesGrabCli, writeDeck } from '../helpers/design-gate-cli.js';

const require = createRequire(import.meta.url);
const html2pptx = require('../../src/html2pptx.cjs');
const { launchBrowser } = html2pptx;

test('convert rejects unknown export engines', () => {
  const result = spawnSync(
    process.execPath,
    ['bin/ppt-agent.js', 'convert', '--engine', 'typo'],
    { cwd: process.cwd(), encoding: 'utf-8' },
  );

  assert.equal(result.status, 1);
  assert.match(result.stderr, /argument 'typo' is invalid/i);
  assert.match(result.stderr, /raster, text/i);
});

test('text engine rejects raster-only resolution options', () => {
  const result = spawnSync(
    process.execPath,
    ['bin/ppt-agent.js', 'convert', '--engine', 'text', '--resolution', '720p'],
    { cwd: process.cwd(), encoding: 'utf-8' },
  );

  assert.equal(result.status, 1);
  assert.match(result.stderr, /resolution can only be used with --engine raster/i);
});

test('convert preserves raster as the default and routes text to editable PowerPoint output', () => {
  const root = mkdtempSync(join(tmpdir(), 'slides-grab-text-convert-'));
  const slidesDir = join(root, 'slides');
  const defaultRasterPath = join(root, 'default-raster.pptx');
  const explicitRasterPath = join(root, 'explicit-raster.pptx');
  const textPath = join(root, 'editable.pptx');
  const passAPath = join(root, 'pass-a.md');
  const passBPath = join(root, 'pass-b.md');

  try {
    writeDeck(slidesDir, 'Editable Text Engine');
    writeFileSync(passAPath, createPassAReport(slidesDir), 'utf-8');
    writeFileSync(passBPath, createPassBReport(slidesDir), 'utf-8');
    runSlidesGrabCli(designGateArgs(slidesDir, passAPath, passBPath));

    runSlidesGrabCli(['convert', '--slides-dir', slidesDir, '--output', defaultRasterPath]);
    runSlidesGrabCli(['convert', '--slides-dir', slidesDir, '--output', explicitRasterPath, '--engine', 'raster']);
    runSlidesGrabCli(['convert', '--slides-dir', slidesDir, '--output', textPath, '--engine', 'text']);

    for (const rasterPath of [defaultRasterPath, explicitRasterPath]) {
      assert.equal(existsSync(rasterPath), true);
      const slideXml = extractZipEntry(readFileSync(rasterPath), 'ppt/slides/slide1.xml').toString('utf-8');
      assert.match(slideXml, /<p:pic>/);
      assert.doesNotMatch(slideXml, /<a:t>Editable Text Engine<\/a:t>/);
    }

    assert.equal(existsSync(textPath), true);
    const textPptxBytes = readFileSync(textPath);
    const slideXml = extractZipEntry(textPptxBytes, 'ppt/slides/slide1.xml').toString('utf-8');
    const presentationXml = extractZipEntry(textPptxBytes, 'ppt/presentation.xml').toString('utf-8');

    assert.match(slideXml, /<a:t>Editable Text Engine<\/a:t>/);
    assert.match(slideXml, /sz="3200"/);
    assert.doesNotMatch(slideXml, /<p:pic>/);
    assert.match(presentationXml, /cx="12188952"/);
    assert.match(presentationXml, /cy="6858000"/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('text engine keeps the design gate precondition', () => {
  const root = mkdtempSync(join(tmpdir(), 'slides-grab-text-gate-'));
  const slidesDir = join(root, 'slides');
  const outputPath = join(root, 'blocked.pptx');

  try {
    writeDeck(slidesDir, 'Missing Gate');
    const result = spawnSync(
      process.execPath,
      ['bin/ppt-agent.js', 'convert', '--slides-dir', slidesDir, '--output', outputPath, '--engine', 'text'],
      { cwd: process.cwd(), encoding: 'utf-8' },
    );

    assert.equal(result.status, 1);
    assert.match(result.stderr, /design[- ]gate/i);
    assert.equal(existsSync(outputPath), false);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('text engine supports the repo-standard card-news frame', () => {
  const root = mkdtempSync(join(tmpdir(), 'slides-grab-text-card-news-'));
  const slidesDir = join(root, 'slides');
  const outputPath = join(root, 'card-news.pptx');
  const passAPath = join(root, 'pass-a.md');
  const passBPath = join(root, 'pass-b.md');

  try {
    writeDeck(slidesDir, 'Editable Card News');
    writeFileSync(
      join(slidesDir, 'slide-01.html'),
      createSlideHtml('Editable Card News').replace('height: 405pt;', 'height: 720pt;'),
      'utf-8',
    );
    writeFileSync(passAPath, createPassAReport(slidesDir), 'utf-8');
    writeFileSync(passBPath, createPassBReport(slidesDir), 'utf-8');
    runSlidesGrabCli([
      ...designGateArgs(slidesDir, passAPath, passBPath),
      '--slide-mode',
      'card-news',
    ]);

    runSlidesGrabCli([
      'convert',
      '--slides-dir',
      slidesDir,
      '--output',
      outputPath,
      '--mode',
      'card-news',
      '--engine',
      'text',
    ]);

    const pptxBytes = readFileSync(outputPath);
    const slideXml = extractZipEntry(pptxBytes, 'ppt/slides/slide1.xml').toString('utf-8');
    const presentationXml = extractZipEntry(pptxBytes, 'ppt/presentation.xml').toString('utf-8');
    assert.match(slideXml, /<a:t>Editable Card News<\/a:t>/);
    assert.match(presentationXml, /cx="9144000"/);
    assert.match(presentationXml, /cy="9144000"/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('text engine omits visually hidden content and does not forward slide console output', () => {
  const root = mkdtempSync(join(tmpdir(), 'slides-grab-text-hidden-'));
  const slidesDir = join(root, 'slides');
  const outputPath = join(root, 'hidden-content.pptx');
  const passAPath = join(root, 'pass-a.md');
  const passBPath = join(root, 'pass-b.md');

  try {
    writeDeck(slidesDir, 'Visible Content');
    const html = createSlideHtml('Visible Content').replace(
      '</body>',
      `<p style="position: absolute; top: 0; left: 0; visibility: hidden">VISIBILITY_HIDDEN_MARKER</p>
  <p style="position: absolute; top: 0; left: 0; opacity: 0">OPACITY_HIDDEN_MARKER</p>
  <p style="position: absolute; top: 0; left: 0; color: rgba(0, 0, 0, 0)">TRANSPARENT_TEXT_MARKER</p>
  <img style="position: absolute; top: 0; left: 0; opacity: 0" alt="HIDDEN_IMAGE_MARKER" src="data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Y9Z7mAAAAAASUVORK5CYII=">
  <p style="position: absolute; top: 100pt; left: 100pt; width: 400pt; overflow: hidden; word-break: break-all"><span style="display: none">NESTED_DISPLAY_MARKER</span><span style="visibility: hidden">NESTED_VISIBILITY_MARKER</span><span style="opacity: 0">NESTED_OPACITY_MARKER</span><span style="color: rgba(0, 0, 0, 0)">NESTED_TRANSPARENT_MARKER</span><small style="display: none">NESTED_SMALL_MARKER</small><a style="visibility: hidden">NESTED_LINK_MARKER</a></p>
  <ul style="position: absolute; top: 180pt; left: 100pt; width: 300pt"><li>Visible list item</li><li style="display: none">HIDDEN_LIST_MARKER</li><li style="color: rgba(0, 0, 0, 0)">TRANSPARENT_LIST_MARKER</li></ul>
  <p style="position: absolute; top: 230pt; left: 100pt; visibility: hidden"><span style="visibility: visible">VISIBLE_VISIBILITY_OVERRIDE</span></p>
  <p style="position: absolute; top: 245pt; left: 100pt; visibility: hidden"><span><b style="visibility: visible">VISIBLE_DEEP_OVERRIDE</b></span></p>
  <p style="position: absolute; top: 260pt; left: 100pt; color: rgba(0, 0, 0, 0)"><span style="color: #111111">VISIBLE_COLOR_OVERRIDE</span></p>
  <svg style="position: absolute; top: 0; left: 0; display: none" width="20" height="20"><rect width="20" height="20" fill="#ff0000"></rect></svg>
  <canvas style="position: absolute; top: 0; left: 0; opacity: 0" width="20" height="20"></canvas>
  <div style="position: absolute; top: 300pt; left: 100pt; visibility: hidden"><svg style="visibility: visible" width="20" height="20"><rect width="20" height="20" fill="#ff0000"></rect></svg></div>
  <div style="position: absolute; top: 330pt; left: 100pt; visibility: hidden"><canvas id="visible-canvas" style="visibility: visible" width="20" height="20"></canvas></div>
  <div style="position: absolute; top: 300pt; left: 150pt"><svg style="visibility: hidden" width="20" height="20"><rect style="visibility: visible" width="20" height="20" fill="#0000ff"></rect></svg></div>
  <script>
    const visibleCanvas = document.getElementById('visible-canvas');
    const visibleContext = visibleCanvas.getContext('2d');
    visibleContext.fillStyle = '#00ff00';
    visibleContext.fillRect(0, 0, 20, 20);
    console.log('CONSOLE_OUTPUT_MARKER');
  </script>
</body>`,
    );
    writeFileSync(join(slidesDir, 'slide-01.html'), html, 'utf-8');
    writeFileSync(passAPath, createPassAReport(slidesDir), 'utf-8');
    writeFileSync(passBPath, createPassBReport(slidesDir), 'utf-8');
    runSlidesGrabCli(designGateArgs(slidesDir, passAPath, passBPath));

    const cliOutput = runSlidesGrabCli([
      'convert',
      '--slides-dir',
      slidesDir,
      '--output',
      outputPath,
      '--engine',
      'text',
    ]);
    const slideXml = extractZipEntry(readFileSync(outputPath), 'ppt/slides/slide1.xml').toString('utf-8');

    assert.match(slideXml, /<a:t>Visible Content<\/a:t>/);
    assert.match(slideXml, /Visible list item/);
    assert.match(slideXml, /VISIBLE_VISIBILITY_OVERRIDE/);
    assert.match(slideXml, /VISIBLE_DEEP_OVERRIDE/);
    assert.match(slideXml, /VISIBLE_COLOR_OVERRIDE/);
    const colorOverrideRun = slideXml.match(/<a:r><a:rPr[\s\S]*?<a:t>VISIBLE_COLOR_OVERRIDE<\/a:t><\/a:r>/)?.[0];
    assert.ok(colorOverrideRun);
    assert.doesNotMatch(colorOverrideRun, /<a:alpha val="0"\/>/);
    assert.equal((slideXml.match(/<p:pic>/g) || []).length, 3);
    assert.doesNotMatch(slideXml, /VISIBILITY_HIDDEN_MARKER|OPACITY_HIDDEN_MARKER|TRANSPARENT_TEXT_MARKER|HIDDEN_IMAGE_MARKER/);
    assert.doesNotMatch(slideXml, /NESTED_DISPLAY_MARKER|NESTED_VISIBILITY_MARKER|NESTED_OPACITY_MARKER|NESTED_TRANSPARENT_MARKER|NESTED_SMALL_MARKER|NESTED_LINK_MARKER/);
    assert.doesNotMatch(slideXml, /HIDDEN_LIST_MARKER|TRANSPARENT_LIST_MARKER/);
    assert.doesNotMatch(cliOutput, /CONSOLE_OUTPUT_MARKER/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('html2pptx reuses a caller-provided browser across slides', async () => {
  const root = mkdtempSync(join(tmpdir(), 'slides-grab-text-browser-'));
  const firstSlide = join(root, 'slide-01.html');
  const secondSlide = join(root, 'slide-02.html');
  const browser = await launchBrowser(process.env.TMPDIR || '/tmp');

  try {
    writeFileSync(firstSlide, createSlideHtml('First Slide'), 'utf-8');
    writeFileSync(secondSlide, createSlideHtml('Second Slide'), 'utf-8');

    const pres = new PptxGenJS();
    pres.defineLayout({ name: 'TEST_WIDE', width: 13.33, height: 7.5 });
    pres.layout = 'TEST_WIDE';

    await html2pptx(firstSlide, pres, { browser, fitToLayout: true });
    assert.equal(browser.isConnected(), true);
    await html2pptx(secondSlide, pres, { browser, fitToLayout: true });
    assert.equal(browser.isConnected(), true);
    assert.equal(browser.contexts().length, 0);
  } finally {
    await browser.close();
    rmSync(root, { recursive: true, force: true });
  }
});
