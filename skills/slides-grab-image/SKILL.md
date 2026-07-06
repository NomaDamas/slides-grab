---
name: slides-grab-image
description: Image-native presentation pipeline usable in Codex and Claude Code. Generate whole-slide raster images via slides-grab image or generate-images, wrap them in slide-XX.html, run the design gate, and export. Use when visual fidelity to an existing template/form matters more than editable text, or when the user asks to "make slides in this template."
metadata:
  short-description: Image-native raster slide pipeline with whole-slide generation
---

# slides-grab Image Skill

Generate whole-slide raster images where the generated PNG **is** the slide content (title, body, layout, visuals all burned into one image), then wrap each PNG in a minimal `slide-XX.html` that simply displays it. Use this pipeline when the user wants to match an existing corporate template, filled deck, or brand form pixel-for-pixel, and editability/searchability/accessibility are secondary.

## Mode signal
The plan stage records `mode: image-native` in `slide-outline.md`. The user typically provides a reference template (PPTX, PDF, HTML examples, brand images) and says "make slides in this form."

## Image generation commands (both valid here)
Two commands generate raster images. Pick by workflow:

- **`slides-grab generate-images`** — batch: reads `slide-outline.md` + `.slides-grab/template-pack.json`, produces one raster PNG per slide plus wrapper `slide-XX.html` and `.slides-grab/image-native/*.json` metadata in one run. Use for whole-deck generation from an outline.
- **`slides-grab image`** — single image: takes `--prompt`, saves one PNG under `<slides-dir>/assets/`. Use for one-off slides, regeneration of a single slide, or when you want per-slide prompt control without an outline-driven batch.

Both accept `--reference <path>` (repeatable) to pass template page images for style/layout guidance. Both use the same providers (`god-tibo` default, `codex`, `nano-banana`).

## Prompt rule for whole-slide rasters
A whole-slide prompt describes **the complete slide** — title text, body content, layout, color bands, visual elements — because the raster IS the slide. Pass reference template pages with `--reference <path>` (repeatable) so the model matches the template's layout and style.
- Good prompt: *"Corporate proposal cover slide: bright royal blue band across the top third, deep navy title area below with white title text 'Project Kickoff', small bunny logo bottom-right, white field at bottom, 16:9"* — describes a complete slide with text and layout.
- For `slides-grab image` used as a single accent/hero asset inside an HTML slide (the HTML pipeline), the prompt instead describes only the accent visual — see the HTML sub-skill.

## Workflow

### Stage 1 — Plan
Use the installed **slides-grab-plan** skill.
1. Take topic, audience, and tone.
2. If the user provides a reference template/PDF/PPTX, import it with `slides-grab import-template --input <path>` (repeat `--input` for multiple examples). Prefer filled representative decks over empty master templates — filled examples reveal density, schema field limits, and layout stress. Confirm `.slides-grab/template-pack.json` is the intended reference source. Record `style: template-pack`.
3. Record `mode: image-native` in `slide-outline.md` meta so Stage 2 generates rasters, not semantic HTML.
4. Present outline, revise until approved.

### Stage 2 — Design (image-native generation)
Use the installed **slides-grab-design** skill with image-native mode.
1. Read approved `slide-outline.md` and `.slides-grab/template-pack.json`.
2. **Whole-deck generation**: run `slides-grab generate-images --outline slide-outline.md --slides-dir <path> --template-pack <path> --provider god-tibo` to produce one raster PNG per slide plus wrapper `slide-XX.html` and `.slides-grab/image-native/*.json` metadata. For per-slide control or single-slide regeneration, use `slides-grab image --prompt "<whole-slide prompt>" --slides-dir <path> --reference <template-page.png>` then write the wrapper `slide-XX.html` that displays `./assets/<name>.png`.
   - `god-tibo` (default): reuses local Codex ChatGPT login (`~/.codex/auth.json` — run `codex login` once; no API key required). Calls an unsupported private Codex backend that may break without notice.
   - `codex`: OpenAI gpt-image-2 via `OPENAI_API_KEY`; maps `--aspect-ratio` to nearest supported OpenAI image size.
   - `nano-banana`: Google `gemini-3-pro-image-preview` via `GOOGLE_API_KEY`/`GEMINI_API_KEY`; supports `--image-size 2K|4K`.
   - `dry-run`: deterministic placeholder for tests/fixtures only.
   - If credentials are unavailable, fall back to web search + download into `<slides-dir>/assets/`.
3. **Reference-guided generation**: pass template page images as `--reference <path>` (repeatable) so the model matches the template's layout, colors, and density. Select 2–3 layout-similar template pages per slide type (cover, content, closing).
4. Image-native wrapper slides are less editable than HTML. For bbox/content feedback after generation, use the editor's **Image Regenerate** mode rather than direct HTML edits.
5. Run `slides-grab validate --slides-dir <path>`. Auto-fix failures until it passes.
6. Run the design gate (`../slides-grab-design/references/design-gate.md`): capture PNG evidence, run Pass A (System Contract) + Pass B (Audience Impact), synthesize verdict. Resolve all Critical findings, re-render, re-review until `Proceed`. Record with `slides-grab design-gate --slides-dir <path> --verdict proceed --pass-a-report <a.md> --pass-b-report <b.md>`.
7. Launch the editor: `slides-grab edit --slides-dir <path>` (Image mode shows image providers and regenerates from `.slides-grab/image-native/*.json` metadata; the model selector is hidden).

### Stage 3 — Export
Use the installed **slides-grab-export** skill. Requires a fresh `Proceed` gate receipt.
1. Widescreen → `slides-grab pdf --slides-dir <path> --output <name>.pdf`.
2. Per-slide PNG → `slides-grab png --slides-dir <path> --output-dir <path>/out-png --resolution 2160p`.
3. Card-news → `slides-grab png --slide-mode card-news` (see `../slides-grab-card-news`).
4. PPTX/Figma (experimental / unstable) → `slides-grab convert` / `slides-grab figma`.

## Rules
- Keep slide size 720pt × 405pt.
- Image-native wrapper `slide-XX.html` must reference the generated `./assets/slide-XX.png` — do not hand-write semantic text into wrapper slides.
- Put generated assets under `<slides-dir>/assets/`, reference as `./assets/<file>`.
- Allow `data:` URLs when a slide must be self-contained; never leave remote `http(s)://` image URLs in saved HTML.
- Do not present slides for review until `slides-grab validate` passes.
- Do not advance to export while any Critical design-gate finding is unresolved.

## Reference
- `../slides-grab-plan/SKILL.md` and `../slides-grab-plan/references/`
- `../slides-grab-design/SKILL.md` and `../slides-grab-design/references/`
- `../slides-grab-export/SKILL.md` and `../slides-grab-export/references/`
