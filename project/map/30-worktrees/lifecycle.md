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
  - resume a worktree
  - follow-up fixes
---

# Start, update, and accept a worktree

_Keep the same worktree from the first edit through review feedback and resumed sessions. Update it, verify it, and land the validated commit._

## Start an isolated checkout

From the main checkout, `discern start` creates and readies a worktree, then returns its path. Reuse that checkout for review, fixes, and later sessions; pass its path to discern tools, and ask the owner if it is unavailable. Calling `start` again creates a separate effort. New worktrees branch from the trunk unless `--from <source>` names another ref or an unambiguous worktree id or path ([ADR 0058](../_adr/0058-start-verb-spawn-worktree-from-trunk.md), [ADR 0110](../_adr/0110-the-landing-model.md), [ADR 0359](../_adr/0359-worktree-targets-share-one-resolution-contract.md)).

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

`start` refuses an unborn repository, a missing trunk, a nested `discern.toml`, an unknown or ambiguous `--from` source, an occupied branch or directory, or a call from another worktree. `accept` applies the repository-root boundary too, so a nested project cannot land sibling changes. Main-checkout edits stay there. A failed creation retires only the checkout and branch that call minted; an incomplete discard is part of the reported failure rather than a successful rollback.

## Bring the trunk into the branch

`discern update` merges trunk or `--from`, requires tracked-clean files, and leaves untracked scratch.

discern states its merge topology and status visibility on each Git command. Repository or global values such as `merge.ff`, `branch.<name>.mergeOptions`, `status.showUntrackedFiles`, and `diff.ignoreSubmodules` cannot turn a planned fast-forward into a merge commit or make a safety check overlook work.

Only conflicts confined to [generated artifacts](../00-orientation/glossary.md#generated-artifact) auto-resolve; other conflicts abort. After a merge, `update` runs and commits every generator and tracked refresh output, then runs both ensures. An already-contained source still refreshes and converges. When a no-op update changes tracked paths, `update` names and leaves them for review instead of creating a commit ([ADR 0055](../_adr/0055-update-verb.md), [ADR 0059](../_adr/0059-worktree-setup-ensure.md), [ADR 0153](../_adr/0153-repository-owns-shared-checkout-convergence.md), [ADR 0264](../_adr/0264-tracked-refresh-convergence-precedes-landing.md)). Regeneration uses declared sources instead of conflicted temporary bytes, and failures remain visible ([ADR 0247](../_adr/0247-generated-artifacts-regenerate-never-merge.md)).

On first setup, provisioned linked worktrees install `merge.discern-generated.driver=true` in `config.worktree`. Raw merge keeps the marked side without conflict markers; `done` or `update` regenerates it. Plain clones, CI, and main lack the driver (never global), so conflicts remain; `update` still resolves generated paths. Doctor requires that exact worktree-scoped value and reports its origin. Repair it with `git config --local extensions.worktreeConfig true`, then `git config --worktree merge.discern-generated.driver true` ([ADR 0093](../_adr/0093-upgrade-reconciles-gitignore-block.md)).

Use `[repository].ensure` for checkout-safe commands and `[worktree.setup].ensure` for identity-dependent ones. Each `[worktree.setup].steps` command records `running` before invocation and `completed` after success. Re-entry skips completed identities even when a later setup phase did not finish. A running identity stops automatic replay and serves owner-confirmed mark-complete and retry commands. [Recover an interrupted worktree setup step](../70-reference/worktree-setup-step-recovery.md) covers that recovery ([ADR 0332](../_adr/0332-worktree-setup-steps-preserve-interruption-ambiguity.md)).

## Land the reviewed commit

Commit the final tree and run `discern done`. Landing then needs [landing authority](landing-authority.md): conversation consent, a standing scope grant on the trunk, or a one-worktree effort grant from the Desk. `start`, `status`, and a green `done` report the current authority state. Uncovered work returns to Proof review with every checkout untouched ([ADR 0134](../_adr/0134-accept-attests-consent.md), [ADR 0194](../_adr/0194-standing-pre-authorization-is-a-recorded-checked-grant.md)).

A proposal-bearing Proof adds a separate owner decision. `accept` serves one token per current Standard/value/reason tuple. It refuses without the complete `--approve-standard` set plus `--confirmed`. Standing and effort grants govern landing coverage. They cannot approve a Standard limit proposal. [Landing authority](landing-authority.md#approve-a-standard-limit-proposal) covers the decision and decline path ([ADR 0339](../_adr/0339-proposed-standard-limits-and-shared-measurements.md)).

Acceptance requires the latest trunk, a clean and unlocked worktree, a tracked-clean main checkout on the trunk, and an empty tracked-refresh plan. Ignored or untracked main-checkout data may stay unless landing would overwrite it. Before transaction inspection, acceptance acquires the common-repository boundary and then its checkout boundary. Another conflicting operation receives a no-change refusal and retries after the active operation releases the boundary. A valid `discern done` Proof skips duplicate Gate jobs; any later commit invalidates it. Acceptance checks the current plan again, so an older Proof cannot bypass a newer invariant. A failed check leaves the branch and worktree intact. `discern doctor --verbose` reports the landing-boundary check before the fast-forward, both `done` checkpoints, and `update`'s refresh tail ([ADR 0063](../_adr/0063-doctor-execution-model.md), [ADR 0067](../_adr/0067-accept-validates-the-landed-tree.md), [ADR 0264](../_adr/0264-tracked-refresh-convergence-precedes-landing.md), [ADR 0331](../_adr/0331-common-repository-locks-precede-checkout-locks.md)).

On success, discern records `conversation`, `standing-grant` with scopes, or `effort-grant` in the result, Proof, and Logbook. It records each approved Standard limit proposal. discern fast-forwards the trunk to the commit that passed the Gate. Acceptance does not edit a proposed limit or create a post-Proof commit. It records tracked cleanliness, writes the structured Proof note, materializes local or ignored Agent artifacts, runs `[repository].ensure` and `smoke`, then checks cleanliness again. No tracked refresh writer runs after the fast-forward. discern destroys resources and removes the worktree, which consumes its proposal state. A strict filesystem check and Git registry check must pass before removal completes. discern then deletes the owned branch ([ADR 0098](../_adr/0098-accept-refreshes-the-landing-checkout.md), [ADR 0153](../_adr/0153-repository-owns-shared-checkout-convergence.md), [ADR 0215](../_adr/0215-landing-receipts-travel-as-git-notes.md), [ADR 0264](../_adr/0264-tracked-refresh-convergence-precedes-landing.md), [ADR 0315](../_adr/0315-automatic-worktree-cleanup-requires-recorded-ownership-and-verified-absence.md), [ADR 0339](../_adr/0339-proposed-standard-limits-and-shared-measurements.md)). A concurrent landing keeps this worktree for `update → done → accept`.

The Proof note preserves green landing evidence without adding a trunk commit. Its local write is on by default and fail-open. `[repository].proof_notes = "fetch"` adds fetch transport; publication remains explicit. [Proof notes](../20-quality-gate/proof-notes.md) covers the ref, command, and cross-clone recovery.

Fresh setup uses the same boundary. `discern setup accept` requires current Proof for `discern-setup`; completion replays it read-only or validates the existing clean marker. Acceptance lands the proved commit, or first merges a moved trunk and proves that result. It checks tracked refresh, materializes local agent artifacts, records the Proof note, and retires the local cache. Invalid evidence moves no ref ([ADR 0351](../_adr/0351-setup-completion-replays-proof-and-rolls-back-only-owned-tips.md)).

Acceptance journals its transition and recovers without replaying one-shot authority or overwriting changed checkout data. Post-landing convergence cannot roll the trunk back, so later failures report the effects that already happened and cleanup continues. [Interrupted landing recovery](acceptance-recovery.md) covers the evidence, refusal paths, and `partial_acceptance` result ([ADR 0194](../_adr/0194-standing-pre-authorization-is-a-recorded-checked-grant.md)).

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

Before destructive effects, drop retains the branch's committed tip in a bounded local ref. [Recover a dropped branch](drop-recovery.md) explains the guarantee, its uncommitted-work boundary, and the restore commands. A failed preservation stops the drop intact ([ADR 0271](../_adr/0271-destructive-drops-retain-bounded-recovery-refs.md)).

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
- `accept` removes the worktree, so any tracked, untracked, or staged change there blocks landing. The main checkout blocks only on tracked changes.
- Acceptance reports top-level ignored paths that changed since setup. Those paths stay outside git cleanliness.
- A Standard approval token becomes stale when its name, proposed value, reason, Proof, or live proposal record changes. Run `discern accept` again to retrieve the current decision.
- Command-owned background children and Git hooks stop before teardown can succeed. A separate program that writes into a removed path later creates a [reappearance](reappeared-worktree-paths.md). Status reports it; confirmed prune is the cleanup path.
- Proof-note recording and fetch-configuration reconciliation follow the trunk fast-forward. Their failures report a cause once and cannot fail or undo acceptance; later local-artifact materialization does not retry transport.
- A first setup-step or convergence failure aborts creation. discern reports later convergence failures without undoing a completed update, blocking session start, or interrupting post-landing cleanup.
- `discern doctor` reports repository layouts that `start` and `accept` cannot use.
- Drop recovery refs keep committed branch tips reachable independently of reflog expiry while they remain in the bounded namespace. They do not make `--force` safe for uncommitted work.
