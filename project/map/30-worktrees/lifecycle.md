---
title: Start, update, and accept
description: How discern creates efforts, validates candidates, lands approved work in order, and retires released checkouts.
order: 10
aliases:
  - discern start
  - discern update
  - discern accept
  - worktree lifecycle
  - can't edit main
  - update my branch
  - resume a worktree
  - follow-up fixes
---

# Start, update, and accept a worktree

_Keep the same worktree from the first edit through review feedback and resumed sessions. Update it, verify it, and land the validated commit._

## Start an isolated checkout

From the main checkout, `discern start` creates and readies a worktree, then returns its path. Reuse that checkout for review, fixes, and later sessions; pass its path to discern tools, and ask the owner if it is unavailable. Calling `start` again creates a separate effort. New worktrees branch from the trunk unless `--from <source>` names another ref or an unambiguous worktree id or path ([ADR 0058](../_adr/0058-start-verb-spawn-worktree-from-trunk.md), [ADR 0110](../_adr/0110-the-landing-model.md), [ADR 0359](../_adr/0359-worktree-targets-share-one-resolution-contract.md)).

An explicit source remains legal at any resolved commit. Start records its ref and SHA unchanged. When that commit is behind the trunk, the result emits only the positive behind count and recommends `discern update`; equal and ahead bases carry no fabricated count or warning.

`start` probes Git and destination write access before creation. A later failure tears resources down only if the worktree exists ([ADR 0338](../_adr/0338-operation-policy-enrolls-git-write-authority.md)).

An optional name becomes a branch-safe slug; otherwise discern generates a codename. It checks the directory, branch, and port for collisions first ([ADR 0109](../_adr/0109-worktree-start-optional-name.md)).

The default is `<repo>.worktrees/<id>` beside the repository; `[worktree].root` overrides it. Nested worktrees confuse recursive tools and root discovery ([ADR 0052](../_adr/0052-worktree-sibling-placement.md)).

Setup runs in this order:

| Phase                | Result                                                                                     |
| -------------------- | ------------------------------------------------------------------------------------------ |
| Branch               | Creates or confirms the worktree branch.                                                   |
| Environment          | Copies declared values from the main checkout.                                             |
| Resources            | Creates each declared resource and records its handle.                                     |
| Identity             | Records the deterministic port when `[worktree].port` is on and an env file exists.        |
| One-time setup       | Journals and runs incomplete `[worktree.setup].steps`; completed identities stay complete. |
| Shared convergence   | Runs `[repository].ensure` for checkout-generic dependencies and generated state.          |
| Worktree convergence | Runs `[worktree.setup].ensure` for commands that depend on worktree identity.              |
| Refresh              | Uses the new checkout's engine for shared and checkout-local refresh work.                 |

In a source checkout of discern, the Refresh phase launches that checkout's engine. The child records the `start` invocation as its parent in the [logbook](../70-reference/the-logbook.md#possible-agent-identity-signals), so patterns counts this work as automation. Installed projects refresh in process.

`start` refuses an unborn repository, a missing trunk, a nested `discern.toml`, an unknown or ambiguous `--from` source, an occupied branch or directory, or a call from another worktree. `accept` applies the repository-root boundary too, so a nested project cannot land sibling changes. Main-checkout edits stay there. A failed creation retires only the checkout and branch that call minted; an incomplete discard is part of the reported failure rather than a successful rollback.

## Bring the trunk into the branch

`discern update` merges trunk or `--from`, requires tracked-clean files, and leaves untracked scratch.

discern states its merge topology and status visibility on each Git command. Repository or global values such as `merge.ff`, `branch.<name>.mergeOptions`, `status.showUntrackedFiles`, and `diff.ignoreSubmodules` cannot turn a planned fast-forward into a merge commit or make a safety check overlook work.

Only conflicts confined to [generated artifacts](../00-orientation/glossary.md#generated-artifact) auto-resolve; other conflicts abort. A divergent update first records the Git merge, then records changed generator and tracked-refresh outputs in a distinct discern-authored commit. It never folds regeneration into the merge. An already-contained source still refreshes and converges. When a no-op update changes tracked paths, `update` names and leaves them for review instead of creating a commit ([ADR 0055](../_adr/0055-update-verb.md), [ADR 0059](../_adr/0059-worktree-setup-ensure.md), [ADR 0153](../_adr/0153-repository-owns-shared-checkout-convergence.md), [ADR 0264](../_adr/0264-tracked-refresh-convergence-precedes-landing.md), [ADR 0366](../_adr/0366-landing-is-one-exact-repository-transaction.md)). Regeneration uses declared sources instead of conflicted temporary bytes, and failures remain visible ([ADR 0247](../_adr/0247-generated-artifacts-regenerate-never-merge.md)).

Refresh installs `merge.discern-generated.driver=true` once in the clone's common Git config. The value is effective from the main checkout and every linked worktree; reconciliation removes redundant discern-owned worktree-local copies while preserving unrelated checkout-specific settings. Raw merge keeps a marked side without conflict markers, then `done` or `update` regenerates it. A fresh clone and CI have only the tracked attributes until setup or refresh installs this clone-local value; discern never writes a global definition. Doctor requires the exact shared value and reports its origin. Repair it with `discern refresh` ([ADR 0093](../_adr/0093-upgrade-reconciles-gitignore-block.md), [ADR 0247](../_adr/0247-generated-artifacts-regenerate-never-merge.md)).

Use `[repository].ensure` for checkout-safe commands and `[worktree.setup].ensure` for identity-dependent ones. Each `[worktree.setup].steps` command records `running` before invocation and `completed` after success. Re-entry skips completed identities even when a later setup phase did not finish. A running identity stops automatic replay and serves owner-confirmed mark-complete and retry commands. [Recover an interrupted worktree setup step](../70-reference/worktree-setup-step-recovery.md) covers that recovery ([ADR 0332](../_adr/0332-worktree-setup-steps-preserve-interruption-ambiguity.md)).

## Land the reviewed commit

Commit the final source and run `discern done`. Complete strict evidence admits its immutable candidate to the green queue. [Landing authority](landing-authority.md) remains separate: each source needs its own conversation consent or recorded grant, and any checkpoint variance or standard proposal needs its exact owner decision.

An active `discern accept` advances the approved efforts in queue order. Each row identifies source, candidate, expected trunk, target, authority, preview actions, and pending reasons. A predecessor can land while a later entry waits for validation or a decision. With no active accept actor, no landing occurs.

Validation and composition execute outside the short shared publication locks. Stale evidence can be refreshed only in an eligible, explicitly released environment. Without one, the effort follows the returned `update` and `done` remedy. Source edits, changed policy, changed judgment, and unavailable environments remain distinct from red validation. A generated composition retains the reviewed source identity and procedure while producing its own exact candidate commit.

Publication rechecks the current plan, source authority, expected trunk, and receiving checkout before moving refs. The main checkout must be consistent with the expected tree; unfamiliar edits remain untouched. The accepted transition is expected-to-target. A superseded actor cannot publish an older target or substitute another commit.

Landing and retirement have independent outcomes. The common Git administration retains indispensable Proof and recovery records before disposable state is removed. After landing, the same recorded operation settles authority and publishes the Proof note. Failure in either tail cannot repeat the ref transition or spend authority twice. [Interrupted landing recovery](acceptance-recovery.md) describes retries.

Retirement requires positive ownership, current cleanliness, an explicit release, matching resource records, and exclusion of active children or competing operations. `done --retain-checkout` retains authoring control. Changed branches and uncertain resources stay in place, even after their candidate landed. See [cleanup ownership](cleanup-ownership.md) for the separate drop and prune contracts.

Fresh setup still uses its dedicated acceptance path. Setup completion requires current complete strict evidence; setup acceptance does not turn a CI report or an older incomplete marker into authority. It validates the exact setup candidate before advancing trunk.

## Park a checkout and keep its branch

From the main checkout, `discern worktree park <worktree>` removes a healthy task's checkout and resources while retaining its branch, committed work, and task wording. Select it by exact id, path, local branch, or full local ref. Preview the exact artifact account first:

```sh
discern worktree park <target> --dry-run
```

Park requires a readable clean checkout, a named task branch separate from the trunk, a completed setup-ready marker, matching Git registration and branch tip, readable task metadata, and a readable resource ledger. It has no force option. A refusal names the failed command or observation and one command to run before retrying.

The plan keeps the branch, commit, title, optional brief, and creation source. It destroys recorded resources and removes the checkout. Worktree-scoped Proof, landing grant, task metadata, measurements, and setup evidence leave with the Git worktree registration. A task with those artifacts still needs new Proof and authority after resume.

After Park, status lists the branch under **Work without a worktree**. Resume it with:

```sh
discern start --from <parked-branch>
```

When the branch still points at the parked commit, Start uses the retained title and brief as creation defaults and consumes the Park record after the new checkout is ready. The branch also remains usable through ordinary Git or `start --from` if its local Park record is unavailable.

Park reads the plan again before resource cleanup and checks the task again after cleanup. A changed branch, checkout, or resource set stops removal. If resource cleanup completed before a later check refused, run the named `discern worktree setup` recovery in the retained checkout, review the refreshed state, and retry Park ([ADR 0358](../_adr/0358-recovery-observes-before-repair-and-park-preserves-the-branch.md)).

## Remove abandoned work

From the main checkout, `discern worktree drop <worktree>` removes an abandoned worktree and its owned branch. Use Park when the branch should remain resumable. Select a registered checkout by exact id, path, local branch, or full local ref. If a token identifies several registrations or collides with another ref, discern refuses and requires an absolute path or full ref. Uncommitted or unlanded work needs explicit `--force`. A Git lock still protects it. If Git cannot read the worktree's status, discern treats its cleanliness as unknown and requires `--force`. The command is CLI-only because discarding another line of work requires a person's local decision. An explicitly selected foreign checkout can be removed while its branch stays.

Before destructive effects, drop retains the branch's committed tip (or an unlanded detached HEAD) in a bounded local ref. [Recover a dropped branch](drop-recovery.md) explains the guarantee, its uncommitted-work boundary, and the restore commands. A failed preservation stops the drop intact ([ADR 0271](../_adr/0271-destructive-drops-retain-bounded-recovery-refs.md)).

After confirmation, `discern worktree prune` removes clean merged worktrees, stale registrations, orphan directories, reappeared worktree paths, and resource records only from evidence-backed candidate sets. [Cleanup ownership and teardown](cleanup-ownership.md) defines the shared ownership rule, dry-run/apply parity, successful-absence condition, and interrupted recovery. Merge status alone never puts a branch or path in the plan.

[Cleaning up a reappeared worktree path](reappeared-worktree-paths.md) explains the removal evidence, status notice, and confirmed prune boundary.

Prune also reports **contained** worktrees: spent `start --from` stages whose commits already travel inside a live sibling branch. The default apply never touches them. [Reclaiming contained worktrees](reclaiming-contained-worktrees.md) covers the predicate, the `--contained` opt-in, and the kept branch refs.

## Where it lives in code

| Responsibility                | Source                                                                                                    |
| ----------------------------- | --------------------------------------------------------------------------------------------------------- |
| Lifecycle plans and execution | [`src/engine/worktree/lifecycle.ts`](../../../src/engine/worktree/lifecycle.ts)                           |
| Worktree target resolution    | [`src/engine/worktree/target_resolution.ts`](../../../src/engine/worktree/target_resolution.ts)           |
| Acceptance recovery journal   | [`src/engine/worktree/acceptance_transaction.ts`](../../../src/engine/worktree/acceptance_transaction.ts) |
| Setup-step journal            | [`src/engine/worktree/setup_step_journal.ts`](../../../src/engine/worktree/setup_step_journal.ts)         |
| Operation exclusion           | [`src/engine/operation_lock.ts`](../../../src/engine/operation_lock.ts)                                   |
| Landing-authority resolution  | [`src/engine/worktree/landing_authority.ts`](../../../src/engine/worktree/landing_authority.ts)           |
| Proof-note recording          | [`src/engine/gate/proof_notes.ts`](../../../src/engine/gate/proof_notes.ts)                               |
| Git preconditions and removal | [`src/engine/worktree/git.ts`](../../../src/engine/worktree/git.ts)                                       |
| Branch ownership              | [`src/engine/worktree/ownership.ts`](../../../src/engine/worktree/ownership.ts)                           |
| Park metadata                 | [`src/engine/worktree/parked_task_metadata.ts`](../../../src/engine/worktree/parked_task_metadata.ts)     |
| Drop recovery refs            | [`src/engine/worktree/recovery_refs.ts`](../../../src/engine/worktree/recovery_refs.ts)                   |
| Contained-worktree scan       | [`src/engine/worktree/containment.ts`](../../../src/engine/worktree/containment.ts)                       |
| Plan rendering                | [`src/engine/worktree/plan.ts`](../../../src/engine/worktree/plan.ts)                                     |
| Lifecycle tests               | [`tests/engine_worktree_test.ts`](../../../tests/engine_worktree_test.ts)                                 |
| Generated-update tests        | [`tests/engine_generated_update_test.ts`](../../../tests/engine_generated_update_test.ts)                 |

## Current state and gotchas

- Every effectful lifecycle command supports `--dry-run`; inspect destructive plans before applying them ([ADR 0027](../_adr/0027-plan-apply-engine-execution.md)).
- Source or index changes invalidate the released candidate. Retirement also verifies the current checkout and owned resource set.
- Acceptance reports top-level ignored paths that changed since setup. Those paths stay outside git cleanliness.
- A Standard approval token becomes stale when its name, proposed value, reason, Proof, or live proposal record changes. Run `discern accept` again to retrieve the current decision.
- Command-owned background children and Git hooks stop before teardown can succeed. A separate program that writes into a removed path later creates a [reappearance](reappeared-worktree-paths.md). Status reports it; confirmed prune is the cleanup path.
- A Proof-note failure leaves the landing recorded and the note pending recovery. Retrying does not land again.
- A first setup-step or convergence failure aborts creation. discern reports later convergence failures without undoing a completed update, blocking session start, or interrupting post-landing cleanup.
- `discern doctor` reports repository layouts that `start` and `accept` cannot use.
- Drop recovery refs keep committed branch tips reachable independently of reflog expiry while they remain in the bounded namespace. They do not make `--force` safe for uncommitted work.
