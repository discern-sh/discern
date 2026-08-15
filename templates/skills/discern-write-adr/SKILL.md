---
name: discern-write-adr
description: Guide writing an Architecture Decision Record (ADR) — a short doc capturing a significant decision and why. Use when the user says "write an ADR", "record this decision", "should this be an ADR?", when a decision overrides a design principle, or when a hard-to-reverse, surprising trade-off has just been made and deserves a written record. Bundled with discern.
metadata:
  author: "discern | https://discern.sh"
  version: "1.0"
---

# Write an ADR

An Architecture Decision Record captures a significant decision, the context that forced it, and the reasoning — so a future reader doesn't look at the code and wonder _"why on earth was it done this way?"_

The project's ADRs live in the configured documentation tree, at `{{map_dir}}_adr/`. **The canonical format lives in `{{map_dir}}_adr/README.md`.** Read it before drafting. This skill does not restate the format — it walks you through _applying_ it. There is one home for "how we write ADRs", and that's the README; this skill points there on purpose.

---

## 0. Ensure the ADR home exists

ADRs live in `{{map_dir}}_adr/`. If that directory does not exist, copy this skill's `skeleton/docs/_adr/` directory there before writing. The skeleton contains the canonical `README.md` format guide, `0000-template.md`, and the seeded adoption record `0001-adopt-discern.md`.

Complete the seeded record before the ADR you came to write. Replace its `setup fills this` markers with the project's reason for adopting discern, the jobs its Gate runs, and project-specific consequences. Keep the provenance sentence. It identifies discern as the source of the seed and the configuring agent as the writer of its project-specific material. If the ADR directory already exists, skip this step.

---

## 1. Decide whether it's actually an ADR

Per `{{map_dir}}_adr/README.md`, write one only when **all three** are true:

1. **Hard to reverse** — changing your mind later is costly.
2. **Surprising without context** — a future reader will wonder why.
3. **A real trade-off** — there were genuine alternatives and you picked one for specific reasons.

If any fails, say so and stop — an easy-to-reverse, unsurprising, or alternative-free decision is not worth an ADR. The one case to _always_ consider: a decision that **overrides a design principle** under `{{map_dir}}00-orientation/design-principles.md`. The principles are hard requirements; bending one deliberately is exactly what an ADR is for.

When in doubt, ask the user the three questions above rather than guessing.

---

## 2. Pick the next number

List `{{map_dir}}_adr/`, find the highest existing `NNNN-…` number, and add one (zero-padded, four digits). Numbers are continuous and never reused; `0000-template.md` is only the template, and `0001` is usually the seeded record of adopting the practice. Choose a short kebab-case slug that names the **decision**, not the problem — e.g. `0007-event-sourced-write-model.md`.

Your tree shows only landed records, so another in-flight branch may have claimed the same next number. `discern status` warns when that happens, and the gate refuses a duplicated number once both records reach one tree — whoever lands second moves to the next free number, so don't fight for a specific one.

---

## 3. Draft from the template

Copy `{{map_dir}}_adr/0000-template.md` to `{{map_dir}}_adr/NNNN-slug.md` and fill it:

- **Title** states the decision (`# ADR NNNN: <decision>`), not the question.
- **Status** — usually `accepted` for a decision being recorded as it's made; `proposed` if it's still under discussion.
- **Context** — the forces: the problem, the constraints, what was true before, what made a decision necessary now. Usually the longest section; give enough that someone who wasn't there feels the pressure.
- **Decision** — what you decided, present tense, plainly. Include the explicit *no*s.
- **Consequences** — what follows, good and bad. Be honest about the costs.
- **Alternatives considered** — only if the rejection is non-obvious; otherwise drop the heading.

Keep it as short as the decision allows — a paragraph that names the decision and why beats an over-filled form. Write in the same present-tense, no-marketing voice as the rest of the configured documentation tree.

---

## 4. Link it from what it governs

An ADR nobody can find from the code it governs is half-wasted. After writing:

- If it **overrides or grounds a design principle**, link it from that principle in `{{map_dir}}00-orientation/design-principles.md`.
- If it explains a subsystem's behaviour, link it from that subtree's doc.
- If it **supersedes** an earlier ADR, set the older one's status to `superseded by ADR-NNNN` and link forward — leave the old file in place as the record of what was once true.
- If the decision changes something the docs describe, update those docs too (docs say what _is_; the ADR says _why_).
- Run `discern refresh`. When `{{map_dir}}_adr/README.md` carries the maintained-index markers, refresh rewrites the record list between them to include the new record — commit the rewritten README with the record. Never edit the list by hand; the gate refuses an index that has drifted from the files.

---

## Done when

The ADR exists at `{{map_dir}}_adr/NNNN-slug.md`, follows the canonical format, is linked from the principle or doc it relates to (and any superseded ADR is marked), and the maintained index in `{{map_dir}}_adr/README.md` — when the project carries one — lists it after a `discern refresh`.
