#!/usr/bin/env node

/**
 * build-viewer.js
 *
 * Builds a single viewer.html from slide-*.html files in selected --slides-dir.
 * Works with file:// protocol — each slide is embedded via <iframe srcdoc="...">
 * for perfect CSS isolation (no regex scoping needed).
 */

import { readFileSync, writeFileSync, readdirSync } from 'fs';
import { createRequire } from 'node:module';
import { dirname, extname, join, resolve } from 'path';
import { fileURLToPath } from 'url';

import { buildSlideRuntimeHtml } from '../src/image-contract.js';

const require = createRequire(import.meta.url);
const {
  DEFAULT_SLIDE_MODE,
  getSlideModeChoices,
  getSlideModeConfig,
  normalizeSlideMode,
} = require('../src/slide-mode.cjs');

const DEFAULT_SLIDES_DIR = 'slides';
const LOCAL_ASSET_PREFIX = './assets/';

// Deliberate sandbox decision: allow-scripts (so Chart.js and other in-slide JS
// render in the viewer) WITHOUT allow-same-origin. Omitting allow-same-origin gives
// each iframe an opaque origin so first-party slide content cannot reach the parent
// viewer document. Small local image references are inlined for srcdoc portability;
// large media such as videos remain relative to the generated viewer file.
const SLIDE_FRAME_SANDBOX = 'allow-scripts';

const MIME_BY_EXTENSION = new Map([
  ['.avif', 'image/avif'],
  ['.gif', 'image/gif'],
  ['.jpg', 'image/jpeg'],
  ['.jpeg', 'image/jpeg'],
  ['.png', 'image/png'],
  ['.svg', 'image/svg+xml'],
  ['.webp', 'image/webp'],
]);

function printUsage() {
  process.stdout.write(
    [
      'Usage: node scripts/build-viewer.js [options]',
      '',
      'Options:',
      `  --slides-dir <path>  Slide directory (default: ${DEFAULT_SLIDES_DIR})`,
      `  --mode <mode>       Slide mode: ${getSlideModeChoices().join(', ')} (default: ${DEFAULT_SLIDE_MODE})`,
      '  -h, --help           Show this help message',
    ].join('\n'),
  );
  process.stdout.write('\n');
}

function readOptionValue(args, index, optionName) {
  const next = args[index + 1];
  if (!next || next.startsWith('-')) {
    throw new Error(`Missing value for ${optionName}.`);
  }
  return next;
}

export function parseCliArgs(args) {
  const options = {
    slidesDir: DEFAULT_SLIDES_DIR,
    mode: DEFAULT_SLIDE_MODE,
    help: false,
  };

  for (let i = 0; i < args.length; i += 1) {
    const arg = args[i];

    if (arg === '-h' || arg === '--help') {
      options.help = true;
      continue;
    }

    if (arg === '--slides-dir') {
      options.slidesDir = readOptionValue(args, i, '--slides-dir');
      i += 1;
      continue;
    }

    if (arg.startsWith('--slides-dir=')) {
      options.slidesDir = arg.slice('--slides-dir='.length);
      continue;
    }

    if (arg === '--mode') {
      options.mode = normalizeSlideMode(readOptionValue(args, i, '--mode'));
      i += 1;
      continue;
    }

    if (arg.startsWith('--mode=')) {
      options.mode = normalizeSlideMode(arg.slice('--mode='.length));
      continue;
    }

    throw new Error(`Unknown option: ${arg}`);
  }

  if (typeof options.slidesDir !== 'string' || options.slidesDir.trim() === '') {
    throw new Error('--slides-dir must be a non-empty string.');
  }

  options.slidesDir = options.slidesDir.trim();
  options.mode = normalizeSlideMode(options.mode);
  return options;
}

function toSlideOrder(fileName) {
  const match = fileName.match(/\d+/);
  return match ? Number.parseInt(match[0], 10) : Number.POSITIVE_INFINITY;
}

function sortSlideFiles(a, b) {
  const orderA = toSlideOrder(a);
  const orderB = toSlideOrder(b);
  if (orderA !== orderB) {
    return orderA - orderB;
  }
  return a.localeCompare(b);
}

export function findSlideFiles(slidesDir) {
  return readdirSync(slidesDir)
    .filter((file) => /^slide-.*\.html$/i.test(file))
    .sort(sortSlideFiles);
}

/**
 * Escape HTML for safe embedding inside srcdoc="..." attribute.
 * Must escape &, ", < so the srcdoc attribute value is valid.
 */
export function escapeForSrcdoc(html) {
  return html
    .replace(/&/g, '&amp;')
    .replace(/"/g, '&quot;');
}

export function loadSlides(slidesDir) {
  return findSlideFiles(slidesDir).map((file) => {
    const slidePath = join(slidesDir, file);
    const html = inlineLocalAssetsForSrcdoc(readFileSync(slidePath, 'utf-8'), slidePath);
    return {
      file,
      html: buildSlideRuntimeHtml(html, {
        baseHref: './',
        slideFile: file,
      }),
    };
  });
}

function getMimeType(filePath) {
  return MIME_BY_EXTENSION.get(extname(filePath).toLowerCase()) || 'application/octet-stream';
}

function toDataUrl(filePath) {
  const bytes = readFileSync(filePath);
  return `data:${getMimeType(filePath)};base64,${bytes.toString('base64')}`;
}

function isInlineableAsset(filePath) {
  return getMimeType(filePath).startsWith('image/');
}

export function inlineLocalAssetsForSrcdoc(html, slidePath) {
  const resolveAsset = (source) => {
    if (!source.startsWith(LOCAL_ASSET_PREFIX)) {
      return source;
    }

    try {
      const filePath = resolve(dirname(slidePath), source);
      if (!isInlineableAsset(filePath)) {
        return source;
      }
      return toDataUrl(filePath);
    } catch {
      return source;
    }
  };

  return html
    .replace(/\b(src|poster)=("([^"]*)"|'([^']*)')/gi, (match, attribute, quoted, doubleValue, singleValue) => {
      const value = doubleValue ?? singleValue ?? '';
      const nextValue = resolveAsset(value);
      if (nextValue === value) {
        return match;
      }
      const quote = quoted.startsWith("'") ? "'" : '"';
      return `${attribute}=${quote}${nextValue}${quote}`;
    })
    .replace(/url\(\s*(['"]?)(\.\/assets\/[^'")]+)\1\s*\)/gi, (match, quote, source) => {
      const nextValue = resolveAsset(source);
      if (nextValue === source) {
        return match;
      }
      return `url("${nextValue}")`;
    });
}

export function buildViewerHtml(slides, { slideMode = DEFAULT_SLIDE_MODE } = {}) {
  const { framePt } = getSlideModeConfig(slideMode);

  return `<!DOCTYPE html>
<html lang="ko">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Slide Viewer</title>
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }

    html, body {
      width: 100%;
      height: 100%;
      overflow: hidden;
      background: #111;
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
    }

    .viewer-container {
      width: 100%;
      height: 100%;
      display: flex;
      flex-direction: column;
    }

    .nav-bar {
      height: 48px;
      background: #1a1a1a;
      border-bottom: 1px solid #333;
      display: flex;
      align-items: center;
      justify-content: center;
      gap: 16px;
      flex-shrink: 0;
      z-index: 100;
    }

    .nav-bar button {
      background: #333;
      color: #fff;
      border: none;
      border-radius: 6px;
      padding: 6px 16px;
      font-size: 13px;
      font-family: inherit;
      cursor: pointer;
      transition: background 0.15s;
    }

    .nav-bar button:hover {
      background: #555;
    }

    .nav-bar button:disabled {
      opacity: 0.3;
      cursor: default;
    }

    .slide-counter {
      color: #aaa;
      font-size: 14px;
      font-weight: 500;
      min-width: 60px;
      text-align: center;
      font-variant-numeric: tabular-nums;
    }

    .btn-fullscreen {
      position: absolute;
      right: 16px;
      background: transparent !important;
      font-size: 18px;
      padding: 6px 10px !important;
    }

    .slide-viewport {
      flex: 1;
      display: flex;
      align-items: center;
      justify-content: center;
      overflow: hidden;
      position: relative;
    }

    .slide-scaler {
      width: ${framePt.width}pt;
      height: ${framePt.height}pt;
      position: relative;
      transform-origin: center center;
    }

    .slide-frame {
      position: absolute;
      inset: 0;
      width: ${framePt.width}pt;
      height: ${framePt.height}pt;
      border: none;
      overflow: hidden;
      opacity: 0;
      pointer-events: none;
      transition: opacity 0.25s ease;
    }

    .slide-frame.active {
      opacity: 1;
      pointer-events: auto;
    }
  </style>
</head>
<body>
  <div class="viewer-container">
    <div class="nav-bar">
      <button id="btn-prev" title="Previous (\\u2190)">Prev</button>
      <span class="slide-counter" id="counter">1 / ${slides.length}</span>
      <button id="btn-next" title="Next (\\u2192)">Next</button>
      <button class="btn-fullscreen" id="btn-fs" title="Fullscreen (F)">&#x26F6;</button>
    </div>

    <div class="slide-viewport" id="viewport">
      <div class="slide-scaler" id="scaler">
${slides.map((s, i) => `        <iframe class="slide-frame${i === 0 ? ' active' : ''}" data-slide="${i + 1}" srcdoc="${escapeForSrcdoc(s.html)}" sandbox="${SLIDE_FRAME_SANDBOX}"></iframe>`).join('\n')}
      </div>
    </div>
  </div>

  <script>
    const TOTAL = ${slides.length};
    let current = 1;

    const frames = document.querySelectorAll('.slide-frame');
    const counter = document.getElementById('counter');
    const btnPrev = document.getElementById('btn-prev');
    const btnNext = document.getElementById('btn-next');
    const scaler = document.getElementById('scaler');
    const viewport = document.getElementById('viewport');

    function sendLifecycle(frame, message) {
      frame.contentWindow?.postMessage(message, '*');
    }

    function syncFrame(frame, index) {
      sendLifecycle(frame, index + 1 === current ? 'slides-grab:activate' : 'slides-grab:deactivate');
    }

    frames.forEach((frame, index) => {
      frame.addEventListener('load', () => syncFrame(frame, index));
    });

    function goTo(n) {
      n = Math.max(1, Math.min(TOTAL, n));
      if (n === current) return;
      sendLifecycle(frames[current - 1], 'slides-grab:deactivate');
      frames[current - 1].classList.remove('active');
      current = n;
      frames[current - 1].classList.add('active');
      sendLifecycle(frames[current - 1], 'slides-grab:activate');
      counter.textContent = current + ' / ' + TOTAL;
      btnPrev.disabled = current === 1;
      btnNext.disabled = current === TOTAL;
    }

    function next() { goTo(current + 1); }
    function prev() { goTo(current - 1); }

    btnPrev.addEventListener('click', prev);
    btnNext.addEventListener('click', next);
    btnPrev.disabled = true;
    frames.forEach(syncFrame);

    document.addEventListener('keydown', (e) => {
      if (e.key === 'ArrowRight' || e.key === ' ') { e.preventDefault(); next(); }
      else if (e.key === 'ArrowLeft') { e.preventDefault(); prev(); }
      else if (e.key === 'Home') { e.preventDefault(); goTo(1); }
      else if (e.key === 'End') { e.preventDefault(); goTo(TOTAL); }
      else if (e.key === 'f' || e.key === 'F') {
        e.preventDefault();
        toggleFullscreen();
      }
    });

    function toggleFullscreen() {
      if (!document.fullscreenElement) {
        document.documentElement.requestFullscreen().catch(() => {});
      } else {
        document.exitFullscreen();
      }
    }
    document.getElementById('btn-fs').addEventListener('click', toggleFullscreen);

    function rescale() {
      const vw = viewport.clientWidth;
      const vh = viewport.clientHeight;
      const slideW = scaler.offsetWidth;
      const slideH = scaler.offsetHeight;
      const scale = Math.min(vw / slideW, vh / slideH) * 0.95;
      scaler.style.transform = 'scale(' + scale + ')';
    }

    window.addEventListener('resize', rescale);
    document.addEventListener('fullscreenchange', () => setTimeout(rescale, 100));
    rescale();
  </script>
</body>
</html>`;
}

export function main(args = process.argv.slice(2)) {
  const options = parseCliArgs(args);
  if (options.help) {
    printUsage();
    return null;
  }

  const slidesDir = resolve(process.cwd(), options.slidesDir);
  const output = join(slidesDir, 'viewer.html');

  let slides;
  try {
    slides = loadSlides(slidesDir);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    process.stderr.write(`Failed to read slide directory: ${slidesDir}\n${message}\n`);
    process.exitCode = 1;
    return null;
  }

  if (slides.length === 0) {
    console.error(`No slide-*.html files found in: ${slidesDir}`);
    process.exitCode = 1;
    return null;
  }

  console.log(`Found ${slides.length} slides`);
  writeFileSync(output, buildViewerHtml(slides, { slideMode: options.mode }), 'utf-8');
  console.log(`Built viewer: ${output}`);
  return { slidesDir, output, slides };
}

const isMain = process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url);

if (isMain) {
  try {
    main();
  } catch (error) {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exit(1);
  }
}
