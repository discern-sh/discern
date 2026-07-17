---
title: Start, update, and accept
description: What discern creates at start, refreshes at update, and removes after an accepted worktree lands.
order: 10
aliases:
  - discern start
  - discern update
  - discern accept
  - worktree lifecycle
---

# Start, update, and accept a worktree

_Use one path for every change: create an isolated checkout, keep it current, prove it, and land the validated commit._

## Start an isolated checkout

Run `discern start` from the main checkout. It creates a fresh worktree and branch, readies the checkout, and returns the path the agent must enter. The branch starts from the configured trunk even if someone parked the main checkout elsewhere. Use `--from <ref>` only when the task builds on unlanded or experimental work ([ADR 0058](../_adr/0058-start-verb-spawn-worktree-from-trunk.md), [ADR 0110](../_adr/0110-the-landing-model.md)).

An optional name becomes a branch-safe slug with a random hexadecimal suffix. Without a name, discern generates a readable codename. It checks the new directory, branch, and derived port for collisions with live worktrees before creating anything ([ADR 0109](../_adr/0109-worktree-start-optional-name.md)).

The default location is a sibling directory, `<repo>.worktrees/<id>`. `[worktree].root` accepts a relative or absolute override. Keep the sibling default: nested worktrees confuse recursive tools and repository-root discovery ([ADR 0052](../_adr/0052-worktree-sibling-placement.md)).

Setup runs in this order:

| Phase       | Result                                                         |
| ----------- | -------------------------------------------------------------- |
| Branch      | Creates or confirms the worktree branch.                       |
| Environment | Copies declared values from the main checkout.                 |
| Resources   | Creates each declared resource and records its handle.         |
| Identity    | Records the deterministic port when an env file exists.        |
| Setup       | Runs one-time `steps`, then repeatable `ensure` commands.      |
| Agent files | Rebuilds guidance and materializes skills in the new checkout. |

`start` always creates a worktree. It refuses an unborn repository, a missing trunk, a `discern.toml` below the repository root, an unknown or ambiguous `--from` ref, an occupied branch or directory, or a call made from another worktree. Uncommitted main-checkout changes stay there. A failed creation removes only the branch and checkout it created.

## Bring the trunk into the branch

Run `discern update` before finishing. It merges the trunk into the current branch, reports incoming commits and files, and highlights files changed on both sides. `update --from <ref>` performs the same operation with another ref.

Update accepts a tracked-clean tree. Commit or stash tracked edits first. Untracked scratch files remain in place. On conflict, the command aborts the merge and leaves the tree unchanged. Resolve the merge by hand, commit it, then run `discern update` again. Even when there is nothing left to merge, the command rebuilds agent files and reruns `[worktree.setup].ensure`. That convergence updates dependencies after a lockfile or setup change ([ADR 0055](../_adr/0055-update-verb.md), [ADR 0059](../_adr/0059-worktree-setup-ensure.md)).

## Land the reviewed commit

Commit the final tree and run `discern done`. After the owner accepts the change, run `discern accept --confirmed` from the worktree. The confirmation attests to that review. Without it, acceptance points the agent back to the receipt and leaves every checkout untouched ([ADR 0134](../_adr/0134-accept-attests-consent.md)).

Acceptance requires the latest trunk, a clean worktree, a tracked-clean main checkout on the trunk, and an unlocked worktree. It validates the precise commit that will land. An honored `discern done` receipt skips a duplicate gate run. Any later commit invalidates the receipt and triggers the full gate again ([ADR 0067](../_adr/0067-accept-validates-the-landed-tree.md)).

On success, discern fast-forwards the trunk to that validated commit. It then destroys resources, removes the worktree, deletes the merged branch, and refreshes the generated files in the main checkout ([ADR 0098](../_adr/0098-accept-refreshes-the-landing-checkout.md)). If another change lands during validation, acceptance refuses and keeps this worktree intact for `update → done → accept`.

## Remove abandoned work

From the main checkout, `discern worktree drop <id|path>` removes an abandoned worktree and its branch. It refuses uncommitted or unlanded work unless a human passes `--force`. A git-locked worktree remains protected even with force. The command is CLI-only because one agent never discards another line of work.

`discern worktree prune` is narrower housekeeping. After confirmation, it removes only clean, fully merged worktrees and branches, stale registrations, orphan directories, and orphaned resource records. It checks eligibility again immediately before removal.

## Where it lives in code

| Responsibility                | Source                                                                          |
| ----------------------------- | ------------------------------------------------------------------------------- |
| Lifecycle plans and execution | [`src/engine/worktree/lifecycle.ts`](../../../src/engine/worktree/lifecycle.ts) |
| Git preconditions and removal | [`src/engine/worktree/git.ts`](../../../src/engine/worktree/git.ts)             |
| Plan rendering                | [`src/engine/worktree/plan.ts`](../../../src/engine/worktree/plan.ts)           |
| Lifecycle tests               | [`tests/engine_worktree_test.ts`](../../../tests/engine_worktree_test.ts)       |

## Current state and gotchas

- Every effectful lifecycle command supports `--dry-run`; inspect destructive plans before applying them ([ADR 0027](../_adr/0027-plan-apply-engine-execution.md)).
- `accept` removes the worktree, so any tracked, untracked, or staged change there blocks landing. The main checkout blocks only on tracked changes.
- Acceptance reports top-level ignored paths that changed since setup. Those paths stay outside git cleanliness.
- A first setup-step or convergence failure aborts creation. discern reports later convergence failures without undoing a completed update or blocking session start.
- `discern doctor` reports repository layouts that `start` cannot use.
