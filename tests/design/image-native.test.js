import { main as generateImagesMain } from '../../scripts/generate-images.js';
import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

import {
  buildImageNativePrompt,
  generateImageNativeSlides,
  parseImageNativeOutline,
} from '../../src/image-native.js';
import { parseTemplatePack } from '../../src/template-pack.js';

const tinyPng = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/p9sAAAAASUVORK5CYII=',
  'base64',
);

const outlineMarkdown = `# Quarterly Business Review

## Slide 1: Market map
- Segment: Enterprise renewals expanded 18% YoY
- Key fact: Top 3 accounts now represent 41% of expansion ARR

Show the sales coverage shift without adding fictional numbers.

## Slide 2: Operating plan
- Hire two partner engineers
- Move onboarding SLA from 10 days to 6 days
`;

const templatePack = parseTemplatePack({
  version: 1,
  name: 'Board Template',
  layouts: [
    {
      layout_id: 'cover-tight',
      layout_kind: 'cover',
      description: 'Hero title over dark boardroom photography with a small subtitle band.',
      preview: '.slides-grab/template-previews/cover-tight.png',
      fields: [{ role: 'title', maxChars: 40 }],
    },
    {
      layout_id: 'content-metric',
      layout_kind: 'content',
      description: 'Dense metric slide with left narrative column and right KPI stack.',
      preview: '.slides-grab/template-previews/content-metric.png',
      fields: [
        { role: 'title', maxChars: 48 },
        { role: 'bullets', maxItems: 4, maxCharsPerItem: 72 },
      ],
    },
  ],
});

test('parseImageNativeOutline extracts markdown slides with source metadata', () => {
  const slides = parseImageNativeOutline(outlineMarkdown);

  assert.equal(slides.length, 2);
  assert.equal(slides[0].index, 1);
  assert.equal(slides[0].title, 'Market map');
  assert.deepEqual(slides[0].bullets, [
    'Segment: Enterprise renewals expanded 18% YoY',
    'Key fact: Top 3 accounts now represent 41% of expansion ARR',
  ]);
  assert.match(slides[0].body, /sales coverage shift/);
  assert.match(slides[0].sourceMarkdown, /## Slide 1: Market map/);
});

test('buildImageNativePrompt includes template context, selected layout, and text rules', () => {
  const [slide] = parseImageNativeOutline(outlineMarkdown);
  const prompt = buildImageNativePrompt({
    slide,
    templatePack,
    layout: templatePack.layouts[1],
    referencePreviewDescriptions: ['content-metric.png: dense KPI stack, navy background, white text'],
  });

  assert.match(prompt, /full-slide 16:9 presentation image/i);
  assert.match(prompt, /Market map/);
  assert.match(prompt, /Enterprise renewals expanded 18% YoY/);
  assert.match(prompt, /Board Template/);
  assert.match(prompt, /content-metric/);
  assert.match(prompt, /dense KPI stack/);
  assert.match(prompt, /sharp, legible, correctly spelled/i);
});

test('generateImageNativeSlides writes prompts, wrapper slides, and regeneration metadata with injected provider', async () => {
  const workspace = await mkdtemp(path.join(os.tmpdir(), 'image-native-provider-meta-'));
  const outlinePath = path.join(workspace, 'slide-outline.md');
  const slidesDir = path.join(workspace, 'slides');

  try {
    await writeFile(outlinePath, outlineMarkdown, 'utf8');
    const result = await generateImageNativeSlides({
      outlinePath,
      slidesDir,
      templatePack,
      provider: 'god-tibo',
      model: 'gpt-5.4',
      generateImageImpl: async () => ({ mimeType: 'image/png', bytes: tinyPng }),
    });

    assert.equal(result.slides.length, 2);
    assert.equal(result.slides[0].slideFile, 'slide-01.html');
    assert.equal(result.slides[0].assetRef, './assets/slide-01.png');
    assert.equal(result.slides[0].templateLayoutId, 'content-metric');

    const html = await readFile(path.join(slidesDir, 'slide-01.html'), 'utf8');
    assert.match(html, /slides-grab-image-native/);
    assert.match(html, /<img class="slide-image" src="\.\/assets\/slide-01\.png"/);
    assert.match(html, /width: 720pt/);
    assert.match(html, /height: 405pt/);

    await stat(path.join(slidesDir, 'assets', 'slide-01.png'));
    const metadata = JSON.parse(await readFile(path.join(slidesDir, '.slides-grab', 'image-native', 'slide-01.json'), 'utf8'));
    assert.equal(metadata.provider, 'god-tibo');
    assert.equal(metadata.model, 'gpt-5.4');
    assert.equal(metadata.templateLayoutId, 'content-metric');
    assert.match(metadata.prompt, /Market map/);
    assert.match(metadata.sourceOutline.markdown, /Slide 1/);
    assert.deepEqual(metadata.regenerationHistory, []);
  } finally {
    await rm(workspace, { recursive: true, force: true });
  }
});

test('generateImageNativeSlides uses an injected provider and records provider metadata', async () => {
  const workspace = await mkdtemp(path.join(os.tmpdir(), 'image-native-provider-'));
  const outlinePath = path.join(workspace, 'slide-outline.md');
  const slidesDir = path.join(workspace, 'slides');
  const calls = [];

  try {
    await writeFile(outlinePath, outlineMarkdown, 'utf8');
    const result = await generateImageNativeSlides({
      outlinePath,
      slidesDir,
      templatePack,
      provider: 'codex',
      model: 'gpt-image-2',
      generateImageImpl: async ({ prompt, slide, layout }) => {
        calls.push({ prompt, title: slide.title, layoutId: layout.layoutId });
        return { mimeType: 'image/png', bytes: tinyPng };
      },
    });

    assert.equal(calls.length, 2);
    assert.equal(calls[0].layoutId, 'content-metric');
    assert.match(calls[0].prompt, /reference preview/i);
    assert.equal(result.slides[0].provider, 'codex');
    assert.equal((await readFile(path.join(slidesDir, 'assets', 'slide-01.png'))).compare(tinyPng), 0);
  } finally {
    await rm(workspace, { recursive: true, force: true });
  }
});

test('generate-images script creates validation-compatible image wrapper slides with injected provider', async () => {
  const workspace = await mkdtemp(path.join(os.tmpdir(), 'image-native-cli-'));
  const outlinePath = path.join(workspace, 'slide-outline.md');
  const slidesDir = path.join(workspace, 'slides');
  const cliPath = path.join(process.cwd(), 'bin', 'ppt-agent.js');

  try {
    await writeFile(outlinePath, outlineMarkdown, 'utf8');
    const stdout = [];
    const writable = { write: (chunk) => { stdout.push(chunk); return true; } };
    await generateImagesMain([
      '--outline', outlinePath,
      '--slides-dir', slidesDir,
      '--provider', 'god-tibo',
    ], {
      stdout: writable,
      generateImageImpl: async () => ({ mimeType: 'image/png', bytes: tinyPng }),
    });

    assert.match(stdout.join(''), /Generated image-native slides: 2/);

    const validated = spawnSync(process.execPath, [
      cliPath,
      'validate',
      '--slides-dir', slidesDir,
      '--format', 'json',
    ], { encoding: 'utf8' });
    assert.equal(validated.status, 0, validated.stderr || validated.stdout);
    const validation = JSON.parse(validated.stdout);
    assert.equal(validation.summary.totalSlides, 2);
    assert.equal(validation.summary.failedSlides, 0);
  } finally {
    await rm(workspace, { recursive: true, force: true });
  }
});
