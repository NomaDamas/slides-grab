import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';

import { generateImageNativeSlides } from '../../src/image-native.js';
import { getAvailablePort } from './test-server-helpers.js';

const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const EDITOR_SERVER = join(REPO_ROOT, 'scripts', 'editor-server.js');
const CLI = join(REPO_ROOT, 'bin', 'ppt-agent.js');
const FAKE_CODEX_BIN = join(REPO_ROOT, 'tests', 'editor', 'fixtures', 'fake-codex.cjs');
const FAKE_CLAUDE_BIN = join(REPO_ROOT, 'tests', 'editor', 'fixtures', 'fake-claude.cjs');

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function readOptional(path) {
  return readFile(path, 'utf8').catch(() => null);
}

async function createHtmlWorkspace() {
  const workspace = await mkdtemp(join(os.tmpdir(), 'editor-mode-split-html-'));
  const slidesDir = join(workspace, 'slides');
  const slidePath = join(slidesDir, 'slide-01.html');
  await mkdir(slidesDir, { recursive: true });
  await writeFile(slidePath, '<!doctype html><html><body><h1>HTML slide</h1></body></html>', 'utf8');
  return { workspace, slidesDir, slidePath };
}

async function createImageNativeWorkspace() {
  const workspace = await mkdtemp(join(os.tmpdir(), 'editor-mode-split-image-'));
  const outlinePath = join(workspace, 'slide-outline.md');
  const slidesDir = join(workspace, 'slides');
  const metadataPath = join(slidesDir, '.slides-grab', 'image-native', 'slide-01.json');
  await writeFile(outlinePath, '# Demo\n\n## Slide 1: Hero\n- Fact: regenerate me\n', 'utf8');
  await generateImageNativeSlides({ outlinePath, slidesDir, provider: 'dry-run' });
  return {
    workspace,
    slidesDir,
    slidePath: join(slidesDir, 'slide-01.html'),
    metadataPath,
  };
}

function spawnEditorServer(workspace, port, { args = [], env = {} } = {}) {
  const output = { value: '' };
  const child = spawn(process.execPath, [EDITOR_SERVER, '--port', String(port), ...args], {
    cwd: workspace,
    env: {
      ...process.env,
      PPT_AGENT_PACKAGE_ROOT: REPO_ROOT,
      PPT_AGENT_CODEX_BIN: FAKE_CODEX_BIN,
      PPT_AGENT_CLAUDE_BIN: FAKE_CLAUDE_BIN,
      ...env,
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  child.stdout.on('data', (chunk) => { output.value += chunk.toString(); });
  child.stderr.on('data', (chunk) => { output.value += chunk.toString(); });
  return { child, output };
}

function spawnCliEditor(workspace, port, command) {
  const output = { value: '' };
  const child = spawn(process.execPath, [CLI, command, '--port', String(port)], {
    cwd: workspace,
    detached: true,
    env: {
      ...process.env,
      PPT_AGENT_PACKAGE_ROOT: REPO_ROOT,
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  child.stdout.on('data', (chunk) => { output.value += chunk.toString(); });
  child.stderr.on('data', (chunk) => { output.value += chunk.toString(); });
  return { child, output };
}

async function runCli(args) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [CLI, ...args], {
      cwd: REPO_ROOT,
      env: { ...process.env, PPT_AGENT_PACKAGE_ROOT: REPO_ROOT },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let output = '';
    child.stdout.on('data', (chunk) => { output += chunk.toString(); });
    child.stderr.on('data', (chunk) => { output += chunk.toString(); });
    child.once('error', reject);
    child.once('exit', (code, signal) => resolve({ code, signal, output }));
  });
}

async function waitForServerReady(port, child, outputRef) {
  const started = Date.now();
  while (Date.now() - started < 15000) {
    if (child.exitCode !== null) {
      throw new Error(`server exited early: ${child.exitCode}\n${outputRef.value}`);
    }

    try {
      const res = await fetch(`http://localhost:${port}/api/slides`);
      if (res.ok) return;
    } catch {
      // retry
    }

    await sleep(100);
  }

  throw new Error(`server did not become ready\n${outputRef.value}`);
}

async function waitForExit(child, timeoutMs = 5000) {
  if (child.exitCode !== null) {
    return { code: child.exitCode, signal: child.signalCode };
  }

  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      reject(new Error(`process did not exit within ${timeoutMs}ms`));
    }, timeoutMs);
    child.once('exit', (code, signal) => {
      clearTimeout(timeout);
      resolve({ code, signal });
    });
    child.once('error', (error) => {
      clearTimeout(timeout);
      reject(error);
    });
  });
}

async function stopChild(child, { processGroup = false } = {}) {
  if (child.exitCode !== null) return;

  try {
    if (processGroup) {
      process.kill(-child.pid, 'SIGTERM');
    } else {
      child.kill('SIGTERM');
    }
  } catch {
    try { child.kill('SIGTERM'); } catch {}
  }

  await waitForExit(child).catch(() => {});
}

function applyBody({ mode, ...overrides } = {}) {
  const body = {
    slide: 'slide-01.html',
    prompt: 'Regenerate or edit the selected region.',
    model: 'gpt-5.6-sol',
    selections: [{ x: 96, y: 54, width: 320, height: 180, targets: [] }],
    ...overrides,
  };
  if (mode !== undefined) body.mode = mode;
  return body;
}

async function postApply(port, body) {
  const response = await fetch(`http://localhost:${port}/api/apply`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  return { response, body: await response.json() };
}

async function assertNoActiveRuns(port) {
  const runs = await (await fetch(`http://localhost:${port}/api/runs`)).json();
  assert.deepEqual(runs.runs, []);
  assert.deepEqual(runs.activeRuns, []);
}

test('CLI help exposes both fixed editor entrypoints', async () => {
  const htmlHelp = await runCli(['edit', '--help']);
  const imageHelp = await runCli(['edit-image', '--help']);

  assert.equal(htmlHelp.code, 0, htmlHelp.output);
  assert.match(htmlHelp.output, /Usage: slides-grab edit(?: |\[)/);
  assert.equal(imageHelp.code, 0, imageHelp.output);
  assert.match(imageHelp.output, /Usage: slides-grab edit-image(?: |\[)/);
});

test('slides-grab edit starts an HTML server with a printed and configured html editor type', async () => {
  const { workspace } = await createHtmlWorkspace();
  const port = await getAvailablePort();
  const server = spawnCliEditor(workspace, port, 'edit');

  try {
    await waitForServerReady(port, server.child, server.output);
    const config = await (await fetch(`http://localhost:${port}/api/config`)).json();
    assert.equal(config.editorType, 'html');
    assert.match(server.output.value, /Editor:\s+html/);
  } finally {
    await stopChild(server.child, { processGroup: true });
    await rm(workspace, { recursive: true, force: true });
  }
});

test('slides-grab edit-image starts an image server with a printed and configured image editor type', async () => {
  const { workspace } = await createImageNativeWorkspace();
  const port = await getAvailablePort();
  const server = spawnCliEditor(workspace, port, 'edit-image');

  try {
    await waitForServerReady(port, server.child, server.output);
    const config = await (await fetch(`http://localhost:${port}/api/config`)).json();
    assert.equal(config.editorType, 'image');
    assert.match(server.output.value, /Editor:\s+image/);
  } finally {
    await stopChild(server.child, { processGroup: true });
    await rm(workspace, { recursive: true, force: true });
  }
});

test('editor server defaults to html and exposes the startup editor type in /api/config', async () => {
  const { workspace } = await createHtmlWorkspace();
  const port = await getAvailablePort();
  const server = spawnEditorServer(workspace, port);

  try {
    await waitForServerReady(port, server.child, server.output);
    const config = await (await fetch(`http://localhost:${port}/api/config`)).json();
    assert.equal(config.editorType, 'html');
    assert.match(server.output.value, /Editor:\s+html/);
  } finally {
    await stopChild(server.child);
    await rm(workspace, { recursive: true, force: true });
  }
});

test('default HTML server rejects a mismatched image payload before run or file mutation', async () => {
  const { workspace, slidePath } = await createHtmlWorkspace();
  const beforeHtml = await readFile(slidePath, 'utf8');
  const port = await getAvailablePort();
  const server = spawnEditorServer(workspace, port);

  try {
    await waitForServerReady(port, server.child, server.output);
    const { response, body } = await postApply(port, applyBody({ mode: 'image' }));

    assert.equal(response.status, 400, JSON.stringify(body));
    assert.match(body.error, /Configured editor is html/);
    assert.match(body.error, /slides-grab edit-image/);
    assert.equal(await readFile(slidePath, 'utf8'), beforeHtml);
    await assertNoActiveRuns(port);
  } finally {
    await stopChild(server.child);
    await rm(workspace, { recursive: true, force: true });
  }
});

test('image server rejects a mismatched HTML payload before regeneration or metadata mutation', async () => {
  const { workspace, slidePath, metadataPath } = await createImageNativeWorkspace();
  const beforeHtml = await readFile(slidePath, 'utf8');
  const beforeMetadata = await readFile(metadataPath, 'utf8');
  const port = await getAvailablePort();
  const server = spawnEditorServer(workspace, port, { args: ['--editor', 'image'] });

  try {
    await waitForServerReady(port, server.child, server.output);
    const { response, body } = await postApply(port, applyBody({ mode: 'html', model: 'gpt-5.6-sol' }));

    assert.equal(response.status, 400, JSON.stringify(body));
    assert.match(body.error, /Configured editor is image/);
    assert.match(body.error, /slides-grab edit(?:\.|\s)/);
    assert.equal(await readFile(slidePath, 'utf8'), beforeHtml);
    assert.equal(await readFile(metadataPath, 'utf8'), beforeMetadata);
    await assertNoActiveRuns(port);
  } finally {
    await stopChild(server.child);
    await rm(workspace, { recursive: true, force: true });
  }
});

test('image server accepts omitted and image body modes for image-native slides', async () => {
  for (const mode of [undefined, 'image']) {
    const { workspace, metadataPath } = await createImageNativeWorkspace();
    const port = await getAvailablePort();
    const server = spawnEditorServer(workspace, port, { args: ['--editor', 'image'] });

    try {
      await waitForServerReady(port, server.child, server.output);
      const { response, body } = await postApply(port, applyBody({
        mode,
        model: 'dry-run-image',
        provider: 'dry-run',
      }));

      assert.equal(response.status, 200, JSON.stringify(body));
      assert.equal(body.success, true);
      assert.equal(body.mode, 'image');
      const metadata = JSON.parse(await readFile(metadataPath, 'utf8'));
      assert.equal(metadata.regenerationHistory.length, 1);
    } finally {
      await stopChild(server.child);
      await rm(workspace, { recursive: true, force: true });
    }
  }
});

test('image server rejects non-image-native slides without file or metadata mutation', async () => {
  const { workspace, slidePath, slidesDir } = await createHtmlWorkspace();
  const metadataPath = join(slidesDir, '.slides-grab', 'image-native', 'slide-01.json');
  const beforeHtml = await readFile(slidePath, 'utf8');
  const beforeMetadata = await readOptional(metadataPath);
  const port = await getAvailablePort();
  const server = spawnEditorServer(workspace, port, { args: ['--editor', 'image'] });

  try {
    await waitForServerReady(port, server.child, server.output);
    const { response, body } = await postApply(port, applyBody({
      model: 'dry-run-image',
      provider: 'dry-run',
    }));

    assert.equal(response.status, 400, JSON.stringify(body));
    assert.match(body.error, /not an image-native slide/i);
    assert.equal(await readFile(slidePath, 'utf8'), beforeHtml);
    assert.equal(await readOptional(metadataPath), beforeMetadata);
    await assertNoActiveRuns(port);
  } finally {
    await stopChild(server.child);
    await rm(workspace, { recursive: true, force: true });
  }
});
