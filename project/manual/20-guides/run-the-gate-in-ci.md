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

Your code-hosting service can run the commands discern runs on your machine, from the same list in your project's configuration. So a change that passes on your laptop but breaks on another system is caught before it merges. You don't keep a second list of checks.

Continuous integration, or **CI**, runs your project's commands whenever a change reaches a service such as GitHub. Say your agent's recipe search passes every test on your Mac, and you want to know it passes on Linux.

## What a CI report can and can't do

In CI, discern runs the **gate** in report mode. The gate is your project's own commands, such as its linter and tests, which must all pass before a change counts as finished. The report shows what passed on that machine. It never produces **Proof**, discern's record of which commands passed on one exact commit, so it can't let a change land. Landing still needs Proof from an ordinary `discern done` in the task's **worktree**, the separate copy of the project where your agent works, and your permission.

## Ask for the workflow

Ask your agent:

> "Run the same checks in CI that discern runs here, on Linux and macOS. Show me the workflow failing on a broken change and passing once it's fixed. Tell me about any repository setting I need to change."

discern doesn't ship a CI template, so your agent writes the workflow, and secrets stay with your hosting service.

## What the workflow does

**It installs a fixed discern version,** set with the installer's `DISCERN_VERSION`. Use at least the version in `discern.toml` under `[meta].managed_version`, because an older discern won't run the gate. When you upgrade the project, raise the CI version in the same change.

**It installs your runtimes and locked dependencies first,** so the gate's parallel commands don't race to set up their tools.

**It fetches a commit to compare with:** the pull request's base, the commit before a push, or, for a new branch's first push, your **trunk**, the shared branch where changes land. discern compares your project's rules against that commit, so it catches a change that loosens a measured limit or edits a **checkpoint**, a review question your agent answers on certain changes.

**It runs the gate in report mode** from the repository root.

```sh
discern done --ci --standalone --policy-base refs/discern/ci-policy-base --markdown
```

`--ci` lists checkpoint questions without answering them, and `--standalone` records no Proof. Even when every command passes, the report says so:

```text
- Checkpoint review: reported and was not enforced; no review was needed.
- Gate Proof: `diagnostic` (Standalone feedback does not issue Proof. A full discern done run on this clean committed tree does.).
```

Keep the command's failure exit status. Otherwise, a later step that uploads logs could turn a failed gate into a passing job.

## Catch files the commit forgot

If a formatter or code generator rewrites a tracked file during the run, the commit missed its output, so the gate fails. Your agent runs `discern prepare` in its worktree, commits the rewritten files, and pushes again.

## When CI fails

Now say the search tests fail on Linux. Give the result to the agent working on that change:

> "Investigate this CI failure in the existing task. Tell me whether it's the code or the CI system, fix the cause, and bring back the checked result."

Your agent reproduces the failure, fixes the cause, commits, and runs `discern done` again, as [Fix a red gate](fix-a-red-gate.md) explains.

If the report lists a checkpoint question, the task's agent answers it in its worktree. An unmet answer needs your decision before the change lands.

## Require the check before merging

On GitHub, a branch protection rule can require the CI job to pass before a pull request merges. Your agent can name the job, and you may need to turn the rule on yourself.

## Allow merge commits on your trunk

Say your agent's recipe search lands while another task, saved lists, is still in progress. The saved-lists branch and your trunk each now have commits the other lacks, so discern joins them with a merge commit. That happens when the saved-lists agent runs `discern update`, or when saved lists lands, as [When other work lands first](finish-and-land-a-change.md#when-other-work-lands-first) describes. Either way, your trunk gets the merge commit.

On GitHub, the branch protection rule **Require linear history** refuses any push that contains a merge commit. Pushes pass while tasks land one after another, because none of them needs a merge commit. Once tasks overlap, GitHub refuses the next push with `This branch must not contain merge commits.` Leave that rule off for your trunk. If GitHub has already refused a push, turn the rule off and push again. You don't need to rewrite any commits. Rules that block force pushes and branch deletion are compatible, because discern lands a change only by moving your trunk forward.

## When it's done

Test the workflow on a throwaway branch: push a change with a failing test, then the fix. The failing change should fail the required job, with output that explains why. The fix should pass, with no files rewritten during the run.

From then on, every change gets checked on each system you chose. The [CLI reference](../30-reference/cli-reference.md) lists every option and exit code.
