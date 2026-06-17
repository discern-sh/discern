# Working in the icculus repo

icculus is a portable, stack-neutral **agentic-development harness**: one command scaffolds a quality gate, an isolated git-worktree workflow, an author-once→compile-everywhere agent-instruction pipeline, and a docs/ADR discipline into any project. **This repo is both the tool and a user of it — it dogfoods its own harness.**

## The two halves
- **`src/`** — the Deno/TypeScript installer (`init`, `upgrade`, `doctor`, `migrate`, `config`, `add-adapter`). Compiled to `dist/` via `deno task build`.
- **`templates/`** — the POSIX-shell harness installed into a project. **`templates/` is the source of truth** for everything an install receives.

## ⚠️ The golden rule
Root files are one of two kinds:
- **Managed (generated)** — `bin/agent`, `.icculus/engine/**`, `.ai/skills/**`. Copied from `templates/`; the `selfcheck` gate keeps them identical to `templates/`. **Never hand-edit these** — edit the source under `templates/` and run `deno task selfsync`. A direct edit won't ship to users and will be flagged as drift (overwritten as `<file>.new` on the next sync).
- **Seed (yours)** — `.ai/guidelines/icculus.md`, `icculus.toml`, `docs/**`, `TODO.md`, etc. Written once by `init`, then yours. `selfsync`/`upgrade` never touch them; `selfcheck` never flags them. Edit them **directly at the root**. They are **not** in `templates/`, so they are never distributed to other projects.

**Agent guidance is a seed.** Customise it by editing this file (`.ai/guidelines/icculus.md`) — never `templates/`, which only holds the generic stub other projects receive. Then run `./bin/agent guidelines` to recompile `CLAUDE.md`/`AGENTS.md` (the compiled *outputs* — never hand-edit those). Nothing overwrites your `.ai/guidelines/icculus.md`.

| To change… | Edit… | Then run |
| --- | --- | --- |
| the gate / a recipe / the dispatcher (managed) | `templates/.icculus/engine/…` or `templates/bin/agent` | `deno task selfsync` |
| a shipped skill (managed) | `templates/.ai/skills/…` | `deno task selfsync` |
| this guidance (seed) | `.ai/guidelines/icculus.md` | `./bin/agent guidelines` |
| project config (seed) | `icculus.toml`, `deno.json` | — |

## The gate
- `./bin/agent finish` — full gate (run from the repo root): `deno fmt` (fix) → `deno lint` + `deno check src/main.ts` + `deno task selfcheck` (check) ∥ `deno task test` (test).
- `./bin/agent tidy` — fast inner loop: fix + check, no tests.
- `deno task selfcheck` — fails if the root install drifted from `templates/` (≡ `icculus upgrade --check`). A failure means you edited an installed copy, or changed `templates/` without `deno task selfsync`.
- `deno task selfsync` — propagate `templates/` → the root install (≡ `icculus upgrade`).

## Running icculus from source
Always `deno task dev <cmd>` (or `deno run -A src/main.ts <cmd>`). Note: do **not** insert `--` before the subcommand (`deno task dev -- upgrade` makes the CLI parser see `--` and print help). **Never** use the `dist/` binaries while developing — they bundle a frozen `templates/` snapshot.

## Testing
`deno task test` is the authority on correctness, engine included: `tests/engine_*` scaffold the real `templates/` into temp dirs and run `bin/agent`. So a `templates/` engine change is validated regardless of whether the install is synced. If a bad engine change ever breaks `./bin/agent finish` itself, run `deno task test` directly or `git checkout .icculus/engine`. Add engine coverage to `tests/engine_*_test.ts`; installer coverage to the other `tests/*_test.ts`.

## Generated files — never hand-edit
`CLAUDE.md` (gitignored) and `AGENTS.md` (tracked) are compiled from `.ai/guidelines/*.md` by `./bin/agent guidelines`. Edit `.ai/guidelines/icculus.md` and recompile. The repo drives multiple agents from one source (`claude_code`, `codex`), so guidance stays provider-agnostic.

## Decisions
Architecture decisions live in `docs/_adr/` (0001+). Add one for any notable change.

