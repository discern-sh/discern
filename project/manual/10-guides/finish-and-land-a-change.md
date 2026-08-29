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

Use this guide when a coding agent has one owned task to carry from an isolated worktree to the shared trunk. It covers the full handoff: get current, run the relevant checks, produce Proof, return the decision to the person responsible, and land only under verified authority.

A green Gate and a landed change are separate outcomes. Green means one clean commit passed the project's checks. Landed means an authorized acceptance later moved that commit onto the trunk.

## Starting state

- The person has supplied a bounded task and identified any decisions they retain.
- The agent is in the main checkout before a new effort, or in the worktree assigned to this effort.
- The worktree branch contains only this effort's work. Another task's clean worktree is still occupied and must not be adopted.
- The person has not granted landing authority merely by asking for the work. Authority is checked again at acceptance.

## Start an isolated checkout

**Coding agent:** Call `discern_status` first. If the effort already has a worktree, continue there and pass its absolute path to later discern tools. If it has none, call `discern_start` from the main checkout with a short literal name, then re-root into the returned path.

The command-line equivalents are:

```sh
discern status
discern start --name task-name
```

The start result must name a new branch and worktree path. A refusal names the existing state or the prerequisite that failed; follow its recovery instead of creating a second worktree.

## 2. Keep the inner loop short

**Coding agent:** Make the change in that worktree. Run `discern_prepare` after the last edit and whenever you need the fast fix-and-check loop.

```sh
discern prepare
```

Read the complete result. It can rewrite configured files, report a missing related file through coupling, serve a coming checkpoint question, or name a focused reproduction. Review any rewrite before committing it. [Fix a red Gate](fix-a-red-gate.md) covers failure recovery.

## Bring the trunk into the branch

**Coding agent:** If status or a Gate precondition says the branch is behind, call `discern_update`. It brings the trunk into this branch, refreshes generated agent surfaces, and names overlapping incoming files.

```sh
discern update
```

Re-read every overlapping file even when Git merged it cleanly; two compatible patches can still encode incompatible assumptions. Resolve the combined behavior, rerun the relevant focused checks, and commit one logical change at a time.

After the final edit, run `discern_prepare` again and commit every intended byte. The next step needs a clean `HEAD`.

## 4. Produce Proof on the final commit

**Coding agent:** Call `discern_done` on the clean committed tree.

```sh
discern done
```

A successful run produces Proof tied to the branch's current commit. It records the changed files, checks, Standards, and any declared checkpoint conclusions. A dirty run can provide Gate feedback, but it cannot produce landing Proof.

At a decision point:

- If a `stop` checkpoint fires, inspect its matched paths and question. Record `--met <id>` only when the question is satisfied. Record `--unmet <id> --why "…"` when it is not; the Gate may run, while landing waits for the person's variance decision.
- If a job, Standard, generated file, or precondition fails, use the returned diagnostic and next action. Do not treat canceled or skipped jobs as passing.
- If the Gate passes but asks for a real-artifact check, exercise the result along the changed route before handing it back.

## 5. Hand the decision back

**Coding agent:** Report what changed, the behavior you exercised, any decision still held by the person, and the Proof line verbatim. Do not paste the full Proof page.

**Person:** Read the full page with:

```sh
discern status --verbose
```

Review behavior, design, risk, and whether this commit should become shared. Proof removes the need to reconstruct which declared checks passed; it does not make the release decision.

## 6. Apply review feedback without reusing stale evidence

**Coding agent:** Keep review fixes in the same worktree. Any edit or later commit makes the old Proof stale. Repeat the final sequence:

1. make the focused change;
2. run `discern_prepare`;
3. commit;
4. run `discern_done` again.

The replacement Proof must name the commit the person is now considering.

## 7. Land under verified authority

**Person:** Authorize this landing in the current conversation, or rely on an applicable grant already recorded by the project. A standing grant may cover named scopes, and the Desk can grant one worktree. Both remain bounded by the final changed paths.

**Coding agent:** Follow the authority-aware hint and call `discern_accept`.

```sh
discern accept
```

Acceptance rechecks the current Proof, branch, trunk, changed paths, checkpoint declarations, and any Standard proposals. It refuses read-only when authority is absent or incomplete. A standing or one-worktree grant never authorizes an unmet checkpoint variance or a Standard limit proposal; those require the person's explicit approval for the served ids or tokens.

When acceptance succeeds, discern fast-forwards the trunk, records durable landing evidence, converges the main checkout, tears down the worktree resources, removes the checkout, and deletes the merged branch. A later setup or cleanup failure cannot reverse a trunk move, so read `data.landing` before choosing a recovery.

## Completion

The task is complete when `discern accept` reports that the trunk reached the reviewed commit and gives the surviving checkout as the next location. Until then, a green branch is ready for a decision and remains separate from the trunk.

For the authority model and Proof lifetime, read [Proof, review, and authority](../20-understand/proof.md). For exact result fields and flags, use [MCP tools and results](../30-reference/mcp-and-results.md) and the [CLI reference](../30-reference/cli-reference.md). If acceptance was interrupted, continue with [Recover an interrupted task](recover-an-interrupted-task.md).
