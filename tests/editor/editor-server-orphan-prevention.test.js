import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtemp, mkdir, writeFile, rm, chmod, readFile } from 'node:fs/promises';
import os from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';
import { getAvailablePort } from './test-server-helpers.js';

const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function createWorkspace() {
  const workspace = await mkdtemp(join(os.tmpdir(), 'editor-orphan-test-'));
  const slidesDir = join(workspace, 'slides');
  await mkdir(slidesDir, { recursive: true });
  await writeFile(
    join(slidesDir, 'slide-01.html'),
    '<!doctype html><html><body><div><h1>Test</h1><p>Slide</p></div></body></html>',
    'utf8',
  );
  return workspace;
}

async function writeHangingMockCli(workspace, fileName) {
const mockPath = join(workspace, fileName);
const pidLogPath = join(workspace, `${fileName}.pids`);
const script = `#!/usr/bin/env node
const fs = require('node:fs');
process.on('SIGTERM', () => {
  fs.appendFileSync(${JSON.stringify(pidLogPath)}, 'SIGTERM:' + process.pid + '\\n');
  process.exit(143);
});
process.on('SIGINT', () => {
  fs.appendFileSync(${JSON.stringify(pidLogPath)}, 'SIGINT:' + process.pid + '\\n');
  process.exit(130);
});
fs.appendFileSync(${JSON.stringify(pidLogPath)}, String(process.pid) + '\\n');
process.stdout.write('hanging-mock-started pid=' + process.pid + '\\n');
setTimeout(() => {
  fs.appendFileSync(${JSON.stringify(pidLogPath)}, 'TIMEOUT_EXIT:' + process.pid + '\\n');
  process.exit(0);
}, 600000);
setInterval(() => {}, 1000).unref?.();
`;
  await writeFile(mockPath, script, 'utf8');
  await chmod(mockPath, 0o755);
  return { mockPath, pidLogPath };
}

async function readPidLog(pidLogPath) {
  try {
    return await readFile(pidLogPath, 'utf8');
  } catch (error) {
    if (error.code === 'ENOENT') return '';
    throw error;
  }
}

function spawnEditorServer(workspace, port, { env = {}, args = [] } = {}) {
  const output = { value: '' };
  const child = spawn(
    process.execPath,
    [join(REPO_ROOT, 'scripts', 'editor-server.js'), '--port', String(port), ...args],
    {
      cwd: workspace,
      env: {
        ...process.env,
        PPT_AGENT_PACKAGE_ROOT: REPO_ROOT,
        ...env,
      },
      stdio: ['ignore', 'pipe', 'pipe'],
    },
  );
  child.stdout.on('data', (chunk) => {
    output.value += chunk.toString();
  });
  child.stderr.on('data', (chunk) => {
    output.value += chunk.toString();
  });
  return { child, output };
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
    } catch {}
    await sleep(150);
  }
  throw new Error(`server did not become ready\n${outputRef.value}`);
}

async function waitForExit(child, timeoutMs = 8000) {
  return new Promise((resolve) => {
    const timeout = setTimeout(() => {
      try {
        child.kill('SIGKILL');
      } catch {}
      resolve({ code: null, signal: 'SIGKILL', timedOut: true });
    }, timeoutMs);
    child.once('exit', (code, signal) => {
      clearTimeout(timeout);
      resolve({ code, signal, timedOut: false });
    });
  });
}

async function stopServer(child) {
  if (child.exitCode !== null) return;
  child.kill('SIGTERM');
  await waitForExit(child, 5000);
}

function pidIsAlive(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

async function waitForPidGone(pid, timeoutMs = 8000) {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    if (!pidIsAlive(pid)) return true;
    await sleep(50);
  }
  return false;
}

async function readSpawnedPids(pidLogPath, expectedCount = 1, timeoutMs = 8000) {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    const log = await readPidLog(pidLogPath);
    const pids = log
      .split('\n')
      .map((line) => line.trim())
      .filter((line) => /^\d+$/.test(line))
      .map((line) => Number(line));
    if (pids.length >= expectedCount) return pids;
    await sleep(50);
  }
  const log = await readPidLog(pidLogPath);
  throw new Error(`spawned mock did not log a pid in time. log:\n${log}`);
}

test('editor-server kills the spawned codex child when the /api/apply request is aborted mid-flight', async () => {
  const workspace = await createWorkspace();
  const { mockPath, pidLogPath } = await writeHangingMockCli(workspace, 'mock-codex-hang.js');
  const port = await getAvailablePort();
  const server = spawnEditorServer(workspace, port, {
    env: { PPT_AGENT_CODEX_BIN: mockPath },
  });

  try {
    await waitForServerReady(port, server.child, server.output);

    const abortController = new AbortController();
    const applyPromise = fetch(`http://localhost:${port}/api/apply`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        slide: 'slide-01.html',
        prompt: 'Hang this edit so we can abort it.',
        model: 'gpt-5.6-sol',
        selections: [
          {
            x: 40,
            y: 60,
            width: 320,
            height: 180,
            targets: [{ xpath: '/html/body/div[1]/h1[1]', tag: 'h1', text: 'Test' }],
          },
        ],
      }),
      signal: abortController.signal,
    }).catch((error) => ({ aborted: true, error }));

    const spawnedPids = await readSpawnedPids(pidLogPath, 1, 10000);
    const codexPid = spawnedPids[0];
    assert.ok(
      pidIsAlive(codexPid),
      `mock codex (pid=${codexPid}) must be alive while the /api/apply request is in flight`,
    );

    abortController.abort();
    await applyPromise.catch(() => {});

    const gone = await waitForPidGone(codexPid, 10000);
    assert.equal(
      gone,
      true,
      `mock codex (pid=${codexPid}) MUST be killed shortly after the /api/apply HTTP request was aborted (orphan-prevention regression). Server output:\n${server.output.value}`,
    );

    const pidLog = await readPidLog(pidLogPath);
    assert.match(
      pidLog,
      new RegExp(`SIGTERM:${codexPid}`),
      `mock codex must record receiving SIGTERM after the request was aborted. log:\n${pidLog}`,
    );
  } finally {
    await stopServer(server.child);
    await rm(workspace, { recursive: true, force: true });
  }
});

test('editor-server kills all in-flight codex children when the server itself is shut down', async () => {
  const workspace = await createWorkspace();
  const { mockPath, pidLogPath } = await writeHangingMockCli(workspace, 'mock-codex-hang.js');
  const port = await getAvailablePort();
  const server = spawnEditorServer(workspace, port, {
    env: { PPT_AGENT_CODEX_BIN: mockPath },
  });

  try {
    await waitForServerReady(port, server.child, server.output);

    fetch(`http://localhost:${port}/api/apply`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        slide: 'slide-01.html',
        prompt: 'Hang during shutdown.',
        model: 'gpt-5.6-sol',
        selections: [
          {
            x: 40,
            y: 60,
            width: 320,
            height: 180,
            targets: [{ xpath: '/html/body/div[1]/h1[1]', tag: 'h1', text: 'Test' }],
          },
        ],
      }),
    }).catch(() => {});

    const spawnedPids = await readSpawnedPids(pidLogPath, 1, 10000);
    const codexPid = spawnedPids[0];
    assert.ok(pidIsAlive(codexPid), `mock codex (pid=${codexPid}) should be alive before shutdown`);

    server.child.kill('SIGTERM');
    await waitForExit(server.child, 8000);

    const gone = await waitForPidGone(codexPid, 10000);
    assert.equal(
      gone,
      true,
      `mock codex (pid=${codexPid}) MUST be killed when the editor-server shuts down so we never leave orphan processes. Server output:\n${server.output.value}`,
    );
  } finally {
    await stopServer(server.child);
    await rm(workspace, { recursive: true, force: true });
  }
});

test('/api/runs/:runId/cancel kills the spawned child and reports cancelled=true', async () => {
  const workspace = await createWorkspace();
  const { mockPath, pidLogPath } = await writeHangingMockCli(workspace, 'mock-codex-hang.js');
  const port = await getAvailablePort();
  const server = spawnEditorServer(workspace, port, {
    env: { PPT_AGENT_CODEX_BIN: mockPath },
  });

  try {
    await waitForServerReady(port, server.child, server.output);

    const applyPromise = fetch(`http://localhost:${port}/api/apply`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        slide: 'slide-01.html',
        prompt: 'Hang to be cancelled via API.',
        model: 'gpt-5.6-sol',
        selections: [
          {
            x: 40,
            y: 60,
            width: 320,
            height: 180,
            targets: [{ xpath: '/html/body/div[1]/h1[1]', tag: 'h1', text: 'Test' }],
          },
        ],
      }),
    });

    const spawnedPids = await readSpawnedPids(pidLogPath, 1, 10000);
    const codexPid = spawnedPids[0];

    let runId = null;
    const startedAt = Date.now();
    while (Date.now() - startedAt < 10000) {
      const runsRes = await fetch(`http://localhost:${port}/api/runs`);
      const runsBody = await runsRes.json();
      const active = runsBody.activeRuns?.find((entry) => entry.slide === 'slide-01.html');
      if (active) {
        runId = active.runId;
        break;
      }
      await sleep(100);
    }
    assert.ok(runId, 'expected /api/runs to expose an activeRun for slide-01.html');

    const cancelRes = await fetch(`http://localhost:${port}/api/runs/${runId}/cancel`, {
      method: 'POST',
    });
    assert.equal(cancelRes.status, 200, 'cancel endpoint must return 200 for an active run');
    const cancelBody = await cancelRes.json();
    assert.equal(cancelBody.cancelled, true);
    assert.equal(cancelBody.runId, runId);

    const gone = await waitForPidGone(codexPid, 10000);
    assert.equal(gone, true, `cancel API must kill mock codex (pid=${codexPid})`);

    const applyRes = await applyPromise.catch((error) => ({ error }));
    if (applyRes && typeof applyRes.json === 'function') {
      const applyBody = await applyRes.json();
      assert.equal(applyBody.aborted, true, 'apply response must report aborted=true after cancel');
      assert.equal(applyBody.success, false);
    }

    const cancelMissingRes = await fetch(`http://localhost:${port}/api/runs/${runId}/cancel`, {
      method: 'POST',
    });
    assert.equal(
      cancelMissingRes.status,
      404,
      'cancel endpoint must 404 when the run is no longer active',
    );
  } finally {
    await stopServer(server.child);
    await rm(workspace, { recursive: true, force: true });
  }
});
