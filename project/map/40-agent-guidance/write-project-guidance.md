---
title: Write project guidance
description: Configure guidance sources and write project rules that every supported coding agent can follow.
order: 10
aliases:
  - guidance sources
  - guidance.md
  - project instructions
  - remember this rule
---

# Write project guidance

_A Guidance source holds the project instructions that discern supplies to every configured coding agent._

The compiled file opens as your project's own document. Its heading names the project (`[project].name`, or the slug when it is unset), and its first line states that your Guidance is the final authority ([ADR 0177](../_adr/0177-compiled-agent-file-opens-as-the-projects-own.md)). discern places its built-in operating Guidance first, then adds your sources with project-specific facts. Your rules can therefore override the built-in instructions. Record how to run the project, which files discern generates, where decisions live, and which practices the Gate cannot infer from commands alone. The default source is `discern/guidance.md`.

## Configure the sources

`[guidance].sources` accepts project-relative files and globs. Keep one source when the project has one natural home for instructions. Use several sources when existing documents already own distinct rules.

```toml
[guidance]
sources = ["discern/guidance.md", "packages/*/AGENT-NOTES.md"]
agents = ["claude_code", "codex", "gemini"]
```

Omit `agents` for the default pair, Claude Code and Codex. Set an explicit list to choose integrations. An empty list emits no agent files.

Source discovery skips agent files. A glob such as `"*.md"` never feeds `AGENTS.md`, `CLAUDE.md`, or `GEMINI.md` back into the next compilation.

## Write provider-neutral rules

Write for a new agent session with no memory of the conversation that produced the rule. Use the command, path, or named project concept the agent can inspect. State when the rule applies and include the reason when the reason prevents a plausible mistake.

Keep each rule with the project source that owns the fact. Future edits then have one authoritative source.

Keep Guidance provider-neutral. Agent-specific setup, trust prompts, and file behavior belong in the [agent integration guides](../60-agent-integrations/). A standing rule belongs here only when every session needs it. A repeatable procedure belongs in an [authored Skill](../45-skills/author-a-skill.md), where it loads when relevant instead of occupying every session.

## Current state & gotchas

- Built-in Guidance is additive. A project source cannot replace or suppress it.
- Compilation reads source files in configured order after the built-in sections.
- Source discovery protects agent files, but a broad glob can still collect unrelated Markdown. Prefer narrow patterns with clear ownership.
- You own the source. Edit it directly, then compile the generated files with `discern refresh`.

## Where it lives in code

| Concern                          | Source                                                                         |
| -------------------------------- | ------------------------------------------------------------------------------ |
| Guidance configuration           | [`config_schema.ts`](../../../src/shared/config_schema.ts) (`guidanceSection`) |
| Source discovery and compilation | [`guidelines.ts`](../../../src/engine/guidelines.ts) (`compileGuidelines`)     |
| Agent file registry              | [`providers.ts`](../../../src/lib/providers.ts)                                |
| Compilation coverage             | [`guidelines_test.ts`](../../../tests/guidelines_test.ts)                      |
