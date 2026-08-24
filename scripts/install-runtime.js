#!/usr/bin/env node

import { cp, mkdir, readdir, rm } from 'node:fs/promises';
import { homedir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const packageRoot = resolve(__dirname, '..');
const VALID_TARGETS = new Set(['all', 'codex', 'claude-code']);
const VALID_SCOPES = new Set(['project', 'user']);
const SKILL_NAMES = [
  'slides-grab',
  'slides-grab-html',
  'slides-grab-image',
  'slides-grab-plan',
  'slides-grab-design',
  'slides-grab-export',
  'slides-grab-card-news',
];

function printUsage() {
  process.stdout.write(
    [
      'Usage: slides-grab install-skills [options]',
      '',
      'Options:',
      '  --target <target>       Runtime target: all|codex|claude-code (default: all)',
      '  --runtime <target>      Alias for --target',
      '  --scope <scope>         Install scope: project|user (default: project)',
      '  --project-dir <path>    Project directory for project scope (default: cwd)',
      '  --target-root <path>    Root directory for user-style installs',
      '  --dry-run              Print planned writes without copying',
      '  --json                 Print JSON result',
      '  -h, --help             Show this help message',
    ].join('\n'),
  );
  process.stdout.write('\n');
}

function parseArgs(args) {
  const options = {
    target: 'all',
    scope: 'project',
    projectDir: process.cwd(),
    targetRoot: '',
    dryRun: false,
    json: false,
    help: false,
  };

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === '-h' || arg === '--help') {
      options.help = true;
      continue;
    }
    if (arg === '--dry-run') {
      options.dryRun = true;
      continue;
    }
    if (arg === '--json') {
      options.json = true;
      continue;
    }
    if (OPTION_FIELDS.has(arg)) {
      options[OPTION_FIELDS.get(arg)] = readOptionValue(args, index, arg);
      index += 1;
      continue;
    }
    const equalSignIndex = arg.indexOf('=');
    if (equalSignIndex > -1) {
      const name = arg.slice(0, equalSignIndex);
      if (OPTION_FIELDS.has(name)) {
        options[OPTION_FIELDS.get(name)] = arg.slice(equalSignIndex + 1);
        continue;
      }
    }
    throw new Error(`Unknown option: ${arg}`);
  }

  if (options.help) return options;

  options.target = normalizeTarget(options.target);
  options.scope = normalizeScope(options.scope);
  options.projectDir = resolve(process.cwd(), options.projectDir);
  options.targetRoot = options.targetRoot ? resolve(process.cwd(), options.targetRoot) : '';
  return options;
}

const OPTION_FIELDS = new Map([
  ['--target', 'target'],
  ['--runtime', 'target'],
  ['--scope', 'scope'],
  ['--project-dir', 'projectDir'],
  ['--target-root', 'targetRoot'],
]);

function readOptionValue(args, index, optionName) {
  const value = args[index + 1];
  if (!value || value.startsWith('-')) {
    throw new Error(`Missing value for ${optionName}.`);
  }
  return value;
}

function normalizeTarget(value) {
  const target = String(value || '').trim().toLowerCase();
  if (!VALID_TARGETS.has(target)) {
    throw new Error(`Unknown runtime target "${value}". Expected: all, codex, or claude-code.`);
  }
  return target;
}

function normalizeScope(value) {
  const scope = String(value || '').trim().toLowerCase();
  if (!VALID_SCOPES.has(scope)) {
    throw new Error(`Unknown install scope "${value}". Expected: project or user.`);
  }
  return scope;
}

function selectedTargets(target) {
  return target === 'all' ? ['codex', 'claude-code'] : [target];
}

function runtimeRoots(options, target) {
  if (options.scope === 'project') {
    return {
      codex: {
        skillsDir: join(options.projectDir, '.agents', 'skills'),
        agentsDir: join(options.projectDir, '.codex', 'agents'),
      },
      'claude-code': {
        skillsDir: join(options.projectDir, '.claude', 'skills'),
        agentsDir: join(options.projectDir, '.claude', 'agents'),
      },
    }[target];
  }

  const root = options.targetRoot || homedir();
  return {
    codex: {
      skillsDir: join(root, '.agents', 'skills'),
      agentsDir: join(root, '.codex', 'agents'),
    },
    'claude-code': {
      skillsDir: join(root, '.claude', 'skills'),
      agentsDir: join(root, '.claude', 'agents'),
    },
  }[target];
}

async function copyDirectory(source, destination, dryRun) {
  if (dryRun) return;
  await rm(destination, { recursive: true, force: true });
  await mkdir(dirname(destination), { recursive: true });
  await cp(source, destination, { recursive: true });
}

async function installTarget(options, target) {
  const roots = runtimeRoots(options, target);
  const writes = [];
  if (!options.dryRun) {
    await mkdir(roots.skillsDir, { recursive: true });
    await mkdir(roots.agentsDir, { recursive: true });
  }

  for (const skillName of SKILL_NAMES) {
    const source = join(packageRoot, 'skills', skillName);
    const destination = join(roots.skillsDir, skillName);
    await copyDirectory(source, destination, options.dryRun);
    writes.push(destination);
  }

  const adapterSourceDir = join(packageRoot, 'runtimes', target, 'agents');
  const adapterFiles = await readdir(adapterSourceDir);
  for (const adapterFile of adapterFiles) {
    const source = join(adapterSourceDir, adapterFile);
    const destination = join(roots.agentsDir, adapterFile);
    await copyDirectory(source, destination, options.dryRun);
    writes.push(destination);
  }

  return { target, skillsDir: roots.skillsDir, agentsDir: roots.agentsDir, writes };
}

export async function main(argv = process.argv.slice(2)) {
  const options = parseArgs(argv);
  if (options.help) {
    printUsage();
    return;
  }

  const installs = [];
  for (const target of selectedTargets(options.target)) {
    installs.push(await installTarget(options, target));
  }

  if (options.json) {
    process.stdout.write(`${JSON.stringify({ installs, dryRun: options.dryRun }, null, 2)}\n`);
    return;
  }

  for (const install of installs) {
    const label = install.target === 'claude-code' ? 'Claude Code' : 'Codex';
    process.stdout.write(`Installed slides-grab skills for ${label}\n`);
    process.stdout.write(`  Skills: ${install.skillsDir}\n`);
    process.stdout.write(`  Agents: ${install.agentsDir}\n`);
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exit(1);
  });
}
