# Discern — the house-voice tripwire

This style encodes the mechanically checkable tells from the voice skill
(`project/skills/discern-voice-and-tone/SKILL.md`) so the gate's prose surfaces
catch them on every map page: banned words and phrases, contrast-frames,
self-narration, recap headings, em-dash chains, trailing-modifier fragments,
and manufactured drama.

Two rules of the pairing:

- **The skill is the canon; this style is the tripwire.** The skill's
  banned-words table is the source list — `tests/voice_vale_parity_test.ts`
  fails the gate when a word banned there has no matching pattern here, so the
  two surfaces move together. The style may encode *more* than the table (the
  skill's banned *moves*, e.g. contrast-frames); the table may never encode
  more than the style.
- **Severity policy: nothing here is an error.** Error-severity findings block
  the gate (`[checks.prose]`), and semantic voice judgment stays with the
  writer — a page can pass every rule here and still fail the skill. These
  rules warn (`suggestion` for the highest-noise words) so the density standard
  tracks them while humans keep the verdict.

Scope: the map's published and `_internal` tiers. `_adr/` is exempt in
`.vale.ini` — decision records are dated documents, never re-toned — and
`_private/` is never linted at all.

Quoting a banned phrase *about* itself (in the documenter brief, a template, or
a review note) is legitimate — put it in backticks; Vale does not lint code
spans.
