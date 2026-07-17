---
title: Agent guidance
description: Author one set of project instructions, compile it for every coding agent, and keep the generated files current.
aliases:
  - guidance
  - agent instructions
  - AGENTS.md
---

# Agent guidance

_Write the project's working instructions once, then give every configured coding agent the same rules._

discern combines its built-in operating guidance with the guidance sources your project owns. `discern refresh` compiles that combined text into the instruction files each configured agent reads, including `AGENTS.md`, `CLAUDE.md`, and `GEMINI.md`. A project can support several coding agents without maintaining several versions of the same rule.

Start with [Write project guidance](write-project-guidance.md). It covers `[guidance].sources`, the default `discern/guidance.md`, source globs, and what belongs in instructions that every agent reads. Keep those sources provider-neutral: name the project's commands, paths, and invariants rather than one agent's interface.

Then [Compile and check guidance](compile-and-check-guidance.md). It shows when to run `discern refresh`, which files appear for each agent, and why the generated files stay out of hand editing. The gate compares them with their sources, so a stale generated copy is a failed check rather than a second body of guidance to reconcile.

Focused procedures belong in [Skills](../45-skills/). Every session reads guidance. An agent loads a skill when its description matches the work. Use guidance for rules every session must carry, and a skill for a repeatable procedure that needs steps and judgment.

| Read next                                                   | What it helps you do                                      |
| ----------------------------------------------------------- | --------------------------------------------------------- |
| [Write project guidance](write-project-guidance.md)         | Choose sources and write instructions every agent shares. |
| [Compile and check guidance](compile-and-check-guidance.md) | Refresh, inspect, and commit compiled agent files.        |
