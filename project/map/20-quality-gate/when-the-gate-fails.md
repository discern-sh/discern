---
title: When the gate fails
description: Read a red discern done result, reproduce the failed job, and take the shortest route to the fix.
order: 10
aliases:
  - gate failure
  - red gate
  - diagnostics
---

# When the gate fails

_Read the first real failure, use its reproduce command, and rerun the gate after the fix._

Start with the first entry in `diagnostics[]`. It names the tool or precondition that failed, explains the problem, and gives you a `reproduce_cmd`. Run that command when you need a focused loop. The captured `output` contains the tool's error; if it was too large for the result, `output_path` points to the full normalized capture ([ADR 0083](../_adr/0083-normalize-and-offload-diagnostic-output.md)).

Your agent reads these fields directly and usually fixes the failure without help. If you are handling it yourself, work from the diagnostic instead of rerunning the full gate to rediscover the same error.

## Match the failure to the fix

| Failure                                              | What to do                                                                                                                                                             |
| ---------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| The branch is behind trunk                           | Run `discern update`, review what came in, then rerun `discern done`. The merge check stops before expensive jobs ([ADR 0050](../_adr/0050-merge-check-fail-fast.md)). |
| A compiled agent file or materialized Skill is stale | Edit its authored source, run `discern refresh`, and include the regenerated files in the change.                                                                      |
| A standard's metric regressed                        | Move the metric back within its floor or ceiling. Never weaken the limit on the branch.                                                                                |
| The branch loosened or deleted a standard            | Restore the trunk limit and tell the owner. Loosening a limit requires an owner decision on trunk.                                                                     |
| A capability, check, test, or scope gate failed      | Run its `reproduce_cmd`, fix the reported problem, then return to `discern done`.                                                                                      |
| A job timed out                                      | Replace watch or server mode with a single-run command. Raise that job's `timeout` only when the command legitimately needs longer.                                    |
| The gate left tracked changes                        | Review the named diff, commit the gate's output, and rerun on the clean commit ([ADR 0148](../_adr/0148-strand-detection-covers-every-gate-stage.md)).                 |

## Give the result to an agent

Run the machine-readable form when you need to hand the failure across sessions:

```sh
discern done --json
```

JSON mode prints one result object and suppresses live narration. Each real failure carries its diagnostic. Fail-fast siblings stop early, and their steps report `skipped`. The public field contract is in [MCP tools & results](../70-reference/mcp-and-results.md).

## Where it lives in code

| Concern                       | Source                                              |
| ----------------------------- | --------------------------------------------------- |
| Gate order and preconditions  | [`finish.ts`](../../../src/engine/gate/finish.ts)   |
| Job-to-diagnostic projection  | [`plan.ts`](../../../src/engine/gate/plan.ts)       |
| Captured-output normalization | [`result.ts`](../../../src/shared/result.ts)        |
| Timeout and process cleanup   | [`command.ts`](../../../src/engine/jobs/command.ts) |

## Current state & gotchas

- Output artifacts are temporary. Inspect an `output_path` while it is fresh. Later gate runs remove registered artifacts older than 24 hours.
- A test that passes by itself and fails in the full gate often depends on shared state or execution order. Reproduce it in the same parallel context before treating it as a flake.
- Run `discern doctor` when the failure points to a missing command, invalid config, or incomplete installation. It checks the configured commands without making you infer setup problems from a downstream job.
