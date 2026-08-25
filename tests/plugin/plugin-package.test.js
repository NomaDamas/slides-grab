import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import {
  existsSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join, sep } from 'node:path';
import test from 'node:test';

const manifestPath = '.codex-plugin/plugin.json';

function collectFiles(directory) {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name);
    return entry.isDirectory() ? collectFiles(path) : [path];
  });
}

test('ChatGPT plugin manifest exposes the packaged skills directory', () => {
  const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));

  assert.equal(manifest.name, 'slides-grab');
  assert.match(manifest.version, /^\d+\.\d+\.\d+(?:[-.][0-9A-Za-z.-]+)?$/);
  assert.equal(manifest.skills, './skills/');
  assert.match(manifest.description, /presentation/i);
});

test('plugin build creates an installable ZIP with every published skill', () => {
  const outputDirectory = mkdtempSync(join(tmpdir(), 'slides-grab-plugin-'));

  try {
    execFileSync(process.execPath, ['scripts/build-plugin.js', '--output', outputDirectory], {
      stdio: 'pipe',
    });

    const packageJson = JSON.parse(readFileSync('package.json', 'utf8'));
    const zipPath = join(
      outputDirectory,
      `slides-grab-chatgpt-plugin-v${packageJson.version}.zip`,
    );

    assert.equal(existsSync(zipPath), true);

    const entries = execFileSync('unzip', ['-Z1', zipPath], { encoding: 'utf8' })
      .trim()
      .split('\n');

    assert.ok(entries.includes('slides-grab/.codex-plugin/plugin.json'));
    assert.ok(entries.includes('slides-grab/CHATGPT.md'));

    for (const skillPath of collectFiles('skills')) {
      const zipSkillPath = skillPath.split(sep).join('/');
      assert.ok(entries.includes(`slides-grab/${zipSkillPath}`), `${skillPath} is missing`);
    }

    const packagedManifest = JSON.parse(
      execFileSync(
        'unzip',
        ['-p', zipPath, 'slides-grab/.codex-plugin/plugin.json'],
        { encoding: 'utf8' },
      ),
    );

    assert.equal(packagedManifest.version, packageJson.version);
  } finally {
    rmSync(outputDirectory, { recursive: true, force: true });
  }
});
