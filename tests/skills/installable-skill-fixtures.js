import { readdirSync } from 'node:fs';
import { join } from 'node:path';

export const INSTALLABLE_SKILLS = [
  'skills/slides-grab/SKILL.md',
  'skills/slides-grab-html/SKILL.md',
  'skills/slides-grab-image/SKILL.md',
  'skills/slides-grab-plan/SKILL.md',
  'skills/slides-grab-design/SKILL.md',
  'skills/slides-grab-export/SKILL.md',
  'skills/slides-grab-card-news/SKILL.md',
];

function collectMarkdownFiles(directory) {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name);

    if (entry.isDirectory()) {
      return collectMarkdownFiles(path);
    }

    return entry.isFile() && entry.name.endsWith('.md') ? [path] : [];
  });
}

export const PACKAGED_SKILL_MARKDOWN = collectMarkdownFiles('skills');

export const PACKAGED_RUNTIME_FORBIDDEN_PATTERNS = [
  /design-critic-agent/,
  /organizer-agent/,
  /research-agent/,
  /\.claude\/agents/,
  /\.claude\/skills/,
  /\.agents\/skills/,
  /node scripts\//,
];
