---
title: Migration mechanics
description: How schema changes advance installed projects while preserving config validity and project-owned content.
order: 40
aliases:
  - migrations
  - schema migrations
  - migration internals
---

# Migrations

_The versioned steps that bring an installed project up to the current config._

The first public install is [schema version](../00-orientation/glossary.md#schema-version) 1, with an empty production migration registry. The runner is already in place for the first public `1 → 2` change ([ADR 0218](../_adr/0218-public-install-schema-starts-at-one.md)).

A [Migration](../00-orientation/glossary.md#migration) brings an install from schema `N` to `N+1`. `discern upgrade` reads `[meta].schema_version`, selects every pending step, validates the migrated config, reconciles discern-owned regions, and stamps the new number only after those checks pass ([ADR 0085](../_adr/0085-validate-migrations-before-schema-stamping.md)). A config stamped by a newer binary is refused and keeps its recorded version.

The package version follows releases. The install schema changes only when an installed project needs a migration, so most releases leave it at its current number.

## The contract for a migration

- **One version.** A step declares `from: N` and produces schema `N+1`. `isChainContiguous` requires one step for every version between 1 and `SCHEMA_VERSION`.
- **Idempotent.** Re-running a step against its output changes nothing. If an upgrade stops partway through, the recorded schema stays behind and a retry safely replays the pending set.
- **Clean-tree gated.** `upgrade` refuses a dirty Git worktree unless the owner passes `--allow-dirty`, keeping the edits recoverable ([ADR 0014](../_adr/0014-versioned-migration-system.md)).
- **Project-content preserving.** Config edits use `TomlEditor`, which keeps comments and surrounding layout. File renames carry the existing bytes to the new path.
- **Validated before stamping.** A step sometimes spans several files. The config must parse and satisfy the current typed schema before the version moves forward.

`MigrationContext` supplies the bounded operations a step needs: read, write, remove, recursive remove, rename, text rewrite, comment-preserving config edit, settings merge, and human-readable notes. The repository's write-surface test keeps that context among the enumerated write sites.

## Add the next schema

For the first public migration:

1. Capture an install produced at schema 1 before changing the template. This starts the public historical fixture corpus.
2. Raise `SCHEMA_VERSION` and the template stamp to 2.
3. Append one `from: 1` entry to `MIGRATIONS`. Keep the transform specific to the on-disk change.
4. Add focused tests for the transform and its second-run no-op. The chain guard enrolls the new step.
5. Exercise `upgrade --check`, `--dry-run`, apply, validation failure, and final stamping through the command seam.

Until that bump exists, the framework test proves the empty schema-1 chain and the generic runner. The upgrade test injects a synthetic next schema and migration registry, which keeps the command fold covered without publishing a transition.

## Where it lives in code

| Concern                                 | File                                                                      |
| --------------------------------------- | ------------------------------------------------------------------------- |
| Current install schema                  | [`version.ts`](../../../src/lib/version.ts)                               |
| Migration registry, runner, and context | [`migrations.ts`](../../../src/lib/migrations.ts)                         |
| Recorded-version reader and stamper     | [`schema.ts`](../../../src/lib/schema.ts)                                 |
| Upgrade validation and execution        | [`upgrade.ts`](../../../src/commands/upgrade.ts)                          |
| Framework invariants                    | [`migrations_test.ts`](../../../tests/migrations_test.ts)                 |
| Upgrade fold and synthetic next schema  | [`upgrade_migrations_test.ts`](../../../tests/upgrade_migrations_test.ts) |

## Current state and gotchas

`MIGRATIONS` is empty while `SCHEMA_VERSION` is 1. A config without `[meta].schema_version` resolves to schema 1. A recorded value above 1 is forward skew and the schema-1 binary refuses it.

The prerelease migrations remain visible in the decision records as project history. They are absent from the public compatibility path.

## See also

- [config-reference.md](../70-reference/config-reference.md) lists every section and key the migrated config must satisfy.
- The migration system's founding decision ([ADR 0014](../_adr/0014-versioned-migration-system.md)).
