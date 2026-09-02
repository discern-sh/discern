# ADR 0363: The config template is generated from the schema and a prose registry

**Status**: accepted. Supersedes the template-generation boundary of [ADR 0026](0026-typed-config-schema.md); the typed schema and its generated satellites stand.

## Context

`discern.toml` is the first file a person reads after installing discern, and the file agents read most often. ADR 0026 made the Zod schema the single source for the config's shape, defaults, and per-key prose, generated the JSON Schema and the manual's config reference from it, and left the template hand-authored, bound to the schema by drift guards, on the argument that rendering it from one-line descriptions would flatten a curated document.

The hand-authored template grew to 730 lines, 589 of them comments, written by different sessions in different registers. It interleaved five kinds of content with no visual distinction: the values a project owns, per-key reference that restated the schema's descriptions by hand, teaching prose with no other home, two hundred lines of commented examples nobody validated, and tours of other verbs. The guards held presence, never prose, so the reference half drifted from the schema while still costing every reader the length. Every agent that read the config paid about 5,000 words of context for it.

## Decision

**The template is a committed codegen output rendered from two sources, each owning one kind of fact, and the depth it no longer carries is reachable by one command.**

- The Zod schema keeps every key's one-line description. A guard holds each rendered description to three wrapped lines; nuance moves to the registry or the manual.
- A config prose registry (`src/shared/config_prose.ts`) owns what a runtime schema should not carry: each documented unit's `what` and `why`, an optional detail table, worked examples, seeded entries, and the few per-key hints the scaffold shows. Each section's schema description is the registry's `what`, so the two cannot diverge. The registry's key set is held equal to the schema's documented units, so a new section cannot ship undocumented.
- The renderer (`src/shared/config_template_codegen.ts`) lays every unit out the same way: a ruled banner with What, Why, an optional detail table, Params for a named-table family, and a Help line naming `discern config explain <unit>`; then the section's keys under their descriptions, or the family's seeded entries and one commented example. Width is held to 79 columns after the visual-parent indent, and the depth indenter leaves the output unchanged. The indenter counts only ancestor tables represented in the document, so an implicit dotted namespace adds no visual level; it places a commented-out header or entry where the live line would sit, so an example nests with its visible parent.
- The manual's config reference renders the same registry prose, and `discern config explain` joins it with the schema's reference facts and the project's current value, for a section, a family, a key, a knob, or a named entry.
- Every example and seed validates against the live schema in the gate. The template is enrolled in the canonical-sets registry, the codegen sync test, and the repository's own `[generated.codegen]` group.
- Setup substitution and upgrade reconciliation are unchanged: the renderer emits the same `{{tokens}}` and the same ruled banners, so managed banners reach existing installs through `discern upgrade` as before. Fixed-key comments remain project-owned and do not refresh.

## Consequences

- The scaffolded file reads top to bottom in one sitting: about 560 lines, one voice, every section in the same shape. Changing the prose is a registry edit; changing the layout is a renderer edit that every section receives at once.
- A new config key needs its schema field and description; a new section also needs a registry entry. The gate names the missing piece.
- The 79-column budget is a constraint on prose: a description or detail line that overruns fails codegen with the line named. Longer teaching belongs in `why`, the manual, or `config explain`.
- Existing installs receive the new banners on upgrade and keep their old key comments. Before launch that population is the maintainer's own projects; a later mechanism for refreshing template-authored key comments would need a record of what the template once said.
- Two scaffold tokens no template consumed, `scopes_web` and `scopes_previewable`, are retired.

## Alternatives considered

- **Rewrite the template by hand under a style contract and add guards for voice and length.** Rejected: it fixes the file once and leaves the per-key prose in two places, and a guard can hold word count and voice but not structure, so the layout drifts again as sessions touch sections.
- **Push the teaching prose and examples into the runtime schema's `describe()`.** Rejected: the objection in ADR 0026 stands; a runtime schema is the wrong home for paragraphs and presentation, and editor hover text wants one line.
- **Generate a minimal template and rely on the manual alone.** Rejected: the file is the human's most likely touch-point with discern's range, so each section keeps its why and one example in the file.
