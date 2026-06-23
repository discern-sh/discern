# Agent guidance (author-once → compile-everywhere)

_discern's built-in harness guidance plus your sources, compiled to every
agent's instruction file._

This subtree covers the instruction pipeline. discern ships **built-in harness
guidance** bundled in the binary
([`templates/guidance/`](../../templates/guidance/)); you add your own
**Guidance source** — `[guidance].sources` in `discern.toml`, default
`guidance.md`, globs allowed.
[`discern refresh`](../../src/engine/guidelines.ts) regenerates the generated
agent files, skills, and integration artifacts: it compiles
`[built-in base] + [a section per enabled feature] + [your sources]` into each
**Compiled agent file**, selected by `[guidance].agents` (`claude_code` →
`CLAUDE.md`, `codex` → `AGENTS.md`, `gemini` → `GEMINI.md`). The same verb
(re)materializes the **Skills** into `.claude/skills/`.

The compiled files are
[Generated](../00-orientation/glossary.md#generated-file): never hand-edited,
always reproduced by re-running the verb, and gitignored build artifacts (ADR
0034) — the reviewable, tracked form is your `[guidance].sources`. `AGENTS.md`
holds the full compiled body — the single on-disk source the mirrors point back
at (the **canonical** file). `CLAUDE.md` **imports** `AGENTS.md` via Claude
Code's `@`-include rather than duplicating it (so the two can never drift);
`GEMINI.md` is a full copy until Gemini's include syntax is wired. When no
canonical file is emitted, each mirror falls back to the full body. They carry
no banner — `discern status` / `discern finish` flag a generated file that has
drifted from its source instead. Driving several agents from one source is what
keeps guidance provider-agnostic — write the rule once, every agent gets it; the
built-in guidance is feature-aware, so a subsystem you disable in `[features]`
drops its section.

The Skills are the bundled built-ins (`bootstrap`, `document-subsystem`,
`write-adr`, `handoff-worktree`) plus any you author under `[skills].dir`
(default `./skills`, yours overriding a built-in by name). They materialize into
[`.claude/skills/`](../../.claude/skills/) — gitignored artifacts the binary
re-publishes: built-ins **copied**, authored skills **symlinked**.

> **Status: stub.** This README orients the subtree; the leaves below are not
> written yet. Fill them with the
> [`document-subsystem`](../../templates/skills/document-subsystem/SKILL.md)
> skill.

## Planned leaves

| File _(to be written)_     | What it will cover                                                                                            |
| -------------------------- | ------------------------------------------------------------------------------------------------------------- |
| `the-guidelines-recipe.md` | How `discern refresh` assembles built-in + sources into per-agent files and banners.                          |
| `the-compiled-files.md`    | The agent-file targets, the `[guidance].agents` selector, tracked vs gitignored, the do-not-edit rule.        |
| `bundled-skills.md`        | What each shipped Skill does, the built-in/authored override rule, and how `.claude/skills/` is materialized. |

## See also

- [concepts.md](../00-orientation/concepts.md) — guidance alongside the runtime
  path.
- [install-surface.md](../80-development/install-surface.md) — the guidance
  files and their dispositions.
