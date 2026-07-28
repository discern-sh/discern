---
title: Start, update, and accept
description: What discern creates at start, refreshes at update, and removes after an accepted worktree lands.
order: 10
aliases:
  - discern start
  - discern update
  - discern accept
  - worktree lifecycle
  - can't edit main
  - update my branch
---

# Start, update, and accept a worktree

_Use one path for every change: create an isolated checkout, keep it current, prove it, and land the validated commit._

## Start an isolated checkout

From the main checkout, `discern start` creates and readies a worktree, then returns its path. It starts from the configured trunk unless `--from <ref>` names unlanded or experimental work ([ADR 0058](../_adr/0058-start-verb-spawn-worktree-from-trunk.md), [ADR 0110](../_adr/0110-the-landing-model.md)).

An optional name becomes a branch-safe slug; otherwise discern generates a codename. It checks the directory, branch, and port for collisions first ([ADR 0109](../_adr/0109-worktree-start-optional-name.md)).

The default is `<repo>.worktrees/<id>` beside the repository; `[worktree].root` overrides it. Nested worktrees confuse recursive tools and root discovery ([ADR 0052](../_adr/0052-worktree-sibling-placement.md)).

Setup runs in this order:

| Phase                | Result                                                                              |
| -------------------- | ----------------------------------------------------------------------------------- |
| Branch               | Creates or confirms the worktree branch.                                            |
| Environment          | Copies declared values from the main checkout.                                      |
| Resources            | Creates each declared resource and records its handle.                              |
| Identity             | Records the deterministic port when `[worktree].port` is on and an env file exists. |
| One-time setup       | Runs `[worktree.setup].steps` only for a fresh worktree.                            |
| Shared convergence   | Runs `[repository].ensure` for checkout-generic dependencies and generated state.   |
| Worktree convergence | Runs `[worktree.setup].ensure` for commands that depend on worktree identity.       |
| Agent files          | Rebuilds guidance and materializes skills in the new checkout.                      |

`start` refuses an unborn repository, a missing trunk, a nested `discern.toml`, an unknown or ambiguous `--from` ref, an occupied branch or directory, or a call from another worktree. `accept` applies the repository-root boundary too, so a nested project cannot land sibling changes. Main-checkout edits stay there. A failed creation removes only its branch and checkout.

## Bring the trunk into the branch

Run `discern update` before finishing. It merges the trunk, reports incoming and overlapping files, and accepts `--from <ref>` for another base.

Update requires a tracked-clean tree but leaves untracked scratch in place. A conflict aborts the merge cleanly; resolve it, commit, and retry. Even a no-op update rebuilds agent files, then runs `[repository].ensure` and `[worktree.setup].ensure` ([ADR 0055](../_adr/0055-update-verb.md), [ADR 0059](../_adr/0059-worktree-setup-ensure.md), [ADR 0153](../_adr/0153-repository-owns-shared-checkout-convergence.md)).

Put checkout-safe commands in `[repository].ensure` and identity-dependent commands in `[worktree.setup].ensure`. Both are ordered and idempotent. `[worktree.setup].steps` remains one-shot.

## Land the reviewed commit

Commit the final tree and run `discern done`. Landing then needs [landing authority](landing-authority.md): conversation consent, a standing scope grant on the trunk, or a one-worktree effort grant from the desk. `start`, `status`, and a green `done` report the shared decision. Uncovered work returns to receipt review with every checkout untouched ([ADR 0134](../_adr/0134-accept-attests-consent.md), [ADR 0194](../_adr/0194-standing-pre-authorization-is-a-recorded-checked-grant.md)).

Acceptance requires the latest trunk, a clean and unlocked worktree, and a tracked-clean main checkout on the trunk. Ignored or untracked main-checkout data may stay unless landing would overwrite it. It validates the commit that will land. An honored `discern done` receipt skips a duplicate gate run; any later commit invalidates it ([ADR 0067](../_adr/0067-accept-validates-the-landed-tree.md)).

On success, discern records `conversation`, `standing-grant` with scopes, or `effort-grant` in the result, receipt, and logbook. It fast-forwards the trunk, refreshes the main checkout, runs `[repository].ensure` and `smoke`, and reports tracked changes. It then destroys resources, removes the worktree, and deletes the branch ([ADR 0098](../_adr/0098-accept-refreshes-the-landing-checkout.md), [ADR 0153](../_adr/0153-repository-owns-shared-checkout-convergence.md)). If another change lands during validation, acceptance keeps this worktree for `update → done → accept`.

An operating-system lock covers recovery through cleanup; a concurrent `accept` refuses without touching active state. Before authority or refs move, a journal records the transition and its verified consent, and the trunk update creates its marker ref atomically. A retry inspects the journal and current grants before recovery changes anything. Journal-bound consent can finish that recorded transition. It cannot authorize a fresh one after pre-transition recovery; discern checks current authority again. Legacy journals without bound consent stay untouched until a current grant or conversation confirmation authorizes recovery. A retry never overwrites a checkout changed since the recorded tree: inspect preserved changes and retry, or run `discern worktree prune` after recovery converges ([ADR 0194](../_adr/0194-standing-pre-authorization-is-a-recorded-checked-grant.md)).

Checkout convergence is non-transactional because the branch has landed. Failures in repository ensure, smoke, tracked cleanliness, or consumed-claim removal are reported without interrupting cleanup. The claim no longer grants authority, and worktree removal reaps it. None can skip resource teardown. Worktree-only `steps` and `ensure` run only in a linked worktree.

Every applied acceptance result carries `data.landing`: whether this call performed recovery, landed the trunk, removed the worktree, and deleted the branch. A fatal error after any of those effects returns `partial_acceptance` with that state and the main-checkout root. MCP re-aims there when the held worktree was removed, so a branch-deletion failure does not strand the next call at a deleted path.

## Remove abandoned work

From the main checkout, `discern worktree drop <id|path>` removes an abandoned worktree and branch. Uncommitted or unlanded work needs human `--force`; a git lock still protects it. The command is CLI-only because agents cannot discard another line of work.

After confirmation, `discern worktree prune` removes clean merged worktrees, stale registrations, orphan directories, and resource records. It rechecks eligibility before removal.

## Where it lives in code

| Responsibility                | Source                                                                                                    |
| ----------------------------- | --------------------------------------------------------------------------------------------------------- |
| Lifecycle plans and execution | [`src/engine/worktree/lifecycle.ts`](../../../src/engine/worktree/lifecycle.ts)                           |
| Acceptance recovery journal   | [`src/engine/worktree/acceptance_transaction.ts`](../../../src/engine/worktree/acceptance_transaction.ts) |
| Landing-authority resolution  | [`src/engine/worktree/landing_authority.ts`](../../../src/engine/worktree/landing_authority.ts)           |
| Git preconditions and removal | [`src/engine/worktree/git.ts`](../../../src/engine/worktree/git.ts)                                       |
| Plan rendering                | [`src/engine/worktree/plan.ts`](../../../src/engine/worktree/plan.ts)                                     |
| Lifecycle tests               | [`tests/engine_worktree_test.ts`](../../../tests/engine_worktree_test.ts)                                 |

## Current state and gotchas

- Every effectful lifecycle command supports `--dry-run`; inspect destructive plans before applying them ([ADR 0027](../_adr/0027-plan-apply-engine-execution.md)).
- `accept` removes the worktree, so any tracked, untracked, or staged change there blocks landing. The main checkout blocks only on tracked changes.
- Acceptance reports top-level ignored paths that changed since setup. Those paths stay outside git cleanliness.
- A result with `error: "partial_acceptance"` may already have landed the trunk or removed the worktree. Read `data.root` and `data.landing` before choosing the recovery command.
- A first setup-step or convergence failure aborts creation. discern reports later convergence failures without undoing a completed update, blocking session start, or interrupting post-landing cleanup.
- `discern doctor` reports repository layouts that `start` and `accept` cannot use.
