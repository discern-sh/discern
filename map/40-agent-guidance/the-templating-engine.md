# The guidance templating engine

_How discern's **built-in** guidance sections and **bundled** skills are
rendered against a project's config before they are compiled or materialized._

discern's built-in sections
([`templates/guidance/*.md`](../../templates/guidance/)) are the distribution
surface — every project receives them verbatim. To let that generic prose name a
project's _real_ branch and drop content that is inert until configured,
`discern refresh` renders each built-in section through a small, strict template
engine
([`src/engine/guidance_template.ts`](../../src/engine/guidance_template.ts))
before concatenating them. The decision and its rationale are
[ADR 0035](../_adr/0035-guidance-templating-engine.md); this page is the working
reference.

The same engine renders **bundled-skill markdown** at materialization (and at
`skills eject`), against the same context, so a shipped skill's prose names the
project's configured paths — `{{map_dir}}`, `{{todo_path}}` — never discern's
defaults ([ADR 0102](../_adr/0102-paths-registry-and-rendered-artifacts.md)). A
sentinel-render test and a source-literal ban keep any hard-coded default a gate
failure.

## Syntax

Deliberately minimal — no loops, no expressions, no library:

| Form                            | Effect                                     |
| ------------------------------- | ------------------------------------------ |
| `{{var}}`                       | Substitute a string variable.              |
| `{{#if pred}}…{{/if}}`          | Include the body only when `pred` is true. |
| `{{#if pred}}…{{else}}…{{/if}}` | Include one branch or the other.           |

Variables work inside `{{#if}}` blocks, and `{{#if}}` may nest. Tag names are
lowercase snake_case; whitespace inside the braces is ignored (`{{ var }}` ==
`{{var}}`).

## The context — committed config only

Every variable and predicate is built by `guidanceContext(config)` in
[`guidance_render.ts`](../../src/engine/guidance_render.ts), a **pure function
of committed `discern.toml`**:

| Kind      | Name                     | Source                                    |
| --------- | ------------------------ | ----------------------------------------- |
| variable  | `branch_prefix`          | `[project].branch_prefix`                 |
| variable  | `main_branch`            | `[project].main_branch` (committed value) |
| predicate | `has_standards`          | any `[standards.*]` declared              |
| predicate | `has_worktree_resources` | any `[worktree.resources.*]` declared     |

> **Invariant (load-bearing).** The context must read **nothing that varies
> between two runs on the same commit** — no git branch/status, env var, clock,
> randomness, absolute path, or ignored/per-worktree file. The generated agent
> files are gate-checked for currency
> ([ADR 0034](../_adr/0034-agents-md-untracked-currency-check.md)): `status` and
> `done` recompile in memory and compare to disk, so a context that read mutable
> state would make the file perpetually "stale" and break the gate everywhere. A
> determinism test and the currency test guard this.
>
> The classic trap: use `config.project.main_branch` (committed), **never** the
> `DISCERN_MAIN_BRANCH` env override (applied at runtime in the worktree/git
> layer).

**To add a variable or predicate:** add it to `guidanceContext`, deriving it
solely from the loaded config, then use it in a section. Add one only when a
template uses it.

## Strictness

The context is a closed set, so a typo fails loudly rather than shipping blank:
an unknown `{{var}}` or `{{#if pred}}` — **anywhere in the template, including a
branch that won't be taken** — throws `GuidanceTemplateError`, as does a
malformed or unbalanced tag. Validation walks the whole tree before any output,
so a bad name can't lurk in a branch only some project's config takes.

## Boundary — discern's own shipped surfaces only

Only content discern ships is templated: the built-in sections and bundled-skill
markdown. The user's `[guidance].sources` are appended **verbatim**, and
authored skills are symlinked untouched — a project's own markdown may
legitimately contain `{{…}}` and is never interpreted.

This engine is also distinct from the scaffold templater
([`src/lib/template.ts`](../../src/lib/template.ts)), which substitutes
`{{token}}` in `.tmpl` _seed_ files at `setup` time, over a different token set,
and leaves an unknown token verbatim (drift is reported, not fatal). The two
never process the same files (the scaffold skips `templates/guidance/`), so the
shared `{{}}` delimiter never collides.

## See also

- [ADR 0035](../_adr/0035-guidance-templating-engine.md) — the decision.
- [ADR 0034](../_adr/0034-agents-md-untracked-currency-check.md) — the currency
  check the config-only context preserves.
