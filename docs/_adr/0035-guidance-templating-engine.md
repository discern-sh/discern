# ADR 0035: A strict, config-only template engine for the built-in guidance

**Status**: accepted; builds on
[ADR 0034](0034-agents-md-untracked-currency-check.md) (the generated agent
files are untracked and gate-checked for currency) and the compile model of
[ADR 0026](0026-typed-config-schema.md) (one typed config as the single source).

## Context

`discern refresh` compiles each provider's agent file from
`[built-in base] + [a
section per enabled feature] + [your sources]`
(`guidance_render.ts`). The built-in sections (`templates/guidance/*.md`) are
the **distribution surface** — every project, in every language and domain,
receives them verbatim. That gave two problems the research on effective
agent-instruction files
([`docs/_maintainer/agent-instruction-files-research.md`](../_maintainer/agent-instruction-files-research.md))
flags directly:

- **Generic prose can't be concrete.** The shipped text could only refer to "the
  integration branch" or "`[project].branch_prefix`" in the abstract, where the
  evidence rewards naming the project's _actual_ branch and commands.
- **Inert sections still cost tokens.** A project with the `ratchets` feature on
  but **no** ratchet declared, or the worktree workflow on but **no** resources,
  still received the full ratchet / resource-lifecycle prose — "Context Bloat,"
  the #2 catalogued smell: guidance that doesn't apply, diluting the signal.

A feature toggle (`BUILTIN_SECTIONS`) already drops a whole section when its
_feature_ is off, but that is too coarse: the feature can be on while the thing
it describes is unconfigured.

The binding constraint is ADR 0034's currency invariant. The generated files are
untracked and **gate-checked**: `discern status` / `discern finish` recompile
them in memory via `renderAgentFiles` and compare byte-for-byte to disk; a
mismatch fails the gate. So any per-project rendering must be a **pure function
of committed configuration** — if it read the current branch, the clock, an env
var, or any per-worktree/gitignored file, the file would be perpetually "stale"
and break the gate on every machine.

## Decision

Add a **tiny, dependency-free template engine**
(`src/engine/guidance_template.ts`) and render each **built-in** section through
it before concatenation.

- **Syntax, deliberately minimal:** `{{var}}` substitution and
  `{{#if pred}}…{{/if}}` / `{{#if pred}}…{{else}}…{{/if}}` conditionals.
  Variables work inside blocks; blocks may nest. No loops, no expressions, no
  object lookups, no library.
- **Strict:** the context is a closed, curated set. An unknown variable or
  predicate — anywhere in the template, **including an unreachable branch** —
  and any malformed or unbalanced tag throw `GuidanceTemplateError`. A typo in a
  built-in template fails the compile loudly instead of silently shipping a
  blank.
- **Context is a pure function of committed config.** `guidanceContext(config)`
  in `guidance_render.ts` is the only mapping; it reads nothing that varies
  between two runs on the same commit. In particular `main_branch` is the
  committed `[project].main_branch`, **never** the `MAIN_BRANCH` env override
  (that runtime override lives in the worktree/git layer, not in the loaded
  config). The starting set is two variables — `branch_prefix`, `main_branch` —
  and two predicates — `has_ratchets`, `has_worktree_resources`. A name is added
  only when a template uses it.
- **Built-in sections only.** The user's `[guidance].sources` are appended
  verbatim and never templated — their markdown may legitimately contain
  `{{…}}`.
- **One render path.** Templating happens inside `builtinGuidance()`, so the
  writer (`compileGuidelines`) and the currency checker (`checkGuidanceCurrent`)
  get identical bytes through the same `renderAgentFiles` — the check stays
  authoritative by construction (ADR 0034). A section a conditional collapses to
  empty contributes nothing (no stray blank line, no empty heading).

This is **not** the scaffold templater (`src/lib/template.ts`): that substitutes
`{{token}}` in `.tmpl` _seed_ files at `init` time, over a different token set,
and leaves an unknown token verbatim (drift is reported, not fatal). The two
never process the same files — the scaffold skips `templates/guidance/` — so the
shared `{{}}` delimiter never collides.

## Consequences

- **The shipped guidance is concrete and lean.** Generic prose now names the
  project's real branch prefix and integration branch, and config-gated sections
  (ratchets, worktree resources) appear only when the project actually uses them
  — directly countering Context Bloat.
- **The currency invariant is preserved, and load-bearing.** Because the context
  is config-only, two recompiles on one commit are byte-identical, so the gate
  stays green. This is now a rule future maintainers must hold: **every new
  variable or predicate must derive solely from committed `discern.toml`** —
  adding one that reads git/env/clock/per-worktree state would silently break
  the gate for every consuming project. A determinism test and the currency test
  guard it.
- **Template mistakes fail fast.** Whole-tree strict validation means a typo'd
  `{{var}}` or `{{#if}}` can't lurk in a branch that only some project's config
  takes — it fails the first compile in any project.
- **A second `{{}}` dialect exists in the tree.** It is intentionally separate
  from the scaffold templater (different files, time, strictness, and
  conditional support); both modules document the boundary so the two are not
  conflated.
- **The engine stays small by contract.** Keeping it free of loops/expressions
  and the context minimal is deliberate — it is a guidance renderer, not a
  general template language.

## Alternatives considered

- **Reuse the scaffold templater (`src/lib/template.ts`).** Rejected: it has no
  conditionals and the opposite strictness (unknown token → verbatim + drift
  report, not an error), and coupling guidance rendering to the install-time
  token contract would conflate two unrelated responsibilities.
- **Suppress inert sections with more feature flags instead of predicates.**
  Rejected: "feature on but nothing declared" is exactly the case a coarse
  feature flag can't express; the predicate reads the actual config (`ratchets`,
  `worktree.resources`).
- **A real template library.** Rejected: a new dependency and far more surface
  than a few dozen lines need, against the "as short as it can be" guidance and
  the repo's single-binary discipline.
