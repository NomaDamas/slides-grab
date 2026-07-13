import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';

import { generateImageNativeSlides, regenerateImageNativeSlide } from '../../src/image-native.js';
import { getAvailablePort } from './test-server-helpers.js';

const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function createImageNativeWorkspace() {
  const workspace = await mkdtemp(join(os.tmpdir(), 'editor-image-mode-'));
  const outlinePath = join(workspace, 'slide-outline.md');
  const slidesDir = join(workspace, 'slides');
  await writeFile(outlinePath, '# Demo\n\n## Slide 1: Hero\n- Fact: regenerate me\n', 'utf8');
  await generateImageNativeSlides({ outlinePath, slidesDir, provider: 'codex', generateImageImpl: async () => ({ mimeType: 'image/png', bytes: Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/p9sAAAAASUVORK5CYII=', 'base64') }) });
  return { workspace, slidesDir };
}

async function createHtmlWorkspace() {
  const workspace = await mkdtemp(join(os.tmpdir(), 'editor-image-mode-html-'));
  const slidesDir = join(workspace, 'slides');
  await mkdir(slidesDir, { recursive: true });
  await writeFile(join(slidesDir, 'slide-01.html'), '<!doctype html><html><body><h1>HTML slide</h1></body></html>', 'utf8');
  return { workspace, slidesDir };
}

function spawnEditorServer(workspace, port, { env = {} } = {}) {
  const output = { value: '' };
  const child = spawn(process.execPath, [
    join(REPO_ROOT, 'scripts', 'editor-server.js'),
    '--editor',
    'image',
    '--port',
    String(port),
  ], {
    cwd: workspace,
    env: {
      ...process.env,
      PPT_AGENT_PACKAGE_ROOT: REPO_ROOT,
      PPT_AGENT_MOCK_IMAGE_PROVIDER: '1',
      ...env,
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  child.stdout.on('data', (chunk) => { output.value += chunk.toString(); });
  child.stderr.on('data', (chunk) => { output.value += chunk.toString(); });
  return { child, output };
}

async function waitForServerReady(port, child, outputRef) {
  const started = Date.now();
  while (Date.now() - started < 15000) {
    if (child.exitCode !== null) throw new Error(`server exited early: ${child.exitCode}\n${outputRef.value}`);
    try {
      const res = await fetch(`http://localhost:${port}/api/slides`);
      if (res.ok) return;
    } catch {}
    await sleep(150);
  }
  throw new Error(`server did not become ready\n${outputRef.value}`);
}

async function stopChild(child) {
  if (child.exitCode !== null) return;
  child.kill('SIGTERM');
  await new Promise((resolve) => {
    const timer = setTimeout(resolve, 4000);
    child.once('exit', () => {
      clearTimeout(timer);
      resolve();
    });
  });
}

function imageApplyBody(overrides = {}) {
  return JSON.stringify({
    slide: 'slide-01.html',
    prompt: 'Regenerate the selected region with stronger hierarchy.',
    mode: 'image',
    provider: 'codex',
    model: 'gpt-5.4',
    selections: [{ x: 96, y: 54, width: 320, height: 180, targets: [] }],
    ...overrides,
  });
}

test('/api/apply image mode regenerates image-native slide metadata', async () => {
  const { workspace, slidesDir } = await createImageNativeWorkspace();
  const port = await getAvailablePort();
  const server = spawnEditorServer(workspace, port);

  try {
    await waitForServerReady(port, server.child, server.output);
    const res = await fetch(`http://localhost:${port}/api/apply`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: imageApplyBody(),
    });
    const body = await res.json();

    assert.equal(res.status, 200, JSON.stringify(body));
    assert.equal(body.success, true);
    assert.equal(body.mode, 'image');
    assert.equal(body.image.provider, 'codex');
    assert.equal(body.image.regenerationHistoryLength, 1);

    const metadata = JSON.parse(await readFile(join(slidesDir, '.slides-grab', 'image-native', 'slide-01.json'), 'utf8'));
    assert.equal(metadata.regenerationHistory.length, 1);
    assert.match(metadata.prompt, /User critique: Regenerate the selected region/);
    assert.match(metadata.prompt, /x=96, y=54, width=320, height=180/);
  } finally {
    await stopChild(server.child);
    await rm(workspace, { recursive: true, force: true });
  }
});

test('/api/apply image mode rejects non-image-native slides with useful error', async () => {
  const { workspace } = await createHtmlWorkspace();
  const port = await getAvailablePort();
  const server = spawnEditorServer(workspace, port);

  try {
    await waitForServerReady(port, server.child, server.output);
    const res = await fetch(`http://localhost:${port}/api/apply`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: imageApplyBody(),
    });
    const body = await res.json();

    assert.equal(res.status, 400);
    assert.match(body.error, /not an image-native slide/i);
    assert.match(body.error, /slides-grab edit/i);
  } finally {
    await stopChild(server.child);
    await rm(workspace, { recursive: true, force: true });
  }
});

test('/api/slides/:file/save is unavailable in image editor and leaves slide HTML unchanged', async () => {
  const { workspace, slidesDir } = await createImageNativeWorkspace();
  const slidePath = join(slidesDir, 'slide-01.html');
  const beforeHtml = await readFile(slidePath, 'utf8');
  const port = await getAvailablePort();
  const server = spawnEditorServer(workspace, port);

  try {
    await waitForServerReady(port, server.child, server.output);
    const res = await fetch(`http://localhost:${port}/api/slides/slide-01.html/save`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        slide: 'slide-01.html',
        html: beforeHtml.replace('</body>', '<p>Direct image-editor mutation</p></body>'),
      }),
    });
    const body = await res.json().catch(() => ({}));

    assert.equal(res.status, 405, `expected direct save rejection, got ${res.status}: ${JSON.stringify(body)}`);
    assert.equal(await readFile(slidePath, 'utf8'), beforeHtml);
  } finally {
    await stopChild(server.child);
    await rm(workspace, { recursive: true, force: true });
  }
});

test('regenerateImageNativeSlide does not write metadata when aborted during provider call', async () => {
  const { workspace, slidesDir } = await createImageNativeWorkspace();
  const controller = new AbortController();

  try {
    const regeneration = regenerateImageNativeSlide({
      slidesDir,
      slideFile: 'slide-01.html',
      prompt: 'This should abort before write.',
      selections: [{ bbox: { x: 1, y: 2, width: 3, height: 4 }, targets: [] }],
      provider: 'codex',
      signal: controller.signal,
      generateImageImpl: async () => {
        await sleep(100);
        return { mimeType: 'image/png', bytes: Buffer.from('late-bytes') };
      },
    });
    controller.abort();
    await assert.rejects(regeneration, /Image regeneration was aborted/);

    const metadata = JSON.parse(await readFile(join(slidesDir, '.slides-grab', 'image-native', 'slide-01.json'), 'utf8'));
    assert.equal(metadata.regenerationHistory.length, 0);
    assert.doesNotMatch(metadata.prompt, /This should abort/);
  } finally {
    await rm(workspace, { recursive: true, force: true });
  }
});

test('/api/apply image mode uses active-run conflict and cancellation plumbing', async () => {
  const { workspace } = await createImageNativeWorkspace();
  const port = await getAvailablePort();
  const server = spawnEditorServer(workspace, port, { env: { PPT_AGENT_IMAGE_REGEN_DELAY_MS: '1200' } });

  try {
    await waitForServerReady(port, server.child, server.output);
    const first = fetch(`http://localhost:${port}/api/apply`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: imageApplyBody(),
    });

    let runId = '';
    for (let i = 0; i < 20; i += 1) {
      const runs = await (await fetch(`http://localhost:${port}/api/runs`)).json();
      runId = runs.activeRuns?.find((entry) => entry.slide === 'slide-01.html')?.runId || '';
      if (runId) break;
      await sleep(100);
    }
    assert.ok(runId, 'image mode run should appear in activeRuns');

    const second = await fetch(`http://localhost:${port}/api/apply`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: imageApplyBody(),
    });
    assert.equal(second.status, 409);

    const cancel = await fetch(`http://localhost:${port}/api/runs/${runId}/cancel`, { method: 'POST' });
    assert.equal(cancel.status, 200);
    const firstBody = await first.then((res) => res.json().catch(() => ({}))).catch((error) => ({ error: error.message }));
    assert.equal(firstBody.success, false);
    assert.equal(firstBody.aborted, true);
  } finally {
    await stopChild(server.child);
    await rm(workspace, { recursive: true, force: true });
  }
});

test('editor client removes the unified apply-mode control and consumes fixed editorType config', async () => {
  const html = await readFile(join(REPO_ROOT, 'src', 'editor', 'editor.html'), 'utf8');
  const initJs = await readFile(join(REPO_ROOT, 'src', 'editor', 'js', 'editor-init.js'), 'utf8');
  const sendJs = await readFile(join(REPO_ROOT, 'src', 'editor', 'js', 'editor-send.js'), 'utf8');

  assert.doesNotMatch(html, /id="apply-mode-select"/);
  assert.match(html, /id="image-provider-select"/);
  assert.match(html, /id="model-section"/);
  assert.match(initJs, /editorType/);
  assert.doesNotMatch(initJs, /applyModeSelect/);
  assert.doesNotMatch(sendJs, /applyModeSelect/);
});
