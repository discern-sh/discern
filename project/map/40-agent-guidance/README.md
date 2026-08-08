---
title: Agent guidance
description: Author one set of project instructions, compile it for every coding agent, and keep the generated files current.
aliases:
  - guidance
  - agent instructions
  - AGENTS.md
---

# Agent guidance

_Guidance is shared project instructions, written once and supplied to every configured coding agent._

discern combines its built-in operating Guidance with the Guidance sources your project owns. `discern refresh` compiles that text into the instruction files for each configured agent, including `AGENTS.md`, `CLAUDE.md`, and `GEMINI.md`. Several agent integrations can then share one body of project rules.

Start with [Write project guidance](write-project-guidance.md). It covers `[guidance].sources`, the default `discern/guidance.md`, source globs, and what belongs in instructions that every agent reads. Keep those sources provider-neutral: name the project's commands, paths, and invariants rather than one agent's interface.

Then [Compile and check guidance](compile-and-check-guidance.md). It shows when to run `discern refresh`, which files appear for each agent, and why edits belong in their sources. The Gate compares generated files with those sources and reports a stale copy as a failed check.

A [Skill](../45-skills/) is a reusable agent playbook for a focused procedure. Every session reads Guidance. An agent loads a Skill when its description matches the work. Use Guidance for rules every session must carry, and a Skill for a repeatable procedure that needs steps and judgment.

| Read next                                                   | What it helps you do                          |
| ----------------------------------------------------------- | --------------------------------------------- |
| [Write project guidance](write-project-guidance.md)         | Choose sources and write shared instructions. |
| [Compile and check guidance](compile-and-check-guidance.md) | Refresh, inspect, and commit agent files.     |
