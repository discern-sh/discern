---
name: discern-write-adr
description: Guide writing an Architecture Decision Record (ADR) — a short doc capturing a significant decision and why. Use when the user says "write an ADR", "record this decision", "should this be an ADR?", when a decision overrides a design principle, or when a hard-to-reverse, surprising trade-off has just been made and deserves a written record. Bundled with discern.
metadata:
  author: "discern | https://discern.sh"
  version: "1.0"
---

# Write an ADR

An Architecture Decision Record captures a significant decision, the context that forced it, and the reasoning — so a future reader doesn't look at the code and wonder _"why on earth was it done this way?"_

The project's ADRs live in the configured map, at `{{map_dir}}_adr/`. **The canonical format lives in `{{map_dir}}_adr/README.md`.** Read it before drafting. This skill does not restate the format — it walks you through _applying_ it. There is one home for "how we write ADRs", and that's the README; this skill points there on purpose.

---

## 0. Ensure the ADR home exists

ADRs live in `{{map_dir}}_adr/`. If that directory does not exist, copy this skill's `skeleton/map/_adr/` directory there before writing. The skeleton contains the canonical `README.md` format guide, `0000-template.md`, and the seeded adoption record `0001-adopt-discern.md`.

Complete the seeded record before the ADR you came to write. Replace its `setup fills this` markers with the project's reason for adopting discern, the jobs its gate runs, and project-specific consequences. Keep the provenance sentence. It identifies discern as the source of the seed and the configuring agent as the writer of its project-specific material. If the ADR directory already exists, skip this step.

---

## 1. Decide whether it's actually an ADR

Use `{{map_dir}}_adr/README.md` to judge whether future work needs the decision's reasoning: constraints, rejected alternatives, or consequences that would be costly to rediscover. Hard-to-reverse choices, surprising designs, and important trade-offs are strong signals, not three mandatory tests. A routine implementation detail usually needs no record.

For example, an intermediate file may look redundant but preserve recovery after a failed write. Record why the simpler alternative was rejected so a future agent does not remove the safeguard while simplifying the code.

Find the project's agreed principles through the map rather than assuming a folder name. A decision that conflicts with a requirement needs the owner's decision. An ADR records an approved exception or a proposal; it does not authorize the exception. Use the conversation's existing decisions and ask only when material intent or authority is missing.

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

Keep it as short as the decision allows — a paragraph that names the decision and why beats an over-filled form. Write in the same present-tense, no-marketing voice as the rest of the configured map.

---

## 4. Link it from what it governs

An ADR nobody can find from the code it governs is half-wasted. After writing:

- If it **overrides or grounds a design principle**, link it from the principle’s existing authority.
- If it explains a subsystem's behavior, link it from that subtree's doc.
- If it **supersedes** an earlier ADR, set the older one's status to `superseded by ADR-NNNN` and link forward — leave the old file in place as the record of what was once true.
- If the decision changes something the map describes, update those pages too (the map says what _is_; the ADR says _why_).
- Run `discern refresh`. When `{{map_dir}}_adr/README.md` carries the maintained-index markers, refresh rewrites the record list between them to include the new record — commit the rewritten README with the record. Never edit the list by hand; the gate refuses an index that has drifted from the files.

---

## Done when

The ADR exists at `{{map_dir}}_adr/NNNN-slug.md`, follows the canonical format, is linked from the principle or doc it relates to (and any superseded ADR is marked), and the maintained index in `{{map_dir}}_adr/README.md` — when the project carries one — lists it after a `discern refresh`.
