# Run the gate on GitHub Actions

_Protect your `main` branch: run `discern done` on every pull request, then
require that check before anything can merge._

## Protect your main branch

Local gates are discipline: a person or tool can still push around them. CI
turns the gate into repository policy once the integration branch is protected.
Every pull request and every push to that branch runs the same `discern done`
command you run locally; GitHub branch protection or a rule set is what blocks
bypasses until that check is green.

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
        run: discern done

      - name: Assert a clean tree
        run: git diff --exit-code
```

Then protect `main`: require pull requests, require the `discern-gate` status
check before merge, and decide who can bypass the rule. The workflow reports the
result; the branch rule makes it block. The push trigger verifies landed commits
and catches policy mistakes, but it cannot stop an already-accepted push by
itself.

### The two values to customize

The workflow runs as-is against discern's published releases. Two values pin it
to the version and runner you want:

- **`DISCERN_VERSION`** — the released version CI installs and trusts (for
  example `v1.0.0`). The job downloads that release's Linux asset and verifies
  its matching `.sha256` file before putting `discern` on `PATH`.
- **`DISCERN_ASSET`** — the release asset for your runner's platform. Change it
  when your job runs on something other than x86-64 Linux.

Everything below is optional depth: adapting the workflow to your stack,
ephemeral cloud-agent environments, cost, and ratchets.

## Adapting the workflow

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
its setup steps before `discern done`.

Do not add `discern refresh` to CI just because the generated agent files are
missing on a fresh clone. That is expected: those files are generated artifacts,
and the guidance check accepts `missing` as current. CI should verify the tree
you committed, not materialize extra files and carry on.

## Ephemeral cloud-agent environments

Some coding agents don't run on your machine at all — they run in a fresh clone
of your repo in an ephemeral environment: GitHub Copilot's coding agent, Codex
on the web, and similar cloud runners. They clone the repo _without_ the discern
binary, and discern's generated artifacts are gitignored by default
([ADR 0034](../_adr/0034-agents-md-untracked-currency-check.md)), so those
environments start with them absent:

- the **compiled agent guidance** (`AGENTS.md` / `CLAUDE.md` / `GEMINI.md`) — so
  the agent reads none of your discern guidance;
- the **materialized skills** (`.claude/skills/`, `.agents/skills/`) — so the
  bundled and authored skills aren't discoverable;
- the **MCP server** — there is no binary to run `discern mcp`, so the
  `discern_*` tools aren't available.

That absence is deliberate, and the default does not change: tracking a
derivative invites drift, and the reviewable source is your
`discern/guidance.md`, not the compiled output. The cloud-agent case is a
per-project choice ADR 0034 already sanctions, made per project rather than
flipped globally:

- **Commit the artifacts.** Drop the compiled agent files (and, if you want the
  skills too, their directories) from the `.gitignore` block so they travel with
  the clone. The ephemeral agent then reads your guidance without the binary.
  The trade-off is that you now maintain tracked generated files — run
  `discern refresh` and commit them when the guidance source changes, or the
  gate's currency check flags the drift.
- **Install discern in the environment.** Add the same install step CI uses (see
  above) to the environment's setup, so the binary is present. `discern refresh`
  can then materialize the files and the MCP server can run — but keep the
  refresh in the environment's own setup, not in the gate job, for the reason in
  [What to customize](#what-to-customize).
- **Rely on the gate in CI.** For the gate specifically, the workflow above
  installs discern and runs `discern done` on every pull request, so a change
  that originates in a cloud environment is still held to the same bar before it
  can land — whether or not that environment had discern while the work
  happened.

Pick per project by what the ephemeral agent needs: guidance and skills (commit
the artifacts), the full tool surface (install the binary), or just the merge
bar (the CI gate).

## Cost

This spends GitHub Actions minutes on every pull request update and every push
to the integration branch. The cost is the time to install the runner toolchain
plus the time your `discern done` capabilities and checks already take. Use the
cache knobs for your stack once the plain workflow is green.

## Ratchets

`discern ratchets` stays outside `discern done` because metric checks can be
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
the gate expects. If CI fails after `doctor` is clean, run `discern done`
locally and compare the failing capability with the CI log; the runner is often
missing one dependency your machine already had.

Other CI systems use the same shape: check out the repo, install a pinned
`discern`, install the project toolchain, run `discern done`, and assert the fix
stage changed nothing.
