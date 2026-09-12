# ADR 0376: Active commands advance an authorized landing queue

**Status**: accepted on 2026-09-05; implemented by the complete completion and coordinated acceptance boundaries. Extends [ADR 0374](0374-complete-proof-is-independent-of-measurement-scheduling.md) and [ADR 0375](0375-source-authority-survives-declared-composition.md). Amends the transaction scope of [ADR 0366](0366-landing-is-one-exact-repository-transaction.md). Amended by [ADR 0389](0389-the-workspace-contract.md) on 2026-09-12: the queue is now a derived view over submissions; provisional positions, queue controls, and reconciliation are gone; an active `accept` still advances approved proven work.

## Context

Parallel efforts often prove different branches against the same trunk. Independent acceptance attempts then cause repeated integration and validation. Owners also approve several completed efforts together. Requiring the original conversations to remain active makes routine landing depend on session lifetime.

## Decision

The repository records a durable ordered queue. A green `done` reserves an effort's provisional position. Candidate selection precedes its expensive validation, so admission requires no extra standalone pass.

Current complete evidence and an intentional approval or acceptance request establish a stable eligible order. Unapproved incidental predecessors do not block approved work. An approved effort promoted ahead of them retains its position when they receive approval later. A batch approval preserves provisional order within that batch. Routine scheduling does not reorder an established approved prefix to discard started work. Explicit owner changes, withdrawals, and failures remain observable causes of rebuilding.

Queue candidates use internal refs under `refs/discern/candidates/`. Each attempt records its source revisions, expected predecessor, composition procedure, policy, environment, and evidence. A new attempt does not overwrite the identity of an older attempt.

Active effectful commands perform queue work. A brief common-state lock claims or publishes an operation; expensive validation runs outside that lock. An attempt token prevents a superseded executor from publishing. Landing rechecks authority, evidence, candidate currency, and the expected trunk under its transition boundary. Main-checkout consistency remains protected.

An active `accept` can advance current, proven, separately authorized predecessors before its requested effort. It may refresh stale evidence in an eligible execution environment. Missing judgment, missing authority, and unavailable execution environments are distinct pending states. No actor means no progress. Read-only status never starts work.

Ordered coordination is the default. Speculation requires an eligible environment under [ADR 0377](_superseded/0377-execution-environments-declare-reuse-and-recovery.md). Without one, work follows the ordinary forward update and validation path when trunk moves. Temporary checkout of a changed candidate still needs the environment contract, even when the predecessor has already landed.

Concurrency and speculative depth bound compute. Queue length is not the compute budget. Approved head work receives priority. A changed dependency invalidates affected candidates; an unrelated queue revision does not invalidate every Proof.

Queue invalidation closes short queue actors while leaving the environment actor responsible for producer receipts and return. Public completion checks queue eligibility again before assembly or a failed-row mutation. Capacity waits depend on a live actor and re-read the enforcing reservation state after each wake. Recovery, expired ownership, and eligibility requiring a separate landing return an action instead of waiting without a possible release.

## Eligibility amendment — 2026-09-09

Eligibility follows readiness; authority follows the owner's decision to land. The original wording let authorization alone fix the eligible order. A standing scope grant therefore enrolled every green docs-only effort ahead of independent work, and a candidate that later failed validation kept its place and stopped everything behind it.

A candidate that fails validation leaves the eligible prefix and keeps its recorded authority. When its source is proven again it re-enters behind work already eligible. Standing scope coverage supplies authority when its effort is accepted or explicitly approved at the desk; it does not by itself place an effort in the eligible order, so a docs-only effort lands when its own accept runs or the owner approves it, never as an incidental predecessor of unrelated work. Actual source dependencies, intentional holds and order, active execution, and already-started authorized progress remain protected. The public hold, withdraw, revoke, and reorder actions apply the same checked mutations.

## Review and reconciliation amendment — 2026-09-09

Queue controls are reviewed mutations of the same queue used by acceptance. A preview binds the expected queue snapshot; apply requires the owner's instruction and compares that snapshot under common exclusion. Holds retain evidence and approval while independent work proceeds. Source dependencies remain mandatory. Revocation prevents ambient grants from silently restoring the withdrawn approval. A new explicit source approval can re-enroll the unchanged source.

Acceptance previews project the same authority mutations and planner decisions as apply, without recording consent or claims. Explicit conversation consent remains bound to the unchanged source and composition procedure across a continuation from main. Narrower checkpoint and standard decisions remain independent.

External integration is observed separately from a governed landing. An immutable integration record names the exact candidate and strict Proof found reachable from the observed trunk. It does not attest to historical permission, consume approval, or advance a ref. Queue reconciliation and checkout retirement use that observation without fabricating a landing receipt. A fresh fork has no proven change distinct from its recorded predecessor and cannot satisfy this observation.

Completion record version 5 adds this immutable family, optional queue decision fields, and a distinct external integration reference for retirement. The reader accepts the reviewed version 2–4 envelopes that omit these optional members and preserves their original byte stamps. Older engines refuse version 5 before interpreting it.

## Assessment and claim amendment — 2026-09-09

Acceptance bounds expensive candidate assessment by the requested queue prefix. It shares schema-validated evidence within one observation and ancestry answers only for immutable object pairs within one command. Fresh observations still recheck selected artifact bytes and mutable source, policy, and authority facts.

The publication claim starts after expensive preflight. Under common exclusion, the planner compares current records and trunk with the assessed observation before claiming. Publication binds the audited plan to that observation and rechecks records, current authority, source cleanliness and head, receiving checkout, and the exact ref transition. The bounded lease remains an exclusion fence, not a budget for repeated history assessment. Expired or superseded actors cannot publish or settle through another actor's claim. Cancellation preserves a claim-loss refusal instead of replacing it with an internal error.

## Consequences

- Landing can reuse a proven prefix, but approval alone does not promise instant completion.
- Speculation may discard work after withdrawal, source changes, changes to priority, or external trunk movement.
- Every observable trunk prefix requires its own complete Proof. A passing combined batch does not prove intermediate prefixes.
- Batching requires a separate explicit product policy and is outside this implementation.
- Results and live progress explain the current effort, reason for order or waiting, next transition, and required owner action.

## Alternatives considered

- A resident daemon could advance work with no active caller, but would introduce a continuously running service and its own lifetime management. Active commands preserve the no-daemon boundary and expose the absence of an executor as a pending state.
- Requiring each original session to finish its effort leaves an active acceptance command unable to complete an approved prefix after another session ends. Durable authority and operation claims let that command continue mechanical work.
- Requiring a standalone green gate before queue admission adds a validation pass that may become stale immediately. Selecting the expected integration candidate first spends that validation on the candidate intended to land.
