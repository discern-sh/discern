# ADR 0373: Proof alone carries product-concept capitals

**Status**: accepted; refines [ADR 0169](0169-the-launch-glossary-canon.md) and the product-voice term discipline

## Context

The glossary names discern's concepts, but its title-cased headings had leaked into running prose. Pages and machine descriptions consequently alternated between forms such as “the gate” and “the Gate,” making ordinary mechanisms look like branded proper nouns. Proof is different: it is the named completion claim that binds one exact commit to the declared checks, and its line and durable note are members of that same evidence family.

A prose-only convention would drift from source strings and future glossary entries. A blanket capitalization rule would also make the product sound proprietary and would conflict with ordinary English nouns such as gate, map, standard, skill, and checkpoint.

## Decision

Running prose capitalizes **Proof**, **Proof line**, and **Proof note**. Every other glossary concept is lowercase except at sentence or title start or when spelling an exact identifier or external proper name. The product name remains lowercase `discern` in every position.

Every glossary entry declares its running-prose case. That registry generates the product Vale rule and the structural source-string rule, so a new term cannot enter without choosing its casing. The checks recognize running-prose positions without rewriting headings, sentence starts, identifiers, code spans, or dated decision records.

## Consequences

- Human copy and machine instructions use one casing contract.
- New glossary terms enroll in both prose and source guards through the registry.
- Headings may still title-case ordinary concepts, while the body reads as ordinary language.
- Proof remains visibly distinct as the product's exact completion claim without turning the rest of the vocabulary into branded nouns.

## Alternatives considered

- **Capitalize every glossary concept.** Rejected because ordinary mechanisms would read as proprietary product names and running prose would become heavy.
- **Lowercase every concept, including Proof.** Rejected because it would erase the deliberate name of the exact completion claim and its durable family.
- **Rely on editorial review.** Rejected because source strings and new registry members would remain outside a durable, enrolling guard.
