---
title: Write project instructions
description: Configure instruction sources and write project rules that every supported coding agent can follow.
order: 10
aliases:
  - instruction sources
  - instructions.md
  - project instructions
  - remember this rule
---

# Write project instructions

_A Instruction source holds the project instructions that discern supplies to every configured coding agent._

The compiled file opens as your project's own document. Its heading names the project (`[project].name`, or the slug when it is unset), and its first line states that your instructions are the final authority ([ADR 0177](../_adr/0177-compiled-agent-file-opens-as-the-projects-own.md)). discern places its built-in operating instructions first, then adds your sources with project-specific facts. Your rules can therefore override the built-in instructions. Record how to run the project, which files discern generates, where decisions live, and which practices the gate cannot infer from commands alone. The default source is `discern/instructions.md`.

## Configure the sources

`[instructions].sources` accepts project-relative files and globs. Keep one source when the project has one natural home for instructions. Use several sources when existing documents already own distinct rules.

```toml
[instructions]
sources = ["discern/instructions.md", "packages/*/AGENT-NOTES.md"]
agents = ["claude_code", "codex", "gemini"]
```

Omit `agents` for the default pair, Claude Code and Codex. Set an explicit list to choose integrations. An empty list emits no agent files.

Source discovery skips agent files. A glob such as `"*.md"` never feeds `AGENTS.md`, `CLAUDE.md`, or `GEMINI.md` back into the next compilation.

## Write provider-neutral rules

Write for a new agent session with no memory of the conversation that produced the rule. Use the command, path, or named project concept the agent can inspect. State when the rule applies and include the reason when the reason prevents a plausible mistake.

Keep each rule with the project source that owns the fact. Future edits then have one authoritative source.

Keep instructions provider-neutral. Agent-specific setup, trust prompts, and file behavior belong in the [agent integration guides](../60-agent-integrations/). A standing rule belongs here only when every session needs it. A repeatable procedure belongs in an [authored skill](../45-skills/author-a-skill.md), where it loads when relevant instead of occupying every session.

## Current state & gotchas

- Built-in instructions are additive. A project source cannot replace or suppress them.
- Compilation reads source files in configured order after the built-in sections.
- Source discovery protects agent files, but a broad glob can still collect unrelated Markdown. Prefer narrow patterns with clear ownership.
- You own the source. Edit it directly, then compile the generated files with `discern refresh`.

## Where it lives in code

| Concern                          | Source                                                                            |
| -------------------------------- | --------------------------------------------------------------------------------- |
| Instruction configuration        | [`config_schema.ts`](../../../src/shared/config_schema.ts) (`instructionSection`) |
| Source discovery and compilation | [`instructions.ts`](../../../src/engine/instructions.ts) (`compileInstructions`)  |
| Agent file registry              | [`providers.ts`](../../../src/lib/providers.ts)                                   |
| Compilation coverage             | [`instructions_test.ts`](../../../tests/instructions_test.ts)                     |
