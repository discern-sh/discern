# ADR 0235: Plain renderings live on the glossary entry

**Status**: accepted. Amends [ADR 0228](0228-the-feature-canon-carries-a-plain-language-register.md): it supersedes that record's one decision to keep the plain lexicon outside the glossary registry, and leaves every other part of it standing.

## Context

[ADR 0228](0228-the-feature-canon-carries-a-plain-language-register.md) gave every glossary term a plain-register rendering and kept those renderings in their own table: `PLAIN_LEXICON` in the feature registry, keyed by term name, held in bijection with `GLOSSARY` by a runtime test. The reasoning was separation — the glossary defines terms for the technical manual's readers, while the lexicon is a rendering policy for one register.

Living with the split showed the separation was thinner than it looked. The bijection guard already forced every glossary change through the feature registry, so the two files were coupled either way — the coupling just ran through a test instead of the compiler, and a mistyped key or a forgotten entry surfaced at test time rather than at the typecheck. Meanwhile ADR 0228's own strongest move points the other way: it made the plain account a *required field* on `FeatureNode` precisely so a node cannot enter the canon without its plain reading. The term-level rendering deserved the same mechanism.

## Decision

**Each glossary entry carries its plain-register rendering as a required `plain` field — translated (`phrase`, with the optional `match` policy), or kept (`keep`, the reason it is already plain). The term and its translation are one record.**

- The register guard's enrolment contract moves into the type system: a new term cannot compile without its rendering. A type-level test pins the field's required-ness so it cannot quietly become optional, and a substance sweep holds every phrase and reason non-empty. The jargon scan, matcher derivations, and positive controls stand unchanged.
- `plainPolicedTerms()` derives the policed set from `GLOSSARY` directly. `PLAIN_GENERAL_JARGON` stays in the feature registry: it translates general software vocabulary (commit, branch, database) the glossary does not own, and it enrolls nothing.
- `FeatureNode.plain` is untouched. Node accounts are complete feature narratives; the glossary field is vocabulary metadata. The two remain different things.
- Nothing published changes. The generated glossary page, its hover summaries and search aliases, and both feature-canon pages are byte-identical — the renderings remain internal data, and publishing them stays a separate decision on ADR 0228's terms.
- Kept terms carry no `phrase`. A kept rendering that nothing reads would be write-only data; the field can arrive with the first consumer that wants it.
- Helpers that read a slice of an entry (`glossarySummary`, the enrolment test's naming predicate) declare that slice in their signatures, so a fixture supplies only what its subject reads.

## Consequences

- Deciding a term's vocabulary and its plain rendering is one edit in one file, and forgetting the rendering is a compile error instead of a test failure.
- The bijection test disappears; the register test now guards the type-level requirement, the substance of each rendering, and the jargon scan.
- Test fixtures that build full glossary entries pay one extra line each. Fixtures feeding narrow helpers pay nothing.
- The wave that adds the desk-tips glossary term inherits the simpler shape: one entry, rendering inline.

## Alternatives considered

- **Keep the two-table shape and the bijection test.** Rejected: the test is a weaker mechanism doing a job the compiler can do, and the separation it preserved was already crossed by the guard itself on every term change.
- **A required `phrase` on kept terms too**, to encode typography such as the plain register's "Discern". Deferred: no renderer reads a kept phrase today, and the typography rule is recorded prose. Add the field with its first consumer.
- **Publishing the renderings on the glossary page or its hover cards.** Out of scope and unchanged: `_internal` data stays internal, per ADR 0228's publication reasoning.
