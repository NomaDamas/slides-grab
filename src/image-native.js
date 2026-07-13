import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { basename, join, resolve } from 'node:path';

import { loadTemplatePackFromSlidesDir, parseTemplatePack } from './template-pack.js';
import { selectTemplateLayout } from './template-layout.js';
import {
  DEFAULT_OPENAI_IMAGE_MODEL,
  DEFAULT_CODEX_MODEL,
  DEFAULT_NANO_BANANA_ASPECT_RATIO,
  DEFAULT_NANO_BANANA_MODEL,
  IMAGE_PROVIDER_OPENAI,
  IMAGE_PROVIDER_CODEX,
  IMAGE_PROVIDER_NANO_BANANA,
  generateOpenaiImage,
  generateNanoBananaImage,
  resolveOpenaiApiKey,
  resolveOpenaiBaseUrl,
  resolveNanoBananaApiKey,
} from './nano-banana.js';
import { generateCodexImage } from './codex-imagen.js';

export const IMAGE_NATIVE_METADATA_DIR = '.slides-grab/image-native';

function normalizeProvider(value) {
  const provider = String(value || IMAGE_PROVIDER_CODEX).trim().toLowerCase();
  if (!provider) return IMAGE_PROVIDER_CODEX;
  if (provider === 'openai') return IMAGE_PROVIDER_OPENAI;
  if (provider === 'gemini') return IMAGE_PROVIDER_NANO_BANANA;
  if (provider === IMAGE_PROVIDER_OPENAI || provider === IMAGE_PROVIDER_CODEX || provider === IMAGE_PROVIDER_NANO_BANANA) return provider;
  throw new Error(`Unknown image-native provider: ${value}. Expected codex, openai, or nano-banana.`);
}

function stripSlidePrefix(title) {
  return title.replace(/^slide\s+\d+\s*[:.)-]?\s*/i, '').trim() || title.trim();
}

function parseSlideBlock(heading, lines, index) {
  const bullets = [];
  const bodyLines = [];

  for (const line of lines) {
    const bulletMatch = line.match(/^\s*[-*+]\s+(.+?)\s*$/);
    if (bulletMatch) {
      bullets.push(bulletMatch[1]);
      continue;
    }
    if (line.trim()) bodyLines.push(line.trim());
  }

  const sourceMarkdown = [`## ${heading}`, ...lines].join('\n').trim();
  const body = bodyLines.join('\n').trim();
  return {
    index,
    title: stripSlidePrefix(heading),
    body,
    bullets,
    notes: body,
    sourceMarkdown,
  };
}

export function parseImageNativeOutline(markdown) {
  const text = String(markdown || '').replace(/\r\n/g, '\n');
  const lines = text.split('\n');
  const slides = [];
  let currentHeading = null;
  let currentLines = [];

  function flush() {
    if (!currentHeading) return;
    slides.push(parseSlideBlock(currentHeading, currentLines, slides.length + 1));
    currentHeading = null;
    currentLines = [];
  }

  for (const line of lines) {
    const headingMatch = line.match(/^##\s+(.+?)\s*$/);
    if (headingMatch) {
      flush();
      currentHeading = headingMatch[1];
      currentLines = [];
      continue;
    }
    if (currentHeading) currentLines.push(line);
  }
  flush();

  if (slides.length > 0) return slides;

  const fallbackTitle = lines.find((line) => /^#\s+/.test(line))?.replace(/^#\s+/, '').trim() || 'Generated slide';
  return [parseSlideBlock(fallbackTitle, lines.filter((line) => !/^#\s+/.test(line)), 1)];
}

function findLayoutById(pack, layoutId) {
  return pack?.layouts?.find((layout) => (layout.layoutId ?? layout.layout_id ?? layout.id) === layoutId) ?? null;
}

function layoutId(layout) {
  return layout?.layoutId ?? layout?.layout_id ?? layout?.id ?? null;
}

function layoutKind(layout) {
  return layout?.layoutKind ?? layout?.layout_kind ?? layout?.kind ?? null;
}

function describeFields(layout) {
  const fields = Array.isArray(layout?.fields) ? layout.fields : [];
  return fields.map((field) => {
    const parts = [field.role].filter(Boolean);
    if (field.maxChars) parts.push(`max ${field.maxChars} chars`);
    if (field.listLimits?.maxItems) parts.push(`max ${field.listLimits.maxItems} items`);
    if (field.listLimits?.maxCharsPerItem) parts.push(`max ${field.listLimits.maxCharsPerItem} chars/item`);
    return parts.join(', ');
  }).filter(Boolean);
}

function referencePreviewDescription(layout) {
  if (!layout?.preview) return null;
  return `${layout.preview}: reference preview for layout ${layoutId(layout)}`;
}

export function buildImageNativePrompt({
  slide,
  templatePack = null,
  layout = null,
  referencePreviewDescriptions = [],
} = {}) {
  const safeSlide = slide ?? {};
  const bullets = Array.isArray(safeSlide.bullets) ? safeSlide.bullets : [];
  const fieldDescriptions = describeFields(layout);
  const previews = [
    ...referencePreviewDescriptions,
    referencePreviewDescription(layout),
  ].filter(Boolean);

  return [
    'Generate one full-slide 16:9 presentation image at 720pt × 405pt.',
    'All text inside the image must be sharp, legible, correctly spelled, and faithful to the source outline. Do not invent facts.',
    '',
    `Slide ${safeSlide.index ?? ''}: ${safeSlide.title ?? 'Untitled slide'}`.trim(),
    safeSlide.body ? `Body/notes: ${safeSlide.body}` : '',
    bullets.length ? `Bullets:\n${bullets.map((item) => `- ${item}`).join('\n')}` : '',
    '',
    templatePack ? `Template pack: ${templatePack.name}` : 'Template pack: none',
    layout ? `Selected template layout: ${layoutId(layout)} (${layoutKind(layout) || 'unknown kind'})` : 'Selected template layout: none',
    layout?.description ? `Layout description: ${layout.description}` : '',
    fieldDescriptions.length ? `Layout schema limits:\n${fieldDescriptions.map((item) => `- ${item}`).join('\n')}` : '',
    previews.length ? `Reference preview descriptions:\n${previews.map((item) => `- ${item}`).join('\n')}` : 'Reference preview descriptions: none available; use distilled template description only.',
    templatePack?.promptSafeStyleSummary ? `Template style summary: ${templatePack.promptSafeStyleSummary}` : '',
    '',
    'Composition requirements: fill the whole slide, no browser chrome, no crop marks, no extra margins outside the slide, preserve template colors/fonts/layout cues, and keep the slide immediately readable in a deck viewer.',
  ].filter((line) => line !== '').join('\n');
}

function buildWrapperHtml({ title, assetRef, metadataRef }) {
  const safeTitle = String(title || 'Image-native slide')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="slides-grab-image-native" content="true">
  <meta name="slides-grab-image-native-metadata" content="${metadataRef}">
  <title>${safeTitle}</title>
  <style>
    * { box-sizing: border-box; }
    html, body {
      margin: 0;
      padding: 0;
      width: 720pt;
      height: 405pt;
      overflow: hidden;
      background: #000000;
    }
    body { position: relative; }
    img.slide-image {
      position: absolute;
      inset: 0;
      width: 720pt;
      height: 405pt;
      display: block;
      object-fit: cover;
    }
  </style>
</head>
<body>
  <img class="slide-image" src="${assetRef}" width="960" height="540" alt="${safeTitle}">
</body>
</html>
`;
}

export async function writeImageNativeSlideWrapper({
  slidesDir,
  slideName,
  assetRef,
  prompt,
  provider,
  model,
  title = '',
} = {}) {
  const normalizedSlideName = String(slideName || '').trim().replace(/\.html$/i, '');
  if (!/^slide-\d{2}$/.test(normalizedSlideName)) {
    throw new Error('--image-native requires --name in slide-XX format.');
  }
  if (typeof assetRef !== 'string' || !assetRef.startsWith('./assets/')) {
    throw new Error('Image-native assets must use a ./assets/ reference.');
  }
  if (typeof prompt !== 'string' || prompt.trim() === '') {
    throw new Error('Image-native slide metadata requires the generation prompt.');
  }

  const absoluteSlidesDir = resolve(slidesDir || 'slides');
  const metadataDir = join(absoluteSlidesDir, IMAGE_NATIVE_METADATA_DIR);
  const slideFile = `${normalizedSlideName}.html`;
  const metadataFile = `${normalizedSlideName}.json`;
  const metadataRef = `${IMAGE_NATIVE_METADATA_DIR}/${metadataFile}`;
  const normalizedProvider = normalizeProvider(provider);
  await mkdir(metadataDir, { recursive: true });
  await writeFile(
    join(absoluteSlidesDir, slideFile),
    buildWrapperHtml({ title: title || normalizedSlideName, assetRef, metadataRef }),
    'utf8',
  );

  const metadata = {
    schemaVersion: 1,
    mode: 'image-native',
    slideFile,
    assetRef,
    prompt: prompt.trim(),
    provider: normalizedProvider,
    model: String(model || '').trim(),
    templateLayoutId: null,
    templateLayoutKind: null,
    regenerationHistory: [],
  };
  await writeFile(join(metadataDir, metadataFile), `${JSON.stringify(metadata, null, 2)}\n`, 'utf8');
  return { slideFile, metadataFile: metadataRef, metadata };
}

async function defaultGenerateImage({ prompt, provider, model, env = process.env, baseUrl = '', fetchImpl = globalThis.fetch }) {
  if (provider === IMAGE_PROVIDER_CODEX) {
    return generateCodexImage({ prompt, model: model || DEFAULT_CODEX_MODEL, aspectRatio: DEFAULT_NANO_BANANA_ASPECT_RATIO });
  }
  if (provider === IMAGE_PROVIDER_OPENAI) {
    const { apiKey } = resolveOpenaiApiKey(env);
    if (!apiKey) throw new Error('OpenAI image-native generation requires OPENAI_API_KEY or OPENAI_IMAGE_API_KEY.');
    return generateOpenaiImage({ prompt, apiKey, model: model || DEFAULT_OPENAI_IMAGE_MODEL, aspectRatio: DEFAULT_NANO_BANANA_ASPECT_RATIO, baseUrl: resolveOpenaiBaseUrl({ baseUrl, env }).baseUrl, fetchImpl });
  }
  if (provider === IMAGE_PROVIDER_NANO_BANANA) {
    const { apiKey } = resolveNanoBananaApiKey(env);
    if (!apiKey) throw new Error('Nano Banana image-native generation requires GOOGLE_API_KEY or GEMINI_API_KEY.');
    return generateNanoBananaImage({ prompt, apiKey, model: model || DEFAULT_NANO_BANANA_MODEL, aspectRatio: DEFAULT_NANO_BANANA_ASPECT_RATIO, imageSize: '4K', fetchImpl });
  }
  throw new Error(`Unsupported image-native provider: ${provider}`);
}

function assetExtension(mimeType) {
  if (mimeType === 'image/jpeg') return 'jpg';
  if (mimeType === 'image/webp') return 'webp';
  return 'png';
}

async function loadOutline(outlinePath) {
  return readFile(resolve(outlinePath), 'utf8');
}

async function resolveTemplatePack({ slidesDir, templatePack, templatePackPath }) {
  if (templatePack) return parseTemplatePack(templatePack);
  if (templatePackPath) return parseTemplatePack(await readFile(resolve(templatePackPath), 'utf8'), { path: resolve(templatePackPath) });
  return loadTemplatePackFromSlidesDir(slidesDir, { optional: true });
}

export async function generateImageNativeSlides({
  outlinePath,
  slidesDir = 'slides',
  templatePack = null,
  templatePackPath = '',
  provider = IMAGE_PROVIDER_CODEX,
  model = '',
  baseUrl = '',
  env = process.env,
  fetchImpl = globalThis.fetch,
  generateImageImpl = null,
} = {}) {
  if (!outlinePath) throw new Error('generateImageNativeSlides requires outlinePath.');
  const absoluteSlidesDir = resolve(slidesDir);
  const assetsDir = join(absoluteSlidesDir, 'assets');
  const metadataDir = join(absoluteSlidesDir, IMAGE_NATIVE_METADATA_DIR);
  await mkdir(assetsDir, { recursive: true });
  await mkdir(metadataDir, { recursive: true });

  const outlineMarkdown = await loadOutline(outlinePath);
  const slides = parseImageNativeOutline(outlineMarkdown);
  const pack = await resolveTemplatePack({ slidesDir: absoluteSlidesDir, templatePack, templatePackPath });
  const normalizedProvider = normalizeProvider(provider);
  const resolvedModel = model || '';
  const generatedSlides = [];

  for (const slide of slides) {
    const selected = pack ? selectTemplateLayout(slide, pack) : { layoutId: null, layoutKind: null };
    const layout = selected.layoutId ? findLayoutById(pack, selected.layoutId) : null;
    const prompt = buildImageNativePrompt({ slide, templatePack: pack, layout });
    const generated = generateImageImpl
      ? await generateImageImpl({ prompt, slide, layout, provider: normalizedProvider, model: resolvedModel })
      : await defaultGenerateImage({ prompt, provider: normalizedProvider, model: resolvedModel, env, baseUrl, fetchImpl });
    const extension = assetExtension(generated.mimeType);
    const slideStem = `slide-${String(slide.index).padStart(2, '0')}`;
    const assetFile = `${slideStem}.${extension}`;
    const slideFile = `${slideStem}.html`;
    const metadataFile = `${slideStem}.json`;
    const assetRef = `./assets/${assetFile}`;
    const metadataRef = `${IMAGE_NATIVE_METADATA_DIR}/${metadataFile}`;

    await writeFile(join(assetsDir, assetFile), generated.bytes);
    await writeFile(join(absoluteSlidesDir, slideFile), buildWrapperHtml({ title: slide.title, assetRef, metadataRef }), 'utf8');

    const metadata = {
      schemaVersion: 1,
      mode: 'image-native',
      slideFile,
      assetRef,
      prompt,
      provider: normalizedProvider,
      model: resolvedModel || (normalizedProvider === IMAGE_PROVIDER_OPENAI ? DEFAULT_OPENAI_IMAGE_MODEL : normalizedProvider === IMAGE_PROVIDER_CODEX ? DEFAULT_CODEX_MODEL : DEFAULT_NANO_BANANA_MODEL),
      templateLayoutId: selected.layoutId,
      templateLayoutKind: selected.layoutKind,
      sourceOutline: {
        path: outlinePath,
        slideIndex: slide.index,
        title: slide.title,
        markdown: slide.sourceMarkdown,
      },
      regenerationHistory: [],
    };
    await writeFile(join(metadataDir, metadataFile), `${JSON.stringify(metadata, null, 2)}\n`, 'utf8');

    generatedSlides.push({
      slideFile,
      assetRef,
      metadataFile: `${IMAGE_NATIVE_METADATA_DIR}/${metadataFile}`,
      provider: metadata.provider,
      model: metadata.model,
      templateLayoutId: metadata.templateLayoutId,
      templateLayoutKind: metadata.templateLayoutKind,
      prompt,
    });
  }

  return {
    outlinePath,
    slidesDir: absoluteSlidesDir,
    templatePackName: pack?.name ?? null,
    provider: normalizedProvider,
    model: resolvedModel,
    slides: generatedSlides,
  };
}

function extractImageNativeMetadataRef(html) {
  const match = html.match(/<meta\s+name=["']slides-grab-image-native-metadata["']\s+content=["']([^"']+)["']/i);
  return match?.[1] ?? null;
}

function ensureImageNativeHtml(html, slideFile) {
  if (!/<meta\s+name=["']slides-grab-image-native["']\s+content=["']true["']/i.test(html)) {
    throw new Error(`${slideFile} is not an image-native slide. Generate it with slides-grab image --image-native --name slide-XX or open HTML slides with slides-grab edit.`);
  }
  const metadataRef = extractImageNativeMetadataRef(html);
  if (!metadataRef) {
    throw new Error(`${slideFile} is missing image-native regeneration metadata.`);
  }
  return metadataRef;
}

function buildRegenerationPrompt({ metadata, prompt, selections = [] }) {
  const boxes = selections
    .map((selection, index) => `- Region ${index + 1}: x=${selection.bbox.x}, y=${selection.bbox.y}, width=${selection.bbox.width}, height=${selection.bbox.height}`)
    .join('\n');
  return [
    'Regenerate this existing image-native slide as a complete replacement full-slide image.',
    'Keep the original slide intent and template constraints, but apply the user critique.',
    '',
    `User critique: ${prompt}`,
    boxes ? `Selected bbox feedback regions (slide coordinate space):\n${boxes}` : 'Selected bbox feedback regions: none.',
    '',
    'Original generation prompt:',
    metadata.prompt,
  ].join('\n');
}

function throwIfImageRegenerationAborted(signal) {
  if (signal?.aborted) {
    throw new Error('Image regeneration was aborted.');
  }
}

export async function regenerateImageNativeSlide({
  slidesDir,
  slideFile,
  prompt,
  selections = [],
  provider = IMAGE_PROVIDER_CODEX,
  model = '',
  baseUrl = '',
  env = process.env,
  fetchImpl = globalThis.fetch,
  generateImageImpl = null,
  signal = null,
} = {}) {
  if (!slidesDir) throw new Error('regenerateImageNativeSlide requires slidesDir.');
  if (!slideFile) throw new Error('regenerateImageNativeSlide requires slideFile.');
  if (typeof prompt !== 'string' || prompt.trim() === '') throw new Error('regenerateImageNativeSlide requires a prompt.');

  const absoluteSlidesDir = resolve(slidesDir);
  const htmlPath = join(absoluteSlidesDir, slideFile);
  const html = await readFile(htmlPath, 'utf8');
  const metadataRef = ensureImageNativeHtml(html, slideFile);
  const metadataPath = join(absoluteSlidesDir, metadataRef);
  const metadata = JSON.parse(await readFile(metadataPath, 'utf8'));
  const normalizedProvider = normalizeProvider(provider || metadata.provider || IMAGE_PROVIDER_CODEX);
  const resolvedModel = model || metadata.model || '';
  const regenerationPrompt = buildRegenerationPrompt({ metadata, prompt: prompt.trim(), selections });
  throwIfImageRegenerationAborted(signal);

  const generated = generateImageImpl
    ? await generateImageImpl({ prompt: regenerationPrompt, metadata, selections, provider: normalizedProvider, model: resolvedModel })
    : await defaultGenerateImage({ prompt: regenerationPrompt, provider: normalizedProvider, model: resolvedModel, env, baseUrl, fetchImpl });
  throwIfImageRegenerationAborted(signal);

  const assetPath = join(absoluteSlidesDir, metadata.assetRef.replace(/^\.\//, ''));
  await writeFile(assetPath, generated.bytes);

  const historyEntry = {
    at: new Date().toISOString(),
    prompt: prompt.trim(),
    provider: normalizedProvider,
    model: resolvedModel,
    selections,
    previousPrompt: metadata.prompt,
  };
  const nextMetadata = {
    ...metadata,
    prompt: regenerationPrompt,
    provider: normalizedProvider,
    model: resolvedModel,
    regenerationHistory: [...(Array.isArray(metadata.regenerationHistory) ? metadata.regenerationHistory : []), historyEntry],
  };
  await writeFile(metadataPath, `${JSON.stringify(nextMetadata, null, 2)}\n`, 'utf8');

  return {
    slideFile,
    assetRef: metadata.assetRef,
    metadataFile: metadataRef,
    provider: normalizedProvider,
    model: resolvedModel,
    prompt: regenerationPrompt,
    regenerationHistoryLength: nextMetadata.regenerationHistory.length,
  };
}
