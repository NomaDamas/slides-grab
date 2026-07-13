#!/usr/bin/env node

import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  DEFAULT_OPENAI_IMAGE_MODEL,
  DEFAULT_OPENAI_IMAGE_BASE_URL,
  DEFAULT_OPENAI_IMAGE_SIZE,
  DEFAULT_CODEX_MODEL,
  DEFAULT_IMAGE_PROVIDER,
  DEFAULT_NANO_BANANA_ASPECT_RATIO,
  DEFAULT_NANO_BANANA_IMAGE_SIZE,
  DEFAULT_NANO_BANANA_MODEL,
  IMAGE_PROVIDER_OPENAI,
  IMAGE_PROVIDER_CODEX,
  IMAGE_PROVIDER_NANO_BANANA,
  buildOpenaiImageApiRequest,
  buildOpenaiImageEndpoint,
  buildNanoBananaApiRequest,
  extractOpenaiGeneratedImage,
  extractGeneratedImage,
  generateOpenaiImage,
  generateNanoBananaImage,
  getOpenaiFallbackMessage,
  getNanoBananaFallbackMessage,
  getNanoBananaUsage,
  normalizeImageProvider,
  parseNanoBananaCliArgs,
  resolveOpenaiApiKey,
  resolveOpenaiBaseUrl,
  resolveNanoBananaApiKey,
  resolveNanoBananaOutputPath,
  runNanoBananaCli,
  saveNanoBananaImage,
} from '../src/nano-banana.js';
import {
  CODEX_DEFAULT_MODEL,
  CODEX_PROVIDER_AUTO,
  CODEX_PROVIDER_CODEX_CLI,
  CODEX_PROVIDER_PRIVATE_CODEX,
  generateCodexImage,
  getCodexFallbackMessage,
  injectAspectRatioHint,
  resolveCodexConfig,
} from '../src/codex-imagen.js';
import { writeImageNativeSlideWrapper } from '../src/image-native.js';

export {
  DEFAULT_OPENAI_IMAGE_BASE_URL,
  DEFAULT_OPENAI_IMAGE_MODEL,
  DEFAULT_OPENAI_IMAGE_SIZE,
  DEFAULT_CODEX_MODEL,
  DEFAULT_IMAGE_PROVIDER,
  DEFAULT_NANO_BANANA_ASPECT_RATIO,
  DEFAULT_NANO_BANANA_IMAGE_SIZE,
  DEFAULT_NANO_BANANA_MODEL,
  CODEX_DEFAULT_MODEL,
  CODEX_PROVIDER_AUTO,
  CODEX_PROVIDER_CODEX_CLI,
  CODEX_PROVIDER_PRIVATE_CODEX,
  IMAGE_PROVIDER_OPENAI,
  IMAGE_PROVIDER_CODEX,
  IMAGE_PROVIDER_NANO_BANANA,
  buildOpenaiImageApiRequest,
  buildOpenaiImageEndpoint,
  buildNanoBananaApiRequest,
  extractOpenaiGeneratedImage,
  extractGeneratedImage,
  generateOpenaiImage,
  generateCodexImage,
  generateNanoBananaImage,
  getOpenaiFallbackMessage,
  getCodexFallbackMessage,
  getNanoBananaFallbackMessage,
  getNanoBananaUsage,
  injectAspectRatioHint,
  normalizeImageProvider,
  parseNanoBananaCliArgs,
  resolveOpenaiApiKey,
  resolveCodexConfig,
  resolveOpenaiBaseUrl,
  resolveNanoBananaApiKey,
  resolveNanoBananaOutputPath,
  runNanoBananaCli,
  saveNanoBananaImage,
};

export async function main(argv = process.argv.slice(2), options = {}) {
  const imageNative = argv.includes('--image-native');
  const forwardedArgs = argv.filter((arg) => arg !== '--image-native');
  const parsed = parseNanoBananaCliArgs(forwardedArgs);
  const target = await runNanoBananaCli(forwardedArgs, options);
  if (!imageNative || parsed.help || !target) return target;

  const wrapper = await writeImageNativeSlideWrapper({
    slidesDir: parsed.slidesDir,
    slideName: parsed.name,
    assetRef: target.relativeRef,
    prompt: parsed.prompt,
    provider: target.provider,
    model: target.model,
    title: parsed.name,
  });
  (options.stdout || process.stdout).write(`Created image-native slide wrapper: ${wrapper.slideFile}\n`);
  return { ...target, imageNative: wrapper };
}

const isMain = process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url);

if (isMain) {
  main().catch((error) => {
    console.error(`[slides-grab] ${error.message}`);
    process.exit(1);
  });
}
