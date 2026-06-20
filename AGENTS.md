# Working in the icculus repo

icculus is a portable, stack-neutral **agentic-development harness**: one command scaffolds a quality gate, an isolated git-worktree workflow, an author-once→compile-everywhere agent-instruction pipeline, and a docs/ADR discipline into any project. **This repo is both the tool and a user of it — it runs on its own harness.**

## What's in the repo
icculus is **one self-contained Deno binary** — there is no separate shell engine, no `agent` dispatcher, no committed/managed copies.
- **`src/`** — the whole binary. Installer verbs (`init`, `upgrade`, `doctor`, `migrate`, `config`, `add-preset`) **and** the TypeScript engine: `src/engine/**` (the gate, the parallel/serial job runner, scope classification, ratchets, the worktree lifecycle + identity, the guideline compiler, the dispatcher), sharing `src/shared/**` (config reader, capability constants, POSIX `cksum`, root discovery). Compiled to a single binary via `deno task build`.
- **`templates/`** — the **seed files and bundled skills** the binary lays down or materializes into a project: the config template, the guidelines stub, the brief, the recipes README, the settings template, the gitignore fragment, and `.icculus/skills/**`. This is the **distribution surface** — what every install receives. It is *not* an engine; there is no installed shell harness.

## ⚠️ Edit in place — there is no managed copy to sync
The old two-program era kept a committed shell engine byte-identical to `templates/` via a manifest, `.new` files, and a `selfcheck`/`selfsync` gate. **All of that is gone.** The rules now:
- **The engine and installer are TypeScript under `src/**` — edit them in place.** There is no second copy, no hash tracking, no drift to detect. The gate (`deno task dev finish`) type-checks and tests them.
- **`templates/**` is the distribution surface** — edit the seed/skill *source* here (keep it generic; see below). To reflect a skill edit in this repo's own gitignored `.icculus/skills/`, re-materialize with `deno task dev upgrade`.
- **`CLAUDE.md` / `AGENTS.md` are generated** from `.icculus/guidelines/*.md` — never hand-edit them. Edit `.icculus/guidelines/icculus.md` and recompile.
- **`.icculus/skills/` and `.claude/skills/` are materialized artifacts (gitignored)** — the binary republishes them. Don't hand-edit; edit the source under `templates/.icculus/skills/`.

**Agent guidance is yours.** Customise it by editing `.icculus/guidelines/icculus.md` — never `templates/`, which only holds the generic stub other projects receive. Then run `deno task dev guidelines` to recompile `CLAUDE.md`/`AGENTS.md` (the compiled *outputs* — never hand-edit those). Nothing overwrites your `.icculus/guidelines/icculus.md`.

| To change… | Edit… | Then run |
| --- | --- | --- |
| the gate / the engine / the dispatcher / a verb | `src/engine/**`, `src/main.ts` (in place) | `deno task dev finish` |
| an installer command | `src/commands/**` (in place) | `deno task dev finish` |
| a shipped skill | `templates/.icculus/skills/…` | `deno task dev upgrade` (re-materialize) |
| a seed file users receive | `templates/…` | — |
| this guidance (yours) | `.icculus/guidelines/icculus.md` | `deno task dev guidelines` |
| project config (yours) | `.icculus/config.toml`, `deno.json` | — |

## Keep the shipped surface generic
`templates/` (the seed files **and** the bundled skills) is the **distribution surface**: every project receives it verbatim, in every language and domain. Its content — and any user-facing engine output (help text, messages) — must therefore stay domain-neutral: examples, placeholders, and prose use generic stand-ins ("the project", "a tool that does X"), never the vocabulary of one domain. The trap is subtle: you're usually reasoning about a *specific* repo at the same time (the one icculus is installed into, or one you're testing against), and its domain bleeds into a generic skill or doc. Before editing under `templates/`, check that every example reads correctly for any project in any field — if a word only fits one domain, it doesn't belong there. And don't "fix" a leak by banning domain words in the gate: a denylist just relocates the same vocabulary into tracked test history — this rule, applied while editing, is the safeguard.

## The gate
- `deno task dev finish` — full gate (run from the repo root): `deno fmt` (fix) → `deno lint` + `deno check src/main.ts` (check) ∥ `deno task test` (test). This is the repo running its **own** TS engine (`deno.json`'s `gate` task), so a regression in the engine surfaces here.
- `deno task dev tidy` — fast inner loop: fix + check, no tests.
- There is no `selfcheck`/`selfsync`: with no committed engine copy there is nothing to drift. CI runs `deno task dev finish` plus a trailing `git diff --exit-code` (so the auto-fixing fix stage stays a hard check, and a stale generated `CLAUDE.md`/`AGENTS.md` fails).

## Running icculus from source
Always `deno task dev <cmd>` (or `deno run -A src/main.ts <cmd>`). Note: do **not** insert `--` before the subcommand (`deno task dev -- upgrade` makes the CLI parser see `--` and print help). **Never** use the `dist/` binaries while developing — they bundle a frozen snapshot of `templates/` and the engine compiled at build time.

## Testing
`deno task test` is the authority on correctness, engine included: the `tests/engine_*` suite scaffolds the seed surface into temp dirs and drives the TS engine via `deno task dev <verb>` (with an `icculus` PATH shim so recipes and hooks resolve the binary like a real install). It is the behavioral parity oracle for the engine. If a bad engine change ever breaks `deno task dev finish` itself, run `deno task test` directly. Add engine coverage to `tests/engine_*_test.ts`; installer coverage to the other `tests/*_test.ts`.

## Generated files — never hand-edit
`CLAUDE.md` (gitignored) and `AGENTS.md` (tracked) are compiled from `.icculus/guidelines/*.md` by `deno task dev guidelines`. Edit `.icculus/guidelines/icculus.md` and recompile. The repo drives multiple agents from one source (`claude_code`, `codex`), so guidance stays provider-agnostic.

## Decisions
Architecture decisions live in `docs/_adr/` (0001+). Add one for any notable change. The single-binary cutover is [ADR 0019](docs/_adr/0019-single-binary-ts-engine.md).

