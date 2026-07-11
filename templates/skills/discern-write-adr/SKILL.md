---
name: discern-write-adr
description: Guide writing an Architecture Decision Record (ADR) — a short doc capturing a significant decision and why. Use when the user says "write an ADR", "record this decision", "should this be an ADR?", when a decision overrides a design principle, or when a hard-to-reverse, surprising trade-off has just been made and deserves a written record. Bundled with discern.
metadata:
  author: "discern | https://discern.sh"
  version: "1.0"
---

# Write an ADR

An Architecture Decision Record captures a significant decision, the context that forced it, and the reasoning — so a future reader doesn't look at the code and wonder *"why on earth was it done this way?"*

The project's ADRs live in the configured documentation tree, at
`{{map_dir}}_adr/`. **The canonical format lives in
`{{map_dir}}_adr/README.md`.** Read it before drafting. This skill does not
restate the format — it walks you through *applying* it. There is one home for
"how we write ADRs", and that's the README; this skill points there on purpose.

---

## 0. Ensure the ADR home exists

ADRs live in `{{map_dir}}_adr/`. If that directory doesn't exist yet — a
project that hasn't run `discern setup` — create it from this skill's skeleton
before writing: copy this skill's own `skeleton/docs/_adr/` directory (the
canonical `README.md` format guide and `0000-template.md`) to
`{{map_dir}}_adr/`. If it already exists, skip this.

---

## 1. Decide whether it's actually an ADR

Per `{{map_dir}}_adr/README.md`, write one only when **all three** are true:

1. **Hard to reverse** — changing your mind later is costly.
2. **Surprising without context** — a future reader will wonder why.
3. **A real trade-off** — there were genuine alternatives and you picked one for specific reasons.

If any fails, say so and stop — an easy-to-reverse, unsurprising, or alternative-free decision is not worth an ADR. The one case to *always* consider: a decision that **overrides a design principle** under `{{map_dir}}00-orientation/design-principles.md`. The principles are hard requirements; bending one deliberately is exactly what an ADR is for.

When in doubt, ask the user the three questions above rather than guessing.

---

## 2. Pick the next number

List `{{map_dir}}_adr/`, find the highest existing `NNNN-…` number, and add one (zero-padded, four digits). Numbers are continuous and never reused; `0000-template.md` is the template, so the first real ADR is `0001`. Choose a short kebab-case slug that names the **decision**, not the problem — e.g. `0007-event-sourced-write-model.md`.

---

## 3. Draft from the template

Copy `{{map_dir}}_adr/0000-template.md` to
`{{map_dir}}_adr/NNNN-slug.md` and fill it:

- **Title** states the decision (`# ADR NNNN: <decision>`), not the question.
- **Status** — usually `accepted` for a decision being recorded as it's made; `proposed` if it's still under discussion.
- **Context** — the forces: the problem, the constraints, what was true before, what made a decision necessary now. Usually the longest section; give enough that someone who wasn't there feels the pressure.
- **Decision** — what you decided, present tense, plainly. Include the explicit *no*s.
- **Consequences** — what follows, good and bad. Be honest about the costs.
- **Alternatives considered** — only if the rejection is non-obvious; otherwise drop the heading.

Keep it as short as the decision allows — a paragraph that names the decision
and why beats an over-filled form. Write in the same present-tense, no-marketing
voice as the rest of the configured documentation tree.

---

## 4. Link it from what it governs

An ADR nobody can find from the code it governs is half-wasted. After writing:

- If it **overrides or grounds a design principle**, link it from that principle in `{{map_dir}}00-orientation/design-principles.md`.
- If it explains a subsystem's behaviour, link it from that subtree's doc.
- If it **supersedes** an earlier ADR, set the older one's status to `superseded by ADR-NNNN` and link forward — leave the old file in place as the record of what was once true.
- If the decision changes something the docs describe, update those docs too (docs say what *is*; the ADR says *why*).

---

## Done when

The ADR exists at `{{map_dir}}_adr/NNNN-slug.md`, follows the canonical format,
and is linked from the principle or doc it relates to (and any superseded ADR
is marked).
