---
title: Emergency integration
description: Review and record an explicit local integration before required machine validation finishes.
---

# Emergency integration

`discern accept emergency --reason "Restore service"` presents the source, actual trunk, reason, and failed, not yet run, or stale machine obligations for owner review. It issues no passing Proof. Ordinary acceptance still requires complete strict evidence.

The repair must be committed in its recorded worktree and contain actual trunk. If it is behind, run `discern update`, review and commit the result, then request another plan. It refuses a source containing another recorded unlanded effort. Checkpoint judgment, protected policy, and source identity remain preconditions.

## Checkpoint preparation

When checkpoint triggers or declarations are pending, run `discern accept emergency --prepare --reason "Restore service"`. This runs only the canonical checkpoint preflight and serves its questions. Repeat with `--met <id>` for each satisfied served question. An unmet question or unreadable trigger evidence still blocks emergency integration. `--dry-run` previews preparation without running triggers or recording conclusions.

The [preparation action](../../../src/engine/emergency/prepare.ts) retains an immutable review receipt after rechecking clean source and actual trunk. Pass the returned `--preparation <receipt>` to both the owner-review preview and its later confirmed call. The [receipt reader](../../../src/engine/emergency/review.ts) checks its bytes, exact source and predecessor, and current declarations before accepting settled trigger evidence. Changes require renewed preparation. The exception record retains this receipt separately from machine evidence and passing Proof.

## Exact owner decision

The preview changes no project state. After the owner approves the displayed plan, repeat the emergency action with the same reason, `--confirmed`, its `--confirmation` token, and the same preparation receipt when present. A token expires after 15 minutes. Source, trunk, policy, reason, and exception changes invalidate it. An ordinary grant or previous emergency supplies no consent.

The [planner](../../../src/engine/emergency/plan.ts) binds this exchange. The [machine inventory](../../../src/engine/emergency/evidence.ts) uses the ordinary evidence selector and artifact audit. A failed standard remains failed when its producer exited successfully. A check that never ran remains `unrun`; inapplicable or report-only evidence remains stale.

## Integration and recovery

The action records the immutable exception subject before moving the trunk through the [acceptance transaction](../../../src/engine/worktree/acceptance_transaction.ts). The expected trunk, source ref, receiving checkout, and recovery marker retain their ordinary checks. Cleanup follows the ordinary landing rule: the worktree, its resources, and its branch go when the branch holds nothing beyond the landed repair; otherwise the checkout stays and the result says so. The public result keeps that state separate from failed convergence or interrupted cleanup, and never supplies ordinary Proof.

`discern accept emergency --recover <landing-id>` reconciles only the recorded transition, note publication, receiving-checkout convergence, and cleanup. A pre-transition interruption remains unlanded. A post-transition failure retains the integration and its recovery obligation. Recovery never replays authorization or manufactures Proof. Its result retains the exact exception claim and labels it as having no passing Proof.

The exception lives in common completion records and an unsigned DSSE note. Its claim kind cannot parse as passing Proof. Existing notes are never overwritten. Common records survive source-checkout removal; note publication failure leaves a recovery action.

## Outstanding validation

Status, desk data, and subsequent completion expose an exception only while its validation is outstanding; once a later strict Proof resolves it, the exception leaves those projections and its note and completion record remain the durable history. The trunk tip's exception note reads as a distinct kind — `landed_exception` in status, with whether its skipped checks are outstanding — never as passing Proof and never as a format this build cannot read. Run `discern done --rerun` on the current committed trunk or a repair containing it. A later strict Proof can resolve current obligations only when it contains the integrated repair and covers the recorded checks. Removing a required check does not discharge it.

The [resolution reader and writer](../../../src/engine/emergency/obligations.ts) retain a separate later-Proof receipt. The original exception and its note remain intact. The receipt establishes later validation; it cannot certify that the earlier integration passed.

## External protections and broken installations

This is a local integration route. Remote branch protection, push permission, deployment approval, and external validation retain their own authority. The action neither pushes nor deploys.

If discern cannot run, an owner may choose raw Git recovery. That action falls outside discern's governed landing boundary. Before changing refs, preserve the actual trunk and source object ids, exact changed paths, owner decision, reason, failed and missing checks, and all existing completion records and transaction markers. Preserve tracked edits, untracked and ignored files, resource ownership, and active worktree registrations. Reconcile any existing marker before deciding whether a transition remains outstanding.

Use an expected-old-to-target ref transition with the repair known to contain actual trunk. Keep the receiving index and checkout consistent with that ref, and retain the source checkout and resources until ownership and cleanup are established. Record the observed outcome and remaining validation separately. Do not write a passing Proof, forge a governed exception record, consume an unrelated grant, delete unfamiliar state, or bypass external protections. After repairing discern, inspect status and run current validation; do not replay an already completed integration.
