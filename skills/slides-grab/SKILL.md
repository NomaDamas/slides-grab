---
name: slides-grab
description: End-to-end presentation workflow usable in Codex and Claude Code. Routes the user request to the HTML-mode or image-native-mode sub-skill, then runs the shared plan, design, and export stages. PDF and per-slide PNG are preferred; PPTX/Figma export is experimental / unstable.
metadata:
  short-description: Routes a presentation request to the HTML or image-native pipeline
---

# slides-grab Skill - Mode Router

Decides how the deck should be built and routes to the right pipeline. Read the user's intent, pick a delivery mode, then hand off to the matching sub-skill for the detailed stage instructions. Both pipelines share the same Stage 1 (`slides-grab-plan`) and Stage 3 (`slides-grab-export`) skills; the difference is how Stage 2 produces slides.

---

## Pick a delivery mode

Ask the user (or infer from the request) which pipeline to use:

| Signal | Route to |
| --- | --- |
| "make slides about X", "write a deck", editable text, searchable content, accessibility, charts, diagrams, Card-news, most greenfield decks | **slides-grab-html** — semantic HTML slides |
| "make slides in this template/form", "match this existing deck", visual fidelity to a corporate template matters more than editable text, user handed a filled PPTX/PDF and wants the same look | **slides-grab-image** — image-native raster wrapper slides |

When in doubt, default to **slides-grab-html**. Only choose image-native when the user explicitly prioritizes visual matching to an existing template over editability.

After picking the mode, **read the matching sub-skill in full** and follow its pipeline. Do not mix instructions from the two sub-skills — the image generation steps are different and must not be combined.

---

## Shared stages (both pipelines)

### Stage 1 — Plan
Use the installed **slides-grab-plan** skill. The plan stage records the chosen `mode: html` or `mode: image-native` in `slide-outline.md` meta so Stage 2 knows which pipeline to run. Do not proceed to Stage 2 without approval of both style and outline.

### Stage 3 — Export
Use the installed **slides-grab-export** skill. Export is gated on a Stage 2 design-gate `Proceed` verdict. PPTX and Figma are experimental / unstable.

---

## Shared rules (apply to both pipelines)

1. **Always follow the stage order**: Plan → Design → Export.
2. **Get explicit user approval** before advancing to the next stage.
3. **Pass the design gate before export**: Stage 2 must end with a `Proceed` verdict (zero unresolved Critical findings) on the latest rendered state. `slides-grab pdf`, `slides-grab convert`, and `slides-grab figma` block if the receipt is missing, stale, or fails the CLI-enforced report contract.
4. **Use `decks/<deck-name>/`** as the slides workspace for multi-deck projects.
5. **Call out export risk clearly**: PPTX and Figma export are experimental / unstable.
6. For complex diagrams, default to a `tldraw`-generated asset unless the user explicitly asks for a different approach.
7. When a slide needs bespoke imagery inside an HTML deck, prefer the default god-tibo-imagen provider via `slides-grab image` (reuses local Codex ChatGPT login — no API key required; run `codex login` once) and keep the saved asset local under `<slides-dir>/assets/`. Image-native decks instead use `slides-grab generate-images` for whole-slide rasters — see the image sub-skill.
8. When a slide needs a chart, default to Chart.js in-slide canvas rendering and require `slides-grab validate` plus `slides-grab build-viewer` review so blank canvases are caught as `empty-canvas` before export. Local videos live under `<slides-dir>/assets/` with `poster="./assets/<file>"` thumbnails; use `slides-grab fetch-video` or `yt-dlp` to pull supported web videos first.
9. Use `slides-grab list-styles` and `slides-grab preview-styles` for bundled style discovery during planning.

---

## Reference
- `references/presentation-workflow-reference.md` — archived end-to-end workflow guidance from the legacy skill set
- `../slides-grab-html/SKILL.md` — HTML-mode pipeline (semantic slides)
- `../slides-grab-image/SKILL.md` — image-native pipeline (raster wrapper slides)
