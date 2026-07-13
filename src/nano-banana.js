import { mkdir, writeFile } from 'node:fs/promises';
import { extname, isAbsolute, join, relative, resolve } from 'node:path';

import { getSlidesDir } from './resolve.js';
import {
  GOD_TIBO_DEFAULT_MODEL,
  GOD_TIBO_PROVIDER_AUTO,
  generateGodTiboImage,
  getGodTiboFallbackMessage,
} from './god-tibo-imagen.js';

export const IMAGE_PROVIDER_GOD_TIBO = 'god-tibo';
export const IMAGE_PROVIDER_CODEX = 'codex';
export const IMAGE_PROVIDER_NANO_BANANA = 'nano-banana';
export const DEFAULT_IMAGE_PROVIDER = IMAGE_PROVIDER_GOD_TIBO;
export const DEFAULT_GOD_TIBO_MODEL = GOD_TIBO_DEFAULT_MODEL;
export const DEFAULT_CODEX_IMAGE_MODEL = 'gpt-image-2';
export const DEFAULT_CODEX_IMAGE_SIZE = 'auto';
export const DEFAULT_CODEX_IMAGE_BASE_URL = 'https://api.openai.com/v1';
export const DEFAULT_NANO_BANANA_MODEL = 'gemini-3-pro-image-preview';
export const DEFAULT_NANO_BANANA_ASPECT_RATIO = '16:9';
export const DEFAULT_NANO_BANANA_IMAGE_SIZE = '4K';
const VALID_IMAGE_SIZES = new Set(['2K', '4K']);
const ENV_NAME_PATTERN = /^[A-Za-z_][A-Za-z0-9_]*$/;

const PROVIDER_ALIASES = new Map([
  ['god-tibo', IMAGE_PROVIDER_GOD_TIBO],
  ['godtibo', IMAGE_PROVIDER_GOD_TIBO],
  ['codex-cli', IMAGE_PROVIDER_GOD_TIBO],
  ['codex', IMAGE_PROVIDER_CODEX],
  ['openai', IMAGE_PROVIDER_CODEX],
  ['nano-banana', IMAGE_PROVIDER_NANO_BANANA],
  ['gemini', IMAGE_PROVIDER_NANO_BANANA],
]);

const VALID_PROVIDERS = new Set([
  IMAGE_PROVIDER_GOD_TIBO,
  IMAGE_PROVIDER_CODEX,
  IMAGE_PROVIDER_NANO_BANANA,
]);

export function normalizeImageProvider(value) {
  const trimmed = String(value || '').trim().toLowerCase();
  if (!trimmed) return '';
  return PROVIDER_ALIASES.get(trimmed) || trimmed;
}

const MIME_TYPE_TO_EXTENSION = new Map([
  ['image/png', '.png'],
  ['image/jpeg', '.jpg'],
  ['image/webp', '.webp'],
]);

function readOptionValue(argv, index, option) {
  const value = argv[index + 1];
  if (!value || value.startsWith('--')) {
    throw new Error(`${option} is missing a value.`);
  }
  return value;
}

export function getNanoBananaUsage() {
  return [
    'Usage: slides-grab image --prompt <text> [options]',
    '',
    'Generate a deck-local image asset and save it into <slides-dir>/assets/.',
    'Default provider: god-tibo-imagen (uses your local Codex ChatGPT login — no OpenAI/Google API key required).',
    '',
    'Options:',
    '  --prompt <text>         Required text prompt for image generation',
    '  --slides-dir <path>     Slides directory (default: slides)',
    '  --output <path>         Optional explicit output path inside <slides-dir>/assets/',
    '  --name <slug>           Optional asset basename without extension',
    `  --provider <name>       Image provider: god-tibo (default), codex (OpenAI), or nano-banana.`,
    '                          Aliases: codex-cli → god-tibo, openai → codex, gemini → nano-banana.',
    `  --model <id>            Model id (default: ${DEFAULT_GOD_TIBO_MODEL} for god-tibo, ${DEFAULT_CODEX_IMAGE_MODEL} for codex, ${DEFAULT_NANO_BANANA_MODEL} for nano-banana)`,
    `  --aspect-ratio <ratio>  Image aspect ratio; for god-tibo it is injected as a prompt hint, for codex it maps to the nearest supported OpenAI size (default: ${DEFAULT_NANO_BANANA_ASPECT_RATIO})`,
    `  --image-size <size>     Nano Banana image size preset: 2K or 4K (default: ${DEFAULT_NANO_BANANA_IMAGE_SIZE})`,
    '  -h, --help              Show this help text',
    '  --base-url <url>      Codex/OpenAI-compatible base URL (default: OPENAI_IMAGE_BASE_URL, OPENAI_BASE_URL, then https://api.openai.com/v1)',
    '  --api-key-env <name>   Env var to read for Codex/OpenAI-compatible provider API key',
    '  --reference <path>     Reference image path(s) for style-guided generation (god-tibo only, repeatable)',
    '',
    'Auth:',
    '  Default (god-tibo): run `codex login` once to populate ~/.codex/auth.json. No OpenAI/Google API key required;',
    '                      requires a Codex/ChatGPT account entitled to image generation.',
    '  Codex/OpenAI provider: set OPENAI_API_KEY.',
    '                       Compatible endpoints may use --base-url, OPENAI_IMAGE_BASE_URL, OPENAI_BASE_URL, and --api-key-env.',
    '  Nano Banana provider: set GOOGLE_API_KEY or GEMINI_API_KEY.',
    '',
    'WARNING: god-tibo-imagen calls an unsupported private Codex backend that may break without notice.',
  ].join('\n');
}

export function parseNanoBananaCliArgs(argv) {
  const parsed = {
    prompt: '',
    slidesDir: 'slides',
    output: '',
    name: '',
    provider: DEFAULT_IMAGE_PROVIDER,
    model: '',
    aspectRatio: DEFAULT_NANO_BANANA_ASPECT_RATIO,
    imageSize: DEFAULT_NANO_BANANA_IMAGE_SIZE,
    help: false,
    baseUrl: '',
    apiKeyEnv: '',
    referenceImages: [],
  };

  const args = Array.isArray(argv) ? [...argv] : [];

  for (let i = 0; i < args.length; i += 1) {
    const arg = args[i];

    if (arg === '--help' || arg === '-h') {
      parsed.help = true;
      continue;
    }

    if (arg === '--prompt') {
      parsed.prompt = readOptionValue(args, i, '--prompt');
      i += 1;
      continue;
    }
    if (arg.startsWith('--prompt=')) {
      parsed.prompt = arg.slice('--prompt='.length);
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

    if (arg === '--output') {
      parsed.output = readOptionValue(args, i, '--output');
      i += 1;
      continue;
    }
    if (arg.startsWith('--output=')) {
      parsed.output = arg.slice('--output='.length);
      continue;
    }

    if (arg === '--name') {
      parsed.name = readOptionValue(args, i, '--name');
      i += 1;
      continue;
    }
    if (arg.startsWith('--name=')) {
      parsed.name = arg.slice('--name='.length);
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

    if (arg === '--aspect-ratio') {
      parsed.aspectRatio = readOptionValue(args, i, '--aspect-ratio');
      i += 1;
      continue;
    }
    if (arg.startsWith('--aspect-ratio=')) {
      parsed.aspectRatio = arg.slice('--aspect-ratio='.length);
      continue;
    }

    if (arg === '--image-size') {
      parsed.imageSize = readOptionValue(args, i, '--image-size').toUpperCase();
      i += 1;
      continue;
    }
    if (arg.startsWith('--image-size=')) {
      parsed.imageSize = arg.slice('--image-size='.length).toUpperCase();
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

    if (arg === '--api-key-env') {
      parsed.apiKeyEnv = readOptionValue(args, i, '--api-key-env');
      i += 1;
      continue;
    }
    if (arg.startsWith('--api-key-env=')) {
      parsed.apiKeyEnv = arg.slice('--api-key-env='.length);
      continue;
    }


    if (arg === '--reference' || arg === '--reference-image') {
      parsed.referenceImages.push(readOptionValue(args, i, arg));
      i += 1;
      continue;
    }
    if (arg.startsWith('--reference=')) {
      parsed.referenceImages.push(arg.slice('--reference='.length));
      continue;
    }
    if (arg.startsWith('--reference-image=')) {
      parsed.referenceImages.push(arg.slice('--reference-image='.length));
      continue;
    }

    throw new Error(`Unknown option: ${arg}`);
  }

  if (parsed.help) {
    return parsed;
  }

  if (typeof parsed.prompt !== 'string' || parsed.prompt.trim() === '') {
    throw new Error('--prompt must be a non-empty string.');
  }
  parsed.prompt = parsed.prompt.trim();

  if (typeof parsed.slidesDir !== 'string' || parsed.slidesDir.trim() === '') {
    throw new Error('--slides-dir must be a non-empty string.');
  }
  parsed.slidesDir = parsed.slidesDir.trim();

  if (typeof parsed.output !== 'string') {
    throw new Error('--output must be a string.');
  }
  parsed.output = parsed.output.trim();

  if (typeof parsed.name !== 'string') {
    throw new Error('--name must be a string.');
  }
  parsed.name = parsed.name.trim();

  if (typeof parsed.provider !== 'string' || parsed.provider.trim() === '') {
    throw new Error('--provider must be a non-empty string.');
  }
  parsed.provider = normalizeImageProvider(parsed.provider);
  if (!VALID_PROVIDERS.has(parsed.provider)) {
    throw new Error(`Unknown --provider value: ${parsed.provider}. Expected god-tibo, codex, or nano-banana.`);
  }

  if (typeof parsed.model !== 'string') {
    throw new Error('--model must be a string.');
  }
  if (!parsed.model.trim()) {
    if (parsed.provider === IMAGE_PROVIDER_GOD_TIBO) {
      parsed.model = DEFAULT_GOD_TIBO_MODEL;
    } else if (parsed.provider === IMAGE_PROVIDER_NANO_BANANA) {
      parsed.model = DEFAULT_NANO_BANANA_MODEL;
    } else {
      parsed.model = DEFAULT_CODEX_IMAGE_MODEL;
    }
  } else {
    parsed.model = parsed.model.trim();
  }

  if (typeof parsed.aspectRatio !== 'string' || parsed.aspectRatio.trim() === '') {
    throw new Error('--aspect-ratio must be a non-empty string.');
  }
  parsed.aspectRatio = parsed.aspectRatio.trim();

  if (!VALID_IMAGE_SIZES.has(parsed.imageSize)) {
    throw new Error(`Unknown --image-size value: ${parsed.imageSize}. Expected 2K or 4K.`);
  }

  if (typeof parsed.baseUrl !== 'string') {
    throw new Error('--base-url must be a string.');
  }
  parsed.baseUrl = parsed.baseUrl.trim();

  if (typeof parsed.apiKeyEnv !== 'string') {
    throw new Error('--api-key-env must be a string.');
  }
  parsed.apiKeyEnv = parsed.apiKeyEnv.trim();
  if (parsed.apiKeyEnv && !ENV_NAME_PATTERN.test(parsed.apiKeyEnv)) {
    throw new Error('--api-key-env must be a valid environment variable name.');
  }

  return parsed;
}

export function resolveCodexApiKey(env = process.env, { apiKeyEnv = '' } = {}) {
  const explicitEnvName = typeof apiKeyEnv === 'string' ? apiKeyEnv.trim() : '';
  const candidates = explicitEnvName
    ? [explicitEnvName, 'OPENAI_IMAGE_API_KEY', 'OPENAI_API_KEY']
    : ['OPENAI_IMAGE_API_KEY', 'OPENAI_API_KEY'];

  for (const name of candidates) {
    const value = typeof env?.[name] === 'string' ? env[name].trim() : '';
    if (value) {
      return { apiKey: value, source: name };
    }
  }

  return { apiKey: '', source: '' };
}

export function resolveCodexBaseUrl({ baseUrl = '', env = process.env } = {}) {
  const explicitBaseUrl = typeof baseUrl === 'string' ? baseUrl.trim() : '';
  if (explicitBaseUrl) {
    return { baseUrl: explicitBaseUrl, source: '--base-url' };
  }

  const imageBaseUrl = typeof env?.OPENAI_IMAGE_BASE_URL === 'string' ? env.OPENAI_IMAGE_BASE_URL.trim() : '';
  if (imageBaseUrl) {
    return { baseUrl: imageBaseUrl, source: 'OPENAI_IMAGE_BASE_URL' };
  }

  const openAiBaseUrl = typeof env?.OPENAI_BASE_URL === 'string' ? env.OPENAI_BASE_URL.trim() : '';
  if (openAiBaseUrl) {
    return { baseUrl: openAiBaseUrl, source: 'OPENAI_BASE_URL' };
  }

  return { baseUrl: DEFAULT_CODEX_IMAGE_BASE_URL, source: 'default' };
}

export function resolveNanoBananaApiKey(env = process.env) {
  const googleApiKey = typeof env?.GOOGLE_API_KEY === 'string' ? env.GOOGLE_API_KEY.trim() : '';
  if (googleApiKey) {
    return { apiKey: googleApiKey, source: 'GOOGLE_API_KEY' };
  }

  const geminiApiKey = typeof env?.GEMINI_API_KEY === 'string' ? env.GEMINI_API_KEY.trim() : '';
  if (geminiApiKey) {
    return { apiKey: geminiApiKey, source: 'GEMINI_API_KEY' };
  }

  return { apiKey: '', source: '' };
}

export function getNanoBananaFallbackMessage(reason) {
  const summary = typeof reason === 'string' && reason.trim() ? reason.trim() : 'Nano Banana image generation failed.';
  return `${summary} Nano Banana is the fallback provider: set GOOGLE_API_KEY (or GEMINI_API_KEY), or fall back to web search + download the chosen image into ./assets/<file>.`;
}

export function getCodexFallbackMessage(reason) {
  const summary = typeof reason === 'string' && reason.trim() ? reason.trim() : 'Codex image generation failed.';
  return `${summary} The Codex/OpenAI-compatible provider requires OPENAI_API_KEY (or OPENAI_IMAGE_API_KEY / --api-key-env). Configure compatible endpoints with --base-url, OPENAI_IMAGE_BASE_URL, or OPENAI_BASE_URL. Nano Banana remains available as a fallback with GOOGLE_API_KEY or GEMINI_API_KEY. If image generation credentials are unavailable, use web search and download the chosen image into ./assets/<file>.`;
}

function parseAspectRatioOrientation(aspectRatio) {
  const match = /^(\d+(?:\.\d+)?):(\d+(?:\.\d+)?)$/.exec(String(aspectRatio || '').trim());
  if (!match) {
    return 'landscape';
  }

  const width = Number(match[1]);
  const height = Number(match[2]);
  if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) {
    return 'landscape';
  }

  if (Math.abs(width - height) < Number.EPSILON) {
    return 'square';
  }
  return width > height ? 'landscape' : 'portrait';
}

export function resolveCodexImageSize({
  aspectRatio = DEFAULT_NANO_BANANA_ASPECT_RATIO,
  size = DEFAULT_CODEX_IMAGE_SIZE,
} = {}) {
  if (size && size !== 'auto') {
    return size;
  }

  const orientation = parseAspectRatioOrientation(aspectRatio);
  if (orientation === 'square') {
    return '1024x1024';
  }
  if (orientation === 'portrait') {
    return '1024x1536';
  }
  return '1536x1024';
}

export function buildCodexImageApiRequest({
  prompt,
  model = DEFAULT_CODEX_IMAGE_MODEL,
  aspectRatio = DEFAULT_NANO_BANANA_ASPECT_RATIO,
  size = DEFAULT_CODEX_IMAGE_SIZE,
}) {
  return {
    model,
    prompt,
    size: resolveCodexImageSize({ aspectRatio, size }),
  };
}

export function buildNanoBananaApiRequest({ prompt, aspectRatio, imageSize }) {
  return {
    contents: [
      {
        parts: [{ text: prompt }],
      },
    ],
    generationConfig: {
      imageConfig: {
        aspectRatio,
        imageSize,
      },
    },
  };
}

function sanitizeAssetName(value) {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .replace(/-{2,}/g, '-')
    .slice(0, 80);
}

function pickAssetBaseName({ prompt, name, provider = IMAGE_PROVIDER_NANO_BANANA }) {
  const preferred = sanitizeAssetName(name || '');
  if (preferred) return preferred;

  const fromPrompt = sanitizeAssetName(prompt);
  let prefix;
  if (provider === IMAGE_PROVIDER_GOD_TIBO) {
    prefix = 'god-tibo';
  } else if (provider === IMAGE_PROVIDER_CODEX) {
    prefix = 'codex';
  } else {
    prefix = 'nano-banana';
  }
  return fromPrompt ? `${prefix}-${fromPrompt}` : `${prefix}-generated-image`;
}

function getExtensionFromMimeType(mimeType) {
  return MIME_TYPE_TO_EXTENSION.get((mimeType || '').toLowerCase()) || '.png';
}

function ensureInsideDirectory(filePath, directoryPath) {
  const relativePath = relative(directoryPath, filePath);
  return relativePath !== '' && !relativePath.startsWith('..') && !isAbsolute(relativePath);
}

function resolveRequestedOutputPath(output, assetsDir) {
  const trimmed = output.trim();
  if (isAbsolute(trimmed)) {
    return resolve(trimmed);
  }

  const isBareFileName = !/[\\/]/.test(trimmed);
  if (isBareFileName) {
    return resolve(assetsDir, trimmed);
  }

  if (/^(?:\.\/)?assets[\\/]/.test(trimmed)) {
    const normalized = trimmed
      .replace(/^[.][\\/]/, '')
      .replace(/^assets[\\/]/, '');
    return resolve(assetsDir, normalized);
  }

  const cwdRelativePath = resolve(trimmed);
  if (ensureInsideDirectory(cwdRelativePath, assetsDir)) {
    return cwdRelativePath;
  }

  return resolve(assetsDir, trimmed);
}

export function resolveNanoBananaOutputPath({
  slidesDir,
  prompt,
  output = '',
  name = '',
  mimeType = 'image/png',
  provider = IMAGE_PROVIDER_NANO_BANANA,
}) {
  const absoluteSlidesDir = resolve(slidesDir);
  const assetsDir = join(absoluteSlidesDir, 'assets');
  const extension = getExtensionFromMimeType(mimeType);

  let outputPath;
  if (output) {
    const requestedPath = resolveRequestedOutputPath(output, assetsDir);
    if (!ensureInsideDirectory(requestedPath, assetsDir)) {
      throw new Error(`Generated images must be saved inside ${assetsDir}.`);
    }
    outputPath = extname(requestedPath) ? requestedPath : `${requestedPath}${extension}`;
  } else {
    outputPath = join(assetsDir, `${pickAssetBaseName({ prompt, name, provider })}${extension}`);
  }

  if (!ensureInsideDirectory(outputPath, assetsDir)) {
    throw new Error(`Generated images must be saved inside ${assetsDir}.`);
  }

  return {
    assetsDir,
    outputPath,
    relativeRef: `./assets/${relative(assetsDir, outputPath).replace(/\\/g, '/')}`,
  };
}

export function extractCodexGeneratedImage(payload) {
  const images = Array.isArray(payload?.data) ? payload.data : [];
  for (const image of images) {
    if (typeof image?.b64_json === 'string' && image.b64_json.trim()) {
      return {
        mimeType: 'image/png',
        bytes: Buffer.from(image.b64_json, 'base64'),
      };
    }
  }

  throw new Error('Codex image generation response did not include an image payload.');
}

export function extractGeneratedImage(payload) {
  const candidates = Array.isArray(payload?.candidates) ? payload.candidates : [];

  for (const candidate of candidates) {
    const parts = Array.isArray(candidate?.content?.parts) ? candidate.content.parts : [];
    for (const part of parts) {
      const inlineData = part?.inlineData || part?.inline_data;
      if (!inlineData?.data) continue;

      return {
        mimeType: inlineData.mimeType || inlineData.mime_type || 'image/png',
        bytes: Buffer.from(inlineData.data, 'base64'),
      };
    }
  }

  throw new Error('Nano Banana API response did not include an image payload.');
}

const CODEX_IMAGE_ENDPOINT_PATH = '/images/generations';

export function buildCodexImageEndpoint(baseUrl = DEFAULT_CODEX_IMAGE_BASE_URL) {
  const value = String(baseUrl || DEFAULT_CODEX_IMAGE_BASE_URL).trim() || DEFAULT_CODEX_IMAGE_BASE_URL;
  const url = new URL(value);
  const path = url.pathname.replace(/\/+$/, '');
  if (/\/images\/generations$/i.test(path)) {
    url.pathname = path;
  } else if (/\/v1$/i.test(path)) {
    url.pathname = `${path}${CODEX_IMAGE_ENDPOINT_PATH}`;
  } else {
    url.pathname = `${path}/v1${CODEX_IMAGE_ENDPOINT_PATH}`.replace(/\/+/g, '/');
  }
  url.search = '';
  url.hash = '';
  return url.toString();
}

function buildNanoBananaEndpoint(model) {
  return `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`;
}

function getApiErrorMessage(payload, status) {
  const message = payload?.error?.message || payload?.message;
  if (typeof message === 'string' && message.trim()) {
    return message.trim();
  }
  return `HTTP ${status}`;
}

export async function generateCodexImage({
  prompt,
  apiKey,
  model = DEFAULT_CODEX_IMAGE_MODEL,
  aspectRatio = DEFAULT_NANO_BANANA_ASPECT_RATIO,
  size = DEFAULT_CODEX_IMAGE_SIZE,
  fetchImpl = globalThis.fetch,
  baseUrl = DEFAULT_CODEX_IMAGE_BASE_URL,
}) {
  if (typeof fetchImpl !== 'function') {
    throw new Error('Global fetch is unavailable in this runtime.');
  }

  const response = await fetchImpl(buildCodexImageEndpoint(baseUrl), {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify(buildCodexImageApiRequest({ prompt, model, aspectRatio, size })),
  });

  const payload = await response.json();
  if (!response.ok) {
    throw new Error(`Codex image generation request failed: ${getApiErrorMessage(payload, response.status)}.`);
  }

  return extractCodexGeneratedImage(payload);
}

export async function generateNanoBananaImage({
  prompt,
  apiKey,
  model = DEFAULT_NANO_BANANA_MODEL,
  aspectRatio = DEFAULT_NANO_BANANA_ASPECT_RATIO,
  imageSize = DEFAULT_NANO_BANANA_IMAGE_SIZE,
  fetchImpl = globalThis.fetch,
}) {
  if (typeof fetchImpl !== 'function') {
    throw new Error('Global fetch is unavailable in this runtime.');
  }

  try {
    const response = await fetchImpl(buildNanoBananaEndpoint(model), {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-goog-api-key': apiKey,
      },
      body: JSON.stringify(buildNanoBananaApiRequest({ prompt, aspectRatio, imageSize })),
    });

    const payload = await response.json();
    if (!response.ok) {
      throw new Error(`Nano Banana API request failed: ${getApiErrorMessage(payload, response.status)}.`);
    }

    return extractGeneratedImage(payload);
  } catch (error) {
    throw new Error(getNanoBananaFallbackMessage(error.message));
  }
}

function argvIncludesOption(argv, optionName) {
  const args = Array.isArray(argv) ? argv : [];
  return args.some((arg) => arg === optionName || String(arg).startsWith(`${optionName}=`));
}

async function generateNanoBananaFallbackImage({ options, apiKey, fetchImpl }) {
  return generateNanoBananaImage({
    prompt: options.prompt,
    apiKey,
    model: DEFAULT_NANO_BANANA_MODEL,
    aspectRatio: options.aspectRatio,
    imageSize: options.imageSize,
    fetchImpl,
  });
}

function resolveGodTiboModel(options) {
  return options.model && options.model.trim() ? options.model : DEFAULT_GOD_TIBO_MODEL;
}

async function generateGodTiboFallbackImage({ options, generateGodTiboImageImpl }) {
  return generateGodTiboImageImpl({
    prompt: options.prompt,
    model: resolveGodTiboModel(options),
    aspectRatio: options.aspectRatio,
    providerMode: GOD_TIBO_PROVIDER_AUTO,
    referenceImages: options.referenceImages || [],
  });
}

function resolveCodexModel(options) {
  return options.model && options.model.trim() && options.model !== DEFAULT_GOD_TIBO_MODEL
    ? options.model
    : DEFAULT_CODEX_IMAGE_MODEL;
}

async function generateCodexFallbackImage({ options, apiKey, fetchImpl, requestedNanoBananaImageSize, baseUrl }) {
  if (requestedNanoBananaImageSize) {
    throw new Error(
      '--image-size is only supported by the Nano Banana provider; Codex/OpenAI maps --aspect-ratio to the nearest supported OpenAI image size. Use --provider nano-banana for 2K or 4K presets.',
    );
  }
  return generateCodexImage({
    prompt: options.prompt,
    apiKey,
    model: resolveCodexModel(options),
    aspectRatio: options.aspectRatio,
    fetchImpl,
    baseUrl,
  });
}

export async function saveNanoBananaImage({
  prompt,
  slidesDir,
  output = '',
  name = '',
  mimeType,
  bytes,
  provider = IMAGE_PROVIDER_NANO_BANANA,
}) {
  const target = resolveNanoBananaOutputPath({ slidesDir, prompt, output, name, mimeType, provider });
  await mkdir(target.assetsDir, { recursive: true });
  await writeFile(target.outputPath, bytes);
  return target;
}

export async function runNanoBananaCli(argv = process.argv.slice(2), {
  env = process.env,
  fetchImpl = globalThis.fetch,
  stdout = process.stdout,
  generateGodTiboImageImpl = generateGodTiboImage,
} = {}) {
  const options = parseNanoBananaCliArgs(argv);
  if (options.help) {
    stdout.write(`${getNanoBananaUsage()}\n`);
    return null;
  }

  let generated;
  let providerUsed = options.provider;
  let modelUsed = options.model;
  const requestedNanoBananaImageSize = argvIncludesOption(argv, '--image-size');
  const fallbackNotices = [];

  if (options.provider === IMAGE_PROVIDER_GOD_TIBO) {
    try {
      generated = await generateGodTiboFallbackImage({ options, generateGodTiboImageImpl });
      modelUsed = resolveGodTiboModel(options);
    } catch (godTiboError) {
      const codexResolution = resolveCodexApiKey(env, { apiKeyEnv: options.apiKeyEnv });
      if (codexResolution.apiKey) {
        fallbackNotices.push(`god-tibo failed (${godTiboError.message?.split('.')[0] || 'error'}); falling back to Codex/OpenAI.`);
        try {
          generated = await generateCodexFallbackImage({
            options,
            apiKey: codexResolution.apiKey,
            fetchImpl,
            requestedNanoBananaImageSize,
            baseUrl: resolveCodexBaseUrl({ baseUrl: options.baseUrl, env }).baseUrl,
          });
          providerUsed = IMAGE_PROVIDER_CODEX;
          modelUsed = resolveCodexModel(options);
        } catch (codexError) {
          const nanoResolution = resolveNanoBananaApiKey(env);
          if (!nanoResolution.apiKey) {
            throw new Error(getGodTiboFallbackMessage(codexError.message));
          }
          fallbackNotices.push(`Codex/OpenAI fallback failed; falling back to Nano Banana.`);
          generated = await generateNanoBananaFallbackImage({ options, apiKey: nanoResolution.apiKey, fetchImpl });
          providerUsed = IMAGE_PROVIDER_NANO_BANANA;
          modelUsed = DEFAULT_NANO_BANANA_MODEL;
        }
      } else {
        const nanoResolution = resolveNanoBananaApiKey(env);
        if (!nanoResolution.apiKey) {
          throw new Error(getGodTiboFallbackMessage(godTiboError.message));
        }
        fallbackNotices.push(`god-tibo failed (${godTiboError.message?.split('.')[0] || 'error'}); falling back to Nano Banana.`);
        generated = await generateNanoBananaFallbackImage({ options, apiKey: nanoResolution.apiKey, fetchImpl });
        providerUsed = IMAGE_PROVIDER_NANO_BANANA;
        modelUsed = DEFAULT_NANO_BANANA_MODEL;
      }
    }
  } else if (options.provider === IMAGE_PROVIDER_CODEX) {
    const { apiKey: codexApiKey } = resolveCodexApiKey(env, { apiKeyEnv: options.apiKeyEnv });
    if (codexApiKey) {
      try {
        generated = await generateCodexFallbackImage({
          options,
          apiKey: codexApiKey,
          fetchImpl,
          requestedNanoBananaImageSize,
          baseUrl: resolveCodexBaseUrl({ baseUrl: options.baseUrl, env }).baseUrl,
        });
        modelUsed = resolveCodexModel(options);
      } catch (error) {
        const { apiKey: fallbackApiKey } = resolveNanoBananaApiKey(env);
        if (!fallbackApiKey) {
          throw new Error(getCodexFallbackMessage(error.message));
        }
        providerUsed = IMAGE_PROVIDER_NANO_BANANA;
        generated = await generateNanoBananaFallbackImage({ options, apiKey: fallbackApiKey, fetchImpl });
        modelUsed = DEFAULT_NANO_BANANA_MODEL;
      }
    } else {
      const { apiKey: fallbackApiKey } = resolveNanoBananaApiKey(env);
      if (!fallbackApiKey) {
        throw new Error(getCodexFallbackMessage(`Codex image generation requires ${options.apiKeyEnv || 'OPENAI_API_KEY'}.`));
      }
      providerUsed = IMAGE_PROVIDER_NANO_BANANA;
      generated = await generateNanoBananaFallbackImage({ options, apiKey: fallbackApiKey, fetchImpl });
      modelUsed = DEFAULT_NANO_BANANA_MODEL;
    }
  } else {
    const { apiKey } = resolveNanoBananaApiKey(env);
    if (!apiKey) {
      throw new Error(getNanoBananaFallbackMessage('Nano Banana image generation requires GOOGLE_API_KEY or GEMINI_API_KEY.'));
    }

    generated = await generateNanoBananaImage({
      prompt: options.prompt,
      apiKey,
      model: options.model,
      aspectRatio: options.aspectRatio,
      imageSize: options.imageSize,
      fetchImpl,
    });
    modelUsed = options.model;
  }

  const target = await saveNanoBananaImage({
    prompt: options.prompt,
    slidesDir: getSlidesDir(options.slidesDir),
    output: options.output,
    name: options.name,
    mimeType: generated.mimeType,
    bytes: generated.bytes,
    provider: providerUsed,
  });

  for (const notice of fallbackNotices) {
    stdout.write(`Fallback: ${notice}\n`);
  }
  stdout.write(`Saved generated image to ${target.outputPath}\n`);
  stdout.write(`Image provider: ${providerUsed}\n`);
  stdout.write(`Reference it from slide HTML as ${target.relativeRef}\n`);
  return { ...target, provider: providerUsed, model: modelUsed };
}
