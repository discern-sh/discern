# Getting started

_Cloning, setting up, and running the project locally for the first time._

This is the path from a fresh clone to a running project and a first green gate.
The harness commands are the same on every stack; the stack-specific steps for
discern itself (one self-contained Deno binary — installer and TypeScript engine
in one) are below. This repo self-hosts from source, so the harness verbs run as
`deno task dev <verb>`; a project with the binary on `PATH` runs
`discern <verb>` instead.

## The harness loop

These work the same regardless of language or framework (shown here as
`deno task dev …`, the from-source form this repo uses):

- **`deno task dev worktree`** sets up an isolated checkout for a change (see
  the worktree note in the project guidelines).
- **`deno task dev tidy`** is the fast inner loop — applies the fix-stage work,
  then the check-stage work; no build, no tests.
- **`deno task dev finish`** is the full gate — fixers and build, then checks
  and tests in parallel, then any scope `gate`s whose scope changed, then (in a
  worktree) the merge check. Run it before declaring a change done.
- **`deno task dev doctor`** verifies the install is sound (hooks present, every
  configured capability and check resolvable, git worktree support, required
  tools on PATH).

## Setting up

**Prerequisites.**

- **[Deno](https://deno.com)** — the only build-time dependency. It runs the
  whole tool (installer + engine) from `src/` and compiles the release binaries.
  There is no separate dependency-install step: Deno fetches and caches
  everything from `deno.lock` on first run.
- **`git`** — the engine's one hard runtime dependency (worktrees, the merge
  check, scope classification all shell out to it).

**Run the tool from source.** Always go through `deno task dev` — never the
`dist/` binaries while developing (they bundle a frozen `templates/` snapshot),
and never put `--` before the subcommand (the parser would treat it as the end
of flags and print help):

```sh
deno task dev --help              # the command surface (installer + engine verbs)
deno task dev init                # scaffold into the current dir (try a scratch dir)
deno task build                   # compile per-platform binaries → dist/ (release only)
```

discern has no long-running app to start — it is one CLI binary with the engine
compiled in. To _see it work_, either scaffold it into a temp directory with
`deno task dev init` and drive `discern` (or `deno task dev`) there, or just run
the gate in this repo.

**Your first green gate.** From the repo root:

```sh
deno task dev finish     # or: deno task gate
```

That runs `deno fmt` (fix), then `deno lint` + `deno check src/main.ts` (check
stage) in parallel with `deno task test` (test). There is no `build` capability
(the release build is not part of the gate). A clean checkout should pass; if it
does not, `deno task dev doctor` and the
[finish-gate gotchas](finish-gate-gotchas.md) explain what to fix.

**Working in this repo.** discern self-hosts the worktree workflow
([ADR 0011](../_adr/0011-adopt-worktree-workflow.md), as amended by
[ADR 0019](../_adr/0019-single-binary-ts-engine.md)): the
`.claude/settings.json` hooks provision an isolated worktree per session and
tear it down afterward (here they call `deno task dev worktree:*`), and
`deno task dev worktree:exit` graduates a finished branch back into the main
checkout. Editing rules (yours vs the binary's) live in
[code-conventions.md](code-conventions.md); IDE colour/exclude setup is in
[for-humans.md](for-humans.md).
