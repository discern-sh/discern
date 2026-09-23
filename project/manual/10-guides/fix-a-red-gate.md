---
id: guide-fix-a-red-gate
title: "Fix a red gate"
description: "Hand a failed check to your agent, know which decisions are yours, and recognize when the change is ready again."
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

When one of your project's checks fails, your agent gets the failing check, its output, and a command that reproduces that failure on its own. So it can go straight to the cause, and you don't need to read a long test log to help.

The **gate** is the set of checks your project requires before a change counts as finished. It's **red** when one of them fails, so discern can't record **Proof** for this version yet. Proof is discern's record of which checks passed on exactly which commit.

Hand the failure to your agent:

> Find out why this check failed, fix the cause, and look for the same problem elsewhere. Keep working in this task's worktree. Bring back the result with fresh Proof, and tell me about any decision that needs me.

This guide follows one failure in a recipe app, from the red result to a passing gate.

## Find out what failed

Your project chooses the checks, so a failure can mean different things. The feature might be wrong, a generated file might need updating, or a tool the check needs might be missing. Each needs a different fix, so your agent starts from the failure discern reports.

Each failure names the command that failed, shows its output, and gives a shorter command that reproduces it alone. Ask for an explanation in plain words, such as "Search crashes when the box is empty" or "The test couldn't start because a tool it needs is missing." A good explanation separates what the agent saw from what it still has to find out.

When one check fails, discern can stop other checks early to save time. Their results are unknown, and they run again at the next `discern done`. If a result arrives cut short, the agent reads the saved result with `discern progress` instead of running the checks again.

### See failures while the checks run

You don't have to wait for the run to end to learn what failed. If your project's test command reports its progress to discern, each failure shows up as soon as it's known. It comes with the test's name, its message, and a command that reproduces it alone. Most test runners can do this. Ask your agent:

> Have our test command report its progress to discern, so failures show up while the run is still going and each one comes with a command that reproduces it on its own.

The agent adds a few lines of output to the command, in the format the [configuration reference](../30-reference/config-reference.md#jobs) describes. What the tests check doesn't change. Any check can report this way, including a build.

<!-- discern-workflow:result-summary -->

**Failed:** A check failed, or something a check needs is missing, so there's no current Proof.

**Next action:** Your agent follows the failure's recovery or reproduce command, fixes the cause, then runs the full gate again.

<!-- /discern-workflow -->

## Follow one failure to a fix

Say your agent adds recipe search, and the test for clearing the search box fails. It expects the full recipe list back, but the app shows no recipes.

The agent runs the reproduce command from the failure and watches it happen. It finds why an empty search counts as "no matches," fixes it, and checks other places that use the same search code. It keeps a test for this case, so a later edit that brings the bug back makes the test fail. discern's `discern-cure-a-bug` skill, a ready-made playbook, walks your agent through this: find the real cause, fix every place it appears, and leave a check that fails if it returns. Each fix then makes the project a little harder to break.

You can check the fix without reading code. Type a search, clear it, and see whether the list comes back. Ask the agent to show that the test failed before the fix and passes after it. The full gate then checks the change against everything else your project requires.

## When the decision is yours

Most fixes stay within the task you asked for. A decision is yours when fixing the failure would change what the project is meant to do, or what it requires.

| What the agent found                                                    | What you decide                                                                                                                              |
| ----------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------- |
| A test expects behavior you now want to change.                         | What the behavior should be. The agent then updates the feature and the test together.                                                       |
| The change goes over a standard, such as the app's download-size limit. | Whether the feature is worth a higher limit, once the agent has tried to reduce it. [Standards](../20-understand/standards.md) explains how. |
| The agent answered a checkpoint question "unmet."                       | Whether to ask for a fix, or to approve that gap. Only you can approve it. [Checkpoints](../20-understand/checkpoints.md) explains how.      |
| A tool, credential, or service the check needs isn't available.         | How to provide it. Ask what stays unchecked until then.                                                                                      |
| The proposed fix would remove or weaken a required check.               | Whether the check still serves the project, and what would replace it.                                                                       |

A **checkpoint** is a review question your project asks about certain kinds of change. Your agent answers it, and an "unmet" answer means the change falls short of what the question asks. Your agent tries reasonable fixes before it brings you a decision. When it does, it gives you the problem, the options, and what it recommends.

## Get back to a passing gate

While fixing, the agent runs the smallest relevant check, so each attempt gets quick feedback. If your project limits how many test runs can happen at once, it runs those focused tests through `discern queue -- <test-command>` to share the limit. Then it prepares every file in the change:

<!-- discern-workflow:command -->

**Run in:** the task's worktree, where the agent made the fix.

```sh
discern prepare
```

**Expected result:** The quick checks pass, and any files the fixers rewrote are ready for the agent to review and commit.

**If this fails:** The agent follows the new failure before it runs the full gate.

<!-- /discern-workflow -->

Then the agent commits the final version and runs `discern done`. That runs every required check again, including any that were stopped or unavailable before. A passing focused test shows the fix works for that one case. New Proof shows the change passed every check your project requires.

If nothing has changed since a failed run, `discern done` doesn't repeat it. Say a missing service is back, but no code changed. The agent can then retry with `discern done --rerun`, once it knows why another attempt will help.

## You're done when

The agent's handoff explains the cause, the fix, what it tried, and any decision left for you. It ends with fresh Proof for the fixed version. A pass isn't permission to land. [Finish and land a change](finish-and-land-a-change.md) covers review and landing from here.

If you're following along in a terminal, [Gate and Proof troubleshooting](../40-troubleshooting/gate-and-proof.md) matches each kind of failure to its fix. The [result reference](../30-reference/mcp-and-results.md#diagnostics) explains each field in a failure.
