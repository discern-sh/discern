---
id: guide-fix-a-red-gate
title: "Fix a red gate"
description: "Use a failed gate result to select a bounded fix and return to evidence-bearing state."
order: 30
publish: true
kind: guide
aliases:
  - "guide-fix-a-red-gate"
  - "When the gate fails"
  - "gate failure"
  - "red gate"
  - "check failed"
  - "diagnostics"
---

# Fix a red Gate

Use this guide after `discern done`, `discern prepare`, or a focused test returns a failure. The aim is to turn the result into one bounded investigation, correct the underlying cause, and return to a clean full-Gate run that can produce Proof.

When the gate fails, the failed result is the starting evidence. Preserve it until you have used its diagnostic, captured output, and reproduction command.

## Starting state

- The coding agent is in the task's assigned worktree.
- A discern result has `ok: false`, or a gate job is visibly red.
- No one has changed the project merely to silence the check.

## 1. Identify the first actionable failure

**Coding agent:** Read `diagnostics[]` before the general message. The first diagnostic should name the failed job or precondition, its location, the command that reproduces it, and either captured output or a path to the full output.

If the result is truncated, use its structured or stored output route. Do not rerun an effectful command only to recover text that the first run already recorded.

With fail-fast enabled, sibling jobs may be canceled as soon as one fails. A canceled or skipped job has no verdict. Work on the reported failure first, then rerun the full gate.

<!-- discern-workflow:result-summary -->

**Failed:** A job or precondition stopped the gate before current Proof could be recorded.

**Next action:** Run the first diagnostic's `reproduce_cmd`, correct the reported cause, then return to `discern done`.

<!-- /discern-workflow -->

## 2. Take the route that matches the evidence

| Observed failure                                       | Coding agent's next action                                                                                                  | Evidence that the route worked                                   |
| ------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------- |
| Dirty tree, missing commit, or branch behind the trunk | Inspect `discern status`, commit intended work, or follow the `discern_update` hint.                                        | The precondition clears on the next dry run or gate call.        |
| One declared job failed                                | Run its `reproduce_cmd`, diagnose the cause, and use the smallest focused check while editing.                              | The reproducing command passes for the same inputs.              |
| `generated_drift`                                      | Change the owning source and run the named generator. Never hand-edit the derived file.                                     | Regeneration leaves the artifact current.                        |
| `tree_drift` or stranded output                        | Review the diagnostic diff. Commit intended output, or make the job verify without rewriting.                               | `git status` remains clean after the producing stage.            |
| A standard breached                                    | Keep the trunk limit. Remove the regression, or report intrinsic growth to the person who owns the limit decision.          | `discern standards <name>` reports the held or approved value.   |
| A checkpoint awaits a declaration                      | Inspect the served question and matched paths, then declare met or unmet truthfully.                                        | The result records the current declaration state.                |
| Timeout, missing executable, or invalid installation   | Use the named command or run `discern doctor`; change a timeout only when the command is valid and expected to take longer. | Doctor passes and the focused command starts and exits normally. |

For a product bug, reproduce before changing code and leave a focused regression guard that covers the defect class. A patch that changes only the shown instance is incomplete when the same predicate can fail elsewhere.

## 3. Re-enter through the shortest safe loop

**Coding agent:** During diagnosis, run the diagnostic's reproduction command or the project's focused test. When that passes, prepare the complete tree.

<!-- discern-workflow:command -->

**Run in:** the assigned worktree root.

```sh
discern prepare
```

**Expected result:** Fixers, regeneration, refresh, and checks pass; any intended rewrites remain visible for review.

**If this fails:** Treat its first diagnostic as the next bounded failure before committing.

<!-- /discern-workflow -->

`prepare` runs fixers, regeneration, instruction refresh, and checks without the full test stage. Review any files it rewrites. Commit the complete fix only after the tree has converged.

If `[gate].concurrent_test_runs` is positive, send direct test commands through the repository queue:

```sh
discern queue -- <focused-test-command>
```

This respects the fleet-wide test cap. It does not replace the final gate.

## 4. Prove the recovered state

**Coding agent:** On the final clean commit, run:

```sh
discern done
```

Read all remaining diagnostics. A pass is complete only when the full run is green and emits Proof for the current `HEAD`. If a different job now fails, treat that result as the next bounded failure rather than assuming it is fallout from the first one.

## When to stop for a person

Stop and report the measured facts when recovery requires a decision outside the task's authority: weakening a standard, changing required project checks, accepting an unmet checkpoint, widening a scope, supplying credentials, or deciding that a failing behavior is now intended. Name the value or check, why the current work cannot satisfy it, and the next valid choices.

## Completion

Recovery is complete when the original reproduction passes, the final committed tree stays clean through `discern done`, and the new Proof names that commit. Continue with [Finish and land a change](finish-and-land-a-change.md).

Use [Gate and Proof troubleshooting](../40-troubleshooting/gate-and-proof.md) for generated or stranded output, [Config reference](../30-reference/config-reference.md) for job and timeout fields, and [MCP tools and results](../30-reference/mcp-and-results.md) for the diagnostic envelope.
