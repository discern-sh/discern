---
title: Run the Gate in CI
description: Run discern done --ci on GitHub Actions and require the machine Gate result before a pull request can merge.
order: 70
aliases:
  - ci
  - GitHub Actions
  - branch protection
  - continuous integration
---

# Run the Gate in GitHub Actions

_Run the machine gate and report checkpoint questions on pull requests, then make that check required on trunk._

CI runs the gate for changes without a stateful local discern worktree. The explicit `discern done --ci` lane evaluates the governing checkpoint policy and runs the ordinary machine jobs. Fired stop questions await review; the runner writes no open question or declaration. Its Proof says checkpoint review was reported and was not enforced, so `discern accept` cannot use it for landing. A later ordinary `discern done` in a local worktree performs the strict review.

The workflow installs a pinned binary and the project's toolchain, fetches release tags plus the trunk ref used by merge and standard checks, runs the gate, and confirms that fixers left the committed tree unchanged. Tags supply the last published public-schema baseline; the later shallow `git fetch --no-tags` updates trunk without deleting them. Requiring the job makes machine success a merge condition and keeps checkpoint questions visible. It proves no agent review and transports no declarations.

## Add the workflow

This example uses Deno for the project's own toolchain. Replace that setup step with the commands your jobs need.

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
  RELEASE_ASSET: discern-x86_64-unknown-linux-gnu

jobs:
  gate:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@d23441a48e516b6c34aea4fa41551a30e30af803 # v6
        with:
          fetch-tags: true

      - name: Fetch trunk
        shell: bash
        run: |
          git fetch --no-tags --depth=1 origin \
            +refs/heads/main:refs/remotes/origin/main
          if [ "$(git branch --show-current)" != "main" ]; then
            git branch --force main refs/remotes/origin/main
          fi

      - name: Install discern
        shell: bash
        run: |
          set -euo pipefail
          base="https://github.com/jackwh/discern/releases/download/${DISCERN_VERSION}"
          curl -fsSLO "${base}/${RELEASE_ASSET}"
          curl -fsSLO "${base}/${RELEASE_ASSET}.sha256"
          sha256sum -c "${RELEASE_ASSET}.sha256"
          install -m 0755 "${RELEASE_ASSET}" "${RUNNER_TEMP}/discern"
          echo "${RUNNER_TEMP}" >> "${GITHUB_PATH}"

      - uses: denoland/setup-deno@22d081ff2d3a40755e97629de92e3bcbfa7cf2ed # v2
        with:
          deno-version: v2.x
          cache: true

      - name: Install locked dependencies
        run: deno install --frozen

      - name: Run the Gate
        run: discern done --ci

      - name: Assert a clean tree
        run: git diff --exit-code
```

Set `DISCERN_VERSION` to the release tag you approve. `RELEASE_ASSET` must match the runner architecture. Change both `main` references when your trunk has another name.

The full commit hashes pin remote action code to the reviewed commit. The comments name the release line for maintenance. Advance those pins through a reviewed automated dependency update instead of changing them back to mutable tags.

The toolchain and dependency steps belong before the gate because discern runs the commands in `discern.toml`; it does not install their toolchain or dependencies. Converge dependencies serially before `discern done`, since the gate may start several configured jobs in parallel.

## Wrapped test tasks

The workflow above already installs discern, so a wrapped test task works unchanged and acquires immediately in a fresh checkout. Any other workflow that invokes that task must install discern first.

## Require the result

In the repository's rule set or branch-protection settings, require pull requests and the `gate` job before merge. The workflow reports the machine verdict and checkpoint questions; the repository rule turns the machine verdict into policy. Keep the push trigger so landed commits also produce a record. A push-to-trunk run normally has an empty effort diff, so no change-triggered question fires there.

## Standards in CI

`discern done` verifies every standard limit against trunk and measures standards whose `measure` is `"gate"`. The fetch step supplies the trunk ref required for that comparison. If the project defers a metric with `measure = "on-demand"`, add a pull-request step that runs `discern standards` after the same toolchain setup.

## Cloud-agent changes

A cloud coding agent may start from a clone without the discern binary or materialized skills. Committed agent instructions still travels with the clone. The required CI job installs discern and runs the repository's gate before the change can merge. A wrapped task without the binary exits 127, so an agent that runs it needs discern installed. Installation also supplies Model Context Protocol tools and skills.

## Where it lives in code

| Concern                             | Source                                                                    |
| ----------------------------------- | ------------------------------------------------------------------------- |
| Binary release assets and checksums | [`.github/workflows/release.yml`](../../../.github/workflows/release.yml) |
| Gate preconditions and standards    | [`finish.ts`](../../../src/engine/gate/finish.ts)                         |
| Non-interactive job environment     | [`command.ts`](../../../src/engine/jobs/command.ts)                       |

## Current state & gotchas

- Do not run `discern refresh` in the gate job. CI verifies committed instructions and accepts an intentionally missing untracked copy; regenerating first can hide drift.
- Do not put `--met`, `--unmet`, or a rationale in workflow YAML. `--ci` rejects declaration flags before any checkpoint or Gate write; review conclusions belong to a stateful local worktree.
- Pull-request checkouts may lack local `main`. Fetch it without exporting `DISCERN_TRUNK` into project jobs.
- Keep `fetch-tags: true` on every checkout that can run discern's gate. A release candidate at `HEAD` is excluded from its own schema baseline, so it compares with the previous version tag.
- `git diff --exit-code` catches fixer output. Without it, the workflow can finish after changing the runner's checkout and does not verify that the commit contains those changes.
