# ADR 0010: Self-host the harness — install icculus into its own repo

**Status**: accepted; **superseded by
[ADR 0019](0019-single-binary-ts-engine.md)** — see _Update (single-binary
cutover)_ below.

## Update (single-binary cutover)

The single-binary cutover ([ADR 0019](0019-single-binary-ts-engine.md)) inverts
self-host. There is no committed shell harness to install into the repo — the
engine is TypeScript compiled into the `icculus` binary — so the repo self-hosts
by running its **own** engine (`deno task dev finish`), with no second copy to
keep in sync. The drift-gate this ADR established (`selfcheck`/`selfsync`) is
removed: the regression class it guarded is made structurally impossible,
because there is nothing that can drift.

## Context

icculus is an agentic-development harness in two halves: a Deno/TypeScript
installer (`src/`) and the POSIX-shell harness it installs (`templates/`, the
source of truth). Until now the repo was **not** self-installed — there was no
root `icculus.toml`, `bin/agent`, or `.icculus/`. The README's self-hosting
section was therefore aspirational: the repo's real gate was the local
convention `deno fmt && deno lint && deno check src/main.ts && deno task test`,
and CI only built release binaries.

That left the product's two most distinctive pieces unexercised by real use: the
`agent finish` gate as a daily driver, and the author-once→compile guidelines
pipeline (the repo had no generated `CLAUDE.md`/`AGENTS.md` at all). The test
suite drives the engine hermetically (`tests/engine_*` scaffold the real
`templates/` and shell out to `bin/agent`), but a test harness is not the same
as living with the tool. Installing the harness into its own repo is the truest
validation we can run, and the repo is pre-1.0 and pre-adoption, so there is no
backward-compatibility cost to doing it now.

## Decision

Install the harness into the repo and make `./bin/agent finish` the repo's gate.

- **Committed managed copy ("Option C").** `icculus init` runs at the root; the
  managed set (`bin/agent`, `.icculus/engine/**`, `.ai/skills/**`) is committed
  as a copy of `templates/`, alongside the seed files `init` writes
  (`icculus.toml`, `docs/**`, `.ai/guidelines/icculus.md`, `TODO.md`).
- **Drift is a gate-enforced invariant.** A new read-only
  `icculus upgrade --check` (exposed as `deno task selfcheck`) exits non-zero if
  any managed file differs from `templates/`. It is wired as `[slots.selfcheck]`
  in the `check` phase, so `agent finish` fails on drift. Healing is one command
  — `deno task selfsync` (≡ `icculus upgrade`) — which propagates `templates/` →
  the install.
- **The golden rule.** To change a managed file you edit `templates/` and run
  `deno task selfsync`; never edit the root copy (a direct edit is reported as
  drift and written back as `<file>.new`). Seed files are edited directly at the
  root and are never distributed to other projects.
- **Wired slots.** `deno fmt` (fix); `deno lint`, `deno check src/main.ts`, and
  `selfcheck` (check); `deno task test` (test). Build stays a no-op
  (`deno task build` is release-only).
- **Guidance via the pipeline.** Agent guidance is authored in
  `.ai/guidelines/icculus.md` (a seed) and compiled by `agent guidelines` into
  `AGENTS.md` (tracked) and `CLAUDE.md` (generated, gitignored).
- **CI runs the repo's own gate** (`agent finish`) on push and PR, with a
  trailing `git diff --exit-code` so the auto-fixing `fix` phase becomes a hard
  check.
- **fmt/lint exclude the managed artifacts** (`.icculus/`, `.ai/`, `AGENTS.md`,
  `CLAUDE.md`, plus `.idea/`) so the formatter never rewrites a managed file
  into drift or fights the guidelines compiler.

## Consequences

- The repo now has **two copies of the engine**: `templates/.icculus/engine/**`
  (the source the test suite runs) and `.icculus/engine/**` (the installed copy
  that gates this repo). The `selfcheck` gate plus the golden rule keep them
  identical; the cost is the discipline of editing `templates/` and syncing.
- The gate runs on itself: `agent finish` runs `deno task test`, whose
  `engine_*` tests shell out to `agent finish`. This nesting immediately
  surfaced a real bug — `finish` exported the `fail_fast`/`stream` env vars only
  when on and never cleared them, so a nested gate inherited the parent's value
  and ignored its own `[gate]` config. Fixed (set both ways) with a regression
  test. Exactly the kind of defect only living with the tool reveals.
- The test suite remains the **correctness arbiter** for the engine: a
  `templates/` change is validated by `deno task test` whether or not the
  install is synced yet. If a bad engine change ever breaks `agent finish`
  itself, fall back to `deno task test` or `git checkout .icculus/engine`.
- `icculus upgrade --check` is a genuinely useful new feature for any user (CI
  can now assert harness sync), not just an internal device.
- The isolated-worktree workflow is now installed and exercisable for real, but
  adopting it for this repo's own development is deferred (see `TODO.md`); the
  SessionStart/WorktreeCreate hooks are scaffolded and dormant.
- Backward compatibility is not a concern (pre-1.0, pre-adoption), so this was
  done without migration shims.

## Alternatives considered

- **Symlink the install to `templates/`.** Simplest to keep in sync, but it
  bypasses the real copy/`upgrade` machinery — the part most worth validating in
  real use — and no installed project works that way. Rejected.
- **Generate the install on demand, don't commit it.** Avoids the second engine
  copy, but adds a cold-start build step before the gate can run and makes the
  install invisible in the tree and in review. Rejected in favour of a committed
  copy kept honest by `selfcheck`.
- **Auto-sync via a git hook.** A pre-commit hook that runs `selfsync` would
  heal drift silently — and could silently commit a broken engine change. Making
  drift a loud gate failure (the kind of invariant the harness exists to
  provide) is the point. Rejected.
