import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';

const ROOT = new URL('../../', import.meta.url);
const fixtureRoot = new URL('../fixtures/template-workflows/', import.meta.url);
const readRepo = (path) => readFile(new URL(`../../${path}`, import.meta.url), 'utf8');
const readFixture = (path) => readFile(new URL(`../fixtures/template-workflows/${path}`, import.meta.url), 'utf8');

test('English and Korean READMEs document template-following and image-native workflows consistently', async () => {
  const readme = await readRepo('README.md');
  const koreanReadme = await readRepo('README-ko.md');

  for (const text of [readme, koreanReadme]) {
    assert.match(text, /slides-grab\s+import-template/);
    assert.match(text, /template-pack\.json/);
    assert.match(text, /OPENAI_IMAGE_BASE_URL|OPENAI_BASE_URL/);
    assert.match(text, /--api-key-env/);
    assert.match(text, /filled representative|채워진 대표/);
    assert.match(text, /empty master|빈 마스터/);
    assert.match(text, /raster|래스터/i);
    assert.match(text, /HTML/);
  }

  assert.match(readme, /Image-native slides are raster/i);
  assert.match(koreanReadme, /이미지 네이티브 슬라이드는 래스터/);
});

test('skill references describe imported template packs and separate editor commands', async () => {
  const planSkill = await readRepo('skills/slides-grab-plan/SKILL.md');
  const htmlSkill = await readRepo('skills/slides-grab-html/SKILL.md');
  const imageSkill = await readRepo('skills/slides-grab-image/SKILL.md');
  const designSkill = await readRepo('skills/slides-grab-design/SKILL.md');
  const workflowReference = await readRepo('skills/slides-grab/references/presentation-workflow-reference.md');

  assert.match(planSkill, /filled representative/i);
  assert.match(planSkill, /empty master/i);
  assert.match(htmlSkill, /slides-grab\s+edit\s+--slides-dir/);
  assert.doesNotMatch(htmlSkill, /edit-image/);
  assert.match(imageSkill, /slides-grab\s+edit-image\s+--slides-dir/);
  assert.doesNotMatch(imageSkill, /Image Regenerate/);
  assert.match(designSkill, /slides-grab\s+edit\s+--slides-dir/);
  assert.match(designSkill, /slides-grab\s+edit-image\s+--slides-dir/);
  assert.doesNotMatch(designSkill, /Image Regenerate/);
  assert.match(designSkill, /raster/i);
  assert.match(workflowReference, /import-template/);
  assert.match(workflowReference, /slides-grab\s+edit\s+--slides-dir/);
  assert.match(workflowReference, /slides-grab\s+edit-image\s+--slides-dir/);
  assert.doesNotMatch(workflowReference, /Image Regenerate/);
});

test('template workflow fixtures cover HTML and image-native paths without external credentials', async () => {
  const pack = JSON.parse(await readFixture('corporate-template-pack/.slides-grab/template-pack.json'));
  assert.equal(pack.version, 1);
  assert.equal(pack.name, 'Fixture Corporate Template Pack');
  assert.ok(pack.sourceMetadata.warnings.some((warning) => /filled representative/i.test(warning)));
  assert.ok(pack.layouts.some((layout) => layout.layout_id === 'cover-fixture'));

  const referenceHtml = await readFixture('html-reference/slide-01.html');
  assert.match(referenceHtml, /data-template-role="title"/);
  assert.match(referenceHtml, /data-template-role="bullets"/);

  const wrapperHtml = await readFixture('image-native-dry-run/slide-01.html');
  assert.match(wrapperHtml, /slides-grab-image-native/);
  assert.match(wrapperHtml, /\.\/assets\/slide-01\.png/);

  const metadata = JSON.parse(await readFixture('image-native-dry-run/.slides-grab/image-native/slide-01.json'));
  assert.equal(metadata.provider, 'dry-run');
  assert.equal(metadata.model, 'dry-run-image');
  assert.equal(metadata.assetRef, './assets/slide-01.png');
  assert.deepEqual(metadata.regenerationHistory, []);

  const mockProvider = JSON.parse(await readFixture('mock-image-provider-response.json'));
  assert.equal(mockProvider.provider, 'dry-run');
  assert.ok(mockProvider.imageBase64.length > 20);

  assert.ok(existsSync(join(new URL('image-native-dry-run/assets/slide-01.png', fixtureRoot).pathname)));
});
