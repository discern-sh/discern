---
id: guide-run-the-gate-in-ci
title: "Run the Gate in CI"
description: "Run report-only Gate evidence in CI and require the result without implying landing authority."
order: 130
publish: true
kind: guide
aliases:
  - "guide-run-the-gate-in-ci"
  - "Run the Gate in GitHub Actions"
  - "ci"
  - "GitHub Actions"
  - "branch protection"
  - "continuous integration"
redirect_from:
  - "/docs/quality-gate/ci"
---

# Run the Gate in CI

Use this guide to make the project's declared Gate a required continuous-integration check. CI should evaluate the checked-out commit, retain useful failure output, and report checkpoint review needs without claiming that the commit is ready to land.

`discern done --ci` produces report-only evidence. It does not record checkpoint declarations, grant authority, or create Proof that `discern accept` can use.

## Starting state

- `discern.toml` already declares the project's Gate jobs and Standards.
- The CI runner checks out the candidate commit with enough Git history to resolve the configured trunk and merge base.
- The workflow installs a pinned discern binary and every runtime named by `[jobs]`.
- Branch protection can require the workflow's result before merging.

## 1. Recreate the project's declared environment

**Person or platform maintainer:** Pin the discern version and the project's toolchain in the workflow. Fetch the configured trunk and enough history for change classification. Restore dependencies from the project's lockfiles.

Do not restate each project check in workflow YAML. `[jobs]`, scope gates, and Standards remain the authority, so local agents and CI run the same declaration.

## 2. Run the report-only Gate

**CI runner:** From the repository root, run:

```sh
discern done --ci --markdown
```

Keep the Markdown result in the job log or summary. Use `--json` when another step consumes exact fields.

The result must show every scheduled job, measured Gate Standard, failed or skipped work, and any checkpoint questions the change would require in a strict local run. CI reports those checkpoint obligations; it cannot make the agent's declaration on behalf of the task.

## 3. Reject uncommitted rewrites

**CI runner:** After the Gate, verify that fixers, generators, and refresh actions left no uncommitted tracked change:

```sh
git diff --exit-code
```

A diff means the candidate did not commit the tree its configured commands produce. The agent should run `discern prepare`, review the output, commit it, and send a new commit.

## 4. Cover deferred Standards deliberately

`measure = "on-demand"` keeps a slow measurement out of every Gate run. If CI is the chosen schedule for that metric, add a separate named job:

```sh
discern standards standard-name --markdown
```

Make its cadence and required status visible. A report that omits deferred measurements must not be described as having measured them.

## 5. Route failures back to the task

**CI runner:** Fail the job when the command exits nonzero and retain the full diagnostic.

**Coding agent:** Use the failed job's captured output and reproduction command in the task's worktree. Run the focused command there, correct the cause, then return through `discern prepare`, commit, and strict `discern done`.

If CI reports a checkpoint obligation, the agent judges it locally with the changed content in view. A person still owns any variance for a declared-unmet conclusion.

## 6. Require the check without conflating states

**Person or platform maintainer:** Configure branch protection to require the CI job. Treat its pass as remote confirmation that the candidate ran in the CI environment.

Before discern acceptance, the task's coding agent must still run ordinary `discern done` on a clean worktree. That strict run can record checkpoint declarations and produce current landing Proof. Passing CI alone leaves the commit report-only and unlanded.

## Completion

The CI path is complete when a known failing candidate makes the required job red with a usable diagnostic, a clean passing candidate makes it green without a diff, and the result is labeled report-only. The next task-side destination is [Finish and land a change](finish-and-land-a-change.md).

Use the [CLI reference](../30-reference/cli-reference.md) for flags and exit codes, [Proof and checkpoint formats](../30-reference/proof-and-checkpoint-formats.md) for report-only state, and [Fix a red Gate](fix-a-red-gate.md) for local recovery.
