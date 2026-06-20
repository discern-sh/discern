# Agent guidance (author-once → compile-everywhere)

_One Guidance source compiled to every agent's instruction file._

This subtree covers the instruction pipeline. You author a single **Guidance
source** — `.icculus/guidelines/<slug>.md` — and
[`icculus guidelines`](../../src/engine/guidelines.ts) compiles it into each
**Compiled agent file** (`CLAUDE.md`, `AGENTS.md`, …), selected by
`[project].agents` in `.icculus/config.toml` (`claude_code` → `CLAUDE.md`,
`codex` → `AGENTS.md`). The same verb refreshes the `.claude/skills/` symlinks
that make the bundled **Skills** discoverable.

The compiled files carry a do-not-edit banner and are
[Generated](../00-orientation/glossary.md#generated-file): never hand-edited,
always reproduced by re-running the verb. Driving several agents from one source
is what keeps guidance provider-agnostic — write the rule once, every agent gets
it.

The bundled Skills (`bootstrap`, `document-subsystem`, `write-adr`, and
`handoff-worktree`) are materialized into
[`.icculus/skills/`](../../.icculus/skills/) — gitignored artifacts the binary
re-publishes, not committed files.

> **Status: stub.** This README orients the subtree; the leaves below are not
> written yet. Fill them with the
> [`document-subsystem`](../../.icculus/skills/document-subsystem/SKILL.md)
> skill.

## Planned leaves

| File _(to be written)_     | What it will cover                                                               |
| -------------------------- | -------------------------------------------------------------------------------- |
| `the-guidelines-recipe.md` | How `icculus guidelines` compiles the source into per-agent files and banners.   |
| `the-compiled-files.md`    | The agent-file targets, the `[project].agents` selector, the do-not-edit rule.   |
| `bundled-skills.md`        | What each shipped Skill does and how the `.claude/skills/` symlinks expose them. |

## See also

- [concepts.md](../00-orientation/concepts.md) — guidance alongside the runtime
  path.
- [install-surface.md](../80-development/install-surface.md) — the guidance
  files and their dispositions.
