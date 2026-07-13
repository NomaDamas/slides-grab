---
name: slides-grab-export
description: Stage 3 conversion skill usable in Codex and Claude Code. Convert approved HTML slides to PDF or per-slide PNG reliably, and to experimental / unstable PPTX/Figma outputs on a best-effort basis.
metadata:
  short-description: Convert slides and run conversion checks
---

# slides-grab Export Skill

Use this only after the user approves design output **and the Stage 2 design gate verdict is `Proceed`** (zero unresolved Critical findings — see `../slides-grab-design/references/design-gate.md`). PDF, PPTX, and Figma exports require a fresh `slides-grab design-gate` Proceed receipt for the current slide files.

## Goal
Convert reviewed slide HTML into PDF or per-slide PNG reliably, and into experimental / unstable PPTX/Figma outputs on a best-effort basis.

## Inputs
- Approved `<slides-dir>/slide-*.html`
- Optional output path settings

## Outputs
- Presentation artifact (`.pdf`, `.png` per slide, or `.pptx`)

## Workflow
1. Confirm user approval for conversion **and that the Stage 2 design gate passed** with verdict `Proceed`. If any **Critical** design-gate finding is still unresolved, refuse to export — return to Stage 2, fix the Critical issue, re-run the gate, record Proceed with `slides-grab design-gate`, and only then convert.
2. Pick the right primary target:
   - Card-news / Instagram-style decks → `slides-grab png --slides-dir <path> --slide-mode card-news --resolution 2160p` (see `slides-grab-card-news`).
   - Widescreen slide decks → `slides-grab pdf --slides-dir <path> --output <name>.pdf`.
3. When per-slide raster output is needed (card news, social posts, thumbnails):
   - `slides-grab png --slides-dir <path> --output-dir <path>/out-png --resolution 2160p`
   - Add `--slide-mode card-news` for 1:1 cards.
4. If the user also wants a PDF deck:
   - `slides-grab pdf --slides-dir <path> --output <name>.pdf`
   - Add `--slide-mode card-news` when the deck is square.
5. For decks with Chart.js or other `<canvas>` charts, confirm `slides-grab validate --slides-dir <path>` passes without `empty-canvas`, then build/open `viewer.html` once before export. Chart.js charts should use disabled animation so PDF/PNG capture sees the final painted state.
6. If the user wants PPTX (experimental / unstable):
   - Default visual-fidelity export: `slides-grab convert --slides-dir <path> --output <name>.pptx --engine raster`
   - Editable-text export: `slides-grab convert --slides-dir <path> --output <name>-editable.pptx --engine text`
   - `--resolution` can only be used with the raster engine. The text engine requires semantic text tags, rasterizes canvas/SVG visuals, and may reject unsupported HTML/CSS.
7. If the user wants Figma-importable PPTX (experimental / unstable):
   - `slides-grab figma --slides-dir <path> --output <name>-figma.pptx`
8. Report success/failure with actionable errors.

## Rules
- Do not export while any **Critical** design-gate finding is unresolved (`../slides-grab-design/references/design-gate.md`). The design gate is a hard precondition for this stage, and `slides-grab pdf`, `slides-grab convert`, and `slides-grab figma` block if the latest receipt is missing or stale.
- Do not modify slide content during conversion stage unless explicitly requested.
- If conversion fails, diagnose and fix root causes in source HTML/CSS.
- For chart-heavy decks, treat a blank exported chart as a source rendering bug first: re-run validation, inspect `empty-canvas`, and verify the same slide in `viewer.html` before retrying PDF/PNG/PPTX export.
- Always tell the user that PPTX and Figma export are experimental / unstable and may require manual cleanup.
- Use the packaged CLI and bundled references only; do not depend on unpublished agent-specific files.

## Reference
For detailed conversion behavior and tools, use:
- `references/export-rules.md`
- `references/pptx-skill-reference.md` — archived full PPTX workflow guidance
- `references/html2pptx.md` — archived converter usage guide
- `references/ooxml.md` — archived OOXML reference
