# Discern — the house-voice tripwire

This style encodes the mechanically checkable tells from the voice skill (`project/skills/discern-voice-and-tone/SKILL.md`) so the gate's prose surfaces catch them on every map page: banned words and phrases, contrast-frames, self-narration, recap headings, em-dash chains, trailing-modifier fragments, and manufactured drama.

Two rules of the pairing:

- **The skill is the canon; this style is the tripwire.** The skill's banned-words table is the source list — `tests/voice_vale_parity_test.ts` fails the gate when a word banned there has no matching pattern here, so the two surfaces move together. The style may encode _more_ than the table (the skill's banned _moves_, e.g. contrast-frames); the table may never encode more than the style.
- **Severity policy: split by legitimacy.** A rule whose pattern has zero legitimate uses (self-narration, recap headings, hedging stacks, vendor-speak, banned jargon) is an `error`: `[checks.prose]` blocks the gate and the diagnostic names the file and line. A rule that needs the writer's judgment (contrast-frames carry a one-per-page budget, em-dash chains need a rebuild, a counted set is occasionally the fact) stays a `warning` — tracked by the density standard and surfaced on demand by `discern script prose-page`. Semantic voice judgment stays with the writer: a page can pass every rule here and still fail the skill.

Scope: the map's published and `_internal` tiers. `_adr/` is exempt in `.vale.ini` — decision records are dated documents, never re-toned — and `_private/` is never linted at all.

Quoting a banned phrase _about_ itself (in the documenter brief, a template, or a review note) is legitimate — put it in backticks; Vale does not lint code spans.
