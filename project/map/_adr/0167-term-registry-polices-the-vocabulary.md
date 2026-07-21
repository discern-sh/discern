# ADR 0167: The term registry polices the vocabulary

**Status**: accepted

## Context

[ADR 0164](0164-glossary-compiles-from-a-term-registry.md) made the glossary compile from a term registry and predicted follow-on surfaces: once the canon is enumerable, vocabulary checks stop needing hand-copied lists. Three such checks were either hand-rolled or missing:

- Retired wording was policed by bespoke regular expressions in `tests/adr_vocab_guard_test.ts` — one per phrase ("harness", "integration branch"), each with its own scan surfaces and exception carve-outs. Retiring a phrase meant authoring a new guard, and the two existing scans had quietly diverged (only one covered template fixtures and skills).
- Nothing forced a new closed-set member into the vocabulary. The Capability and Stage entries interpolate their sets ([ADR 0164](0164-glossary-compiles-from-a-term-registry.md)), but a new top-level verb could ship with the glossary silently lagging the engine.
- Nothing measured whether the canon is _used_: a term no page references, or a page restating a definition instead of linking it, went unnoticed until a reader tripped over the divergence.

## Decision

**The registry is the single source of vocabulary law: retired synonyms are entry data, closed-set membership is checked against it, and usage debt is a standard.**

- **Drift.** An entry declares `retired` synonyms — the phrase, an optional inflection pattern, and `allowed` paths each carrying its reason. One parameterized test (`tests/vocab_drift_test.ts`) polices every declared phrase across the live prose surfaces: `src/` string literals, templates and their fixtures, skills, project scripts, the map, mockups, and the root prose files. The generated glossary page (where retired phrases appear as search aliases, so the old name finds the new) and the map's dated records (`_adr/`, `_private/`) are structurally exempt. The hand-rolled expressions collapsed into registry data; `adr_vocab_guard_test.ts` returns to the ADR-citation law only.
- **Enrolment.** The registry's `DELIBERATELY_ABSENT` table records closed-set members kept out of the glossary, each with the reason. `tests/glossary_enrolment_test.ts` — the [ADR 0051](0051-canonical-set-parity.md) family — holds every capability, stage, and top-level verb to exactly one of: named by the glossary (a term, or a mention in backticks; interpolated sets auto-enrol) or recorded absent. The sets are read from `KNOWN_CAPABILITIES`, `STAGES`, and `KNOWN_VERBS`, so a new member enrols in the check the moment it exists, and a record whose member the glossary later names fails as stale.
- **Usage.** `scripts/vocab_signals_lib.ts` measures the map against the registry: dead terms (no live page names or links the term) and redefinitions (a bold-faced `**term** — …` restatement outside the glossary). Links are read with the map-integrity guard's extractor and anchors with the shared renderer, so a link counts exactly when it resolves. The sum is `vocabulary_debt`, held at zero by `[standards.vocabulary]`: a term added to the registry must be used by a page in the same change, a second definition of a term fails the gate, and bold emphasis stays sanctioned when it carries the glossary link (`**[term](…)**`).

## Consequences

- Retiring a phrase is one registry edit; the scan, the search aliases, and the exception list follow from the data. A liveness check fails an `allowed` path that no longer exists, and a self-match control fails a pattern that no longer matches its own phrase.
- A new verb, capability, or stage fails the gate until someone decides its vocabulary — an entry, a mention, or a reasoned absence. Six utility and advisory verbs are recorded absent today; enrolment also pushed three genuine improvements into the Standard, Skill, and Worktree resource definitions.
- The pre-existing usage debt (one dead term, two redefinitions) was fixed rather than folded into the limit, so the ceiling starts — and stays — at zero.
- The README's single searchable "quality harness" category use survives as a companion assertion beside the drift scan, keyed to the registry's harness synonym rather than its own regex.

## Alternatives considered

- **Keep a hand-rolled regular expression per retired phrase** — every future retirement re-authors a scan and its exceptions, and the surfaces drift apart again. Rejected.
- **Give every verb a glossary entry instead of an absence table** — pads the canon with entries that define nothing beyond the verb's own name; the glossary is a term canon, not a second CLI reference. The absence table forces the same decision without the padding. Rejected.
- **A hard test instead of a standard for usage debt** — at a limit of zero the two enforce identically, but the standard keeps the versus-`main` comparison, `inputs` replay, and the `--pin` workflow should an owner ever accept nonzero debt while paying it down. Rejected in favour of the standard.
