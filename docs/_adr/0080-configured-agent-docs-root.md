# ADR 0080: The agent documentation tree has one configured root

**Status**: accepted; extends [ADR 0075](0075-setup-staged-handshake.md)
(setup's staged handshake) and [ADR 0026](0026-typed-config-schema.md) (the
typed config schema is the source of truth); the configured root's default
moves inside the `discern/` namespace by
[ADR 0099](0099-consolidate-authored-surface-under-discern-namespace.md), and
the tree's agent-first identity is formalized by
[ADR 0100](0100-doctree-is-the-agents-map.md).

## Context

discern's documentation tree describes what coding agents can infer from a
project's code. It is conceptually distinct from human-curated project
documentation, but every docs-aware surface assumed that both lived at `docs/`:
setup scaffolded there, `discern docs` browsed there, setup-state checks
inspected it, and the generated config's prose check, docs Scope, and prose
Ratchet named it literally.

ADR 0075 made `discern setup verify` detect an existing `docs/` tree and ask the
human where discern's tree belongs. The preflight could not act on the answer:
there was no persisted field, and choosing `docs/discern/` would leave the rest
of the Engine looking at `docs/`.

The quality-gate declarations make this more than an Installer flag. Writing a
chosen path into several generated strings would work initially, but a later
`discern config set docs.dir ...` would silently separate scaffolding and
browsing from checks, scope classification, and ratchets. The configured path
needs one live source.

## Decision

`[docs].dir` is the single source of truth for discern's agent documentation
tree. It defaults to `docs/`, is relative to the project root, and rejects
absolute paths and parent traversal. Setup writes the field into `discern.toml`,
scaffolds the tree there, and renders its authoring instructions with that path.
`discern docs`, setup-state checks, guidance, improvement rules, and bundled
documentation skills resolve the same field.

`discern setup verify` remains read-only, as ADR 0075 requires. When it finds a
pre-existing `docs/`, its consent checklist asks the human to choose a separate
project-relative location and funnels that choice to
`discern setup begin --docs "<path>"`. `begin` persists the value as
`[docs].dir` before laying the skeleton.

Config strings may contain the exact reference `${docs.dir}`. The Engine expands
it from the loaded config when it runs Capability and Check commands, Scope
paths and gates, and Ratchet commands and extent globs. The hand-authored config
template uses that reference for its prose check, docs Scope, and prose Ratchet,
so changing `[docs].dir` later keeps those declarations aligned without
rewriting them.

The explicit noes:

- **No merging or folding of human-written docs.** Existing project docs remain
  untouched; this decision only gives discern's separate tree a chosen home.
- **No state written by `setup verify`.** The read-only-to-mutating boundary
  remains `verify | begin`.
- **No absolute or parent-traversing docs roots.** The tree remains inside the
  project, where root-relative scope and glob semantics are defined.
- **No schema migration solely for this field.** The default preserves existing
  projects, while strict config loading supplies `docs/` when the section is
  absent.

## Consequences

An established project can keep its human documentation at `docs/`, place
discern's tree at a location such as `docs/discern/`, and have setup, browsing,
guidance, setup completion, improvement advice, Scope classification, prose
linting, and prose Ratchets agree on that location.

The config template gains a small interpolation language shared by several
Engine surfaces. Expansion is deliberately limited to one exact reference, kept
in one helper, and covered across every supported declaration type. Other config
paths do not become general-purpose variables.

Skeleton sources still live under `templates/**/skeleton/docs/`; that path is
the binary's internal packaging layout, not the destination in an installed
project. Setup and the Skills copy from it into the configured root.

## Alternatives considered

**Render the chosen path directly into every generated command and glob.**
Rejected because `[docs].dir` is editable after setup. Duplicated literal paths
would drift unless every config edit also rewrote unrelated user-owned fields.

**Make `discern docs --dir` the only override.** Rejected because it fixes
browsing alone; scaffolding, setup proof, Scopes, checks, and Ratchets would
still disagree.

**Allow any filesystem path.** Rejected because Scopes and Ratchet extents are
project-relative, and setup's ownership promise is limited to the project.
