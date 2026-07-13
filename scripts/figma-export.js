#!/usr/bin/env node

import { existsSync, readdirSync } from 'node:fs';
import { createRequire } from 'node:module';
import { resolve } from 'node:path';

import PptxGenJS from 'pptxgenjs';

import {
  configureFigmaExportPresentation,
  ensureOutputDirectory,
  getFigmaImportCaveats,
  normalizeFigmaOutput,
  SLIDE_FILE_PATTERN,
  sortFigmaSlideFiles,
} from '../src/figma.js';

const require = createRequire(import.meta.url);
const html2pptx = require('../src/html2pptx.cjs');
const { launchBrowser } = html2pptx;
const { DEFAULT_SLIDE_MODE, getSlideModeChoices, normalizeSlideMode } = require('../src/slide-mode.cjs');

const DEFAULT_SLIDES_DIR = 'slides';

function printUsage() {
  process.stdout.write(
    [
      'Usage: slides-grab figma [options]',
      '',
      'Options:',
      `  --slides-dir <path>  Slide directory (default: ${DEFAULT_SLIDES_DIR})`,
      '  --output <path>      Output PPTX file (default: <slides-dir>-figma.pptx)',
      `  --mode <mode>        Slide mode: ${getSlideModeChoices().join('|')} (default: ${DEFAULT_SLIDE_MODE})`,
      '  -h, --help           Show this help message',
      '',
      'Exports an experimental / unstable Figma Slides importable PPTX using the existing html2pptx pipeline.',
      'Treat both PPTX and Figma export as best-effort only.',
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
    output: '',
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

    throw new Error(`Unknown option: ${arg}`);
  }

  if (typeof options.slidesDir !== 'string' || options.slidesDir.trim() === '') {
    throw new Error('--slides-dir must be a non-empty string.');
  }

  options.slidesDir = options.slidesDir.trim();
  options.mode = normalizeSlideMode(options.mode);
  options.output = normalizeFigmaOutput(options.slidesDir, options.output);
  return options;
}

function getHtmlSlides(slidesDir) {
  if (!existsSync(slidesDir)) {
    throw new Error(`Slides directory not found: ${slidesDir}`);
  }

  const files = readdirSync(slidesDir)
    .filter((fileName) => SLIDE_FILE_PATTERN.test(fileName))
    .sort(sortFigmaSlideFiles);

  if (files.length === 0) {
    throw new Error(`No slide-*.html files found in ${slidesDir}`);
  }

  return files;
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  if (options.help) {
    printUsage();
    return;
  }

  const slidesDir = resolve(process.cwd(), options.slidesDir);
  const outputFile = resolve(process.cwd(), options.output);
  const files = getHtmlSlides(slidesDir);

  const pres = new PptxGenJS();
  configureFigmaExportPresentation(pres, options.mode);

  console.log(`Exporting ${files.length} slide(s) for Figma from ${slidesDir}`);

  const browser = await launchBrowser(process.env.TMPDIR || '/tmp');
  try {
    for (const file of files) {
      const filePath = resolve(slidesDir, file);
      console.log(`  Processing: ${file}`);
      await html2pptx(filePath, pres, { browser });
    }
  } finally {
    await browser.close();
  }

  await ensureOutputDirectory(outputFile);
  await pres.writeFile({ fileName: outputFile });

  console.log(`\nSaved Figma-importable PPTX: ${outputFile}`);
  console.log('\nFigma import caveats:');
  for (const caveat of getFigmaImportCaveats()) {
    console.log(`- ${caveat}`);
  }
  console.log('\nManual import: Figma Slides -> Import -> select the generated .pptx file.');
}

main().catch((error) => {
  console.error(`[slides-grab] ${error.message}`);
  process.exit(1);
});
