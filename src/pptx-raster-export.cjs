const PptxGenJS = require('pptxgenjs');
const { chromium } = require('playwright');
const path = require('path');
const fs = require('fs');
const sharp = require('sharp');
const { gotoStaticSlide } = require('./motion-contract.cjs');

const {
  getResolutionChoices,
  getResolutionSize,
  normalizeResolutionPreset,
} = require('./export-resolution.cjs');
const {
  DEFAULT_SLIDE_MODE,
  getSlideModeChoices,
  getSlideModeConfig,
  normalizeSlideMode,
} = require('./slide-mode.cjs');

const DEFAULT_SLIDES_DIR = 'slides';
const DEFAULT_OUTPUT = 'output.pptx';
const DEFAULT_RESOLUTION = '2160p';
const DEFAULT_CAPTURE_DEVICE_SCALE_FACTOR = 2;
const TARGET_RASTER_DPI = 150;
const SLIDE_FILE_PATTERN = /^slide-.*\.html$/i;

function normalizeDimension(value, fallback) {
  if (!Number.isFinite(value) || value <= 0) {
    return fallback;
  }
  return Math.max(1, Math.round(value));
}

function buildPageOptions(resolution = '', slideMode = DEFAULT_SLIDE_MODE) {
  const { framePx } = getSlideModeConfig(slideMode);
  const targetResolution = getResolutionSize(resolution, slideMode);
  return {
    viewport: {
      width: framePx.width,
      height: framePx.height,
    },
    deviceScaleFactor: targetResolution
      ? targetResolution.height / framePx.height
      : DEFAULT_CAPTURE_DEVICE_SCALE_FACTOR,
  };
}

function getTargetRasterSize(resolution = '', slideMode = DEFAULT_SLIDE_MODE) {
  const targetResolution = getResolutionSize(resolution, slideMode);
  if (targetResolution) {
    return targetResolution;
  }

  const { pptxSizeIn } = getSlideModeConfig(slideMode);
  return {
    width: Math.round(pptxSizeIn.width * TARGET_RASTER_DPI),
    height: Math.round(pptxSizeIn.height * TARGET_RASTER_DPI),
  };
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

function getHtmlSlides(slidesDir) {
  if (!fs.existsSync(slidesDir)) {
    throw new Error(`Slides directory not found: ${slidesDir}`);
  }

  const files = fs.readdirSync(slidesDir)
    .filter((fileName) => SLIDE_FILE_PATTERN.test(fileName))
    .sort(sortSlideFiles);

  if (files.length === 0) {
    throw new Error(`No slide-*.html files found in ${slidesDir}`);
  }

  return files;
}

function printUsage() {
  process.stdout.write(
    [
      'Usage: node convert.cjs [options]',
      '',
      'Options:',
      `  --slides-dir <path>  Slide directory (default: ${DEFAULT_SLIDES_DIR})`,
      `  --output <path>      Output pptx path (default: ${DEFAULT_OUTPUT})`,
      `  --mode <mode>        Slide mode: ${getSlideModeChoices().join('|')} (default: ${DEFAULT_SLIDE_MODE})`,
      `  --resolution <preset> Raster size preset: ${getResolutionChoices().join('|')}|4k (default: ${DEFAULT_RESOLUTION})`,
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

function parseArgs(args) {
  const options = {
    slidesDir: DEFAULT_SLIDES_DIR,
    output: DEFAULT_OUTPUT,
    mode: DEFAULT_SLIDE_MODE,
    resolution: DEFAULT_RESOLUTION,
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

    if (arg === '--output') {
      options.output = readOptionValue(args, i, '--output');
      i += 1;
      continue;
    }

    if (arg.startsWith('--output=')) {
      options.output = arg.slice('--output='.length);
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

  if (typeof options.slidesDir !== 'string' || options.slidesDir.trim() === '') {
    throw new Error('--slides-dir must be a non-empty string.');
  }

  if (typeof options.output !== 'string' || options.output.trim() === '') {
    throw new Error('--output must be a non-empty string.');
  }

  options.slidesDir = options.slidesDir.trim();
  options.output = options.output.trim();
  options.mode = normalizeSlideMode(options.mode);
  options.resolution = normalizeResolutionPreset(options.resolution);
  return options;
}

async function convertSlide(htmlFile, pres, browser, options = {}) {
  const filePath = path.isAbsolute(htmlFile) ? htmlFile : path.join(process.cwd(), htmlFile);
  const slideMode = normalizeSlideMode(options.mode || DEFAULT_SLIDE_MODE);
  const fallbackSize = getSlideModeConfig(slideMode).framePx;

  const page = await browser.newPage(buildPageOptions(options.resolution, slideMode));
  await gotoStaticSlide(page, `file://${filePath}`, fs.readFileSync(filePath, 'utf8'));

  const bodyDimensions = await page.evaluate(() => {
    const body = document.body;
    const style = window.getComputedStyle(body);
    return {
      width: parseFloat(style.width),
      height: parseFloat(style.height),
    };
  });

  await page.setViewportSize({
    width: normalizeDimension(bodyDimensions.width, fallbackSize.width),
    height: normalizeDimension(bodyDimensions.height, fallbackSize.height),
  });

  const screenshot = await page.screenshot({ type: 'png' });
  await page.close();

  const targetSize = getTargetRasterSize(options.resolution, slideMode);

  const resized = await sharp(screenshot)
    .resize(targetSize.width, targetSize.height, { fit: 'fill' })
    .png()
    .toBuffer();

  const tmpPath = path.join(process.env.TMPDIR || '/tmp', `slide-${Date.now()}-${Math.random().toString(36).slice(2)}.png`);
  fs.writeFileSync(tmpPath, resized);

  const slide = pres.addSlide();
  slide.addImage({
    path: tmpPath,
    x: 0,
    y: 0,
    w: '100%',
    h: '100%',
  });

  return tmpPath;
}

async function main(argv = process.argv.slice(2)) {
  const options = parseArgs(argv);
  if (options.help) {
    printUsage();
    return;
  }

  const pres = new PptxGenJS();
  const { pptxSizeIn } = getSlideModeConfig(options.mode);
  pres.defineLayout({
    name: 'SLIDES_GRAB_DYNAMIC',
    width: pptxSizeIn.width,
    height: pptxSizeIn.height,
  });
  pres.layout = 'SLIDES_GRAB_DYNAMIC';

  const slidesDir = path.resolve(process.cwd(), options.slidesDir);
  const { ensureSlidesPassValidation } = await import('../scripts/validate-slides.js');
  await ensureSlidesPassValidation(slidesDir, { exportLabel: 'PPTX export', slideMode: options.mode });
  const files = getHtmlSlides(slidesDir);

  console.log(`Converting ${files.length} slides...`);

  const browser = await chromium.launch();
  const tmpFiles = [];

  for (const file of files) {
    const filePath = path.join(slidesDir, file);
    console.log(`  Processing: ${file}`);
    try {
      const tmpPath = await convertSlide(filePath, pres, browser, { mode: options.mode, resolution: options.resolution });
      tmpFiles.push(tmpPath);
      console.log(`    ✓ ${file} done`);
    } catch (error) {
      console.error(`    ✗ ${file} error: ${error.message}`);
    }
  }

  await browser.close();

  const outputFile = path.resolve(process.cwd(), options.output);
  await pres.writeFile({ fileName: outputFile });
  console.log(`\nSaved: ${outputFile}`);

  for (const filePath of tmpFiles) {
    try {
      fs.unlinkSync(filePath);
    } catch {}
  }
}

module.exports = {
  buildPageOptions,
  getHtmlSlides,
  getTargetRasterSize,
  main,
  parseArgs,
};
