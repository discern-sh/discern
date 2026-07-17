---
title: Run the gate in CI
description: Run discern done on GitHub Actions and require the result before a pull request can merge.
order: 50
aliases:
  - ci
  - GitHub Actions
  - branch protection
  - continuous integration
---

# Run the gate in GitHub Actions

_Run the same `discern done` command on pull requests, then make that check required on trunk._

CI enforces the gate even when a change did not pass through a local discern worktree. The workflow installs a pinned binary, installs the project's toolchain, fetches the trunk ref used by merge and standards checks, runs the gate, and confirms that fixers left the committed tree unchanged.

## Add the workflow

This example uses Deno for the project's own toolchain. Replace that setup step with the commands your capabilities need.

Create `.github/workflows/discern-gate.yml`:

```yaml
name: discern-gate

on:
  push:
    branches: [main]
  pull_request:

permissions:
  contents: read

concurrency:
  group: ${{ github.workflow }}-${{ github.ref }}
  cancel-in-progress: ${{ github.event_name == 'pull_request' }}

env:
  DISCERN_VERSION: v1.0.0
  DISCERN_ASSET: discern-x86_64-unknown-linux-gnu

jobs:
  gate:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v6

      - name: Fetch trunk
        run: >-
          git fetch --no-tags --depth=1 origin
          +refs/heads/main:refs/remotes/origin/main

      - name: Install discern
        shell: bash
        run: |
          set -euo pipefail
          base="https://github.com/jackwh/discern/releases/download/${DISCERN_VERSION}"
          curl -fsSLO "${base}/${DISCERN_ASSET}"
          curl -fsSLO "${base}/${DISCERN_ASSET}.sha256"
          sha256sum -c "${DISCERN_ASSET}.sha256"
          install -m 0755 "${DISCERN_ASSET}" "${RUNNER_TEMP}/discern"
          echo "${RUNNER_TEMP}" >> "${GITHUB_PATH}"

      - uses: denoland/setup-deno@v2
        with:
          deno-version: v2.x
          cache: true

      - name: Run the gate
        env:
          DISCERN_MAIN_BRANCH: origin/main
        run: discern done

      - name: Assert a clean tree
        run: git diff --exit-code
```

Set `DISCERN_VERSION` to the release tag you approve. `DISCERN_ASSET` must match the runner architecture. Change both `main` references when your trunk has another name.

The toolchain step belongs before the gate because discern runs the commands in `discern.toml`. It does not install their toolchain or dependencies.

## Require the result

In the repository's rule set or branch-protection settings, require pull requests and the `gate` job before merge. The workflow reports a status. The repository rule turns that status into policy. Keep the push trigger so landed commits also produce a record.

## Standards in CI

`discern done` verifies every standard limit against trunk and measures standards whose `measure` is `"gate"`. The fetch step makes that comparison conclusive. If the project defers a metric with `measure = "on-demand"`, add a pull-request step that runs `discern standards` after the same toolchain setup.

## Cloud-agent changes

A cloud coding agent may start from a clone without the discern binary or materialized skills. Committed agent guidance still travels with the clone. The required CI job installs discern and runs the repository's gate before the change can merge. Install discern in the agent environment as well when you want Model Context Protocol tools and skills during the work.

## Where it lives in code

| Concern                             | Source                                                                    |
| ----------------------------------- | ------------------------------------------------------------------------- |
| Binary release assets and checksums | [`.github/workflows/release.yml`](../../../.github/workflows/release.yml) |
| Gate preconditions and standards    | [`finish.ts`](../../../src/engine/gate/finish.ts)                         |
| Non-interactive job environment     | [`command.ts`](../../../src/engine/jobs/command.ts)                       |

## Current state & gotchas

- Do not run `discern refresh` in the gate job. CI verifies committed guidance and accepts an intentionally missing untracked copy; regenerating first can hide drift.
- A pull-request checkout may lack a local trunk branch. Fetching `origin/main` and setting `DISCERN_MAIN_BRANCH` prevents the never-loosen check from becoming unverified.
- `git diff --exit-code` catches fixer output. A workflow that omits it can finish after changing the runner's checkout, which proves less than the commit contains.
