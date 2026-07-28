---
title: Design principles
description: The rules discern holds itself to, each one observable in your repo and held by a test in discern's own gate.
order: 20
aliases:
  - principles
  - philosophy
  - design
  - why
---

# Design principles

_Why discern is shaped this way: the rules the system holds itself to, and what each one means in your repo._

These aren't aspirations. Each principle is held by tests in discern's own gate, and overriding one takes a written decision record — the [ADRs](../_adr/) are that ledger, published as project history. If a behavior of discern's surprises you, the reason is usually one of these.

### 1. The engine stays stack-neutral

discern never hardcodes a language, test runner, or framework. The engine runs the jobs and scope gates your `discern.toml` names; everything stack-specific lives in that file ([ADR 0168](../_adr/0168-the-gate-declares-jobs.md)). The only place concrete ecosystems appear is setup's detection step, whose job is proposing fills for your review. That's what lets one binary serve any repository.

### 2. Every fact has one home

A fact is authored once and everything else derives from it: guidance compiles from one source set, the config reference generates from the config schema, and where a closed vocabulary (verbs, known jobs, agent providers) must appear in several places, a parity test ties every copy back to the source ([ADR 0051](../_adr/0051-canonical-set-parity.md)). A new member enrolls everywhere or fails the gate.

### 3. Re-running is always safe

discern scaffolds into a repository you care about, so every command is safe to run again. Your files are written once and never refreshed; [shared files](glossary.md#shared-file) converge only inside marked regions; [generated files](glossary.md#generated-file) may always be overwritten because you never edit them ([ADR 0128](../_adr/0128-enumerated-ownership-tracked-guidance.md)). Migrations are idempotent and refuse a dirty tree, so an upgrade stays revertible with git ([ADR 0014](../_adr/0014-versioned-migration-system.md)).

### 4. An installed project carries no runtime

The binary is self-contained (V8 baked in), so a project needs nothing but `discern` on `PATH` plus `git` ([ADR 0019](../_adr/0019-single-binary-ts-engine.md)). What discern writes into a repo is configuration, generated artifacts, and Markdown: data a tool reads, with no second program to keep alive.

### 5. Fail open when classifying, fail fast when executing

A path that matches no scope counts as a real code change and runs the full gate ([ADR 0018](../_adr/0018-vocabulary-consolidation.md)) — a wrong classification can only add checks. Once something has failed, the first failing job cancels its siblings and the report names the exact command ([ADR 0028](../_adr/0028-result-envelope-and-diagnostics.md)). Safe when unsure, fast when certain.

### 6. discern runs on itself

This repo's gate is the engine it ships, run straight from source. A regression in the shipped engine breaks discern's own build the same day, not your repo months later — and because the engine has one home inside the binary, there is no second copy to fall out of sync ([ADR 0019](../_adr/0019-single-binary-ts-engine.md)).

### 7. Sovereign inside, deferential outside

discern is maximally prescriptive within the paths it owns: the root `discern.toml`, the visible `discern/` namespace, the marked `.gitignore` block, each configured agent's own config files, and a worktree's `.env`. A test fails the moment any verb writes anywhere else ([ADR 0099](../_adr/0099-consolidate-authored-surface-under-discern-namespace.md), [ADR 0195](../_adr/0195-fresh-maps-and-neutral-scopes-stay-inside-owned-paths.md)). Containment is what licenses the strong opinions.

### 8. Placement is consent

A file at its `discern/` default carries an implicit write-license: agents maintain it freely, and staleness is a defect. A config key you pointed at a path of your own is an explicit license: you typed the path ([ADR 0100](../_adr/0100-project-map-is-the-agents-map.md), [ADR 0195](../_adr/0195-fresh-maps-and-neutral-scopes-stay-inside-owned-paths.md)). Any other path is untouchable, by construction rather than warning: the boundary is an architectural test, so an agent can't "helpfully" restructure documentation you never offered.

### 9. A subsystem that costs nothing when unused needs no switch

Worktrees you never start and standards you never define are inert, so they get no toggle; every subsystem is core ([ADR 0101](../_adr/0101-retire-the-features-toggles.md)). A toggle is a promise to test both states forever. One knob survived the test (`[skills].exclude`), because materialized skills occupy agent context even when unused.

### 10. Structure over advice

When a behavior matters, discern encodes it as a check, a standard, a parity test, or a refusal that explains itself, because everything merely advised degrades ([ADR 0077](../_adr/0077-setup-agent-is-the-configuration-engine.md)). discern's users are agents, and an agent under context pressure drops advice first; it can't drop a red gate.

### 11. The map serves two readers

The documentation tree discern maintains is the agents' map of the codebase: inferred by agents, written by agents, kept current under the same gate as the code. Humans get two things from that one tree. It's real documentation: plain Markdown, browsable with `discern map`, and publishable — the manual you're reading is discern's own map, rendered on discern.sh, in `discern help`, and over MCP ([ADR 0130](../_adr/0130-docs-site-renders-the-help-tree.md)). And it's an audit: a wrong page is a finding about what your agents understand, which is what makes it worth your read. Documentation you didn't point discern at is never touched (principle 8).

### 12. Uninstall leaves a healthy repository

`discern uninstall` removes the wiring and keeps your content: the guidance, map, skills, and scripts are plain Markdown at paths you chose or accepted, readable and valuable without the tool that helped grow them ([ADR 0104](../_adr/0104-uninstall-is-the-exit-honesty-verb.md)). A tool confident it will be kept has no need to make leaving expensive.

### 13. The footprint is provable

"One committed root file, one visible folder, the agent files, a short list of shims" is a checkable predicate: a test fails the moment any verb writes outside that footprint ([ADR 0099](../_adr/0099-consolidate-authored-surface-under-discern-namespace.md), [ADR 0195](../_adr/0195-fresh-maps-and-neutral-scopes-stay-inside-owned-paths.md)). The claim stays true because a check keeps it true.

## When a principle bends

It bends on the record or not at all. A change that needs an exception gets an [ADR](../_adr/) stating what it overrides and why — those records are published on the [decisions pages](../_adr/), so the reasoning is as inspectable as the rules.
