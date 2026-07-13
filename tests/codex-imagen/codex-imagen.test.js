import assert from 'node:assert/strict';
import test from 'node:test';

import {
  CODEX_DEFAULT_MODEL,
  CODEX_PROVIDER_AUTO,
  CODEX_PROVIDER_PRIVATE_CODEX,
  CODEX_PROVIDER_CODEX_CLI,
  generateCodexImage,
  getCodexFallbackMessage,
  injectAspectRatioHint,
  resolveCodexConfig,
} from '../../src/codex-imagen.js';

test('exports expose codex provider modes and default model', () => {
  assert.equal(CODEX_DEFAULT_MODEL, 'gpt-5.4');
  assert.equal(CODEX_PROVIDER_AUTO, 'auto');
  assert.equal(CODEX_PROVIDER_PRIVATE_CODEX, 'private-codex');
  assert.equal(CODEX_PROVIDER_CODEX_CLI, 'codex-cli');
});

test('injectAspectRatioHint appends explicit hints for known ratios', () => {
  assert.equal(
    injectAspectRatioHint('A studio portrait', '16:9'),
    'A studio portrait (wide landscape 16:9 aspect ratio)',
  );
  assert.equal(
    injectAspectRatioHint('Square icon', '1:1'),
    'Square icon (square 1:1 aspect ratio)',
  );
  assert.equal(
    injectAspectRatioHint('Tall poster', '9:16'),
    'Tall poster (tall portrait 9:16 aspect ratio)',
  );
});

test('injectAspectRatioHint passes through generic ratios using parsed format', () => {
  assert.equal(
    injectAspectRatioHint('Cinematic landscape', '21:9'),
    'Cinematic landscape (21:9 aspect ratio)',
  );
});

test('injectAspectRatioHint returns prompt unchanged when aspect ratio is missing or invalid', () => {
  assert.equal(injectAspectRatioHint('Plain prompt'), 'Plain prompt');
  assert.equal(injectAspectRatioHint('Plain prompt', ''), 'Plain prompt');
  assert.equal(injectAspectRatioHint('Plain prompt', 'banana'), 'Plain prompt');
  assert.equal(injectAspectRatioHint('Plain prompt', null), 'Plain prompt');
});

test('injectAspectRatioHint rejects empty prompts', () => {
  assert.throws(() => injectAspectRatioHint('', '16:9'), /must be a non-empty string/i);
  assert.throws(() => injectAspectRatioHint('   ', '16:9'), /must be a non-empty string/i);
});

test('resolveCodexConfig forwards provider mode through resolveConfigImpl override', () => {
  const seen = [];
  const fakeResolve = (config) => {
    seen.push(config);
    return { provider: config.provider };
  };
  const resolved = resolveCodexConfig({ providerMode: 'private-codex', resolveConfigImpl: fakeResolve });
  assert.deepEqual(seen, [{ provider: 'private-codex' }]);
  assert.deepEqual(resolved, { provider: 'private-codex' });
});

test('getCodexFallbackMessage mentions codex login and the optional API key fallbacks', () => {
  const message = getCodexFallbackMessage('Auth missing');
  assert.match(message, /codex login/);
  assert.match(message, /OPENAI_API_KEY/);
  assert.match(message, /GOOGLE_API_KEY|GEMINI_API_KEY/);
  assert.match(message, /\.\/assets\//);
});

test('generateCodexImage requires a non-empty prompt', async () => {
  await assert.rejects(
    () => generateCodexImage({ prompt: '   ' }),
    /prompt must be a non-empty string/i,
  );
  await assert.rejects(
    () => generateCodexImage({}),
    /prompt must be a non-empty string/i,
  );
});

test('generateCodexImage returns a synthetic dry-run result without calling the backend', async () => {
  const calls = [];
  const fakeProvider = {
    async generateImage(args) {
      calls.push(args);
      return { mode: 'dry-run', warnings: ['unsupported private backend'], revisedPrompt: null };
    },
  };

  const result = await generateCodexImage({
    prompt: 'flat blue square icon',
    aspectRatio: '1:1',
    dryRun: true,
    deps: {
      resolveConfig: () => ({ provider: 'auto' }),
      createProvider: () => fakeProvider,
    },
  });

  assert.equal(calls.length, 1);
  assert.equal(calls[0].prompt, 'flat blue square icon (square 1:1 aspect ratio)');
  assert.equal(calls[0].model, CODEX_DEFAULT_MODEL);
  assert.equal(calls[0].dryRun, true);
  assert.equal(result.mode, 'dry-run');
  assert.equal(result.mimeType, 'image/png');
  assert.deepEqual(Buffer.from(result.bytes), Buffer.alloc(0));
  assert.deepEqual(result.warnings, ['unsupported private backend']);
});

test('generateCodexImage reads bytes from the provider tempfile and cleans up', async () => {
  const { writeFile } = await import('node:fs/promises');
  const { stat } = await import('node:fs/promises');
  let capturedDir = null;

  const fakeProvider = {
    async generateImage({ outputPath }) {
      capturedDir = outputPath;
      await writeFile(outputPath, Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]));
      return { mode: 'live', warnings: [], revisedPrompt: 'a refined prompt' };
    },
  };

  const result = await generateCodexImage({
    prompt: 'studio portrait of a founder',
    aspectRatio: '16:9',
    deps: {
      resolveConfig: () => ({ provider: 'auto' }),
      createProvider: () => fakeProvider,
    },
  });

  assert.equal(result.mimeType, 'image/png');
  assert.equal(result.bytes.length, 8);
  assert.equal(result.bytes[0], 0x89);
  assert.equal(result.bytes[1], 0x50);
  assert.equal(result.mode, 'live');
  assert.equal(result.revisedPrompt, 'a refined prompt');

  await assert.rejects(stat(capturedDir), /ENOENT/);
});

test('generateCodexImage wraps backend errors with cause and fallback message', async () => {
  const fakeProvider = {
    async generateImage() {
      const err = new Error('Unauthorized from private Codex backend.');
      err.code = 'UNAUTHORIZED';
      throw err;
    },
  };

  await assert.rejects(
    generateCodexImage({
      prompt: 'flat blue square',
      deps: {
        resolveConfig: () => ({ provider: 'auto' }),
        createProvider: () => fakeProvider,
      },
    }),
    (error) => {
      assert.match(error.message, /codex login/);
      assert.equal(error.cause?.code, 'UNAUTHORIZED');
      assert.equal(error.isAuthError, true);
      return true;
    },
  );
});

test('generateCodexImage preserves provider warnings when the call succeeds', async () => {
  const { writeFile } = await import('node:fs/promises');
  const fakeProvider = {
    async generateImage({ outputPath }) {
      await writeFile(outputPath, Buffer.from('ok'));
      return {
        mode: 'live',
        warnings: ['Primary provider failed and auto fallback switched to codex-cli: ECONN'],
        revisedPrompt: null,
      };
    },
  };

  const result = await generateCodexImage({
    prompt: 'a calm seascape',
    deps: {
      resolveConfig: () => ({ provider: 'auto' }),
      createProvider: () => fakeProvider,
    },
  });
  assert.deepEqual(result.warnings, [
    'Primary provider failed and auto fallback switched to codex-cli: ECONN',
  ]);
});
