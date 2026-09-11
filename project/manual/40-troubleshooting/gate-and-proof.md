---
id: troubleshoot-gate-and-proof
title: "Gate and Proof"
description: "Find why checks stopped or Proof is missing, repair the cause, and know when a decision is needed."
order: 30
publish: true
kind: troubleshooting
aliases:
  - "troubleshoot-gate-and-proof"
  - "Strand detection"
  - "tree drift"
  - "tree_drift"
  - "dirty gate"
  - "stranded changes"
  - "generated_drift"
  - "gate_failed"
  - "unchanged_tree_rerun"
  - "stale Proof"
  - "Proof skipped"
---

# Gate and Proof

Start with the first failure in the result. You can ask your agent:

> Explain what stopped the gate in terms of my change. Fix the cause, verify that correction, and tell me what remains unverified or needs my decision.

A red gate gives you a chance to resolve a problem before the change lands. You do not need to interpret every log line yourself. The agent should turn the diagnostic into a specific repair and explain its effect on the requested work.

## Read the failure before acting

Open the diagnostic's captured output. Its `reproduce_cmd` names the command for investigating that failure alone; `output_path`, when supplied, leads to the full log. Retrieve that saved output if the displayed result was cut short.

For example, a failed search test should lead to an explanation such as “Searching by an ingredient misses recipes whose title doesn't contain it,” followed by a repair and a focused test. The error could also come from a missing dependency or an incorrect check. Ask the agent to investigate the diagnostic before choosing a repair.

[Fix a red gate](../10-guides/fix-a-red-gate.md) gives the full working procedure. The cases below cover results that need a different next step.

## The gate refuses before running anything

Read the next action and whether the result says the gate ran. Common cases are:

| What the result names                             | Next step                                                                                                                                                                             |
| ------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Uncommitted or untracked files                    | The full check needs a committed tree. Have the agent run `discern prepare`, review and commit the intended files, then ask again. |
| A checkpoint needs judgment                       | Have the agent answer the served question against the actual change. See [checkpoint answers](#a-checkpoint-needs-an-answer).                                                         |
| A workspace needs recovery                        | Follow the recorded environment recovery before editing it. See [returning a workspace](../10-guides/recover-an-interrupted-task.md#return-a-workspace-after-interrupted-validation). |
| The branch or its proposed landing needs updating | Follow the printed update or completion action. Acceptance may compose and validate the change in an eligible released workspace.                                                     |
| A state path cannot be written                    | Resolve access to the exact path named, then retry.                                                                                                                                   |
| The same validation input already failed          | Fix the cause first. Use `--rerun` when the result requires a deliberate new attempt on unchanged input.                                                                              |

An already passing result is different: discern can reuse applicable evidence without running its jobs again. A result that says no gate ran is therefore not, by itself, a refusal. Read its completion state and any missing requirements.

## The gate is waiting, not failing

The project bounds how many tasks can run their full checks at once, how many test runs can share the machine, and how many workspaces can be prepared for another commit. A run that reaches one of those limits waits. The result names the setting that is binding, which tasks hold the slots, and what releases the wait.

Nothing needs repairing. Let the run wait, or ask the agent which task holds the slot and whether it is close to finishing. Raise a limit only after checking that the machine can carry another run; [Coordinate parallel tasks](../10-guides/coordinate-parallel-tasks.md#share-limited-capacity) explains the settings.

## The result was cut short

A long result can arrive with its diagnostics abbreviated. The complete output is kept in a retained artifact whose path the result names; the agent reads that artifact. Running the gate again to see the missing text costs another run and adds nothing new.

If the session that started the run is gone, the run may still be going. Ask the agent to read status before doing anything else. [Recover an interrupted task](../10-guides/recover-an-interrupted-task.md#stop-a-run-you-can-no-longer-see) covers that case.

## A job failed

Have the agent reproduce the named failure, inspect its cause, and make the smallest appropriate repair. For fix and check stages, `discern prepare` may be the useful inner loop. For a test failure, the diagnostic's narrower command usually gives a faster answer.

Check which evidence state applies:

- **A successful job printed error-like output.** Read the captured log and check whether the job swallowed a failure. The exit status alone does not settle that question.
- **Tests are queued.** If the project caps concurrent test runs, a busy queue waits for a slot. Direct test commands should use `discern queue -- <command>` under the same configured cap.

Return to ordinary `discern done` once the correction is ready on a clean, committed tree. That verifies the required checks, including any affected by the repair.

## The gate finished with a different tree than it started

Inspect the named paths and diff before committing or removing anything. A passing check must apply to the version that receives Proof; unexpected changes can prevent that.

| Reported change                                         | Recovery                                                                                                                                 |
| ------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------- |
| A stage rewrote a tracked file (`tree_drift`)           | Review the diff. Commit intended output, or correct a command that should only verify files. Then run completion again.                  |
| Unexpected output appeared among source files           | Preserve it for inspection. Put temporary output in a narrowly ignored or declared output location; commit only intended source changes. |
| A declared generator is stale (`generated_drift`)       | Run the regeneration command named for `[generated.<name>]`, review its output, and commit the intended result.                          |
| discern-maintained instructions or integrations drifted | Run `discern refresh`, then review and commit the tracked changes. Edit authored sources to change their content.                        |

If generation immediately produces different bytes again from the same input, investigate the generator before making another commit. Repeatedly accepting those differences will not give you a stable result.

If unexpected files were left by interrupted validation, use the [workspace recovery procedure](../10-guides/recover-an-interrupted-task.md#return-a-workspace-after-interrupted-validation). Preserve anything it cannot account for. Temporary files can affect another concurrent check even if a later cleanup removes them.

For normal source repair, success is a clean final commit with complete Proof. During composition, discern can also regenerate declared outputs for the proposed landing; read the result to distinguish that managed work from a source change requiring your agent's attention.

## Green, but no Proof

Read the completion state and missing requirements. Passing jobs can be useful progress while completion is still pending.

| Why Proof is missing                                         | What completes the task                                                                                                                                   |
| ------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------- |
| A required validation context has not run                    | Run the next context named by the result, using `discern done --context <name>` where requested.                                                          |
| Uncommitted changes or a commit that moved during validation | Review and commit the final intended state, then run ordinary completion.                                                                                 |
| Evidence storage or workspace recovery is incomplete         | Preserve the recorded state and follow its specific recovery action.                                                                                      |
| The run used `--standalone`                                  | Run ordinary `discern done` when ready. Standalone diagnostics do not admit the task to completion or issue landing Proof.                                |
| The run used `--ci`                                          | Treat it as a CI report. CI does not admit the task to completion or produce landing Proof. See [Run the gate in CI](../10-guides/run-the-gate-in-ci.md). |

Returning a workspace through `done --recover` also does not run validation or create Proof. After recovery, ordinary `done` can reuse applicable passing evidence and obtain what is still missing.

## Proof was current and went stale

Ask the agent what changed since validation. A new source commit, a new predecessor on the trunk, or a changed checkpoint judgment can require fresh evidence for the proposed landing.

For source edits, commit the intended final change and run `discern done`. If the trunk moved, follow the result: acceptance may compose and validate the new candidate in an eligible released workspace, or ask the source agent to update and complete the work again.

Success is current Proof for the exact proposed landing, with no required evidence missing. [Why Proof becomes stale](../20-understand/proof.md#why-proof-becomes-stale) explains the boundary.

## A standard failed

First distinguish a worse measurement from a measurement that could not run.

- **The value exceeded its limit.** Have the agent explain what grew or fell and try remedies within the requested work. If a justified change still needs a different limit, it should present the measured tradeoff for your decision and use the standard-limit proposal procedure. Editing a limit merely to pass does not supply that approval.
- **The governing limits could not be read.** Follow the diagnostic. A shallow CI clone may be missing the configured local trunk ref; the result supplies the fetch command needed to compare the policies.
- **The measurement command failed.** Repair its named command or prerequisite before drawing conclusions about the value.

[Set and raise standards](../10-guides/set-and-raise-standards.md) covers measurement, repair, and the approval procedure for a proposed limit.

## A checkpoint needs an answer

Have the agent read the question and inspect the change it names. For example, a change to saved recipes might ask whether existing saved data remains readable. An answer should explain the evidence relevant to that question.

- **Awaiting declaration.** The agent records `discern done --met <id>` if the change satisfies the served question, or `discern done --unmet <id> --why "<rationale>"` if it does not.
- **Declared unmet.** The checks may still pass. Landing requires the owner to approve that exact exception in the current conversation; a recorded landing grant does not cover it. The agent can instead change the work, judge it again, and complete validation.
- **A recorded answer reopened.** The change or the proposed landing no longer matches the answer's subject. Judge the served question again using the current version.

[Checkpoint states and declarations](../30-reference/proof-and-checkpoint-formats.md#checkpoint-state-and-declarations) provides the exact states. [Checkpoints](../20-understand/checkpoints.md) explains how the questions help a project retain decisions that tests cannot make.

## When to stop

Bring a decision to the owner when it changes the agreed outcome, approves an unmet checkpoint, changes a protected standard limit, or authorizes landing without existing authority. Routine investigation and repair can continue within the authorized task.

If the named remedy does not resolve the problem, keep the original result and the failed recovery's output. Investigate the new evidence or report the unresolved condition. Before any repeat of the full gate, the agent should be able to say what changed since the last run or what new evidence the run would obtain; a repeat that can answer neither is not a substitute for understanding a recurring failure.
