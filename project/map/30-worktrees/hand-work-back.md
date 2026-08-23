---
title: Hand work back
description: Finish a branch, report its Proof for review, wait for approval, and accept the same validated commit.
order: 140
aliases:
  - handoff
  - hand work back
  - give this back
  - ready for review
  - accept work
---

# Hand work back for review

_Finish the intended commit, report what changed, end with its Proof line, and wait for the owner to decide whether it lands._

A green Gate starts review. Landing remains the owner's decision. Keep the worktree and branch in place until that decision arrives, because they hold the commit, Proof, and local resources under review.

## Finish the branch

Commit the intended tree and bring the latest trunk into the branch with [`discern update`](lifecycle.md#bring-the-trunk-into-the-branch) when the branch is behind. Review any incoming overlap before the final Gate run.

Run `discern done` on the clean final commit. A qualifying green run records a Proof for that `HEAD`: a one-line review claim and a full page listing the jobs, scopes, Standards, and diff command. If the Gate passes without a Proof, follow its hint, make the branch eligible for review, and rerun it.

## Report and wait

Give the owner an account in your own words:

- what changed and why;
- any trade-offs or risks that remain;
- what you exercised beyond the Gate and what you observed;
- the branch or worktree that holds the change.

End the report with `data.proof.line`. Keep the full Proof page out of the message. The owner reads it with `discern status --verbose` and opens the raw change with the diff command named there. [`Status and session hints`](status.md) also exposes the valid Proof from the main checkout's fleet view.

Stop after the Proof line and wait. An uncommitted edit dirties the tree. A later commit changes `HEAD`. Either invalidates the handoff. If review requests a change, make it in the same worktree, commit it, and run `discern done` again before reporting the new Proof.

## Accept after authorization

Every landing needs [landing authority](landing-authority.md): consent from the current conversation, a standing scope grant recorded on the trunk, or a one-worktree effort grant from [the desk](the-desk.md). The shared resolver checks recorded grants directly. `--confirmed` attests only that the owner accepted this landing in the current conversation ([ADR 0194](../_adr/0194-standing-pre-authorization-is-a-recorded-checked-grant.md)).

Acceptance requires a clean branch containing the latest trunk and a tracked-clean main checkout sitting on the trunk. A valid Proof lets acceptance reuse the earlier Gate result. A missing or stale Proof makes acceptance run the full Gate again for the commit it plans to land.

On success, the acceptance result, one-line Proof, and Logbook event name the consent source. discern then fast-forwards the trunk to the validated commit, converges the main checkout, and tears down the worktree. If another line of work moves the trunk first, acceptance keeps this worktree for `update → done → accept`. [Start, update, and accept](lifecycle.md) carries every landing precondition. [Interrupted landing recovery](acceptance-recovery.md) explains journals and `partial_acceptance` results.

You can also supervise a ready branch from [the Desk](the-desk.md). Its Accept action shows the plan, asks for confirmation, and calls the same acceptance core.

## Spin out follow-on work

Ask your agent to use the bundled `discern-delegate-work` Skill when review reveals independent follow-ups or a larger effort needs separate briefs. The Skill prepares self-contained prompts for agents to run in fresh worktrees and hands them back. It assumes you'll launch them yourself. If it can launch them, it shows you the dispatch plan, offers, and waits for confirmation before starting anything.

Leave the ready worktree untouched while its landing decision is pending. Independent follow-ups start from the trunk in separate worktrees. A dependent follow-up starts from the unlanded branch with `discern start --from <ref>` or pulls that ref into its own worktree with `discern update --from <ref>`. [Parallel and team work](team-workflow.md) covers that composition model.

## Where it lives in code

| Concern                           | Source                                                                                                        |
| --------------------------------- | ------------------------------------------------------------------------------------------------------------- |
| Proof creation and relay hints    | [`src/engine/gate/proof_render.ts`](../../../src/engine/gate/proof_render.ts)                                 |
| Acceptance validation and cleanup | [`src/engine/worktree/lifecycle.ts`](../../../src/engine/worktree/lifecycle.ts)                               |
| Landing-authority resolution      | [`src/engine/worktree/landing_authority.ts`](../../../src/engine/worktree/landing_authority.ts)               |
| Consent-source vocabulary         | [`src/shared/consent.ts`](../../../src/shared/consent.ts)                                                     |
| Per-effort grant reader           | [`src/engine/worktree/effort_grant.ts`](../../../src/engine/worktree/effort_grant.ts)                         |
| Delegation procedure              | [`templates/skills/discern-delegate-work/SKILL.md`](../../../templates/skills/discern-delegate-work/SKILL.md) |

## Current state & gotchas

- Any tracked, staged, or untracked change in the worktree blocks acceptance. The main checkout blocks on tracked changes.
- The handoff Proof stays valid only for its clean, committed `HEAD`.
