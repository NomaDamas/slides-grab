# AGENTS.md

## Project Overview

slides-grab is an agent-first PPT framework. AI agents write HTML slides directly, and a 3-stage pipeline (Planning → Design → Conversion) produces high-quality HTML/PDF output plus experimental / unstable PPTX and Figma export.

**Core philosophy: HTML is the design language.** Agents write HTML/CSS directly. The framework provides templates, validation, and conversion tools — not abstractions over HTML.

## Key Paths

| Path | Purpose |
|------|---------|
| `skills/slides-grab/SKILL.md` | Router skill — picks HTML or image-native pipeline |
| `skills/slides-grab-html/SKILL.md` | HTML-mode pipeline (semantic slides + bespoke hero imagery) |
| `skills/slides-grab-image/SKILL.md` | Image-native pipeline (whole-slide rasters via `slides-grab image`) |
| `skills/slides-grab-plan/SKILL.md` | Stage 1 plan skill (outline workflow) |
| `skills/slides-grab-design/SKILL.md` | Codex design skill (HTML slides + viewer loop) |
| `skills/slides-grab-export/SKILL.md` | Codex conversion skill (PDF + experimental / unstable HTML→PPTX/Figma) |
| `skills/slides-grab-design/references/design-gate.md` | Design gate spec — severity rubric, seven checks (incl. 6b Korean word-break and Review Litmus), dialectical dual-oracle Visual QA loop (render evidence → Pass A System Contract / Constraint Integrity + Pass B Audience Impact / Expressive Readability → synthesized verdict → fix/re-render/re-review until Proceed or Rethink), rule→side-effect→compensation matrix (12 rows), evidence-before-shipping, design-debt log, gate report/verdict (runs after validate, before export) |
| `runtimes/claude-code/agents/design-critic-agent.md` | Claude Code adapter that points to the canonical design gate and records `slides-grab design-gate` evidence |
| `runtimes/codex/agents/slides-grab-design-critic.md` | Codex adapter that points to the canonical design gate and records `slides-grab design-gate` evidence |
| `skills/*/references/` | Published reference docs bundled with installable skills |
| `scripts/build-viewer.js` | Builds viewer.html from slide-*.html files in selected `--slides-dir` |
| `src/html2pptx.cjs` | Packaged HTML→PPTX conversion runtime |
| `src/pptx-raster-export.cjs` | Packaged raster PPTX export runtime behind `convert.cjs` |
| `slides/` (default) or custom `--slides-dir` path | Generated HTML slide workspace |
| `slide-outline.md` | Presentation outline generated during Stage 1 |
| `package.json` | Node.js dependencies (playwright, sharp, pptxgenjs) |
| `convert.cjs` | Legacy experimental / unstable HTML→PPTX converter |

## Slide Specifications

- **Size**: 720pt × 405pt (16:9)
- **Font**: Pretendard (CDN: `https://cdn.jsdelivr.net/gh/orioncactus/pretendard@v1.3.9/dist/web/static/pretendard.min.css`)
- **Text tags**: Only `<p>`, `<h1>`-`<h6>`, `<ul>`, `<ol>`, `<li>` — never put text directly in `<div>` or `<span>`
- **Colors in CSS**: Use `#` prefix (`#FF0000`)
- **Colors in PptxGenJS**: No `#` prefix (`FF0000`)
- **No CSS gradients**: Rasterize to PNG with Sharp instead

## Runtime Adapters

| Adapter | Role |
|---------|------|
| `slides-grab-design-critic` | Codex adapter for the design gate and `slides-grab design-gate` receipt |
| `design-critic-agent` | Claude Code adapter for the design gate and `slides-grab design-gate` receipt |

## Skill System

| Skill | Role | Stage |
|-------|------|-------|
| `slides-grab` | Router — picks HTML or image-native pipeline, then runs shared stages | All |
| `slides-grab-html` | HTML-mode pipeline (semantic slides + bespoke hero imagery via `slides-grab image`) | 2 |
| `slides-grab-image` | Image-native pipeline (whole-slide rasters via `slides-grab image`) | 2 |
| `slides-grab-plan` | Stage 1 outline planning | Stage 1 |
| `slides-grab-design` | Stage 2 slide design/review (shared design rules + gate) | Stage 2 |
| `slides-grab-export` | Stage 3 conversion (PDF + experimental / unstable PPTX/Figma) | Stage 3 |

## Dependencies

### Node.js (package.json)
- `pptxgenjs` ^3.12.0 — PowerPoint generation
- `playwright` ^1.40.0 — Browser automation (Chromium)
- `sharp` ^0.33.0 — Image processing

### Python
- `markitdown` — Markdown conversion
- `defusedxml` — XML parsing
- `pillow` — Image processing

### System (optional)
- `LibreOffice` (soffice) — PPTX thumbnail generation
- `Poppler` (pdftoppm) — PDF to image conversion

## Rules for Agents

1. **Do not modify SKILL.md philosophy sections** — design principles, rules, and constraints must be preserved when editing SKILL.md files.
2. **All new scripts go in `scripts/`** unless they are skill-specific (then `skills/<name>/scripts/`).
3. **Use ES modules** — `import/export` syntax, not `require()`. Exception: `.cjs` files for CommonJS compat.
4. **JavaScript, not TypeScript** — Use JSDoc for type hints if needed.
5. **Test scripts by running them** — Use `node scripts/<name>.js` to verify they work.
6. **Playwright browser reuse** — When processing multiple slides, keep the browser instance open and reuse it across slides for performance.
7. **Environment variables for API keys** — `GEMINI_API_KEY`, `ANTHROPIC_API_KEY`, `OPENAI_API_KEY`. Never hardcode keys.
8. **CSS-safe HTML** — All text in semantic tags (`<p>`, `<h1>`-`<h6>`, `<ul>`, `<ol>`), backgrounds only on `<div>` elements.
