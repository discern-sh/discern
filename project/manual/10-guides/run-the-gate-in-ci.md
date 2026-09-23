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

Run your project's checks on your code-hosting service too, using the same checks discern runs on your machine. A change that passes on your laptop but breaks on another system gets caught before it merges. You don't keep a second list of checks for CI.

Continuous integration, or **CI**, runs checks whenever a change reaches a service such as GitHub. This guide follows one example: a change passes on your Mac, and you want to know it also works on Linux.

## What a CI report can and can't do

The **gate** is the full set of checks your project requires. In CI, discern runs it in report mode. The report shows what passed on that CI machine, and anyone can read it. It doesn't finish the task.

The task still finishes in its **worktree**, the separate copy of the project where your agent works. There, an ordinary `discern done` produces **Proof**, discern's record of which checks passed on exactly which commit. A **checkpoint** is a review question your agent answers on certain changes.

|                      | CI report            | Proof from `discern done`     |
| -------------------- | -------------------- | ----------------------------- |
| Where it runs        | Your CI service      | The task's worktree           |
| Checkpoint questions | Listed, not answered | Answered by the agent         |
| Lets the change land | No                   | Yes, once you give permission |

## Ask for the workflow

Once the project is set up with discern, ask your agent:

> Add discern's gate to our CI workflow. Use the checks this project already declares, keep useful failure output, and show that the workflow fails for a known broken change and passes once it's fixed. Tell me about any repository setting I need to change.

Decide which systems and runtimes CI should cover, or ask your agent to suggest them. discern doesn't ship a CI template, so the agent writes the workflow for your hosting service. The CI setup and any secrets stay with that service.

## What the workflow does

**It installs a fixed discern version.** The workflow sets the version with the installer's `DISCERN_VERSION` setting. Pick at least the version in `discern.toml` under `[meta].managed_version`. An older discern won't run the gate. When you upgrade the project, raise the CI version in the same change.

**It installs your runtimes and locked dependencies first.** The gate runs checks side by side, so installing first keeps them from racing to set up their tools.

**It fetches a commit to compare with.** discern compares your project's rules before and after the change. That way it catches a change that loosens a standard or edits a checkpoint. Comparing a change with itself would hide that. The workflow fetches the commit to compare with:

- for a pull request, the commit it's based on;
- for a push, the commit before the push;
- for the first push of a new branch, your **trunk**, the shared branch where changes land.

**It runs the gate in report mode.** From the repository root:

```sh
discern done --ci --standalone --policy-base refs/discern/ci-policy-base --markdown
```

- `--ci` lists checkpoint questions without answering them. Only the checks decide whether the run passes.
- `--standalone` runs the checks without recording Proof.
- `--policy-base` names the commit to compare with. It works only with the other two options.
- `--markdown` writes a readable result to the job log. Use `--json` if a later step needs the fields.

The command exits with a failure status when a check fails. Keep that status. A later step that uploads logs must not turn a failed gate into a passing job.

## Catch files the commit forgot

If a formatter or code generator changes a tracked file during the run, the gate fails. The commit didn't include what the project's own tools produce. The fix belongs to the task: your agent runs `discern prepare` in its worktree, commits the rewritten files, and pushes again.

You can also add `git diff --exit-code` after the gate. It catches a rewritten file even when another check failed first.

## When CI fails

Give the result to the agent working on that change:

> Investigate this CI failure in the existing task. Tell me whether it's a problem in the code or a difference in the CI system, fix the cause, and bring back the checked result.

The agent reads the captured output, runs the command that reproduces the failure, and fixes the cause. Then it commits and runs `discern done` again. [Fix a red gate](fix-a-red-gate.md) explains that recovery.

If the report lists a checkpoint question, the task's agent answers it in the worktree. If the answer is that the question isn't met, the change needs your decision before it lands.

## Require the check before merging

Your hosting service can require the CI job to pass before a pull request merges. On GitHub, that's a branch protection rule. Your agent can name the job and explain the setting. You may need to turn it on yourself.

A required CI check doesn't give discern permission to land anything. Landing still needs current Proof from the task's worktree, and your permission. [Finish and land a change](finish-and-land-a-change.md) covers that step.

## When it's done

Test the workflow on a throwaway branch. First push a change with a failing test, then push the fix:

- the failing change makes the required job fail, with output that explains why;
- the fix passes, with no files rewritten during the run;
- neither run produces Proof that could land a change.

From then on, every change gets checked on each system you chose. A failure goes straight back to the agent that can fix it. The [CLI reference](../30-reference/cli-reference.md) lists every option and exit code. [Proof and checkpoint formats](../30-reference/proof-and-checkpoint-formats.md) describes report-only results.
