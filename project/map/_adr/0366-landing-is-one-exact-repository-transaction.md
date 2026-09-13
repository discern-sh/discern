# ADR 0366: Landing is one exact repository transaction

> **Amendments.**
>
> - **Completion-model direction (2026-09-05; settled 2026-09-12):** [ADR 0376](_superseded/0376-active-commands-advance-an-authorized-landing-queue.md) and [ADR 0378](_superseded/0378-landing-completion-survives-checkout-retirement.md) separated claims, validation, publication, and retirement around this transaction; [ADR 0389](0389-the-workspace-contract.md) superseded both. The exact-commit and ref-transition guarantees below remain required and unchanged.
> - **Integration landings ([ADR 0391](0391-landings-compose-a-moved-trunk-in-an-integration-worktree.md), 2026-09-12):** the journal's recorded ownership extends to the landing's integration worktree, its exact submission, and its Proof pointer, all as optional version-1 fields; retry completes or rolls back the recorded transaction, integration cleanup included, and never lands twice.

**Status**: accepted. Extends the exact-tree landing model in [ADR 0110](0110-the-landing-model.md), the recoverable authority boundary in [ADR 0194](0194-standing-pre-authorization-is-a-recorded-checked-grant.md), the lock order in [ADR 0331](0331-common-repository-locks-precede-checkout-locks.md), and ambient trunk resolution in [ADR 0336](0336-ambient-process-state-resolves-at-boundaries.md). Amends detached-drop recovery in [ADR 0271](0271-destructive-drops-retain-bounded-recovery-refs.md).

## Context

Acceptance already used an exact expected-to-target Git compare-and-swap, but facts feeding that transition could diverge. The configured trunk was resolved for the plan and then read again from raw configuration. Gate validation happened before the common-repository lock. A main-checkout status failure could be mistaken for cleanliness, and an in-progress Git operation looked only like detached HEAD. Recovery after the compare-and-swap could converge the checkout without recording the promised Proof note. Once cleanup removed the worktree-local journal, generic retry guidance asked the caller to cross the authority boundary from a location where acceptance cannot run.

Composition exposed the same need for exactness on either side of landing. A chosen `start --from` commit is a valid base even when it predates the trunk. `update` integrates authored history and then regenerates derived artifacts; combining those effects in one commit would erase which history came from Git integration. A forced drop could discard an unlanded detached commit without retaining the recovery ref promised for committed work.

## Decision

**One applied acceptance holds one common-repository transaction over one resolved trunk and one exact validated target.** It acquires the common-repository lock before its first Gate, Proof, authority, journal, or checkout precondition read and retains that lock, followed by the checkout lock, through compare-and-swap, convergence, cleanup, Proof-note handling, and result construction. Lock contention refuses immediately and runs no operation body.

> Amended by [ADR 0391](0391-landings-compose-a-moved-trunk-in-an-integration-worktree.md): landings now serialize on a dedicated acceptance boundary for that whole span, while the common publication boundary joins only for the transition core — the transaction's atomicity against other landings is unchanged, and neither a composed landing's long check nor its cleanup commands starve sibling completion publications.

The operation resolves the trunk once and carries that branch name through authority reads, Standard-limit reads, journal inspection and creation, main-checkout checks, and the Git transition. Every required Git observation is typed: unreadable status, branch, operation marker, declaration, or ref evidence refuses rather than supplying a clean or absent fact. An in-progress merge, either `rebase` form, or cherry-pick receives its own finish-or-abort recovery before any branch-switch advice.

The target is the exact commit named by honored Proof, or the exact pinned commit validated by a Gate run inside the transaction. Acceptance fast-forwards the resolved trunk to that object without squash, `rebase`, merge, or substitute commit. Current-conversation authority enters through one boolean attestation and persists only as the `conversation` consent source; it gains no attester identity or free-form reason.

The acceptance journal remains local to the worktree whose transition it records. Recovery after the compare-and-swap writes the Proof note from that worktree's matching honored evidence, or reports why it is unavailable. While the worktree exists, a retry may reconcile the journal under its recorded authority rules. After removal, acceptance is complete: recovery verifies the landed SHA and may delete an unchanged merged branch from the main checkout, but never reruns acceptance or replays consent.

On the composition side, `start --from` accepts every resolved commit and records the source ref and SHA. A positive behind-trunk count recommends update without refusing. A divergent `update` keeps its merge commit and any subsequent generated-artifact convergence commit distinct. A destructive drop preserves an unlanded detached HEAD before removing its last worktree.

## Consequences

- Evidence validation and shared mutation cannot interleave with another discern common-repository writer.
- The branch named in a result, journal, recovery command, and ref transition is one fact, including under `DISCERN_TRUNK`.
- Trunk history preserves the exact reviewed commit and the authored-versus-generated boundary; it may be non-linear after update.
- Failures after landing are cleanup or evidence-publication failures, not invitations to make a second consent decision.
- Composing from an older commit stays legal, while Proof and acceptance still require bringing the current trunk into the final branch.
- Recovery refs protect committed detached work but cannot preserve staged, modified, ignored, or untracked bytes.

## Alternatives considered

- **Lock only the compare-and-swap.** Rejected because Gate and authority evidence could change or compete before the lock holder used it.
- **Resolve the trunk at each layer.** Rejected because an environment override and raw config could name different branches inside one transaction.
- **Create a landing commit.** Rejected because it would sever Proof from the object that reaches the trunk.
- **Replay acceptance after worktree removal.** Rejected because the journal and its bounded authority are gone while the landed SHA already proves the irreversible effect.
- **Refuse a behind `start --from`.** Rejected because pull-side composition is unrestricted; currency belongs at the final Gate and landing boundary.
