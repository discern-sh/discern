---
id: explanation-practice-and-roles
title: "Practice and roles"
description: "Understand discern as a project-installed practice, the coding agent as operator, and the human as owner and reviewer."
order: 20
publish: true
kind: explanation
aliases:
  - "explanation-practice-and-roles"
  - "Concepts: how discern fits together"
  - "concepts"
  - "overview"
  - "mental model"
  - "how discern works"
  - "Design principles"
  - "principles"
  - "philosophy"
  - "design"
  - "why"
  - "practice"
redirect_from:
  - "/docs/orientation/concepts"
  - "/docs/orientation/design-principles"
  - "/docs/orientation/system-map"
---

# Practice and roles

Understand discern as a project-installed practice, the coding agent as operator, and the human as owner and reviewer.

## Concepts: how discern fits together

_The mental model in one read: what discern is, what it installs, and the working loop._

### The idea

Your repository declares what "done" means in `discern.toml`. The file names the commands your project runs, such as format, lint, typecheck, test, build, and smoke. discern turns those declarations into a final quality check (the [Gate](../30-reference/glossary.md#gate)), an isolated workspace for each change (a Git [worktree](../30-reference/glossary.md#worktree)), and shared project instructions supplied to each coding agent.

The engine inside discern never learns your stack. It runs the [gate jobs](../30-reference/glossary.md#gate-job) and [scope](../30-reference/glossary.md#scope) gates named by your config. [`discern tidy`](../30-reference/glossary.md#tidy) handles discern-owned Markdown and the root config through the same jobs table. Fill in the project commands once and the same binary gates a Rust crate, a Rails app, or a monorepo holding both.

### One binary, a small footprint

discern is a self-contained binary on your `PATH`; its engine requires `git`. An installed project does not need Deno or Node to run discern because the repository stores configuration and text instead of a second runtime. By default, authored content lives in the visible [`discern/` namespace](../30-reference/glossary.md#namespace), while `discern.toml` stays at the root. An architectural test rejects writes outside the declared surface ([ADR 0099](https://discern.sh/docs/decisions/0099-consolidate-authored-surface-under-discern-namespace)). [Files & ownership](../30-reference/files-and-ownership.md) lists the full footprint.

### The pieces

**The Gate is the project's definition of done.** `discern done` runs the declared [jobs](../30-reference/glossary.md#gate-job), the scope gates for regions that changed, and each quality measure that can only improve (a [Standard](../30-reference/glossary.md#standard)). A configured [checkpoint](../30-reference/glossary.md#checkpoint) can pause the same moment for judgment: a matching change serves a [question](../30-reference/glossary.md#question) the agent answers on the record before any job runs. Known job names derive their [stage](../30-reference/glossary.md#stage); custom names declare one. Every unit of work has a label, so a failure result includes the exact command and its output. Use `discern prepare` for the faster iteration loop. [The quality gate](../10-guides/README.md) covers the full mechanism.

**Worktrees isolate each effort.** `discern start` gives an effort one checkout and branch, retained through review feedback and resumed sessions. The workflow keeps the main checkout available while several efforts run at once. A worktree gets a deterministic dev-server port and any [resources](../30-reference/glossary.md#worktree-resource) your project declares, such as a database or emulator. discern creates those resources when the worktree starts and destroys them when the change lands. `discern update` brings the latest [trunk](../30-reference/glossary.md#trunk) into the branch; `discern accept` lands the reviewed branch and removes the worktree. [Worktrees](../10-guides/README.md) covers the lifecycle.

**Shared project instructions are written once and supplied to every agent.** This [instruction source](../30-reference/glossary.md#instruction-source) defaults to `discern/instructions.md`. `discern refresh` compiles discern's built-ins and your sources into each agent file (`AGENTS.md`, `CLAUDE.md`, and `GEMINI.md`), so Claude Code, Codex, Gemini, Cursor, and Copilot read the same instructions. Focused task playbooks ([Skills](../30-reference/glossary.md#skill)) materialize into each agent's skills directory through the same command. [Agent instructions](../10-guides/README.md) and [Skills](../10-guides/README.md) cover both surfaces.

**The project's maintained guide is the Map.** Agents maintain [the Map](../30-reference/glossary.md#map), a documentation tree for the codebase, under the same Gate as the code. A stale page is a defect, and the tree gives you a reviewable account of what the agents understand. This manual is discern's own Map.

**Ownership decides which files discern may write.** [File ownership](../30-reference/glossary.md#file-ownership) places each file discern writes in a [project-owned](../30-reference/glossary.md#project-owned-file), [shared](../30-reference/glossary.md#shared-file), or [generated](../30-reference/glossary.md#generated-file) category. The underlying rule is [placement is consent](../30-reference/glossary.md#placement-is-consent): a path you configured is a path you licensed. Repeated commands follow those ownership contracts. For example, `discern upgrade` migrates the config, re-materializes Skills, and recompiles instructions without replacing a value you set.

### The loop

An agent begins with `discern status`, which reports the current state and next action without changing the tree. The agent starts a worktree, makes the change, and iterates with `discern prepare`. `discern done` runs the final Gate. A clean, committed tree that passes produces a review claim for that exact commit (a Proof). The agent reports the change and Proof, then waits for your review. The branch lands only with recorded authority.

From the main checkout, bare `discern` opens the human view over work in progress (the [Desk](../30-reference/glossary.md#desk)). `Start a task` creates and readies a worktree, then its action menu can open a configured coding-agent CLI there. The Desk also surveys, inspects, updates, lands, enters, or discards the current fleet without requiring you to copy branch names between commands.

### Where next

| Want to understand…                                      | Read                                            |
| -------------------------------------------------------- | ----------------------------------------------- |
| Install, setup, and upgrades                             | [Getting started](../00-start/README.md)       |
| `discern done`: jobs, scopes, Standards, and checkpoints | [the quality gate](../10-guides/README.md)         |
| The worktree lifecycle and its resources                 | [worktrees](../10-guides/README.md)                   |
| Instruction compilation                                  | [agent instructions](../10-guides/README.md) |
| Bundled and project-authored Skills                      | [Skills](../10-guides/README.md)                         |
| The files discern writes for each coding agent           | [agent integrations](../10-guides/connect-a-coding-agent.md) |
| Why the system is shaped this way                        | [design principles](practice-and-roles.md)       |
## Design principles

_Why discern works this way: the rules the system enforces and what each one means in your repository._

Tests in discern's own Gate enforce each principle. An exception requires a written Architecture Decision Record (ADR), published in the [decision archive](https://github.com/jackwh/discern/tree/main/project/map/_adr/). These principles explain behavior that may otherwise be surprising.

#### 1. The engine stays stack-neutral

discern never hardcodes a language, test runner, or framework. The engine runs the jobs and scope gates your `discern.toml` names; everything stack-specific lives in that file ([ADR 0168](https://discern.sh/docs/decisions/0168-the-gate-declares-jobs)). Concrete ecosystems appear in setup's detection step, which proposes fills for your review. This boundary lets one binary serve any repository.

#### 2. Every fact has one home

A fact has one authored source. Agent instructions compile from one source set, and the config reference generates from the config schema. When a closed vocabulary such as verbs, known jobs, or agent providers must appear in several places, a parity test ties each copy back to that source ([ADR 0051](https://discern.sh/docs/decisions/0051-canonical-set-parity)). A new member enrolls everywhere or fails the Gate.

#### 3. Re-running respects file ownership

Repeated commands follow the file-ownership contract. discern seeds project-owned files once and does not refresh them. [Shared files](../30-reference/glossary.md#shared-file) converge within marked regions. discern may overwrite [generated files](../30-reference/glossary.md#generated-file) because their reviewable sources remain authoritative ([ADR 0128](https://discern.sh/docs/decisions/0128-enumerated-ownership-tracked-guidance)). Migrations are idempotent and refuse a dirty tree, so Git can revert an upgrade ([ADR 0014](https://discern.sh/docs/decisions/0014-versioned-migration-system)).

#### 4. An installed project carries no runtime

The binary is self-contained (V8 baked in), so a project needs `discern` on `PATH` plus `git` ([ADR 0019](https://discern.sh/docs/decisions/0019-single-binary-ts-engine)). What discern writes into a repository is configuration, generated artifacts, and Markdown. These files require no second discern program to stay running.

#### 5. Unknown paths receive the full Gate

A path that matches no scope counts as a code change and runs the full Gate ([ADR 0018](https://discern.sh/docs/decisions/0018-vocabulary-consolidation)). An incorrect classification can therefore add checks. During a stage, the first failing job cancels its running siblings, and the result names the exact command ([ADR 0028](https://discern.sh/docs/decisions/0028-result-envelope-and-diagnostics)).

#### 6. discern runs on itself

This repository's Gate runs the engine it ships directly from source. An engine regression therefore breaks discern's own build before that tree can pass its Gate. The engine has one source inside the binary, so no second copy can drift ([ADR 0019](https://discern.sh/docs/decisions/0019-single-binary-ts-engine)).

#### 7. discern writes only within declared paths

discern applies its conventions within the paths it owns: the root `discern.toml`, the visible `discern/` namespace, the marked `.gitignore` block, each configured agent's config files, and a worktree's `.env`. An architectural test rejects writes elsewhere ([ADR 0099](https://discern.sh/docs/decisions/0099-consolidate-authored-surface-under-discern-namespace), [ADR 0195](https://discern.sh/docs/decisions/0195-fresh-maps-and-neutral-scopes-stay-inside-owned-paths)).

#### 8. Placement is consent

A file at its `discern/` default carries an implicit write license, so agents maintain it and treat staleness as a defect. A config key you pointed at another path is an explicit license because you supplied the path ([ADR 0100](https://discern.sh/docs/decisions/0100-project-map-is-the-agents-map), [ADR 0195](https://discern.sh/docs/decisions/0195-fresh-maps-and-neutral-scopes-stay-inside-owned-paths)). discern's write plan excludes every other path, and an architectural test enforces the boundary. A prior worktree registration plus discern's recorded removal creates a time-bounded cleanup offer for that same path; prune still requires confirmation ([ADR 0265](https://discern.sh/docs/decisions/0265-removed-worktree-paths-authorize-bounded-reappearance-cleanup)).

#### 9. Unused subsystems remain inert

Worktrees you never start and Standards you never define do no work, so they have no toggle; each subsystem is core ([ADR 0101](https://discern.sh/docs/decisions/0101-retire-the-features-toggles)). A toggle creates another state the product must test. `[skills].exclude` remains because a materialized Skill occupies agent context even when unused.

#### 10. Required behavior belongs in checks

When a behavior matters, discern encodes it as a check, a Standard, a parity test, or a refusal with a recovery action ([ADR 0077](https://discern.sh/docs/decisions/0077-setup-agent-is-the-configuration-engine)). Checks remain visible when an agent session runs short of context; prose instructions may not.

#### 11. The map serves two readers

The documentation tree discern maintains is the agents' Map of the codebase. Agents infer, write, and keep it current under the same Gate as the code. For people, the tree serves as documentation and an audit. The Markdown is browsable with `discern map` and publishable on discern.sh, in `discern docs`, and over the Model Context Protocol (MCP) ([ADR 0130](https://discern.sh/docs/decisions/0130-docs-site-renders-the-help-tree)). An inaccurate page reveals a gap in the recorded project understanding. discern does not touch documentation outside the paths the project supplies (principle 8).

#### 12. Uninstall retains project content

`discern uninstall` removes discern's wiring and keeps project-owned content. The instructions, Map, Skills, and scripts remain at the paths you chose or accepted, readable without discern ([ADR 0104](https://discern.sh/docs/decisions/0104-uninstall-is-the-exit-honesty-verb)).

#### 13. The footprint is provable

The footprint consists of one committed root file, one visible folder, the agent files, and a declared list of integration files. An architectural test rejects writes outside that inventory ([ADR 0099](https://discern.sh/docs/decisions/0099-consolidate-authored-surface-under-discern-namespace), [ADR 0195](https://discern.sh/docs/decisions/0195-fresh-maps-and-neutral-scopes-stay-inside-owned-paths)).

### When a principle bends

An exception requires an [ADR](https://github.com/jackwh/discern/tree/main/project/map/_adr/) that states which principle it overrides and why. The [decision archive](https://github.com/jackwh/discern/tree/main/project/map/_adr/) publishes that reasoning with the rules.
