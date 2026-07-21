---
title: Guidance template engine
description: The strict config-only renderer for bundled guidance and bundled-skill Markdown.
order: 50
aliases:
  - guidance templates
  - template engine
---

# The guidance templating engine

_How discern's **built-in** guidance sections and **bundled** skills are rendered against a project's config before they are compiled or materialized._

discern's built-in sections ([`templates/guidance/*.md`](../../../templates/guidance/)) are the distribution source carried by every binary. To let that generic prose name a project's _real_ paths and branches and drop content that is inert until configured, `discern refresh` renders each built-in section through a small, strict template engine ([`src/engine/guidance_template.ts`](../../../src/engine/guidance_template.ts)) before concatenating them. The decision and its rationale are recorded ([ADR 0035](../_adr/0035-guidance-templating-engine.md)); this page is the working reference.

The same engine renders **bundled-skill markdown** at materialization and at `skills eject`. It uses the same context, so a shipped skill's prose names the project's configured paths through `{{map_dir}}` and `{{todo_path}}` instead of discern's defaults ([ADR 0102](../_adr/0102-paths-registry-and-rendered-artifacts.md)). A sentinel-render test and a source-literal ban keep any hard-coded default a gate failure.

## Syntax

The syntax is minimal: no loops, expressions, or library.

| Form                            | Effect                                     |
| ------------------------------- | ------------------------------------------ |
| `{{var}}`                       | Substitute a string variable.              |
| `{{#if pred}}…{{/if}}`          | Include the body only when `pred` is true. |
| `{{#if pred}}…{{else}}…{{/if}}` | Include one branch or the other.           |

Variables work inside `{{#if}}` blocks, and `{{#if}}` may nest. Tag names are lowercase snake_case; whitespace inside the braces is ignored (`{{ var }}` == `{{var}}`).

## The context — committed config only

Every variable and predicate is built by `guidanceContext(config)` in [`guidance_render.ts`](../../../src/engine/guidance_render.ts), a **pure function of committed `discern.toml`**:

| Kind      | Name                       | Source                                                  |
| --------- | -------------------------- | ------------------------------------------------------- |
| variable  | `branch_prefix`            | `[repository].branch_prefix`                            |
| variable  | `main_branch`              | `[repository].trunk` (committed value)                  |
| variable  | `map_dir`                  | `[map].dir`, normalized with its trailing slash         |
| variable  | `todo_path`                | `[project].todo`                                        |
| variable  | `skills_dir`               | `[skills].dir`                                          |
| variable  | `scripts_dir`              | `[scripts].dir`                                         |
| variable  | `guidance_sources`         | `[guidance].sources`, rendered as a code-formatted list |
| variable  | `generated_agent_files`    | provider-registry outputs for the configured agents     |
| variable  | `materialized_skills_dirs` | provider-registry skills dirs for the configured agents |
| predicate | `has_standards`            | any `[standards.*]` declared                            |
| predicate | `has_worktree_resources`   | any `[worktree.resources.*]` declared                   |

> **Invariant.** The context must read **nothing that varies between two runs on the same commit** — no git branch/status, env var, clock, randomness, absolute path, or ignored/per-worktree file. The agent files are gate-checked for currency ([ADR 0034](../_adr/0034-agents-md-untracked-currency-check.md)): `status` and `done` recompile in memory and compare to disk, so a context that read mutable state would make the file perpetually "stale" and break the gate everywhere. A determinism test and the currency test guard this.
>
> The classic trap: use `config.repository.trunk` (committed), **never** the `DISCERN_MAIN_BRANCH` env override (applied at runtime in the worktree/git layer).

**To add a variable or predicate:** add it to `guidanceContext`, deriving it solely from the loaded config, then use it in a section. Add one only when a template uses it.

## Strictness

The context is a closed set, so a typo fails loudly rather than shipping blank. An unknown `{{var}}` or `{{#if pred}}` throws `GuidanceTemplateError` anywhere in the template, including a branch that will not be taken. A malformed or unbalanced tag does the same. Validation walks every branch before producing output, so a bad name cannot lurk in a branch selected by only some projects.

## Boundary: discern's own shipped content

Only content discern ships is templated: the built-in sections and bundled-skill markdown. The user's `[guidance].sources` are appended **verbatim**, and authored skills are symlinked untouched. A project's own markdown may legitimately contain `{{…}}`; the renderer leaves it uninterpreted.

This engine is distinct from the scaffold templater ([`src/lib/template.ts`](../../../src/lib/template.ts)). That templater substitutes `{{token}}` in `.tmpl` _seed_ files at `setup` time over a different token set and leaves an unknown token verbatim; drift is reported without failing. The scaffold skips `templates/guidance/`, so the engines process disjoint file sets and can share the `{{}}` delimiter.

## See also

- The decision ([ADR 0035](../_adr/0035-guidance-templating-engine.md)).
- The currency check the config-only context preserves ([ADR 0034](../_adr/0034-agents-md-untracked-currency-check.md)).
