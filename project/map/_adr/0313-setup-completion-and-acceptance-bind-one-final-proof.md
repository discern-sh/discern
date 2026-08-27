# ADR 0313: Setup completion and acceptance bind one final Proof

> **Amendment ([ADR 0322](0322-setup-is-one-bounded-operational-journey.md)).** The completion result derives canonical Map, ledger, and job inventories after Proof. While Proof remains off the trunk, every surface stops at landing choices; acceptance owns the later activation handoff, and improvement is optional only after activation succeeds.

> **Amendment ([ADR 0351](0351-setup-completion-replays-proof-and-rolls-back-only-owned-tips.md)).** A clean marker-bearing `HEAD` with honored Proof is a read-only replay. Missing or stale Proof validates the existing marker commit through one non-forced path. A failed new marker transaction removes only the exact commit this invocation can prove it owns; it never adds a compensating commit. If ownership or preservation is no longer provable, discern retains the state and reports recovery.

**Status**: accepted. Revises the completion order in [ADR 0065](0065-setup-keeps-its-promises.md), applies the Proof identity from [ADR 0067](0067-accept-validates-the-landed-tree.md) to the setup landing path in [ADR 0081](0081-setup-accept-command.md), sharpens the worktree probe from [ADR 0090](0090-setup-proves-worktree-viability.md), and extends the receiving-checkout guarantee from [ADR 0098](0098-accept-refreshes-the-landing-checkout.md).

## Context

`setup done` formerly ran the Gate and the linked-worktree probe before it wrote and committed `[meta].bootstrapped = true`. The command could therefore return success after proving one commit and creating a later completion commit. `setup accept` then landed the later commit without reading the Gate Proof. The successful completion message, the worktree probe, and the landed tree did not share one identity.

The setup landing path also treated a clean branch and the completion marker as sufficient evidence. A stale, missing, unreadable, or declaration-stale Proof did not block it. When the trunk had moved, setup acceptance produced a merge result without subjecting that new tree to the normal acceptance Proof rule. After landing, the checkout could still carry stale local agent artifacts.

Proof is a statement about one clean commit. Setup needs the same rule as daily work while preserving its dedicated branch and novice-facing command. The transaction must also fail safely when a check fails or the branch changes while recovery is in progress.

## Decision

**A successful non-forced setup completion returns canonical Proof for the clean marker-bearing commit, and setup acceptance lands only that Proof or a separately proved merge commit.**

### Completion is a final-tree transaction

At entry, `setup done` classifies an existing completion marker before it plans effects or changes worktree-local Gate Proof. [ADR 0351](0351-setup-completion-replays-proof-and-rolls-back-only-owned-tips.md) defines read-only replay and validation of an existing marker. For a new transaction, setup checks structural completion, requires a fully clean tree, snapshots earlier Proof, and runs instruction refresh. If refresh changes tracked artifacts, the command stops before the marker and asks the caller to review and commit them.

The transaction then:

1. writes `[meta].bootstrapped = true` and commits only `discern.toml`;
2. runs refresh and doctor against that commit;
3. creates the structural worktree probe from that commit, verifies the probe starts there, and requires the probe Gate to retain current Proof for it;
4. runs the main-checkout Gate last; and
5. reads the canonical Gate Proof inspection and returns its structured Proof and relay line.

Every leg checks that `HEAD` still names the marker commit and that the tracked tree remains clean. No tracked write follows the final Gate Proof on a successful path.

If a post-marker leg fails, setup removes the marker commit only while the checkout, branch, `HEAD`, parent, tree, and changed-path set still prove that the current invocation owns the tip. The ref move is an expected-old compare-and-swap to the sampled predecessor; successful rollback restores the predecessor checkout and the prior Proof snapshot without a compensating commit. If any ownership or preservation fact changed, discern moves no ref, retains the exact visible state, and names recovery. An uncommitted marker whose commit failed is restored only while the predecessor remains current and `discern.toml` is the sole tracked difference.

`--force` remains an explicit escape hatch. It may record the marker without the checks, but returns `gate_proven: false`, `worktree_proven: false`, and no Proof or Proof line. Forced completion cannot enter the proved setup-acceptance path.

### Setup acceptance uses the canonical Proof authority

`setup accept` remains restricted to the dedicated `discern-setup` branch. Before preview or apply, it reads `[meta].bootstrapped` and calls the normal Gate Proof inspector. The marker is a required state flag, not evidence. Acceptance requires an honored inspection with structured Proof and its relay line.

Missing, stale, dirty, unreadable, internally mismatched, report-only, or declaration-stale Proof refuses before any branch or ref changes. The recovery is one route: return to the setup branch, make it clean, run `discern setup done`, then retry setup acceptance. The shared Proof reader validates that the structured Proof identifies the commit recorded by its marker and that its stored presentations agree.

When the trunk remains an ancestor, setup acceptance pins the full commit from Proof and advances the trunk to that commit through the normal exact expected-to-target transition. It never resolves the setup branch name again at the mutation boundary.

When the trunk has moved, setup acceptance first merges the sampled trunk commit into `discern-setup`, leaving the trunk untouched. The merge result runs the full Gate and must earn a new canonical Proof. Only that merge commit may then advance the trunk. A conflict aborts the merge; a red merge remains on the setup branch for repair and another `setup done`.

Before the ref transition, setup acceptance requires an empty current tracked-refresh plan and materializes checkout-local agent artifacts. After landing, it writes the standard durable Proof note, clears the surviving checkout's local Proof cache, and deletes the contained setup branch. Proof-note failures remain fail-open after the trunk transition, matching normal acceptance.

## Consequences

- The completion Proof line names the commit that contains the completion marker and the commit setup acceptance is permitted to land.
- A final check failure leaves no transaction-owned history when exact rollback remains safe. Intervening work makes rollback refuse visibly instead of being overwritten.
- A moved trunk costs another Gate run because the merge commit is a new tree. The earlier setup Proof cannot be laundered onto it.
- Setup acceptance no longer accepts untracked scratch, a forced marker, or a legacy marker without complete structured Proof. The user can ignore machine-local paths deliberately, but a status-reported path prevents a clean Proof.
- The first status after a successful setup landing sees current tracked and checkout-local artifacts and the landed Proof note.
- `setup accept` keeps its dedicated user journey. It shares evidence validation, exact commit movement, durable Proof recording, and convergence authorities with normal acceptance without inheriting worktree resource teardown.

## Alternatives considered

- **Prove first, then commit the marker.** Rejected because the marker commit creates a different tree after Proof.
- **Write the marker without committing it until after the Gate.** Rejected because a Proof requires a clean committed tree; the Gate would either withhold Proof or describe the pre-marker commit.
- **Treat `[meta].bootstrapped` as the acceptance receipt.** Rejected because a boolean records setup state, not the Gate result, tree identity, declaration evidence, or clean working state.
- **Let setup acceptance rerun the Gate whenever Proof is absent.** Rejected because it would erase the distinction between proved completion and forced completion. The dedicated recovery is `setup done`, which performs the marker transaction and structural probe as one operation.
- **Merge the setup branch onto the trunk and validate afterward.** Rejected because a red merge would already have moved the shared branch. Building and proving the merge on `discern-setup` keeps the trunk unchanged until the evidence exists.
- **Invent a setup receipt or marker hash.** Rejected because Gate Proof already owns commit identity, structured review facts, declaration evidence, renderings, and durable landing notes.
