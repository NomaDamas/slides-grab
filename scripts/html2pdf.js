#!/usr/bin/env node

import { readFile, readdir, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { basename, join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { chromium } from 'playwright';
import { PDFDocument } from 'pdf-lib';
import sharp from 'sharp';

import { ensureSlidesPassValidation } from './validate-slides.js';

const require = createRequire(import.meta.url);
const {
  getResolutionChoices,
  getResolutionSize,
  normalizeResolutionPreset,
} = require('../src/export-resolution.cjs');
const {
  DEFAULT_SLIDE_MODE,
  getSlideModeChoices,
  getSlideModeConfig,
  normalizeSlideMode,
} = require('../src/slide-mode.cjs');
const { gotoStaticSlide } = require('../src/motion-contract.cjs');

const DEFAULT_OUTPUT = 'slides.pdf';
const DEFAULT_SLIDES_DIR = 'slides';
const DEFAULT_MODE = 'capture';
const DEFAULT_CAPTURE_RESOLUTION = '2160p';
const PDF_MODES = new Set(['capture', 'print']);
const SLIDE_FILE_PATTERN = /^slide-.*\.html$/i;
const DEFAULT_CAPTURE_DEVICE_SCALE_FACTOR = 2;
const RENDER_SETTLE_MS = 120;
const CSS_PIXELS_PER_INCH = 96;
const PDF_POINTS_PER_INCH = 72;
const VIDEO_EXPORT_PREP_TIMEOUT_MS = 4000;

function printUsage() {
  process.stdout.write(
    [
      'Usage: node scripts/html2pdf.js [options]',
      '',
      'Options:',
      `  --output <path>      Output PDF path (default: ${DEFAULT_OUTPUT})`,
      `  --slides-dir <path>  Slide directory (default: ${DEFAULT_SLIDES_DIR})`,
      `  --mode <mode>        PDF export mode: capture|print (default: ${DEFAULT_MODE})`,
      `  --slide-mode <mode>  Slide mode: ${getSlideModeChoices().join('|')} (default: ${DEFAULT_SLIDE_MODE})`,
      `  --resolution <preset> Capture raster size preset: ${getResolutionChoices().join('|')}|4k (default: ${DEFAULT_CAPTURE_RESOLUTION}; ignored in print mode)`,
      '  -h, --help           Show this help message',
      '',
      'Examples:',
      '  node scripts/html2pdf.js',
      '  node scripts/html2pdf.js --output dist/deck.pdf',
      '  node scripts/html2pdf.js --mode print --output dist/searchable.pdf',
      '  node scripts/html2pdf.js --resolution 2160p --output dist/deck-4k.pdf',
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

function toSlideOrder(fileName) {
  const match = fileName.match(/\d+/);
  return match ? Number.parseInt(match[0], 10) : Number.POSITIVE_INFINITY;
}

function normalizeDimension(value, fallback) {
  if (!Number.isFinite(value) || value <= 0) {
    return fallback;
  }
  return Math.max(1, Math.round(value));
}

function normalizeMode(value) {
  if (typeof value !== 'string') {
    throw new Error(`--mode must be one of: ${Array.from(PDF_MODES).join(', ')}`);
  }

  const mode = value.trim().toLowerCase();
  if (!PDF_MODES.has(mode)) {
    throw new Error(`Unknown PDF mode "${value}". Expected one of: ${Array.from(PDF_MODES).join(', ')}`);
  }
  return mode;
}

function cssPixelsToPdfPoints(value) {
  return Math.round((normalizeDimension(value, 0) * PDF_POINTS_PER_INCH) / CSS_PIXELS_PER_INCH);
}

async function normalizeCaptureRasterSize(pngBytes, resolution = '', slideMode = DEFAULT_SLIDE_MODE) {
  const targetSize = getResolutionSize(resolution, slideMode);
  if (!targetSize) {
    return pngBytes;
  }

  const metadata = await sharp(pngBytes).metadata();
  const currentWidth = normalizeDimension(metadata.width, targetSize.width);
  const currentHeight = normalizeDimension(metadata.height, targetSize.height);
  if (currentWidth === targetSize.width && currentHeight === targetSize.height) {
    return pngBytes;
  }

  return sharp(pngBytes)
    .resize(targetSize.width, targetSize.height, { fit: 'fill' })
    .png()
    .toBuffer();
}

function formatDiagnosticEntry(entry) {
  const prefix = entry.slideFile ? `${entry.slideFile}: ` : '';
  return `${prefix}${entry.message}`;
}

function formatDiagnostics(slideFile, diagnostics = []) {
  const relevantDiagnostics = diagnostics.filter((entry) => entry.slideFile === slideFile);
  if (relevantDiagnostics.length === 0) {
    return '';
  }

  return relevantDiagnostics.map((entry) => `  - ${formatDiagnosticEntry(entry)}`).join('\n');
}

function decorateError(error, slideFile, diagnostics = []) {
  const baseMessage = error instanceof Error ? error.message : String(error);
  const details = formatDiagnostics(slideFile, diagnostics);
  return new Error(details ? `${slideFile}: ${baseMessage}\nDiagnostics:\n${details}` : `${slideFile}: ${baseMessage}`);
}

export function sortSlideFiles(a, b) {
  const orderA = toSlideOrder(a);
  const orderB = toSlideOrder(b);
  if (orderA !== orderB) return orderA - orderB;
  return a.localeCompare(b);
}

export function parseCliArgs(args) {
  const options = {
    output: DEFAULT_OUTPUT,
    slidesDir: DEFAULT_SLIDES_DIR,
    mode: DEFAULT_MODE,
    slideMode: DEFAULT_SLIDE_MODE,
    resolution: DEFAULT_CAPTURE_RESOLUTION,
    help: false,
  };

  for (let i = 0; i < args.length; i += 1) {
    const arg = args[i];

    if (arg === '-h' || arg === '--help') {
      options.help = true;
      continue;
    }

    if (arg === '--output') {
      options.output = readOptionValue(args, i, '--output');
      i += 1;
      continue;
    }

    if (arg.startsWith('--output=')) {
      options.output = arg.slice('--output='.length);
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
      options.mode = normalizeMode(readOptionValue(args, i, '--mode'));
      i += 1;
      continue;
    }

    if (arg.startsWith('--mode=')) {
      options.mode = normalizeMode(arg.slice('--mode='.length));
      continue;
    }

    if (arg === '--slide-mode') {
      options.slideMode = normalizeSlideMode(readOptionValue(args, i, '--slide-mode'), { optionName: '--slide-mode' });
      i += 1;
      continue;
    }

    if (arg.startsWith('--slide-mode=')) {
      options.slideMode = normalizeSlideMode(arg.slice('--slide-mode='.length), { optionName: '--slide-mode' });
      continue;
    }

    if (arg === '--resolution') {
      options.resolution = normalizeResolutionPreset(readOptionValue(args, i, '--resolution'));
      i += 1;
      continue;
    }

    if (arg.startsWith('--resolution=')) {
      options.resolution = normalizeResolutionPreset(arg.slice('--resolution='.length));
      continue;
    }

    throw new Error(`Unknown option: ${arg}`);
  }

  if (typeof options.output !== 'string' || options.output.trim() === '') {
    throw new Error('--output must be a non-empty string.');
  }
  if (typeof options.slidesDir !== 'string' || options.slidesDir.trim() === '') {
    throw new Error('--slides-dir must be a non-empty string.');
  }

  options.output = options.output.trim();
  options.slidesDir = options.slidesDir.trim();
  options.mode = normalizeMode(options.mode);
  options.slideMode = normalizeSlideMode(options.slideMode, { optionName: '--slide-mode' });
  options.resolution = normalizeResolutionPreset(options.resolution);
  if (options.mode === 'print') {
    options.resolution = '';
  }

  return options;
}

export async function findSlideFiles(slidesDir = resolve(process.cwd(), DEFAULT_SLIDES_DIR)) {
  const entries = await readdir(slidesDir, { withFileTypes: true });
  return entries
    .filter((entry) => entry.isFile() && SLIDE_FILE_PATTERN.test(entry.name))
    .map((entry) => entry.name)
    .sort(sortSlideFiles);
}

export function buildPdfOptions(widthPx, heightPx) {
  const fallbackSize = getSlideModeConfig(DEFAULT_SLIDE_MODE).framePx;
  return {
    width: `${normalizeDimension(widthPx, fallbackSize.width)}px`,
    height: `${normalizeDimension(heightPx, fallbackSize.height)}px`,
    printBackground: true,
    pageRanges: '1',
    margin: { top: '0px', right: '0px', bottom: '0px', left: '0px' },
    preferCSSPageSize: false,
  };
}

export function buildPageOptions(mode = DEFAULT_MODE, resolution = '', slideMode = DEFAULT_SLIDE_MODE) {
  const { framePx } = getSlideModeConfig(slideMode);
  const targetResolution = normalizeMode(mode) === 'capture' ? getResolutionSize(resolution, slideMode) : null;
  return {
    viewport: {
      width: framePx.width,
      height: framePx.height,
    },
    deviceScaleFactor: normalizeMode(mode) === 'capture'
      ? targetResolution
        ? targetResolution.height / framePx.height
        : DEFAULT_CAPTURE_DEVICE_SCALE_FACTOR
      : 1,
  };
}

function chooseSlideFrame(metrics, slideMode = DEFAULT_SLIDE_MODE) {
  const { framePx } = getSlideModeConfig(slideMode);
  const targetAspectRatio = framePx.width / framePx.height;
  const viewportArea = Math.max(1, metrics.viewport.width * metrics.viewport.height);
  const bodyArea = Math.max(1, metrics.body.width * metrics.body.height);
  const bodyScrollArea = Math.max(1, metrics.body.scrollWidth * metrics.body.scrollHeight);
  const documentScrollArea = Math.max(1, metrics.document.scrollWidth * metrics.document.scrollHeight);
  const bodyHasOverflowingContent =
    metrics.body.scrollWidth > metrics.body.width * 1.05 ||
    metrics.body.scrollHeight > metrics.body.height * 1.05 ||
    metrics.document.scrollWidth > metrics.body.width * 1.05 ||
    metrics.document.scrollHeight > metrics.body.height * 1.05;
  const candidates = [
    { ...metrics.body, source: 'body' },
    ...metrics.candidates.map((candidate, index) => ({ ...candidate, candidateIndex: index, source: 'body-child' })),
  ]
    .filter((candidate) => candidate.width > 0 && candidate.height > 0)
    .map((candidate) => ({
      ...candidate,
      area: candidate.width * candidate.height,
      aspectDelta: Math.abs(candidate.width / candidate.height - targetAspectRatio),
      coverage: (candidate.width * candidate.height) / viewportArea,
    }))
    .sort((left, right) => right.area - left.area);

  // When the body has explicit slide dimensions (fills the viewport with no
  // default margins), no overflow, and a good 16:9 aspect ratio, it IS the
  // slide frame — skip the body-child heuristic entirely.
  const bodyCandidate = candidates.find((c) => c.source === 'body');
  const bodyMatchesViewport =
    Math.abs(metrics.body.width - metrics.viewport.width) < 2 &&
    Math.abs(metrics.body.height - metrics.viewport.height) < 2;
  if (bodyMatchesViewport && !bodyHasOverflowingContent && bodyCandidate && bodyCandidate.aspectDelta < 0.12) {
    return bodyCandidate;
  }

  const preferredCandidate = candidates.find((candidate) => {
    if (candidate.source !== 'body-child') return false;
    if (candidate.coverage < 0.45) return false;
    return candidate.aspectDelta < 0.2;
  });

  if (preferredCandidate && (bodyHasOverflowingContent || bodyArea > preferredCandidate.area * 1.15 || bodyScrollArea > preferredCandidate.area * 1.15 || documentScrollArea > preferredCandidate.area * 1.15)) {
    return preferredCandidate;
  }

  const bestAspectCandidate = candidates.find((candidate) => {
    if (candidate.source === 'body' && bodyHasOverflowingContent) {
      return false;
    }
    return candidate.aspectDelta < 0.12;
  });
  return bestAspectCandidate || candidates[0] || { ...metrics.body, source: 'fallback' };
}

export async function waitForSlideRenderReady(page, options = {}) {
  const settleMs = normalizeDimension(options.settleMs ?? RENDER_SETTLE_MS, RENDER_SETTLE_MS);
  const shouldRunReadySignal = options.runReadySignal !== false;

  await page.waitForLoadState('load');
  await page.evaluate(async ({ settleMs: settleDelay, runReadySignal }) => {
    if (document.fonts?.ready) {
      await document.fonts.ready.catch(() => {});
    }

    await Promise.all(
      Array.from(document.images || [], async (image) => {
        if (typeof image.decode === 'function') {
          await image.decode().catch(() => {});
          return;
        }

        if (image.complete) {
          return;
        }

        await new Promise((resolve) => {
          const done = () => resolve();
          image.addEventListener('load', done, { once: true });
          image.addEventListener('error', done, { once: true });
        });
      }),
    );

    if (runReadySignal) {
      const readySignal =
        window.__slidesGrabReady ??
        window.__SLIDES_GRAB_READY ??
        window.slidesGrabReady ??
        document.documentElement?.dataset?.slidesGrabReady ??
        document.body?.dataset?.slidesGrabReady;

      if (typeof readySignal === 'function') {
        await readySignal();
      } else if (readySignal && typeof readySignal.then === 'function') {
        await readySignal.catch(() => {});
      } else if (readySignal === 'pending') {
        await new Promise((resolve) => {
          const listener = () => resolve();
          window.addEventListener('slides-grab-ready', listener, { once: true });
          setTimeout(resolve, 5000);
        });
      }
    }

    await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
    await new Promise((resolve) => setTimeout(resolve, settleDelay));
  }, { settleMs, runReadySignal: shouldRunReadySignal });
}

export async function detectSlideFrame(page, slideMode = DEFAULT_SLIDE_MODE) {
  const metrics = await page.evaluate(() => {
    function toBox(element) {
      const rect = element.getBoundingClientRect();
      return {
        x: Math.max(0, rect.x),
        y: Math.max(0, rect.y),
        width: rect.width,
        height: rect.height,
      };
    }

    const body = document.body;
    const bodyStyle = window.getComputedStyle(body);
    const bodyBox = toBox(body);
    const directChildren = Array.from(body.children)
      .map((element) => ({
        tagName: element.tagName.toLowerCase(),
        ...toBox(element),
      }))
      .filter((box) => box.width > 0 && box.height > 0);

    return {
      viewport: { width: window.innerWidth, height: window.innerHeight },
      document: {
        scrollWidth: document.documentElement.scrollWidth || bodyBox.width || 0,
        scrollHeight: document.documentElement.scrollHeight || bodyBox.height || 0,
      },
      body: {
        ...bodyBox,
        width: Number.parseFloat(bodyStyle.width) || bodyBox.width || 0,
        height: Number.parseFloat(bodyStyle.height) || bodyBox.height || 0,
        scrollWidth: body.scrollWidth || bodyBox.width || 0,
        scrollHeight: body.scrollHeight || bodyBox.height || 0,
      },
      candidates: directChildren,
    };
  });

  const frame = chooseSlideFrame(metrics, slideMode);
  const fallbackSize = getSlideModeConfig(slideMode).framePx;
  return {
    x: normalizeDimension(frame.x, 0),
    y: normalizeDimension(frame.y, 0),
    width: normalizeDimension(frame.width, fallbackSize.width),
    height: normalizeDimension(frame.height, fallbackSize.height),
    candidateIndex: Number.isInteger(frame.candidateIndex) ? frame.candidateIndex : null,
    source: frame.source,
  };
}

export async function prepareVideosForExport(page, options = {}) {
  const timeoutMs = normalizeDimension(options.timeoutMs ?? VIDEO_EXPORT_PREP_TIMEOUT_MS, VIDEO_EXPORT_PREP_TIMEOUT_MS);

  await page.evaluate(async ({ timeoutMs: captureTimeoutMs }) => {
    const videos = Array.from(document.querySelectorAll('video'));
    if (videos.length === 0) {
      return;
    }

    function waitForVideoReady(video) {
      if (video.readyState >= HTMLMediaElement.HAVE_CURRENT_DATA) {
        return Promise.resolve();
      }

      return new Promise((resolve) => {
        const cleanup = () => {
          video.removeEventListener('loadeddata', onReady);
          video.removeEventListener('canplay', onReady);
          video.removeEventListener('error', onReady);
        };
        const onReady = () => {
          cleanup();
          resolve();
        };

        video.addEventListener('loadeddata', onReady, { once: true });
        video.addEventListener('canplay', onReady, { once: true });
        video.addEventListener('error', onReady, { once: true });
        setTimeout(onReady, captureTimeoutMs);
      });
    }

    async function captureVideoFrame(video) {
      await waitForVideoReady(video);
      if (video.readyState < HTMLMediaElement.HAVE_CURRENT_DATA || video.videoWidth <= 0 || video.videoHeight <= 0) {
        return '';
      }

      const canvas = document.createElement('canvas');
      canvas.width = video.videoWidth;
      canvas.height = video.videoHeight;
      const context = canvas.getContext('2d');
      if (!context) {
        return '';
      }

      try {
        context.drawImage(video, 0, 0, canvas.width, canvas.height);
        return canvas.toDataURL('image/png');
      } catch {
        return '';
      }
    }

    function copyComputedStyle(sourceElement, targetElement) {
      const computed = window.getComputedStyle(sourceElement);
      for (const propertyName of Array.from(computed)) {
        targetElement.style.setProperty(
          propertyName,
          computed.getPropertyValue(propertyName),
          computed.getPropertyPriority(propertyName),
        );
      }
      return computed;
    }

    const replacementImages = [];

    for (const video of videos) {
      const rect = video.getBoundingClientRect();
      if (rect.width <= 0 || rect.height <= 0) {
        continue;
      }

      const thumbnail = (video.getAttribute('poster') || '').trim() || await captureVideoFrame(video);
      if (!thumbnail) {
        continue;
      }

      video.pause?.();
      const replacement = document.createElement('img');
      replacement.setAttribute('data-slides-grab-video-replacement', 'true');
      replacement.src = thumbnail;
      replacement.alt = video.getAttribute('aria-label') || video.getAttribute('title') || 'Video thumbnail';
      replacement.className = video.className;

      const computed = copyComputedStyle(video, replacement);
      replacement.style.objectFit = computed.objectFit || 'contain';
      replacement.style.objectPosition = computed.objectPosition || '50% 50%';
      replacement.style.pointerEvents = 'none';
      replacement.style.visibility = 'visible';

      video.replaceWith(replacement);
      replacementImages.push(replacement);
    }

    await Promise.all(
      replacementImages.map(async (replacement) => {
        if (typeof replacement.decode === 'function') {
          await replacement.decode().catch(() => {});
        }
      }),
    );

    await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
  }, { timeoutMs });
}

export async function normalizeBodyToSlideFrame(page, slideFrame) {
  return page.evaluate(({ width, height }) => {
    const body = document.body;
    const documentElement = document.documentElement;

    body.style.margin = '0';
    body.style.width = `${width}px`;
    body.style.height = `${height}px`;
    body.style.minWidth = `${width}px`;
    body.style.minHeight = `${height}px`;
    body.style.overflow = 'hidden';

    documentElement.style.margin = '0';
    documentElement.style.padding = '0';
    documentElement.style.width = `${width}px`;
    documentElement.style.height = `${height}px`;
    documentElement.style.minWidth = `${width}px`;
    documentElement.style.minHeight = `${height}px`;
    documentElement.style.overflow = 'hidden';
  }, slideFrame);
}

export async function isolateSlideFrame(page, slideFrame) {
  return page.evaluate(({ x, y, width, height, source, candidateIndex }) => {
    const body = document.body;
    if (body.querySelector(':scope > [data-slides-grab-print-frame="true"]')) {
      return { x: 0, y: 0, width, height, source: 'body', candidateIndex: null };
    }

    const shouldWrapBodyChildren = source === 'body-child' || x !== 0 || y !== 0;
    if (!shouldWrapBodyChildren) {
      return { x, y, width, height, source, candidateIndex: candidateIndex ?? null };
    }

    const clipFrame = document.createElement('div');
    clipFrame.setAttribute('data-slides-grab-print-frame', 'true');
    clipFrame.style.position = 'relative';
    clipFrame.style.width = `${width}px`;
    clipFrame.style.height = `${height}px`;
    clipFrame.style.margin = '0';
    clipFrame.style.padding = '0';
    clipFrame.style.overflow = 'hidden';
    clipFrame.style.boxSizing = 'border-box';

    const translatedContent = document.createElement('div');
    translatedContent.setAttribute('data-slides-grab-print-content', 'true');
    translatedContent.style.position = 'absolute';
    translatedContent.style.left = `${-x}px`;
    translatedContent.style.top = `${-y}px`;
    translatedContent.style.width = `${Math.max(width + x, body.scrollWidth, document.documentElement.scrollWidth)}px`;
    translatedContent.style.height = `${Math.max(height + y, body.scrollHeight, document.documentElement.scrollHeight)}px`;

    // Preserve the original node order inside one translated subtree so overlap
    // paint order and live DOM state survive both capture and print exports.
    const childNodes = Array.from(body.childNodes);
    body.replaceChildren(clipFrame);
    clipFrame.append(translatedContent);
    for (const node of childNodes) {
      translatedContent.append(node);
    }

    return { x: 0, y: 0, width, height, source: 'body', candidateIndex: null };
  }, slideFrame);
}

function createSlideDiagnostics() {
  const diagnostics = [];
  let currentSlide = null;

  function push(type, message) {
    diagnostics.push({
      type,
      slideFile: currentSlide,
      message,
    });
  }

  return {
    attach(page) {
      page.on('console', (message) => {
        const type = message.type();
        if (type !== 'error' && type !== 'warning') {
          return;
        }

        const location = message.location();
        const locationLabel = location.url ? ` (${basename(location.url)}:${location.lineNumber ?? 0})` : '';
        push(`console:${type}`, `${type}${locationLabel}: ${message.text()}`);
      });

      page.on('pageerror', (error) => {
        push('pageerror', error instanceof Error ? error.message : String(error));
      });

      page.on('requestfailed', (request) => {
        const failure = request.failure();
        push(
          'requestfailed',
          `request failed: ${request.url()}${failure?.errorText ? ` (${failure.errorText})` : ''}`,
        );
      });

      page.on('response', (response) => {
        if (response.status() >= 400) {
          push('response', `HTTP ${response.status()}: ${response.url()}`);
        }
      });
    },
    beginSlide(slideFile) {
      currentSlide = slideFile;
    },
    endSlide() {
      currentSlide = null;
    },
    getSlideDiagnostics(slideFile) {
      return diagnostics.filter((entry) => entry.slideFile === slideFile);
    },
  };
}

export async function renderSlideToPdf(page, slideFile, slidesDir, options = {}) {
  const slidePath = join(slidesDir, slideFile);
  const slideUrl = pathToFileURL(slidePath).href;
  const mode = normalizeMode(options.mode ?? DEFAULT_MODE);
  const slideMode = normalizeSlideMode(options.slideMode ?? DEFAULT_SLIDE_MODE, { optionName: '--slide-mode' });
  const captureResolution = mode === 'capture' ? normalizeResolutionPreset(options.resolution ?? '') : '';

  await gotoStaticSlide(page, slideUrl, await readFile(slidePath, 'utf8'));
  await waitForSlideRenderReady(page, options);

  const slideFrame = await detectSlideFrame(page, slideMode);
  const normalizedSlideFrame = await isolateSlideFrame(page, slideFrame);
  await normalizeBodyToSlideFrame(page, normalizedSlideFrame);
  await waitForSlideRenderReady(page, { ...options, runReadySignal: false });

  if (mode === 'capture') {
    const fallbackSize = getSlideModeConfig(slideMode).framePx;
    const viewportSize = {
      width: normalizeDimension(normalizedSlideFrame.width, fallbackSize.width),
      height: normalizeDimension(normalizedSlideFrame.height, fallbackSize.height),
    };
    await page.setViewportSize(viewportSize);
    await waitForSlideRenderReady(page, { ...options, runReadySignal: false });
    // Reset autoplay videos to show their poster instead of a mid-play frame,
    // without replacing the <video> element (which would break slide layout).
    await page.evaluate(() => {
      for (const video of document.querySelectorAll('video')) {
        video.pause();
        video.removeAttribute('autoplay');
        if (video.getAttribute('poster')) {
          video.load();
        }
      }
    });
    await waitForSlideRenderReady(page, { ...options, runReadySignal: false, settleMs: 200 });
    const pngBytes = await page.screenshot({
      type: 'png',
      clip: {
        x: 0,
        y: 0,
        width: viewportSize.width,
        height: viewportSize.height,
      },
    });
    const normalizedPngBytes = await normalizeCaptureRasterSize(pngBytes, captureResolution, slideMode);
    return {
      mode,
      slideMode,
      width: normalizedSlideFrame.width,
      height: normalizedSlideFrame.height,
      pngBytes: normalizedPngBytes,
    };
  }

  await prepareVideosForExport(page);

  return {
    mode,
    slideMode,
    width: normalizedSlideFrame.width,
    height: normalizedSlideFrame.height,
    pdfBytes: await page.pdf(buildPdfOptions(normalizedSlideFrame.width, normalizedSlideFrame.height)),
  };
}

export async function mergePdfBuffers(pdfBuffers) {
  const outputPdf = await PDFDocument.create();

  for (const pdfBuffer of pdfBuffers) {
    const sourcePdf = await PDFDocument.load(pdfBuffer);
    const pageIndices = sourcePdf.getPageIndices();
    const pages = await outputPdf.copyPages(sourcePdf, pageIndices);
    for (const page of pages) {
      outputPdf.addPage(page);
    }
  }

  return outputPdf.save();
}

export async function buildCapturePdf(slides) {
  const outputPdf = await PDFDocument.create();

  for (const slide of slides) {
    const pageWidth = cssPixelsToPdfPoints(slide.width);
    const pageHeight = cssPixelsToPdfPoints(slide.height);
    const page = outputPdf.addPage([pageWidth, pageHeight]);
    const image = await outputPdf.embedPng(slide.pngBytes);
    page.drawImage(image, {
      x: 0,
      y: 0,
      width: pageWidth,
      height: pageHeight,
    });
  }

  return outputPdf.save();
}

async function main() {
  const options = parseCliArgs(process.argv.slice(2));
  if (options.help) {
    printUsage();
    return;
  }

  const slidesDir = resolve(process.cwd(), options.slidesDir);
  await ensureSlidesPassValidation(slidesDir, { exportLabel: 'PDF export', slideMode: options.slideMode });
  const slideFiles = await findSlideFiles(slidesDir);
  if (slideFiles.length === 0) {
    throw new Error(`No slide-*.html files found in: ${slidesDir}`);
  }

  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage(buildPageOptions(options.mode, options.resolution, options.slideMode));
  const diagnostics = createSlideDiagnostics();
  diagnostics.attach(page);
  const renderedSlides = [];

  try {
    for (const slideFile of slideFiles) {
      diagnostics.beginSlide(slideFile);
      try {
        const slideResult = await renderSlideToPdf(page, slideFile, slidesDir, {
          mode: options.mode,
          slideMode: options.slideMode,
          resolution: options.resolution,
        });
        renderedSlides.push(slideResult);
      } catch (error) {
        throw decorateError(error, slideFile, diagnostics.getSlideDiagnostics(slideFile));
      } finally {
        const slideDiagnostics = diagnostics.getSlideDiagnostics(slideFile);
        if (slideDiagnostics.length > 0) {
          process.stderr.write(`[slides-grab] Diagnostics for ${slideFile}:\n${formatDiagnostics(slideFile, slideDiagnostics)}\n`);
        }
        diagnostics.endSlide();
      }
    }
  } finally {
    await browser.close();
  }

  const mergedPdf =
    options.mode === 'capture'
      ? await buildCapturePdf(renderedSlides)
      : await mergePdfBuffers(renderedSlides.map((slide) => slide.pdfBytes));

  const outputPath = resolve(process.cwd(), options.output);
  await writeFile(outputPath, mergedPdf);

  process.stdout.write(`Generated PDF (${options.mode} mode): ${outputPath}\n`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exit(1);
  });
}
