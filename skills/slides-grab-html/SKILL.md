---
name: slides-grab-html
description: HTML-mode presentation pipeline usable in Codex and Claude Code. Build semantic slide-XX.html files, generate bespoke hero/accent imagery with slides-grab image, run the design gate, and export. Use when the deck needs editable, searchable, accessible text or when no existing template must be matched pixel-for-pixel.
metadata:
  short-description: Semantic HTML slide pipeline with bespoke imagery
---

# slides-grab HTML Skill

Build semantic `slide-XX.html` files where text is real HTML (selectable, editable, accessible) and imagery is generated as supporting accent/hero assets — **never** as whole-slide rasters. Use this pipeline when the user wants a deck they can edit, when slides contain charts or diagrams, or when no existing template demands pixel-perfect visual matching.

## Mode signal
The plan stage records `mode: html` in `slide-outline.md`. If no mode is recorded, default to this pipeline.

## Bespoke imagery rule
- Use `slides-grab image` to generate individual hero/accent images that sit *beside* or *behind* semantic text inside an HTML slide. The generated image is a supporting visual — text and layout stay in HTML/CSS.
- A bespoke image prompt describes **the accent visual only** — the atmospheric mood, the hero illustration, the background texture — not the slide's title, body copy, or layout. Let HTML handle text and layout.
- Good prompt: *"Atmospheric dawn horizon, cyan and silver tones, dreamy Y2K mood, no text, 16:9"* — describes a hero background.
- If you instead need the generated image to BE the whole slide (title, body, layout burned into the raster), use the image-native pipeline (`../slides-grab-image/SKILL.md`) — semantic HTML is the wrong tool for that.

## Workflow

### Stage 1 — Plan
Use the installed **slides-grab-plan** skill.
1. Take topic, audience, and tone.
2. Run `slides-grab list-styles`, shortlist 2–3 bundled styles, get explicit approval. Optionally offer `slides-grab preview-styles`. If none fit, propose a custom direction. If the user provides a reference template/PDF/PPTX for color tokens only (not pixel-perfect matching), import it with `slides-grab import-template` and record `style: template-pack` — the template pack supplies design tokens, but slides stay semantic HTML.
3. Record `mode: html` in `slide-outline.md` meta.
4. Present outline, revise until approved.

### Stage 2 — Design
Use the installed **slides-grab-design** skill.
1. Read approved `slide-outline.md`, load the style spec (`src/design-styles-data.js` for bundled ids, `slides-grab show-design` for `DESIGN.slides.md`, or `.slides-grab/template-pack.json` for imported packs).
2. Write a visual thesis, content plan, system declaration, and design tokens before generating slides.
3. Generate `slide-XX.html` semantic HTML files with 2-digit numbering in `--slides-dir`.
4. **Bespoke imagery**: when a slide needs a hero/accent image, run `slides-grab image --prompt "<accent-visual prompt>" --slides-dir <path>`. The default codex provider reuses the local Codex ChatGPT login (`~/.codex/auth.json` — run `codex login` once; no API key required). Save under `<slides-dir>/assets/`. To guide the style, pass reference images with `--reference <path>` (repeatable). Optional providers: `--provider openai` (OpenAI gpt-image-2 via `OPENAI_API_KEY`), `--provider nano-banana` (Google `gemini-3-pro-image-preview` via `GOOGLE_API_KEY`/`GEMINI_API_KEY`, supports `--image-size 2K|4K`). If credentials are unavailable, fall back to web search + download into `<slides-dir>/assets/`.
5. **Diagrams**: for complex diagrams (architecture, workflows, relationship maps), use `tldraw` via `slides-grab tldraw`, store under `<slides-dir>/assets/`.
6. **Charts**: default to Chart.js (`<script src="https://cdn.jsdelivr.net/npm/chart.js"></script>`), start from `templates/chart.html`, keep `animation: false`, `responsive: true`, `maintainAspectRatio: false`, wrap `<canvas>` in a stable container. `slides-grab validate` reports `empty-canvas` for unpainted canvases.
7. **Video**: store under `<slides-dir>/assets/`, prefer `poster="./assets/<file>"`. Use `slides-grab fetch-video` or `yt-dlp` for web sources.
8. **Icons**: prefer Lucide before emoji.
9. Run `slides-grab validate --slides-dir <path>`. Auto-fix failures until it passes.
10. Run the design gate (`../slides-grab-design/references/design-gate.md`): capture PNG evidence, run Pass A (System Contract) + Pass B (Audience Impact), synthesize verdict. Resolve all Critical findings, re-render, re-review until `Proceed`. Record with `slides-grab design-gate --slides-dir <path> --verdict proceed --pass-a-report <a.md> --pass-b-report <b.md>`.
11. Launch the HTML editor: `slides-grab edit --slides-dir <path>`. For chart decks, also run `slides-grab build-viewer` and confirm charts render in `viewer.html`.

### Stage 3 — Export
Use the installed **slides-grab-export** skill. Requires a fresh `Proceed` gate receipt.
1. Widescreen → `slides-grab pdf --slides-dir <path> --output <name>.pdf`.
2. Per-slide PNG → `slides-grab png --slides-dir <path> --output-dir <path>/out-png --resolution 2160p`.
3. Card-news → `slides-grab png --slide-mode card-news` (see `../slides-grab-card-news`).
4. PPTX/Figma (experimental / unstable) → `slides-grab convert` / `slides-grab figma`.

## Rules
- Keep slide size 720pt × 405pt.
- Keep semantic text tags (`p`, `h1-h6`, `ul`, `ol`, `li`). Never put text directly in `<div>`/`<span>`.
- Backgrounds only on `<div>`; text only in semantic tags.
- No CSS gradients — use flat fills; rasterize gradients to PNG with Sharp if needed.
- Put local images/videos under `<slides-dir>/assets/`, reference as `./assets/<file>`.
- Allow `data:` URLs when a slide must be self-contained; never leave remote `http(s)://` image URLs in saved HTML.
- Prefer Lucide for iconography; avoid emoji unless the brief explicitly asks.
- Keep body copy ≥14pt on a 720pt × 405pt slide; 10pt absolute floor.
- Avoid AI slop tropes (aggressive gradient backgrounds, left-border accent cards, SVG-drawn imagery, generic font stacks, generic 3×2 icon-plus-blurb grids).
- Do not present slides for review until `slides-grab validate` passes.
- Do not advance to export while any Critical design-gate finding is unresolved.

## Reference
- `../slides-grab-plan/SKILL.md` and `../slides-grab-plan/references/`
- `../slides-grab-design/SKILL.md` and `../slides-grab-design/references/`
- `../slides-grab-export/SKILL.md` and `../slides-grab-export/references/`
