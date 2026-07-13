#!/usr/bin/env node

import { spawn } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Command, Option } from 'commander';
import {
  getFigmaImportCaveats,
  getFigmaManualImportInstructions,
} from '../src/figma.js';
import { assertDesignGateReady } from '../src/design-gate-state.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const packageRoot = resolve(__dirname, '..');
const packageJson = JSON.parse(readFileSync(resolve(packageRoot, 'package.json'), 'utf-8'));
const figmaHelpText = [
  '',
  'Creates an experimental / unstable PowerPoint file tuned for Figma Slides manual import.',
  'Treat both PPTX and Figma export as best-effort only.',
  '',
  'Manual import:',
  `  ${getFigmaManualImportInstructions()}`,
  '',
  'Figma import caveats:',
  ...getFigmaImportCaveats().map((caveat) => `  - ${caveat}`),
].join('\n');

/**
 * Run a Node.js script from the package, with CWD set to the user's directory.
 * Scripts resolve slide paths via --slides-dir and templates via src/resolve.js.
 */
function runNodeScript(relativePath, args = []) {
  return new Promise((resolvePromise, rejectPromise) => {
    const scriptPath = resolve(packageRoot, relativePath);
    const child = spawn(process.execPath, [scriptPath, ...args], {
      cwd: process.cwd(),
      stdio: 'inherit',
      env: {
        ...process.env,
        PPT_AGENT_PACKAGE_ROOT: packageRoot,
      }
    });

    child.on('error', rejectPromise);
    child.on('close', (code, signal) => {
      if (signal) {
        rejectPromise(new Error(`Command terminated by signal ${signal}`));
        return;
      }
      resolvePromise(code ?? 0);
    });
  });
}

async function runCommand(relativePath, args = []) {
  try {
    const code = await runNodeScript(relativePath, args);
    if (code !== 0) {
      process.exitCode = code;
    }
  } catch (error) {
    console.error(`[slides-grab] ${error.message}`);
    process.exitCode = 1;
  }
}

async function ensureDesignGateForExport(slidesDir, label) {
  try {
    await assertDesignGateReady(resolve(process.cwd(), slidesDir), { label });
  } catch (error) {
    console.error(`[slides-grab] ${error.message}`);
    process.exitCode = 1;
    return false;
  }
  return true;
}

function collectRepeatedOption(value, previous = []) {
  return [...previous, value];
}

function reportCliError(error) {
  console.error(`[slides-grab] ${error.message}`);
  process.exitCode = 1;
}


const program = new Command();

program
  .name('slides-grab')
  .description('Agent-first PPT framework CLI')
  .version(packageJson.version);

// --- Core workflow commands ---

program
  .command('build-viewer')
  .description('Build viewer.html from slide HTML files')
  .option('--slides-dir <path>', 'Slide directory', 'slides')
  .option('--mode <mode>', 'Slide mode: presentation or card-news', 'presentation')
  .action(async (options = {}) => {
    const args = ['--slides-dir', options.slidesDir, '--mode', options.mode];
    await runCommand('scripts/build-viewer.js', args);
  });

program
  .command('validate')
  .alias('lint')
  .description('Run structured validation on slide HTML files (Playwright-based)')
  .option('--slides-dir <path>', 'Slide directory', 'slides')
  .option('--format <format>', 'Output format: concise, json, json-full', 'concise')
  .option('--mode <mode>', 'Slide mode: presentation or card-news', 'presentation')
  .option('--slide <file>', 'Validate only the named slide file (repeatable)', collectRepeatedOption, [])
  .action(async (options = {}) => {
    const args = ['--slides-dir', options.slidesDir, '--format', options.format, '--mode', options.mode];
    for (const slide of options.slide || []) {
      args.push('--slide', String(slide));
    }
    await runCommand('scripts/validate-slides.js', args);
  });

program
  .command('design-gate')
  .description('Record the required visual QA gate evidence before export')
  .option('--slides-dir <path>', 'Slide directory', 'slides')
  .option('--slide-mode <mode>', 'Slide mode: presentation or card-news', 'presentation')
  .option('--resolution <preset>', 'PNG evidence resolution preset: 720p, 1080p, 1440p, 2160p, or 4k', '2160p')
  .requiredOption('--verdict <verdict>', 'Gate verdict: proceed, revise, or rethink')
  .requiredOption('--pass-a-report <path>', 'Pass A review report file')
  .requiredOption('--pass-b-report <path>', 'Pass B review report file')
  .option('--output-dir <path>', 'PNG evidence directory (default: <slides-dir>/.slides-grab/gate-preview)')
  .action(async (options = {}) => {
    const args = [
      '--slides-dir',
      options.slidesDir,
      '--slide-mode',
      options.slideMode,
      '--resolution',
      options.resolution,
      '--verdict',
      options.verdict,
      '--pass-a-report',
      options.passAReport,
      '--pass-b-report',
      options.passBReport,
    ];
    if (options.outputDir) {
      args.push('--output-dir', String(options.outputDir));
    }
    await runCommand('scripts/design-gate.js', args);
  });

function registerInstallSkillsCommand(commandName) {
  program
    .command(commandName)
    .description('Install slides-grab skills and lightweight runtime adapters for Codex and Claude Code')
    .option('--target <target>', 'Runtime target: all, codex, or claude-code', 'all')
    .option('--runtime <target>', 'Alias for --target')
    .option('--scope <scope>', 'Install scope: project or user', 'project')
    .option('--project-dir <path>', 'Project directory for project scope')
    .option('--target-root <path>', 'Root directory for user-style installs')
    .option('--dry-run', 'Print planned writes without copying')
    .option('--json', 'Print JSON result')
    .action(async (options = {}) => {
      const args = [
        '--target',
        String(options.runtime || options.target),
        '--scope',
        String(options.scope),
      ];
      if (options.projectDir) args.push('--project-dir', String(options.projectDir));
      if (options.targetRoot) args.push('--target-root', String(options.targetRoot));
      if (options.dryRun) args.push('--dry-run');
      if (options.json) args.push('--json');
      await runCommand('scripts/install-runtime.js', args);
    });
}

registerInstallSkillsCommand('install-skills');
registerInstallSkillsCommand('install-runtime');

program
  .command('convert')
  .description('Convert slide HTML files to experimental / unstable PPTX')
  .option('--slides-dir <path>', 'Slide directory', 'slides')
  .option('--output <path>', 'Output PPTX file')
  .option('--mode <mode>', 'Slide mode: presentation or card-news', 'presentation')
  .option('--resolution <preset>', 'Raster size preset: 720p, 1080p, 1440p, 2160p, or 4k (default: 2160p, raster engine only)')
  .addOption(
    new Option('--engine <engine>', 'Export engine: raster (default, highest visual fidelity) or text (editable text with best-effort DOM extraction)')
      .choices(['raster', 'text'])
      .default('raster'),
  )
  .action(async (options = {}) => {
    if (options.engine === 'text' && options.resolution) {
      reportCliError(new Error('--resolution can only be used with --engine raster.'));
      return;
    }
    if (!(await ensureDesignGateForExport(options.slidesDir, 'PPTX export'))) return;
    const args = ['--slides-dir', options.slidesDir, '--mode', options.mode];
    if (options.output) {
      args.push('--output', String(options.output));
    }
    if (options.engine === 'text') {
      await runCommand('scripts/html2pptx.js', args);
      return;
    }
    if (options.resolution) {
      args.push('--resolution', String(options.resolution));
    }
    await runCommand('convert.cjs', args);
  });

program
  .command('pdf')
  .description('Convert slide HTML files to PDF')
  .option('--slides-dir <path>', 'Slide directory', 'slides')
  .option('--output <path>', 'Output PDF file')
  .option('--mode <mode>', 'PDF export mode: capture for visual fidelity, print for searchable text', 'capture')
  .option('--slide-mode <mode>', 'Slide mode: presentation or card-news', 'presentation')
  .option('--resolution <preset>', 'Capture raster size preset: 720p, 1080p, 1440p, 2160p, or 4k (default: 2160p in capture mode)')
  .action(async (options = {}) => {
    if (!(await ensureDesignGateForExport(options.slidesDir, 'PDF export'))) return;
    const args = ['--slides-dir', options.slidesDir];
    if (options.output) {
      args.push('--output', String(options.output));
    }
    if (options.mode) {
      args.push('--mode', String(options.mode));
    }
    if (options.slideMode) {
      args.push('--slide-mode', String(options.slideMode));
    }
    if (options.resolution) {
      args.push('--resolution', String(options.resolution));
    }
    await runCommand('scripts/html2pdf.js', args);
  });

program
  .command('png')
  .description('Render slide HTML files to one PNG per slide')
  .option('--slides-dir <path>', 'Slide directory', 'slides')
  .option('--output-dir <path>', 'Output directory for PNG files (default: <slides-dir>/out-png)')
  .option('--slide-mode <mode>', 'Slide mode: presentation or card-news', 'presentation')
  .option('--resolution <preset>', 'Raster size preset: 720p, 1080p, 1440p, 2160p, or 4k', '2160p')
  .action(async (options = {}) => {
    const args = ['--slides-dir', options.slidesDir];
    if (options.outputDir) {
      args.push('--output-dir', String(options.outputDir));
    }
    if (options.slideMode) {
      args.push('--slide-mode', String(options.slideMode));
    }
    if (options.resolution) {
      args.push('--resolution', String(options.resolution));
    }
    await runCommand('scripts/html2png.js', args);
  });

program
  .command('fetch-video')
  .description('Download a video into <slides-dir>/assets via yt-dlp and print the ./assets reference')
  .requiredOption('--url <url>', 'Video page URL to download with yt-dlp')
  .option('--slides-dir <path>', 'Slide directory', 'slides')
  .option('--output-name <name>', 'Optional output stem inside <slides-dir>/assets/')
  .action(async (options = {}) => {
    const args = ['--url', String(options.url), '--slides-dir', options.slidesDir];
    if (options.outputName) {
      args.push('--output-name', String(options.outputName));
    }
    await runCommand('scripts/download-video.js', args);
  });

program
  .command('figma')
  .description('Export an experimental / unstable Figma Slides importable PPTX')
  .helpOption('-h, --help', 'Show this help message')
  .option('--slides-dir <path>', 'Slide directory', 'slides')
  .option('--output <path>', 'Output PPTX file (default: <slides-dir>-figma.pptx)')
  .option('--mode <mode>', 'Slide mode: presentation or card-news', 'presentation')
  .addHelpText('after', figmaHelpText)
  .action(async (options = {}) => {
    if (!(await ensureDesignGateForExport(options.slidesDir, 'Figma export'))) return;
    const args = ['--slides-dir', options.slidesDir, '--mode', options.mode];
    if (options.output) {
      args.push('--output', String(options.output));
    }
    await runCommand('scripts/figma-export.js', args);
  });

program
  .command('tldraw')
  .description('Render a current-format .tldr or store-snapshot JSON file to an exact-size SVG asset for slides')
  .option('--input <path>', 'Input current-format .tldr or snapshot JSON file')
  .option('--output <path>', 'Output SVG asset path')
  .option('--width <number>', 'Exact output width in CSS pixels')
  .option('--height <number>', 'Exact output height in CSS pixels')
  .option('--padding <number>', 'Inner fit padding in CSS pixels')
  .option('--background <css>', 'Optional wrapper background fill')
  .option('--page-id <id>', 'Optional tldraw page id to export')
  .action(async (options = {}) => {
    const args = [];
    if (options.input) args.push('--input', String(options.input));
    if (options.output) args.push('--output', String(options.output));
    if (options.width) args.push('--width', String(options.width));
    if (options.height) args.push('--height', String(options.height));
    if (options.padding) args.push('--padding', String(options.padding));
    if (options.background) args.push('--background', String(options.background));
    if (options.pageId) args.push('--page-id', String(options.pageId));
    await runCommand('scripts/render-tldraw.js', args);
  });

program
  .command('image')
  .description('Generate a local slide image asset (default: god-tibo-imagen via your Codex ChatGPT login — no OpenAI/Google API key required)')
  .option('--prompt <text>', 'Prompt for image generation')
  .option('--slides-dir <path>', 'Slide directory', 'slides')
  .option('--output <path>', 'Optional output path inside <slides-dir>/assets/')
  .option('--name <slug>', 'Optional asset basename without extension')
  .option('--provider <name>', 'Image provider: god-tibo (default), codex (OpenAI), or nano-banana. Aliases: codex-cli → god-tibo, openai → codex, gemini → nano-banana')
  .option('--model <id>', 'Model id (default: gpt-5.4 for god-tibo, gpt-image-2 for codex, gemini-3-pro-image-preview for nano-banana)')
  .option('--aspect-ratio <ratio>', 'Aspect ratio; for god-tibo it is injected as a prompt hint, for codex it maps to the nearest supported OpenAI size (default: 16:9)')
  .option('--image-size <size>', 'Nano Banana image size preset: 2K or 4K (default: 4K)')
  .option('--base-url <url>', 'Codex/OpenAI-compatible base URL (default: OPENAI_IMAGE_BASE_URL, OPENAI_BASE_URL, then OpenAI)')
  .option('--api-key-env <name>', 'Env var to read for Codex/OpenAI-compatible provider API key')
  .option('--reference <path>', 'Reference image path(s) for style-guided generation (god-tibo only, repeatable)', collectRepeatedOption, [])
  .addHelpText('after', [
    '',
    'Auth:',
    '  Default (god-tibo): run `codex login` once to populate ~/.codex/auth.json. No OpenAI/Google API key required;',
    '                      requires a Codex/ChatGPT account entitled to image generation.',
    '  Codex/OpenAI provider: set OPENAI_API_KEY. Compatible endpoints may use --base-url, OPENAI_IMAGE_BASE_URL, OPENAI_BASE_URL, and --api-key-env.',
    '  Nano Banana provider: set GOOGLE_API_KEY or GEMINI_API_KEY.',
    '',
    'WARNING: god-tibo-imagen calls an unsupported private Codex backend that may break without notice.',
  ].join('\n'))
  .action(async (options = {}) => {
    const args = ['--slides-dir', options.slidesDir];
    if (options.prompt) args.push('--prompt', String(options.prompt));
    if (options.output) args.push('--output', String(options.output));
    if (options.name) args.push('--name', String(options.name));
    if (options.provider) args.push('--provider', String(options.provider));
    if (options.model) args.push('--model', String(options.model));
    if (options.aspectRatio) args.push('--aspect-ratio', String(options.aspectRatio));
    if (options.imageSize) args.push('--image-size', String(options.imageSize));
    if (options.baseUrl) args.push('--base-url', String(options.baseUrl));
    if (options.apiKeyEnv) args.push('--api-key-env', String(options.apiKeyEnv));
    for (const ref of options.reference || []) {
      args.push('--reference', String(ref));
    }
    await runCommand('scripts/generate-image.js', args);
  });

program
  .command('edit')
  .description('Start interactive slide editor with Codex image-based edit flow')
  .option('--port <number>', 'Server port')
  .option('--slides-dir <path>', 'Slide directory', 'slides')
  .option('--mode <mode>', 'Slide mode: presentation or card-news', 'presentation')
  .action(async (options = {}) => {
    const args = ['--slides-dir', options.slidesDir, '--mode', options.mode];
    if (options.port) {
      args.push('--port', String(options.port));
    }
    await runCommand('scripts/editor-server.js', args);
  });

// --- Template/style discovery commands ---

program
  .command('list-templates')
  .description('List all available slide templates (local overrides + package built-ins)')
  .action(async () => {
    const { listTemplates } = await import('../src/resolve.js');
    const templates = listTemplates();
    if (templates.length === 0) {
      console.log('No templates found.');
      return;
    }
    console.log('Available templates:\n');
    for (const t of templates) {
      const tag = t.source === 'local' ? '(local)' : '(built-in)';
      console.log(`  ${t.name.padEnd(20)} ${tag}`);
    }
    console.log(`\nTotal: ${templates.length} templates`);
  });

program
  .command('list-styles')
  .description('List bundled design styles agents and users can reference during slide generation')
  .option('--all', 'Include source-alias styles that resolve to a builtin (hidden by default)')
  .action(async (options = {}) => {
    try {
      const { listDesignStyles, listSelectableDesignStyles } = await import('../src/design-styles.js');
      const showAll = Boolean(options.all);
      const styles = showAll ? listDesignStyles() : listSelectableDesignStyles();

      if (styles.length === 0) {
        console.log('No bundled design styles found.');
        return;
      }

      console.log('Available design styles:\n');
      for (const style of styles) {
        let tag;
        if (style.classification === 'builtin') {
          tag = '[builtin]';
        } else if (style.classification === 'source-variant') {
          tag = '[variant]';
        } else if (style.classification === 'source-alias') {
          tag = `[alias -> ${style.aliasOf}]`;
        } else {
          tag = '[new]';
        }
        console.log(`  ${style.id.padEnd(38)} ${tag} ${style.title}`);
        console.log(`    ${style.mood} · ${style.bestFor}`);
        if (style.classification === 'source-variant' && Array.isArray(style.relatedStyleIds) && style.relatedStyleIds.length) {
          console.log(`    related: ${style.relatedStyleIds.join(', ')}`);
        }
      }

      const totalResolvable = listDesignStyles().length;
      if (!showAll) {
        const hiddenCount = totalResolvable - styles.length;
        console.log(`\nTotal: ${styles.length} selectable styles`);
        console.log(`${hiddenCount} source-alias slug(s) hidden (resolve to a builtin); use --all to show all ${totalResolvable} resolvable styles`);
      } else {
        const selectableCount = listSelectableDesignStyles().length;
        const aliasCount = totalResolvable - selectableCount;
        console.log(`\nTotal: ${styles.length} resolvable styles (${selectableCount} selectable, ${aliasCount} aliases)`);
      }
      console.log('Preview: slides-grab preview-styles [--style <id>]');
    } catch (error) {
      reportCliError(error);
    }
  });

program
  .command('preview-styles')
  .description('Print the path to the bundled 95-style visual preview gallery')
  .action(async () => {
    try {
      const { getPreviewHtmlPath } = await import('../src/design-styles.js');
      const previewPath = getPreviewHtmlPath();
      console.log(previewPath);
    } catch (error) {
      reportCliError(error);
    }
  });

program
  .command('import-template')
  .description('Import one or more template/reference source files (.pptx, .pdf, .html/.htm, image) into a local template pack under <slides-dir>/.slides-grab/. Local analysis only — no network, no LLM. PPTX/PDF are accepted as metadata/visual-reference dispatch with warnings; full rendering is not performed locally.')
  .option('--input <path>', 'Template source file (repeatable)', collectRepeatedOption, [])
  .option('--slides-dir <path>', 'Slide directory', 'slides')
  .option('--name <name>', 'Optional template pack display name')
  .action(async (options = {}) => {
    const args = ['--slides-dir', options.slidesDir];
    for (const input of options.input || []) {
      args.push('--input', String(input));
    }
    if (options.name) {
      args.push('--name', String(options.name));
    }
    await runCommand('scripts/import-template.js', args);
  });

program
  .command('import-design')
  .description('Fetch a remote DESIGN.md (https only) and save it locally as a custom slide design source')
  .argument('<url>', 'HTTPS URL to a DESIGN.md / markdown design system file')
  .option('--output <path>', 'Output path for the saved file', 'DESIGN.md')
  .option('--max-bytes <number>', 'Maximum allowed response size in bytes', '262144')
  .option('--timeout-ms <number>', 'Fetch timeout in milliseconds', '15000')
  .action(async (url, options = {}) => {
    try {
      const { fetchDesignMarkdown, formatImportedDesignMarkdown, saveImportedDesign } =
        await import('../src/design-import.js');
      const maxBytes = Number(options.maxBytes) || 262144;
      const timeoutMs = Number(options.timeoutMs) || 15000;
      const result = await fetchDesignMarkdown(url, { maxBytes, timeoutMs });
      const markdown = formatImportedDesignMarkdown({
        url: result.url,
        content: result.text,
        fetchedAt: result.fetchedAt,
      });
      const savedPath = saveImportedDesign({ outputPath: options.output, markdown });
      console.log(`Saved ${result.bytes} bytes to ${savedPath}`);
      console.log(
        'Saved web-flavored design source. Next convert it to DESIGN.slides.md, then set ' +
        '"style: ./DESIGN.slides.md" in your slide-outline.md.',
      );
    } catch (error) {
      reportCliError(error);
    }
  });

program
  .command('show-design')
  .description('Parse a local design markdown file (DESIGN.slides.md preferred, falls back to DESIGN.md) or a bundled style id and print the slides-grab design summary the agent will use')
  .argument('<ref>', 'Path to DESIGN.slides.md / DESIGN.md / a directory containing one, or a bundled style id (e.g. glassmorphism)')
  .action(async (ref) => {
    try {
      const { loadDesignStyleRef, detectLocalDesignMarkdown } = await import('../src/design-styles.js');
      const { renderDesignStyleForPrompt } = await import('../src/design-md-parser.js');
      const { existsSync, statSync } = await import('node:fs');
      const { dirname, resolve } = await import('node:path');

      let effectiveRef = ref;
      let detection = null;
      let explicitWebShadowed = false;
      const absoluteRef = resolve(ref);
      if (existsSync(absoluteRef) && statSync(absoluteRef).isDirectory()) {
        detection = detectLocalDesignMarkdown({ baseDir: absoluteRef });
        if (!detection.path) {
          console.error(`No DESIGN.slides.md or DESIGN.md found in directory "${ref}".`);
          process.exitCode = 1;
          return;
        }
        effectiveRef = detection.path;
      } else if (existsSync(absoluteRef) && statSync(absoluteRef).isFile() && absoluteRef.endsWith('/DESIGN.md')) {
        const siblingDetection = detectLocalDesignMarkdown({ baseDir: dirname(absoluteRef) });
        if (siblingDetection.kind === 'slides') {
          detection = siblingDetection;
          explicitWebShadowed = true;
          effectiveRef = siblingDetection.path;
        }
      }

      const style = loadDesignStyleRef(effectiveRef);
      if (!style) {
        console.error(`No design style or design markdown file found at "${ref}".`);
        process.exitCode = 1;
        return;
      }
      const isCustom = style?.source?.type === 'design-md';
      if (isCustom) {
        if (detection) {
          const activeName = detection.kind === 'slides' ? 'DESIGN.slides.md' : 'DESIGN.md';
          const otherPresent = detection.kind === 'slides' && detection.webPath;
          console.log(`# Active file: ${activeName} (${detection.path})`);
          if (otherPresent) {
            const explicitPrefix = explicitWebShadowed ? ' explicit DESIGN.md reference was redirected;' : '';
            console.log(`# Note:${explicitPrefix} DESIGN.md is also present at ${detection.webPath} but is shadowed by DESIGN.slides.md.`);
          } else if (detection.kind === 'web') {
            console.log('# Note: only the web-flavored DESIGN.md was found. Consider converting it to DESIGN.slides.md before generating slides (see skills/slides-grab-plan/references/design-md-to-slides-conversion.md).');
          }
          console.log('');
        }
        console.log(renderDesignStyleForPrompt(style));
      } else {
        console.log(`# Bundled style: ${style.title} (${style.id})`);
        console.log(`Mood: ${style.mood}`);
        console.log(`Best for: ${style.bestFor}`);
        if (style.source?.repo) console.log(`Source: ${style.source.repo}`);
        if (style.source?.url) console.log(`Source URL: ${style.source.url}`);
        if (style.classification) console.log(`Classification: ${style.classification}`);
        if (style.aliasOf) console.log(`Alias of: ${style.aliasOf}`);
        if (Array.isArray(style.aliases) && style.aliases.length) console.log(`Aliases: ${style.aliases.join(', ')}`);
        if (Array.isArray(style.relatedStyleIds) && style.relatedStyleIds.length) console.log(`Related styles: ${style.relatedStyleIds.join(', ')}`);
        if (Array.isArray(style.background)) {
          console.log('\n## Background');
          for (const b of style.background) console.log(`- ${b}`);
        }
        if (Array.isArray(style.colors)) {
          console.log('\n## Colors');
          for (const c of style.colors) console.log(`- ${c.role}: ${c.label} (${c.hex})`);
        }
        if (Array.isArray(style.fonts)) {
          console.log('\n## Typography');
          for (const f of style.fonts) console.log(`- ${f}`);
        }
        if (Array.isArray(style.layout)) {
          console.log('\n## Layout');
          for (const l of style.layout) console.log(`- ${l}`);
        }
        if (Array.isArray(style.signature)) {
          console.log('\n## Signature');
          for (const s of style.signature) console.log(`- ${s}`);
        }
        if (Array.isArray(style.avoid)) {
          console.log('\n## Avoid');
          for (const a of style.avoid) console.log(`- ${a}`);
        }
      }
    } catch (error) {
      reportCliError(error);
    }
  });

program
  .command('show-template')
  .description('Print the contents of a template file')
  .argument('<name>', 'Template name (e.g. "cover", "content", "chart")')
  .action(async (name) => {
    const { resolveTemplate } = await import('../src/resolve.js');
    const result = resolveTemplate(name);
    if (!result) {
      console.error(`Template "${name}" not found.`);
      process.exitCode = 1;
      return;
    }
    const content = readFileSync(result.path, 'utf-8');
    console.log(`# Template: ${name} (${result.source})`);
    console.log(`# Path: ${result.path}\n`);
    console.log(content);
  });


await program.parseAsync(process.argv);
