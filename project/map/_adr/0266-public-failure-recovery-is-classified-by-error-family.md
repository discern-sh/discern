# ADR 0266: Public failure recovery is classified by error family

**Status**: accepted

## Context

The public result boundary already requires every failed CLI JSON or Model Context Protocol (MCP) envelope to carry a fired, registered next-step hint ([ADR 0172](0172-hints-compile-from-a-registry.md)). Its generic floor is evidence-bound: it tells the caller to correct the result's message or first diagnostic, and the boundary rejects that hint when neither field exists.

Field presence does not prove semantic sufficiency. Several controlled failures state only that a threshold was missed, that setup remains incomplete, or that a partial effect occurred; the correction lives in structured data or depends on a choice. Allowing those families to inherit the generic floor produces a mechanically valid but false continuation. Searching arbitrary TypeScript strings for action words would be equally unsound and would couple product behavior to prose spelling.

The error-slug vocabulary is already the closed membership authority. The missing decision is how each member may recover at the one public serialization boundary, with new members enrolled before they ship.

## Decision

Every canonical error slug has one total recovery classification in `ERROR_FAILURE_RECOVERY`, keyed by `ErrorSlug`:

- `evidence` permits the generic registered floor only when the result carries a non-empty message or first diagnostic whose family audit says supplies the correction;
- `tailored` requires a narrower registered next-step hint that points at the real authority, structured evidence, choice, or continuation.

The mapping is a typed satellite of `ERROR_SLUGS`; adding a slug cannot compile until it is classified. Error-less failures fail closed to tailored recovery because no canonical family supports an evidence judgment. `withFailureRecoveryHint` and `serializeResult` consume the same mapping, so CLI JSON and MCP cannot diverge. The public result fields and error slugs do not change.

No lexical scan decides whether prose sounds actionable. The class test iterates the authorities and proves the boundary behavior; behavioral tests exercise the tailored producers.

## Consequences

- A future error family must make an explicit semantic recovery decision before it can use the generic floor.
- Failures whose next step lives in `data` gain a registered hint that names the relevant field; consent and partial-effect results cannot fall back to generic retry advice.
- Rewording a message cannot silently widen a tailored family into generic recovery.
- The policy table is deliberate review work: changing an error family's mode requires evidence that every producer in that family supports the new contract.
- The internal authority grows with the error vocabulary, but the public wire contract stays stable.

## Alternatives considered

- **Treat every message or diagnostic as actionable.** Rejected because presence is syntactic and several live families carry their correction elsewhere.
- **Require a tailored hint for every failure.** Rejected because many parse, precondition, and command-usage messages already contain the exact correction; duplicating them in a second template adds prose without adding state.
- **Scan result-producing TypeScript for action words or command strings.** Rejected because lexical shape cannot prove the continuation is correct and would create the blanket source scan this decision is intended to avoid.
