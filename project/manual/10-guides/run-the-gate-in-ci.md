---
id: guide-run-the-gate-in-ci
title: "Run the gate in CI"
description: "Run report-only gate evidence in CI and require the result without implying landing authority."
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

Continuous integration, or **CI**, runs checks when changes reach your code-hosting service. Running discern there lets your project use the same declared checks locally and remotely, with a result that another person can inspect.

Suppose a change works on your laptop but needs to work on Linux too. A CI job can exercise it in that environment and keep the failure output with the change. You and your agent get another place to check the result without maintaining a second list of quality rules.

## Ask for the check you need

Once the project has completed discern setup, ask your agent or the person maintaining your CI:

> Add discern's gate to our CI workflow. Use the checks already declared for this project, keep useful failure output, and show that the workflow fails for a known broken change and passes for a corrected one. Explain any repository setting I need to change.

Choose the environments the project needs to support. Your agent can recommend them from the project's runtimes and users. CI configuration and any credentials belong to your hosting service; discern runs the checks you configure there.

A passing CI report says what ran in that environment. It does not give permission to land, record an agent's checkpoint answers, or create the Proof that discern acceptance requires. The task still goes through its ordinary completion and review process.

## 1. Recreate the project's declared environment

The workflow checks out the change, installs a pinned discern version and the project's required runtimes, and installs locked dependencies. Dependency setup comes before the gate so checks can run concurrently without competing to install their tools.

Keep `[jobs]`, scope gates, and standards in `discern.toml` as the shared check definitions. The workflow should invoke those definitions through discern rather than copy each check into a separate CI command.

The workflow also needs enough Git history to identify what changed. Fetch the event's actual comparison commit into a local reference. For a pull request, use its base commit; for a push, use the prior commit. This **policy base** lets discern compare the rules before and after the change. Comparing a pushed change with its own new tip could hide a weakened rule.

## 2. Run the report-only gate

From the repository root, the CI runner invokes:

```sh
discern done --ci --standalone --context linux --policy-base refs/discern/ci-policy-base --markdown
```

This workflow produces a separate CI report. Its results do not fulfill the evidence requirements for ordinary task completion, and a report never places the task in the landing queue.

This example assumes the workflow has fetched the comparison commit into `refs/discern/ci-policy-base` and supplies the declared `linux` context. A **context** names an environment where the project requires checks or measurements. Use the name configured for your workflow.

The options make the purpose explicit:

- `--ci` reports checkpoint questions without recording answers for the task.
- `--standalone` requests a report without admitting work to the completion queue or producing landing Proof.
- `--context` identifies the environment this run supplies.
- `--policy-base` identifies the rules the report should compare against.
- `--markdown` keeps a readable result in the job log or summary. Use `--json` if another step needs structured fields.

Retain the command's failure status and complete diagnostic. A later log-upload or summary step must not turn a failed gate into a successful CI job.

## 3. Reject uncommitted rewrites

After the gate, the workflow checks for changes made by formatters, generators, or refresh:

```sh
git diff --exit-code
```

A tracked diff means the submitted commit did not include the output its configured commands produce. Your agent should run `discern prepare` in the task's worktree, review and commit the output, and send the corrected commit through CI.

## 4. Include required measurements

The CI report should include the measurements required in the environment it supplies. A successful Linux check does not answer a requirement to check the same behavior on macOS. Ask the agent to show which environments the workflow covered and which remain outstanding.

Ordinary task completion has its own evidence requirements. Your agent must arrange the [required contexts and execution procedures](../30-reference/config-reference.md#completion) for that process; it cannot import this standalone report as completion evidence. An unavailable context or skipped check cannot stand in for a pass.

## 5. Route failures back to the task

When CI fails, give the result to the agent working on that change:

> Investigate this CI failure in the existing task. Explain whether it is a behavior problem or an environment difference, fix the cause, and return the checked result.

The agent uses captured output and the reported reproduction command, corrects the cause, and returns through preparation, commit, and full completion. [Fix a red gate](fix-a-red-gate.md) explains that recovery.

If CI reports a checkpoint question, the task's agent judges it with the actual change in view. A declared-unmet answer still needs your explicit decision on that exception.

## 6. Require the check without conflating states

Use your hosting service's branch-protection settings to require the CI job before a merge. Your agent can identify the job and explain the setting; you may need to apply it using your account's permissions.

Before discern acceptance, the task still runs ordinary `discern done`. That process records checkpoint judgments and gathers current completion evidence. You review the result and supply any required landing decision through [Finish and land a change](finish-and-land-a-change.md).

## Completion

Verify the workflow with a deliberately failing test change on a disposable branch, then a corrected version. The first should make the required job fail with a useful explanation. The second should pass without uncommitted rewrites. Neither report should claim landing Proof.

You now have a remote check that follows the project's declared practice and gives a failed change a clear route back to its agent. The [CLI reference](../30-reference/cli-reference.md) supplies exact options and exit codes; [Proof and checkpoint formats](../30-reference/proof-and-checkpoint-formats.md) explains report-only records.
