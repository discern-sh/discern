# Getting started

_Cloning, setting up, and running the project locally for the first time._

This is the path from a fresh clone to a running project and a first green gate.
The harness commands are the same on every stack; the stack-specific steps for
discern itself (one self-contained Deno binary — installer and TypeScript engine
in one) are below. This repo self-hosts from source: the harness verbs run as
`discern <verb>` — the same command an end user runs, except here the local-dev
wrapper (`scripts/discern`) points it at the current checkout's own engine.

## The harness loop

These work the same regardless of language or framework (shown here as
`discern <verb>`):

- **`discern worktree`** sets up an isolated checkout for a change (see the
  worktree note in the project guidelines).
- **`discern prepare`** is the fast inner loop — applies the fix-stage work,
  then the check-stage work; no build, no tests.
- **`discern finish`** is the full gate — (in a worktree) a fail-fast merge
  check first, then fixers and build, then checks and tests in parallel, then
  any scope `gate`s whose scope changed. Run it before declaring a change done.
- **`discern doctor`** verifies the install is sound (hooks present, every
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

**Run the tool from source.** Install the dev wrapper once with
`deno task install-dev-cli`: it puts a `discern` on your `PATH` that runs the
engine of whichever checkout you're in — a worktree runs its own in-progress
engine — mirroring what an end user runs. Outside any checkout (driving discern
against another project, or from a GUI-launched agent's hooks that carry no
shell env), it falls back to the main checkout baked into the wrapper at install
time, which `$DISCERN_HOME` overrides when set. Then drive everything with
`discern <verb>`. Never use the `dist/` binaries while developing; they bundle a
frozen `templates/` snapshot. (No wrapper yet? `deno task dev <verb>` runs the
same thing straight from the clone — just don't put `--` before the subcommand,
or the parser prints help.)

```sh
deno task install-dev-cli         # put `discern` on your PATH (once)
discern --help                    # the command surface (installer + engine verbs)
discern init                      # scaffold into the current dir (try a scratch dir)
deno task build                   # compile per-platform binaries → dist/ (release only)
```

**Test the real compiled binary, briefly.** Occasionally you need the shipped
artifact on your `PATH` instead of the source shim — an opaque binary with no
trace of this checkout (say, to rule the shim out as the cause of a client-side
quirk). `deno task use-compiled-build` builds the host binary, swaps it in, then
holds it there only while the command runs; press Ctrl+C and it restores the dev
shim automatically, so the unusual state can't outlive the terminal that reminds
you of it. (Killed with `-9`? Restore by hand with `install-dev-cli`.)

discern has no long-running app to start — it is one CLI binary with the engine
compiled in. To _see it work_, either scaffold it into a temp directory with
`discern init` and drive `discern` there, or just run the gate in this repo.

**Your first green gate.** From the repo root:

```sh
discern finish     # or: deno task gate
```

That runs `deno fmt` (fix), then `deno lint` + `deno check src/main.ts` (check
stage) in parallel with `deno task test` (test). There is no `build` capability
(the release build is not part of the gate). A clean checkout should pass; if it
does not, `discern doctor` and the [finish-gate gotchas](finish-gate-gotchas.md)
explain what to fix.

**Working in this repo.** discern self-hosts the worktree workflow
([ADR 0011](../_adr/0011-adopt-worktree-workflow.md), as amended by
[ADR 0019](../_adr/0019-single-binary-ts-engine.md)): the
`.claude/settings.json` hooks provision an isolated worktree per session and
tear it down afterward (here they call `deno task dev worktree:*`), and
`discern graduate` graduates a finished branch back into the main checkout.
Editing rules (yours vs the binary's) live in
[code-conventions.md](code-conventions.md); IDE colour/exclude setup is in
[for-humans.md](for-humans.md).
