---
id: guide-fix-a-red-gate
title: "Fix a red gate"
description: "Hand a failing test or linter to your agent, know which decisions are yours, and recognize when the change is ready again."
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

When a test or linter fails, your agent gets the failing command, its output, and a command that reproduces just that failure, so it goes straight to the cause. You can help without reading test logs.

The **gate** runs your project's own commands, which must all pass for a change to be finished. When one fails, the gate is **red**, and discern can't record **Proof**, its record of which commands passed on one exact commit.

## Find out what failed

Say your agent adds search to your recipe app, and the test for clearing the search box fails. Hand the failure to your agent:

> "The search test is failing. Find the cause, fix it, and check whether the same mistake is anywhere else. Tell me if fixing it means changing what search should do."

A failure might mean the feature is wrong, a generated file is out of date, or a tool is missing. Each needs a different fix, so your agent starts from what discern reports:

```text
- Failed stage: `test`.
- `test`: test failed (exit 1) Reproduce with `npm test`.
```

Below that, your test runner's own output shows that the test expected 3 recipes and got 0.

Ask for an explanation in plain words, such as "clearing the search box shows no recipes." A good one separates what your agent saw from what it still has to find out.

By default, discern stops the other commands once one fails, so your agent hears about the failure quickly. Their results stay unknown until the next full run.

<!-- discern-workflow:result-summary -->

**Failed:** A command failed or couldn't run, so there's no current Proof.

**Next action:** Your agent reproduces the failure, fixes the cause, then runs the full gate again.

<!-- /discern-workflow -->

### See failures while the checks run

Your test command can report each failure to discern while the run is still going, with a command that reproduces it alone. Most test runners can do this. Ask:

> "Have our tests report each failure to discern while they're still running."

Your agent adds a few lines of output to the command, in the [documented format](../30-reference/config-reference.md#jobs), without changing what the tests check.

## Follow one failure to a fix

Your agent reproduces the failure, finds why an empty search counts as "no matches," fixes the cause, and checks other places that use the same search code. It keeps the test, so a later edit that brings the bug back fails it. To be sure it works this way, ask it to use the `discern-cure-a-bug` **skill**, discern's playbook for fixing bugs like this.

You can check the fix without reading code. Type a search, clear it, and see whether the full list comes back. Ask your agent to show you the test failing before the fix and passing after it.

## When the decision is yours

A decision is yours when the fix would change what the project should do, or what it requires. Loosening whatever failed is often the quickest way to a green gate, so the gate fails a change that loosens a **standard**, a measured limit your project holds. A looser limit lands only as a proposal you approve.

| What your agent found                                                                   | What you decide                                                                                          |
| --------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------- |
| A test expects behavior you now want to change.                                         | What the behavior should be. Your agent updates the feature and test to match.                           |
| The change goes over a standard, such as a download-size limit.                         | Whether the feature is worth a [looser limit](set-and-raise-standards.md#respond-when-a-standard-fires). |
| Your agent answered a **checkpoint**, one of your project's review questions, as unmet. | Whether to ask for a fix or approve that gap, which [only you can do](../10-understand/checkpoints.md).  |
| A tool, credential, or service the command needs is missing.                            | How to provide it, and what stays unchecked until then.                                                  |
| The fix would delete or weaken a test or other required check.                          | Whether the check still serves the project, and what would replace it.                                   |

Your agent tries reasonable fixes first, then brings you the options and its recommendation.

## Get back to a passing gate

While fixing, your agent runs the smallest relevant test, so each attempt gets quick feedback. Then it prepares every file in the change:

<!-- discern-workflow:command -->

**Run in:** the task's worktree, the copy of the project where your agent made the fix.

```sh
discern prepare
```

**Expected result:** The formatter and quicker checks pass, and your agent reviews and commits any files the formatter rewrote.

**If this fails:** Your agent follows the new failure before it runs the full gate.

<!-- /discern-workflow -->

Then your agent commits and runs `discern done`, which runs every required command again, including any that stopped early. A passing focused test shows the fix works for one case, and new Proof shows the change passed everything your project requires.

## You're done when

Your agent's handoff explains the cause, the fix, and any decision left for you, and ends with fresh Proof for the fixed version. A pass makes the change ready for your review, and it isn't permission to land. [Finish and land a change](finish-and-land-a-change.md) covers that step.

[Gate and Proof troubleshooting](../40-troubleshooting/gate-and-proof.md) matches other failures to their fixes, and the [result reference](../30-reference/mcp-and-results.md#diagnostics) explains each field.
