# ADR 0019: Collapse into one binary with a TypeScript-native engine

> **Amendments.**
>
> - **Vocabulary ([ADR 0120](0120-launch-verb-canon.md), [ADR 0168](0168-the-gate-declares-jobs.md)):** current pointers use `standards` (formerly `ratchets`), `done` (formerly `finish`), `impact` where `scopes` names the verb, and `[jobs]` / `[jobs.<name>]` (formerly `[capabilities]` / `[checks.<name>]`); the retired product-category wording reads as `discern`, the gate, or the bar; the decisions below are unchanged.
> - **[ADR 0137](0137-project-scripts-live-under-the-script-command.md) — Project Scripts:** the language-agnostic executable contract stands, but current files are Project Scripts under `[scripts].dir` and run through `discern script`; the root fall-through and engine-wins collision rule described below are superseded.

**Status**: accepted

## Context

discern was **two programs**. The installer (`src/`) was Deno/TypeScript, compiled to a self-contained binary. The engine — the gate, the worktree lifecycle, standards, scope classification, the guideline compiler, the `agent` dispatcher — was **POSIX shell**, committed into each project under `.discern/engine/` as **managed** files the installer kept byte-identical to `templates/`.

That split bought portability (an installed discern project needed no runtime) but charged three rents:

1. **DX confusion.** `agent` is a repo-local file, not on `PATH`; `.discern/` files invisibly drive it; two command vocabularies (`discern` vs `agent`, `deno task selfsync` vs `discern upgrade`) for one tool.
2. **Self-imposed overhead.** A large slice of the installer existed _only_ to ship-and-sync the committed shell engine: manifest content-hashing, `.new` preservation, orphan reconciliation, `selfcheck`/`selfsync` drift detection, the [ADR 0013](_superseded/0013-product-vocabulary-in-user-output.md) vocabulary renderer, the dash/bash CI matrix, the `set -f` noglob policy ([ADR 0012](_superseded/0012-engine-noglob-default.md)), shellcheck — plus _two_ committed copies of the engine (the `templates/` source and the self-host root install) kept identical by a gate.
3. **The portable-shell tax.** Concurrency, fail-fast cancellation, signal handling, and TOML parsing are all painful in portable `sh`. A meaningful fraction of the ADRs (0002, 0004, 0006, 0012) are shell-portability pain. And a tool that _preaches_ typechecking shipped an un-typechecked engine.

The window to change this is now: only a couple of internal installs exist, the same window [ADR 0016](_superseded/0016-consolidate-install-surface.md)/0017/0018 leaned on.

## Decision

Collapse the two halves into **one self-contained Deno binary with a TS-native engine compiled in**. Delete the shell engine; rebuild it as TypeScript modules; delete the committed-engine sync machinery with it.

1. **The engine is TypeScript** (`src/engine/**`), sharing `src/shared/**` with the installer. The gate, `jobsInStage`/`cmdsInStage`, the parallel/serial job runner, scope-glob classification, standards, the worktree lifecycle + identity (POSIX-`cksum`-faithful), the guideline compiler, and the dispatcher are all TS. The `--json` gate contract ([ADR 0004](_superseded/0004-structured-finish-json.md)) is reproduced byte-for-shape. The concurrency core uses Deno's process-group tree-kill (`detached` + `Deno.kill(-pid)`) for fail-fast cancellation — genuinely _better_ than portable `sh`'s best-effort sibling kill, not just different.

2. **`discern` is the one command; `agent` is dropped.** The former engine recipes are first-class `discern` subcommands (`done`, `tidy`, `test`, `standards`, `guidelines`, the `worktree` command group, `identity`, `impact`). The root `agent` file is no longer scaffolded; worktree hooks, docs, and compiled guidance repoint to `discern`.

3. **"Managed files" retire.** With no committed engine to sync, there is no `manifest.json`, no content hashes, no `.new` preservation, no orphan reconciliation, no drift detection. `setup` lays down only _your_ seed files (config, guidelines stub, brief, recipes README, merged settings, gitignore). **Skills become materialized artifacts**: bundled in the binary, copied to `.discern/skills/` by `setup` (always overwritten — they are the binary's), **gitignored**, then symlinked into `.claude/skills/`. The ownership model is now two buckets: _yours_ (committed seeds, write-once) and _the binary's_ (gitignored, re-published artifacts — skills, compiled `CLAUDE.md`/`AGENTS.md`; the engine is the limit case, not even on disk).

4. **Project recipes stay language-agnostic executables.** The binary discovers `.discern/recipes/*` and execs the match with `DISCERN_*` exported. Recipes no longer source a shell library; they read config through a new `discern config get|array|has|subsections|keys` surface. The engine still wins on a name collision (warn on shadow).

5. **Names unchanged.** `discern`, `.discern/`, the `@db@`/`@project_slug@` worktree tokens, and the `[capabilities]`/`[checks]`/`[scopes]`/`[standards]` config shape all survive this cutover. Renaming discern was left to a separate, later change — since carried out (see [ADR 0022](0022-rename-to-discern.md)).

The explicit **no**s: no committed shell engine; no `agent` dispatcher; no managed-file machinery; no `set -f`/`DISCERN_ENGINE_RECIPE` noglob marker; no dual-vocabulary renderer.

## Consequences

- **Self-host inverts (this supersedes [ADR 0010](_superseded/0010-self-host-the-harness.md)).** The repo no longer commits a second engine copy to gate for drift — there _is_ no second copy and no drift to detect. It runs its own engine via the binary (`deno task dev done`). The regression class ADR 0010's `selfcheck` guarded is made structurally impossible: there is nothing that can drift.
- **[ADR 0012](_superseded/0012-engine-noglob-default.md) (engine noglob) retires.** Glob classification is in-memory TS (`engine/scopes/glob.ts`); `set -f` and the `DISCERN_ENGINE_RECIPE` marker are gone. A project recipe is just an executable with normal shell globbing.
- **[ADR 0013](_superseded/0013-product-vocabulary-in-user-output.md) (vocabulary renderer) retires.** With no committed copy there is no `selfsync`/`selfcheck`, so the dual-audience command-name problem evaporates; `selfCmd` and its gate guard are deleted.
- **[ADR 0008](_superseded/0008-declarative-managed-set.md) is moot.** `managed.json` and the managed-set classifier are deleted.
- **[ADR 0001](_superseded/0001-project-owned-recipes.md) is amended.** Recipes read config via `discern config get`, not by sourcing the engine library; the engine-always-wins shadow rule survives.
- **The installer shrinks sharply.** `manifest.ts`, `invocation.ts`, the hash/`.new`/orphan logic in `fs_plan.ts`, the managed-sync half of `upgrade.ts`, `scripts/lint-sh.ts`, the shellcheck CI step, and the dash/bash matrix all go. `upgrade` survives, **narrowed**: run pending config-schema migrations → re-materialize the bundled skills → recompile guidelines → stamp `[meta].schema_version` (moved out of the deleted manifest). A migration prunes a pre-existing on-disk shell engine from an upgrading install.
- **Config is held to strict TOML.** The runtime reader is now `@std/toml`, stricter than the retired `toml.awk`; a malformed config throws, surfaced by `doctor` rather than read leniently. (Amends [ADR 0004](_superseded/0004-structured-finish-json.md) only in that `duration_s` stays an integer for output-compat.)
- **One binary, one PATH command.** ~60–90 MB (V8 was always baked in), startup in the low tens of ms — fine for git hooks and an all-day gate. arm64 macOS binaries are ad-hoc signed by `deno compile` on a macOS host (release CI builds the darwin targets on `macos-latest`).

## Alternatives considered

- **Keep the shell engine, just ship it inside the binary (extract-and-run).** Rejected: it keeps the portable-shell tax (concurrency, signals, TOML parsing) and an un-typechecked engine. The point is a _type-checked_ engine with better primitives, not a shell engine in a nicer wrapper.
- **Keep `agent` as a thin shim that forwards to the binary.** Rejected: two command names is exactly the DX confusion the cutover removes. The recipes are first-class `discern` verbs now.
- **Keep managed-file sync for skills (commit them, hash-track them).** Rejected: skills are the binary's, identical for every install — materializing them (gitignored, re-published on `upgrade`) is simpler than a hash-tracked, `.new`-on-edit committed copy, and removes the last consumer of the managed machinery.
