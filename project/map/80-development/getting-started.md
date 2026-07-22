# Getting started

_Cloning, setting up, and running the project locally for the first time._

This is the path from a fresh clone to a running project and a first green gate. The discern commands are the same on every stack; the stack-specific steps for discern itself (one self-contained Deno binary — installer and TypeScript engine in one) are below. This repo self-hosts from source: the discern verbs run as `discern <verb>` — the same command an end user runs, except here the local-dev wrapper (`scripts/discern`) points it at the current checkout's own engine.

## The discern loop

These work the same regardless of language or framework (shown here as `discern <verb>`):

- **`discern start`** sets up an isolated checkout for a change (see the worktree note in the project guidance).
- **`discern prepare`** is the fast inner loop — applies the fix-stage work, then the check-stage work; no build, no tests.
- **`discern done`** is the full gate — (in a worktree) a fail-fast merge check first, then fixers and build, then checks and tests in parallel, then any scope `gate`s whose scope changed. Run it before declaring a change done.
- **`discern doctor`** verifies the install is sound (hooks present, every configured job resolvable, git worktree support, required tools on PATH).

## Setting up

**Prerequisites.**

- **[Deno](https://deno.com)** — the only build-time dependency. It runs the installer and engine from `src/` and compiles the release binaries. Managed worktrees run `deno install --frozen` through `[repository].ensure`. Acceptance runs it again in the main checkout before smoke. From a fresh clone, Deno fetches the locked dependencies on the first command, so you don't need a separate install step.
- **`git`** — the engine's one hard runtime dependency (worktrees, the merge check, scope classification all shell out to it).

**Run the tool from source.** Install the dev wrapper once with `deno task install-dev-cli`. It puts a `discern` on your `PATH` that runs the engine of whichever checkout you're in, so a worktree runs its own in-progress engine and mirrors what an end user runs. Outside any checkout (driving discern against another project, or from a GUI-launched agent's hooks that carry no shell env), it falls back to the main checkout baked into the wrapper at install time, which `$DISCERN_HOME` overrides when set. Then drive everything with `discern <verb>`. Avoid the `dist/` binaries while developing because they bundle a frozen `templates/` snapshot. With no wrapper, `deno task dev <verb>` runs the same thing from the clone. Omit `--` before the subcommand; including it makes the parser print help.

```sh
deno task install-dev-cli         # put `discern` on your PATH (once)
discern --help                    # the command surface (installer + engine verbs)
discern setup                      # scaffold into the current dir (try a scratch dir)
deno task build                   # compile per-platform binaries → dist/ (release only)
```

**Test the real compiled binary, briefly.** Occasionally you need the shipped artifact on your `PATH` instead of the source shim — an opaque binary with no trace of this checkout (say, to rule the shim out as the cause of a client-side quirk). `deno task use-compiled-build` builds the host binary, swaps it in, then holds it there only while the command runs; press Ctrl+C and it restores the dev shim automatically, so the unusual state can't outlive the terminal that reminds you of it. (Killed with `-9`? Restore by hand with `install-dev-cli`.)

discern has no long-running app to start — it is one CLI binary with the engine compiled in. To _see it work_, either scaffold it into a temp directory with `discern setup` and drive `discern` there, or run the gate in this repo.

**Your first green gate.** From the repo root:

```sh
discern done     # or: deno task gate
```

That runs `deno fmt` (fix), then `deno task codegen` and `deno task site:build` (build), then `deno lint`, `deno check`, and the prose check in parallel with `deno task test` and the `deno task dev --version` smoke test. The release binary build remains outside the gate; the build stage regenerates the checked-in schemas, types, reference pages, glossary, and feature canon and produces the ignored site output the site tests read. A clean checkout should pass; if it does not, `discern doctor` and the [gate gotchas](done-gate-gotchas.md) explain what to fix.

**Working in this repo.** discern self-hosts the worktree workflow ([ADR 0011](../_adr/0011-adopt-worktree-workflow.md), as amended by [ADR 0019](../_adr/0019-single-binary-ts-engine.md)): the `.claude/settings.json` hooks provision an isolated worktree per session and tear it down afterward (here they call `discern worktree ensure`/`create`/`remove`), and `discern accept` accepts a finished branch back into the main checkout. Editing rules for project-owned, shared, and generated files live in [code-conventions.md](code-conventions.md); IDE color/exclude setup is in [for-humans.md](for-humans.md).
