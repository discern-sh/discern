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

When a test or linter fails, your agent gets the failing command, its output, and a command that reproduces that failure on its own, so it goes straight to the cause, and you don't need to read a long test log to help.

The **gate** runs your project's own commands, such as its formatter, linter, type checker, and test suite, and a change counts as finished only when every one of them passes. It's **red** when one fails, so discern can't yet record **Proof**, its record of which of your project's commands passed on exactly which commit.

## Find out what failed

Say your agent adds search to your recipe app, and the test for clearing the search box fails. Hand the failure to your agent:

> "The search test is failing. Find out why, fix the cause, and check whether the same mistake is anywhere else. Bring it back when everything passes, and tell me if fixing it means changing what search should do."

Your project chooses its commands, so a failure can mean different things: the feature might be wrong, a generated file might need updating, or a tool the command needs might be missing. Each needs a different fix, so your agent starts from the failure discern reports, which names the failing command and how to reproduce it:

```text
- Failed stage: `test`.
- `test`: test failed (exit 1) Reproduce with `npm test`.
```

Below that, the result quotes your test runner's own output, which names the failing test, `clearing the search box shows every recipe`, and shows that it expected 3 recipes and got 0.

Ask for an explanation in plain words, such as "clearing the search box shows no recipes" or "the test couldn't start because a tool it needs is missing." A good explanation separates what your agent saw from what it still has to find out.

By default, discern stops the other commands as soon as one fails, so your agent hears about the failure quickly. Their results stay unknown until the next `discern done` runs them again. If a result arrives cut short, your agent reads the saved result with `discern progress` instead of running everything again.

### See failures while the checks run

You don't have to wait for the run to end to learn what failed. If your project's test command reports its progress to discern, each failure shows up as soon as it's known, with the test's name, its message, and a command that reproduces it alone. Most test runners can do this. Ask your agent:

> "Have our test command report its progress to discern, so failures show up while the run is still going and each one comes with a command that reproduces it alone."

Your agent adds a few lines of output to the command, in the format the [configuration reference](../30-reference/config-reference.md#jobs) describes, and what the tests check doesn't change. Any command can report this way, including a build.

<!-- discern-workflow:result-summary -->

**Failed:** A command failed, or something a command needs is missing, so there's no current Proof.

**Next action:** Your agent follows the failure's reproduce command, fixes the cause, then runs the full gate again.

<!-- /discern-workflow -->

## Follow one failure to a fix

Your agent runs the reproduce command and watches the test fail. It finds why an empty search counts as "no matches," fixes the cause, and checks the other places that use the same search code. It keeps the test, so a later edit that brings the bug back fails it, and each fix leaves the project a little harder to break. If you want to be sure your agent works this way, ask it to use discern's `discern-cure-a-bug` skill, a ready-made playbook for finding the real cause, fixing every place it appears, and leaving a test that fails if it returns.

You can check the fix without reading code. Type a search, clear it, and see whether the full list comes back. Ask your agent to show you that the test failed before the fix and passes after it. The full gate then checks the change against everything else your project requires.

## When the decision is yours

Most fixes stay within the task you asked for. A decision is yours when fixing the failure would change what the project is meant to do, or what it requires. The quickest way to turn a gate green is often to loosen whatever failed, which is why the gate fails a change that loosens a **standard**, one of the measured limits your project holds. A higher limit lands only as a proposal you approve.

| What your agent found                                                                | What you decide                                                                                                                                   |
| ------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------- |
| A test expects behavior you now want to change.                                      | What the behavior should be. Your agent then updates the feature and the test together.                                                           |
| The change goes over a standard, such as the app's download-size limit.              | Whether the feature is worth a higher limit, once your agent has tried to stay under it. [Standards](../10-understand/standards.md) explains how. |
| Your agent answered a **checkpoint**, a review question your project asks, as unmet. | Whether to ask for a fix, or to approve that gap. Only you can approve it. [Checkpoints](../10-understand/checkpoints.md) explains how.           |
| A tool, credential, or service the command needs isn't available.                    | How to provide it. Ask what stays unchecked until then.                                                                                           |
| The proposed fix would delete or weaken a test or another required check.            | Whether the check still serves the project, and what would replace it.                                                                            |

Your agent tries reasonable fixes before it brings you a decision. When it does, it gives you the problem, the options, and what it recommends.

## Get back to a passing gate

While fixing, your agent runs the smallest relevant test, so each attempt gets quick feedback. If your project limits how many test runs can happen at once, it runs those focused tests through `discern queue -- <test-command>`, so they share the limit with every other task's runs. Then it prepares every file in the change:

<!-- discern-workflow:command -->

**Run in:** the task's worktree, the separate copy of the project where your agent made the fix.

```sh
discern prepare
```

**Expected result:** The formatter and quicker checks pass, and any files the formatter rewrote are ready for your agent to review and commit.

**If this fails:** Your agent follows the new failure before it runs the full gate.

<!-- /discern-workflow -->

Then your agent commits the final version and runs `discern done`, which runs every required command again, including any that were stopped or unavailable before. A passing focused test shows the fix works for that one case, and new Proof shows the change passed everything your project requires.

If nothing has changed since a failed run, `discern done` doesn't run it again: it reports that the gate already judged that commit red. When a retry makes sense, such as a missing service that's back with no code changed, your agent asks for one on purpose with `discern done --rerun`.

## You're done when

Your agent's handoff explains the cause, the fix, what it tried, and any decision left for you, and it ends with fresh Proof for the fixed version. A pass makes the change ready for your review, and it isn't permission to land. [Finish and land a change](finish-and-land-a-change.md) covers review and landing from here.

If you're following along in a terminal, [Gate and Proof troubleshooting](../40-troubleshooting/gate-and-proof.md) matches each kind of failure to its fix. The [result reference](../30-reference/mcp-and-results.md#diagnostics) explains each field in a failure.
