# Code conventions

_The rules the tooling enforces, and the conventions to follow when writing code here._

This doc is the detailed companion to the **Conventions** section of the project guidance (`project/guidance.md`). The guidance holds the short, agent-facing form; this doc holds the full reasoning. Keep both documents aligned with `[jobs]` in `discern.toml`. The written and enforced rules must agree.

## What the gate enforces

The jobs in [`discern.toml`](../../../discern.toml) are the mechanical rules. `format`, `build`, `lint`, `typecheck`, `test`, and `smoke` are known names whose stage the engine derives; `prose` is custom and declares its stage. Run `discern prepare` for the fix and check stages, or `discern done` for the complete set.

Every configured gate command executes from the resolved project root. This is true when the CLI is invoked from a nested directory and when a long-lived MCP server targets a worktree other than its own process directory; formatter, check, test, and scope selection must all describe the same checkout.

| Name        | Kind   | Stage | Command                  | What it checks / how to satisfy                                                                                                                                                                             |
| ----------- | ------ | ----- | ------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `format`    | known  | fix   | `deno fmt`               | Formats the authored TypeScript, JSON, and Markdown tree. The generated references, schemas, agent files, distribution output, and fixtures listed in `deno.json` are excluded. It rewrites in place.       |
| `build`     | known  | build | `deno task codegen`      | Regenerates the CLI/config references, the glossary, the feature canon, result/config schemas, and TypeScript declaration files from their registries. Commit the generated changes with the source change. |
| `lint`      | known  | check | `deno lint`              | Runs the repo's strict Deno lint rules across the authored source set, minus the explicit exclusions in `deno.json`. Fix the finding, or add a reasoned inline suppression.                                 |
| `typecheck` | known  | check | `deno check`             | Type-checks the configured TypeScript graph under strict `deno.json` compiler options. Keep types sound; no `any` slipped through a cast.                                                                   |
| `prose`     | custom | check | `scripts/prose_check.ts` | Runs Vale over the configured map after blanking frontmatter and excluding the private tree. Fix error-severity findings; review warnings with the page-level prose script.                                 |

There are no `selfcheck` or `shellcheck` jobs: with the engine compiled into the binary there is no second copy to drift and no portable shell to lint ([ADR 0019](../_adr/0019-single-binary-ts-engine.md)). The gate's `build` job is code generation; the release-only `deno task build` remains outside the gate. The `test` and `smoke` jobs are covered in [testing.md](testing.md).

## Conventions to follow

The conventions the tooling cannot fully enforce, but the project still holds:

- **The golden rule: project-owned, shared, or generated.** Project-owned files are the committed authored files (`project/map/**`, `project/guidance.md`, authored skills under `project/skills/`, project scripts under `project/scripts/`, and `project/TODO.md`); edit them in place. Shared files include `discern.toml`, provider settings, and discern's `.gitignore` block. Generated files include the ignored `.claude/skills/**` and `.agents/skills/**`, plus the agent files `AGENTS.md`/`CLAUDE.md`/`GEMINI.md`, which are committed and regenerated from their sources ([ADR 0019](../_adr/0019-single-binary-ts-engine.md), [ADR 0128](../_adr/0128-enumerated-ownership-tracked-guidance.md)). The engine, built-in skills, and built-in guidance exist only in the binary of an installed project. Change them by editing the source here and re-running the producing command. See [install-surface.md](install-surface.md) for the full ownership inventory.
- **Regenerate the agent files.** `AGENTS.md`, `CLAUDE.md`, and `GEMINI.md` are compiled from discern's built-in guidance plus your `[guidance].sources` by `discern refresh` and committed ([ADR 0034](../_adr/0034-agents-md-untracked-currency-check.md), [ADR 0128](../_adr/0128-enumerated-ownership-tracked-guidance.md)). Edit the guidance source and recompile. They carry no banner. `discern done` reports a stale or hand-edited file and leaves it for you to repair.
- **Run from source; avoid `dist/`.** `discern <cmd>` runs the engine of whichever checkout you are in (`deno task dev <cmd>` is the zero-setup equivalent); the `dist/` binaries bundle a frozen `templates/` snapshot. Omit `--` before a subcommand.
- **TypeScript module shape.** Every module opens with a JSDoc block stating its role (see any file under `src/`). [`main.ts`](../../../src/main.ts) is routing only; command logic lives in `src/commands/`, the engine in `src/engine/`, shared installer/engine helpers in `src/shared/`, and installer-only helpers in `src/lib/`. Keep modules small and single-purpose.
- **Strict TypeScript, repo-wide.** The strict `deno.json` compiler options and lint rules apply across the repo, including the engine. Keep types sound.
- **Keep the repo's own task vocabulary out of what ships.** `discern` is both a product and a self-hosting repo, so two command vocabularies coexist: the user's (`discern …`) and the repo's `deno task <task>` aliases. Shipped `templates/` and user-facing binary output use the user's vocabulary. A guard test ([tests/dev_vocab_guard_test.ts](../../../tests/dev_vocab_guard_test.ts)) fails the gate if the repo aliases leak.
- **Comments and docs describe the current system.** Code comments explain present behavior. The comment-currency guard rejects retrospective markers. When a marker describes current behavior and must remain, add `discern-allow-retrospective: <reason>`. Unused, duplicate, and reasonless annotations fail the guard ([ADR 0053](../_adr/0053-comment-currency-guard.md)). Docs use present tense, the canonical nouns from the [glossary](../00-orientation/glossary.md), and ASCII-first diagrams. Put outstanding work in [`project/TODO.md`](../../TODO.md).
- **Record decisions.** A notable change gets an ADR in [`project/map/_adr/`](../_adr/); overriding a [design principle](../00-orientation/design-principles.md) _requires_ one.

For test-specific conventions, see [testing.md](testing.md).
