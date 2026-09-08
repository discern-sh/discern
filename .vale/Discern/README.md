# Discern — the house-voice tripwire

This style detects wording patterns from the voice canon (`BANNED_WORDS` and `BANNED_MOVES` in `scripts/brand/voice.ts`, rendered into the voice skills). It covers phrases, contrasts, self-narration, recap headings, em-dash usage, and trailing modifiers. A match can identify a blocking defect or a question for the writer.

- **The canon states the policy; the style detects the pattern.** `tests/voice_vale_parity_test.ts` proves that each declared phrase has a working detector and that quoted code examples remain legal. Semantic judgments stay with the writer: a page can pass the mechanical checks and still need revision.
- **The shared selector decides what blocks.** `selectProseGateAlerts` in `scripts/prose_lib.ts` keeps error-severity findings and other Discern alerts blocking, except the exact advisory rules named by `EDITORIAL_PROSE_RULES`. Unlisted house and register rules retain their enforcement. Severity alone does not make a Discern warning advisory.
- **Selected alerts remain visible for editorial review.** Contrasts, contextual qualifiers, selected padding patterns, and paired em dashes can carry useful meaning. Try a clearer direct explanation before retaining a flagged phrase. The selector's registry records each exception and its reason; full review output still includes these findings. The prose-density measurement continues to measure its configured corpus and alerts.

`Numeration` and `Seasoning` remain blocking. Remove counted list introductions and stock singular or scope emphasis. Changing a count to digits or substituting another empty intensifier does not resolve the defect.

`ContextualQualifiers` reviews `silently`, `quietly`, `deliberate(ly)`, `honest(y/ly)`, and `exactly`. `MaturedSeasoning` retains the blocking `ride(s) along` ban. `Padding` reviews its selected qualifiers; `Filler` keeps unrelated bans such as `simply` and `obviously`.

Scope: the map's published and `_internal` tiers, plus the manual's staged product tier. `.vale.ini` exempts `_adr/` from the house style because decision records are dated documents. `_private/` stays outside the linted corpus.

The generated sibling styles `DiscernBrand/`, `DiscernProduct/`, and `DiscernAgent/` compile from `scripts/brand/vale.ts`. Change that registry and regenerate; do not edit their output files. `.vale.ini` selects the relevant registers, and `tests/brand_vale_codegen_test.ts` checks their generated coverage.

Use `discern scripts prose-page <page…>` for full map-page findings and `scripts/manual_prose_check.ts --review` for full manual findings. Fix blocking defects, consider each editorial alert, and leave useful wording intact. Quoted examples of a policed phrase belong in code spans when the phrase itself is the subject; backticks are not a way to conceal ordinary prose from review.

Canonical casing findings are checked against the shared Markdown prose projection in `scripts/markdown_prose.ts`. The caller in `scripts/vale_lib.ts` retains a match only when its words occur within the same source prose segment. Linked-title starts keep their casing; a wrong capital later in the label still fails. Other rules and findings whose source cannot be verified remain unchanged.
