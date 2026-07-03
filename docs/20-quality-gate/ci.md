# Run the gate on GitHub Actions

_Run `discern finish` in CI, then require that check before merging._

Local gates are discipline: a person or tool can still push around them. CI
turns the gate into repository policy once the integration branch is protected.
Every pull request and every push to that branch runs the same `discern finish`
command you run locally; GitHub branch protection or a rule set is what blocks
bypasses until that check is green.

## Copy this workflow

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
  DISCERN_REPO: jackwh/discern
  DISCERN_VERSION: v1.0.0
  DISCERN_ASSET: discern-x86_64-unknown-linux-gnu

jobs:
  discern-gate:
    name: discern-gate
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v7

      - name: Install discern
        shell: bash
        run: |
          set -euo pipefail
          mkdir -p "$HOME/.local/bin"
          base_url="https://github.com/${DISCERN_REPO}/releases/download/${DISCERN_VERSION}"
          curl -fsSLO "${base_url}/${DISCERN_ASSET}"
          curl -fsSLO "${base_url}/${DISCERN_ASSET}.sha256"
          sha256sum -c "${DISCERN_ASSET}.sha256"
          install -m 0755 "${DISCERN_ASSET}" "$HOME/.local/bin/discern"
          echo "$HOME/.local/bin" >> "$GITHUB_PATH"
          "$HOME/.local/bin/discern" --version

      - uses: actions/setup-node@v6
        if: ${{ hashFiles('package-lock.json', 'npm-shrinkwrap.json', 'pnpm-lock.yaml', 'yarn.lock') != '' }}
        with:
          node-version: lts/*

      - name: Install npm dependencies
        if: ${{ hashFiles('package-lock.json', 'npm-shrinkwrap.json') != '' }}
        run: npm ci

      - name: Install pnpm dependencies
        if: ${{ hashFiles('pnpm-lock.yaml') != '' }}
        run: |
          corepack enable
          pnpm install --frozen-lockfile

      - name: Install Yarn dependencies
        if: ${{ hashFiles('yarn.lock') != '' }}
        run: |
          corepack enable
          yarn install --immutable

      - uses: denoland/setup-deno@v2
        if: ${{ hashFiles('deno.json', 'deno.lock') != '' }}
        with:
          deno-version: v2.x
          cache: true

      - uses: actions/setup-python@v6
        if: ${{ hashFiles('requirements.txt', 'pyproject.toml') != '' }}
        with:
          python-version: "3.x"
          cache: pip

      - name: Install Python requirements
        if: ${{ hashFiles('requirements.txt') != '' }}
        run: python -m pip install -r requirements.txt

      - name: Install Python package
        if: ${{ hashFiles('requirements.txt') == '' && hashFiles('pyproject.toml') != '' }}
        run: |
          python -m pip install --upgrade pip
          python -m pip install -e ".[dev]" || python -m pip install -e .

      - name: Stop if no setup matched
        if: ${{ hashFiles('package-lock.json', 'npm-shrinkwrap.json', 'pnpm-lock.yaml', 'yarn.lock', 'deno.json', 'deno.lock', 'requirements.txt', 'pyproject.toml') == '' }}
        run: |
          echo "Add the setup steps for your stack before running discern."
          exit 1

      - name: Run the gate
        run: discern finish

      - name: Assert a clean tree
        run: git diff --exit-code
```

Then protect `main`: require pull requests, require the `discern-gate` status
check before merge, and decide who can bypass the rule. The workflow reports the
result; the branch rule makes it block. The push trigger verifies landed commits
and catches policy mistakes, but it cannot stop an already-accepted push by
itself.

## What to customize

Set `DISCERN_VERSION` to the released version you want CI to trust. The example
installs the Linux release asset directly so the runner can verify the matching
`.sha256` file before putting `discern` on `PATH`. If your job runs on another
runner, change `DISCERN_ASSET` to that runner's release asset.

Change the integration branch if your project does not use `main`:

```yaml
on:
  push:
    branches: [trunk]
```

Keep the stack setup section honest. `discern` runs the commands in
`discern.toml`; it does not install Node packages, Python packages, Deno, a
database client, a browser, or any other tool those commands need. The workflow
includes common Deno, Node, and Python setup paths, but a different stack needs
its setup steps before `discern finish`.

Do not add `discern refresh` to CI just because the generated agent files are
missing on a fresh clone. That is expected: those files are generated artifacts,
and the guidance check accepts `missing` as current. CI should verify the tree
you committed, not materialize extra files and carry on.

## Cost

This spends GitHub Actions minutes on every pull request update and every push
to the integration branch. The cost is the time to install the runner toolchain
plus the time your `discern finish` capabilities and checks already take. Use
the cache knobs for your stack once the plain workflow is green.

## Ratchets

`discern ratchets` stays outside `discern finish` because metric checks can be
slow. Add a second, pull-request-only job once the project has ratchets
configured:

```yaml
jobs:
  ratchets:
    if: github.event_name == 'pull_request'
    name: discern-ratchets
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v7

      - name: Fetch main for the never-loosen comparison
        run: git fetch --no-tags --depth=1 origin +refs/heads/main:refs/heads/main || true

      # Repeat the same "Install discern" and stack setup steps from the gate
      # job here, then hold the metric floors and ceilings.
      - name: Hold the ratchets
        run: discern ratchets
```

The separate job keeps landed-commit checks fast while still blocking pull
requests that loosen a configured metric.

## Troubleshooting

Start with `discern doctor`. It checks the install, the config, and the tools
the gate expects. If CI fails after `doctor` is clean, run `discern finish`
locally and compare the failing capability with the CI log; the runner is often
missing one dependency your machine already had.

Other CI systems use the same shape: check out the repo, install a pinned
`discern`, install the project toolchain, run `discern finish`, and assert the
fix stage changed nothing.
