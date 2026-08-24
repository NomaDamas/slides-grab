# slides-grab Design Gate

The design gate is the structured, pass/fail design-quality review a deck must clear **after** `slides-grab validate` (technical correctness) and **before** export. Validation proves the HTML is mechanically sound; the design gate proves the deck is actually well-designed.

This gate is adapted from inclusive multi-agent design review process (severity-gated critique, evidence before claims, deferred-issue tracking) and grounded in this repo's own art direction (`beautiful-slide-defaults.md`, `detailed-design-rules.md`).

> **One rule above all:** the gate produces a **verdict with evidence**, never an opinion. "This looks good" is not a pass. "I checked these criteria against these slides and here is the result" is a pass.

---

## Where the gate runs

```
Stage 2 (Design)
  generate slides
    → slides-grab validate        (technical: asset paths, tags, size, overflow)
    → Review Litmus               (beautiful-slide-defaults.md)
    → DESIGN GATE  ← this file    (dual-oracle Visual QA → severity-classified verdict)
        ├─ capture render evidence   (slides-grab png → gate-preview/*.png)
        ├─ Pass A  read-only  (System Contract / Constraint Integrity)      ┐ parallel
        ├─ Pass B  read-only  (Audience Impact / Expressive Readability)    ┘
        ├─ synthesize one verdict    (Proceed / Revise / Rethink)
        └─ if not Proceed: fix → validate → re-render → adversarial re-review
    → user visual review (editor)
  user approves
Stage 3 (Export)  ← refuses to start while any Critical finding is unresolved
```

Run the gate as an **adversarial quality loop**, not a one-shot audit:
- after the first full pass of slide generation, before presenting the deck for review,
- again after any edit round that changes layout, color, typography, imagery, or content density, and
- repeatedly until the synthesized verdict is `Proceed` or the gate declares `Rethink approach`.

The loop is: **validate → render evidence → Pass A + Pass B → synthesize → fix findings → validate again → re-render → re-review**. Do not reuse old PNGs or old pass reports after a fix; every loop uses fresh rendered evidence. The same adversarial roles run again, because the fix for one side can create a new defect for the other side.

The gate is a separate evaluation pass. Prefer dedicated read-only **critic subagents/tasks** for the two reviewer passes whenever the runtime supports them, so the reviewer is not the same mind that just defended every choice while building. Explicitly select image/vision-capable critic models that can open the rendered PNGs; do not infer visual quality from HTML, CSS, filenames, or validation output alone.

---

## Severity rubric

Every finding gets exactly one severity. Severity decides what happens next — it is not a vibe.

| Severity | Definition | Action |
|----------|-----------|--------|
| **Critical** | Breaks the deck's design integrity or makes a slide fail its job: unreadable text, palette violation, an AI slop trope shipped as the primary treatment, no real visual anchor on a key slide, or a slide whose main point cannot be grasped. | **Must fix before proceeding. Hard-blocks export.** |
| **Major** | Significantly degrades quality but the slide still works: weak hierarchy, inconsistent system across slides, decorative chrome carrying no meaning, copy that does not scan. | **Should fix before review/handoff.** Advisory — user may choose to proceed. |
| **Minor** | Improvement opportunity that neither blocks nor significantly degrades: small spacing/alignment imperfections, a slightly off accent usage. | **Fix if cheap, otherwise track as design debt.** |
| **Note** | Observation or idea for a future iteration. | **Document, do not act on now.** |

**Hard gate rule:** Critical findings block progress. They must be resolved (or the offending slide redesigned) before the deck advances to export. No Critical is ever silently downgraded to get to a green verdict.

**No silent drops:** every Minor and Note that is not fixed this round is written into the design-debt log (see below). Findings either get fixed or get tracked — never dropped.

---

## What the gate checks

Run every slide through these checks. Each check maps to existing repo rules; the gate's job is to enforce them as a structured pass, not to invent new taste.

### 1. System consistency (from `beautiful-slide-defaults.md` → "Vocalize the System")
- [ ] The deck commits to a declared system: reused layout patterns, **max two background colors**, **max two typefaces**, **one accent color**.
- [ ] Section dividers and content slides follow the declared rhythm; the system does not drift slide to slide.
- [ ] Image-led vs text-led slides match the declared content plan.

### 2. Color discipline (from `beautiful-slide-defaults.md` → "Color Discipline")
- [ ] Every color traces back to the approved style spec (`src/design-styles-data.js`) / the user's brand tokens, or a documented harmonic `oklch()` extension of them.
- [ ] No fresh standalone hex colors invented mid-slide.
- [ ] One accent color across the deck; two background colors max.
- **A color that cannot be traced to the approved palette is Critical.**

### 3. AI slop tropes (from `beautiful-slide-defaults.md` → "AI Slop Tropes to Avoid")
- [ ] No aggressive full-slide gradient background used as the primary surface.
- [ ] No rounded-rectangle "accent card" with a solid left-border stripe as a default container.
- [ ] No iconography or product imagery drawn with inline SVG shapes (use a real asset or `data-image-placeholder`).
- [ ] No generic font stacks (Inter, Roboto, Arial, Fraunces, OS system stacks) — Pretendard or the style-specified typeface only.
- [ ] No emoji as default iconography (Lucide is the default; emoji only when the brief explicitly calls for a playful native-emoji tone).
- [ ] No generic 3×2 "feature card grid" (icon + heading + two-line blurb) used as the default answer to a content slide.
- [ ] No faux chrome (drop shadows, subtle gradients, card borders) added to decorate empty space instead of carrying meaning.
- **A slop trope shipped as a slide's primary treatment is Critical. An isolated, secondary instance is Major.**

### 4. Composition & hierarchy (from `beautiful-slide-defaults.md` → "Beautiful Defaults")
- [ ] Each slide has one job, one primary takeaway, one dominant visual anchor.
- [ ] The opening slide reads like a poster — the title or brand is the loudest element, free of secondary clutter.
- [ ] Whitespace, alignment, scale, cropping, and contrast do the work before any decorative chrome.
- [ ] Cardless by default; a card appears only where it improves structure or comprehension.
- **A key slide (opener, section divider, closing) with no real visual anchor is Critical.**

### 5. Content discipline (from `beautiful-slide-defaults.md` → "Content Discipline")
- [ ] No filler copy, dummy stats, invented numbers, vague percentages, or stat strips that only exist to look informational.
- [ ] No element added beyond the approved outline without user sign-off.
- [ ] Copy scans in seconds; every line, badge, and callout earns its place.
- **Invented data presented as real is Critical.**

### 6. Typography & legibility (from `detailed-design-rules.md`)
- [ ] Body copy ≥ 14pt on a 720×405pt slide; nothing below the 10pt absolute floor.
- [ ] A consistent type scale is reused across the deck (display / headline / body / caption roles), not ad-hoc sizes per slide.
- [ ] Text has enough contrast against its background to be read comfortably at presentation distance.
- **Text below the 10pt floor, or text that is effectively unreadable against its background, is Critical.**

### 6b. Korean/CJK word-break integrity (from `detailed-design-rules.md`)

Korean and CJK text must break **between words (어절), never inside one.** A single word split across two lines — e.g. `오케스트` / `레이션`, `에이전` / `트` — looks broken on a slide and must be fixed, not tolerated as "acceptable wrapping."

This check has **two layers**: (1) *prevent* mid-word breaks at build time with `word-break: keep-all`; (2) at the gate, the Visual QA pass *catches the side effect* of keep-all — uneven (ragged) lines — and devises a fix strategy. Layer 1 is mechanical and should already be on. Layer 2 needs a human/oracle reading the rendered slide, because "is this line balance ugly?" is a visual judgment, not a grep.

**Layer 1 — Prevent mid-word breaks (build-time baseline):**
- [ ] No 어절/word is broken mid-word across lines. The break point always falls at a space (word boundary), not inside a token.
- [ ] `word-break: keep-all` is set on every heading, quote, and body block that can wrap. This is the default baseline for slide HTML.
- [ ] Indivisible units (a label like `[Image #1]`, a product name, a number+unit) use `white-space: nowrap;` so they never split.

**Layer 2 — Line balance after keep-all (Visual QA judgment):**

`keep-all` stops mid-word breaks, but it has a known side effect: when a long word will not fit, the whole word is pushed to the next line, which can leave the deck with **ragged lines** — one line nearly full, the next carrying only a word or two. When the **per-line character counts differ a lot across the wrapped lines** of a single block, the block looks lopsided.

- [ ] No wrapped text block is left badly ragged: a near-full line followed by a line carrying only a stray word or two.
- [ ] Across the lines of one wrapped block, the per-line character counts are roughly even — no single line is a small fraction of the others.
- [ ] No orphaned tail line carrying a single syllable or 1–2 characters that belongs with the line above.

When Visual QA (Pass B) finds a ragged/lopsided block, it must **devise a fix strategy**, not just flag it. Choose from the ladder below (cheapest first that keeps the design intent):
1. **Insert an explicit `<br>`** at the intended phrase boundary so the wrap lands where you want it and the lines read as balanced whole-word groups.
2. **Balance the lines automatically** with `text-wrap: balance;` (or `pretty`) so the browser evens out per-line length.
3. **Reduce the average characters per line** — narrow the text box (`max-width`) or add more deliberate line breaks so each line carries fewer, more even characters. Lowering the average per-line count this way trades a taller block for even, calm lines, which usually reads better on a slide than two wildly uneven lines. Prefer this when the imbalance comes from one overflowing word forcing an awkward wrap.
4. **Nudge letter-spacing or font-size down a notch** to pull a stranded word back onto the previous line — but never below the 14pt body floor / 10pt absolute floor.
5. **Re-word or shorten the copy** (within the approved outline) so it wraps cleanly. If it changes meaning, ask the user first.

- **Severity:** A key slide (title, section divider, closing) or a large heading/quote with a **mid-word Korean break (Layer 1)** is **Major** (must fix before review). A **badly ragged / lopsided wrapped block (Layer 2)** on a key slide or large heading is **Major**; the same in small body/caption text, or a merely slightly-uneven-but-whole-word wrap, is **Minor** (fix or track). Set `word-break: keep-all` proactively while building so Layer 1 rarely surfaces, leaving the gate to focus on Layer 2 line balance.

### 7. Review Litmus (from `beautiful-slide-defaults.md` → "Review Litmus")

Review Litmus exists because the two reviewer roles need one shared audience-success contract. It keeps synthesis from collapsing into either subjective taste ("I like it") or pure rule compliance ("the tokens are legal, therefore it passes"). It is **not a third reviewer pass**; it is the gate-level tie-breaker that asks whether a contract-compliant slide still succeeds for the audience.

`beautiful-slide-defaults.md` keeps the litmus as the authoring/self-review heuristic before handoff. This file uses the same litmus during synthesis: when Pass A and Pass B disagree below Critical severity, prefer the fix that makes the slide's point faster, clearer, and less dependent on decorative chrome.

For each slide, confirm:
- [ ] The audience can grasp the main point in 3–5 seconds.
- [ ] One dominant idea, not multiple competing blocks.
- [ ] One real visual anchor, not just decoration.
- [ ] Still feels premium with shadows/cards/chrome stripped away.
- [ ] No line of copy, badge, or callout can be removed without losing meaning.

---

## How the gate is run: the Visual QA procedure (dual-oracle)

The seven checks above are *what* to judge. This section is *how* to judge them with real evidence. The gate is run as a Visual QA procedure adapted from the dual-oracle web/TUI verification pattern: capture objective render evidence, dispatch two parallel read-only reviewer passes, then synthesize one verdict.

> **The render evidence is not the verdict.** `slides-grab validate` numbers and rendered PNGs *aim* the reviewers; they do not, by themselves, pass the deck. A clean validate run can still hide an unreadable heading, an awkward Korean line break, or a key slide with no anchor.

### Step 1 — Capture objective render evidence

The gate must be run against the **actual rendered slides**, never the raw HTML alone. Reading HTML cannot reveal CJK line breaks, descender clipping, accent overuse, element overlap, or weak hierarchy as they appear on screen.

```
slides-grab png --slides-dir <path> --output-dir <path>/gate-preview --resolution 1080p
```

This renders one PNG per slide. These PNGs are the REFERENCE evidence every reviewer pass must open and inspect. Also keep the `slides-grab validate` summary (it must already be green) as supporting evidence.

### Step 2 — Dispatch two read-only reviewer passes in parallel

Send BOTH passes in a single message so they run concurrently. Each pass is **read-only**: it reviews and reports, it never edits slides. Prefer one dedicated **critic subagent/task per pass**, separate from the slide-building agent and from the other reviewer. Explicitly request image/vision-capable models and require them to open every rendered PNG directly before returning a verdict. The two passes differ in charter, not in evidence access.

When model selection is available, use an image/vision-capable critic for both passes. If only one vision-capable critic slot exists, assign it to Pass B, keep Pass A as a distinct contract review, and leave any visual claim Pass A cannot personally inspect open rather than copying Pass B's conclusion. The passes are dialectical roles, not checklist buckets: Pass A asks whether the deck honors its approved system contract; Pass B asks whether the rendered slides actually land for the audience. A strong deck satisfies both: **contract without impact is inert; impact without contract is drift.**

**Pass A — System Contract / Constraint Integrity (contract guardian).** Proves the deck is allowed, coherent, and traceable before it is allowed to be impressive. It protects the approved design contract: style tokens, palette provenance, type system, semantic tags, asset/content provenance, anti-slop rules, and no ad-hoc drift across slides. Covers gate checks 1 (system consistency), 2 (color discipline), 3 (AI slop), and 5 (content discipline). Owns the **rule** side of the Rule → side effect matrix: whether each mechanical rule is actually applied and consistent. Inputs: all slide HTML source + the rendered PNGs + the validate summary + the approved style spec from `src/design-styles-data.js`.

**Pass B — Audience Impact / Expressive Readability (audience guardian).** Opens every rendered PNG and judges what the audience actually sees, feels, and understands. It protects each slide's one job, hierarchy, scanability, visual anchor, legibility, CJK line balance, and the compensation for visual side effects created by mechanical rules. Covers gate checks 4 (composition & hierarchy), 6 (typography & legibility), 6b (Korean/CJK word-break integrity — **both layers**), and 7 (Review Litmus). Owns the **side effect / compensation** side of the Rule → side effect matrix. Special weight on: **(Layer 1) mid-word Korean breaks** (a single 어절 split across two lines, e.g. `오케스트`/`레이션`) — fix with `word-break: keep-all`; **(Layer 2) ragged/lopsided line balance** introduced by keep-all — a near-full line followed by a stray-word line, or large per-line character-count differences within one block. For Layer 2, Pass B must **propose a concrete strategy** from the 6b ladder: insert `<br>` at the phrase boundary, apply `text-wrap: balance`, or **reduce the average characters per line** (narrow `max-width` / add breaks) so all lines are evened out — not merely flag it. Also weigh descender/baseline clipping, orphaned single-syllable tail lines, glyph drop (tofu), accent overuse, and element overlap. Inputs: the rendered PNGs (must be opened with an image-viewing tool) + the slide HTML + the validate summary.

Each pass returns: `VERDICT: PASS | REVISE | FAIL`, a confidence, a located findings list with one severity per finding (Critical/Major/Minor/Note), and a BLOCKING list.

For a `Proceed` gate, the CLI enforces the pass-report contract below. A short "looks good / Proceed" note is not enough and `slides-grab design-gate --verdict proceed` rejects it. Every pass report must reference the rendered PNG evidence files that `slides-grab design-gate` creates, for example `slide-01.png`, `slide-02.png`, etc. It must also include the current slide source fingerprint for every `slide-*.html` file in the reviewed deck (`slide-01.html: <sha256>`). If the slide source changes after the reports were written, the old reports cannot be reused.

**Pass A required report skeleton:**

```markdown
# Pass A: System Contract / Constraint Integrity

VERDICT: PASS
Confidence: High
Evidence: <slides-dir>/.slides-grab/gate-preview/slide-01.png, ...
Slide fingerprints: slide-01.html: <sha256>, ...
Unresolved Critical: 0
Blocking findings: None

## Checks
- [x] System consistency: PASS — <evidence>
- [x] Color discipline: PASS — <evidence>
- [x] AI slop tropes: PASS — <evidence>
- [x] Content discipline: PASS — <evidence>

## Findings
| Slide | Finding | Severity | Fix | Status |
|-------|---------|----------|-----|--------|
| slide-01 | No blocking findings | Note | None | tracked |
```

**Pass B required report skeleton:**

```markdown
# Pass B: Audience Impact / Expressive Readability

VERDICT: PASS
Confidence: High
Evidence: <slides-dir>/.slides-grab/gate-preview/slide-01.png, ...
Slide fingerprints: slide-01.html: <sha256>, ...
Unresolved Critical: 0
Blocking findings: None

## Checks
- [x] Composition & hierarchy: PASS — <evidence>
- [x] Typography & legibility: PASS — <evidence>
- [x] Korean/CJK word-break integrity: PASS — <evidence>
- [x] Review Litmus: PASS — <evidence>

## Findings
| Slide | Finding | Severity | Fix | Status |
|-------|---------|----------|-----|--------|
| slide-01 | No blocking findings | Note | None | tracked |
```

If either pass has an unresolved Critical finding, non-empty blocking findings, a non-`PASS` verdict, missing rendered evidence, missing current slide fingerprints, missing findings table, or missing required checks, fix the slides and run the full loop again. Do not call `slides-grab design-gate --verdict proceed` until both pass reports satisfy this structure.

> **If no image/vision-capable critic reviewer is available in the harness**, the gate cannot be completed honestly by the orchestrator alone. Do NOT declare `Proceed` from HTML-only or grep-only inspection, and do not let the slide-building agent impersonate an independent visual critic. Either (a) route Pass B to an image/vision-capable model/agent, or (b) hand the rendered `gate-preview/` PNGs to the user for the visual verdict. Code-level checks (palette grep, slop grep, font/typography floor, validate) may be reported as a **partial** result, but the visual checks (4, 6, 7) stay open until a real viewing happens. An open visual check is not a pass.

### Step 3 — Synthesize one verdict

Merge both passes into a single Design Gate Report (format below). Do not average the two reports and do not let one role erase the other. Per the severity rubric: any Critical from either pass blocks `Proceed`. Pass A can veto a choice that violates the approved contract, provenance, mechanical rules, or content truth. Pass B can veto a contract-compliant slide that still fails its audience job, rendered hierarchy, readability, CJK precision, or side-effect compensation. For non-Critical disagreement, use Review Litmus to decide the disposition: for **Major**, fix now or list it for user acceptance in the report; for **Minor**, fix now or track as design debt. Reconcile conflicts with the order in "Reconciliation". The synthesized report — not either pass alone, and not the validate numbers — is the gate's verdict.

Use the current runtime's native subagent/task mechanism when available, preferring dedicated critic roles backed by image/vision-capable models. If the runtime has no such mechanism, run Pass A and Pass B sequentially from this reference and keep their findings separate before synthesis; lack of independent image inspection still cannot produce `Proceed`.

### Step 4 — Fix and repeat until quality holds

If the verdict is `Revise and re-review`, fix the listed Critical findings, run `slides-grab validate` again, capture fresh PNGs, and dispatch both passes again. The next pass must inspect the updated render evidence from scratch; do not treat a previous pass as still valid after layout, color, type, imagery, or density changes.

If the verdict is `Rethink approach`, stop patching individual slides. Rewrite the visual thesis / system declaration, regenerate or substantially redesign the failing slide family, then restart the full gate loop from validation and fresh render evidence.

`Proceed` means the current loop has zero unresolved Critical findings **and** both adversarial roles have had a chance to challenge the current rendered state. It does not mean the first review was good enough; it means the latest reviewed state survived the loop.

---

## Evidence before shipping (the Iron Law)

Never report the gate as passed on belief. A pass requires having actually looked at the rendered output.

- [ ] The deck was inspected slide by slide against the checks above — name the slides, not "the deck looks fine."
- [ ] `slides-grab validate --slides-dir <path>` passed (the gate assumes technical validation is already green).
- [ ] For any imagery/diagram claim, the asset was confirmed to render (local asset present, not a broken reference).
- [ ] Every Critical and Major finding is listed with the specific slide and the specific fix.

"I believe the deck is well-designed" is not evidence. "I reviewed slides 01–12 against the seven checks; here are the findings" is.

---

## Design-debt log

Findings that are not fixed this round are not dropped — they are tracked.

Maintain `<slides-dir>/design-debt.md` with one row per deferred finding:

```markdown
# Design Debt — <deck name>

| Slide | Finding | Severity | Why deferred | Fix |
|-------|---------|----------|--------------|-----|
| slide-07 | Accent used on two competing elements | Minor | Cosmetic, low impact | Demote secondary to muted text |
```

Rules:
- Only **Minor** and **Note** items may land here as design debt. **Critical** findings must be resolved before the gate passes. **Major** findings are fixed before handoff when practical, or explicitly listed in the report for user acceptance; they are never silently dropped into debt.
- Debt accumulates across edit rounds; review it before the final approval so nothing important silently ages out.

---

## Gate report format

The gate always ends with a single structured report. Use exactly this shape:

```markdown
## Design Gate Report — <deck name>

**Slides reviewed:** slide-01 … slide-XX
**Technical validation:** pass (slides-grab validate)

### Findings
| Slide | Finding | Severity | Fix |
|-------|---------|----------|-----|
| slide-03 | Full-slide gradient as primary surface | Critical | Replace with flat surface token + real visual anchor |
| slide-08 | Hierarchy flat; two headings compete | Major | Promote one headline, demote the other to caption |
| slide-05 | Accent slightly off the palette | Minor | Snap to approved accent token (tracked as debt) |

### Verdict
[ Proceed / Revise and re-review / Rethink approach ]

**Reason:** <one or two sentences tied to the findings>
```

### Verdict meanings
- **Proceed** — zero unresolved Critical findings. Major findings, if any, are listed for the user to accept or fix. The deck may advance to user review / export.
- **Revise and re-review** — one or more Critical findings exist. Fix them, then run the gate again. Export stays blocked.
- **Rethink approach** — the deck's design direction itself is failing (system never cohered, repeated slop across many slides). Stop patching; reset the visual thesis / system declaration before regenerating.

---

## Reconciliation (when checks conflict)

If two checks pull in opposite directions on the same slide, treat the disagreement as useful signal: **contract without impact is inert; impact without contract is drift.** Resolve in this order:

1. **Legibility wins over aesthetics** — a beautiful slide nobody can read fails.
2. **Clarity wins over decoration** — the slide's one job beats any embellishment.
3. **Approved contract wins over local cleverness** — tokens, content truth, semantic rules, and the user's chosen style/brief govern.
4. **Review Litmus breaks Major/Minor ties** — prefer the option the audience grasps in 3–5 seconds with one idea and one anchor.
5. **Escalate to the user** if still unresolved — present the trade-off, let them decide.

---

## Rule → side effect → Visual QA compensation matrix

Every mechanical rule in this framework prevents one class of defect but can introduce its own visual side effect. The discipline is **two-layered**: a build-time rule prevents the defect, and the gate's Visual QA pass catches and compensates the side effect the rule creates. Check 6b (Korean word-break → ragged lines) is the canonical example; the full set is below.

The left half is mechanical (apply while building, or `slides-grab validate` enforces it). The right half is a **visual judgment** — it needs a reviewer reading the rendered PNG, because "does this look broken?" is not a grep. When Pass B finds a side effect, it must **propose the compensation**, not just flag it.

| # | Mechanical rule (prevents) | Side effect it can create | Visual QA compensation (in order) | Severity if unfixed |
|---|---|---|---|---|
| 1 | **`word-break: keep-all`** — no mid-word Korean break | **Ragged / lopsided lines**: one near-full line, next carries one stray word | `<br>` at phrase boundary → `text-wrap: balance` → reduce avg chars/line via narrower `max-width` → nudge letter-spacing/size (≥14pt) | Major on key slide/large heading; Minor in body |
| 2 | **Tight `line-height`** to fit one line | **Descender/받침 clipping**: 한글 받침(ㅂ,ㅍ,ㄱ) or latin g/y/p tails cut off; `text-clipped` may also trip | Raise `line-height` (≥1.3 display, ≥1.5 body) → add `padding-block` → if metric-driven, `ascent/descent-override` on the @font-face | Critical if glyphs actually clipped; Major if cramped |
| 3 | **`white-space: nowrap`** on indivisible units | **Horizontal overflow** past the 720pt frame (caught by `overflow-outside-frame`) | Confirm the unit truly cannot wrap; otherwise drop nowrap → shorten the token → `text-overflow: ellipsis` only if truncation is acceptable | Critical (frame overflow blocks export) |
| 4 | **Fixed pt type scale** (display/headline/body roles) | A long Korean title **overflows or force-shrinks** below the scale / the 14pt floor | Re-break the title with `<br>` → shorten copy (within outline; ask if meaning changes) → `clamp()` within the scale band — never below 14pt body / 10pt floor | Major (broken scale); Critical if pushed under 10pt |
| 5 | **`overflow: hidden`/`clip` on the frame OR any inner container** | **Silent clipping**: content is cut but looks intentional. Two sub-cases: (a) `validate` text-clipped catches a *text element* clipping itself; (b) **it does NOT catch a parent container (`overflow:hidden`/`clip`, e.g. a `border-radius` card or a `flex:1` column box) clipping its *children*** — those children are neither out-of-frame nor self-clipped, so both built-in checks miss them. This is the known gate blind spot. | **Detect mechanically AND visually.** Mechanical: for every element with computed `overflow` ∈ {hidden, clip} on either axis, flag when `scrollHeight > clientHeight + 1` or `scrollWidth > clientWidth + 1` (a child is being cut). Visual: read every PNG — a cut bottom line/edge confirms it. Fix: reduce content (tighter spacing/margins, smaller step) or enlarge the box so children fit; never leave hidden-but-clipped content. | Critical (a clipped slide fails its job) |
| 6 | **One accent color** (palette discipline) | **Flat hierarchy**: every emphasis is the same color, so primary vs secondary blurs | Differentiate by **size / weight / position / lightness step**, not a new hue; reserve the accent for the single most important mark per slide | Major if the eye cannot find the anchor |
| 7 | **Text only in semantic tags** (`p/h1-h6/li`) | **Micro-alignment friction**: cannot drop raw text in `<div>`/`<span>` for pixel placement | Wrap the text node in a `<p>` and position the wrapper with grid/flex/absolute; use `::before/::after` for purely decorative strings | Minor (mechanical, rarely visual) |
| 8 | **Fixed grid (e.g. 3-up)** for rhythm | **Lopsided last row**: item count (2,4,5) does not divide the grid → orphan cell / empty gap | `repeat(auto-fit, minmax(...))` → asymmetric 60/40 split → promote one item to a 2× hero so the gap reads as intentional | Major if it looks like a mistake; Minor if balanced |
| 9 | **CDN webfont (Pretendard)** | **Export font drop / layout shift**: PNG/PDF renders a fallback if the font is not ready → different metrics, re-wrapped lines | Wait on `document.fonts.ready` before capture (export tooling already does); confirm Korean glyphs render in the PNG, not tofu; self-host for offline/CI | Critical if glyphs drop (tofu); Major if metrics shifted wrapping |
| 10 | **No CSS gradients** (raster to PNG instead) | **Color banding / pixelation** in the rasterized gradient | Render at 2× scale → add subtle dither/noise overlay → widen the gradient's tonal range → keep it vector (SVG/`print` PDF) if the target allows | Minor unless banding is obviously visible |
| 11 | **Dark theme** (modern-dark etc.) | **Bright asset clash**: a light chart/logo/screenshot floats as a bright island; muted text drops below readable contrast | Restyle the asset to the dark surface (transparent bg, thin border) or invert it; verify body text clears WCAG AA (~4.5:1) against the dark bg | Critical if text unreadable; Major if asset clashes |
| 12 | **Left-align grid** (reading flow) | **Poster slides feel flat**: covers, one-line quotes, hero numbers want optical centering | Allow centering as a declared exception for cover/quote/hero slide types only; or use a golden-ratio (38/62) indent so left-aligned still reads centered | Minor (taste); Major if a hero slide reads weak |

**How the gate uses this matrix:** Pass A (**System Contract / Constraint Integrity**) owns the *rule* side: is the mechanical rule actually applied and consistent — palette, semantic tags, keep-all baseline, asset contract. Pass B (**Audience Impact / Expressive Readability**) owns the *side-effect / compensation* side: open the PNG and judge ragged lines, clipping, banding, flat hierarchy, asset clash, then propose the compensation. A row's side effect found on a key slide at the listed severity blocks `Proceed` if Critical, and is reported for the user if Major.

> This matrix is a living list. When a new mechanical rule is added to the framework, add its side effect and compensation here in the same turn — a rule without a documented side effect is an incomplete rule.

---

## Relationship to the other references

- `design-rules.md` — packaged hard rules (spec, assets, review loop). The gate assumes these are already satisfied.
- `beautiful-slide-defaults.md` — the source of the art-direction checks above; read it for the full rationale.
- `detailed-design-rules.md` — typography scale and color-usage detail behind checks 2 and 6.
- `design-system-full.md` — archived deep-dive for advanced pattern guidance.
