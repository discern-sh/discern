---
title: Instruction template engine
description: The strict config-only renderer for bundled instructions and bundled-skill Markdown.
order: 50
aliases:
  - instructions templates
  - template engine
---

# The instructions templating engine

_How discern renders its built-in instruction sections and bundled skills against a project's config before compilation or materialization._

discern's built-in sections ([`templates/instructions/*.md`](../../../templates/instructions/)) are the distribution source carried by every binary. `discern refresh` renders each built-in section through a small, strict template engine ([`src/engine/instruction_template.ts`](../../../src/engine/instruction_template.ts)) before concatenating them. Rendering lets the generic prose name a project's configured paths and branches and omit content that is inert until configured. The decision and its rationale are recorded in [ADR 0035](../_adr/0035-guidance-templating-engine.md). This page is the working reference.

The same engine renders bundled skill Markdown at materialization and at `skills eject`. It uses the same context, so a shipped skill's prose names the project's configured paths through `{{map_dir}}` and `{{todo_path}}` instead of discern's defaults ([ADR 0102](../_adr/0102-paths-registry-and-rendered-artifacts.md)). A sentinel-render test and a source-literal ban make any hard-coded default a gate failure.

## Syntax

The syntax supports substitutions and conditional blocks. It has no loops, expressions, or library.

| Form                            | Effect                                     |
| ------------------------------- | ------------------------------------------ |
| `{{var}}`                       | Substitute a string variable.              |
| `{{#if pred}}…{{/if}}`          | Include the body only when `pred` is true. |
| `{{#if pred}}…{{else}}…{{/if}}` | Include one branch or the other.           |

Variables work inside `{{#if}}` blocks, and `{{#if}}` may nest. Tag names are lowercase snake_case; whitespace inside the braces is ignored (`{{ var }}` == `{{var}}`).

## The context: committed config only

Every variable and predicate is built by `instructionContext(config)` in [`instruction_render.ts`](../../../src/engine/instruction_render.ts), a pure function of committed `discern.toml`:

The context supplies configured paths, branch names, and predicates for relevant instructions. The worktree instructions name `[gate].concurrent_test_runs` when positive; zero removes the queue instruction. Compiled instructions describe the limit. Progress messages observe current capacity use at runtime.

> **Invariant.** The context reads only values that stay constant between 2 runs on the same commit. It excludes Git branch and status, environment variables, the clock, randomness, absolute paths, and ignored or per-worktree files. The Gate checks agent-file currency ([ADR 0034](../_adr/0034-agents-md-untracked-currency-check.md)): `status` and `done` recompile in memory and compare to disk. Reading mutable state would make the file perpetually `stale` and fail the Gate. A determinism test and the currency test enforce this boundary.
>
> Use the committed `config.repository.trunk`. The worktree and Git layer apply the `DISCERN_TRUNK` environment override only at runtime.

**To add a variable or predicate:** add it to `instructionContext`, deriving it solely from the loaded config, then use it in a section. Add one only when a template uses it.

## Strictness

The context is a closed set. An unknown `{{var}}` or `{{#if pred}}` throws `InstructionTemplateError` anywhere in the template, including a branch that will not be taken. A malformed or unbalanced tag does the same. Validation walks every branch before producing output, so an invalid name fails even when only some projects would select its branch.

## Boundary: discern's own shipped content

discern applies templates only to content it ships: the built-in sections and bundled skill Markdown. It appends the user's `[instructions].sources` verbatim and symlinks authored skills without changing them. A project's own Markdown may contain `{{…}}`; the renderer leaves it uninterpreted.

The scaffold templater ([`src/lib/template.ts`](../../../src/lib/template.ts)) has a separate token set and behavior. At `setup` time, it substitutes `{{token}}` in `.tmpl` seed files and leaves an unknown token verbatim. It reports drift without failing. The scaffold skips `templates/instructions/`, so the engines process disjoint file sets and can share the `{{}}` delimiter.

## See also

- The decision ([ADR 0035](../_adr/0035-guidance-templating-engine.md)).
- The currency check the config-only context preserves ([ADR 0034](../_adr/0034-agents-md-untracked-currency-check.md)).
