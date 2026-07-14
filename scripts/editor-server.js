#!/usr/bin/env node

import { readdir, readFile, writeFile, mkdtemp, rm, mkdir } from 'node:fs/promises';
import { watch as fsWatch } from 'node:fs';
import net from 'node:net';
import { createRequire } from 'node:module';
import { basename, dirname, join, resolve, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { tmpdir } from 'node:os';

import {
  buildCodexEditPrompt,
  buildCodexExecArgs,
  buildClaudeExecArgs,
  normalizeSelection,
  scaleSelectionToScreenshot,
  writeAnnotatedScreenshot,
} from '../src/editor/codex-edit.js';
import {
  ALL_MODELS,
  CODEX_MODELS,
  CLAUDE_MODELS,
  DEFAULT_CODEX_MODEL,
  isClaudeModel,
} from '../src/editor/js/model-registry.js';
import {
  parseEditTimeoutMs,
  runEditSubprocess,
} from '../src/editor/edit-subprocess.js';
import { buildSlideRuntimeHtml } from '../src/image-contract.js';
import { regenerateImageNativeSlide } from '../src/image-native.js';
import { CODEX_DEFAULT_MODEL } from '../src/codex-imagen.js';

const require = createRequire(import.meta.url);
const {
  DEFAULT_SLIDE_MODE,
  getSlideModeChoices,
  getSlideModeConfig,
  normalizeSlideMode,
} = require('../src/slide-mode.cjs');

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const PACKAGE_ROOT = process.env.PPT_AGENT_PACKAGE_ROOT || resolve(__dirname, '..');

let express;
let screenshotMod;

async function loadDeps() {
  if (!express) {
    express = (await import('express')).default;
  }
  if (!screenshotMod) {
    screenshotMod = await import('../src/editor/screenshot.js');
  }
}

const DEFAULT_PORT = 3456;
const DEFAULT_SLIDES_DIR = 'slides';

const SLIDE_FILE_PATTERN = /^slide-.*\.html$/i;
const PORT_PROBE_HOSTS = ['::', '127.0.0.1'];
const PORT_PROBE_IGNORED_CODES = new Set(['EAFNOSUPPORT', 'EADDRNOTAVAIL']);

const MAX_RUNS = 200;
const MAX_LOG_CHARS = 800_000;
const EDIT_TIMEOUT_MS = parseEditTimeoutMs();
const IMAGE_REGEN_DELAY_MS = Number.parseInt(process.env.PPT_AGENT_IMAGE_REGEN_DELAY_MS || '0', 10) || 0;
const MOCK_IMAGE_PROVIDER = Boolean(process.env.PPT_AGENT_MOCK_IMAGE_PROVIDER);
const EDITOR_TYPES = ['html', 'image'];

function waitForImageRegenerationDelay(signal) {
  if (IMAGE_REGEN_DELAY_MS <= 0) return Promise.resolve();
  return new Promise((resolvePromise, rejectPromise) => {
    const timer = setTimeout(resolvePromise, IMAGE_REGEN_DELAY_MS);
    signal?.addEventListener('abort', () => {
      clearTimeout(timer);
      rejectPromise(new Error('Image regeneration was aborted.'));
    }, { once: true });
  });
}
const MOCK_PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/p9sAAAAASUVORK5CYII=',
  'base64',
);

function mockImageGenerateImpl() {
  return async () => ({ mimeType: 'image/png', bytes: MOCK_PNG });
}

function isImageNativeSlideHtml(html) {
  return /<meta\s+name=["']slides-grab-image-native["']\s+content=["']true["']/i.test(html) &&
    /<meta\s+name=["']slides-grab-image-native-metadata["']\s+content=["'][^"']+["']/i.test(html);
}

function normalizeEditorType(rawEditorType) {
  const editorType = typeof rawEditorType === 'string' ? rawEditorType.trim() : '';
  if (!EDITOR_TYPES.includes(editorType)) {
    throw new Error('`--editor` must be one of: html, image.');
  }
  return editorType;
}

function printUsage() {
  process.stdout.write(`Usage: slides-grab edit [options]\n\n`);
  process.stdout.write(`Options:\n`);
  process.stdout.write(`  --port <number>           Server port (default: ${DEFAULT_PORT})\n`);
  process.stdout.write(`  --slides-dir <path>       Slide directory (default: ${DEFAULT_SLIDES_DIR})\n`);
  process.stdout.write(`  --mode <mode>             Slide mode: ${getSlideModeChoices().join(', ')} (default: ${DEFAULT_SLIDE_MODE})\n`);
  process.stdout.write(`  --editor <type>           Editor type: html or image (default: html)\n`);
  process.stdout.write(`  Model is selected in editor UI dropdown.\n`);
  process.stdout.write(`  -h, --help                Show this help message\n`);
}

const EDITOR_PAGE_COPY = Object.freeze({
  html: Object.freeze({
    title: 'HTML Editor - slides-grab',
    brand: 'HTML Editor',
    sendLabel: 'Run HTML Edit',
    hint: 'HTML Editor: drag on the slide to add red bboxes. Cmd/Ctrl+Enter to run.',
  }),
  image: Object.freeze({
    title: 'Image Editor - slides-grab',
    brand: 'Image Editor',
    sendLabel: 'Regenerate Image',
    hint: 'Image Editor: drag on the slide to add red bboxes for regeneration.',
  }),
});

function renderEditorPage(html, editorType) {
  const type = editorType === 'image' ? 'image' : 'html';
  const copy = EDITOR_PAGE_COPY[type];
  return html
    .replaceAll('__SLIDES_GRAB_EDITOR_TYPE__', type)
    .replaceAll('__SLIDES_GRAB_EDITOR_TITLE__', copy.title)
    .replaceAll('__SLIDES_GRAB_EDITOR_BRAND__', copy.brand)
    .replaceAll('__SLIDES_GRAB_EDITOR_SEND_LABEL__', copy.sendLabel)
    .replaceAll('__SLIDES_GRAB_EDITOR_HINT__', copy.hint);
}

function parseArgs(argv) {
  const opts = {
    port: DEFAULT_PORT,
    slidesDir: DEFAULT_SLIDES_DIR,
    mode: DEFAULT_SLIDE_MODE,
    editor: 'html',
    help: false,
  };

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '-h' || arg === '--help') {
      opts.help = true;
      continue;
    }

    if (arg === '--port') {
      opts.port = Number(argv[i + 1]);
      i += 1;
      continue;
    }

    if (arg.startsWith('--port=')) {
      opts.port = Number(arg.slice('--port='.length));
      continue;
    }

    if (arg === '--slides-dir') {
      opts.slidesDir = argv[i + 1];
      i += 1;
      continue;
    }

    if (arg.startsWith('--slides-dir=')) {
      opts.slidesDir = arg.slice('--slides-dir='.length);
      continue;
    }

    if (arg === '--mode') {
      opts.mode = normalizeSlideMode(argv[i + 1]);
      i += 1;
      continue;
    }

    if (arg.startsWith('--mode=')) {
      opts.mode = normalizeSlideMode(arg.slice('--mode='.length));
      continue;
    }

    if (arg === '--editor') {
      opts.editor = normalizeEditorType(argv[i + 1]);
      i += 1;
      continue;
    }

    if (arg.startsWith('--editor=')) {
      opts.editor = normalizeEditorType(arg.slice('--editor='.length));
      continue;
    }

    if (arg === '--codex-model') {
      // Backward compatibility: ignore legacy CLI option.
      i += 1;
      continue;
    }

    throw new Error(`Unknown option: ${arg}`);
  }

  if (!Number.isInteger(opts.port) || opts.port <= 0) {
    throw new Error('`--port` must be a positive integer.');
  }

  if (typeof opts.slidesDir !== 'string' || opts.slidesDir.trim() === '') {
    throw new Error('`--slides-dir` must be a non-empty path.');
  }

  opts.slidesDir = opts.slidesDir.trim();
  opts.mode = normalizeSlideMode(opts.mode);
  opts.editor = normalizeEditorType(opts.editor);

  return opts;
}

function buildPortInUseError(port) {
  return new Error(`Editor port ${port} is already in use. Choose another port with \`--port <number>\` and try again.`);
}

async function assertHostPortAvailable(port, host) {
  const probe = net.createServer();
  try {
    await new Promise((resolve, reject) => {
      probe.once('error', reject);
      probe.listen({ port, host, exclusive: true }, resolve);
    });
  } catch (error) {
    if (error?.code === 'EADDRINUSE') {
      throw buildPortInUseError(port);
    }

    if (PORT_PROBE_IGNORED_CODES.has(error?.code)) {
      return;
    }

    throw error;
  } finally {
    if (probe.listening) {
      await new Promise((resolve, reject) => {
        probe.close((error) => {
          if (error) {
            reject(error);
            return;
          }
          resolve();
        });
      });
    }
  }
}

async function assertPortUsable(port) {
  for (const host of PORT_PROBE_HOSTS) {
    await assertHostPortAvailable(port, host);
  }
}

async function listenOnPort(app, port) {
  return new Promise((resolve, reject) => {
    const server = app.listen(port, () => resolve(server));
    server.once('error', (error) => {
      if (error?.code === 'EADDRINUSE') {
        reject(buildPortInUseError(port));
        return;
      }

      reject(error);
    });
  });
}

const sseClients = new Set();

function broadcastSSE(event, data) {
  const payload = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
  for (const res of sseClients) {
    res.write(payload);
  }
}

let browserPromise = null;

async function getScreenshotBrowser() {
  if (!browserPromise) {
    browserPromise = screenshotMod.createScreenshotBrowser();
  }
  return browserPromise;
}

async function closeBrowser() {
  if (browserPromise) {
    const { browser } = await getScreenshotBrowser();
    browserPromise = null;
    await browser.close();
  }
}

async function withScreenshotPage(callback, screenshotSize) {
  const { browser } = await getScreenshotBrowser();
  const { context, page } = await screenshotMod.createScreenshotPage(browser, screenshotSize);
  try {
    return await callback(page);
  } finally {
    await context.close().catch(() => {});
  }
}

function toPosixPath(inputPath) {
  return inputPath.split(sep).join('/');
}

function toSlidePathLabel(slidesDirectory, slideFile) {
  const relativePath = relative(process.cwd(), join(slidesDirectory, slideFile));
  const hasParentTraversal = relativePath.startsWith('..');
  const label = !hasParentTraversal && relativePath !== '' ? relativePath : join(slidesDirectory, slideFile);
  return toPosixPath(label);
}

async function listSlideFiles(slidesDirectory) {
  const entries = await readdir(slidesDirectory, { withFileTypes: true });
  return entries
    .filter((entry) => entry.isFile() && SLIDE_FILE_PATTERN.test(entry.name))
    .map((entry) => entry.name)
    .sort((a, b) => {
      const numA = Number.parseInt(a.match(/\d+/)?.[0] ?? '0', 10);
      const numB = Number.parseInt(b.match(/\d+/)?.[0] ?? '0', 10);
      return numA - numB || a.localeCompare(b);
    });
}

function normalizeSlideFilename(rawSlide, source = '`slide`') {
  const slide = typeof rawSlide === 'string' ? basename(rawSlide.trim()) : '';
  if (!slide || !SLIDE_FILE_PATTERN.test(slide)) {
    throw new Error(`Missing or invalid ${source}.`);
  }
  return slide;
}

function normalizeSlideHtml(rawHtml) {
  if (typeof rawHtml !== 'string' || rawHtml.trim() === '') {
    throw new Error('Missing or invalid `html`.');
  }
  return rawHtml;
}

function sanitizeTargets(rawTargets) {
  if (!Array.isArray(rawTargets)) return [];

  return rawTargets
    .filter((target) => target && typeof target === 'object')
    .slice(0, 30)
    .map((target) => ({
      xpath: typeof target.xpath === 'string' ? target.xpath.slice(0, 500) : '',
      tag: typeof target.tag === 'string' ? target.tag.slice(0, 40) : '',
      text: typeof target.text === 'string' ? target.text.slice(0, 400) : '',
    }))
    .filter((target) => target.xpath);
}

function normalizeSelections(rawSelections, slideSize, { allowEmpty = false } = {}) {
  if (!Array.isArray(rawSelections) || rawSelections.length === 0) {
    if (allowEmpty) return [];
    throw new Error('At least one selection is required.');
  }

  return rawSelections.slice(0, 24).map((selection) => {
    const selectionSource = selection?.bbox && typeof selection.bbox === 'object'
      ? selection.bbox
      : selection;

    const bbox = normalizeSelection(selectionSource, slideSize);
    const targets = sanitizeTargets(selection?.targets);

    return { bbox, targets };
  });
}

function normalizeModel(rawModel) {
  const model = typeof rawModel === 'string' ? rawModel.trim() : '';
  if (!model) return DEFAULT_CODEX_MODEL;
  if (!ALL_MODELS.includes(model)) {
    throw new Error(`Invalid \`model\`. Allowed models: ${ALL_MODELS.join(', ')}`);
  }
  return model;
}

function randomRunId() {
  const ts = Date.now();
  const rand = Math.floor(Math.random() * 100000);
  return `run-${ts}-${rand}`;
}

function mirrorRunLog(onLog) {
  return (stream, chunk) => {
    onLog(stream, chunk);
    process[stream].write(chunk);
  };
}

function spawnCodexEdit({ prompt, imagePath, model, cwd, onLog, onChild, signal }) {
  const codexBin = process.env.PPT_AGENT_CODEX_BIN || 'codex';
  const args = buildCodexExecArgs({ prompt, imagePath, model });
  return runEditSubprocess({
    bin: codexBin,
    args,
    cwd,
    // Close stdin (`'ignore'`) so the Codex CLI does not wait for additional
    // piped instructions. Recent Codex versions (>=0.125) print
    // "Reading additional input from stdin..." and block forever when stdin
    // is left open as a pipe even though the prompt is already passed via
    // the trailing argv. This mirrors `spawnClaudeEdit` below.
    stdio: ['ignore', 'pipe', 'pipe'],
    timeoutMs: EDIT_TIMEOUT_MS,
    engineLabel: 'Codex',
    onLog: mirrorRunLog(onLog),
    onChild,
    signal,
  });
}

function spawnClaudeEdit({ prompt, imagePath, model, cwd, onLog, onChild, signal }) {
  const claudeBin = process.env.PPT_AGENT_CLAUDE_BIN || 'claude';
  const args = buildClaudeExecArgs({ prompt, imagePath, model });

  // Remove CLAUDECODE env var to avoid "nested session" detection error
  const env = { ...process.env };
  delete env.CLAUDECODE;

  return runEditSubprocess({
    bin: claudeBin,
    args,
    cwd,
    env,
    stdio: ['ignore', 'pipe', 'pipe'],
    timeoutMs: EDIT_TIMEOUT_MS,
    engineLabel: 'Claude',
    onLog: mirrorRunLog(onLog),
    onChild,
    signal,
  });
}

function createRunStore() {
  const activeRunsBySlide = new Map();
  const runStore = new Map();
  const runOrder = [];

  function toRunSummary(run) {
    return {
      runId: run.runId,
      slide: run.slide,
      model: run.model,
      status: run.status,
      code: run.code,
      message: run.message,
      startedAt: run.startedAt,
      finishedAt: run.finishedAt,
      prompt: run.prompt,
      selectionsCount: run.selectionsCount,
      logSize: run.log.length,
      logPreview: run.log.slice(-2000),
    };
  }

  return {
    hasActiveRunForSlide(slide) {
      return activeRunsBySlide.has(slide);
    },

    getActiveRunId(slide) {
      return activeRunsBySlide.get(slide) ?? null;
    },

    startRun({ runId, slide, prompt, selectionsCount, model }) {
      activeRunsBySlide.set(slide, runId);

      const run = {
        runId,
        slide,
        status: 'running',
        code: null,
        message: 'Running',
        prompt,
        model,
        selectionsCount,
        startedAt: new Date().toISOString(),
        finishedAt: null,
        log: '',
      };

      runStore.set(runId, run);
      runOrder.push(runId);

      while (runOrder.length > MAX_RUNS) {
        const oldestRunId = runOrder.shift();
        if (!oldestRunId) continue;
        runStore.delete(oldestRunId);
      }

      return toRunSummary(run);
    },

    appendLog(runId, chunk) {
      const run = runStore.get(runId);
      if (!run) return;

      run.log += chunk;
      if (run.log.length > MAX_LOG_CHARS) {
        run.log = run.log.slice(run.log.length - MAX_LOG_CHARS);
      }
    },

    finishRun(runId, { status, code, message }) {
      const run = runStore.get(runId);
      if (!run) return null;

      run.status = status;
      run.code = code;
      run.message = message;
      run.finishedAt = new Date().toISOString();

      if (activeRunsBySlide.get(run.slide) === runId) {
        activeRunsBySlide.delete(run.slide);
      }

      return toRunSummary(run);
    },

    clearActiveRun(slide, runId) {
      if (activeRunsBySlide.get(slide) === runId) {
        activeRunsBySlide.delete(slide);
      }
    },

    listRuns(limit = 60) {
      return runOrder
        .slice(Math.max(0, runOrder.length - limit))
        .reverse()
        .map((runId) => runStore.get(runId))
        .filter(Boolean)
        .map((run) => toRunSummary(run));
    },

    getRunLog(runId) {
      const run = runStore.get(runId);
      if (!run) return null;
      return run.log;
    },

    listActiveRuns() {
      return Array.from(activeRunsBySlide.entries()).map(([slide, runId]) => ({ slide, runId }));
    },
  };
}

async function startServer(opts) {
  await assertPortUsable(opts.port);
  await loadDeps();
  const slidesDirectory = resolve(process.cwd(), opts.slidesDir);
  await mkdir(slidesDirectory, { recursive: true });

  const runStore = createRunStore();

  const childProcessesByRunId = new Map();
  const abortControllersByRunId = new Map();

  function registerAbortController(runId, abortController) {
    if (!abortController) return;
    abortControllersByRunId.set(runId, abortController);
  }

  function trackChild(runId, child) {
    if (!child || typeof child.kill !== 'function') return;
    childProcessesByRunId.set(runId, child);
    child.once('close', () => {
      if (childProcessesByRunId.get(runId) === child) {
        childProcessesByRunId.delete(runId);
      }
    });
  }

  function killTrackedChild(runId, { reason } = {}) {
    const ac = abortControllersByRunId.get(runId);
    if (ac && !ac.signal.aborted) {
      try {
        ac.abort();
      } catch {}
    }

    const child = childProcessesByRunId.get(runId);
    if (!child) return Boolean(ac);
    childProcessesByRunId.delete(runId);
    if (child.killed || child.exitCode != null) return true;
    if (reason) {
      process.stderr.write(`[editor] killing run ${runId}: ${reason}\n`);
    }
    try {
      child.kill('SIGTERM');
    } catch {}
    const forceKill = setTimeout(() => {
      if (!child.killed && child.exitCode == null) {
        try {
          child.kill('SIGKILL');
        } catch {}
      }
    }, 5_000);
    forceKill.unref?.();
    return true;
  }

  function killAllTrackedChildren({ reason, signal = 'SIGTERM' } = {}) {
    for (const ac of abortControllersByRunId.values()) {
      if (!ac.signal.aborted) {
        try {
          ac.abort();
        } catch {}
      }
    }
    abortControllersByRunId.clear();

    const ids = Array.from(childProcessesByRunId.keys());
    for (const runId of ids) {
      const child = childProcessesByRunId.get(runId);
      if (!child) continue;
      childProcessesByRunId.delete(runId);
      if (child.killed || child.exitCode != null) continue;
      if (reason) {
        process.stderr.write(`[editor] killing run ${runId}: ${reason}\n`);
      }
      try {
        child.kill(signal);
      } catch {}
    }
    return ids.length;
  }

  const app = express();
  app.use(express.json({ limit: '5mb' }));
  app.use('/js', express.static(join(PACKAGE_ROOT, 'src', 'editor', 'js')));
  app.use('/slides/assets', express.static(join(slidesDirectory, 'assets')));

  const editorHtmlPath = join(PACKAGE_ROOT, 'src', 'editor', 'editor.html');

  function broadcastRunsSnapshot() {
    broadcastSSE('runsSnapshot', {
      runs: runStore.listRuns(),
      activeRuns: runStore.listActiveRuns(),
    });
  }

  app.get('/', async (_req, res) => {
    try {
      const html = await readFile(editorHtmlPath, 'utf-8');
      res.type('html').send(renderEditorPage(html, opts.editor));
    } catch (err) {
      res.status(500).send(`Failed to load editor: ${err.message}`);
    }
  });

  app.get('/slides/:file', async (req, res) => {
    let file;
    try {
      file = normalizeSlideFilename(req.params.file, 'slide filename');
    } catch {
      return res.status(400).send('Invalid slide filename');
    }

    const filePath = join(slidesDirectory, file);
    try {
      const html = await readFile(filePath, 'utf-8');
      const runtimeHtml = buildSlideRuntimeHtml(html, {
        baseHref: '/slides/',
        slideFile: file,
      });
      res.type('html').send(runtimeHtml);
    } catch {
      res.status(404).send(`Slide not found: ${file}`);
    }
  });

  app.get('/api/slides', async (_req, res) => {
    try {
      const files = await listSlideFiles(slidesDirectory);
      res.json(files);
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  app.post('/api/slides/:file/save', async (req, res) => {
    if (opts.editor === 'image') {
      return res.status(405).json({
        error: 'Direct slide HTML save is unavailable in Image Editor.',
      });
    }

    let file;
    try {
      file = normalizeSlideFilename(req.params.file, '`slide`');
    } catch (error) {
      return res.status(400).json({ error: error.message });
    }

    const bodySlide = req.body?.slide;
    if (bodySlide !== undefined) {
      let normalizedBodySlide;
      try {
        normalizedBodySlide = normalizeSlideFilename(bodySlide, '`slide`');
      } catch (error) {
        return res.status(400).json({ error: error.message });
      }

      if (normalizedBodySlide !== file) {
        return res.status(400).json({ error: '`slide` does not match the requested file.' });
      }
    }

    let html;
    try {
      html = normalizeSlideHtml(req.body?.html);
    } catch (error) {
      return res.status(400).json({ error: error.message });
    }

    const filePath = join(slidesDirectory, file);
    try {
      await readFile(filePath, 'utf-8');
    } catch {
      return res.status(404).json({ error: `Slide not found: ${file}` });
    }

    try {
      await writeFile(filePath, html, 'utf8');
      return res.json({
        success: true,
        slide: file,
        bytes: Buffer.byteLength(html, 'utf8'),
      });
    } catch (error) {
      return res.status(500).json({
        success: false,
        error: `Failed to save ${file}: ${error.message}`,
      });
    }
  });

  app.get('/api/config', (_req, res) => {
    const cfg = getSlideModeConfig(opts.mode);
    res.json({
      editorType: opts.editor,
      slideMode: opts.mode,
      framePx: { width: cfg.framePx.width, height: cfg.framePx.height },
      screenshotPx: { width: cfg.screenshotPx.width, height: cfg.screenshotPx.height },
      sizeLabel: cfg.sizeLabel,
      aspectRatioLabel: cfg.aspectRatioLabel,
      coordinateSpaceLabel: cfg.coordinateSpaceLabel,
    });
  });

  app.get('/api/models', (_req, res) => {
    res.json({
      models: ALL_MODELS,
      defaultModel: DEFAULT_CODEX_MODEL,
    });
  });

  app.get('/api/runs', (_req, res) => {
    res.json({
      runs: runStore.listRuns(100),
      activeRuns: runStore.listActiveRuns(),
    });
  });

  app.get('/api/runs/:runId/log', (req, res) => {
    const log = runStore.getRunLog(req.params.runId);
    if (log === null) {
      return res.status(404).send('Run not found');
    }

    res.type('text/plain').send(log);
  });

  app.get('/api/events', (req, res) => {
    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      Connection: 'keep-alive',
    });
    res.write('event: connected\ndata: {}\n\n');

    sseClients.add(res);
    req.on('close', () => sseClients.delete(res));

    const snapshotPayload = {
      runs: runStore.listRuns(),
      activeRuns: runStore.listActiveRuns(),
    };
    res.write(`event: runsSnapshot\ndata: ${JSON.stringify(snapshotPayload)}\n\n`);
  });

  app.post('/api/apply', async (req, res) => {
    const { slide, prompt, selections, model, mode, provider, baseUrl } = req.body ?? {};

    if (mode !== undefined && mode !== opts.editor) {
      const command = mode === 'image' ? 'slides-grab edit-image' : 'slides-grab edit';
      return res.status(400).json({
        error: `Configured editor is ${opts.editor}; request body.mode is ${String(mode)}. Use ${command} or omit body.mode.`,
      });
    }

    if (!slide || typeof slide !== 'string' || !SLIDE_FILE_PATTERN.test(slide)) {
      return res.status(400).json({ error: 'Missing or invalid `slide`.' });
    }

    if (typeof prompt !== 'string' || prompt.trim() === '') {
      return res.status(400).json({ error: 'Missing or invalid `prompt`.' });
    }

    const applyMode = opts.editor;

    let selectedModel;
    if (applyMode === 'image') {
      selectedModel = typeof model === 'string' && model.trim() ? model.trim() : CODEX_DEFAULT_MODEL;
    } else {
      try {
        selectedModel = normalizeModel(model);
      } catch (error) {
        return res.status(400).json({ error: error.message });
      }
    }

    if (runStore.hasActiveRunForSlide(slide)) {
      return res.status(409).json({
        error: `Slide ${slide} already has an active run.`,
        runId: runStore.getActiveRunId(slide),
      });
    }

    let normalizedSelections;
    try {
      normalizedSelections = normalizeSelections(
        selections,
        getSlideModeConfig(opts.mode).framePx,
        { allowEmpty: opts.editor === 'image' },
      );
    } catch (error) {
      return res.status(400).json({ error: error.message });
    }

    if (applyMode === 'image') {
      const slideHtml = await readFile(join(slidesDirectory, slide), 'utf8').catch(() => '');
      if (!isImageNativeSlideHtml(slideHtml)) {
        return res.status(400).json({
          error: `${slide} is not an image-native slide. Generate it with slides-grab image --image-native --name slide-XX or open HTML slides with slides-grab edit.`,
        });
      }
    }

    const runId = randomRunId();

    const runSummary = runStore.startRun({
      runId,
      slide,
      prompt: prompt.trim(),
      selectionsCount: normalizedSelections.length,
      model: selectedModel,
      mode: applyMode,
    });

    broadcastSSE('applyStarted', {
      runId,
      slide,
      model: selectedModel,
      mode: applyMode,
      selectionsCount: normalizedSelections.length,
      selectionBoxes: normalizedSelections.map((selection) => selection.bbox),
    });
    broadcastRunsSnapshot();

    const tmpPath = await mkdtemp(join(tmpdir(), 'editor-codex-'));
    const screenshotPath = join(tmpPath, 'slide.png');
    const annotatedPath = join(tmpPath, 'slide-annotated.png');

    const abortController = new AbortController();
    registerAbortController(runId, abortController);
    let clientDisconnected = false;
    const handleClientClose = () => {
      if (clientDisconnected) return;
      if (res.writableEnded) return;
      clientDisconnected = true;
      killTrackedChild(runId, { reason: 'client disconnected before /api/apply finished' });
    };
    req.on('close', handleClientClose);
    res.on('close', handleClientClose);

    try {
      if (applyMode === 'image') {
        await waitForImageRegenerationDelay(abortController.signal);
        const imageResult = await regenerateImageNativeSlide({
          slidesDir: slidesDirectory,
          slideFile: slide,
          prompt,
          selections: normalizedSelections,
          signal: abortController.signal,
          provider: provider || 'codex',
          model: selectedModel,
          baseUrl: typeof baseUrl === 'string' ? baseUrl : '',
          env: process.env,
          fetchImpl: globalThis.fetch,
          ...(MOCK_IMAGE_PROVIDER ? { generateImageImpl: mockImageGenerateImpl() } : {}),
        });
        runStore.finishRun(runId, {
          status: 'success',
          code: 0,
          message: 'Image regeneration completed.',
        });
        broadcastSSE('applyFinished', {
          runId,
          slide,
          model: selectedModel,
          mode: applyMode,
          success: true,
          aborted: false,
          code: 0,
          message: 'Image regeneration completed.',
        });
        broadcastRunsSnapshot();
        if (!clientDisconnected && !res.writableEnded) {
          res.json({
            ...runSummary,
            success: true,
            aborted: false,
            runId,
            model: selectedModel,
            mode: applyMode,
            code: 0,
            message: 'Image regeneration completed.',
            image: imageResult,
          });
        }
        return;
      }
      await withScreenshotPage(async (page) => {
        await screenshotMod.captureSlideScreenshot(
          page,
          slide,
          screenshotPath,
          `http://localhost:${opts.port}/slides`,
          { useHttp: true, screenshotSize: getSlideModeConfig(opts.mode).screenshotPx },
        );
      }, getSlideModeConfig(opts.mode).screenshotPx);

      const scaledBoxes = normalizedSelections.map((selection) =>
        scaleSelectionToScreenshot(
          selection.bbox,
          getSlideModeConfig(opts.mode).framePx,
          getSlideModeConfig(opts.mode).screenshotPx,
        ),
      );

      await writeAnnotatedScreenshot(screenshotPath, annotatedPath, scaledBoxes);

      const codexPrompt = buildCodexEditPrompt({
        slideFile: slide,
        slidePath: toSlidePathLabel(slidesDirectory, slide),
        userPrompt: prompt,
        slideMode: opts.mode,
        selections: normalizedSelections,
        designBaseDir: slidesDirectory,
      });

      const usesClaude = isClaudeModel(selectedModel);
      const spawnEdit = usesClaude ? spawnClaudeEdit : spawnCodexEdit;
      const result = await spawnEdit({
        prompt: codexPrompt,
        imagePath: annotatedPath,
        model: selectedModel,
        cwd: process.cwd(),
        onLog: (stream, chunk) => {
          runStore.appendLog(runId, chunk);
          broadcastSSE('applyLog', { runId, slide, stream, chunk });
        },
        onChild: (child) => trackChild(runId, child),
        signal: abortController.signal,
      });

      const engineLabel = isClaudeModel(selectedModel) ? 'Claude' : 'Codex';
      const aborted = Boolean(result.aborted);
      const success = !aborted && result.code === 0;
      let message;
      if (aborted) {
        message = result.abortMessage || `${engineLabel} edit was aborted.`;
      } else if (success) {
        message = `${engineLabel} edit completed.`;
      } else {
        message = result.timeoutMessage || `${engineLabel} exited with code ${result.code}.`;
      }

      const status = aborted ? 'aborted' : success ? 'success' : 'failed';

      runStore.finishRun(runId, {
        status,
        code: result.code,
        message,
      });

      broadcastSSE('applyFinished', {
        runId,
        slide,
        model: selectedModel,
        success,
        aborted,
        code: result.code,
        message,
      });
      broadcastRunsSnapshot();

      if (clientDisconnected || res.writableEnded) {
        return;
      }

      res.json({
        ...runSummary,
        success,
        aborted,
        runId,
        model: selectedModel,
        code: result.code,
        message,
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      const abortedBySignal = clientDisconnected || abortController.signal.aborted;

      runStore.finishRun(runId, {
        status: abortedBySignal ? 'aborted' : 'failed',
        code: -1,
        message,
      });

      broadcastSSE('applyFinished', {
        runId,
        slide,
        model: selectedModel,
        success: false,
        aborted: abortedBySignal,
        code: -1,
        message,
      });
      broadcastRunsSnapshot();

      if (clientDisconnected || res.writableEnded) {
        return;
      }

      res.status(500).json({
        success: false,
        aborted: abortedBySignal,
        runId,
        error: message,
      });
    } finally {
      req.off?.('close', handleClientClose);
      res.off?.('close', handleClientClose);
      childProcessesByRunId.delete(runId);
      abortControllersByRunId.delete(runId);
      runStore.clearActiveRun(slide, runId);
      await rm(tmpPath, { recursive: true, force: true }).catch(() => {});
    }
  });

  app.post('/api/runs/:runId/cancel', (req, res) => {
    const { runId } = req.params;
    const killed = killTrackedChild(runId, { reason: 'cancelled via /api/runs/:runId/cancel' });
    if (!killed) {
      return res.status(404).json({ error: 'No active run for this runId.' });
    }
    res.json({ runId, cancelled: true });
  });

  let debounceTimer = null;
  const watcher = fsWatch(slidesDirectory, { persistent: false }, (_eventType, filename) => {
    if (!filename || !SLIDE_FILE_PATTERN.test(filename)) return;
    clearTimeout(debounceTimer);
    debounceTimer = setTimeout(() => {
      broadcastSSE('fileChanged', { file: filename });
    }, 300);
  });

  const server = await listenOnPort(app, opts.port);

  process.stdout.write('\n  slides-grab editor\n');
  process.stdout.write('  ─────────────────────────────────────\n');
  process.stdout.write(`  Local:       http://localhost:${opts.port}\n`);
  process.stdout.write(`  Models:      ${ALL_MODELS.join(', ')}\n`);
  process.stdout.write(`  Editor:      ${opts.editor}\n`);
  process.stdout.write(`  Slides:      ${slidesDirectory}\n`);
  process.stdout.write('  ─────────────────────────────────────\n\n');

  let shuttingDown = false;
  async function shutdown() {
    if (shuttingDown) return;
    shuttingDown = true;
    process.stdout.write('\n[editor] Shutting down...\n');

    const killedCount = killAllTrackedChildren({
      reason: 'editor server is shutting down',
      signal: 'SIGTERM',
    });
    if (killedCount > 0) {
      process.stdout.write(`[editor] Sent SIGTERM to ${killedCount} active edit subprocess(es).\n`);
      await new Promise((resolve) => {
        const t = setTimeout(resolve, 1_000);
        t.unref?.();
      });
    }

    watcher.close();
    for (const client of sseClients) {
      client.end();
    }
    sseClients.clear();
    server.close();
    await closeBrowser();
    process.exit(0);
  }

  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);

  return {
    server,
    shutdown,
    childProcessesByRunId,
    killTrackedChild,
    killAllTrackedChildren,
  };
}

const args = process.argv.slice(2);

let opts;
try {
  opts = parseArgs(args);
} catch (error) {
  process.stderr.write(`[editor] ${error.message}\n`);
  process.exit(1);
}

if (opts.help) {
  printUsage();
  process.exit(0);
}

startServer(opts).catch((err) => {
  process.stderr.write(`[editor] Fatal: ${err.message}\n`);
  process.exit(1);
});
