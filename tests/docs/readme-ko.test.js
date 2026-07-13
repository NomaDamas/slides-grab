import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const repositoryRoot = new URL('../../', import.meta.url);
const readText = (path) => readFile(new URL(`../../${path}`, import.meta.url), 'utf8');

test('README links to Korean documentation', async () => {
  const readme = await readText('README.md');

  assert.match(readme, /README-ko\.md/);
  assert.match(readme, /한국어|Korean/i);
});

test('Korean README preserves canonical demo and showcase URLs', async () => {
  const koreanReadme = await readText('README-ko.md');

  for (const requiredUrl of [
    'https://github.com/vkehfdl1/slides-grab/releases/download/v0.0.1-demo/demo.mp4',
    'docs/assets/demo.gif',
    'https://vkehfdl1.github.io/slides-grab/',
  ]) {
    assert.ok(koreanReadme.includes(requiredUrl), `${requiredUrl} should be mirrored in README-ko.md`);
  }
});

test('Korean README covers core setup and workflow in Korean', async () => {
  const koreanReadme = await readText('README-ko.md');

  assert.match(koreanReadme, /^# slides-grab/m);
  assert.match(koreanReadme, /한국어/);
  assert.match(koreanReadme, /빠른 시작/);
  assert.match(koreanReadme, /설치/);
  assert.match(koreanReadme, /CLI 명령어/);
  assert.match(koreanReadme, /에셋/);
  assert.match(koreanReadme, /라이선스/);

  for (const requiredCommand of [
    'npm ci',
    'npx playwright install chromium',
    'npm install slides-grab',
    'slides-grab edit',
    'slides-grab edit-image',
    'slides-grab validate',
    'slides-grab pdf',
    'slides-grab convert',
  ]) {
    assert.match(koreanReadme, new RegExp(requiredCommand.replaceAll(' ', '\\s+')));
  }
});

test('Korean README documents separate HTML and image-native editors', async () => {
  const readme = await readText('README.md');
  const koreanReadme = await readText('README-ko.md');

  for (const text of [readme, koreanReadme]) {
    assert.match(text, /slides-grab\s+edit\s+--slides-dir\s+decks\/my-deck/);
    assert.match(text, /slides-grab\s+edit-image\s+--slides-dir\s+decks\/my-deck/);
    assert.match(text, /slides-grab\s+edit\s+--slides-dir\s+decks\/my-cards\s+--mode\s+card-news/);
    assert.doesNotMatch(text, /Image Regenerate/);
  }
});

test('Korean README mirrors export, video, tldraw, figma, and package guidance', async () => {
  const koreanReadme = await readText('README-ko.md');

  for (const requiredHeading of [
    /^### 웹 동영상을 덱 에셋으로 다운로드$/m,
    /^## Tldraw 다이어그램 에셋$/m,
    /^## Figma 작업 흐름$/m,
    /^## npm 패키지$/m,
  ]) {
    assert.match(koreanReadme, requiredHeading);
  }

  for (const requiredDetail of [
    /slides-grab\s+validate\s+--slides-dir\s+<path>/,
    /--mode\s+capture/,
    /--mode\s+print/,
    /poster="\.\/assets\/<file>"/,
    /2160p/,
    /4k/,
    /--resolution\s+<preset>/,
    /slides-grab\s+fetch-video/,
    /--output-name\s+hero-video/,
    /yt-dlp/,
    /slides-grab\s+tldraw/,
    /--input\s+decks\/my-deck\/assets\/system\.tldr/,
    /--padding\s+16/,
    /diagram-tldraw/,
    /slides-grab\s+figma\s+--slides-dir\s+decks\/my-deck\s+--output\s+decks\/my-deck-figma\.pptx/,
    /Figma에 직접 업로드하지 않습니다/,
    /Import/,
    /실험적\/불안정/,
    /npx\s+skills\s+add\s+\.\/node_modules\/slides-grab/,
  ]) {
    assert.match(koreanReadme, requiredDetail);
  }
});

test('Korean README is included in the npm package packlist', () => {
  const output = execFileSync('npm', ['pack', '--json', '--dry-run', '--ignore-scripts'], {
    cwd: repositoryRoot,
    encoding: 'utf-8',
  });
  const [packResult] = JSON.parse(output);
  const packlist = packResult.files.map((file) => file.path);

  assert.ok(packlist.includes('README-ko.md'));
});
