# ADR 0379: Emergency landings record an explicit Proof exception

**Status**: accepted on 2026-09-05; implemented on 2026-09-12 by the `exception` record family. Amends the ordinary acceptance boundary of [ADR 0110](0110-the-landing-model.md) and the claim contract of [ADR 0215](0215-landing-receipts-travel-as-git-notes.md), with authority from [ADR 0375](0375-source-authority-survives-declared-composition.md).

## Context

An owner may need to integrate an urgent repair before expensive checks can finish. Raw Git can bypass discern, but that path hides which evidence was absent. Calling an unchecked integration a passing Proof would damage the product's completion and attestation contract.

## Decision

Ordinary acceptance requires complete, valid Proof. An explicitly authorized emergency landing proceeds without passing Proof and records the exception permanently.

The emergency decision is fresh and bound to the named source, actual trunk, resulting candidate, reason, and waived obligations. Standing and effort grants never cover it. A request described as urgent does not itself authorize the exception.

The candidate includes the requested repair against actual trunk, with no speculative predecessors or unrelated queued work. Known failures, checks that never ran, and stale evidence remain distinguishable. The route retains the identity, ownership, ref-transition, and recovery checks needed to perform the requested operation without overwriting unrelated work.

An immutable exception record is prepared before the transition and settled with its outcome. It has a distinct claim kind and cannot parse or display as passing Proof. An unsigned or future signed exception record establishes its recorded facts; it cannot attest successful validation.

Outstanding validation remains visible afterward. A later passing run can resolve current validation obligations without erasing the historical exception or certifying that the earlier integration had passed. Ordinary subsequent acceptance retains the full requirements. No persistent skip setting, weaker limit, or broader grant is created.

External branch protections and deployment systems keep their own authority. A broken discern installation may still require a documented raw-Git recovery path. Discern cannot police integrations performed outside its controlled boundary.

## Consequences

- Owners have a supported urgent route with an inspectable cost.
- Emergency integration moves the trunk under waiting submissions, which must update and re-prove.
- Failure accounting and machine consumers must distinguish Proof from exception records.
- Commercial signing and independent verification remain separate work. The record preserves the distinction they will need.

## Alternatives considered

- Leaving every emergency to raw Git preserves a smaller command surface but loses the supported record of which obligations failed, never ran, or have stale evidence. A distinct exception operation retains that accounting within discern's transition boundary.
- A skip-checks flag that still issues passing Proof makes unchecked integration indistinguishable from successful validation. The separate claim kind preserves that distinction for people and machine consumers.
