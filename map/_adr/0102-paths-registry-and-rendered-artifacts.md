# ADR 0102: One paths registry, rendered artifacts, and leakage guards

> **Vocabulary amendment ([ADR 0120](0120-launch-verb-canon.md)):** Current
> pointers use `docs` → `map` where it names the command, config, or tree; the
> decision and reasoning are unchanged.

**Status**: accepted; builds on
[ADR 0099](0099-consolidate-authored-surface-under-discern-namespace.md);
extends [ADR 0026](0026-typed-config-schema.md) (the schema stays the config
authority; path defaults gain their own registry beneath it) and
[ADR 0051](0051-canonical-set-parity.md) (whose guard pattern this applies to
paths)

## Context

[ADR 0099](0099-consolidate-authored-surface-under-discern-namespace.md) makes
every source path a prescriptive default with a config escape hatch. That
promotes path literals from a style issue to a correctness class: any default
hard-coded outside the one authoritative place is a latent bug that surfaces
only in a project pointed away from the defaults — precisely the configuration
this repo itself runs.

Current reality, mapped before this decision:

- Defaults are scattered: most live as Zod `.default()` literals in
  `config_schema.ts`, the docs default in its own `docs_path.ts` module, while
  `TODO.md` and `brief.md` are hard-coded strings in the setup and plan code
  with no config key at all.
- The built-in guidance already renders paths correctly: a strict template
  engine (`{{docs_dir}}`, compile-time validation of every variable) plus a
  parity test asserting every context variable flows from config. This is the
  pattern to extend, not invent.
- Bundled skills do **not** render: materialization copies them verbatim, and
  their prose carries real literals (`guidance.md`, root-relative `TODO.md`
  links) alongside informal `<docs-dir>` placeholders.
- The shipped `.gitignore` fragment hard-codes a docs path in its comment.
- The known failure mode is agents working _on_ discern hard-coding the layout
  they can see in this repo, with no regard for what a user may have configured.
  That is a class of defect, and classes get structural guards
  ([ADR 0051](0051-canonical-set-parity.md)).

## Decision

- **One paths registry.** A single module defines every configurable source
  path: its config key, its default, and its description. The Zod schema's path
  defaults derive from it; the resolver helpers read through it; setup's
  seeding, the migration, codegen, and every guard below enumerate from it.
  Adding a path means adding one registry entry — every satellite either
  auto-enrols or fails the gate. The ledger and the brief become
  registry-backed: the ledger gains a config key (`[project].todo`); the brief
  stays at its namespace default without a dedicated key until a real need
  appears (it is setup-time input, not an ongoing convention).
- **Bundled artifacts render, never quote, paths.** Skill materialization passes
  bundled markdown through the same strict template engine the guidance compiler
  uses, with one shared variable context built from resolved config. The
  literals in bundled skills become variables; the informal `<docs-dir>`
  placeholders normalize to the same syntax. Authored (user) skills stay
  symlinked and untouched — their paths are their business. The skills currency
  check compares _rendered_ trees, so a path reconfiguration makes materialized
  skills stale until `refresh` — the same contract guidance already has. The
  `.gitignore` fragment's comment drops its hard-coded docs path for a
  config-independent pointer.
- **The leakage guard battery**, strongest first:
  1. **Sentinel-render test.** Compile the guidance and materialize every
     bundled skill against a sentinel config (each path pointed at an obviously
     fake location), then assert no registry default survives in any rendered
     output. The literal list is derived from the registry, so a new path
     auto-enrols.
  2. **Parameterized engine run.** A representative slice of the scaffolded
     engine suite runs against a fully non-default paths config — behavioral
     parity under reconfiguration, the guard no grep can fake.
  3. **Source-literal ban.** An architectural test over `src/**` fails on any
     registry default appearing as a string literal outside the registry module
     itself.
  4. **Write-surface test.** The write-surface contract of
     [ADR 0099](0099-consolidate-authored-surface-under-discern-namespace.md),
     enforced: every project-tree write site must target a registry path, a
     provider-registry path, or an enumerated shim.
  5. **Dogfooding on non-defaults.** This repo permanently points `[map].dir` at
     root `map/`, so any hard-coded new default diverges from the repo agents
     can see — leaks become loud.

## Consequences

- The registry is a new closed set in the ADR 0051 family: satellites (schema,
  resolvers, seeding, migration, codegen, sentinel list, write surface) are tied
  to it by tests, and a hand-copied path list anywhere is a gate failure.
- Bundled-skill authors (including future agents editing `templates/skills/`)
  must write `{{docs_dir}}`-style variables; the strict engine makes a stray or
  misspelled token a loud materialization failure, and prose must avoid literal
  `{{` outside a token (audit at conversion; add an escape only if a real case
  appears).
- Currency checks become config-sensitive by construction — moving a path key
  without `refresh` fails the gate instead of leaving stale instructions live.
- Two files currently duplicate a suggested-docs-path constant; the registry
  absorbs that fact.

## Alternatives considered

- **Runtime indirection instead of rendering** (skills tell agents to run
  `discern config get docs.dir`). Rejected as the default: it survives
  reconfiguration without a refresh, but costs a tool call per use and makes
  every skill read like plumbing; recipes already use it where live resolution
  is the point.
- **No registry — fix the literals in place.** Rejected: that is the current
  scatter, and it regrows; without one source to enumerate from, the sentinel
  and write-surface guards would run off hand-copied lists, the exact defect
  they exist to catch.
- **Freeze the defaults (drop the config keys) so literals are harmless.**
  Rejected: pointing is the consent model
  ([ADR 0099](0099-consolidate-authored-surface-under-discern-namespace.md)) and
  the brownfield story; correctness-by-rigidity is the wrong trade.
