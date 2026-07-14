# Claude Setup And Usage

This guide is for running `slides-grab` with Claude Code and shared Vercel-installed skills.

## 1) Install the npm Package

```bash
npm install slides-grab
npx playwright install chromium
```

Verify:

```bash
slides-grab --help
```

## 2) Install Claude Code Skills

From the local npm install:

```bash
npx slides-grab install-skills --target claude-code --scope user
```

Then restart Claude Code so the shared skills are loaded.

Runtime contract:

- Claude Code loads these shared Agent Skills from `~/.claude/skills/`.
- The packaged workflow uses bundled skills, bundled references, lightweight runtime adapters, and the `slides-grab` CLI.
- `slides-grab pdf`, `slides-grab convert`, and `slides-grab figma` require a fresh `slides-grab design-gate` `proceed` receipt for the current slide files.
- To install the same package for both Claude Code and Codex from one environment, run:

```bash
npx slides-grab install-skills --target all --scope user
```

## 3) Developer / Repo Clone Path

If you want to work on `slides-grab` itself:

```bash
git clone https://github.com/NomaDamas/slides-grab.git && cd slides-grab
npm ci
npx playwright install chromium
npx slides-grab install-skills --target claude-code --scope user
```

Installed skill names:

- `slides-grab-plan`
- `slides-grab-design`
- `slides-grab-export`
- `slides-grab`

## 4) Run Commands During Workflow

Use one workspace folder per deck:

Prerequisite: create or generate `decks/my-deck/` with `slide-*.html` first. These commands do not work against an empty clone.

```bash
slides-grab edit --slides-dir decks/my-deck
slides-grab build-viewer --slides-dir decks/my-deck
slides-grab validate --slides-dir decks/my-deck
slides-grab image --slides-dir decks/my-deck --prompt "Editorial hero image for slide 03"
slides-grab pdf --slides-dir decks/my-deck --output decks/my-deck.pdf
slides-grab pdf --slides-dir decks/my-deck --mode print --output decks/my-deck-searchable.pdf
slides-grab convert --slides-dir decks/my-deck --output decks/my-deck.pptx
slides-grab figma --slides-dir decks/my-deck --output decks/my-deck-figma.pptx
```

> `slides-grab convert` and `slides-grab figma` are **experimental / unstable**. Treat their output as best-effort and expect manual cleanup in PowerPoint or Figma.

`slides-grab pdf` defaults to `--mode capture` for visual fidelity. Use `--mode print` when searchable/selectable text is more important than pixel-perfect browser parity.

When a slide needs bespoke generated imagery, use `slides-grab image --prompt "..." --slides-dir <path>`. The default provider is codex-imagen, which reuses your local Codex ChatGPT login (`~/.codex/auth.json`) — run `codex login` once; no OpenAI/Google API key required (your Codex/ChatGPT account must be entitled to image generation). ⚠️ codex-imagen calls an unsupported private Codex backend that may break without notice. Optional fallbacks: `--provider openai` (OpenAI `gpt-image-2` via `OPENAI_API_KEY`) or `--provider nano-banana` (Google `gemini-3-pro-image-preview` via `GOOGLE_API_KEY` or `GEMINI_API_KEY`; supports `--image-size 2K|4K`). If no credentials are available, ask for one or fall back to web search + local download into `assets/`.

## 5) Recommended Claude Kickoff Prompt

Copy-paste into Claude:

```text
Read docs/installation/claude.md first and follow it exactly. Install slides-grab with npm, install the shared skills from ./node_modules/slides-grab using Vercel Agent Skills, use slides-grab-plan/design/export (or slides-grab), keep each deck in decks/<deck-name>, and run validate before conversion.
```
