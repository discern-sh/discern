# Code conventions

_The rules the tooling enforces, and the conventions to follow when writing code
here._

This doc is the detailed companion to the **Conventions** section of the project
guidelines (`.ai/guidelines/icculus.md`). The guidelines hold the short,
agent-facing form; this doc holds the full reasoning. Keep the two in step, and
keep both aligned with what the `[slots]` in `icculus.toml` actually enforce —
the written rule and the enforced rule must never disagree.

## What the gate enforces

The `fix` and `check` slots in [`icculus.toml`](../../icculus.toml) are the
mechanical rules. To satisfy all of them at once, run `agent tidy`.

| Slot         | Phase | Command                  | What it checks / how to satisfy                                                                                                                                                                                      |
| ------------ | ----- | ------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `format`     | fix   | `deno fmt`               | Formats TypeScript **and** Markdown (so `docs/` is reformatted on every gate). `templates/`, `dist/`, the generated agent files, and the seed trees are excluded in `deno.json`. Just run it — it rewrites in place. |
| `lint`       | check | `deno lint`              | The Deno linter over `src/`, `scripts/`, `tests/`. Fix the finding, or justify it with an inline `deno-lint-ignore` and a reason.                                                                                    |
| `typecheck`  | check | `deno check src/main.ts` | Type-checks the whole graph reachable from the entrypoint. Keep types sound; no `any` slipped through a cast.                                                                                                        |
| `selfcheck`  | check | `deno task selfcheck`    | The self-host invariant: the root install must stay byte-identical to `templates/`. Fails if you edited an installed managed copy, or changed `templates/` without syncing. Heal with `deno task selfsync`.          |
| `shellcheck` | check | `deno task lint:sh`      | Static-lints the POSIX shell (engine + `install.sh`). Fix the warning, or scope a `# shellcheck disable=...` with justification.                                                                                     |

The `build` slot is a no-op (`deno task build` is release-only), and the `test`
slot (`deno task test`) is covered in [testing.md](testing.md).

## Conventions to follow

The conventions the tooling cannot fully enforce, but the project still holds:

- **The golden rule — managed vs seed.** Managed files (`bin/agent`,
  `.icculus/engine/**`, `.ai/skills/**`) are copied from `templates/`; never
  hand-edit them. Edit the source under `templates/`, then `deno task selfsync`.
  A direct edit won't ship and `selfcheck` flags it as drift. Seed files
  (`icculus.toml`, `docs/**`, `.ai/guidelines/icculus.md`, `TODO.md`) are yours
  — edit them in place. See [install-surface.md](install-surface.md) for the
  full disposition map.
- **Never hand-edit generated files.** `CLAUDE.md` and `AGENTS.md` are compiled
  from `.ai/guidelines/*.md` by `agent guidelines`; edit the guidance source and
  recompile. They carry a do-not-edit banner.
- **Run from source, never `dist/`.** Use `deno task dev <cmd>`; the `dist/`
  binaries bundle a frozen `templates/` snapshot. Don't put `--` before a
  subcommand.
- **TypeScript module shape.** Every module opens with a JSDoc block stating its
  role (see any file under `src/`). [`main.ts`](../../src/main.ts) is routing
  only; command logic lives in `src/commands/`, shared helpers in `src/lib/`.
  Keep modules small and single-purpose.
- **POSIX shell, portably.** Engine scripts are `#!/usr/bin/env sh` — no
  bashisms. Portability is held by a dash/bash CI matrix and `shellcheck`.
  Engine recipes run under `noglob` (`set -f`) by policy
  ([ADR 0012](../_adr/0012-engine-noglob-default.md)).
- **User-facing output uses the product vocabulary.** Strings a user sees speak
  in product terms, not internal jargon
  ([ADR 0013](../_adr/0013-product-vocabulary-in-user-output.md)); a guard test
  enforces it.
- **Docs say what _is_.** Present tense, no modal verbs about the system, the
  canonical nouns from the [glossary](../00-orientation/glossary.md),
  ASCII-first diagrams. Outstanding work goes in [`TODO.md`](../../TODO.md), not
  the docs.
- **Record decisions.** A notable change gets an ADR in
  [`docs/_adr/`](../_adr/); overriding a
  [design principle](../00-orientation/design-principles.md) _requires_ one.

For test-specific conventions, see [testing.md](testing.md).
