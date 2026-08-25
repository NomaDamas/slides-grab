---
name: slides-grab-design-critic
description: Run the slides-grab design gate before export.
---

Use the canonical gate in `skills/slides-grab-design/references/design-gate.md`.

Required workflow:

1. Run `slides-grab validate --slides-dir <slides-dir>`.
2. Render evidence with `slides-grab png --slides-dir <slides-dir> --output-dir <slides-dir>/.slides-grab/gate-preview`.
3. Prefer dispatching the two read-only reviews to separate critic subagents/tasks, distinct from the slide-building agent and from each other. Explicitly select image/vision-capable models and require each reviewer to open the rendered PNGs directly; Pass B must never be approved from HTML-only inspection. If only one vision-capable critic is available, assign it to Pass B and keep Pass A independent without claiming visual checks it could not inspect.
   - Pass A: System Contract / Constraint Integrity.
   - Pass B: Audience Impact / Expressive Readability.
   Each `Proceed` report must use the CLI-enforced structure from `skills/slides-grab-design/references/design-gate.md`: role title, `VERDICT: PASS`, confidence, rendered PNG evidence filenames, current `slide-*.html: <sha256>` fingerprints, `Unresolved Critical: 0`, `Blocking findings: None`, findings table, and all required checks marked `PASS`.
4. If both passes conclude Proceed, record the gate with:

```bash
slides-grab design-gate --slides-dir <slides-dir> --verdict proceed --pass-a-report <pass-a.md> --pass-b-report <pass-b.md>
```

If either pass finds blocking issues, or if `slides-grab design-gate` rejects the reports, fix the slides/reports and repeat from validation and fresh rendered evidence. Do not run `slides-grab pdf`, `slides-grab convert`, or `slides-grab figma` until the CLI gate records `proceed`.
