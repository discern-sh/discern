---
id: guide-run-the-gate-in-ci
title: "Run the gate in CI"
description: "Run your project's own checks on your code-hosting service, so a change that only breaks on another system is caught before it merges."
order: 140
publish: true
kind: guide
aliases:
  - "guide-run-the-gate-in-ci"
  - "Run the gate in GitHub Actions"
  - "ci"
  - "GitHub Actions"
  - "branch protection"
  - "continuous integration"
---

# Run the gate in CI

Your code-hosting service can run the same commands discern runs on your machine, taken from the same list in your project's configuration. So a change that passes on your laptop but fails on another system is caught before it merges, and you don't keep a second list of checks for CI.

Continuous integration, or **CI**, runs your project's commands whenever a change reaches a service such as GitHub. Say your agent's recipe search passes every test on your Mac, and you want to know it also passes on Linux before it merges.

## What a CI report can and can't do

The **gate** runs your project's own commands, such as its formatter, linter, type checker, and test suite. In CI, discern runs it in report mode. The report shows what passed on that CI machine, and anyone can read it, but it doesn't finish the task.

The task still finishes in its **worktree**, the separate copy of the project where your agent works. There, an ordinary `discern done` produces **Proof**, discern's record of which of your project's commands passed on exactly which commit. A CI report never produces Proof, so it can't let a change land. A **checkpoint** is a review question your agent answers on certain changes, and CI lists those questions without answering them.

|                      | CI report            | Proof from `discern done`     |
| -------------------- | -------------------- | ----------------------------- |
| Where it runs        | Your CI service      | The task's worktree           |
| Checkpoint questions | Listed, not answered | Answered by the agent         |
| Lets the change land | No                   | Yes, once you give permission |

## Ask for the workflow

Once the project is set up with discern, ask your agent:

> "Run the same checks in CI that discern runs here, on Linux as well as macOS. Keep useful failure output, and show me that the workflow fails for a known broken change and passes once it's fixed. Tell me about any repository setting I need to change."

Decide which systems and runtimes CI should cover, or ask your agent to suggest them. discern doesn't ship a CI template, so your agent writes the workflow for your hosting service, and the CI setup and any secrets stay with that service.

## What the workflow does

**It installs a fixed discern version.** The workflow sets the version with the installer's `DISCERN_VERSION` setting. Pick at least the version in `discern.toml` under `[meta].managed_version`, because an older discern won't run the gate. When you upgrade the project, raise the CI version in the same change.

**It installs your runtimes and locked dependencies first.** The gate runs its commands side by side, so installing first keeps them from racing to set up their tools.

**It fetches a commit to compare with.** discern compares your project's rules before and after the change, so it catches a change that loosens a **standard**, one of the measured limits your project holds, or edits a checkpoint. Comparing a change with itself would hide that. The workflow fetches the commit to compare with:

- for a pull request, the commit it's based on;
- for a push, the commit before the push;
- for the first push of a new branch, your **trunk**, the shared branch where changes land.

**It runs the gate in report mode.** From the repository root:

```sh
discern done --ci --standalone --policy-base refs/discern/ci-policy-base --markdown
```

- `--ci` lists checkpoint questions without answering them, so the questions don't decide whether the run passes.
- `--standalone` runs the checks without recording Proof.
- `--policy-base` names the commit to compare with. It works only with the other two options.
- `--markdown` writes a readable result to the job log. Use `--json` if a later step needs the fields.

Even when every command passes, the report says it issued no Proof:

```text
- Checkpoint review: reported and was not enforced; no review was needed.
- Gate Proof: `diagnostic` (Standalone feedback does not issue Proof. A full discern done run on this clean committed tree does.).
```

The command exits with a failure status when a check fails. Keep that status, so a later step that uploads logs can't turn a failed gate into a passing job.

## Catch files the commit forgot

If a formatter or code generator changes a tracked file during the run, the gate fails, because the commit didn't include what the project's own tools produce. The fix belongs to the task: your agent runs `discern prepare` in its worktree, commits the rewritten files, and pushes again.

You can also add `git diff --exit-code` after the gate. It catches a rewritten file even when another check failed first.

## When CI fails

Say the search tests pass on your Mac but fail on Linux. Give the result to the agent working on that change:

> "Investigate this CI failure in the existing task. Tell me whether it's a problem in the code or a difference in the CI system, fix the cause, and bring back the checked result."

Your agent reads the captured output, runs the command that reproduces the failure, and fixes the cause, then commits and runs `discern done` again. [Fix a red gate](fix-a-red-gate.md) explains that recovery.

If the report lists a checkpoint question, the task's agent answers it in the worktree. If it answers that the question isn't met, the change needs your decision before it lands.

## Require the check before merging

Your hosting service can require the CI job to pass before a pull request merges. On GitHub, that's a branch protection rule. Your agent can name the job and explain the setting, and you may need to turn it on yourself.

A required CI check doesn't give discern permission to land anything. Landing still needs current Proof from the task's worktree, and your permission. [Finish and land a change](finish-and-land-a-change.md) covers that step.

## When it's done

Test the workflow on a throwaway branch. First push a change with a failing test, then push the fix:

- the failing change makes the required job fail, with output that explains why;
- the fix passes, with no files rewritten during the run;
- neither run produces Proof that could land a change.

From then on, every change gets checked on each system you chose, and a failure goes straight back to the agent that can fix it. The [CLI reference](../30-reference/cli-reference.md) lists every option and exit code. [Proof and checkpoint formats](../30-reference/proof-and-checkpoint-formats.md) describes report-only results.
