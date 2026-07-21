# ADR 0171: Glossary display and matching are separate registry data

**Status**: accepted; extends the term registry ([ADR 0164](0164-glossary-compiles-from-a-term-registry.md)), its vocabulary guards ([ADR 0167](0167-term-registry-polices-the-vocabulary.md)), and the launch canon ([ADR 0169](0169-the-launch-glossary-canon.md)).

## Context

ADR 0164 rejected structured fields beyond a term and definition because no consumer needed them. The web manual now supplies that consumer. Its hover card needs one sentence, while the glossary page needs the complete paragraph. Its matcher also derived phrases from display terms, so ordinary prose such as “accept the suggestion,” “update the docs,” testing patterns, or a design-system preset acquired unrelated glossary cards. This record therefore reverses ADR 0164's rejection only for the summary and matching fields the live consumer needs.

The canon remains settled by ADR 0169. This decision changes how the site presents and recognizes an entry without changing the entry's term, definition, retired synonyms, search aliases, enrolment, or drift rules.

## Decision

**A glossary entry carries separate summary and matching controls beside its canonical term and full definition.**

- `summary` supplies the hover card's single sentence. It defaults to the definition's first sentence; an explicit value exists only when that default is too dense for the card.
- `matches` supplies the phrases eligible for automatic linking. It defaults to the canonical term, and an empty list disables automatic matching for that entry.
- A single-word entry that the live manual also uses with an ordinary meaning matches only its command form. The audited overrides are `discern accept`, `discern update`, `discern patterns`, and `discern preset`. Distinctive terms retain their canonical term as the default match.
- The site validates that one matching phrase belongs to one entry, orders phrases longest first before compiling the pattern, and records one card per entry on each page. `Gate job` therefore wins over `Gate`, while a genuinely duplicated phrase fails the build.
- Vocabulary usage measurement continues to recognize canonical terms and glossary links directly. Hover matching does not decide whether a term is live or redefined.

The registry gains no taxonomy field such as `kind`. No current renderer or guard consumes one, so ADR 0164's minimalism still governs beyond the 2 fields with present consumers. The terminal manual continues to render the full Markdown and does not gain hover behavior.

## Consequences

- Hover cards teach one sentence and link to the full glossary entry. A matching phrase may differ from the canonical heading shown inside the card.
- Ordinary command words stop acquiring unrelated links. Adding another phrase is a registry decision checked for ambiguity and overlap.
- Definitions remain the canon and generated glossary source. Summary copy can diverge, so explicit summaries carry an authoring cost and stay exceptional.
- Site tests hold the code-form overrides, opt-out behavior, longest-first ordering, ambiguity failure, and a rendered-page example. Vocabulary-signal tests hold their independence from matching controls.

## Alternatives considered

- **Keep using the full definition and canonical term for both jobs.** Rejected because the live consumer now demonstrates both failures ADR 0164 said would justify structure: dense cards and false matches.
- **Add a `kind` field and derive matching policy from a taxonomy.** Rejected because no current consumer needs the categories, and a category would answer the matching decision less precisely than the phrases themselves.
- **Infer ordinary uses from capitalization or surrounding grammar.** Rejected because headings, sentence starts, commands, and prose reuse the same spelling. An explicit phrase list is reviewable and deterministic.
