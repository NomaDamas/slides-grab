---
name: slides-grab-image
description: Image-native presentation pipeline usable in Codex and Claude Code. Generate whole-slide raster images one slide at a time with slides-grab image, passing the reference template page as --reference so the model copies the layout and style and only swaps the content. Use when visual fidelity to an existing template matters more than editable text.
metadata:
  short-description: Image-native pipeline — per-slide raster generation with template reference
---

# slides-grab Image Skill

Generate whole-slide raster images where the generated PNG **is** the slide. Each slide is generated individually with `slides-grab image`, passing the matching reference template page image(s) via `--reference` so the model reproduces the template's layout, colors, fonts, and density — only swapping in the new slide's content. Use this pipeline when the user wants to match an existing corporate template, filled deck, or brand form visually.

## Mode signal
The plan stage records `mode: image-native` in `slide-outline.md`. The user typically provides a reference template (PPTX, PDF, HTML examples) and says "make slides in this form."

## Core rule: reference-guided per-slide generation
- **Generate one slide at a time** with `slides-grab image`. Do NOT use `slides-grab generate-images` (the batch command auto-assembles garbage prompts from markdown and produces inconsistent output).
- **Always pass at least one reference template page image** via `--reference <path>` (repeatable). The reference page(s) must be the same slide-type (cover, content, closing) from the source template. The model must copy the reference's layout, color bands, typography hierarchy, whitespace, and density — only the text content and any embedded photos change.
- The prompt must explicitly instruct: *"Follow the reference image's layout, composition, color palette, and typography hierarchy exactly. Keep the same band positions, spacing, and visual rhythm. Only replace the text content and photos with the new slide's content below."*
- Pass any real photos/assets to embed as additional `--reference` images so the model can place them into the template layout.

## Prompt structure (use this pattern)
```
slides-grab image \
  --prompt "Follow the reference image layout exactly — same color bands, same typography hierarchy, same spacing and density. This is a [cover/content/closing] slide. Replace the text with: Title: '<new title>'. Body: '<new body text>'. Bullets: <bullet list>. Keep the template's visual style, fonts, and color palette. Render all text sharp and legible. 16:9, 720pt × 405pt." \
  --slides-dir <path> \
  --reference <template-page-cover.png> \
  --reference <real-photo-to-embed.png>
```

Key prompt principles:
- **Describe the content to inject**, not the visual design — the reference image defines the design.
- Name the slide type (cover, content, closing, stat) so the model picks the right reference density.
- List the exact title, body, and bullets as literal strings the model should render.
- If embedding real photos, name them in the prompt ("place photo-1 in the left grid cell") and pass them as `--reference`.
- Require sharp, legible, correctly spelled text.

## Workflow

### Stage 1 — Plan (template-driven dense outline)
Use the installed **slides-grab-plan** skill with image-native outline density rules.
1. Take topic, audience, and tone.
2. If the user provides a reference template/PDF/PPTX, import it with `slides-grab import-template --input <path>`. Also render the template pages to PNG (e.g. `pdftoppm -png -r 150 <input>.pdf <prefix>`) and store under `<slides-dir>/.slides-grab/template-previews/`. These page renders are the `--reference` images for Stage 2.
3. **Read the template pages in order** (page-01, page-02, ...). For each page, identify its layout type and information density — how many text blocks, data points, bullets, captions, and visual elements it carries. This is the critical step: the outline must match the template's per-slide density, not write a thin HTML-style summary.
4. **Write a dense outline**: one outline slide per template page, carrying the full content the user wants — titles, subtitles, body paragraphs, full bullet lists, stat values, table data, captions, and image placement notes — at the volume the template page demonstrates. Image-native slides are single rasters with no HTML structure limits, so they hold more text and data per slide than semantic HTML. Do not under-fill.
5. Tag each outline slide with `template-page: NN` so Stage 2 knows which reference image to pass.
6. Record `mode: image-native` and `style: template-pack` in `slide-outline.md` meta.
7. Present outline, revise until approved.

### Stage 2 — Design (per-slide image generation)
1. Read approved `slide-outline.md`. For each slide, read its `template-page: NN` tag and pick that exact template page render from `.slides-grab/template-previews/page-NN.png` as the primary `--reference`. If the slide has no tag, pick 1–2 layout-similar pages by slide type (cover, content, stat, closing).
2. For each slide, run `slides-grab image` with:
   - `--prompt` containing ALL the content from the outline for that slide — the full title, subtitle, body paragraphs, every bullet, every stat value, every caption — not a summary. Precede the content with "Follow the reference image layout exactly — same color bands, same typography hierarchy, same spacing and density. Only replace the text content with the content below."
   - `--reference` pointing to the matching template page render(s)
   - `--reference` for any real photos to embed (member photos, product shots, logos)
   - `--slides-dir <path>` and `--name slide-XX` (so the output is `assets/slide-XX.png`)
   - `--image-native` so the command also writes the editor-compatible `slide-XX.html` wrapper and `.slides-grab/image-native/slide-XX.json` regeneration metadata
   - `--provider codex` (default; reuses `~/.codex/auth.json`, run `codex login` once, no API key). Alternatives: `--provider openai` (OPENAI_API_KEY, gpt-image-2), `--provider nano-banana` (GOOGLE_API_KEY/GEMINI_API_KEY).
3. Confirm each command reports `Created image-native slide wrapper: slide-XX.html`. Do not hand-write the wrapper; `--image-native` keeps the PNG, wrapper, and regeneration metadata contract aligned for `slides-grab edit-image`.
4. Run `slides-grab validate --slides-dir <path>`. Auto-fix failures until it passes.
5. Run the design gate (`../slides-grab-design/references/design-gate.md`): capture PNG evidence, run Pass A + Pass B, synthesize verdict. Resolve all Critical findings, re-generate the failing slide, re-render, re-review until `Proceed`. Record with `slides-grab design-gate --slides-dir <path> --verdict proceed --pass-a-report <a.md> --pass-b-report <b.md>`.
6. For revisions, regenerate the specific slide with `slides-grab image` (same `--reference`, adjusted `--prompt`), or launch the image-native editor with `slides-grab edit-image --slides-dir <path>`.

### Stage 3 — Export
Use the installed **slides-grab-export** skill. Requires a fresh `Proceed` gate receipt.
1. Widescreen → `slides-grab pdf --slides-dir <path> --output <name>.pdf`.
2. Per-slide PNG → `slides-grab png --slides-dir <path> --output-dir <path>/out-png --resolution 2160p`.
3. PPTX/Figma (experimental / unstable) → `slides-grab convert` / `slides-grab figma`.

## Rules
- Keep slide size 720pt × 405pt (16:9).
- **Always pass `--reference` template page images** — never generate image-native slides from a text-only prompt. The reference defines the visual design; the prompt defines the content.
- Generate one slide at a time with `slides-grab image`. Do not use `slides-grab generate-images`.
- `slides-grab image --image-native --name slide-XX` writes the wrapper and regeneration metadata. Do not hand-write semantic text into wrapper slides.
- Put generated assets under `<slides-dir>/assets/`, reference as `./assets/<file>`.
- Allow `data:` URLs when a slide must be self-contained; never leave remote `http(s)://` image URLs in saved HTML.
- Do not present slides for review until `slides-grab validate` passes.
- Do not advance to export while any Critical design-gate finding is unresolved.

## Reference
- `../slides-grab-plan/SKILL.md` and `../slides-grab-plan/references/`
- `../slides-grab-design/SKILL.md` and `../slides-grab-design/references/`
- `../slides-grab-export/SKILL.md` and `../slides-grab-export/references/`
