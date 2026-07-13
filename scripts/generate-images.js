#!/usr/bin/env node

import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  buildImageNativePrompt,
  generateImageNativeSlides,
  parseImageNativeOutline,
} from '../src/image-native.js';
import { IMAGE_PROVIDER_CODEX } from '../src/nano-banana.js';

export {
  buildImageNativePrompt,
  generateImageNativeSlides,
  parseImageNativeOutline,
};

function readOptionValue(argv, index, option) {
  const value = argv[index + 1];
  if (!value || value.startsWith('--')) throw new Error(`${option} is missing a value.`);
  return value;
}

export function parseGenerateImagesCliArgs(argv) {
  const parsed = {
    outline: '',
    slidesDir: 'slides',
    templatePack: '',
    provider: IMAGE_PROVIDER_CODEX,
    model: '',
    baseUrl: '',
    help: false,
  };

  const args = Array.isArray(argv) ? [...argv] : [];
  for (let i = 0; i < args.length; i += 1) {
    const arg = args[i];
    if (arg === '--help' || arg === '-h') {
      parsed.help = true;
      continue;
    }
    if (arg === '--outline') {
      parsed.outline = readOptionValue(args, i, '--outline');
      i += 1;
      continue;
    }
    if (arg.startsWith('--outline=')) {
      parsed.outline = arg.slice('--outline='.length);
      continue;
    }
    if (arg === '--slides-dir') {
      parsed.slidesDir = readOptionValue(args, i, '--slides-dir');
      i += 1;
      continue;
    }
    if (arg.startsWith('--slides-dir=')) {
      parsed.slidesDir = arg.slice('--slides-dir='.length);
      continue;
    }
    if (arg === '--template-pack') {
      parsed.templatePack = readOptionValue(args, i, '--template-pack');
      i += 1;
      continue;
    }
    if (arg.startsWith('--template-pack=')) {
      parsed.templatePack = arg.slice('--template-pack='.length);
      continue;
    }
    if (arg === '--provider') {
      parsed.provider = readOptionValue(args, i, '--provider');
      i += 1;
      continue;
    }
    if (arg.startsWith('--provider=')) {
      parsed.provider = arg.slice('--provider='.length);
      continue;
    }
    if (arg === '--model') {
      parsed.model = readOptionValue(args, i, '--model');
      i += 1;
      continue;
    }
    if (arg.startsWith('--model=')) {
      parsed.model = arg.slice('--model='.length);
      continue;
    }
    if (arg === '--base-url') {
      parsed.baseUrl = readOptionValue(args, i, '--base-url');
      i += 1;
      continue;
    }
    if (arg.startsWith('--base-url=')) {
      parsed.baseUrl = arg.slice('--base-url='.length);
      continue;
    }
    throw new Error(`Unknown option: ${arg}`);
  }

  if (parsed.help) return parsed;
  for (const key of ['outline', 'slidesDir', 'provider']) {
    if (typeof parsed[key] !== 'string' || parsed[key].trim() === '') {
      throw new Error(`--${key.replace(/[A-Z]/g, (m) => `-${m.toLowerCase()}`)} must be a non-empty string.`);
    }
    parsed[key] = parsed[key].trim();
  }
  parsed.templatePack = parsed.templatePack.trim();
  parsed.model = parsed.model.trim();
  parsed.baseUrl = parsed.baseUrl.trim();
  return parsed;
}

export function getGenerateImagesUsage() {
  return [
    'Usage: slides-grab generate-images --outline <path> [options]',
    '',
    'Generate image-native wrapper slides from a slide outline and optional template pack context.',
    '',
    'Options:',
    '  --outline <path>        Markdown slide outline to convert',
    '  --slides-dir <path>     Slide directory (default: slides)',
    '  --template-pack <path>  Optional template-pack.json path; defaults to <slides-dir>/.slides-grab/template-pack.json when present',
    '  --provider <name>       codex (default), openai, or nano-banana',
    '  --model <id>            Optional provider model override',
    '  --base-url <url>        OpenAI-compatible base URL for provider=openai',
    '  -h, --help              Show this help text',
    '',
    'Default provider: codex (uses your local Codex ChatGPT login — no API key required).',
  ].join('\n');
}

export async function main(argv = process.argv.slice(2), options = {}) {
  const parsed = parseGenerateImagesCliArgs(argv);
  const stdout = options.stdout || process.stdout;
  if (parsed.help) {
    stdout.write(`${getGenerateImagesUsage()}\n`);
    return null;
  }
  const result = await generateImageNativeSlides({
    outlinePath: parsed.outline,
    slidesDir: parsed.slidesDir,
    templatePackPath: parsed.templatePack,
    provider: parsed.provider,
    model: parsed.model,
    baseUrl: parsed.baseUrl,
    env: options.env || process.env,
    fetchImpl: options.fetchImpl || globalThis.fetch,
    generateImageImpl: options.generateImageImpl,
  });
  stdout.write(`Generated image-native slides: ${result.slides.length}\n`);
  for (const slide of result.slides) {
    stdout.write(`- ${slide.slideFile} -> ${slide.assetRef} (${slide.provider})\n`);
  }
  return result;
}

const isMain = process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url);

if (isMain) {
  main().catch((error) => {
    console.error(`[slides-grab] ${error.message}`);
    process.exit(1);
  });
}
