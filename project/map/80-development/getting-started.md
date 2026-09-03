---
aliases:
  - contributor setup
  - local development
  - build discern
  - development setup
---

# Getting started

_Cloning, setting up, and running the project locally for the first time._

This page takes a fresh clone to a running project and a first green run of the project's final quality check (the Gate). The discern commands are the same on every stack. The repository-specific steps below build discern's self-contained Deno binary, which includes the installer and TypeScript Engine. This repository runs `discern <verb>` from source through the local-development wrapper at `scripts/discern`, which selects the current checkout's Engine.

## The discern loop

These work the same regardless of language or framework (shown here as `discern <verb>`):

- **`discern start`** sets up an isolated workspace for one task (a Git worktree). See the worktree rule in the project instructions.
- **`discern prepare`** runs the fast inner loop: fix-stage work, declared regenerations, complete refresh convergence, then check-stage work. Other build jobs and tests stay out.
- **`discern done`** runs the full Gate. In a worktree, it starts with the fail-fast merge check, then runs fixers and build work, checks and tests in parallel, and any Gate declared by a changed scope. Run it on the intended final commit.
- **`discern doctor`** reports whether hooks, configured job commands, Git worktree support, and required tools on `PATH` are ready.

## Setting up

**Prerequisites.**

- **[Deno](https://deno.com)** is the only build-time dependency. It runs the installer and Engine from `src/` and compiles the release binaries. Managed worktrees run `deno install --frozen` through `[repository].ensure`, acceptance runs it again in the main checkout before smoke, and hosted Gate lanes run it before the Gate starts parallel jobs. An interactive command can fetch dependencies lazily in a fresh clone; automation should converge the locked graph explicitly first.
- **Git** is the Engine's only required runtime tool. Worktrees, the merge check, and scope classification run it as a subprocess.

**Run the tool from source.** Install the development wrapper once with `deno task install-dev-cli`. It puts `discern` on `PATH` and runs the Engine of the current checkout, so a worktree uses its own in-progress Engine. Outside a checkout, the wrapper falls back to the main checkout recorded at installation. This covers another project and hooks launched by a graphical user interface (GUI) without a shell environment. Set `DISCERN_HOME` to override that fallback. Then use `discern <verb>` for contributor work. Avoid the `dist/` binaries while developing because they bundle a frozen `templates/` snapshot. Without the wrapper, `deno task dev <verb>` runs the same Engine from the clone. Omit `--` before the subcommand; including it makes the parser print help.

```sh
deno task install-dev-cli         # put `discern` on your PATH (once)
discern --help                    # the command surface (installer + engine verbs)
discern setup begin                # scaffold into the current dir (try a scratch dir)
deno task build                   # compile per-platform binaries to dist/ (release only)
```

**Test the compiled binary.** Use `deno task use-compiled-build` when a client needs the shipped host artifact on `PATH` without the source shim. The task builds the host binary, installs it for the command's lifetime, and restores the development shim when you press Ctrl-C. If signal 9 stops the task before restoration, run `deno task install-dev-cli`.

discern is a command-line interface (CLI) binary with the Engine compiled in. To exercise it, scaffold a temporary directory with `discern setup begin` and run `discern` there, or run the Gate in this repository.

**Your first green gate.** From the repo root:

```sh
discern done     # or: deno task gate
```

That runs `deno fmt` (fix), then `deno task codegen` and `deno task site:build` (build), then `deno lint`, `deno check`, and the prose check in parallel with `deno task test` and the `deno task dev --version` smoke test. The release binary build remains outside the Gate. The build stage regenerates the committed schemas, types, reference pages, glossary, and feature canon, and produces the ignored site output read by the site tests. If the clean checkout fails, run `discern doctor`, then follow the first diagnostic or the [Gate gotchas](done-gate-gotchas.md).

**Work in this repository.** discern uses its own worktree workflow ([ADR 0011](../_adr/0011-adopt-worktree-workflow.md), as amended by [ADR 0019](../_adr/0019-single-binary-ts-engine.md)). The `.claude/settings.json` hooks provision an isolated worktree per session and tear it down afterward by calling `discern worktree ensure`, `discern worktree hook create`, and `discern worktree hook remove`. `discern accept` lands a finished branch in the main checkout. [Code conventions](code-conventions.md) explains project-owned, shared, and generated files. [For humans](for-humans.md) covers IDE color and exclusion settings.
