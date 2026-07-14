# Codex Setup And Usage

This guide is for running `slides-grab` with Codex and shared Vercel-installed skills.

## 1) Install the npm Package

```bash
npm install slides-grab
npx playwright install chromium
```

Verify:

```bash
slides-grab --help
```

## 2) Install Codex Skills

From the local npm install:

```bash
npx slides-grab install-skills --target codex --scope user
```

Then restart Codex so the installed skills are loaded.

Runtime contract:

- Codex loads these shared Agent Skills from `~/.agents/skills/`.
- The packaged workflow uses bundled skills, bundled references, lightweight runtime adapters, and the `slides-grab` CLI.
- `slides-grab pdf`, `slides-grab convert`, and `slides-grab figma` require a fresh `slides-grab design-gate` `proceed` receipt for the current slide files.
- To install the same package for both Codex and Claude Code from one environment, run:

```bash
npx slides-grab install-skills --target all --scope user
```

## 3) Developer / Repo Clone Path

If you want to work on `slides-grab` itself instead of consuming the package:

```bash
git clone https://github.com/NomaDamas/slides-grab.git && cd slides-grab
npm ci
npx playwright install chromium
npx slides-grab install-skills --target codex --scope user
```

## 4) Codex Workflow

Installed skill names:

- `slides-grab-plan`
- `slides-grab-design`
- `slides-grab-export`
- `slides-grab`

Run one deck per workspace folder:

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

`slides-grab pdf` defaults to `--mode capture` for browser-faithful rendering. Switch to `--mode print` when you need searchable/selectable text in the exported PDF.

When a slide needs bespoke generated imagery, use `slides-grab image --prompt "..." --slides-dir <path>`. The default provider is codex-imagen, which reuses your local Codex ChatGPT login (`~/.codex/auth.json`) — run `codex login` once; no OpenAI/Google API key required (your Codex/ChatGPT account must be entitled to image generation). ⚠️ codex-imagen calls an unsupported private Codex backend that may break without notice. Optional fallbacks: `--provider openai` (OpenAI `gpt-image-2` via `OPENAI_API_KEY`) or `--provider nano-banana` (Google `gemini-3-pro-image-preview` via `GOOGLE_API_KEY` or `GEMINI_API_KEY`; supports `--image-size 2K|4K`). If no credentials are available, ask for one or fall back to web search + local download into `assets/`.

## 5) Recommended Codex Kickoff Prompt

Copy-paste into Codex:

```text
Read docs/installation/codex.md first and follow it exactly. Install slides-grab with npm, install the shared skills from ./node_modules/slides-grab using Vercel Agent Skills, use slides-grab-plan/design/export (or slides-grab), keep each deck in decks/<deck-name>, and run validate before convert/pdf.
```
