#!/usr/bin/env node

import { mkdir, readFile, readdir } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { chromium } from 'playwright';

import { ensureSlidesPassValidation } from './validate-slides.js';
import { selectSlideFiles } from '../src/validation/core.js';

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

const DEFAULT_SLIDES_DIR = 'slides';
const DEFAULT_RESOLUTION = '2160p';
const DEFAULT_CAPTURE_DEVICE_SCALE_FACTOR = 2;
const SLIDE_FILE_PATTERN = /^slide-.*\.html$/i;
const RENDER_SETTLE_MS = 120;

function printUsage() {
  process.stdout.write(
    [
      'Usage: node scripts/html2png.js [options]',
      '',
      'Options:',
      `  --slides-dir <path>   Slide directory (default: ${DEFAULT_SLIDES_DIR})`,
      '  --slide <file>        Render only the named slide file (repeatable)',
      '  --output-dir <path>   Output directory for PNG files (default: <slides-dir>/out-png)',
      `  --slide-mode <mode>   Slide mode: ${getSlideModeChoices().join('|')} (default: ${DEFAULT_SLIDE_MODE})`,
      `  --resolution <preset> Raster size preset: ${getResolutionChoices().join('|')}|4k (default: ${DEFAULT_RESOLUTION})`,
      '  -h, --help            Show this help message',
      '',
      'Examples:',
      '  node scripts/html2png.js --slides-dir slides',
      '  node scripts/html2png.js --slides-dir cards --slide-mode card-news',
      '  node scripts/html2png.js --slides-dir slides --resolution 1440p',
      '  node scripts/html2png.js --slides-dir slides --slide slide-07.html',
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

function sortSlideFiles(a, b) {
  const orderA = toSlideOrder(a);
  const orderB = toSlideOrder(b);
  if (orderA !== orderB) return orderA - orderB;
  return a.localeCompare(b);
}

function parseCliArgs(args) {
  const options = {
    slidesDir: DEFAULT_SLIDES_DIR,
    outputDir: '',
    slideMode: DEFAULT_SLIDE_MODE,
    resolution: DEFAULT_RESOLUTION,
    slides: [],
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

    if (arg === '--slide') {
      options.slides.push(readOptionValue(args, i, '--slide'));
      i += 1;
      continue;
    }
    if (arg.startsWith('--slide=')) {
      options.slides.push(arg.slice('--slide='.length));
      continue;
    }

    if (arg === '--output-dir') {
      options.outputDir = readOptionValue(args, i, '--output-dir');
      i += 1;
      continue;
    }
    if (arg.startsWith('--output-dir=')) {
      options.outputDir = arg.slice('--output-dir='.length);
      continue;
    }

    if (arg === '--slide-mode') {
      options.slideMode = normalizeSlideMode(
        readOptionValue(args, i, '--slide-mode'),
        { optionName: '--slide-mode' },
      );
      i += 1;
      continue;
    }
    if (arg.startsWith('--slide-mode=')) {
      options.slideMode = normalizeSlideMode(
        arg.slice('--slide-mode='.length),
        { optionName: '--slide-mode' },
      );
      continue;
    }

    if (arg === '--resolution') {
      options.resolution = normalizeResolutionPreset(
        readOptionValue(args, i, '--resolution'),
        { allowEmpty: false },
      );
      i += 1;
      continue;
    }
    if (arg.startsWith('--resolution=')) {
      options.resolution = normalizeResolutionPreset(
        arg.slice('--resolution='.length),
        { allowEmpty: false },
      );
      continue;
    }

    throw new Error(`Unknown option: ${arg}`);
  }

  return options;
}

function computeDeviceScaleFactor(resolution, slideMode) {
  const { framePx } = getSlideModeConfig(slideMode);
  const target = getResolutionSize(resolution, slideMode);
  if (!target) return DEFAULT_CAPTURE_DEVICE_SCALE_FACTOR;
  return target.height / framePx.height;
}

async function discoverSlideFiles(slidesDir) {
  const entries = await readdir(slidesDir);
  return entries
    .filter((name) => SLIDE_FILE_PATTERN.test(name))
    .sort(sortSlideFiles);
}

async function renderSlideToPng(page, slidesDir, slideFile, outputPath) {
  const slidePath = join(slidesDir, slideFile);
  const url = pathToFileURL(slidePath).href;
  await gotoStaticSlide(page, url, await readFile(slidePath, 'utf8'));
  await page.evaluate(async () => {
    if (document.fonts?.ready) {
      await document.fonts.ready;
    }
  });
  await page.waitForTimeout(RENDER_SETTLE_MS);
  await page.screenshot({ path: outputPath, fullPage: false });
}

async function main() {
  let options;
  try {
    options = parseCliArgs(process.argv.slice(2));
  } catch (error) {
    process.stderr.write(`${error.message}\n`);
    printUsage();
    process.exit(2);
  }

  if (options.help) {
    printUsage();
    return;
  }

  const slidesDir = resolve(process.cwd(), options.slidesDir);
  const outputDir = resolve(
    process.cwd(),
    options.outputDir || join(options.slidesDir, 'out-png'),
  );

  await ensureSlidesPassValidation(slidesDir, {
    exportLabel: 'PNG export',
    selectedSlides: options.slides,
    slideMode: options.slideMode,
  });

  const slideFiles = selectSlideFiles(
    await discoverSlideFiles(slidesDir),
    options.slides,
    slidesDir,
  );
  if (slideFiles.length === 0) {
    process.stderr.write(`No slide-*.html files found in ${slidesDir}\n`);
    process.exit(1);
  }

  await mkdir(outputDir, { recursive: true });

  const { framePx } = getSlideModeConfig(options.slideMode);
  const deviceScaleFactor = computeDeviceScaleFactor(
    options.resolution,
    options.slideMode,
  );
  const outputSize = getResolutionSize(options.resolution, options.slideMode) || {
    width: framePx.width * deviceScaleFactor,
    height: framePx.height * deviceScaleFactor,
  };

  process.stdout.write(
    `Rendering ${slideFiles.length} slide(s) at ${outputSize.width}x${outputSize.height} (${options.slideMode})\n`,
  );

  const browser = await chromium.launch({ headless: true });
  try {
    const context = await browser.newContext({
      viewport: { width: framePx.width, height: framePx.height },
      deviceScaleFactor,
    });
    const page = await context.newPage();

    for (const slideFile of slideFiles) {
      const outputName = slideFile.replace(/\.html$/i, '.png');
      const outputPath = join(outputDir, outputName);
      await renderSlideToPng(page, slidesDir, slideFile, outputPath);
      process.stdout.write(`  ${outputName}\n`);
    }

    await context.close();
  } finally {
    await browser.close();
  }

  process.stdout.write(`PNG export complete: ${outputDir}\n`);
}

main().catch((error) => {
  process.stderr.write(`${error?.stack || error?.message || error}\n`);
  process.exit(1);
});
