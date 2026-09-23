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

A green gate starts review. Landing remains the owner's decision. Keep the source branch available until that decision arrives. Complete evidence lives in common Git administration; the worktree holds the authoring checkout, its Proof marker, its submission, and its local resources.

## Finish the branch

Commit the intended tree and bring the latest trunk into the branch with [`discern update`](lifecycle.md#bring-the-trunk-into-the-branch) when the branch is behind. Review any incoming overlap before the final gate run.

Run `discern done` on the clean final commit. A qualifying green run records a Proof for that `HEAD`: a one-line review claim and a full page listing the jobs, scopes, Standards, and diff command. If the gate passes without a Proof, follow its hint, make the branch eligible for review, and rerun it.

## Report and wait

Give the owner an account in your own words:

- what changed and why;
- any trade-offs or risks that remain;
- what you exercised beyond the Gate and what you observed;
- the branch or worktree that holds the change.

End the report with `data.proof.line`. Keep the full Proof page out of the message. The owner reads it with `discern status --verbose` and opens the raw change with the diff command named there. [`Status and session hints`](status.md) also exposes the valid Proof from the main checkout's fleet view.

Stop after the Proof line and wait. An uncommitted edit dirties the tree. A later commit changes `HEAD`. Either invalidates the handoff. If review requests a change, make it in the same worktree, commit it, and run `discern done` again before reporting the new Proof.

## Accept after authorization

Every landing needs [landing authority](landing-authority.md): consent from the current conversation, a standing scope grant recorded on the trunk, or an effort grant from [the desk](the-desk.md) that covers the effort's branch. The shared resolver checks recorded grants directly. `--confirmed` attests only that the owner accepted this landing in the current conversation ([ADR 0194](../_adr/0194-standing-pre-authorization-is-a-recorded-checked-grant.md)).

Run `discern accept` from the worktree. It records the effort's submission, the exact `HEAD` and its Proof, and lands it when authority is verified; without authority it refuses read-only and the submission waits in the landing queue for the owner. Acceptance requires a tracked-clean main checkout sitting on the trunk. When the trunk moved after the Proof, acceptance combines the submission with the current trunk in an [integration worktree](../00-orientation/glossary.md#integration-worktree), proves that combined commit, and lands what passed. A conflict or failed combined check lands nothing and names the files or check for the effort's agent to fix ([Land the reviewed commit](lifecycle.md#land-the-reviewed-commit), [ADR 0391](../_adr/0391-landings-compose-a-moved-trunk-in-an-integration-worktree.md)).

A landing advances the trunk to the submitted commit, or to the proven combined commit when the trunk moved, records the Proof note, converges the main checkout, and removes the worktree, its resources, and its branch when the branch holds nothing beyond the submission. A branch with later commits stays, with `discern done` then `discern accept` as the route. A failed note or cleanup cannot repeat landing or spend authority again. [Start, update, and accept](lifecycle.md) explains the states; [interrupted landing recovery](acceptance-recovery.md) covers partial progress and retry.

You can also supervise a ready branch from [the desk](the-desk.md). Its accept action shows the plan, asks for confirmation, and calls the same acceptance core.

## Spin out follow-on work

Ask your agent to use the bundled `discern-delegate-work` Skill when review reveals independent follow-ups or a larger effort needs separate briefs. The skill prepares self-contained prompts for agents to run in fresh worktrees and hands them back. It assumes you'll launch them yourself. If it can launch them, it shows you the dispatch plan, offers, and waits for confirmation before starting anything.

Leave the ready worktree untouched while its landing decision is pending. Independent follow-ups start from the trunk in separate worktrees. A dependent follow-up starts from the unlanded work with `discern start --from <source>` or pulls that source into its own worktree with `discern update --from <source>`; the source may be a ref or an unambiguous worktree id or path. [Parallel and team work](team-workflow.md) covers that composition model.

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
- The handoff Proof binds the exact `HEAD` and its complete evidence; the submission names that commit.
