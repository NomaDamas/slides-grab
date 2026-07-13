#!/usr/bin/env node
/* eslint-disable no-console */

const fs = require('node:fs');
const path = require('node:path');

const STDIN_HANG_DETECT_MS = 200;
const SLIDE_FILE_PATTERN = /^slide-.*\.html$/i;
const HEADLINE_TAG_PATTERN = /<h1\b[^>]*>([\s\S]*?)<\/h1>/i;

function parseFlag(argv, longFlag, shortFlag) {
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === longFlag || (shortFlag && arg === shortFlag)) {
      return argv[i + 1];
    }
    if (longFlag && arg.startsWith(`${longFlag}=`)) {
      return arg.slice(longFlag.length + 1);
    }
  }
  return undefined;
}

function detectStdinClosed() {
  return new Promise((resolve) => {
    if (process.stdin.isTTY) {
      resolve(true);
      return;
    }

    let resolved = false;
    const finish = (value) => {
      if (resolved) return;
      resolved = true;
      resolve(value);
    };

    const timer = setTimeout(() => finish(false), STDIN_HANG_DETECT_MS);
    timer.unref?.();

    process.stdin.once('end', () => {
      clearTimeout(timer);
      finish(true);
    });
    process.stdin.on('data', () => {});
    try {
      process.stdin.resume();
    } catch {
      finish(true);
    }
  });
}

function findRequestedSlide(rootDir, prompt) {
  const match = prompt.match(/^Edit (.+) only\.$/m);
  if (!match) return undefined;
  const slidePath = path.resolve(rootDir, match[1]);
  if (!SLIDE_FILE_PATTERN.test(path.basename(slidePath)) || !fs.existsSync(slidePath)) return undefined;
  const stat = fs.lstatSync(slidePath);
  if (!stat.isFile() || stat.isSymbolicLink()) return undefined;
  const rootPath = fs.realpathSync(rootDir);
  const realSlidePath = fs.realpathSync(slidePath);
  const relativePath = path.relative(rootPath, realSlidePath);
  if (relativePath.startsWith('..') || path.isAbsolute(relativePath)) return undefined;
  return realSlidePath;
}

function applyMarkerEdit(slidePath, marker) {
  const original = fs.readFileSync(slidePath, 'utf8');
  let edited;
  if (HEADLINE_TAG_PATTERN.test(original)) {
    edited = original.replace(HEADLINE_TAG_PATTERN, (_match, _inner) => `<h1>${marker}</h1>`);
  } else {
    edited = `${original}\n<!-- ${marker} -->\n`;
  }
  fs.writeFileSync(slidePath, edited, 'utf8');
}

async function main() {
  const argv = process.argv.slice(2);

  const stdinClosed = await detectStdinClosed();
  if (!stdinClosed) {
    process.stderr.write('Reading additional input from stdin...\n');
    await new Promise(() => {});
    return;
  }

  const model = parseFlag(argv, '--model', '-m') || 'unknown-model';
  const cwd = process.cwd();
  const prompt = argv[argv.length - 1] || '';
  const slidePath = findRequestedSlide(cwd, prompt);

  if (!slidePath) {
    process.stderr.write(`[fake-codex] requested slide path not found in prompt under ${cwd}\n`);
    process.exit(2);
  }

  const marker = `[EDITED-BY-${model.trim()}]`;
  applyMarkerEdit(slidePath, marker);

  process.stdout.write(`[fake-codex] model=${model.trim()} edited=1 marker=${marker}\n`);
  process.exit(0);
}

main().catch((error) => {
  process.stderr.write(`[fake-codex] fatal: ${error?.message || error}\n`);
  process.exit(1);
});
