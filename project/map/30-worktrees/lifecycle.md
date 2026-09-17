---
title: Start, update, and accept
description: What discern creates at start, refreshes at update, and removes after a submitted change lands.
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
| Identity             | Exports the deterministic port when `[worktree].export_port` is on.                        |
| One-time setup       | Journals and runs incomplete `[worktree.setup].steps`; completed identities stay complete. |
| Shared convergence   | Runs `[repository].ensure` for checkout-generic dependencies and generated state.          |
| Worktree convergence | Runs `[worktree.setup].ensure` for commands that depend on worktree identity.              |
| Refresh              | Uses the new checkout's engine for shared and checkout-local refresh work.                 |

In a source checkout of discern, the Refresh phase launches that checkout's engine. The child records the `start` invocation as its parent in the [logbook](../70-reference/the-logbook.md#possible-agent-identity-signals), so patterns counts this work as automation. Installed projects refresh in process.

`start` refuses an unborn repository, a missing trunk, a nested `discern.toml`, an unknown or ambiguous `--from` source, an occupied branch or directory, or a call from another worktree. `accept` applies the repository-root boundary too, so a nested project cannot land sibling changes. Main-checkout edits stay there. A failed creation removes only the checkout and branch that call minted; an incomplete discard is part of the reported failure rather than a successful rollback.

## Bring the trunk into the branch

`discern update` merges trunk or `--from`, requires tracked-clean files, and leaves untracked scratch.

discern states its merge topology and status visibility on each Git command. Repository or global values such as `merge.ff`, `branch.<name>.mergeOptions`, `status.showUntrackedFiles`, and `diff.ignoreSubmodules` cannot turn a planned fast-forward into a merge commit or make a safety check overlook work.

Only conflicts confined to [generated artifacts](../00-orientation/glossary.md#generated-artifact) auto-resolve; other conflicts abort. A divergent update first records the Git merge, then records changed generator and tracked-refresh outputs in a distinct discern-authored commit. It never folds regeneration into the merge. An already-contained source still refreshes and converges. When a no-op update changes tracked paths, `update` names and leaves them for review instead of creating a commit ([ADR 0055](../_adr/0055-update-verb.md), [ADR 0059](../_adr/0059-worktree-setup-ensure.md), [ADR 0153](../_adr/0153-repository-owns-shared-checkout-convergence.md), [ADR 0264](../_adr/0264-tracked-refresh-convergence-precedes-landing.md), [ADR 0366](../_adr/0366-landing-is-one-exact-repository-transaction.md)). Regeneration uses declared sources instead of conflicted temporary bytes, and failures remain visible ([ADR 0247](../_adr/0247-generated-artifacts-regenerate-never-merge.md)).

Refresh installs `merge.discern-generated.driver=true` once in the clone's common Git config. The value is effective from the main checkout and every linked worktree; reconciliation removes redundant discern-owned worktree-local copies while preserving unrelated checkout-specific settings. Raw merge keeps a marked side without conflict markers, then `done` or `update` regenerates it. A fresh clone and CI have only the tracked attributes until setup or refresh installs this clone-local value; discern never writes a global definition. Doctor requires the exact shared value and reports its origin. Repair it with `discern refresh` ([ADR 0093](../_adr/0093-upgrade-reconciles-gitignore-block.md), [ADR 0247](../_adr/0247-generated-artifacts-regenerate-never-merge.md)).

Use `[repository].ensure` for checkout-safe commands and `[worktree.setup].ensure` for identity-dependent ones. Each `[worktree.setup].steps` command records `running` before invocation and `completed` after success. Re-entry skips completed identities even when a later setup phase did not finish. A running identity stops automatic replay and serves owner-confirmed mark-complete and retry commands. [Recover an interrupted worktree setup step](../70-reference/worktree-setup-step-recovery.md) covers that recovery ([ADR 0332](../_adr/0332-worktree-setup-steps-preserve-interruption-ambiguity.md)).

## Land the reviewed commit

Commit the final tree and run `discern done`. It proves that `HEAD` against every configured check and standard and records complete Proof for it. Landing then needs [landing authority](landing-authority.md): conversation consent, a standing scope grant on the trunk, or an effort grant from the desk. `start`, `status`, and a green `done` report the current authority state. Uncovered work returns to Proof review with every checkout untouched ([ADR 0134](../_adr/0134-accept-attests-consent.md), [ADR 0194](../_adr/0194-standing-pre-authorization-is-a-recorded-checked-grant.md)).

`discern accept` from the effort's worktree first records the effort's [submission](../00-orientation/glossary.md#submission): the effort, its branch, the exact `HEAD`, and the Proof that covers it, written beside the effort grant under the worktree's Git administration directory so no branch can forge it ([`submission.ts`](../../../src/engine/worktree/submission.ts)). A later `accept` from the same effort replaces it, a landing consumes it, and dropping the worktree removes it. The landing queue is the list of submissions with honored Proof that have not landed; a green run its agent never submitted is absent and lands only by the owner's explicit act, from its worktree with `--target` and conversational consent or from the desk ([ADR 0389](../_adr/0389-the-workspace-contract.md)).

A proposal-bearing Proof adds a separate owner decision. `accept` serves one token per current standard/value/reason tuple. It refuses without the complete `--approve-standard` set plus `--confirmed`. Standing and effort grants govern landing coverage; they cannot approve a standard limit proposal. [Landing authority](landing-authority.md#approve-a-standard-limit-proposal) covers the decision and decline path ([ADR 0339](../_adr/0339-proposed-standard-limits-and-shared-measurements.md)).

Acceptance requires honored complete Proof, an unlocked worktree, and a readable tracked-clean main checkout on the trunk with no in-progress merge, `rebase`, or cherry-pick; the direct fast-forward additionally requires the Proof to name the current trunk tip as its predecessor, a clean worktree, and an empty tracked-refresh plan. When the trunk moved after the Proof, `accept` composes instead of refusing: it freezes the submitted revision and its evidence, creates an [integration worktree](../00-orientation/glossary.md#integration-worktree) from that exact commit through the same creation core `start` uses, brings the trunk in through the update core, proves the combined committed tree with the gate core, rechecks authority over the composed diff, and advances the trunk to that exact proven commit — composing again once if the trunk moves during the checks and stopping with an explicit retry route if it moves again. Ancestry decides the shape, never queue length. A conflict or red combined check removes the copy and returns to the author with the exact files or failing check named; author work that arrives during checking is excluded and preserved ([ADR 0391](../_adr/0391-landings-compose-a-moved-trunk-in-an-integration-worktree.md)). A checkpoint question fired by the combined result — a judgment stop, distinct from an executed check that failed — retains the copy in the record's awaiting-judgment phase and returns read-only with the served questions and the composition's receipt; `discern accept --met`/`--unmet --composition-receipt <receipt>` re-verifies the receipt, the submission, the expected trunk, and the composed commit, records the conclusions against the copy's own open questions, and continues the landing, while a declared-unmet conclusion serves the owner's variance over the combined result's own binding, receipt included. An answer whose composition was replaced refuses unrecorded; a stale retained copy — moved trunk, replacement submission, changed tree — is discarded, never answered; a superseded copy whose cleanup fails blocks replacement with the failures and the prune route, keeping one continuation per submission; and a direct landing discards the copy it supersedes ([ADR 0395](../_adr/0395-integration-judgments-continue-the-retained-landing.md)). Before its first evidence read, applied acceptance acquires its acceptance lock and author checkout. Short transition publications acquire the common boundary; checks, convergence, and cleanup retain their own ownership outside it. A second `accept` waits its turn, reports the running handle, and resumes after the holder finishes. Target reservations and resource leases preserve exclusion during lifecycle commands without blocking sibling completion publications ([operation effects and exclusion](../50-engine-internals/operation-effects-and-locks.md)). Acceptance checks the current plan again, so an older Proof cannot bypass a newer invariant. An unreadable precondition refuses instead of becoming a clean fact. A failed check leaves the branch and worktree intact ([ADR 0063](../_adr/0063-doctor-execution-model.md), [ADR 0067](../_adr/0067-accept-validates-the-landed-tree.md), [ADR 0264](../_adr/0264-tracked-refresh-convergence-precedes-landing.md), [ADR 0331](../_adr/0331-common-repository-locks-precede-checkout-locks.md), [ADR 0366](../_adr/0366-landing-is-one-exact-repository-transaction.md)).

On success, discern records `conversation`, `standing-grant` with scopes, or `effort-grant` in the result, Proof, and logbook, and records each approved standard limit proposal. Under the acceptance transaction it writes the journal first, then moves the trunk and creates the marker ref in one Git ref transaction, so an interrupted landing completes or rolls back on retry and never lands twice. The trunk advances to the exact proven commit — the submitted revision on the direct path, the composed commit the integration gate proved otherwise: acceptance never squashes, runs a `rebase`, or substitutes an unproven commit, and it never edits a proposed limit or creates a post-Proof commit of its own. It records tracked cleanliness, writes the structured Proof note, materializes local or ignored agent artifacts, runs `[repository].ensure` and `smoke` in the main checkout, then checks cleanliness again. No tracked refresh writer runs after the fast-forward. It then destroys the effort's resources, removes the checkout, and deletes the branch when the branch holds nothing beyond the landed submission. A strict filesystem check and Git registry check must pass before removal completes ([ADR 0098](../_adr/0098-accept-refreshes-the-landing-checkout.md), [ADR 0110](../_adr/0110-the-landing-model.md), [ADR 0153](../_adr/0153-repository-owns-shared-checkout-convergence.md), [ADR 0215](../_adr/0215-landing-receipts-travel-as-git-notes.md), [ADR 0315](../_adr/0315-automatic-worktree-cleanup-requires-recorded-ownership-and-verified-absence.md), [ADR 0339](../_adr/0339-proposed-standard-limits-and-shared-measurements.md)).

When the branch holds later commits — an integrated landing compares against the submitted revision, so work added during checking counts — the checkout and branch stay, and the result's first sentence says so and names `discern done` then `discern accept` for them. When cleanup cannot complete for another reason, the landing stands and the first sentence names `discern worktree prune`. A Proof-note failure leaves the landing recorded and the note pending recovery; retrying does not land again. With `--target`, the selected submission lands first and the remaining submissions follow the queue's one canonical ordering under their own recorded grants, stopping at the first refusal or failure; `data.landings` reports every attempted landing with the selected member marked, and a stopped walk makes the call false without implying anything landed was undone.

The Proof note preserves green landing evidence without adding a trunk commit. Its local write is on by default and fail-open. `[repository].proof_notes_mode = "fetch"` adds fetch transport; publication remains explicit. [Proof notes](../20-quality-gate/proof-notes.md) covers the ref, command, and cross-clone recovery.

Acceptance journals its transition in the worktree's Git administration and recovers without replaying one-shot authority or overwriting changed checkout data. Post-landing convergence cannot roll the trunk back, so later failures report the effects that already happened and cleanup continues. [Interrupted landing recovery](acceptance-recovery.md) covers the evidence, refusal paths, and `partial_acceptance` result ([ADR 0194](../_adr/0194-standing-pre-authorization-is-a-recorded-checked-grant.md), [ADR 0366](../_adr/0366-landing-is-one-exact-repository-transaction.md)).

Fresh setup uses the same boundary. `discern setup accept` requires current Proof for `discern-setup`; completion replays it read-only or validates the existing clean marker. Acceptance lands the proved commit, or first merges a moved trunk into the setup checkout and proves that result. It checks tracked refresh, materializes local agent artifacts, records the Proof note, and removes the local cache. Invalid evidence moves no ref ([ADR 0351](../_adr/0351-setup-completion-replays-proof-and-rolls-back-only-owned-tips.md)).

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

Park reads the plan again before resource cleanup and checks the task again after cleanup. A changed branch, checkout, or resource set stops removal. If resource cleanup completed before a later check refused, run the named `discern worktree setup` recovery in the checkout that stayed, review the refreshed state, and retry Park ([ADR 0358](../_adr/0358-recovery-observes-before-repair-and-park-preserves-the-branch.md)).

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
| Submission record             | [`src/engine/worktree/submission.ts`](../../../src/engine/worktree/submission.ts)                         |
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
| Submission tests              | [`tests/engine_submission_test.ts`](../../../tests/engine_submission_test.ts)                             |
| Generated-update tests        | [`tests/engine_generated_update_test.ts`](../../../tests/engine_generated_update_test.ts)                 |

## Current state and gotchas

- Every effectful lifecycle command supports `--dry-run`; inspect destructive plans before applying them ([ADR 0027](../_adr/0027-plan-apply-engine-execution.md)).
- `accept` removes the worktree, so any tracked, untracked, or staged change there blocks landing. The main checkout blocks only on tracked changes.
- Acceptance reports top-level ignored paths that changed since setup. Those paths stay outside git cleanliness.
- A Standard approval token becomes stale when its name, proposed value, reason, Proof, or live proposal record changes. Run `discern accept` again to retrieve the current decision.
- Command-owned background children and Git hooks stop before teardown can succeed. A separate program that writes into a removed path later creates a [reappearance](reappeared-worktree-paths.md). Status reports it; confirmed prune is the cleanup path.
- A Proof-note failure leaves the landing recorded and the note pending recovery. Retrying does not land again.
- A first setup-step or convergence failure aborts creation. discern reports later convergence failures without undoing a completed update, blocking session start, or interrupting post-landing cleanup.
- `discern doctor` reports repository layouts that `start` and `accept` cannot use.
- Drop recovery refs keep committed branch tips reachable independently of reflog expiry while they remain in the bounded namespace. They do not make `--force` safe for uncommitted work.
