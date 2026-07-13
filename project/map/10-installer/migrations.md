# Migrations

_The versioned chain that evolves an install's shape, one idempotent step at a
time._

A [Migration](../00-orientation/glossary.md#migration) brings an install from
[Schema version](../00-orientation/glossary.md#schema-version) `N` to `N+1`. The
chain lives in [`src/lib/migrations.ts`](../../../src/lib/migrations.ts); the
current schema number and the one-line history of every step live in
[`src/lib/version.ts`](../../../src/lib/version.ts). `discern upgrade` reads
`[meta].schema_version`, runs every pending step in order, **validates the
migrated config against the typed schema before stamping** the new number
([ADR 0085](../_adr/0085-validate-migrations-before-schema-stamping.md)), and
refuses a config stamped by a newer binary rather than silently downgrading it.

## The contract each step signs

- **Idempotent.** A step re-run against its own output changes nothing —
  `upgrade` after a crash or a partial revert converges instead of compounding.
- **Clean-tree gated.** The migration runner refuses a dirty tree without
  `--allow-dirty` ([ADR 0014](../_adr/0014-versioned-migration-system.md)), so
  every upgrade is revertible with `git checkout`.
- **Comment-preserving.** Config edits go through the
  [`TomlEditor`](../../../src/lib/toml_edit.ts), so a user's comments and layout
  survive.
- **Write-surface bound.** Steps mutate files through the `MigrationContext`
  helpers (write / remove / rename / rewrite / config-edit / settings-merge),
  whose targets are the registry's legacy and default paths plus the config and
  settings shims — inside the
  [write-surface contract](../80-development/install-surface.md#the-write-surface-contract)
  like every other verb.

## Reading the chain

The full step history is the doc comment on `SCHEMA_VERSION` in
[`version.ts`](../../../src/lib/version.ts) — the single home of both the number
and its story. Two recent steps show the range of what a step can do:

- **`14 → 15`** consolidates the authored surface under the visible `discern/`
  [Namespace](../00-orientation/glossary.md#namespace): each source whose config
  key still pointed at its pre-namespace default (the guidance seed, the map,
  authored skills, the then-named Recipes, the ledger, the brief) moves from its
  `legacyPath` to its `defaultPath` — both read from the
  [paths registry](../../../src/shared/paths_registry.ts), so the step
  enumerates no path of its own — while a user-pointed path is left alone
  ([ADR 0099](../_adr/0099-consolidate-authored-surface-under-discern-namespace.md)).
- **`15 → 16`** retires the `[features]` table and the duplicate
  `[worktree].enabled` key, noting any non-default value it discards
  ([ADR 0101](../_adr/0101-retire-the-features-toggles.md)).

A schema bump is **rare by design**: it happens only when an installed project
needs a change to stay correct, so most releases leave the number untouched.
Coverage for the chain lives in
[`tests/upgrade_migrations_test.ts`](../../../tests/upgrade_migrations_test.ts)
and its convergence sibling — each step is exercised against a scaffolded legacy
layout, then re-run to prove the no-op.

## See also

- [config-reference.md](config-reference.md) — every section and key the
  migrated config must validate against.
- [ADR 0014](../_adr/0014-versioned-migration-system.md) — the migration
  system's founding decision.
