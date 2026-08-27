---
id: guide-finish-and-land-a-change
title: "Finish and land a change"
description: "Prepare, prove, review, hand back, authorize, and land one exact worktree change."
order: 20
publish: true
kind: guide
aliases:
  - "guide-finish-and-land-a-change"
  - "Start, update, and accept a worktree"
  - "worktree lifecycle"
  - "can't edit main"
  - "update my branch"
  - "resume a worktree"
  - "follow-up fixes"
  - "Hand work back for review"
  - "handoff"
  - "hand work back"
  - "give this back"
  - "ready for review"
  - "accept work"
redirect_from:
  - "/docs/worktrees/lifecycle"
  - "/docs/worktrees/hand-work-back"
---

# Finish and land a change

Prepare, prove, review, hand back, authorize, and land one exact worktree change.

## Start, update, and accept a worktree

_Keep the same worktree from the first edit through review feedback and resumed sessions. Update it, verify it, and land the validated commit._

### Start an isolated checkout

From the main checkout, `discern start` creates and readies a worktree, then returns its path. Reuse that checkout for review, fixes, and later sessions; pass its path to discern tools, and ask the owner if it is unavailable. Calling `start` again creates a separate effort. New worktrees branch from the trunk unless `--from <ref>` names other work ([ADR 0058](https://discern.sh/docs/decisions/0058-start-verb-spawn-worktree-from-trunk), [ADR 0110](https://discern.sh/docs/decisions/0110-the-landing-model)).

`start` probes Git and destination write access before creation. A later failure tears resources down only if the worktree exists ([ADR 0338](https://discern.sh/docs/decisions/0338-operation-policy-enrolls-git-write-authority)).

An optional name becomes a branch-safe slug; otherwise discern generates a codename. It checks the directory, branch, and port for collisions first ([ADR 0109](https://discern.sh/docs/decisions/0109-worktree-start-optional-name)).

The default is `<repo>.worktrees/<id>` beside the repository; `[worktree].root` overrides it. Nested worktrees confuse recursive tools and root discovery ([ADR 0052](https://discern.sh/docs/decisions/0052-worktree-sibling-placement)).

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

`start` refuses an unborn repository, a missing trunk, a nested `discern.toml`, an unknown or ambiguous `--from` ref, an occupied branch or directory, or a call from another worktree. `accept` applies the repository-root boundary too, so a nested project cannot land sibling changes. Main-checkout edits stay there. A failed creation retires only the checkout and branch that call minted; an incomplete discard is part of the reported failure rather than a successful rollback.

### Bring the trunk into the branch

`discern update` merges trunk or `--from`, requires tracked-clean files, and leaves untracked scratch.

discern states its merge topology and status visibility on each Git command. Repository or global values such as `merge.ff`, `branch.<name>.mergeOptions`, `status.showUntrackedFiles`, and `diff.ignoreSubmodules` cannot turn a planned fast-forward into a merge commit or make a safety check overlook work.

Only conflicts confined to [generated artifacts](../30-reference/glossary.md#generated-artifact) auto-resolve; other conflicts abort. After a merge, `update` runs and commits every generator and tracked refresh output, then runs both ensures. An already-contained source still refreshes and converges. When a no-op update changes tracked paths, `update` names and leaves them for review instead of creating a commit ([ADR 0055](https://discern.sh/docs/decisions/0055-update-verb), [ADR 0059](https://discern.sh/docs/decisions/0059-worktree-setup-ensure), [ADR 0153](https://discern.sh/docs/decisions/0153-repository-owns-shared-checkout-convergence), [ADR 0264](https://discern.sh/docs/decisions/0264-tracked-refresh-convergence-precedes-landing)). Regeneration uses declared sources instead of conflicted temporary bytes, and failures remain visible ([ADR 0247](https://discern.sh/docs/decisions/0247-generated-artifacts-regenerate-never-merge)).

On first setup, provisioned linked worktrees install `merge.discern-generated.driver=true` in `config.worktree`. Raw merge keeps the marked side without conflict markers; `done` or `update` regenerates it. Plain clones, CI, and main lack the driver (never global), so conflicts remain; `update` still resolves generated paths. Doctor requires that exact worktree-scoped value and reports its origin. Repair it with `git config --local extensions.worktreeConfig true`, then `git config --worktree merge.discern-generated.driver true` ([ADR 0093](https://discern.sh/docs/decisions/0093-upgrade-reconciles-gitignore-block)).

Use `[repository].ensure` for checkout-safe commands and `[worktree.setup].ensure` for identity-dependent ones. Each `[worktree.setup].steps` command records `running` before invocation and `completed` after success. Re-entry skips completed identities even when a later setup phase did not finish. A running identity stops automatic replay and serves owner-confirmed mark-complete and retry commands. [Recover an interrupted worktree setup step](../40-troubleshooting/setup-and-integrations.md) covers that recovery ([ADR 0332](https://discern.sh/docs/decisions/0332-worktree-setup-steps-preserve-interruption-ambiguity)).

### Land the reviewed commit

Commit the final tree and run `discern done`. Landing then needs [landing authority](../20-understand/proof.md): conversation consent, a standing scope grant on the trunk, or a one-worktree effort grant from the Desk. `start`, `status`, and a green `done` report the current authority state. Uncovered work returns to Proof review with every checkout untouched ([ADR 0134](https://discern.sh/docs/decisions/0134-accept-attests-consent), [ADR 0194](https://discern.sh/docs/decisions/0194-standing-pre-authorization-is-a-recorded-checked-grant)).

A proposal-bearing Proof adds a separate owner decision. `accept` serves one token per current Standard/value/reason tuple. It refuses without the complete `--approve-standard` set plus `--confirmed`. Standing and effort grants govern landing coverage. They cannot approve a Standard limit proposal. [Landing authority](../20-understand/proof.md#approve-a-standard-limit-proposal) covers the decision and decline path ([ADR 0339](https://discern.sh/docs/decisions/0339-proposed-standard-limits-and-shared-measurements)).

Acceptance requires the latest trunk, a clean and unlocked worktree, a tracked-clean main checkout on the trunk, and an empty tracked-refresh plan. Ignored or untracked main-checkout data may stay unless landing would overwrite it. Before transaction inspection, acceptance acquires the common-repository boundary and then its checkout boundary. Another conflicting operation receives a no-change refusal and retries after the active operation releases the boundary. A valid `discern done` Proof skips duplicate Gate jobs; any later commit invalidates it. Acceptance checks the current plan again, so an older Proof cannot bypass a newer invariant. A failed check leaves the branch and worktree intact. `discern doctor --verbose` reports the landing-boundary check before the fast-forward, both `done` checkpoints, and `update`'s refresh tail ([ADR 0063](https://discern.sh/docs/decisions/0063-doctor-execution-model), [ADR 0067](https://discern.sh/docs/decisions/0067-accept-validates-the-landed-tree), [ADR 0264](https://discern.sh/docs/decisions/0264-tracked-refresh-convergence-precedes-landing), [ADR 0331](https://discern.sh/docs/decisions/0331-common-repository-locks-precede-checkout-locks)).

On success, discern records `conversation`, `standing-grant` with scopes, or `effort-grant` in the result, Proof, and Logbook. It records each approved Standard limit proposal. discern fast-forwards the trunk to the commit that passed the Gate. Acceptance does not edit a proposed limit or create a post-Proof commit. It records tracked cleanliness, writes the structured Proof note, materializes local or ignored Agent artifacts, runs `[repository].ensure` and `smoke`, then checks cleanliness again. No tracked refresh writer runs after the fast-forward. discern destroys resources and removes the worktree, which consumes its proposal state. A strict filesystem check and Git registry check must pass before removal completes. discern then deletes the owned branch ([ADR 0098](https://discern.sh/docs/decisions/0098-accept-refreshes-the-landing-checkout), [ADR 0153](https://discern.sh/docs/decisions/0153-repository-owns-shared-checkout-convergence), [ADR 0215](https://discern.sh/docs/decisions/0215-landing-receipts-travel-as-git-notes), [ADR 0264](https://discern.sh/docs/decisions/0264-tracked-refresh-convergence-precedes-landing), [ADR 0315](https://discern.sh/docs/decisions/0315-automatic-worktree-cleanup-requires-recorded-ownership-and-verified-absence), [ADR 0339](https://discern.sh/docs/decisions/0339-proposed-standard-limits-and-shared-measurements)). A concurrent landing keeps this worktree for `update → done → accept`.

The Proof note preserves green landing evidence without adding a trunk commit. Its local write is on by default and fail-open. `[repository].proof_notes = "fetch"` adds fetch transport; publication remains explicit. [Proof notes](../30-reference/proof-and-checkpoint-formats.md) covers the ref, command, and cross-clone recovery.

Fresh setup uses the same boundary. `discern setup accept` requires current Proof for `discern-setup`; completion replays it read-only or validates the existing clean marker. Acceptance lands the proved commit, or first merges a moved trunk and proves that result. It checks tracked refresh, materializes local agent artifacts, records the Proof note, and retires the local cache. Invalid evidence moves no ref ([ADR 0351](https://discern.sh/docs/decisions/0351-setup-completion-replays-proof-and-rolls-back-only-owned-tips)).

Acceptance journals its transition and recovers without replaying one-shot authority or overwriting changed checkout data. Post-landing convergence cannot roll the trunk back, so later failures report the effects that already happened and cleanup continues. [Interrupted landing recovery](recover-an-interrupted-task.md) covers the evidence, refusal paths, and `partial_acceptance` result ([ADR 0194](https://discern.sh/docs/decisions/0194-standing-pre-authorization-is-a-recorded-checked-grant)).

### Remove abandoned work

From the main checkout, `discern worktree drop <id|path>` removes an abandoned worktree. A bare id or directory name must identify 1 registered worktree. If several paths share it, discern lists them and requires the selected path. Uncommitted or unlanded work needs explicit `--force`. A Git lock still protects it. If Git cannot read the worktree's status, discern treats its cleanliness as unknown and requires `--force`. The command is CLI-only because discarding another line of work requires a person's local decision. An explicitly selected foreign checkout can be removed while its branch stays.

Before destructive effects, drop retains the branch's committed tip in a bounded local ref. [Recover a dropped branch](recover-an-interrupted-task.md) explains the guarantee, its uncommitted-work boundary, and the restore commands. A failed preservation stops the drop intact ([ADR 0271](https://discern.sh/docs/decisions/0271-destructive-drops-retain-bounded-recovery-refs)).

After confirmation, `discern worktree prune` removes clean merged worktrees, stale registrations, orphan directories, reappeared worktree paths, and resource records only from evidence-backed candidate sets. [Cleanup ownership and teardown](../40-troubleshooting/worktrees-and-resources.md) defines the shared ownership rule, dry-run/apply parity, successful-absence condition, and interrupted recovery. Merge status alone never puts a branch or path in the plan.

[Cleaning up a reappeared worktree path](../40-troubleshooting/worktrees-and-resources.md) explains the removal evidence, status notice, and confirmed prune boundary.

Prune also reports **contained** worktrees: spent `start --from` stages whose commits already travel inside a live sibling branch. The default apply never touches them. [Reclaiming contained worktrees](../40-troubleshooting/worktrees-and-resources.md) covers the predicate, the `--contained` opt-in, and the kept branch refs.

### Where it lives in code

| Responsibility                | Source                                                                                                                                       |
| ----------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------- |
| Lifecycle plans and execution | [`src/engine/worktree/lifecycle.ts`](https://github.com/jackwh/discern/blob/main/src/engine/worktree/lifecycle.ts)                           |
| Acceptance recovery journal   | [`src/engine/worktree/acceptance_transaction.ts`](https://github.com/jackwh/discern/blob/main/src/engine/worktree/acceptance_transaction.ts) |
| Setup-step journal            | [`src/engine/worktree/setup_step_journal.ts`](https://github.com/jackwh/discern/blob/main/src/engine/worktree/setup_step_journal.ts)         |
| Operation exclusion           | [`src/engine/operation_lock.ts`](https://github.com/jackwh/discern/blob/main/src/engine/operation_lock.ts)                                   |
| Landing-authority resolution  | [`src/engine/worktree/landing_authority.ts`](https://github.com/jackwh/discern/blob/main/src/engine/worktree/landing_authority.ts)           |
| Proof-note recording          | [`src/engine/gate/proof_notes.ts`](https://github.com/jackwh/discern/blob/main/src/engine/gate/proof_notes.ts)                               |
| Git preconditions and removal | [`src/engine/worktree/git.ts`](https://github.com/jackwh/discern/blob/main/src/engine/worktree/git.ts)                                       |
| Branch ownership              | [`src/engine/worktree/ownership.ts`](https://github.com/jackwh/discern/blob/main/src/engine/worktree/ownership.ts)                           |
| Drop recovery refs            | [`src/engine/worktree/recovery_refs.ts`](https://github.com/jackwh/discern/blob/main/src/engine/worktree/recovery_refs.ts)                   |
| Contained-worktree scan       | [`src/engine/worktree/containment.ts`](https://github.com/jackwh/discern/blob/main/src/engine/worktree/containment.ts)                       |
| Plan rendering                | [`src/engine/worktree/plan.ts`](https://github.com/jackwh/discern/blob/main/src/engine/worktree/plan.ts)                                     |
| Lifecycle tests               | [`tests/engine_worktree_test.ts`](https://github.com/jackwh/discern/blob/main/tests/engine_worktree_test.ts)                                 |
| Generated-update tests        | [`tests/engine_generated_update_test.ts`](https://github.com/jackwh/discern/blob/main/tests/engine_generated_update_test.ts)                 |

### Current state and gotchas

- Every effectful lifecycle command supports `--dry-run`; inspect destructive plans before applying them ([ADR 0027](https://discern.sh/docs/decisions/0027-plan-apply-engine-execution)).
- `accept` removes the worktree, so any tracked, untracked, or staged change there blocks landing. The main checkout blocks only on tracked changes.
- Acceptance reports top-level ignored paths that changed since setup. Those paths stay outside git cleanliness.
- A Standard approval token becomes stale when its name, proposed value, reason, Proof, or live proposal record changes. Run `discern accept` again to retrieve the current decision.
- Command-owned background children and Git hooks stop before teardown can succeed. A separate program that writes into a removed path later creates a [reappearance](../40-troubleshooting/worktrees-and-resources.md). Status reports it; confirmed prune is the cleanup path.
- Proof-note recording and fetch-configuration reconciliation follow the trunk fast-forward. Their failures report a cause once and cannot fail or undo acceptance; later local-artifact materialization does not retry transport.
- A first setup-step or convergence failure aborts creation. discern reports later convergence failures without undoing a completed update, blocking session start, or interrupting post-landing cleanup.
- `discern doctor` reports repository layouts that `start` and `accept` cannot use.
- Drop recovery refs keep committed branch tips reachable independently of reflog expiry while they remain in the bounded namespace. They do not make `--force` safe for uncommitted work.

## Hand work back for review

_Finish the intended commit, report what changed, end with its Proof line, and wait for the owner to decide whether it lands._

A green Gate starts review. Landing remains the owner's decision. Keep the worktree and branch in place until that decision arrives, because they hold the commit, Proof, and local resources under review.

### Finish the branch

Commit the intended tree and bring the latest trunk into the branch with [`discern update`](finish-and-land-a-change.md#bring-the-trunk-into-the-branch) when the branch is behind. Review any incoming overlap before the final Gate run.

Run `discern done` on the clean final commit. A qualifying green run records a Proof for that `HEAD`: a one-line review claim and a full page listing the jobs, scopes, Standards, and diff command. If the Gate passes without a Proof, follow its hint, make the branch eligible for review, and rerun it.

### Report and wait

Give the owner an account in your own words:

- what changed and why;
- any trade-offs or risks that remain;
- what you exercised beyond the Gate and what you observed;
- the branch or worktree that holds the change.

End the report with `data.proof.line`. Keep the full Proof page out of the message. The owner reads it with `discern status --verbose` and opens the raw change with the diff command named there. [`Status and session hints`](../30-reference/worktrees-and-status.md) also exposes the valid Proof from the main checkout's fleet view.

Stop after the Proof line and wait. An uncommitted edit dirties the tree. A later commit changes `HEAD`. Either invalidates the handoff. If review requests a change, make it in the same worktree, commit it, and run `discern done` again before reporting the new Proof.

### Accept after authorization

Every landing needs [landing authority](../20-understand/proof.md): consent from the current conversation, a standing scope grant recorded on the trunk, or a one-worktree effort grant from [the desk](delegate-work.md). The shared resolver checks recorded grants directly. `--confirmed` attests only that the owner accepted this landing in the current conversation ([ADR 0194](https://discern.sh/docs/decisions/0194-standing-pre-authorization-is-a-recorded-checked-grant)).

Acceptance requires a clean branch containing the latest trunk and a tracked-clean main checkout sitting on the trunk. A valid Proof lets acceptance reuse the earlier Gate result. A missing or stale Proof makes acceptance run the full Gate again for the commit it plans to land.

On success, the acceptance result, one-line Proof, and Logbook event name the consent source. discern then fast-forwards the trunk to the validated commit, converges the main checkout, and tears down the worktree. If another line of work moves the trunk first, acceptance keeps this worktree for `update → done → accept`. [Start, update, and accept](finish-and-land-a-change.md) carries every landing precondition. [Interrupted landing recovery](recover-an-interrupted-task.md) explains journals and `partial_acceptance` results.

You can also supervise a ready branch from [the Desk](delegate-work.md). Its Accept action shows the plan, asks for confirmation, and calls the same acceptance core.

### Spin out follow-on work

Ask your agent to use the bundled `discern-delegate-work` Skill when review reveals independent follow-ups or a larger effort needs separate briefs. The Skill prepares self-contained prompts for agents to run in fresh worktrees and hands them back. It assumes you'll launch them yourself. If it can launch them, it shows you the dispatch plan, offers, and waits for confirmation before starting anything.

Leave the ready worktree untouched while its landing decision is pending. Independent follow-ups start from the trunk in separate worktrees. A dependent follow-up starts from the unlanded branch with `discern start --from <ref>` or pulls that ref into its own worktree with `discern update --from <ref>`. [Parallel and team work](coordinate-parallel-tasks.md) covers that composition model.

### Where it lives in code

| Concern                           | Source                                                                                                                                           |
| --------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------ |
| Proof creation and relay hints    | [`src/engine/gate/proof_render.ts`](https://github.com/jackwh/discern/blob/main/src/engine/gate/proof_render.ts)                                 |
| Acceptance validation and cleanup | [`src/engine/worktree/lifecycle.ts`](https://github.com/jackwh/discern/blob/main/src/engine/worktree/lifecycle.ts)                               |
| Landing-authority resolution      | [`src/engine/worktree/landing_authority.ts`](https://github.com/jackwh/discern/blob/main/src/engine/worktree/landing_authority.ts)               |
| Consent-source vocabulary         | [`src/shared/consent.ts`](https://github.com/jackwh/discern/blob/main/src/shared/consent.ts)                                                     |
| Per-effort grant reader           | [`src/engine/worktree/effort_grant.ts`](https://github.com/jackwh/discern/blob/main/src/engine/worktree/effort_grant.ts)                         |
| Delegation procedure              | [`templates/skills/discern-delegate-work/SKILL.md`](https://github.com/jackwh/discern/blob/main/templates/skills/discern-delegate-work/SKILL.md) |

### Current state & gotchas

- Any tracked, staged, or untracked change in the worktree blocks acceptance. The main checkout blocks on tracked changes.
- The handoff Proof stays valid only for its clean, committed `HEAD`.
