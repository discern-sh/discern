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
`CLAUDE.md`, `codex` / `cursor` / `copilot` → `AGENTS.md`, `gemini` →
`GEMINI.md`). The same verb (re)materializes the **Skills** into each configured
agent's skills directory.

The compiled files are
[Generated](../00-orientation/glossary.md#generated-file): never hand-edited,
always reproduced by re-running the verb, and gitignored build artifacts (ADR
0034) — the reviewable, tracked form is your `[guidance].sources`. `AGENTS.md`
holds the full compiled body — the single on-disk source the mirrors point back
at (the **canonical** file). Both `CLAUDE.md` and `GEMINI.md` **import**
`AGENTS.md` via the `@`-include their CLIs share rather than duplicating it (so
they can never drift); `AGENTS.md` is the canonical body precisely because Codex
has no import directive to point with. Cursor and GitHub Copilot read
`AGENTS.md` natively, so they add no duplicate provider-specific guidance file;
when one of them is configured without Codex, `discern refresh` still emits the
canonical `AGENTS.md` they read. When no canonical file is emitted or reused,
each mirror falls back to the full body. They carry no banner — `discern status`
/ `discern finish` flag a generated file that has drifted from its source
instead. Driving several agents from one source is what keeps guidance
provider-agnostic — write the rule once, every agent gets it. The built-in
guidance is feature-aware, so a subsystem you disable in `[features]` drops its
section; it is also **config-aware** — each built-in section is rendered through
a small [templating engine](the-templating-engine.md) so the generic shipped
prose names your real branch and omits content for anything you haven't
configured (a ratchet, a worktree resource).

The Skills are the bundled built-ins (`delegate-task`, `discern-document-subsystem`,
`discern-cure-a-bug`, and `discern-write-adr`) plus any you author under `[skills].dir`
(default `./skills`, yours overriding a built-in by name). The `discern-cure-a-bug`
built-in pairs with an always-on norm in the built-in base — discern's first
general working discipline shipped on by default
([ADR 0049](../_adr/0049-bug-class-discipline-built-in.md)). They materialize
into each configured agent's skills directory
([`.claude/skills/`](../../.claude/skills/) for Claude Code, the cross-tool
`.agents/skills/` for Codex, Gemini, Cursor, and GitHub Copilot — Claude Code
does not read the shared dir;
[ADR 0043](../_adr/0043-registry-derived-agent-parity.md)) — gitignored
artifacts the binary re-publishes: built-ins **copied**, authored skills
**symlinked**. The materialized skills are guarded by the **same currency
check** as the compiled files: `discern status` / `discern finish` flag a skills
dir that has drifted from the effective set, so a hand-edited or stale copy is
caught, not silent
([ADR 0034](../_adr/0034-agents-md-untracked-currency-check.md), extended to
skills).

Everything agent-specific — each agent's instruction file, skills dir, MCP and
worktree-hook surfaces — lives in ONE typed provider registry
([`src/lib/providers.ts`](../../src/lib/providers.ts);
[ADR 0031](../_adr/0031-typed-provider-integration.md)), and the cross-cutting
consumers (the seed `.gitignore`, the neutral scopes, the improvement coach's
agent-file probe) all derive from it. A registry-driven parity test fails the
build if a new agent isn't handled across every surface, so the integrations
cannot drift as agents are added
([ADR 0043](../_adr/0043-registry-derived-agent-parity.md)).

> **Status: stub.** This README orients the subtree; the leaves below are not
> written yet. Fill them with the
> [`discern-document-subsystem`](../../templates/skills/discern-document-subsystem/SKILL.md)
> skill.

## Reference

- [the-templating-engine.md](the-templating-engine.md) — the `{{var}}` /
  `{{#if}}` engine that renders the built-in sections against committed config,
  its strictness, and the config-only invariant.

## Planned leaves

| File _(to be written)_     | What it will cover                                                                                                   |
| -------------------------- | -------------------------------------------------------------------------------------------------------------------- |
| `the-guidelines-recipe.md` | How `discern refresh` assembles built-in + sources into per-agent files and banners.                                 |
| `the-compiled-files.md`    | The agent-file targets, the `[guidance].agents` selector, tracked vs gitignored, the do-not-edit rule.               |
| `bundled-skills.md`        | What each shipped Skill does, the built-in/authored override rule, and how the agents' skills dirs are materialized. |

## See also

- [concepts.md](../00-orientation/concepts.md) — guidance alongside the runtime
  path.
- [agent integrations](../60-agent-integrations/) — provider-specific config
  files, trust gates, and gotchas.
- [install-surface.md](../80-development/install-surface.md) — the guidance
  files and their dispositions.
