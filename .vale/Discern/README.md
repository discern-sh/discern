# Discern — the house-voice tripwire

This style encodes the mechanically checkable tells from the voice skill (`project/skills/discern-voice-and-tone/SKILL.md`) so the prose check catches them on every map page: banned words and phrases, contrast-frames, self-narration, recap headings, em-dash chains, trailing-modifier fragments, and manufactured drama.

Two rules of the pairing:

- **The skill is the canon; this style is the tripwire.** The skill's banned-words table is the source list. `tests/voice_vale_parity_test.ts` fails the gate when a word banned there has no matching pattern here, so the two copies move together. The style may encode _more_ than the table (the skill's banned _moves_, e.g. contrast-frames); the table may not encode more than the style.
- **Severity policy: split by legitimacy.** A rule whose pattern has zero legitimate uses (self-narration, recap headings, hedging stacks, vendor-speak, banned jargon) is an `error`: `[checks.prose]` blocks the gate and the diagnostic names the file and line. `MaturedSeasoning` applies that policy to `silently`, `quietly`, `deliberate(ly)`, `honest(y/ly)`, `exactly`, and `ride(s) along`. `Seasoning` keeps `the one <noun>` and `the whole <noun>` at `warning` because emphasis can occasionally carry the fact. Other judgment rules, including contrast-frames, em-dash chains, and counted sets, also stay warnings. The density standard tracks them, and `discern script prose-page` displays them. Semantic voice judgment stays with the writer: a page can pass every rule here and still fail the skill.

Scope: the map's published and `_internal` tiers. `.vale.ini` exempts `_adr/` because decision records are dated documents that stay unchanged. `_private/` sits outside the linted corpus.

Quoting a banned phrase _about_ itself (in the documenter brief, a template, or a review note) is legitimate. Put it in backticks; Vale does not lint code spans.
