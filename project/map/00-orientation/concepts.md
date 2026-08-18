---
title: Concepts
description: "The mental model of discern in one pass: the Gate, isolated worktrees, compiled instructions, and file ownership."
order: 10
aliases:
  - concepts
  - overview
  - mental model
  - how discern works
---

# Concepts: how discern fits together

_The mental model in one read: what discern is, what it installs, and the working loop._

## The idea

Your repository declares what "done" means in `discern.toml`. The file names the commands your project runs, such as format, lint, typecheck, test, build, and smoke. discern turns those declarations into a final quality check (the [Gate](glossary.md#gate)), an isolated workspace for each change (a Git [worktree](glossary.md#worktree)), and shared project instructions supplied to each coding agent.

The engine inside discern never learns your stack. It runs the [gate jobs](glossary.md#gate-job) and [scope](glossary.md#scope) gates named by your config. [`discern tidy`](glossary.md#tidy) handles discern-owned Markdown and the root config through the same jobs table. Fill in the project commands once and the same binary gates a Rust crate, a Rails app, or a monorepo holding both.

## One binary, a small footprint

discern is a self-contained binary on your `PATH`; its engine requires `git`. An installed project does not need Deno or Node to run discern because the repository stores configuration and text instead of a second runtime. By default, authored content lives in the visible [`discern/` namespace](glossary.md#namespace), while `discern.toml` stays at the root. An architectural test rejects writes outside the declared surface ([ADR 0099](../_adr/0099-consolidate-authored-surface-under-discern-namespace.md)). [Files & ownership](../70-reference/artifact-ownership.md) lists the full footprint.

## The pieces

**The Gate is the project's definition of done.** `discern done` runs the declared [jobs](glossary.md#gate-job), the scope gates for regions that changed, and each quality measure that can only improve (a [Standard](glossary.md#standard)). A configured [checkpoint](glossary.md#checkpoint) can pause the same moment for judgment: a matching change serves a [criterion](glossary.md#criterion) the agent answers on the record before any job runs. Known job names derive their [stage](glossary.md#stage); custom names declare one. Every unit of work has a label, so a failure result includes the exact command and its output. Use `discern prepare` for the faster iteration loop. [The quality gate](../20-quality-gate/) covers the full mechanism.

**Worktrees isolate each effort.** `discern start` gives an effort one checkout and branch, retained through review feedback and resumed sessions. The workflow keeps the main checkout available while several efforts run at once. A worktree gets a deterministic dev-server port and any [resources](glossary.md#worktree-resource) your project declares, such as a database or emulator. discern creates those resources when the worktree starts and destroys them when the change lands. `discern update` brings the latest [trunk](glossary.md#trunk) into the branch; `discern accept` lands the reviewed branch and removes the worktree. [Worktrees](../30-worktrees/) covers the lifecycle.

**Shared project instructions are written once and supplied to every agent.** This [instruction source](glossary.md#instruction-source) defaults to `discern/instructions.md`. `discern refresh` compiles discern's built-ins and your sources into each agent file (`AGENTS.md`, `CLAUDE.md`, and `GEMINI.md`), so Claude Code, Codex, Gemini, Cursor, and Copilot read the same instructions. Focused task playbooks ([Skills](glossary.md#skill)) materialize into each agent's skills directory through the same command. [Agent instructions](../40-agent-instructions/) and [Skills](../45-skills/) cover both surfaces.

**The project's maintained guide is the Map.** Agents maintain [the Map](glossary.md#map), a documentation tree for the codebase, under the same Gate as the code. A stale page is a defect, and the tree gives you a reviewable account of what the agents understand. This manual is discern's own Map.

**Ownership decides which files discern may write.** [File ownership](glossary.md#file-ownership) places each file discern writes in a [project-owned](glossary.md#project-owned-file), [shared](glossary.md#shared-file), or [generated](glossary.md#generated-file) category. The underlying rule is [placement is consent](glossary.md#placement-is-consent): a path you configured is a path you licensed. Repeated commands follow those ownership contracts. For example, `discern upgrade` migrates the config, re-materializes Skills, and recompiles instructions without replacing a value you set.

## The loop

An agent begins with `discern status`, which reports the current state and next action without changing the tree. The agent starts a worktree, makes the change, and iterates with `discern prepare`. `discern done` runs the final Gate. A clean, committed tree that passes produces a review claim for that exact commit (a Proof). The agent reports the change and Proof, then waits for your review. The branch lands only with recorded authority.

From the main checkout, bare `discern` opens the human view over work in progress (the [Desk](glossary.md#desk)). `Start a task` creates and readies a worktree, then its action menu can open a configured coding-agent CLI there. The Desk also surveys, inspects, updates, lands, enters, or discards the current fleet without requiring you to copy branch names between commands.

## Where next

| Want to understand…                                      | Read                                            |
| -------------------------------------------------------- | ----------------------------------------------- |
| Install, setup, and upgrades                             | [Getting started](../10-getting-started/)       |
| `discern done`: jobs, scopes, Standards, and checkpoints | [the quality gate](../20-quality-gate/)         |
| The worktree lifecycle and its resources                 | [worktrees](../30-worktrees/)                   |
| Instruction compilation                                  | [agent instructions](../40-agent-instructions/) |
| Bundled and project-authored Skills                      | [Skills](../45-skills/)                         |
| The files discern writes for each coding agent           | [agent integrations](../60-agent-integrations/) |
| Why the system is shaped this way                        | [design principles](design-principles.md)       |
