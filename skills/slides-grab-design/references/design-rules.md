# slides-grab Design Reference

These are the packaged design rules for installable `slides-grab` skills.

## Package-first commands
- Validate slides: `slides-grab validate --slides-dir <path>`
- Build review viewer: `slides-grab build-viewer --slides-dir <path>`
- Launch HTML editor: `slides-grab edit --slides-dir <path>`
- Launch image-native editor for revisions: `slides-grab edit-image --slides-dir <path>`
- Generate a bespoke image asset: `slides-grab image --prompt "<prompt>" --slides-dir <path>` (default provider: codex-imagen via `codex login` — no API key required)
- Download a web video into slide assets: `slides-grab fetch-video --url <youtube-url> --slides-dir <path>`
- Render `tldraw` diagrams: `slides-grab tldraw --input <path> --output <path>`
- List bundled design collections: `slides-grab list-styles`
- Open the visual style gallery in browser: `slides-grab preview-styles`

## Slide spec
- Slide size: `720pt x 405pt` (16:9)
- Font: Pretendard
- Semantic text tags only: `p`, `h1-h6`, `ul`, `ol`, `li`
- CSS colors must include `#`
- Avoid CSS gradients for PPTX-targeted decks

## Icon guidance
- Prefer Lucide as the default icon library when a slide needs iconography.
- Avoid emoji as the default icon treatment; only use emoji when the brief explicitly calls for them.
- Keep icons visually consistent within a deck (stroke weight, size, and color should follow the slide's design tokens).

## Chart guidance
- Use Chart.js as the default charting library for quantitative slides; `templates/chart.html` is the packaged starting point.
- Keep chart scripts inside the relevant `slide-*.html` file and initialize charts after the target `<canvas>` exists.
- Use `animation: false`, `responsive: true`, and `maintainAspectRatio: false` for deterministic validation, viewer preview, and export.
- Put each `<canvas>` inside a stable fixed-size or flex-stable wrapper so the layout box and drawing buffer are non-zero.
- Use real data from the outline/research notes, label sample data as sample/synthetic, and avoid decorative pseudo-charts for data claims.
- Run `slides-grab validate --slides-dir <path>` and fix any `empty-canvas` error before building the viewer or exporting.

## Asset rules
- Store deck-local assets in `<slides-dir>/assets/`
- Reference deck-local assets as `./assets/<file>`
- Use `slides-grab image --prompt "<prompt>" --slides-dir <path>` with the default codex-imagen provider (Codex CLI ChatGPT login) for bespoke generated images when helpful
- If an image comes from the web, download it into `<slides-dir>/assets/` before referencing it
- If a video comes from YouTube or another supported page, use `slides-grab fetch-video` (or `yt-dlp` directly) to download it into `<slides-dir>/assets/` before referencing it
- Keep local videos and their poster thumbnails together under `<slides-dir>/assets/`
- Default provider codex-imagen reuses the local Codex ChatGPT login (`~/.codex/auth.json`) — run `codex login` once; no API key required. ⚠️ codex-imagen uses an unsupported private Codex backend that may break without notice. Optional fallbacks: `--provider openai` (OpenAI gpt-image-2 via `OPENAI_API_KEY`; maps `--aspect-ratio` to the nearest supported OpenAI image size; `--image-size 2K|4K` is Nano Banana-only) or `--provider nano-banana` (Google `gemini-3-pro-image-preview` via `GOOGLE_API_KEY` / `GEMINI_API_KEY`; supports `--image-size 2K|4K`). If credentials are unavailable, fall back to web search + download
- Use `tldraw`-generated local assets for complex diagrams when possible
- Allow `data:` URLs only when the slide must be fully self-contained
- Do not leave remote `http(s)://` image URLs in saved slide HTML
- Never use absolute filesystem paths

## Package-published template references
- `templates/cover.html`
- `templates/contents.html`
- `templates/section-divider.html`
- `templates/content.html`
- `templates/statistics.html`
- `templates/split-layout.html`
- `templates/team.html`
- `templates/quote.html`
- `templates/timeline.html`
- `templates/closing.html`
- `templates/chart.html`
- `templates/diagram.html`
- `templates/diagram-tldraw.html`
- `templates/custom/`
- `templates/design-styles/README.md` — bundled design collection reference derived from `corazzon/pptx-design-styles` and `epoko77-ai/design-diversity`
- `templates/design-styles/preview.html` — visual gallery of all 95 styles (open with `slides-grab preview-styles`)
- `src/design-styles-data.js` and `src/design-diversity-data.js` — full style specs (colors, fonts, layout, signature elements, things to avoid) for all 95 bundled styles; read these after the user picks a style to ground your design tokens

## Review loop
- The design style is chosen in Stage 1 (Plan) and recorded in `slide-outline.md`'s meta section (`style: <id>`). Do not re-open style selection in Stage 2 — read and apply the already-approved style.
- Generate or edit only the needed slide files.
- Prefer `slides-grab image` before remote image sourcing when the slide needs bespoke imagery.
- Prefer `tldraw` for complex diagrams instead of hand-building dense diagram geometry in HTML/CSS.
- Prefer Chart.js for charts and verify the generated `viewer.html` when a deck contains `<canvas>` charts.
- Re-run validation after every generation/edit pass.
- Rebuild the viewer only after validation passes.
- Do not move to export until the user approves the reviewed deck.
