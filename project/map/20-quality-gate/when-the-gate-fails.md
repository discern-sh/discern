---
title: When the Gate fails
description: Read a red discern done result, reproduce the failed job, and take the shortest route to the fix.
order: 10
aliases:
  - gate failure
  - red gate
  - check failed
  - diagnostics
---

# When the Gate fails

_Read the first diagnostic, use its reproduce command, and rerun the Gate after the fix._

Start with the first entry in `diagnostics[]`: the tool or precondition that failed, the problem, and a `reproduce_cmd` for a focused loop. The captured `output` contains the tool's error; if it was too large for the result, `output_path` points to the full normalized capture ([ADR 0083](../_adr/0083-normalize-and-offload-diagnostic-output.md)).

The terminal tail names the failed command: `discern done`, `discern prepare`, or `discern test`. Live progress ends before the deferred transcript and final table; the failure tail then appears once. Append-only fallback never removes child output, diagnostics, or remedies. Withheld output appears once in package RawOutput with its capture path. Each normalized finding uses Diagnostic then RetryNotice, with `discern docs 20-quality-gate/when-the-gate-fails` for this reference. ResultSummary stays last and keeps the first reproduce command visible.

Verdicts and failed stages remain authoritative. Streamed child bytes are not repeated; dynamic text crosses the shared safe-text adapter.

<!-- discern-workflow:result-summary -->

**Failed:** A stage or precondition stopped the Gate before it could issue a review Proof.

**Next action:** Run `reproduce_cmd` from the first diagnostic, fix the reported problem, then return to `discern done`.

<!-- /discern-workflow -->

Give the diagnostic to your agent, or work from that focused result yourself. Rerun the full Gate after the reported problem is fixed.

## Match the failure to the fix

| Failure                                      | What to do                                                                                                                                                                                                                                                                                                                                                                              |
| -------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| The branch is behind trunk                   | Run `discern update`, review what came in, then rerun `discern done`. The merge check stops before expensive jobs ([ADR 0050](../_adr/0050-merge-check-fail-fast.md)).                                                                                                                                                                                                                  |
| An agent file or materialized Skill is stale | Edit its authored source, run `discern refresh`, and include the regenerated files in the change.                                                                                                                                                                                                                                                                                       |
| A Skill's frontmatter is invalid             | Edit the named `SKILL.md` until the block parses as YAML; quote values containing `:`.                                                                                                                                                                                                                                                                                                  |
| Two ADR records claim one number             | Renumber the newer record to the next free number in its filename, title, and references. Landed and superseded records keep theirs.                                                                                                                                                                                                                                                    |
| The maintained ADR index is out of date      | Run `discern refresh` and commit the rewritten README. If the diagnostic says the index cannot be derived, fix the named first heading or marker pair with a missing END marker, then refresh.                                                                                                                                                                                          |
| `refresh_drift`                              | Run `discern refresh`, review and commit every named tracked path, then rerun `discern done`. The Gate does not rewrite these artifacts. Repair a planning error before rerunning the command.                                                                                                                                                                                          |
| A map or guidance reference is broken        | Fix each `file:line` finding under its rule: repoint the link or anchor, repair the metadata block, update the stale `discern` example, or make the citation name a real skill.                                                                                                                                                                                                         |
| A Standard's metric regressed                | Move the metric back within its floor or ceiling. Never weaken the limit on the branch.                                                                                                                                                                                                                                                                                                 |
| The branch loosened or deleted a Standard    | Restore the trunk limit and tell the owner. Loosening a limit requires an owner decision on trunk.                                                                                                                                                                                                                                                                                      |
| discern's write-access preflight was denied  | Grant this invocation access to the exact path in the diagnostic, then rerun the same command. The probe stopped before project jobs ran.                                                                                                                                                                                                                                               |
| A declared job or scope gate failed          | Run its `reproduce_cmd`, fix the reported problem, then return to `discern done`.                                                                                                                                                                                                                                                                                                       |
| A job timed out                              | Replace watch or server mode with a single-run command. Raise that job's `timeout` only when the command legitimately needs longer.                                                                                                                                                                                                                                                     |
| `generated_drift`                            | Read each `generated:<name>` diagnostic for the owning group, changed files, and regeneration command. Review and commit the regenerated files, then rerun `discern done`. A `generated-coverage` diagnostic names paths outside every declared glob; widen the responsible group's `paths` before committing ([ADR 0247](../_adr/0247-generated-artifacts-regenerate-never-merge.md)). |
| The gate left tracked changes                | Review the named diff, commit the gate's output, and rerun on the clean commit ([ADR 0148](../_adr/0148-strand-detection-covers-every-gate-stage.md)).                                                                                                                                                                                                                                  |
| `done` refused an unchanged-tree rerun       | Change the tree by fixing the failure or committing, then rerun. To probe a flaky verdict, run `discern done --confirmed`; discern records the attested probe.                                                                                                                                                                                                                          |

## Give the result to an agent

Run the machine-readable form to hand the failure across sessions:

<!-- discern-workflow:command -->

**Run in:** the active worktree root.

```sh
discern done --json
```

**Expected result:** One `DiscernResult` object on stdout, with each real failure represented in `diagnostics[]`.

**If this fails:** Read the command's stderr; JSON mode keeps narration out of stdout so the result stream stays machine-readable.

<!-- /discern-workflow -->

Each failed stage carries its remedy in `hints[]`. A sibling terminated by fail-fast reports `cancelled`; a configured step that was never reached reports `skipped`. The public field contract is in [MCP tools & results](../70-reference/mcp-and-results.md).

## Where it lives in code

| Concern                       | Source                                                              |
| ----------------------------- | ------------------------------------------------------------------- |
| Gate order and preconditions  | [`finish.ts`](../../../src/engine/gate/finish.ts)                   |
| Human failure tail            | [`failure_tail.ts`](../../../src/engine/gate/failure_tail.ts)       |
| Pure diagnostic presentation  | [`presentation.ts`](../../../src/engine/gate/presentation.ts)       |
| Job-to-diagnostic projection  | [`plan.ts`](../../../src/engine/gate/plan.ts)                       |
| Generated-artifact drift      | [`generated_drift.ts`](../../../src/engine/gate/generated_drift.ts) |
| Captured-output normalization | [`result.ts`](../../../src/shared/result.ts)                        |
| Timeout and process cleanup   | [`command.ts`](../../../src/engine/jobs/command.ts)                 |
| Built-in write probes         | [`write_preflight.ts`](../../../src/shared/write_preflight.ts)      |

## Current state & gotchas

- Output artifacts are temporary: later gate runs remove any older than 24 hours, so inspect an `output_path` while fresh.
- A test that passes by itself and fails in the full Gate may depend on shared state or execution order. Reproduce it in the same parallel context before treating it as a flake.
- Run `discern doctor` when the failure points to a missing command, invalid config, or incomplete installation. It checks the configured commands directly.
