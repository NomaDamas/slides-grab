import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtemp, mkdir, writeFile, rm, chmod } from 'node:fs/promises';
import os from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';
import { getAvailablePort } from './test-server-helpers.js';

const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function writeSlides(workspace) {
  const slidesDir = join(workspace, 'slides');
  await mkdir(slidesDir, { recursive: true });

  const html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <style>
    html, body { margin: 0; padding: 0; width: 960px; height: 540px; overflow: hidden; }
    .wrap { width: 960px; height: 540px; padding: 48px; box-sizing: border-box; }
    h1 { margin: 0; font-size: 56px; }
    p { margin: 20px 0 0 0; font-size: 24px; }
  </style>
</head>
<body>
  <div class="wrap">
    <h1>Hello World</h1>
    <p>Concurrency test</p>
  </div>
</body>
</html>`;

  await writeFile(join(slidesDir, 'slide-01.html'), html, 'utf8');
  await writeFile(join(slidesDir, 'slide-02.html'), html, 'utf8');
}

async function writeMockCli(workspace, fileName, outputLabel) {
  const mockPath = join(workspace, fileName);
  const script = `#!/usr/bin/env node
const delay = Number(process.env.MOCK_EDIT_SLEEP_MS || 1200);
const code = Number(process.env.MOCK_EDIT_EXIT_CODE || 0);
setTimeout(() => {
  process.stdout.write('${outputLabel}\\n');
  process.exit(code);
}, delay);
`;
  await writeFile(mockPath, script, 'utf8');
  await chmod(mockPath, 0o755);
  return mockPath;
}

async function waitForServerReady(port, child, outputRef) {
  const started = Date.now();
  while (Date.now() - started < 20000) {
    if (child.exitCode !== null) {
      throw new Error(`server exited early: ${child.exitCode}\n${outputRef.value}`);
    }

    try {
      const res = await fetch(`http://localhost:${port}/api/slides`);
      if (res.ok) return;
    } catch {
      // retry
    }

    await sleep(150);
  }

  throw new Error(`server did not become ready\n${outputRef.value}`);
}

function createApplyBody(slide, overrides = {}) {
  return JSON.stringify({
    slide,
    prompt: `Edit ${slide}`,
    selections: [
      {
        x: 40,
        y: 30,
        width: 520,
        height: 170,
        targets: [
          {
            xpath: '/html/body/div[1]/h1[1]',
            tag: 'h1',
            text: 'Hello World',
          },
        ],
      },
    ],
    ...overrides,
  });
}

async function startEditorServer({ workspace, port, env }) {
  const serverOutput = { value: '' };
  const serverScriptPath = join(REPO_ROOT, 'scripts', 'editor-server.js');
  const server = spawn(process.execPath, [serverScriptPath, '--port', String(port)], {
    cwd: workspace,
    env: {
      ...process.env,
      PPT_AGENT_PACKAGE_ROOT: REPO_ROOT,
      ...env,
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  server.stdout.on('data', (chunk) => {
    serverOutput.value += chunk.toString();
  });
  server.stderr.on('data', (chunk) => {
    serverOutput.value += chunk.toString();
  });

  await waitForServerReady(port, server, serverOutput);
  return { server, serverOutput };
}

test('allows concurrent runs on different slides and blocks second run on same slide', async () => {
  const workspace = await mkdtemp(join(os.tmpdir(), 'editor-concurrency-e2e-'));
  const mockCodex = await writeMockCli(workspace, 'mock-codex.js', 'mock codex run');
  await writeSlides(workspace);

  const port = await getAvailablePort();
  const { server } = await startEditorServer({
    workspace,
    port,
    env: {
      PPT_AGENT_CODEX_BIN: mockCodex,
      MOCK_EDIT_SLEEP_MS: '1400',
    },
  });

  try {
    const t0 = Date.now();
    const req1 = fetch(`http://localhost:${port}/api/apply`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: createApplyBody('slide-01.html'),
    });

    const req2 = fetch(`http://localhost:${port}/api/apply`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: createApplyBody('slide-02.html'),
    });

    const [res1, res2] = await Promise.all([req1, req2]);
    const elapsed = Date.now() - t0;

    const body1Text = await res1.text();
    const body2Text = await res2.text();
    let body1;
    let body2;
    try { body1 = JSON.parse(body1Text); } catch { body1 = { raw: body1Text }; }
    try { body2 = JSON.parse(body2Text); } catch { body2 = { raw: body2Text }; }

    assert.equal(res1.status, 200, `res1 failed: ${JSON.stringify(body1)}`);
    assert.equal(res2.status, 200, `res2 failed: ${JSON.stringify(body2)}`);
    assert.equal(body1.success, true);
    assert.equal(body2.success, true);
    assert.ok(elapsed < 3200, `requests look sequential, elapsed=${elapsed}ms`);

    const firstReq = fetch(`http://localhost:${port}/api/apply`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: createApplyBody('slide-01.html'),
    });

    await sleep(150);

    const secondReq = await fetch(`http://localhost:${port}/api/apply`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: createApplyBody('slide-01.html'),
    });

    assert.equal(secondReq.status, 409);
    const secondBody = await secondReq.json();
    assert.match(secondBody.error || '', /already has an active run/i);

    const firstRes = await firstReq;
    assert.equal(firstRes.status, 200);
    const firstBody = await firstRes.json();
    assert.equal(firstBody.success, true);
  } finally {
    server.kill('SIGTERM');
    await sleep(400);
    await rm(workspace, { recursive: true, force: true }).catch(() => {});
  }
});

test('times out stuck codex bbox edit subprocesses and clears the active run lock', async () => {
  const workspace = await mkdtemp(join(os.tmpdir(), 'editor-timeout-codex-e2e-'));
  const mockCodex = await writeMockCli(workspace, 'mock-codex.js', 'mock codex run');
  await writeSlides(workspace);

  const port = await getAvailablePort();
  const { server } = await startEditorServer({
    workspace,
    port,
    env: {
      PPT_AGENT_CODEX_BIN: mockCodex,
      PPT_AGENT_EDIT_TIMEOUT_MS: '200',
      MOCK_EDIT_SLEEP_MS: '5000',
    },
  });

  try {
    const firstRes = await fetch(`http://localhost:${port}/api/apply`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: createApplyBody('slide-01.html'),
    });

    const firstBody = await firstRes.json();
    assert.equal(firstRes.status, 200);
    assert.equal(firstBody.success, false);
    assert.equal(firstBody.code, 124);
    assert.match(firstBody.message || '', /timed out/i);

    const secondRes = await fetch(`http://localhost:${port}/api/apply`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: createApplyBody('slide-01.html'),
    });

    const secondBody = await secondRes.json();
    assert.equal(secondRes.status, 200, `second run should not stay locked: ${JSON.stringify(secondBody)}`);
    assert.equal(secondBody.success, false);
    assert.equal(secondBody.code, 124);
    assert.match(secondBody.message || '', /timed out/i);
  } finally {
    server.kill('SIGTERM');
    await sleep(400);
    await rm(workspace, { recursive: true, force: true }).catch(() => {});
  }
});

test('times out stuck claude bbox edit subprocesses and clears the active run lock', async () => {
  const workspace = await mkdtemp(join(os.tmpdir(), 'editor-timeout-claude-e2e-'));
  const mockClaude = await writeMockCli(workspace, 'mock-claude.js', 'mock claude run');
  await writeSlides(workspace);

  const port = await getAvailablePort();
  const { server } = await startEditorServer({
    workspace,
    port,
    env: {
      PPT_AGENT_CLAUDE_BIN: mockClaude,
      PPT_AGENT_EDIT_TIMEOUT_MS: '200',
      MOCK_EDIT_SLEEP_MS: '5000',
    },
  });

  try {
    const firstRes = await fetch(`http://localhost:${port}/api/apply`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: createApplyBody('slide-01.html', { model: 'opus-5.5' }),
    });

    const firstBody = await firstRes.json();
    assert.equal(firstRes.status, 200);
    assert.equal(firstBody.success, false);
    assert.equal(firstBody.code, 124);
    assert.match(firstBody.message || '', /timed out/i);

    const secondRes = await fetch(`http://localhost:${port}/api/apply`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: createApplyBody('slide-01.html', { model: 'opus-5.5' }),
    });

    const secondBody = await secondRes.json();
    assert.equal(secondRes.status, 200, `second run should not stay locked: ${JSON.stringify(secondBody)}`);
    assert.equal(secondBody.success, false);
    assert.equal(secondBody.code, 124);
    assert.match(secondBody.message || '', /timed out/i);
  } finally {
    server.kill('SIGTERM');
    await sleep(400);
    await rm(workspace, { recursive: true, force: true }).catch(() => {});
  }
});
