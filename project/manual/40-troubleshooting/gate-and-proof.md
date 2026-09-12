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

| What the result names                    | Next step                                                                                                                          |
| ---------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------- |
| Uncommitted or untracked files           | The full check needs a committed tree. Have the agent run `discern prepare`, review and commit the intended files, then ask again. |
| A checkpoint needs judgment              | Have the agent answer the served question against the actual change. See [checkpoint answers](#a-checkpoint-needs-an-answer).      |
| The branch is behind the shared branch   | Have the agent run `discern update`, re-read the overlapping files it names, then run `discern done` again.                        |
| A state path cannot be written           | Resolve access to the exact path named, then retry.                                                                                |
| The same validation input already failed | Fix the cause first. Use `--rerun` when the result requires a deliberate new attempt on unchanged input.                           |

An already passing result is different: discern can reuse applicable evidence without running its jobs again. A result that says no gate ran is therefore not, by itself, a refusal. Read its completion state and any missing requirements.

## The gate is waiting, not failing

The project bounds how many test runs can share the machine with `[gate].concurrent_test_runs`. A run that reaches that limit waits for a slot while its other checks continue. The result names the task holding the slot and how long its tests usually take.

Nothing needs repairing. Let the run wait, or ask the agent which task holds the slot and whether it is close to finishing. Raise the limit only after checking that the machine can carry another run; [Coordinate parallel tasks](../10-guides/coordinate-parallel-tasks.md#share-limited-capacity) explains the setting.

## The result was cut short

A long result can arrive with its diagnostics abbreviated. `discern progress <handle>`, with the handle the run announced when it started, returns the retained result with every failure and its reproduce command; each check's complete transcript is in the file the result names. Running the gate again to see the missing text costs another run and adds nothing new.

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

Temporary files can affect another concurrent check even if a later cleanup removes them. Preserve anything the result cannot account for before deciding what it belongs to.

Success is a clean final commit with complete Proof.

## Green, but no Proof

Read the completion state and missing requirements. Passing jobs can be useful progress while completion is still pending.

| Why Proof is missing                                         | What completes the task                                                                                                   |
| ------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------- |
| Uncommitted changes or a commit that moved during validation | Review and commit the final intended state, then run ordinary completion.                                                 |
| A checkpoint question is still open                          | Have the agent judge it and record the conclusion; completion continues in the same run.                                  |
| The run used `--standalone`                                  | Run ordinary `discern done` when ready. Standalone diagnostics do not issue landing Proof.                                |
| The run used `--ci`                                          | Treat it as a CI report. CI does not produce landing Proof. See [Run the gate in CI](../10-guides/run-the-gate-in-ci.md). |

## Proof was current and went stale

Ask the agent what changed since validation. A new commit or a changed checkpoint judgment requires fresh evidence for the version that will land.

For source edits, commit the intended final change and run `discern done`. A shared branch that moved after the Proof does not make the Proof stale, but it does stop the landing: acceptance refuses and names the route, `discern update`, `discern done`, then `discern accept`, so the evidence covers the combination that lands.

Success is current Proof for the exact commit that will land, with no required evidence missing. [Why Proof becomes stale](../20-understand/proof.md#why-proof-becomes-stale) explains the boundary.

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
- **A recorded answer reopened.** The change no longer matches the answer's subject. Judge the served question again using the current version.

[Checkpoint states and declarations](../30-reference/proof-and-checkpoint-formats.md#checkpoint-state-and-declarations) provides the exact states. [Checkpoints](../20-understand/checkpoints.md) explains how the questions help a project retain decisions that tests cannot make.

## When to stop

Bring a decision to the owner when it changes the agreed outcome, approves an unmet checkpoint, changes a protected standard limit, or authorizes landing without existing authority. Routine investigation and repair can continue within the authorized task.

If the named remedy does not resolve the problem, keep the original result and the failed recovery's output. Investigate the new evidence or report the unresolved condition. Before any repeat of the full gate, the agent should be able to say what changed since the last run or what new evidence the run would obtain; a repeat that can answer neither is not a substitute for understanding a recurring failure.
