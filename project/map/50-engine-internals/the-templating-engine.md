---
title: Guidance template engine
description: The strict config-only renderer for bundled guidance and bundled-skill Markdown.
order: 50
aliases:
  - guidance templates
  - template engine
---

# The guidance templating engine

_How discern renders its built-in guidance sections and bundled Skills against a project's config before compilation or materialization._

discern's built-in sections ([`templates/guidance/*.md`](../../../templates/guidance/)) are the distribution source carried by every binary. `discern refresh` renders each built-in section through a small, strict template engine ([`src/engine/guidance_template.ts`](../../../src/engine/guidance_template.ts)) before concatenating them. Rendering lets the generic prose name a project's configured paths and branches and omit content that is inert until configured. The decision and its rationale are recorded in [ADR 0035](../_adr/0035-guidance-templating-engine.md). This page is the working reference.

The same engine renders bundled Skill Markdown at materialization and at `skills eject`. It uses the same context, so a shipped Skill's prose names the project's configured paths through `{{map_dir}}` and `{{todo_path}}` instead of discern's defaults ([ADR 0102](../_adr/0102-paths-registry-and-rendered-artifacts.md)). A sentinel-render test and a source-literal ban make any hard-coded default a Gate failure.

## Syntax

The syntax supports substitutions and conditional blocks. It has no loops, expressions, or library.

| Form                            | Effect                                     |
| ------------------------------- | ------------------------------------------ |
| `{{var}}`                       | Substitute a string variable.              |
| `{{#if pred}}…{{/if}}`          | Include the body only when `pred` is true. |
| `{{#if pred}}…{{else}}…{{/if}}` | Include one branch or the other.           |

Variables work inside `{{#if}}` blocks, and `{{#if}}` may nest. Tag names are lowercase snake_case; whitespace inside the braces is ignored (`{{ var }}` == `{{var}}`).

## The context: committed config only

Every variable and predicate is built by `guidanceContext(config)` in [`guidance_render.ts`](../../../src/engine/guidance_render.ts), a pure function of committed `discern.toml`:

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

> **Invariant.** The context reads only values that stay constant between 2 runs on the same commit. It excludes Git branch and status, environment variables, the clock, randomness, absolute paths, and ignored or per-worktree files. The Gate checks agent-file currency ([ADR 0034](../_adr/0034-agents-md-untracked-currency-check.md)): `status` and `done` recompile in memory and compare to disk. Reading mutable state would make the file perpetually `stale` and fail the Gate. A determinism test and the currency test enforce this boundary.
>
> Use the committed `config.repository.trunk`. The worktree and Git layer apply the `DISCERN_TRUNK` environment override only at runtime.

**To add a variable or predicate:** add it to `guidanceContext`, deriving it solely from the loaded config, then use it in a section. Add one only when a template uses it.

## Strictness

The context is a closed set. An unknown `{{var}}` or `{{#if pred}}` throws `GuidanceTemplateError` anywhere in the template, including a branch that will not be taken. A malformed or unbalanced tag does the same. Validation walks every branch before producing output, so an invalid name fails even when only some projects would select its branch.

## Boundary: discern's own shipped content

discern applies templates only to content it ships: the built-in sections and bundled Skill Markdown. It appends the user's `[guidance].sources` verbatim and symlinks authored Skills without changing them. A project's own Markdown may contain `{{…}}`; the renderer leaves it uninterpreted.

The scaffold templater ([`src/lib/template.ts`](../../../src/lib/template.ts)) has a separate token set and behavior. At `setup` time, it substitutes `{{token}}` in `.tmpl` seed files and leaves an unknown token verbatim. It reports drift without failing. The scaffold skips `templates/guidance/`, so the engines process disjoint file sets and can share the `{{}}` delimiter.

## See also

- The decision ([ADR 0035](../_adr/0035-guidance-templating-engine.md)).
- The currency check the config-only context preserves ([ADR 0034](../_adr/0034-agents-md-untracked-currency-check.md)).
