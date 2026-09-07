---
title: Execution recovery
description: Return an interrupted borrowed checkout without repeating validation or landing.
---

# Execution recovery

Checks can finish while checkout return is still blocked. Status shows the environment, retained paths, reason, and next action. Passing evidence alone does not prove that the checkout has returned.

Run these commands from the recorded owning worktree. First, review the plan with `discern done --recover <environment-id> --dry-run`. Preserve the artifacts and fix the reported drift. Then run `discern done --recover <environment-id>`.

Recovery proves that child processes have stopped. It captures the current state, applies the frozen return contract, and checks the result. It then releases the matching queue reservation. It runs no validation, moves no trunk ref, and issues no Proof.

The public action works on the caller's owned borrowed environment. It refuses a changed source branch, a live executor, unknown child state, or unreadable intent. Protected-file drift also blocks return. It cannot take another effort's checkout. Run recovery separately from validation and judgment options.

After return, run ordinary `discern done`. It reuses applicable evidence and fills any gaps. Use `--rerun` only to request a new validation attempt. Repeated recovery leaves settled state unchanged. The environment records which attempt returned, so recovery can resume if queue settlement was interrupted. Newer work stays protected.

## Ignored repositories

Git can list an ignored nested repository as a directory record. Source-tip execution keeps that directory and its Git data in place. The snapshot marks it as an opaque boundary. It contains no file bytes from inside that boundary. This also covers package caches a producer creates during its run.

An opaque boundary cannot authorize temporary restoration, disposal, or retirement. Those actions retain the checkout. Preserve the nested repository before reconciling its ownership. Do not delete its Git metadata to make capture pass.

Start with the [capture authority](../../../src/engine/execution/snapshot.ts) and [return adapter](../../../src/engine/execution/workspace.ts). The [public recovery action](../../../src/engine/execution/public_recovery.ts) returns ownership. The [retirement boundary](../../../src/engine/landing_queue/retirement.ts) protects data outside the capture from deletion. The native [recovery tests](../../../tests/completion_public_recovery_test.ts) cover artifact preservation, evidence reuse, and interrupted return.
