import { mkdir, readFile, readFile as readFileAsync, rm } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join, isAbsolute } from 'node:path';
import { tmpdir } from 'node:os';
import { randomUUID } from 'node:crypto';

import {
  createProvider as defaultCreateProvider,
  resolveConfig as defaultResolveConfig,
} from 'god-tibo-imagen';

export const CODEX_DEFAULT_MODEL = 'gpt-5.4';
export const CODEX_PROVIDER_AUTO = 'auto';
export const CODEX_PROVIDER_PRIVATE_CODEX = 'private-codex';
export const CODEX_PROVIDER_CODEX_CLI = 'codex-cli';

const ASPECT_RATIO_HINTS = new Map([
  ['16:9', 'wide landscape 16:9 aspect ratio'],
  ['9:16', 'tall portrait 9:16 aspect ratio'],
  ['1:1', 'square 1:1 aspect ratio'],
  ['4:3', '4:3 aspect ratio'],
  ['3:4', 'portrait 3:4 aspect ratio'],
  ['3:2', 'landscape 3:2 aspect ratio'],
  ['2:3', 'portrait 2:3 aspect ratio'],
]);

export function injectAspectRatioHint(prompt, aspectRatio) {
  if (typeof prompt !== 'string' || prompt.trim() === '') {
    throw new Error('injectAspectRatioHint: prompt must be a non-empty string.');
  }
  if (!aspectRatio || typeof aspectRatio !== 'string') {
    return prompt;
  }
  const trimmed = aspectRatio.trim();
  const explicit = ASPECT_RATIO_HINTS.get(trimmed);
  if (explicit) {
    return `${prompt} (${explicit})`;
  }
  if (/^\d+(?:\.\d+)?:\d+(?:\.\d+)?$/.test(trimmed)) {
    return `${prompt} (${trimmed} aspect ratio)`;
  }
  return prompt;
}

export function resolveCodexConfig({ providerMode = CODEX_PROVIDER_AUTO, resolveConfigImpl = defaultResolveConfig } = {}) {
  return resolveConfigImpl({ provider: providerMode });
}

function isCodexAuthError(error) {
  if (!error || typeof error !== 'object') return false;
  const code = String(error.code || '').toUpperCase();
  if (code === 'UNAUTHORIZED' || code === 'ENOENT') return true;
  const message = String(error.message || '').toLowerCase();
  return (
    message.includes('auth.json') ||
    message.includes('unauthorized') ||
    message.includes('chatgpt auth') ||
    message.includes('codex login')
  );
}

export function getCodexFallbackMessage(reason) {
  const summary = typeof reason === 'string' && reason.trim()
    ? reason.trim()
    : 'codex-imagen image generation failed.';
  return `${summary} codex-imagen is the default image provider and reuses your local Codex ChatGPT login (~/.codex/auth.json). Run \`codex login\` once to enable it. Optional fallbacks: set OPENAI_API_KEY (OpenAI gpt-image-2) or GOOGLE_API_KEY/GEMINI_API_KEY (Nano Banana). If image generation credentials are unavailable, use web search and download the chosen image into ./assets/<file>.`;
}

const MIME_BY_EXTENSION = {
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.gif': 'image/gif',
};

/**
 * Read reference image file paths into data URLs suitable for the Codex
 * /responses input_image blocks. Accepts absolute paths or paths relative
 * to process.cwd(). Already-formed data: URLs and http(s) URLs are passed
 * through as-is.
 */
export async function resolveReferenceImages(paths) {
  const list = Array.isArray(paths) ? paths : [];
  const dataUrls = [];
  for (const entry of list) {
    if (typeof entry !== 'string' || !entry.trim()) continue;
    const value = entry.trim();
    if (value.startsWith('data:') || value.startsWith('http://') || value.startsWith('https://')) {
      dataUrls.push(value);
      continue;
    }
    const resolved = isAbsolute(value) ? value : join(process.cwd(), value);
    if (!existsSync(resolved)) {
      throw new Error(`Reference image not found: ${value} (resolved ${resolved})`);
    }
    const ext = resolved.toLowerCase().match(/\.(png|jpe?g|webp|gif)$/);
    const mime = ext ? MIME_BY_EXTENSION[`.${ext[1]}`] : 'image/png';
    const bytes = await readFileAsync(resolved);
    const base64 = bytes.toString('base64');
    dataUrls.push(`data:${mime};base64,${base64}`);
  }
  return dataUrls;
}

export async function generateCodexImage({
  prompt,
  model = CODEX_DEFAULT_MODEL,
  aspectRatio,
  providerMode = CODEX_PROVIDER_AUTO,
  dryRun = false,
  referenceImages = [],
  deps = {},
} = {}) {
  if (typeof prompt !== 'string' || prompt.trim() === '') {
    throw new Error('generateCodexImage: prompt must be a non-empty string.');
  }

  const createProviderImpl = deps.createProvider || defaultCreateProvider;
  const resolveConfigImpl = deps.resolveConfig || defaultResolveConfig;

  const enrichedPrompt = injectAspectRatioHint(prompt, aspectRatio);
  const config = resolveCodexConfig({ providerMode, resolveConfigImpl });
  const provider = createProviderImpl(config);

  // Reference images are read into data URLs so the codex provider can
  // pass them as input_image blocks in the Codex /responses request.
  // buildResponsesRequest already accepts an images: string[] array of
  // data URLs / URLs — we just need to surface them here.
  const images = await resolveReferenceImages(referenceImages);

  // codex's provider.generateImage writes a PNG to outputPath as a side
  // effect. slides-grab centralizes asset path resolution in
  // saveNanoBananaImage (src/nano-banana.js) - so we route codex's write
  // to a tmp file and read the bytes back, letting the caller persist via
  // the existing asset contract. This keeps the asset path policy single-sourced.
  const tempDir = join(tmpdir(), `slides-grab-codex-${randomUUID()}`);
  await mkdir(tempDir, { recursive: true });
  const tempPath = join(tempDir, 'image.png');

  try {
    const result = await provider.generateImage({
      prompt: enrichedPrompt,
      model,
      outputPath: tempPath,
      dryRun: Boolean(dryRun),
      images: images.length > 0 ? images : undefined,
    });

    if (dryRun) {
      return {
        mimeType: 'image/png',
        bytes: Buffer.alloc(0),
        mode: result?.mode || 'dry-run',
        warnings: Array.isArray(result?.warnings) ? result.warnings : [],
        revisedPrompt: result?.revisedPrompt ?? null,
      };
    }

    const bytes = await readFile(tempPath);
    return {
      mimeType: 'image/png',
      bytes,
      mode: result?.mode || 'live',
      warnings: Array.isArray(result?.warnings) ? result.warnings : [],
      revisedPrompt: result?.revisedPrompt ?? null,
    };
  } catch (error) {
    const wrapped = new Error(getCodexFallbackMessage(error?.message || String(error)));
    wrapped.cause = error;
    wrapped.isAuthError = isCodexAuthError(error);
    throw wrapped;
  } finally {
    await rm(tempDir, { recursive: true, force: true }).catch(() => {});
  }
}

export const __test_only__ = {
  ASPECT_RATIO_HINTS,
  isCodexAuthError,
  resolveReferenceImages,
};
