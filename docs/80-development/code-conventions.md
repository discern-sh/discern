# Code conventions

_The rules the tooling enforces, and the conventions to follow when writing code
here._

This doc is the detailed companion to the **Conventions** section of the project
guidance (`guidance.md`). The guidance holds the short, agent-facing form; this
doc holds the full reasoning. Keep the two in step, and keep both aligned with
what the `[capabilities]` and `[checks]` in `discern.toml` actually enforce —
the written rule and the enforced rule must never disagree.

## What the gate enforces

The fix- and check-stage work in [`discern.toml`](../../discern.toml) is the
mechanical rules: `format`, `lint`, and `typecheck` are known **Capabilities**
(the engine derives their Stage from the name). To satisfy all of them at once,
run `discern prepare`.

| Name        | Kind       | Stage | Command                  | What it checks / how to satisfy                                                                                                                                                                                 |
| ----------- | ---------- | ----- | ------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `format`    | capability | fix   | `deno fmt`               | Formats TypeScript **and** Markdown (so `docs/` is reformatted on every gate). `templates/`, `dist/`, the compiled agent files, and your trees are excluded in `deno.json`. Just run it — it rewrites in place. |
| `lint`      | capability | check | `deno lint`              | The Deno linter over `src/`, `scripts/`, `tests/`, with the repo's strict rule set. Fix the finding, or justify it with an inline `deno-lint-ignore` and a reason.                                              |
| `typecheck` | capability | check | `deno check src/main.ts` | Type-checks the whole graph reachable from the entrypoint under strict TS (`deno.json` `compilerOptions`). Keep types sound; no `any` slipped through a cast.                                                   |

There is no `selfcheck` or `shellcheck` check: with the engine compiled into the
binary there is no second copy to drift and no portable shell to lint
([ADR 0019](../_adr/0019-single-binary-ts-engine.md)). There is no `build`
capability (`deno task build` is release-only, so it is simply omitted), and the
`test` capability (`deno task test`) is covered in [testing.md](testing.md).

## Conventions to follow

The conventions the tooling cannot fully enforce, but the project still holds:

- **The golden rule — yours vs the binary's.** Ownership is two buckets
  ([ADR 0019](../_adr/0019-single-binary-ts-engine.md),
  [ADR 0020](../_adr/0020-dissolve-discern-dir.md)). _Yours_ are the committed
  files (`discern.toml`, `docs/**`, your `guidance.md`, authored skills under
  `./skills/`, `TODO.md`) — edit them in place. _The binary's_ are gitignored,
  re-published artifacts (`.claude/skills/**`, the compiled agent files
  `AGENTS.md`/`CLAUDE.md`/`GEMINI.md`, all gitignored — ADR 0034); the engine,
  built-in skills, and built-in guidance are bundled in the binary — never on
  disk in an install. Change the engine, a built-in skill, or built-in guidance
  by editing the source here and re-running the producing command; don't expect
  to find a committed copy to sync. See [install-surface.md](install-surface.md)
  for the full bucket map.
- **Never hand-edit the generated agent files.** `AGENTS.md`, `CLAUDE.md`, and
  `GEMINI.md` (all gitignored build artifacts — ADR 0034) are compiled from
  discern's built-in guidance plus your `[guidance].sources` by
  `discern refresh`; edit the guidance source and recompile. They carry no
  banner — `discern finish` fails if one drifts from its source, so a stale or
  hand-edited file is caught, not silently overwritten.
- **Run from source, never `dist/`.** `discern <cmd>` runs the engine of
  whichever checkout you are in (`deno task dev <cmd>` is the zero-setup
  equivalent); the `dist/` binaries bundle a frozen `templates/` snapshot. Don't
  put `--` before a subcommand.
- **TypeScript module shape.** Every module opens with a JSDoc block stating its
  role (see any file under `src/`). [`main.ts`](../../src/main.ts) is routing
  only; command logic lives in `src/commands/`, the engine in `src/engine/`,
  shared installer/engine helpers in `src/shared/`, and installer-only helpers
  in `src/lib/`. Keep modules small and single-purpose.
- **Strict TypeScript, repo-wide.** The whole repo is held to strict TS via
  `deno.json` `compilerOptions` plus a strict lint rule set; the engine is
  type-checked like the rest, not an exception. Keep types sound.
- **Keep the repo's own task vocabulary out of what ships.** `discern` is both a
  product and a self-hosting repo, so two command vocabularies coexist: the
  user's (`discern …`) and the repo's `deno task <task>` aliases. The latter
  must never reach a user — not in shipped `templates/` (received verbatim by
  every project) nor in user-facing output the binary prints. A guard test
  ([tests/dev_vocab_guard_test.ts](../../tests/dev_vocab_guard_test.ts)) fails
  the gate if it leaks.
- **Docs say what _is_.** Present tense, no modal verbs about the system, the
  canonical nouns from the [glossary](../00-orientation/glossary.md),
  ASCII-first diagrams. Outstanding work goes in [`TODO.md`](../../TODO.md), not
  the docs.
- **Record decisions.** A notable change gets an ADR in
  [`docs/_adr/`](../_adr/); overriding a
  [design principle](../00-orientation/design-principles.md) _requires_ one.

For test-specific conventions, see [testing.md](testing.md).
