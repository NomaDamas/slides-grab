# Presentation Skill - Full Workflow Orchestrator

Guides you through the complete presentation pipeline from topic to exported file.

---

## Workflow

### Stage 1 — Plan

Use the installed **slides-grab-plan** skill.

1. Take user's topic, audience, and tone.
2. Create `slide-outline.md`.
3. Present `slide-outline.md` to user.
4. Revise until user explicitly approves.

**Do not proceed to Stage 2 without approval.**

### Stage 2 — Design

Use the installed **slides-grab-design** skill.

1. Read approved `slide-outline.md`.
2. If the user has not approved a visual direction yet, use `slides-grab list-styles` to shortlist bundled styles, optionally `slides-grab preview-styles` to open the visual gallery in browser, and agree on a direction with the user. If the user provides a corporate deck, filled reference examples, HTML examples, or brand imagery, run `slides-grab import-template --input <path> --slides-dir <path>` and use the resulting `.slides-grab/template-pack.json`; filled representative examples are preferred over empty master templates. If none of the 95 bundled styles or imported references fit, design a fully custom visual direction.
3. Generate `slide-*.html` files in the slides workspace (default: `slides/`).
4. Run validation: `slides-grab validate --slides-dir <path>`
5. If validation fails, automatically fix the slide HTML/CSS until validation passes.
6. Build the viewer: `slides-grab build-viewer --slides-dir <path>`
7. When a slide calls for bespoke imagery, prefer `slides-grab image --prompt "<prompt>" --slides-dir <path>` so the default codex-imagen provider (reuses local Codex ChatGPT login — no API key required) saves a local asset under `<slides-dir>/assets/`. For image-first decks, generate each image-native slide with `slides-grab image --image-native --name slide-XX --reference <template-page.png> --slides-dir <path>`; the command writes the raster wrapper and regeneration metadata together, and revisions should use `slides-grab edit-image --slides-dir <path>`.
8. For complex diagrams (architecture, workflows, relationship maps, multi-node concepts), prefer `tldraw`. Render a local diagram asset with `slides-grab tldraw`, store it under `<slides-dir>/assets/`, and place it into the slide with a normal `<img>`.
9. For quantitative slides, use Chart.js as the default charting library, preferably starting from `templates/chart.html`. Keep scripts in `slide-*.html`, disable animation, use stable canvas wrappers, and fix any `empty-canvas` validation error before review.
10. Keep local videos under `<slides-dir>/assets/`, prefer `poster="./assets/<file>"` thumbnails, and use `slides-grab fetch-video --url <youtube-url> --slides-dir <path>` (or `yt-dlp` directly) when the source starts on a supported web page.
11. The default provider, codex, reuses the local Codex ChatGPT login (`~/.codex/auth.json`) — run `codex login` once; no API key required. ⚠️ The codex provider uses an unsupported private Codex backend that may break without notice. Optional alternatives: `--provider openai` (OpenAI gpt-image-2 via `OPENAI_API_KEY`; maps `--aspect-ratio` to the nearest supported OpenAI image size; `--image-size 2K|4K` is Nano Banana-only) or `--provider nano-banana` (Google `gemini-3-pro-image-preview` via `GOOGLE_API_KEY` or `GEMINI_API_KEY`; supports `--image-size 2K|4K`). If credentials are unavailable, fall back to web search + download into `<slides-dir>/assets/`.
12. Present viewer to user for review. For Chart.js decks, specifically confirm charts render inside `viewer.html`.
13. Revise individual slides based on feedback, then re-run validation and rebuild the viewer.
14. Optionally launch the HTML visual editor: `slides-grab edit --slides-dir <path>`. For image-native slide revisions, use `slides-grab edit-image --slides-dir <path>`.

**Do not proceed to Stage 3 without approval.**

### Stage 3 — Export

Use the installed **slides-grab-export** skill.

1. Confirm user wants conversion.
2. Export to PPTX: `slides-grab convert --slides-dir <path> --output <name>.pptx --engine raster` for visual fidelity (default), or `--engine text` for best-effort editable text (**experimental / unstable**)
3. Export to PDF (if requested): `slides-grab pdf --slides-dir <path> --output <name>.pdf`
4. Report results.

---

## Rules

1. **Always follow the stage order**: Plan → Design → Export.
2. **Get explicit user approval** before advancing to the next stage.
3. **Read each stage's SKILL.md** for detailed rules — this skill only orchestrates.
4. **Use `decks/<deck-name>/`** as the slides workspace for multi-deck projects.
5. **Call out export risk clearly**: PPTX and Figma export are experimental / unstable and should be described as best-effort output.
6. **Prefer tldraw for complex diagrams**: Use `slides-grab tldraw` for diagram-heavy slides unless the user explicitly wants another rendering path.
7. **Prefer OpenAI for bespoke imagery**: Use `slides-grab image` when a slide benefits from generated imagery, and keep the result as a local asset under `<slides-dir>/assets/`.
8. **Prefer Chart.js for charts**: Use real canvas charts for quantitative claims and require validation plus viewer review before export.
