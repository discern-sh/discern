---
id: guide-run-the-gate-in-ci
title: "Run the gate in CI"
description: "Run report-only gate evidence in CI and require the result without implying landing authority."
order: 130
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

# Run the Gate in CI

Use this guide to make the project's declared gate a required continuous-integration check. CI should evaluate the checked-out commit, retain useful failure output, and report checkpoint review needs without claiming that the commit is ready to land.

`discern done --ci` produces report-only evidence. It does not record checkpoint declarations, grant authority, or create Proof that `discern accept` can use.

## Starting state

- `discern.toml` already declares the project's gate jobs and standards.
- The CI runner checks out the candidate commit with enough Git history and an explicit local ref for the event’s actual comparison commit.
- The workflow installs a pinned discern binary and every runtime named by `[jobs]`.
- Branch protection can require the workflow's result before merging.

## 1. Recreate the project's declared environment

**Person or platform maintainer:** Pin discern and the project's toolchain. Fetch enough history for change classification and fetch the event's actual policy base into a local ref. For a pull request, use its base commit; for a push, use the prior commit. Keep the checked-out source unchanged. Comparing a push with its new tip can hide the policy change being checked.

Install locked dependencies before the gate. The gate may run several commands at once, so dependency setup belongs in a preceding serial step. Do not restate each project check in workflow YAML. `[jobs]`, scope gates, and standards remain the authority, so local agents and CI run the same declaration.

## 2. Run the report-only Gate

**CI runner:** From the repository root, run:

```sh
discern done --ci --standalone --context linux --policy-base refs/discern/ci-policy-base --markdown
```

Replace `linux` with the context this workflow supplies, and fetch `refs/discern/ci-policy-base` before invoking the command.

Keep the Markdown result in the job log or summary. Use `--json` when another step consumes exact fields.

The result must show every scheduled job, measured gate standard, failed or skipped work, and any checkpoint questions the change would require in a strict local run. CI reports those checkpoint obligations; it cannot make the agent's declaration on behalf of the task.

## 3. Reject uncommitted rewrites

**CI runner:** After the gate, verify that fixers, generators, and refresh actions left no uncommitted tracked change:

```sh
git diff --exit-code
```

A diff means the candidate did not commit the tree its configured commands produce. The agent should run `discern prepare`, review the output, commit it, and send a new commit.

## 4. Include required measurements

Every required standard runs through the completion planner. Standards can share an instrumented test producer, and valid captured evidence can be reused. There is no setting to defer a required measurement while reporting completion as green.

Declare the contexts each requirement needs. A required remote context needs its own matching evidence; a skipped check or local report cannot stand in for it. A report-only workflow remains a report even when all of its measurements pass.

## 5. Route failures back to the task

**CI runner:** Fail the job when the command exits nonzero and retain the full diagnostic.

**Coding agent:** Use the failed job's captured output and reproduction command in the task's worktree. Run the focused command there, correct the cause, then return through `discern prepare`, commit, and strict `discern done`.

If CI reports a checkpoint obligation, the agent judges it locally with the changed content in view. A person still owns any variance for a declared-unmet conclusion.

## 6. Require the check without conflating states

**Person or platform maintainer:** Configure branch protection to require the CI job. Treat its pass as remote confirmation that the candidate ran in the CI environment.

Before discern acceptance, the task's coding agent must still run ordinary `discern done` on a clean worktree. That strict run can record checkpoint declarations and produce current landing Proof. Passing CI alone leaves the commit report-only and unlanded.

## Completion

The CI path is complete when a known failing candidate makes the required job red with a usable diagnostic, a clean passing candidate makes it green without a diff, and the result is labeled report-only. The next task-side destination is [Finish and land a change](finish-and-land-a-change.md).

Use the [CLI reference](../30-reference/cli-reference.md) for flags and exit codes, [Proof and checkpoint formats](../30-reference/proof-and-checkpoint-formats.md) for report-only state, and [Fix a red gate](fix-a-red-gate.md) for local recovery.
