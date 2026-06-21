# Working in the discern repo

discern is a portable, stack-neutral **agentic-development harness**: one command scaffolds a quality gate, an isolated git-worktree workflow, an author-once→compile-everywhere agent-instruction pipeline, and a docs/ADR discipline into any project. **This repo is both the tool and a user of it — it runs on its own harness.**

## What's in the repo
discern is **one self-contained Deno binary** — there is no separate shell engine, no `agent` dispatcher, no committed/managed copies.
- **`src/`** — the whole binary. Installer verbs (`init`, `upgrade`, `doctor`, `migrate`, `config`, `add-preset`) **and** the TypeScript engine: `src/engine/**` (the gate, the parallel/serial job runner, scope classification, ratchets, the worktree lifecycle + identity, the guideline compiler, the dispatcher), sharing `src/shared/**` (config reader, capability constants, feature toggles, POSIX `cksum`, root discovery). Compiled to a single binary via `deno task build`.
- **`templates/`** — the **distribution surface** the binary lays down or materializes into a project: the config template (`discern.toml.tmpl`), the settings template, the gitignore fragment, the **bundled built-in guidance** (`templates/guidance/*.md`), and the **bundled skills** (`templates/skills/**`). It is *not* an engine; there is no installed shell harness.

## The footprint: one root `discern.toml`
A project's entire discern footprint is a single root file, **`discern.toml`** (ADR 0020 dissolved the old hidden `.discern/` directory). Everything else is bundled in the binary, a **config-pointed** location the user chooses (with discoverable defaults — `guidance.md`, `./skills`, `./recipes`), or a generated **output** (`AGENTS.md` tracked; `CLAUDE.md`/`GEMINI.md` gitignored; `.claude/skills/` materialized). `[features]` toggles whole subsystems on/off — do not confuse it with `[capabilities]` (the gate's command table).

## ⚠️ Edit in place — there is no managed copy to sync
The old two-program era kept a committed shell engine byte-identical to `templates/` via a manifest, `.new` files, and a `selfcheck`/`selfsync` gate. **All of that is gone.** The rules now:
- **The engine and installer are TypeScript under `src/**` — edit them in place.** There is no second copy, no hash tracking, no drift to detect. The gate (`deno task dev finish`) type-checks and tests them.
- **`templates/**` is the distribution surface** — edit the seed/skill/guidance *source* here (keep it generic; see below). To reflect a bundled-skill or built-in-guidance edit in this repo's own `.claude/skills/` and `AGENTS.md`, re-run `deno task dev refresh` (or `upgrade`).
- **`CLAUDE.md` / `AGENTS.md` are generated** from discern's built-in guidance (`templates/guidance/*`) plus this repo's `guidance.md` — never hand-edit them. Edit `guidance.md` and recompile.
- **`.claude/skills/` is a materialized artifact (gitignored)** — the binary republishes it from `templates/skills/**`. Don't hand-edit; edit the source under `templates/skills/`.

**Agent guidance is yours.** Customise it by editing `guidance.md` (this file) — never `templates/`, which only holds the generic built-in guidance other projects receive. Then run `deno task dev refresh` to recompile `CLAUDE.md`/`AGENTS.md` (the compiled *outputs* — never hand-edit those). Nothing overwrites your `guidance.md`.

| To change… | Edit… | Then run |
| --- | --- | --- |
| the gate / the engine / the dispatcher / a verb | `src/engine/**`, `src/main.ts` (in place) | `deno task dev finish` |
| an installer command | `src/commands/**` (in place) | `deno task dev finish` |
| a bundled skill | `templates/skills/…` | `deno task dev refresh` (re-materialize) |
| the built-in harness guidance | `templates/guidance/*.md` | `deno task dev refresh` |
| a seed file users receive | `templates/…` | — |
| this guidance (yours) | `guidance.md` | `deno task dev refresh` |
| project config (yours) | `discern.toml`, `deno.json` | — |

## Keep the shipped surface generic
`templates/` (the seed files, the bundled skills, **and** the built-in guidance) is the **distribution surface**: every project receives it verbatim, in every language and domain. Its content — and any user-facing engine output (help text, messages) — must therefore stay domain-neutral: examples, placeholders, and prose use generic stand-ins ("the project", "a tool that does X"), never the vocabulary of one domain. The trap is subtle: you're usually reasoning about a *specific* repo at the same time (the one discern is installed into, or one you're testing against), and its domain bleeds into a generic skill or doc. Before editing under `templates/`, check that every example reads correctly for any project in any field — if a word only fits one domain, it doesn't belong there. And don't "fix" a leak by banning domain words in the gate: a denylist just relocates the same vocabulary into tracked test history — this rule, applied while editing, is the safeguard.

## The gate
- `deno task dev finish` — full gate (run from the repo root): `deno fmt` (fix) → `deno lint` + `deno check src/main.ts` (check) ∥ `deno task test` (test). This is the repo running its **own** TS engine (`deno.json`'s `gate` task), so a regression in the engine surfaces here.
- `deno task dev prepare` — fast inner loop: fix + check, no tests.
- There is no `selfcheck`/`selfsync`: with no committed engine copy there is nothing to drift. CI runs `deno task dev finish` plus a trailing `git diff --exit-code` (so the auto-fixing fix stage stays a hard check, and a stale generated `AGENTS.md` fails).

## Running discern from source
Always `deno task dev <cmd>` (or `deno run -A src/main.ts <cmd>`). Note: do **not** insert `--` before the subcommand (`deno task dev -- upgrade` makes the CLI parser see `--` and print help). **Never** use the `dist/` binaries while developing — they bundle a frozen snapshot of `templates/` and the engine compiled at build time.

## Testing
`deno task test` is the authority on correctness, engine included: the `tests/engine_*` suite scaffolds the seed surface into temp dirs and drives the TS engine via `deno task dev <verb>` (with a `discern` PATH shim so recipes and hooks resolve the binary like a real install). It is the behavioral parity oracle for the engine. If a bad engine change ever breaks `deno task dev finish` itself, run `deno task test` directly. Add engine coverage to `tests/engine_*_test.ts`; installer coverage to the other `tests/*_test.ts`.

## Generated files — never hand-edit
`CLAUDE.md` (gitignored) and `AGENTS.md` (tracked) are compiled from discern's built-in guidance plus `guidance.md` by `deno task dev refresh`. Edit `guidance.md` and recompile. The repo drives multiple agents from one source (`claude_code`, `codex`), so guidance stays provider-agnostic.

## Decisions
Architecture decisions live in `docs/_adr/` (0001+). Add one for any notable change. The dissolution of `.discern/` into a single root `discern.toml` is [ADR 0020](docs/_adr/0020-dissolve-discern-dir.md); the single-binary cutover is [ADR 0019](docs/_adr/0019-single-binary-ts-engine.md).
