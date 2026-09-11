---
id: guide-fix-a-red-gate
title: "Fix a red gate"
description: "Understand a failed check, give your agent a useful recovery request, and recognize when the change is ready again."
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

# Fix a red gate

A red gate means the change needs attention before discern can record its completion. Give the failure to your agent and ask it to investigate:

> Find out why this check failed, fix the cause, and check for the same problem elsewhere. Keep working in this task's worktree. Bring back the result with fresh Proof, and explain any decision that needs me.

Include the result or its saved output if you have it. Your agent can use the diagnostic, the explanation of the failure, to find the affected command and files. You do not need to interpret a long test log before asking for help.

## Find out what failed

The gate runs checks chosen for your project. A failure might mean the feature behaves incorrectly, a generated file needs updating, or a required tool is unavailable. These call for different remedies, so your agent starts with the reported evidence.

Ask for an explanation such as “Search crashes when the box is empty,” or “The test could not start because its required tool is missing.” The explanation should distinguish what the agent observed from what it still needs to investigate.

If other checks were canceled after the first failure, their results remain unknown. They will need evidence too before completion. The agent should retrieve captured output when a result is abbreviated, rather than repeat an operation merely to see its text again.

You do not have to wait for the run to finish to learn what failed. While the checks run, discern reports each failure as soon as it is known, with the test's name, message, and a focused command that reproduces it alone, when the project's test command reports its progress. Most test runners can be made to do that; ask your agent:

> Have our test command report its progress to discern, so failures show up while the run is still going and each one comes with a command that reproduces it on its own.

The agent adds a few lines of output to the command, in the form the [configuration reference](../30-reference/config-reference.md#jobs) describes, and nothing about what the tests check changes. Any check can report this way, including a build.

<!-- discern-workflow:result-summary -->

**Failed:** A check or prerequisite needs attention; current completion Proof is unavailable.

**Next action:** Your agent follows the diagnostic's recovery or reproduction command, then returns to the full completion check after resolving the cause.

<!-- /discern-workflow -->

## Follow the failure through a fix

Imagine your agent adds recipe search. The project's test for clearing the search box fails: it expects the full recipe list, but the app shows no recipes.

Your agent reproduces that behavior with the focused test named in the failure. It then investigates why an empty search is treated as “no matches,” corrects the behavior, and checks for other places using the same search logic. A regression test records the expectation so a later edit can catch the same mistake.

You can review this without reading the implementation: enter a search, clear it, and see whether the list returns. Ask the agent to show that the test failed before the correction and passed afterward. The full gate then checks the change against the rest of the project's requirements.

## When to stop for a person

Most repair work can continue within the task you already requested. A decision belongs with you when fixing the failure changes what the project is meant to do or which requirements it will hold.

| What the agent found                                                  | What you need to consider                                                                                                                                   |
| --------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------- |
| The test expects behavior you now want to change.                     | Confirm the intended behavior, so the agent can update the feature and the test together.                                                                   |
| The change exceeds a standard, such as the app's download-size limit. | Ask what caused the increase, what can be reduced, and what you gain by keeping it. [Standards](../20-understand/standards.md) explains the limit decision. |
| A checkpoint question is declared unmet.                              | Read the reason, then request a correction or explicitly approve that exception. [Checkpoints](../20-understand/checkpoints.md) explains the choice.        |
| A required environment, credential, or service is unavailable.        | Ask what remains unverified and what access or environment would allow the check to run.                                                                    |
| The proposed repair would remove or weaken a required check.          | Ask why the existing check no longer serves the project and what would replace its coverage.                                                                |

The agent should investigate reasonable fixes before bringing a tradeoff back. A useful decision request includes the observed problem, the options, and a recommendation you can assess.

## Return to a checked result

While editing, your agent uses the smallest relevant check so each attempt gives prompt feedback. It then prepares the complete change:

<!-- discern-workflow:command -->

**Run in:** this task's worktree, where the agent made the fix.

```sh
discern prepare
```

**Expected result:** The configured preparation steps pass, with any rewritten files available for the agent to review and commit.

**If this fails:** Follow the new diagnostic before attempting completion.

<!-- /discern-workflow -->

After reviewing and committing the final files, the agent runs `discern done`. It collects the required evidence, including checks that were canceled or unavailable earlier. A focused test passing establishes the repair it covers; current Proof shows that the complete change met the configured gate.

If the same failed inputs are being retried, discern may request an explicit `discern done --rerun`. For example, a missing service may have been restored without a source edit. The agent should follow that instruction after establishing why another attempt is useful. Changing an unrelated file does not necessarily change the inputs of the failed check.

## Technical routes for a reported failure

These details help if you are following the repair in a terminal. The diagnostic's own next action remains the starting point.

| Reported condition                                | Route forward                                                                                                                                    |
| ------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------ |
| Uncommitted files or a branch that needs updating | Inspect the task's state, review the intended files, and follow the commit or `discern update` instruction.                                      |
| A project check failed                            | Use its `reproduce_cmd` and captured output to investigate.                                                                                      |
| `generated_drift`                                 | Edit the owning source and run the named generator.                                                                                              |
| `tree_drift` or unexpected output                 | Inspect and preserve the reported files before deciding whether they belong in the change or the producing command needs correction.             |
| Missing execution context                         | Supply evidence in the required context; a local pass alone may be incomplete.                                                                   |
| Execution recovery is pending                     | Follow [Recover an interrupted task](recover-an-interrupted-task.md#return-a-workspace-after-interrupted-validation) before resuming validation. |
| Timeout or a missing executable                   | Use the reported environment remedy or `discern doctor`; extend a timeout only after establishing that the command is valid and needs more time. |

Projects can limit concurrent test runs. When `[gate].concurrent_test_runs` is positive, the agent runs direct tests through `discern queue -- <focused-test-command>` so parallel tasks share that capacity.

## Completion

Look for a handoff that explains the cause, the correction, what was tried, and any remaining decision. It should include fresh Proof for the completed change. You can then continue with [Finish and land a change](finish-and-land-a-change.md).

For a specific evidence or output problem, see [Gate and Proof troubleshooting](../40-troubleshooting/gate-and-proof.md). The [result reference](../30-reference/mcp-and-results.md) explains diagnostic fields.
