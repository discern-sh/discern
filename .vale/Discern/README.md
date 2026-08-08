# Discern — the house-voice tripwire

This style encodes the mechanically checkable tells from the voice canon (`BANNED_WORDS` and `BANNED_MOVES` in `scripts/brand/voice.ts`, rendered into the generated voice skills) so the prose check catches them on every map page: banned words and phrases, contrast-frames, self-narration, recap headings, em-dash chains, trailing-modifier fragments, and manufactured drama.

Two rules of the pairing:

- **The canon is the source; this style is the tripwire.** The voice registry's banned canon is the source list. `tests/voice_vale_parity_test.ts` fails the gate when a phrase the canon declares has no matching pattern here, so the two copies move together. The style may encode _more_ than the canon (retained tells such as recap headings and rhetorical suspense); the canon may not declare a phrase the style cannot see.
- **Severity policy: split by legitimacy.** A rule whose pattern has zero legitimate uses (self-narration, recap headings, hedging stacks, vendor-speak, banned jargon) is an `error`: `[checks.prose]` blocks the gate and the diagnostic names the file and line. `MaturedSeasoning` applies that policy to `silently`, `quietly`, `deliberate(ly)`, `honest(y/ly)`, `exactly`, and `ride(s) along`. `Seasoning` keeps `the one <noun>` and `the whole <noun>` at `warning` because emphasis can occasionally carry the fact. Other judgment rules, including contrast-frames, em-dash chains, and counted sets, also stay warnings. The density standard tracks them, and `discern script prose-page` displays them. Semantic voice judgment stays with the writer: a page can pass every rule here and still fail the voice skills.

Scope: the map's published and `_internal` tiers. `.vale.ini` exempts `_adr/` because decision records are dated documents that stay unchanged. `_private/` sits outside the linted corpus.

Quoting a banned phrase _about_ itself (in the documenter brief, a template, or a review note) is legitimate. Put it in backticks; Vale does not lint code spans.
