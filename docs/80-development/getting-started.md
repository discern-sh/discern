# Getting started

_Cloning, setting up, and running the project locally for the first time._

This is the path from a fresh clone to a running project and a first green gate.
The harness commands are the same on every stack; the stack-specific steps for
icculus itself (a Deno/TypeScript Installer plus a POSIX-shell Harness) are
below.

## The harness loop

These work the same regardless of language or framework:

- **`agent worktree`** sets up an isolated checkout for a change (see the
  worktree note in the project guidelines).
- **`agent tidy`** is the fast inner loop — applies the `fix` slots, then the
  `check` slots; no build, no tests.
- **`agent finish`** is the full gate — fixers and build, then checks and tests
  in parallel, then any side gates whose scope changed, then (in a worktree) the
  merge check. Run it before declaring a change done.
- **`agent doctor`** verifies the install is sound (dispatcher executable, hooks
  present, every configured slot resolvable, git worktree support, required
  tools on PATH).

## Setting up

**Prerequisites.**

- **[Deno](https://deno.com)** — the only build-time dependency. It runs and
  compiles the Installer under `src/`. There is no separate dependency-install
  step: Deno fetches and caches everything from `deno.lock` on first run.
- **`git`** — the Harness's one hard runtime dependency (worktrees, the merge
  check, scope classification all shell out to it).
- **`shellcheck`** _(recommended)_ — the `shellcheck` slot static-lints the
  POSIX shell. Install it (`brew install shellcheck`, or your package manager)
  so `agent finish` runs that check rather than skipping it.

**Run the Installer from source.** Always go through `deno task dev` — never the
`dist/` binaries while developing (they bundle a frozen `templates/` snapshot),
and never put `--` before the subcommand (the parser would treat it as the end
of flags and print help):

```sh
deno task dev --help              # the command surface
deno task dev init                # scaffold into the current dir (try a scratch dir)
deno task build                   # compile per-platform binaries → dist/ (release only)
```

icculus has no long-running app to start — it is a CLI plus a shell harness. To
_see it work_, either scaffold it into a temp directory with
`deno task dev init` and drive `bin/agent` there, or just run the gate in this
repo.

**Your first green gate.** From the repo root:

```sh
./bin/agent finish     # or: deno task gate
```

That runs `deno fmt` (fix), then `deno lint` + `deno check src/main.ts` +
`deno task selfcheck` + the `shellcheck` slot (check) in parallel with
`deno task test` (test). The `build` slot is a deliberate no-op (the release
build is not part of the gate). A clean checkout should pass; if it does not,
`agent doctor` and the [finish-gate gotchas](finish-gate-gotchas.md) explain
what to fix.

**Working in this repo.** icculus self-hosts the worktree workflow
([ADR 0011](../_adr/0011-adopt-worktree-workflow.md)): the
`.claude/settings.json` hooks provision an isolated worktree per session and
tear it down afterward, and `agent worktree:exit` graduates a finished branch
back into the main checkout. Editing rules (managed vs seed) live in
[code-conventions.md](code-conventions.md); IDE colour/exclude setup is in
[for-humans.md](for-humans.md).
