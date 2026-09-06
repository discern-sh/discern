# ADR 0380: Bind validation demand after composition within one execution lease

**Status**: accepted

## Context

The complete requirement set belongs to the generated, composed candidate. A predecessor can tighten a standard or change required jobs. Planning producer subjects from the source tip would describe the wrong tree. Returning a borrowed checkout between composition and validation would require another source-owner release and repeat preparation.

## Decision

An environment attempt may begin in `composing` with no validation subjects. It may publish its immutable candidate, but cannot publish component evidence or Proof. The same native checkout lease covers composition, one transition to `claimed` with the final producer subjects, validation, and restoration.

The binding preserves attempt identity, reservation sequence, executor, the entire claim including its token and expiration, purpose, and mode. A claimed attempt cannot change its subjects or return to composing. The composed candidate and binding receipt remain in common attempt storage so restoration and recovery use the exact resulting head.

## Consequences

Producer demand is fixed before validation starts, while source ownership remains continuous. Recovery has an additional active state to recognize. Older readers reject that state instead of treating composition as passing validation. Ordinary claimed attempts retain immutable subjects.

Two separately released leases would require an owner exchange for a mechanical step inside one completion run. Replacing subjects on an ordinary claim would hide that step from the durable model. Both alternatives are rejected.
