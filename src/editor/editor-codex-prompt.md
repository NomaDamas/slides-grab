# Editor Codex Prompt — Slide Edit Rules

This prompt is sent to Codex when the editor requests a single-slide edit.
It is intentionally separate from the full design skill (SKILL.md) because
the editor context assumes the deck design is already established.

## Primary Objective
The user's edit request is the primary objective. All rules below exist to support it, not override it. When a rule conflicts with the user's intent, follow the user.

## Edit Workflow
1. Read the target slide HTML file.
2. Apply the user's edit request to the selected region.
3. Run `slides-grab validate --slides-dir <path>` after editing.
4. If validation fails, fix the HTML/CSS and re-run until it passes.
5. Return after applying the change.

## Slide Rules
- Keep slide size appropriate for the current mode (`720pt x 405pt` for presentation, `720pt x 720pt` for card-news).
- Keep semantic text tags (`p`, `h1-h6`, `ul`, `ol`, `li`).
- Never place text directly in `<div>` or `<span>`.
- Always include `#` prefix in CSS colors.
- Always include the Pretendard webfont CDN link.

## Asset Rules
- Put local images and videos under `<slides-dir>/assets/` and reference as `./assets/<file>`.
- Always include `alt` on `<img>` tags.
- Allow `data:` URLs only when the slide must be fully self-contained.
- Do not leave remote `http(s)://` image URLs in saved slide HTML; download into `./assets/`.
- Do not use absolute filesystem paths in slide HTML.
- Do not use non-body `background-image` for content imagery; use `<img>` instead.
- Use `data-image-placeholder` to reserve space when no image is available yet.
- When the request needs bespoke imagery, prefer `slides-grab image --prompt "<prompt>" --slides-dir <path>` so the default codex-imagen provider saves the asset under `<slides-dir>/assets/` via your local Codex ChatGPT login (run `codex login` once if needed).
- Default provider codex-imagen reuses `~/.codex/auth.json` — no OpenAI/Google API key required; requires a Codex/ChatGPT account entitled to image generation. ⚠️ codex calls an unsupported private Codex backend that may break without notice. Optional fallbacks: `--provider openai` (OpenAI gpt-image-2 via `OPENAI_API_KEY`; maps `--aspect-ratio` to the nearest supported OpenAI image size; `--image-size 2K|4K` is Nano Banana-only) or `--provider nano-banana` (Google `gemini-3-pro-image-preview` via `GOOGLE_API_KEY` / `GEMINI_API_KEY`; supports `--image-size 2K|4K`). If credentials are unavailable, fall back to web search + download into `./assets/`.
- For local videos, use `<video src="./assets/<file>">` with `poster="./assets/<file>"`.
- If a video starts on YouTube or a supported page, use `slides-grab fetch-video --url <url> --slides-dir <path>` to download first.

## Art Direction Defaults
- Give each slide one job, one dominant visual anchor, one primary takeaway.
- Keep copy short enough to scan in seconds.
- Use whitespace, alignment, scale, cropping, and contrast before adding decorative chrome.
- Prefer Lucide as the default icon library for slide UI elements, callouts, and supporting visuals.
- Do not default to emoji for iconography unless the brief explicitly asks for a playful or native-emoji tone.
- Default to cardless layouts unless a card improves structure.
- Limit to two typefaces max and one accent color.

## Do NOT
- Re-open style selection or run `slides-grab preview-styles`.
- Modify other slide HTML files unless explicitly requested.
- Persist runtime-only editor/viewer injections (`<base>`, debug scripts, viewer wrappers).
- Start PPTX/PDF conversion.
