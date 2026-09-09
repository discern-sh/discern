# ADR 0377: Execution environments declare reuse and recovery

**Status**: accepted on 2026-09-05; implemented by the complete completion and coordinated acceptance boundaries. Extends [ADR 0025](0025-worktree-resources.md), [ADR 0367](0367-worktree-local-state-records-intent-before-effects.md), and [ADR 0368](0368-local-durable-formats-declare-forward-skew.md).

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

The public completion companion selects ordinary source execution whenever no temporary candidate installation is needed, including linked worktrees. A differing candidate still uses the declared environment. The executor remains the authority for enforcing environment capacity and preserving owned checkout state.

## Native recovery amendment — 2026-09-09

The execution deadline remains a watchdog over the configured worst-case validation and return budget. It is not a liveness observation or a mandatory recovery delay. Native recovery may supersede an abandoned operation before that deadline once it acquires and retains the checkout's OS exclusion. A probe followed by unlocked effects is insufficient. Authenticated child delegation remains valid for nested commands, but cannot supply takeover authority: recovery requires a lease acquired by its own process and cannot run inside an active execution scope.

The native lifetime binds claim publication to the retained checkout scope. An execution cannot resume a claim after that scope ends; a fresh caller uses recovery. Child enrollment precedes the durable environment claim. Recovery reads the frozen source, ownership, intent, attempt and matching reservations under exclusion, closes their publication authority through checked record transitions, then proves child quiescence before return effects. It checks the old inventory before creating new recovery receipts, so missing observations stay unknown. Interrupted publications are resumable; a missing initial attempt can be reconstructed only from its verified frozen claim intent at the installation boundary. Supported existing records retain their versioned reader protections.

The executor applies the frozen return procedure, verifies the result, and settles the interrupted attempt without overwriting a completed verdict. Its matching queue reservation releases only after verified return. A reservation interrupted before execution may reconcile against its unchanged released source without running an environment procedure. Newer and unrelated attempts remain protected. Recovery produces no validation, Proof, landing, approval consumption, or evidence invalidation.

Read-only status reports recorded claims and point-in-time native ownership/child observations separately. Recovery reacquires ownership and rechecks records. Missing or uncertain child receipts, surviving groups, changed source ownership, failed return and incompatible state retain the checkout and their evidence. The logbook supplies no recovery authority. Adapters without retained native takeover capability keep an explicit limitation; this amendment adds no distributed executor, heartbeat service, configuration knob or expiry override.

## Consequences

- Projects can gain coordination before declaring an environment suitable for speculation.
- The declaration is eligibility evidence; runtime restoration failures remain possible and visible.
- Resource and child-process lifetimes join the claim and recovery boundary.
- Evidence includes relevant execution conditions. Switching back to an authoring branch does not change the identity of a completed candidate Proof.
- Stateful projects may need isolation. This is a correctness requirement independent of fleet size.

## Alternatives considered

- A mandatory fresh environment for every candidate avoids restoration but repeats provisioning and can exhaust project resource capacity. Declared borrowing and reset allow reuse where the project can establish its validity.
- An isolated reusable pool avoids borrowing authoring checkouts but still carries state between candidates. Isolation alone cannot establish a valid return from newer migrations or dependencies to an older candidate.
- Treating a successful preparation or clean Git tree as reuse eligibility leaves ignored state and backward transitions unverified. The project must declare restoration or reset as well as preparation.
