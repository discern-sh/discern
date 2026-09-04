---
title: Design principles
description: The rules discern enforces, with each one observable in your repository and covered by its own Gate.
order: 20
aliases:
  - principles
  - philosophy
  - design
  - why
---

# Design principles

_Why discern works this way: the rules the system enforces and what each one means in your repository._

Tests in discern's own gate enforce each principle. An exception requires a written Architecture Decision Record (ADR), published in the [decision archive](../_adr/). These principles explain behavior that may otherwise be surprising.

### 1. The engine stays stack-neutral

discern never hardcodes a language, test runner, or framework. The engine runs the jobs and scope gates your `discern.toml` names; everything stack-specific lives in that file ([ADR 0168](../_adr/0168-the-gate-declares-jobs.md)). Concrete ecosystems appear in setup's detection step, which proposes fills for your review. This boundary lets one binary serve any repository.

### 2. Every fact has one home

A fact has one authored source. Agent instructions compile from one source set, and the config reference generates from the config schema. When a closed vocabulary such as verbs, known jobs, or agent providers must appear in several places, a parity test ties each copy back to that source ([ADR 0051](../_adr/0051-canonical-set-parity.md)). A new member enrolls everywhere or fails the gate.

### 3. Re-running respects file ownership

Repeated commands follow the file-ownership contract. discern seeds project-owned files once and does not refresh them. [Shared files](glossary.md#shared-file) converge within marked regions. discern may overwrite [generated files](glossary.md#generated-file) because their reviewable sources remain authoritative ([ADR 0128](../_adr/0128-enumerated-ownership-tracked-guidance.md)). Migrations are idempotent and refuse a dirty tree, so Git can revert an upgrade ([ADR 0014](../_adr/0014-versioned-migration-system.md)).

### 4. An installed project carries no runtime

The binary is self-contained (V8 baked in), so a project needs `discern` on `PATH` plus `git` ([ADR 0019](../_adr/0019-single-binary-ts-engine.md)). What discern writes into a repository is configuration, generated artifacts, and Markdown. These files require no second discern program to stay running.

### 5. Unknown paths receive the full Gate

A path that matches no scope counts as a code change and runs the full gate ([ADR 0018](../_adr/0018-vocabulary-consolidation.md)). An incorrect classification can therefore add checks. During a stage, the first failing job cancels its running siblings, and the result names the exact command ([ADR 0028](../_adr/0028-result-envelope-and-diagnostics.md)).

### 6. discern runs on itself

This repository's gate runs the engine it ships directly from source. An engine regression therefore breaks discern's own build before that tree can pass its gate. The engine has one source inside the binary, so no second copy can drift ([ADR 0019](../_adr/0019-single-binary-ts-engine.md)).

### 7. discern writes only within declared paths

discern applies its conventions within the paths it owns: the root `discern.toml`, the visible `discern/` namespace, the marked `.gitignore` block, each configured agent's config files, and a worktree's `.env`. An architectural test rejects writes elsewhere ([ADR 0099](../_adr/0099-consolidate-authored-surface-under-discern-namespace.md), [ADR 0195](../_adr/0195-fresh-maps-and-neutral-scopes-stay-inside-owned-paths.md)).

### 8. Placement is consent

A file at its `discern/` default carries an implicit write license, so agents maintain it and treat staleness as a defect. A config key you pointed at another path is an explicit license because you supplied the path ([ADR 0100](../_adr/0100-project-map-is-the-agents-map.md), [ADR 0195](../_adr/0195-fresh-maps-and-neutral-scopes-stay-inside-owned-paths.md)). discern's write plan excludes every other path, and an architectural test enforces the boundary. A prior worktree registration plus discern's recorded removal creates a time-bounded cleanup offer for that same path; prune still requires confirmation ([ADR 0265](../_adr/0265-removed-worktree-paths-authorize-bounded-reappearance-cleanup.md)).

### 9. Unused subsystems remain inert

Worktrees you never start and standards you never define do no work, so they have no toggle; each subsystem is core ([ADR 0101](../_adr/0101-retire-the-features-toggles.md)). A toggle creates another state the product must test. `[skills].exclude` remains because a materialized skill occupies agent context even when unused.

### 10. Required behavior belongs in checks

When a behavior matters, discern encodes it as a check, a standard, a parity test, or a refusal with a recovery action ([ADR 0077](../_adr/0077-setup-agent-is-the-configuration-engine.md)). Checks remain visible when an agent session runs short of context; prose instructions may not.

### 11. The map serves two readers

The documentation tree discern maintains is the agents' Map of the codebase. Agents infer, write, and keep it current under the same gate as the code. For people, the tree serves as an audit surface. The Markdown is browsable with `discern map` and over the Model Context Protocol (MCP), and discern's own map is published as a trust exhibit at [discern.sh/map](https://discern.sh/map); the product manual is a separate corpus ([ADR 0314](../_adr/0314-separate-public-manual-and-project-map.md), amending [ADR 0130](../_adr/0130-docs-site-renders-the-help-tree.md)). An inaccurate page reveals a gap in the recorded project understanding. discern does not touch documentation outside the paths the project supplies (principle 8).

### 12. Uninstall retains project content

`discern uninstall` removes discern's wiring and keeps project-owned content. The instructions, Map, Skills, and scripts remain at the paths you chose or accepted, readable without discern ([ADR 0104](../_adr/0104-uninstall-is-the-exit-honesty-verb.md)).

### 13. The footprint is provable

The footprint consists of one committed root file, one visible folder, the agent files, and a declared list of integration files. An architectural test rejects writes outside that inventory ([ADR 0099](../_adr/0099-consolidate-authored-surface-under-discern-namespace.md), [ADR 0195](../_adr/0195-fresh-maps-and-neutral-scopes-stay-inside-owned-paths.md)).

## When a principle bends

An exception requires an [ADR](../_adr/) that states which principle it overrides and why. The [decision archive](../_adr/) publishes that reasoning with the rules.

## Accepted execution-model direction

ADRs [0374](../_adr/0374-complete-proof-is-independent-of-measurement-scheduling.md), [0375](../_adr/0375-source-authority-survives-declared-composition.md), and [0376](../_adr/0376-active-commands-advance-an-authorized-landing-queue.md) record complete candidate evidence, source authority, and active-command coordination. [ADR 0377](../_adr/0377-execution-environments-declare-reuse-and-recovery.md) defines project-owned environment reuse. [ADR 0378](../_adr/0378-landing-completion-survives-checkout-retirement.md) separates landing from retirement, and [ADR 0379](../_adr/0379-emergency-landings-record-an-explicit-proof-exception.md) defines explicit emergency exceptions.

Implementation is pending. The runtime sections above remain current. The accepted design keeps the no-daemon and agent checkout boundaries, while giving discern executors recorded authority to use released environments and advance approved work. Mechanical completion must retain the facts needed by a replacement session.
