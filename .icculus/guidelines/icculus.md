# Working in the icculus repo

icculus is a portable, stack-neutral **agentic-development harness**: one command scaffolds a quality gate, an isolated git-worktree workflow, an author-once→compile-everywhere agent-instruction pipeline, and a docs/ADR discipline into any project. **This repo is both the tool and a user of it — it installs and runs on its own harness.**

## The two halves
- **`src/`** — the Deno/TypeScript installer (`init`, `upgrade`, `doctor`, `migrate`, `config`, `add-adapter`). Compiled to `dist/` via `deno task build`.
- **`templates/`** — the POSIX-shell harness installed into a project. **`templates/` is the source of truth** for everything an install receives.

## ⚠️ The golden rule
Installed files are one of two kinds:
- **Managed (generated)** — `agent`, `.icculus/engine/**`, `.icculus/skills/**`. Copied from `templates/`; the `selfcheck` gate keeps them identical to `templates/`. **Never hand-edit these** — edit the source under `templates/` and run `deno task selfsync`. A direct edit won't ship to users and will be flagged as drift (overwritten as `<file>.new` on the next sync).
- **Seed (yours)** — `.icculus/guidelines/icculus.md`, `.icculus/config.toml`, `docs/**`, `TODO.md`, etc. Written by `init` or `/bootstrap`, then yours. `selfsync`/`upgrade` never touch them; `selfcheck` never flags them. Edit them **in place**. They are **not** in `templates/`, so they are never distributed to other projects.

**Agent guidance is a seed.** Customise it by editing this file (`.icculus/guidelines/icculus.md`) — never `templates/`, which only holds the generic stub other projects receive. Then run `./agent guidelines` to recompile `CLAUDE.md`/`AGENTS.md` (the compiled *outputs* — never hand-edit those). Nothing overwrites your `.icculus/guidelines/icculus.md`.

| To change… | Edit… | Then run |
| --- | --- | --- |
| the gate / a recipe / the dispatcher (managed) | `templates/.icculus/engine/…` or `templates/agent` | `deno task selfsync` |
| a shipped skill (managed) | `templates/.icculus/skills/…` | `deno task selfsync` |
| this guidance (seed) | `.icculus/guidelines/icculus.md` | `./agent guidelines` |
| project config (seed) | `.icculus/config.toml`, `deno.json` | — |

## Keep the shipped surface generic
`templates/` is the **distribution surface**: every project receives it verbatim, in every language and domain. Its content must therefore stay domain-neutral — examples, placeholders, and prose use generic stand-ins ("the project", "a tool that does X"), never the vocabulary of one domain. The trap is subtle: you're usually reasoning about a *specific* repo at the same time (the one icculus is installed into, or one you're testing against), and its domain bleeds into a generic skill or doc. Before editing under `templates/`, check that every example reads correctly for any project in any field — if a word only fits one domain, it doesn't belong there. And don't "fix" a leak by banning domain words in the gate: a denylist just relocates the same vocabulary into tracked test history — this rule, applied while editing, is the safeguard.

## The gate
- `./agent finish` — full gate (run from the repo root): `deno fmt` (fix) → `deno lint` + `deno check src/main.ts` + `deno task selfcheck` (check) ∥ `deno task test` (test).
- `./agent tidy` — fast inner loop: fix + check, no tests.
- `deno task selfcheck` — fails if the root install drifted from `templates/` (≡ `icculus upgrade --check`). A failure means you edited an installed copy, or changed `templates/` without `deno task selfsync`.
- `deno task selfsync` — propagate `templates/` → the root install (≡ `icculus upgrade`).

## Running icculus from source
Always `deno task dev <cmd>` (or `deno run -A src/main.ts <cmd>`). Note: do **not** insert `--` before the subcommand (`deno task dev -- upgrade` makes the CLI parser see `--` and print help). **Never** use the `dist/` binaries while developing — they bundle a frozen `templates/` snapshot.

## Testing
`deno task test` is the authority on correctness, engine included: `tests/engine_*` scaffold the real `templates/` into temp dirs and run `agent`. So a `templates/` engine change is validated regardless of whether the install is synced. If a bad engine change ever breaks `./agent finish` itself, run `deno task test` directly or `git checkout .icculus/engine`. Add engine coverage to `tests/engine_*_test.ts`; installer coverage to the other `tests/*_test.ts`.

## Generated files — never hand-edit
`CLAUDE.md` (gitignored) and `AGENTS.md` (tracked) are compiled from `.icculus/guidelines/*.md` by `./agent guidelines`. Edit `.icculus/guidelines/icculus.md` and recompile. The repo drives multiple agents from one source (`claude_code`, `codex`), so guidance stays provider-agnostic.

## Decisions
Architecture decisions live in `docs/_adr/` (0001+). Add one for any notable change.
