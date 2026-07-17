---
title: Concepts
description: The mental model of discern in one pass — the gate, isolated worktrees, compiled guidance, and who owns which files.
order: 10
aliases:
  - concepts
  - overview
  - mental model
  - how discern works
---

# Concepts: how discern fits together

_The mental model in one read: what discern is, the pieces it installs, and the loop you'll live in._

## The idea

Your repo declares what "done" means once, in one file: `discern.toml`. It names the commands your project runs (format, lint, typecheck, test, build, smoke), and discern turns them into the rails every coding agent works within: a quality gate, an isolated [worktree](glossary.md#worktree) per change, and one set of instructions each agent reads.

The engine inside discern never learns your stack. It runs "the test [capability](glossary.md#capability)" or "the gate for this [scope](glossary.md#scope)": names discovered from your config ([ADR 0017](../_adr/0017-capabilities-model.md)). Fill in the commands once and the same binary gates a Rust crate, a Rails app, or a monorepo holding both.

## One binary, a small footprint

discern is a single self-contained binary on your `PATH`, and the only other thing it needs is `git`. Your project needs no Deno, no Node, and no runtime of discern's: what lands in the repo is configuration and text. The committed footprint is `discern.toml` plus one visible folder, the [`discern/` namespace](glossary.md#namespace), for content you author — and a test fails the moment any verb writes outside the enumerated surface ([ADR 0099](../_adr/0099-consolidate-authored-surface-under-discern-namespace.md)). [Files & ownership](../10-installer/artifact-ownership.md) is the full inventory.

## The pieces

**The gate is your definition of done.** `discern done` runs everything the config declares: the capabilities, any custom [checks](glossary.md#check), the scope gates for regions that changed, and the [standards](glossary.md#standard) — quality numbers that may only move in the right direction. Each runs as its own labeled job in a derived [stage](glossary.md#stage), so you never write a scheduling keyword, and a failure hands back the exact command and its output. `discern prepare` is the fast loop while iterating. Covered in [the quality gate](../20-quality-gate/).

**Worktrees keep every change isolated.** `discern start` gives each task its own checkout and branch, so the main checkout stays clean while several efforts run at once. A worktree gets a deterministic dev-server port and any [resources](glossary.md#worktree-resource) your project declares (a database, an emulator), created when it starts and destroyed when it lands. `discern update` merges the latest [trunk](glossary.md#trunk) in beneath the work; `discern accept` lands the reviewed branch and removes the worktree. Covered in [worktrees](../30-worktrees/).

**Guidance is authored once and compiled everywhere.** Your instructions live in one [source](glossary.md#guidance-source) (default `discern/guidance.md`). `discern refresh` compiles discern's built-ins plus yours into each agent's own file (`AGENTS.md`, `CLAUDE.md`, `GEMINI.md`), so Claude Code, Codex, Gemini, Cursor, and Copilot all read the same page. [Skills](glossary.md#skill), focused task playbooks, materialize into each agent's skills directory the same way. Covered in [agent guidance](../40-agent-guidance/).

**The map is documentation your agents keep current.** Agents maintain [the map](glossary.md#map), a documentation tree of your codebase, under the same gate as the code — so a stale page is a defect, and you read the tree to audit what your agents understand. The manual you're reading is discern's own map.

**Ownership decides who may touch what.** Every file discern writes has a disposition: [yours](glossary.md#your-files--yours) (written once, then the project's), co-managed (a marked region in a file you share), or [the binary's](glossary.md#the-binarys-files) (regenerated on demand, safe to overwrite). The rule underneath is [placement is consent](glossary.md#placement-is-consent): a path you configured is a path you licensed. That split is what makes every command safe to re-run — `discern upgrade` migrates the config, re-materializes skills, and recompiles guidance without rewriting a value you set.

## The loop

Day to day, an agent orients with `discern status` (read-only: what's true, what to do next), starts a worktree, makes the change, iterates with `discern prepare`, and claims done with `discern done`. On green it reports a receipt and waits. You review the branch, and it lands only when you say so.

## Where next

| Want to understand…                                     | Read                                             |
| ------------------------------------------------------- | ------------------------------------------------ |
| Install, setup, and upgrades                            | [the installer](../10-installer/)                |
| `discern done` — capabilities, checks, scopes, standards | [the quality gate](../20-quality-gate/)          |
| The worktree lifecycle and its resources                | [worktrees](../30-worktrees/)                    |
| Guidance compilation and the bundled skills             | [agent guidance](../40-agent-guidance/)          |
| The files discern writes for each coding agent          | [agent integrations](../60-agent-integrations/)  |
| Why the system is shaped this way                       | [design principles](design-principles.md)        |
