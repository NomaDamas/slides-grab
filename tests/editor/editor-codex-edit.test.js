import assert from 'node:assert/strict';
import { readFileSync, writeFileSync } from 'node:fs';
import test from 'node:test';

import {
  buildClaudeExecArgs,
  buildCodexEditPrompt,
  buildCodexExecArgs,
  CLAUDE_MODELS,
  getDetailedDesignSkillPrompt,
  getPptDesignSkillPrompt,
  isClaudeModel,
  normalizeSelection,
  scaleSelectionToScreenshot,
} from '../../src/editor/codex-edit.js';
import {
  buildEditTimeoutMessage,
  DEFAULT_EDIT_TIMEOUT_MS,
  parseEditTimeoutMs,
} from '../../src/editor/edit-subprocess.js';
import { DEFAULT_MODELS, state } from '../../src/editor/js/editor-state.js';

const DETAILED_DESIGN_RULES_URL = new URL(
  '../../skills/slides-grab-design/references/detailed-design-rules.md',
  import.meta.url,
);

async function importFreshCodexEditModule() {
  const moduleUrl = new URL('../../src/editor/codex-edit.js', import.meta.url);
  moduleUrl.searchParams.set('t', `${Date.now()}-${Math.random()}`);
  return import(moduleUrl.href);
}

async function importFreshEditorStateModule() {
  const moduleUrl = new URL('../../src/editor/js/editor-state.js', import.meta.url);
  moduleUrl.searchParams.set('t', `${Date.now()}-${Math.random()}`);
  return import(moduleUrl.href);
}

function withClaudePermissionEnv(env, callback) {
  const originalPermissionMode = process.env.PPT_AGENT_CLAUDE_PERMISSION_MODE;
  const originalSkip = process.env.PPT_AGENT_CLAUDE_SKIP_PERMISSIONS;

  try {
    if (env.permissionMode === undefined) {
      delete process.env.PPT_AGENT_CLAUDE_PERMISSION_MODE;
    } else {
      process.env.PPT_AGENT_CLAUDE_PERMISSION_MODE = env.permissionMode;
    }

    if (env.skipPermissions === undefined) {
      delete process.env.PPT_AGENT_CLAUDE_SKIP_PERMISSIONS;
    } else {
      process.env.PPT_AGENT_CLAUDE_SKIP_PERMISSIONS = env.skipPermissions;
    }

    return callback();
  } finally {
    if (originalPermissionMode === undefined) {
      delete process.env.PPT_AGENT_CLAUDE_PERMISSION_MODE;
    } else {
      process.env.PPT_AGENT_CLAUDE_PERMISSION_MODE = originalPermissionMode;
    }

    if (originalSkip === undefined) {
      delete process.env.PPT_AGENT_CLAUDE_SKIP_PERMISSIONS;
    } else {
      process.env.PPT_AGENT_CLAUDE_SKIP_PERMISSIONS = originalSkip;
    }
  }
}

test('normalizeSelection rounds values and clamps to slide bounds', () => {
  const selection = normalizeSelection(
    {
      x: -10.7,
      y: 15.2,
      width: 980.9,
      height: 700.6,
    },
    { width: 960, height: 540 },
  );

  assert.deepEqual(selection, {
    x: 0,
    y: 15,
    width: 960,
    height: 525,
  });
});

test('scaleSelectionToScreenshot maps slide bbox to screenshot pixels', () => {
  const scaled = scaleSelectionToScreenshot(
    { x: 96, y: 54, width: 480, height: 270 },
    { width: 960, height: 540 },
    { width: 1600, height: 900 },
  );

  assert.deepEqual(scaled, {
    x: 160,
    y: 90,
    width: 800,
    height: 450,
  });
});

test('editor state falls back to html in Node and reads the server-authored browser mode', async () => {
  assert.equal(state.editorType, 'html');

  const originalDocument = globalThis.document;
  globalThis.document = { body: { dataset: { editorType: 'image' } } };

  try {
    const browserStateModule = await importFreshEditorStateModule();
    assert.equal(browserStateModule.state.editorType, 'image');
  } finally {
    if (originalDocument === undefined) {
      delete globalThis.document;
    } else {
      globalThis.document = originalDocument;
    }
  }
});

test('buildCodexEditPrompt includes user prompt, bbox, and XPath targets', () => {
  const prompt = buildCodexEditPrompt({
    slideFile: 'slide-01.html',
    userPrompt: 'Make this title larger and move it left.',
    selections: [
      {
        bbox: { x: 100, y: 40, width: 300, height: 120 },
        targets: [
          {
            xpath: '/html/body/div[1]/h1[1]',
            tag: 'h1',
            text: 'Q1 Revenue',
          },
          {
            xpath: '/html/body/div[1]/p[2]',
            tag: 'p',
            text: 'Source: Internal',
          },
        ],
      },
    ],
  });

  assert.match(prompt, /slides\/slide-01\.html/);
  assert.match(prompt, /Make this title larger and move it left\./);
  assert.match(prompt, /x=100, y=40, width=300, height=120/);
  assert.match(prompt, /\/html\/body\/div\[1\]\/h1\[1\]/);
  assert.match(prompt, /Q1 Revenue/);
  assert.match(prompt, /Region 1/);
  assert.match(prompt, /Slide edit rules \(follow strictly\):/);
  assert.match(prompt, /primary objective/i);
  assert.match(prompt, /Keep slide size appropriate for the current mode/);
  assert.match(prompt, /Prefer Lucide as the default icon library/i);
  assert.match(prompt, /Do not default to emoji/i);
  assert.match(prompt, /slides-grab image/i);
  assert.match(prompt, /OPENAI_API_KEY/);
  assert.match(prompt, /GOOGLE_API_KEY|GEMINI_API_KEY/);
  assert.match(prompt, /Edit only the requested slide HTML file among slide-\*\.html files\./);
  assert.match(prompt, /Do not modify any other slide HTML files unless explicitly requested\./);
  assert.match(prompt, /Do not persist runtime-only editor\/viewer injections/);
  assert.match(prompt, /Do NOT/);
  assert.match(prompt, /preview-styles/);
});

test('buildCodexEditPrompt uses dedicated editor prompt without full workflow', () => {
  const prompt = buildCodexEditPrompt({
    slideFile: 'slide-02.html',
    userPrompt: 'Refine the hero composition.',
    selections: [{ bbox: { x: 24, y: 32, width: 540, height: 220 }, targets: [] }],
  });

  assert.match(prompt, /Slide edit rules \(follow strictly\):/);
  assert.match(prompt, /cardless layouts/i);
  assert.doesNotMatch(prompt, /Project skill guidance \(follow strictly\):/);
  assert.doesNotMatch(prompt, /Detailed design\/export guardrails/);
  assert.doesNotMatch(prompt, /Slide art direction defaults \(packaged guidance/);
});

test('buildCodexEditPrompt uses explicit slide path when provided', () => {
  const prompt = buildCodexEditPrompt({
    slideFile: 'slide-01.html',
    slidePath: 'presentations/demo-a/slide-01.html',
    userPrompt: 'Increase title size.',
    selections: [{ bbox: { x: 10, y: 12, width: 220, height: 80 }, targets: [] }],
  });

  assert.match(prompt, /Edit presentations\/demo-a\/slide-01\.html only\./);
});

test('buildCodexExecArgs attaches image and prompt to codex exec', () => {
  const args = buildCodexExecArgs({
    prompt: 'Edit slide',
    imagePath: '/tmp/slide-annotated.png',
    model: 'gpt-5.3',
  });

  assert.deepEqual(args, [
    '--dangerously-bypass-approvals-and-sandbox',
    'exec',
    '--color',
    'never',
    '--model',
    'gpt-5.3',
    '--image',
    '/tmp/slide-annotated.png',
    '--',
    'Edit slide',
  ]);
});

test('getPptDesignSkillPrompt loads bundled ppt design skill guidance', () => {
  const skillPrompt = getPptDesignSkillPrompt();

  assert.match(skillPrompt, /# slides-grab Design Skill/);
  assert.match(skillPrompt, /Keep slide size 720pt x 405pt\./);
  assert.match(skillPrompt, /reference them as `\.\/assets\/<file>`\./);
  assert.match(skillPrompt, /local videos/i);
  assert.match(skillPrompt, /fetch-video|yt-dlp/i);
  assert.match(skillPrompt, /slides-grab image/i);
  assert.match(skillPrompt, /codex-imagen/i);
  assert.match(skillPrompt, /codex login/i);
  assert.match(skillPrompt, /Nano Banana/i);
});

test('getDetailedDesignSkillPrompt falls back when packaged icon guidance section is missing', async () => {
  const originalMarkdown = readFileSync(DETAILED_DESIGN_RULES_URL, 'utf8');
  const missingIconSection = originalMarkdown.replace(
    /\n## Icon Usage Rules[\s\S]*?(?=\n## Workflow \(Stage 2: Design \+ Human Review\))/,
    '\n',
  );

  assert.notEqual(missingIconSection, originalMarkdown);

  writeFileSync(DETAILED_DESIGN_RULES_URL, missingIconSection);

  try {
    const { getDetailedDesignSkillPrompt: getFreshDetailedDesignSkillPrompt } = await importFreshCodexEditModule();
    const detailedPrompt = getFreshDetailedDesignSkillPrompt();

    assert.match(detailedPrompt, /## Icon Usage Rules/);
    assert.match(detailedPrompt, /Prefer Lucide as the default icon library/i);
    assert.match(detailedPrompt, /Do not default to emoji/i);
    assert.match(detailedPrompt, /slides-grab validate --slides-dir <path>/i);
    assert.match(detailedPrompt, /slides-grab build-viewer --slides-dir <path>/i);
    assert.ok(
      detailedPrompt.indexOf('slides-grab validate --slides-dir <path>')
      < detailedPrompt.indexOf('slides-grab build-viewer --slides-dir <path>'),
    );
  } finally {
    writeFileSync(DETAILED_DESIGN_RULES_URL, originalMarkdown);
  }
});

test('getDetailedDesignSkillPrompt loads only relevant detailed design sections', () => {
  const detailedPrompt = getDetailedDesignSkillPrompt();

  assert.match(detailedPrompt, /## Base Settings/);
  assert.match(detailedPrompt, /### 4\. Image Usage Rules/);
  assert.match(detailedPrompt, /## Text Usage Rules/);
  assert.match(detailedPrompt, /## Icon Usage Rules/);
  assert.match(detailedPrompt, /Prefer Lucide as the default icon library/i);
  assert.match(detailedPrompt, /Do not default to emoji/i);
  assert.match(detailedPrompt, /## Workflow \(Stage 2: Design \+ Human Review\)/);
  assert.match(detailedPrompt, /## Important Notes/);
  assert.match(detailedPrompt, /## Beautiful Defaults for Slides/);
  assert.match(detailedPrompt, /visual thesis/i);
  assert.match(detailedPrompt, /content plan/i);
  assert.match(detailedPrompt, /Treat the opening slide like a poster/i);
  assert.match(detailedPrompt, /Would this still feel premium without shadows, cards, or extra chrome\?/i);
  assert.match(detailedPrompt, /local videos/i);
  assert.match(detailedPrompt, /fetch-video|yt-dlp/i);
  assert.match(detailedPrompt, /codex-imagen/i);
  assert.match(detailedPrompt, /codex login/i);
  assert.match(detailedPrompt, /Nano Banana/i);
  assert.doesNotMatch(detailedPrompt, /## Core Design Philosophy/);
  assert.doesNotMatch(detailedPrompt, /### 1\. Chart\.js/);
});

test('parseEditTimeoutMs falls back to the 10-minute default for invalid values', () => {
  assert.equal(DEFAULT_EDIT_TIMEOUT_MS, 600000);
  assert.equal(parseEditTimeoutMs(undefined), DEFAULT_EDIT_TIMEOUT_MS);
  assert.equal(parseEditTimeoutMs(''), DEFAULT_EDIT_TIMEOUT_MS);
  assert.equal(parseEditTimeoutMs('0'), DEFAULT_EDIT_TIMEOUT_MS);
  assert.equal(parseEditTimeoutMs('-10'), DEFAULT_EDIT_TIMEOUT_MS);
  assert.equal(parseEditTimeoutMs('abc'), DEFAULT_EDIT_TIMEOUT_MS);
});

test('buildEditTimeoutMessage describes terminated editor runs', () => {
  assert.equal(
    buildEditTimeoutMessage({ engineLabel: 'Codex', timeoutMs: 200 }),
    'Codex edit timed out after 200ms and was terminated.',
  );
});


test('buildCodexEditPrompt switches sizing guidance for card-news mode', () => {
  const prompt = buildCodexEditPrompt({
    slideFile: 'slide-03.html',
    userPrompt: 'Tighten this card-news cover.',
    slideMode: 'card-news',
    selections: [{ bbox: { x: 40, y: 48, width: 320, height: 320 }, targets: [] }],
  });

  assert.match(prompt, /Selected regions on slide \(960x960 coordinate space\):/);
  assert.match(prompt, /Keep slide dimensions at 720pt x 720pt\./);
});

test('CLAUDE_MODELS exposes claude-opus-4-8 as the bbox-editor Opus option (issue #88)', () => {
  assert.ok(
    CLAUDE_MODELS.includes('claude-opus-4-8'),
    `CLAUDE_MODELS should include 'claude-opus-4-8' so the editor dropdown can route edits to Opus 4.8. Got: ${JSON.stringify(CLAUDE_MODELS)}`,
  );
});

test('CLAUDE_MODELS drops the superseded claude-opus-4-7 identifier (issue #88)', () => {
  assert.ok(
    !CLAUDE_MODELS.includes('claude-opus-4-7'),
    `CLAUDE_MODELS should no longer include 'claude-opus-4-7' after the Opus 4.8 upgrade. Got: ${JSON.stringify(CLAUDE_MODELS)}`,
  );
});

test('CLAUDE_MODELS still exposes claude-sonnet-4-6 (there is no Sonnet 4.7 yet)', () => {
  assert.ok(
    CLAUDE_MODELS.includes('claude-sonnet-4-6'),
    `CLAUDE_MODELS should still include 'claude-sonnet-4-6' because Sonnet 4.7 does not exist. Got: ${JSON.stringify(CLAUDE_MODELS)}`,
  );
});

test('isClaudeModel recognizes claude-opus-4-8 after the upgrade', () => {
  assert.equal(isClaudeModel('claude-opus-4-8'), true);
  assert.equal(isClaudeModel('  claude-opus-4-8  '), true);
});

test('isClaudeModel rejects the dropped claude-opus-4-7 identifier', () => {
  assert.equal(isClaudeModel('claude-opus-4-7'), false);
});

test('buildClaudeExecArgs forwards claude-opus-4-8 to the claude CLI --model flag', () => {
  const args = withClaudePermissionEnv({}, () => buildClaudeExecArgs({
    prompt: 'Edit slide',
    imagePath: '/tmp/slide-annotated.png',
    model: 'claude-opus-4-8',
  }));

  assert.deepEqual(args, [
    '-p',
    '--permission-mode',
    'acceptEdits',
    '--model',
    'claude-opus-4-8',
    '--max-turns',
    '30',
    '--verbose',
    'First, read the annotated screenshot at "/tmp/slide-annotated.png" to see the visual context of the bbox regions highlighted on the slide.\n\nEdit slide',
  ]);
});

test('buildClaudeExecArgs keeps dangerous skip permissions as an explicit opt-in for legacy sandboxes', () => {
  const args = withClaudePermissionEnv({ skipPermissions: '1' }, () => buildClaudeExecArgs({
    prompt: 'Edit slide',
    imagePath: '',
    model: 'claude-opus-4-8',
  }));

  assert.deepEqual(args, [
    '-p',
    '--dangerously-skip-permissions',
    '--model',
    'claude-opus-4-8',
    '--max-turns',
    '30',
    '--verbose',
    'Edit slide',
  ]);
});

test('buildClaudeExecArgs uses configurable Claude permission mode for OAuth-friendly sessions (issue #88)', () => {
  const args = withClaudePermissionEnv({ permissionMode: 'acceptEdits' }, () => buildClaudeExecArgs({
    prompt: 'Edit slide',
    imagePath: '',
    model: 'claude-opus-4-8',
  }));

  assert.deepEqual(args, [
    '-p',
    '--permission-mode',
    'acceptEdits',
    '--model',
    'claude-opus-4-8',
    '--max-turns',
    '30',
    '--verbose',
    'Edit slide',
  ]);
});

test('DEFAULT_MODELS exposes claude-opus-4-8 as the Claude Opus fallback (issue #88)', () => {
  assert.ok(
    DEFAULT_MODELS.includes('claude-opus-4-8'),
    `DEFAULT_MODELS should include 'claude-opus-4-8' so the editor UI dropdown falls back to Opus 4.8 when /api/models is unreachable. Got: ${JSON.stringify(DEFAULT_MODELS)}`,
  );
});

test('DEFAULT_MODELS drops the superseded claude-opus-4-7 identifier (issue #88)', () => {
  assert.ok(
    !DEFAULT_MODELS.includes('claude-opus-4-7'),
    `DEFAULT_MODELS should no longer include 'claude-opus-4-7' after the Opus 4.8 upgrade. Got: ${JSON.stringify(DEFAULT_MODELS)}`,
  );
});

test('static editor fallback select exposes claude-opus-4-8 and not superseded claude-opus-4-7 (issue #88)', () => {
  const html = readFileSync(new URL('../../src/editor/editor.html', import.meta.url), 'utf8');

  assert.match(html, /<option value="claude-opus-4-8">claude-opus-4-8<\/option>/);
  assert.doesNotMatch(html, /<option value="claude-opus-4-7">claude-opus-4-7<\/option>/);
});

test('DEFAULT_MODELS still exposes claude-sonnet-4-6 (there is no Sonnet 4.7 yet)', () => {
  assert.ok(
    DEFAULT_MODELS.includes('claude-sonnet-4-6'),
    `DEFAULT_MODELS should still include 'claude-sonnet-4-6' because Sonnet 4.7 does not exist. Got: ${JSON.stringify(DEFAULT_MODELS)}`,
  );
});

test('spawnCodexEdit closes stdin so Codex CLI does not block on "Reading additional input from stdin..."', async () => {
  const { readFile } = await import('node:fs/promises');
  const { join, dirname } = await import('node:path');
  const { fileURLToPath } = await import('node:url');

  const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
  const editorServerSource = await readFile(
    join(repoRoot, 'scripts', 'editor-server.js'),
    'utf8',
  );

  const spawnCodexEditMatch = editorServerSource.match(/function spawnCodexEdit\b[\s\S]*?\n\}\n/);
  assert.ok(
    spawnCodexEditMatch,
    'Could not locate function spawnCodexEdit in scripts/editor-server.js',
  );

  const codexBlock = spawnCodexEditMatch[0];

  assert.ok(
    /stdio:\s*\[\s*['"]ignore['"]\s*,\s*['"]pipe['"]\s*,\s*['"]pipe['"]\s*\]/.test(codexBlock),
    `spawnCodexEdit must use stdio: ['ignore', 'pipe', 'pipe'] so the Codex CLI does not wait on stdin. ` +
      `Codex CLI >=0.125 prints "Reading additional input from stdin..." and hangs forever when stdin ` +
      `is left open as a pipe, even though the prompt is already passed via the trailing argv. ` +
      `Got block:\n${codexBlock}`,
  );

  assert.ok(
    !/stdio:\s*['"]pipe['"]/.test(codexBlock),
    `spawnCodexEdit must NOT use stdio: 'pipe' (which opens stdin as a pipe). That regression caused ` +
      `the editor to hang silently on every gpt-5.x run because Codex >=0.125 waits on stdin. ` +
      `Got block:\n${codexBlock}`,
  );
});
