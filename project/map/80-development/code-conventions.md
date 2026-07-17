# Code conventions

_The rules the tooling enforces, and the conventions to follow when writing code here._

This doc is the detailed companion to the **Conventions** section of the project guidance (`project/guidance.md`). The guidance holds the short, agent-facing form; this doc holds the full reasoning. Keep the two in step, and keep both aligned with what the `[capabilities]` and `[checks]` in `discern.toml` actually enforce — the written rule and the enforced rule must never disagree.

## What the gate enforces

The capability and check tables in [`discern.toml`](../../../discern.toml) are the mechanical rules. `format`, `build`, `lint`, `typecheck`, `test`, and `smoke` are known **Capabilities** (the engine derives their Stage from the name); `prose` is a custom check. Run `discern prepare` for the fix and check stages, or `discern done` for the complete set.

Every configured gate command executes from the resolved project root. This is true when the CLI is invoked from a nested directory and when a long-lived MCP server targets a worktree other than its own process directory; formatter, check, test, and scope selection must all describe the same checkout.

| Name        | Kind       | Stage | Command                  | What it checks / how to satisfy                                                                                                                                                                                |
| ----------- | ---------- | ----- | ------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `format`    | capability | fix   | `deno fmt`               | Formats the authored TypeScript, JSON, and Markdown tree. The generated references, schemas, compiled agent files, distribution output, and fixtures listed in `deno.json` are excluded. It rewrites in place. |
| `build`     | capability | build | `deno task codegen`      | Regenerates the CLI/config references, result/config schemas, and TypeScript declaration files from their registries. Commit the generated changes with the source change.                                     |
| `lint`      | capability | check | `deno lint`              | Runs the repo's strict Deno lint rules across the authored source set, minus the explicit exclusions in `deno.json`. Fix the finding, or add a reasoned inline suppression.                                    |
| `typecheck` | capability | check | `deno check`             | Type-checks the configured TypeScript graph under strict `deno.json` compiler options. Keep types sound; no `any` slipped through a cast.                                                                      |
| `prose`     | check      | check | `scripts/prose_check.ts` | Runs Vale over the configured map after blanking frontmatter and excluding the private tree. Fix error-severity findings; review warnings with the page-level prose script.                                    |

There is no `selfcheck` or `shellcheck` check: with the engine compiled into the binary there is no second copy to drift and no portable shell to lint ([ADR 0019](../_adr/0019-single-binary-ts-engine.md)). The gate's `build` capability is code generation; the release-only `deno task build` remains outside the gate. The `test` and `smoke` capabilities are covered in [testing.md](testing.md).

## Conventions to follow

The conventions the tooling cannot fully enforce, but the project still holds:

- **The golden rule — yours, co-managed, or generated.** _Yours_ are the committed authored files (`project/map/**`, `project/guidance.md`, authored skills under `project/skills/`, project scripts under `project/scripts/`, and `project/TODO.md`) — edit them in place. Co-managed files include `discern.toml`, provider settings, and discern's `.gitignore` block. Generated outputs include the ignored `.claude/skills/**` and `.agents/skills/**`, plus the compiled agent files `AGENTS.md`/`CLAUDE.md`/`GEMINI.md`, which are committed but never hand-edited ([ADR 0019](../_adr/0019-single-binary-ts-engine.md), [ADR 0128](../_adr/0128-enumerated-ownership-tracked-guidance.md)). The engine, built-in skills, and built-in guidance are bundled in the binary — never on disk in an install. Change the engine, a built-in skill, or built-in guidance by editing the source here and re-running the producing command; don't expect to find a committed copy to sync. See [install-surface.md](install-surface.md) for the full disposition map.
- **Never hand-edit the compiled agent files.** `AGENTS.md`, `CLAUDE.md`, and `GEMINI.md` are compiled from discern's built-in guidance plus your `[guidance].sources` by `discern refresh` and committed ([ADR 0034](../_adr/0034-agents-md-untracked-currency-check.md), [ADR 0128](../_adr/0128-enumerated-ownership-tracked-guidance.md)); edit the guidance source and recompile. They carry no banner — `discern done` fails if one drifts from its source, so a stale or hand-edited file is caught, not silently overwritten.
- **Run from source, never `dist/`.** `discern <cmd>` runs the engine of whichever checkout you are in (`deno task dev <cmd>` is the zero-setup equivalent); the `dist/` binaries bundle a frozen `templates/` snapshot. Don't put `--` before a subcommand.
- **TypeScript module shape.** Every module opens with a JSDoc block stating its role (see any file under `src/`). [`main.ts`](../../../src/main.ts) is routing only; command logic lives in `src/commands/`, the engine in `src/engine/`, shared installer/engine helpers in `src/shared/`, and installer-only helpers in `src/lib/`. Keep modules small and single-purpose.
- **Strict TypeScript, repo-wide.** The whole repo is held to strict TS via `deno.json` `compilerOptions` plus a strict lint rule set; the engine is type-checked like the rest, not an exception. Keep types sound.
- **Keep the repo's own task vocabulary out of what ships.** `discern` is both a product and a self-hosting repo, so two command vocabularies coexist: the user's (`discern …`) and the repo's `deno task <task>` aliases. The latter must never reach a user — not in shipped `templates/` (received verbatim by every project) nor in user-facing output the binary prints. A guard test ([tests/dev_vocab_guard_test.ts](../../../tests/dev_vocab_guard_test.ts)) fails the gate if it leaks.
- **Docs say what _is_.** Present tense, no modal verbs about the system, the canonical nouns from the [glossary](../00-orientation/glossary.md), ASCII-first diagrams. Outstanding work goes in [`project/TODO.md`](../../TODO.md), not the docs.
- **Record decisions.** A notable change gets an ADR in [`project/map/_adr/`](../_adr/); overriding a [design principle](../00-orientation/design-principles.md) _requires_ one.

For test-specific conventions, see [testing.md](testing.md).
