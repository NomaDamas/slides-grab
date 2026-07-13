# slides-grab Export Reference

These are the packaged export rules for installable `slides-grab` skills.

## Package-first commands
- Raster PPTX export (default, highest visual fidelity): `slides-grab convert --slides-dir <path> --output <name>.pptx --engine raster`
- Editable-text PPTX export (best-effort DOM extraction): `slides-grab convert --slides-dir <path> --output <name>-editable.pptx --engine text`
- PDF export: `slides-grab pdf --slides-dir <path> --output <name>.pdf`
- Figma export: `slides-grab figma --slides-dir <path> --output <name>-figma.pptx`

## Export stage rules
- Only export after the user approves the reviewed HTML slides.
- Do not modify slide content during export unless explicitly requested.
- If export fails, fix the root cause in the source HTML/CSS or packaged runtime path.
- For decks with Chart.js or other `<canvas>` charts, run `slides-grab validate --slides-dir <path>` first and fix any `empty-canvas` error before exporting.
- Build and open `viewer.html` once for chart-heavy decks so the same charts are confirmed in the generated review surface.
- Keep Chart.js animation disabled in source slides so PDF/PNG capture sees the final painted chart.

## User-facing caveats
- PPTX export is experimental / unstable.
- `--resolution` can only be used with raster PPTX export. Text export requires semantic text tags, rasterizes canvas/SVG visuals, and may reject unsupported HTML/CSS.
- Figma export is experimental / unstable.
- Best-effort output may still require manual cleanup after export.

## Runtime source of truth
- Export behavior must come from the packaged CLI/runtime in `bin/`, `scripts/`, and `src/`.
- Installable skills must not require scripts from inside a skill directory.
