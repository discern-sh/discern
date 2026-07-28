---
title: Hand work back
description: Finish a branch, report its receipt for review, wait for approval, and accept the work without losing its proof.
order: 90
aliases:
  - handoff
  - hand work back
  - give this back
  - ready for review
  - accept work
---

# Hand work back for review

_Finish the intended commit, report what changed, end with its receipt line, and wait for the owner to decide whether it lands._

A green gate starts review. Landing remains the owner's decision. Keep the worktree and branch in place until that decision arrives, because they hold the commit, receipt, and local resources the review is about.

## Finish the branch

Commit the intended tree and bring the latest trunk into the branch with [`discern update`](lifecycle.md#bring-the-trunk-into-the-branch) when the branch is behind. Review any incoming overlap before calling the work complete.

Run `discern done` on the clean final commit. A qualifying green run records a receipt for that `HEAD`: a one-line review claim and a full page listing the jobs, scopes, standards, and diff command. If the gate passes without a receipt, follow its hint, settle the branch state, and rerun it.

## Report and wait

Give the owner an account in your own words:

- what changed and why;
- any trade-offs or risks that remain;
- what you exercised beyond the gate and what you observed;
- the branch or worktree that holds the change.

End the report with `data.receipt.line`. Keep the full receipt page out of the message. The owner reads it with `discern status --verbose` and opens the raw change with the diff command named there. [`Status and session hints`](status.md) also exposes the honored receipt from the main checkout's fleet view.

Stop after the receipt line and wait. An uncommitted edit dirties the tree. A later commit changes `HEAD`. Either invalidates the handoff. If review requests a change, make it in the same worktree, commit it, and run `discern done` again before reporting the new receipt.

## Accept after authorization

Every landing uses one of three consent sources:

- **Conversation:** after the owner accepts this landing in the current conversation, run `discern accept --confirmed`. The flag attests only to that conversation.
- **Standing grant:** the owner records scope names in the trunk's committed `[acceptance].pre_authorized`. `discern accept` checks every changed path against those scopes and can land without the flag only when all paths are covered.
- **Effort grant:** the owner selects **Pre-authorize landing once green** at [the desk](the-desk.md). The grant belongs to that worktree, authorizes one landing, and is consumed when it lands.

Do not translate either recorded grant into `--confirmed`; discern reads them directly. A path outside every granted scope, including a path no scope classifies, returns the landing to conversation review. Unknown scope names grant nothing. This machine-checked boundary keeps standing pre-authorization separate from remembered permission ([ADR 0194](../_adr/0194-standing-pre-authorization-is-a-recorded-checked-grant.md)).

Acceptance requires a clean branch containing the latest trunk and a tracked-clean main checkout sitting on the trunk. An honored receipt lets acceptance reuse the earlier gate result. A missing or stale receipt makes acceptance run the full gate again for the commit it plans to land.

On success, the acceptance result, one-line receipt, and logbook event name the consent source. discern then fast-forwards the trunk to the validated commit. It refreshes and converges the main checkout, runs the configured smoke job, destroys the worktree's resources, removes the worktree directory, and deletes the merged branch. If another line of work moves the trunk during acceptance, discern refuses before cleanup and keeps the worktree intact. Follow the reported `update → done → accept` recovery. [Start, update, and accept](lifecycle.md) carries every landing precondition and cleanup detail.

You can also supervise a ready branch from [the desk](the-desk.md). Its Accept action shows the plan, asks for confirmation, and calls the same acceptance core.

## Spin out follow-on work

Ask your agent to use the bundled `discern-delegate-work` Skill when review reveals independent follow-ups or a larger effort needs separate briefs. The Skill prepares self-contained prompts for agents to run in fresh worktrees and hands the prompts back by default. If your agent can launch those sessions or worktrees and you prefer that, it can launch them directly.

Leave the ready worktree untouched while its landing decision is pending. Independent follow-ups start from the trunk in separate worktrees. A dependent follow-up starts from the unlanded branch with `discern start --from <ref>` or pulls that ref into its own worktree with `discern update --from <ref>`. [Parallel and team work](team-workflow.md) covers that composition model.

## Where it lives in code

| Concern                           | Source                                                                                                        |
| --------------------------------- | ------------------------------------------------------------------------------------------------------------- |
| Receipt creation and relay hints  | [`src/engine/gate/receipt_render.ts`](../../../src/engine/gate/receipt_render.ts)                             |
| Acceptance validation and cleanup | [`src/engine/worktree/lifecycle.ts`](../../../src/engine/worktree/lifecycle.ts)                               |
| Landing-authority resolution      | [`src/engine/worktree/landing_authority.ts`](../../../src/engine/worktree/landing_authority.ts)               |
| Consent-source vocabulary         | [`src/shared/consent.ts`](../../../src/shared/consent.ts)                                                     |
| Per-effort grant store            | [`src/engine/worktree/effort_grant.ts`](../../../src/engine/worktree/effort_grant.ts)                         |
| Delegation procedure              | [`templates/skills/discern-delegate-work/SKILL.md`](../../../templates/skills/discern-delegate-work/SKILL.md) |

## Current state & gotchas

- `discern accept` without `--confirmed` reads authority evidence but changes nothing unless a verified grant covers the landing.
- Any tracked, staged, or untracked change in the worktree blocks acceptance. The main checkout blocks on tracked changes.
- Post-landing checkout convergence is non-transactional because the trunk has already moved. Acceptance reports a failed refresh, ensure step, smoke job, or tracked-clean check, then still tears down the accepted worktree.
