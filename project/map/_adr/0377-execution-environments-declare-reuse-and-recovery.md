# ADR 0377: Execution environments declare reuse and recovery

**Status**: accepted on 2026-09-05; implementation pending. Extends [ADR 0025](0025-worktree-resources.md), [ADR 0367](0367-worktree-local-state-records-intent-before-effects.md), and [ADR 0368](0368-local-durable-formats-declare-forward-skew.md).

## Context

An effort, a candidate, and the environment that validates it have different lifetimes. A fresh environment per candidate can repeat costly provisioning. Reusing an environment can retain database migrations, dependencies, ignored files, and running processes from an earlier candidate. Git cleanliness cannot establish that returning to another revision is valid.

An isolated pool protects authoring checkouts, but every reused pool member still needs a valid transition between candidates.

## Decision

The model has separate effort, immutable candidate, and execution-environment identities. An agent never adopts another effort's checkout. A discern executor may validate a published immutable candidate in an environment explicitly released and exclusively claimed for that purpose.

The project declares preparation and restoration or reset procedures, relevant resources, and reuse eligibility. The engine schedules and verifies their completion. Existing ensure machinery supplies preparation primitives; a readiness declaration alone does not establish backward convergence. Undeclared environments are ineligible for temporary composition.

A borrowed checkout preserves its effort identity, resource handles, and applicable test seed. The operation records the source revision, candidate, exclusive claim, preparation, validation, restoration, and recovery state. Detached HEAD always has recorded provenance and a recovery route. The queue does not rewrite the author's branch to install speculative predecessors.

Every outcome requires restoration before a borrowed checkout is returned as ready for source work. Candidate drift is preserved as recoverable evidence before restoration, including relevant binary and newly created files. If capture or restoration fails, the environment enters recovery and cannot be reused. The engine neither discards unknown changes nor transfers candidate edits into authored work.

Reused isolated environments need declared reset procedures. Fresh disposable environments can avoid a return journey. Provisioning remains bounded by execution capacity, with separate ownership and disposal records. An existing worktree's availability or cleanliness never makes it a pool member.

Without an eligible environment, ordered coordination continues. A current source-tip candidate needs no temporary checkout. After real trunk movement, the owning effort can follow the ordinary forward `update` and `done` path. A foreign executor cannot bypass the missing environment contract by calling temporary composition non-speculative.

## Consequences

- Projects can gain coordination before declaring an environment suitable for speculation.
- The declaration is eligibility evidence; runtime restoration failures remain possible and visible.
- Resource and child-process lifetimes join the claim and recovery boundary.
- Evidence includes relevant execution conditions. Switching back to an authoring branch does not change the identity of a completed candidate Proof.
- Stateful projects may need isolation. This is a correctness requirement independent of fleet size.
