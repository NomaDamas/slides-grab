---
name: slides-grab-plan
description: Stage 1 planning skill usable in Codex and Claude Code. Build and iterate slide-outline.md until explicit user approval.
metadata:
  short-description: Create and revise slide outline before design stage
---

# slides-grab Plan Skill

Use this when the user asks to start a new presentation from scratch.

## Goal
Produce an approved `slide-outline.md` before any slide HTML generation.

## Inputs
- Topic and intent
- Audience
- Tone and constraints
- Optional research findings

## Output
- `slide-outline.md` (must include `style: <id>`, `style: template-pack`, or an approved custom style direction in meta section)
- For chart-heavy decks, explicit chart slide notes: chart type, data source, key comparison, and whether the design stage should use the default Chart.js canvas template.

## Workflow
1. Analyze user goal and audience.
2. **Style selection (mandatory, before outline):** Four paths are accepted, in priority order:
   a. **Imported template pack** — when the user provides a corporate deck, reference slides, HTML examples, or brand images, run `slides-grab import-template --input <path> --slides-dir <slides-dir>` (repeat `--input` for multiple examples). Prefer filled representative decks/examples over empty master templates: filled examples reveal density, schema field limits, font resolution, and layout stress cases; an empty master alone is insufficient. Confirm the generated `<slides-dir>/.slides-grab/template-pack.json` is the intended reference source. Record as `style: template-pack`.
   b. **Bundled style** — run `slides-grab list-styles`, shortlist 2–3 styles, and get explicit user approval. Optionally offer `slides-grab preview-styles` for visual preview. Record as `style: <id>`.
   c. **Custom DESIGN.md path** — if a local `DESIGN.md` exists (e.g. provided directly or fetched via `slides-grab import-design <https-url>`), inspect it with `slides-grab show-design ./DESIGN.md` and confirm with the user.
   d. **Free-form custom direction** — if neither imported template pack, bundled style, nor DESIGN.md fits, propose a written custom direction and get approval.
3. **DESIGN.md → DESIGN.slides.md conversion (mandatory when path 2c was chosen):**
   - A `DESIGN.md` imported from `voltagent/awesome-design-md` or similar sources describes a **marketing website** (top-nav, hero-band, CTA buttons, pricing cards, footer-band). Slides are **single 720pt × 405pt frames** with no scroll, no nav, no clicks — copying web components into slides produces deck pages that look like landing pages.
   - Read `references/design-md-to-slides-conversion.md` for the canonical conversion guide.
   - Translate the imported `./DESIGN.md` into a sibling `./DESIGN.slides.md` next to it. Leave the original `DESIGN.md` untouched. The `DESIGN.slides.md` MUST follow the Output Contract in the reference and apply every row of the web → slide mapping table (top-nav → eyebrow strip, hero-band → cover layout, CTA buttons → kicker text, footer-band → thin footer strip, pricing grids → dropped, etc.).
   - Present a 5–10 line summary of the conversion to the user (kept tokens + dropped web sections + new slide layouts inferred) and wait for explicit approval before continuing.
   - After approval, run `slides-grab show-design ./DESIGN.slides.md` to confirm the parser reads it cleanly.
4. Create or revise `slide-outline.md` with ordered slides and key messages. Record the approved style reference in the meta section:
   - bundled style → `style: <id>`
   - converted DESIGN.slides.md → `style: ./DESIGN.slides.md`
   - imported template pack → `style: template-pack` and keep `<slides-dir>/.slides-grab/template-pack.json` with its `.slides-grab/template-previews/` assets
   - free-form custom direction → leave a one-paragraph `style:` block describing it
   - for chart slides, name the intended chart type and data payload in the slide notes so Stage 2 can build a real Chart.js canvas instead of placeholder bars or decorative pseudo-charts
   - delivery mode → `mode: html` for semantic slide HTML, or `mode: image-native` for raster wrapper slides generated from the approved template/style; prefer `image-native` for existing corporate templates/forms when the user asks for visual matching rather than editable HTML
4b. **Image-native outline density (mandatory when mode: image-native and a template is provided):** When the user provides a reference template (PDF/PPTX) for image-native generation, do NOT write a thin HTML-style outline. Instead:
   - Render the template pages to PNG and open them in order (page-01, page-02, ...).
   - For each template page, identify its layout type (cover, section divider, content grid, stat tiles, table, timeline, closing) and measure its **information density** — how many distinct text blocks, data points, bullets, captions, and visual elements it carries.
   - Write one outline slide per template page (or per logical template section), matching that page's layout type and information volume. If template page 3 has a 2×3 stat grid with 6 data points and 3 captions, the corresponding outline slide must also list 6 data points and 3 captions — not just a one-line summary.
   - Image-native slides are single raster images with no HTML structure constraints, so they can hold **more text and data per slide** than semantic HTML. Pack the outline with the full content the user wants on each slide — titles, subtitles, body paragraphs, bullet lists, data tables, stat values, captions, and image placement notes — at the density the template page demonstrates.
   - Tag each outline slide with its matching template page number (e.g. `template-page: 03`) so Stage 2 knows which `--reference` image to pass.
   - The result should be a noticeably denser outline than HTML mode: more bullets, more data, more text per slide, matching what the template's filled pages actually carry.
5. Present a concise summary to user.
6. Repeat revisions until explicit approval.

## Rules
- **Do not write the outline before the user approves a style.** Style selection comes first.
- Do not generate slide HTML (`<slides-dir>/slide-*.html`) in this stage.
- Keep scope to structure, narrative, and style selection.
- For quantitative stories, plan charts as evidence: identify the source values, comparison axis, baseline, and intended takeaway. Do not invent filler metrics just to fill a chart.
- Ask for approval before moving to design.
- Assume later stages run through the packaged `slides-grab` CLI.
- Use the packaged CLI and bundled references only; do not depend on unpublished agent-specific files.

## Reference
If needed, use the bundled outline reference:
- `references/outline-format.md`
- `references/plan-workflow-reference.md` — archived detailed planning workflow and runtime-neutral outline-worker guidance
- `references/design-md-to-slides-conversion.md` — DESIGN.md (web) → DESIGN.slides.md (slide) translation guide, including the structured output template and the web → slide mapping table
