#!/usr/bin/env node

import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  DEFAULT_CODEX_IMAGE_MODEL,
  DEFAULT_CODEX_IMAGE_BASE_URL,
  DEFAULT_CODEX_IMAGE_SIZE,
  DEFAULT_GOD_TIBO_MODEL,
  DEFAULT_IMAGE_PROVIDER,
  DEFAULT_NANO_BANANA_ASPECT_RATIO,
  DEFAULT_NANO_BANANA_IMAGE_SIZE,
  DEFAULT_NANO_BANANA_MODEL,
  IMAGE_PROVIDER_CODEX,
  IMAGE_PROVIDER_GOD_TIBO,
  IMAGE_PROVIDER_NANO_BANANA,
  buildCodexImageApiRequest,
  buildCodexImageEndpoint,
  buildNanoBananaApiRequest,
  extractCodexGeneratedImage,
  extractGeneratedImage,
  generateCodexImage,
  generateNanoBananaImage,
  getCodexFallbackMessage,
  getNanoBananaFallbackMessage,
  getNanoBananaUsage,
  normalizeImageProvider,
  parseNanoBananaCliArgs,
  resolveCodexApiKey,
  resolveCodexBaseUrl,
  resolveNanoBananaApiKey,
  resolveNanoBananaOutputPath,
  runNanoBananaCli,
  saveNanoBananaImage,
} from '../src/nano-banana.js';
import {
  GOD_TIBO_DEFAULT_MODEL,
  GOD_TIBO_PROVIDER_AUTO,
  GOD_TIBO_PROVIDER_CODEX_CLI,
  GOD_TIBO_PROVIDER_PRIVATE_CODEX,
  generateGodTiboImage,
  getGodTiboFallbackMessage,
  injectAspectRatioHint,
  resolveGodTiboConfig,
} from '../src/god-tibo-imagen.js';
import { writeImageNativeSlideWrapper } from '../src/image-native.js';

export {
  DEFAULT_CODEX_IMAGE_BASE_URL,
  DEFAULT_CODEX_IMAGE_MODEL,
  DEFAULT_CODEX_IMAGE_SIZE,
  DEFAULT_GOD_TIBO_MODEL,
  DEFAULT_IMAGE_PROVIDER,
  DEFAULT_NANO_BANANA_ASPECT_RATIO,
  DEFAULT_NANO_BANANA_IMAGE_SIZE,
  DEFAULT_NANO_BANANA_MODEL,
  GOD_TIBO_DEFAULT_MODEL,
  GOD_TIBO_PROVIDER_AUTO,
  GOD_TIBO_PROVIDER_CODEX_CLI,
  GOD_TIBO_PROVIDER_PRIVATE_CODEX,
  IMAGE_PROVIDER_CODEX,
  IMAGE_PROVIDER_GOD_TIBO,
  IMAGE_PROVIDER_NANO_BANANA,
  buildCodexImageApiRequest,
  buildCodexImageEndpoint,
  buildNanoBananaApiRequest,
  extractCodexGeneratedImage,
  extractGeneratedImage,
  generateCodexImage,
  generateGodTiboImage,
  generateNanoBananaImage,
  getCodexFallbackMessage,
  getGodTiboFallbackMessage,
  getNanoBananaFallbackMessage,
  getNanoBananaUsage,
  injectAspectRatioHint,
  normalizeImageProvider,
  parseNanoBananaCliArgs,
  resolveCodexApiKey,
  resolveGodTiboConfig,
  resolveCodexBaseUrl,
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
