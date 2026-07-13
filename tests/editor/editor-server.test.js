import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtemp, mkdir, writeFile, rm, chmod } from 'node:fs/promises';
import os from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';
import { getAvailablePort } from './test-server-helpers.js';

const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const FAKE_CODEX_BIN = join(REPO_ROOT, 'tests', 'editor', 'fixtures', 'fake-codex.cjs');
const FAKE_CLAUDE_BIN = join(REPO_ROOT, 'tests', 'editor', 'fixtures', 'fake-claude.cjs');

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function createWorkspace({ slideHtml } = {}) {
  const workspace = await mkdtemp(join(os.tmpdir(), 'editor-server-test-'));
  const slidesDir = join(workspace, 'slides');
  await mkdir(slidesDir, { recursive: true });
  await writeFile(
    join(slidesDir, 'slide-01.html'),
    slideHtml || '<!doctype html><html><body><div><h1>Test</h1><p>Slide</p></div></body></html>',
    'utf8',
  );
  return workspace;
}

async function writeMockCli(workspace, fileName) {
  const mockPath = join(workspace, fileName);
  const script = `#!/usr/bin/env node
const prompt = process.argv[process.argv.length - 1] || '';
process.stdout.write(process.argv.slice(2).join(' ') + '\\n');
process.stdout.write(prompt);
process.exit(0);
`;
  await writeFile(mockPath, script, 'utf8');
  await chmod(mockPath, 0o755);
  return mockPath;
}

function spawnEditorServer(workspace, port, { args = [], env = {} } = {}) {
  const output = { value: '' };
  const child = spawn(
    process.execPath,
    [join(REPO_ROOT, 'scripts', 'editor-server.js'), '--port', String(port), ...args],
    {
      cwd: workspace,
      env: {
        ...process.env,
        PPT_AGENT_PACKAGE_ROOT: REPO_ROOT,
        PPT_AGENT_CODEX_BIN: FAKE_CODEX_BIN,
        PPT_AGENT_CLAUDE_BIN: FAKE_CLAUDE_BIN,
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
      if (res.ok) {
        return;
      }
    } catch {
      // retry
    }

    await sleep(150);
  }

  throw new Error(`server did not become ready\n${outputRef.value}`);
}

async function waitForExit(child, timeoutMs = 5000) {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      child.kill('SIGTERM');
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

async function stopChild(child) {
  if (child.exitCode !== null) {
    return;
  }

  child.kill('SIGTERM');
  await waitForExit(child, 5000).catch(() => {});
}

test('refuses to open a second editor when another slides-grab editor already owns the port', async () => {
  const workspace = await createWorkspace();
  const port = await getAvailablePort();
  const first = spawnEditorServer(workspace, port);

  try {
    await waitForServerReady(port, first.child, first.output);

    const second = spawnEditorServer(workspace, port);
    try {
      const { code, signal } = await waitForExit(second.child);
      assert.equal(signal, null);
      assert.equal(code, 1);
      assert.match(second.output.value, new RegExp(`editor port ${port} is already in use`, 'i'));
      assert.match(second.output.value, /choose another port/i);
    } finally {
      await stopChild(second.child);
    }

    const res = await fetch(`http://localhost:${port}/api/slides`);
    assert.equal(res.ok, true, `first editor should still be serving slides\n${first.output.value}`);
  } finally {
    await stopChild(first.child);
    await rm(workspace, { recursive: true, force: true });
  }
});

test('/api/models exposes the GPT-5.6 family with Sol as default and removes gpt-5.5 (issue #122)', async () => {
  const workspace = await createWorkspace();
  const port = await getAvailablePort();
  const server = spawnEditorServer(workspace, port);

  try {
    await waitForServerReady(port, server.child, server.output);

    const res = await fetch(`http://localhost:${port}/api/models`);
    assert.equal(res.status, 200);
    const body = await res.json();

    assert.deepEqual(body.models, [
      'gpt-5.6-sol',
      'gpt-5.6-terra',
      'gpt-5.6-luna',
      'claude-opus-4-8',
      'claude-sonnet-4-6',
    ]);
    assert.equal(body.defaultModel, 'gpt-5.6-sol');
  } finally {
    await stopChild(server.child);
    await rm(workspace, { recursive: true, force: true });
  }
});

test('/api/apply rejects removed GPT-5.5, GPT-5.4, and GPT-5.3 identifiers', async () => {
  const workspace = await createWorkspace();
  const port = await getAvailablePort();
  const server = spawnEditorServer(workspace, port);

  try {
    await waitForServerReady(port, server.child, server.output);
    for (const model of ['gpt-5.5', 'gpt-5.4', 'gpt-5.3-codex', 'gpt-5.3-codex-spark']) {
      const applyRes = await fetch(`http://localhost:${port}/api/apply`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          slide: 'slide-01.html',
          prompt: 'Reject the removed model.',
          model,
          selections: [{ x: 40, y: 60, width: 320, height: 180, targets: [] }],
        }),
      });

      const body = await applyRes.json();
      assert.equal(applyRes.status, 400, `model=${model} body=${JSON.stringify(body)}`);
      assert.match(body.error || '', /Invalid `model`/);
      assert.match(body.error || '', /gpt-5\.6-sol/);
      assert.match(body.error || '', /gpt-5\.6-terra/);
      assert.match(body.error || '', /gpt-5\.6-luna/);
      assert.doesNotMatch(body.error || '', /gpt-5\.(?:5|4|3)/);
    }
  } finally {
    await stopChild(server.child);
    await rm(workspace, { recursive: true, force: true });
  }
});

test('/api/apply injects DESIGN.slides.md from the active --slides-dir, not launch cwd', async () => {
  const workspace = await createWorkspace();
  await writeFile(join(workspace, 'DESIGN.md'), [
    '---',
    'name: Wrong Root Design',
    '---',
    '',
    '## Overview',
    'This root design should not be used.',
  ].join('\n'), 'utf8');
  await writeFile(join(workspace, 'slides', 'DESIGN.slides.md'), [
    '---',
    'name: Deck Local Design',
    '---',
    '',
    '## Overview',
    'This deck-local design should be injected.',
  ].join('\n'), 'utf8');
  const mockCodex = await writeMockCli(workspace, 'mock-codex.js');
  const port = await getAvailablePort();
  const server = spawnEditorServer(workspace, port, {
    env: {
      PPT_AGENT_CODEX_BIN: mockCodex,
    },
  });

  try {
    await waitForServerReady(port, server.child, server.output);

    const applyRes = await fetch(`http://localhost:${port}/api/apply`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        slide: 'slide-01.html',
        prompt: 'Use the active deck style.',
        selections: [
          {
            x: 40,
            y: 60,
            width: 320,
            height: 180,
            targets: [],
          },
        ],
      }),
    });

    const applyBody = await applyRes.json();
    assert.equal(applyRes.status, 200, JSON.stringify(applyBody));
    assert.equal(applyBody.success, true);

    const logRes = await fetch(`http://localhost:${port}/api/runs/${applyBody.runId}/log`);
    assert.equal(logRes.status, 200);
    const log = await logRes.text();

    assert.match(log, /Deck Local Design/);
    assert.doesNotMatch(log, /Wrong Root Design/);
  } finally {
    await stopChild(server.child);
    await rm(workspace, { recursive: true, force: true });
  }
});

test('/api/apply routes claude-opus-4-8 through the claude CLI with --model claude-opus-4-8 (issue #88)', async () => {
  const workspace = await createWorkspace();
  const mockClaude = await writeMockCli(workspace, 'mock-claude.js');
  const port = await getAvailablePort();
  const server = spawnEditorServer(workspace, port, {
    env: {
      PPT_AGENT_CLAUDE_BIN: mockClaude,
    },
  });

  try {
    await waitForServerReady(port, server.child, server.output);

    const applyRes = await fetch(`http://localhost:${port}/api/apply`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        slide: 'slide-01.html',
        prompt: 'Upgrade the title styling.',
        model: 'claude-opus-4-8',
        selections: [
          {
            x: 40,
            y: 60,
            width: 320,
            height: 180,
            targets: [
              {
                xpath: '/html/body/div[1]/h1[1]',
                tag: 'h1',
                text: 'Test',
              },
            ],
          },
        ],
      }),
    });

    const applyBody = await applyRes.json();
    assert.equal(applyRes.status, 200, JSON.stringify(applyBody));
    assert.equal(applyBody.success, true, `claude-opus-4-8 edit should succeed: ${JSON.stringify(applyBody)}`);

    const logRes = await fetch(`http://localhost:${port}/api/runs/${applyBody.runId}/log`);
    assert.equal(logRes.status, 200);
    const log = await logRes.text();

    assert.match(log, /Upgrade the title styling\./);
    assert.match(log, /--model claude-opus-4-8/);
  } finally {
    await stopChild(server.child);
    await rm(workspace, { recursive: true, force: true });
  }
});

test('/api/apply rejects the superseded claude-opus-4-7 identifier (issue #88)', async () => {
  const workspace = await createWorkspace();
  const port = await getAvailablePort();
  const server = spawnEditorServer(workspace, port);

  try {
    await waitForServerReady(port, server.child, server.output);

    const applyRes = await fetch(`http://localhost:${port}/api/apply`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        slide: 'slide-01.html',
        prompt: 'Try a dropped model.',
        model: 'claude-opus-4-7',
        selections: [
          {
            x: 40,
            y: 60,
            width: 320,
            height: 180,
            targets: [],
          },
        ],
      }),
    });

    assert.equal(applyRes.status, 400, 'claude-opus-4-7 should be rejected with 400 now that it is removed');
    const body = await applyRes.json();
    assert.match(body.error || '', /Invalid `model`/);
    assert.ok(
      !(body.error || '').includes('claude-opus-4-7'),
      `error.Allowed models list should no longer mention 'claude-opus-4-7'. Got: ${body.error}`,
    );
    assert.ok(
      (body.error || '').includes('claude-opus-4-8'),
      `error.Allowed models list should mention 'claude-opus-4-8'. Got: ${body.error}`,
    );
  } finally {
    await stopChild(server.child);
    await rm(workspace, { recursive: true, force: true });
  }
});

test('card-news editor mode passes square sizing guidance into Codex apply runs', async () => {
  const workspace = await createWorkspace({
    slideHtml: `<!doctype html>
<html>
  <head>
    <meta charset="utf-8" />
    <style>
      html, body { margin: 0; width: 960px; height: 960px; overflow: hidden; }
      body { font-family: sans-serif; }
      .frame { width: 960px; height: 960px; padding: 48px; box-sizing: border-box; }
    </style>
  </head>
  <body>
    <div class="frame">
      <h1>Square headline</h1>
      <p>Card-news body copy.</p>
    </div>
  </body>
</html>`,
  });
  const mockCodex = await writeMockCli(workspace, 'mock-codex.js');
  const port = await getAvailablePort();
  const server = spawnEditorServer(workspace, port, {
    args: ['--mode', 'card-news'],
    env: {
      PPT_AGENT_CODEX_BIN: mockCodex,
    },
  });

  try {
    await waitForServerReady(port, server.child, server.output);

    const applyRes = await fetch(`http://localhost:${port}/api/apply`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        slide: 'slide-01.html',
        prompt: 'Tighten the square cover composition.',
        selections: [
          {
            x: 80,
            y: 120,
            width: 420,
            height: 360,
            targets: [
              {
                xpath: '/html/body/div[1]/h1[1]',
                tag: 'h1',
                text: 'Square headline',
              },
            ],
          },
        ],
      }),
    });

    const applyBody = await applyRes.json();
    assert.equal(applyRes.status, 200, JSON.stringify(applyBody));
    assert.equal(applyBody.success, true);
    assert.equal(applyBody.selectionsCount, 1);

    const logRes = await fetch(`http://localhost:${port}/api/runs/${applyBody.runId}/log`);
    assert.equal(logRes.status, 200);
    const log = await logRes.text();

    assert.match(log, /Selected regions on slide \(960x960 coordinate space\):/);
    assert.match(log, /Keep slide dimensions at 720pt x 720pt\./);
    assert.match(log, /slides-grab validate --slides-dir <path> --mode card-news/);
  } finally {
    await stopChild(server.child);
    await rm(workspace, { recursive: true, force: true });
  }
});
