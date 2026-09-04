---
title: Agent instructions
description: Author one set of project instructions, compile it for every coding agent, and keep the generated files current.
aliases:
  - instructions
  - agent instructions
  - AGENTS.md
---

# Agent instructions

_Agent instructions are shared project instructions, written once and supplied to every configured coding agent._

discern combines its built-in operating instructions with the instruction sources your project owns. `discern refresh` compiles that text into the instruction files for each configured agent, including `AGENTS.md`, `CLAUDE.md`, and `GEMINI.md`. Compiled local Markdown links retain their source-relative targets. Several agent integrations can then share one body of project rules.

Start with [Write project instructions](write-project-instructions.md). It covers `[instructions].sources`, the default `discern/instructions.md`, source globs, and what belongs in instructions that every agent reads. Keep those sources provider-neutral: name the project's commands, paths, and invariants rather than one agent's interface.

Then [Compile and check instructions](compile-and-check-instructions.md). It shows when to run `discern refresh` or `discern prepare`, which files appear for each agent, and why edits belong in their sources. The Gate compares generated files with those sources and reports a stale copy as a failed check.

A [Skill](../45-skills/) is a reusable agent playbook for a focused procedure. Every session reads the agent instructions. An agent loads a skill when its description matches the work. Use instructions for rules every session must carry, and a skill for a repeatable procedure that needs steps and judgment.

| Read next                                                           | What it helps you do                          |
| ------------------------------------------------------------------- | --------------------------------------------- |
| [Write project instructions](write-project-instructions.md)         | Choose sources and write shared instructions. |
| [Compile and check instructions](compile-and-check-instructions.md) | Refresh, inspect, and commit agent files.     |
