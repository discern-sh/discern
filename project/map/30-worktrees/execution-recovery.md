---
title: Execution recovery
description: Return an interrupted borrowed checkout without repeating validation or landing.
---

# Execution recovery

Checks can finish while checkout return is still blocked. Status shows the environment, retained paths, reason, and next action. Passing evidence alone does not prove that the checkout has returned.

`discern doctor` reads the same records from any checkout and observes each recorded claim live, the way status does: a live owner is ordinary work, an absent owner whose recorded children have stopped is an abandoned claim, child work that is not proved stopped is named with its reason, and a checkout it cannot observe is reported as unknown rather than assumed free. It also reports checkouts stopped mid-return, queue reservations with no live claim, and unfinished retirement, each with the recovery command to run from the owning worktree. It changes none of them. `discern upgrade` refuses to rewrite a checkout that a recorded claim or unfinished return still owns, and refuses an install whose completion records were written by a newer discern; another checkout of the same repository upgrades with every record intact. Local status prioritizes recorded execution or recovery before update, authoring, or release. Recorded claims name the environment, attempt, phase, and validation deadline. Separate observations report whether native checkout ownership is held, available, or unknown. An available checkout can still have surviving or uncertain children. A future deadline does not prove an executor is active, and expiry does not prove its children stopped. Status observes without changing recovery records; the recovery command rechecks them under retained exclusion. Supported MCP progress carries phase changes and canonical wait facts when the client supplies a progress token; repeated unchanged observations are coalesced.

CLI process signals and MCP cancellation notifications reach the operation's cancellation scope. Stopping an outer client wait alone supplies no evidence of delivery. Reconnect and read status to establish whether the children stopped and whether return completed. Cancellation during required return can leave explicit recovery even when production passed. A stopped scheduling actor releases its own claim while the retained environment continues to protect its capacity and files.

Run these commands from the recorded owning worktree. First, review the plan with `discern done --recover <environment-id> --dry-run`. Preserve the artifacts and fix the reported drift. Then run `discern done --recover <environment-id>`.

After an executor dies, recovery can proceed before its validation deadline. It acquires native checkout ownership, closes the interrupted operation's publication authority, and proves that its recorded child process groups have stopped. It captures the current state, applies the frozen return contract, and checks the result. It then releases the matching queue reservation. It runs no validation, moves no trunk ref, and issues no Proof.

The public action works on the caller's owned borrowed environment. It refuses a changed source branch, a live executor, unknown child state, or unreadable intent. Protected-file drift also blocks return. It cannot take another effort's checkout or use a live parent's delegated lease to recover that parent. A missing child inventory remains uncertain; starting recovery does not turn missing receipts into evidence of absence. Run recovery separately from validation and judgment options.

A reservation abandoned before execution starts also uses this action. The command verifies the unchanged released checkout before returning ownership and matching capacity. It preserves a changed checkout for reconciliation instead of applying a guessed return procedure.

After return, run ordinary `discern done`. It reuses applicable evidence and fills any gaps. Use `--rerun` only to request a new validation attempt. Repeated recovery leaves settled state unchanged. The environment records which attempt returned, so recovery can resume if queue settlement was interrupted. Newer work stays protected.

## Ignored repositories

Git can list an ignored nested repository as a directory record. Source-tip execution keeps that directory and its Git data in place. The snapshot marks it as an opaque boundary. It contains no file bytes from inside that boundary. This also covers package caches a producer creates during its run.

An opaque boundary cannot authorize temporary restoration, disposal, or retirement. Those actions retain the checkout. Preserve the nested repository before reconciling its ownership. Do not delete its Git metadata to make capture pass.

Start with the [capture authority](../../../src/engine/execution/snapshot.ts) and [return adapter](../../../src/engine/execution/workspace.ts). The [public recovery action](../../../src/engine/execution/public_recovery.ts) returns ownership. The [retirement boundary](../../../src/engine/landing_queue/retirement.ts) protects data outside the capture from deletion. The [preservation tests](../../../tests/completion_public_recovery_test.ts) cover artifact preservation and evidence reuse. The [native process-death tests](../../../tests/completion_process_death_test.ts) exercise claim handoffs, competing recovery, interrupted takeover and return, and surviving children. [The ownership decision](../_adr/_superseded/0377-execution-environments-declare-reuse-and-recovery.md#native-recovery-amendment--2026-09-09) records the boundary between the watchdog and recovery permission.
