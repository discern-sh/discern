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

The first public install is [schema version](../00-orientation/glossary.md#schema-version) 1, with an empty production migration registry. The runner is already in place for the first public `1 → 2` change ([ADR 0219](../_adr/0219-public-install-schema-starts-at-one.md)).

A versioned step that brings an install from schema `N` to `N+1` is a [migration](../00-orientation/glossary.md#migration). `discern upgrade` reads `[meta].schema_version`, selects every pending step, validates the migrated config, reconciles discern-owned regions, and stamps the new number only after those checks pass ([ADR 0085](../_adr/0085-validate-migrations-before-schema-stamping.md)). `discern upgrade` refuses a config stamped by a newer binary and preserves its recorded version.

The package version follows releases. The install schema changes only when an installed project needs a migration, so most releases leave it at its current number.

## The contract for a migration

- **One version.** A step declares `from: N` and produces schema `N+1`. `isChainContiguous` requires one step for every version between 1 and `SCHEMA_VERSION`.
- **Idempotent.** Re-running a step against its output changes nothing. If an upgrade stops partway through, the recorded schema stays behind and a retry replays the pending set without changing completed output.
- **Clean-tree gated.** `upgrade` refuses a dirty Git worktree unless the owner passes `--allow-dirty`, keeping the edits recoverable ([ADR 0014](../_adr/0014-versioned-migration-system.md)).
- **Project-content preserving.** Config edits use `TomlEditor`, which keeps comments and surrounding layout. File renames carry the existing bytes to the new path.
- **Validated before stamping.** A step sometimes spans several files. The config must parse and satisfy the current typed schema before the version moves forward.

`MigrationContext` supplies the bounded operations a step needs: read, write, remove, recursive remove, rename, text rewrite, comment-preserving config edit, settings merge, and human-readable notes. The repository's write-surface test keeps that context among the enumerated write sites.

## Add the next schema

The [install corpus](../../../tests/fixtures/installs/README.md) holds one captured `discern setup begin` installation per past schema, starting with the schema-1 release candidate. For the next schema change:

1. Capture the current schema before changing the template: run the capture command from the corpus README on a clean checkout. It writes `tests/fixtures/installs/schema-<N>/` as an archive beside a plaintext manifest and refuses to overwrite a captured schema.
2. Raise `SCHEMA_VERSION` and the template stamp to N+1. The ceiling guard fails while the newest captured schema is more than one behind.
3. Append one `from: N` entry to `MIGRATIONS`. Keep the transform specific to the on-disk change.
4. Add focused tests for the transform and its second-run no-op. The chain guard enrolls the new step.
5. Exercise `upgrade --check`, `--dry-run`, apply, validation failure, and final stamping through the command seam.
6. Keep the convergence test green: every captured installation, upgraded through the chain, must match a fresh installation in everything discern maintains. Generated and Shared artifacts compare byte for byte, `discern.toml` compares its managed projection, and project-owned seeds compare by presence.

Until that bump exists, the framework test proves the empty schema-1 chain and the generic runner. The upgrade test injects a synthetic next schema and migration registry, which keeps the command fold covered without publishing a transition.

## Where it lives in code

| Concern                                 | File                                                                        |
| --------------------------------------- | --------------------------------------------------------------------------- |
| Current install schema                  | [`version.ts`](../../../src/lib/version.ts)                                 |
| Migration registry, runner, and context | [`migrations.ts`](../../../src/lib/migrations.ts)                           |
| Recorded-version reader and stamper     | [`schema.ts`](../../../src/lib/schema.ts)                                   |
| Upgrade validation and execution        | [`upgrade.ts`](../../../src/commands/upgrade.ts)                            |
| Framework invariants                    | [`migrations_test.ts`](../../../tests/migrations_test.ts)                   |
| Upgrade fold and synthetic next schema  | [`upgrade_migrations_test.ts`](../../../tests/upgrade_migrations_test.ts)   |
| Captured installations per past schema  | [`tests/fixtures/installs/`](../../../tests/fixtures/installs/README.md)    |
| Capture command                         | [`capture_install_fixture.ts`](../../../scripts/capture_install_fixture.ts) |
| Convergence, frozen bytes, and ceiling  | [`install_corpus_test.ts`](../../../tests/install_corpus_test.ts)           |

## Current state and gotchas

`MIGRATIONS` is empty while `SCHEMA_VERSION` is 1. The schema-1 fixture was captured from the release candidate, so the first public migration starts from the bytes a fresh installation received. `discern upgrade` refuses a config whose `[meta].schema_version` is missing or invalid and points to `discern setup begin`, which stamps the current value only while setup is incomplete. A recorded value above 1 comes from a newer schema, a condition called forward skew. The schema-1 binary refuses that config.

The prerelease migrations remain visible in the decision records as project history. They are absent from the public compatibility path.

## See also

- [The manual's config reference](https://discern.sh/docs/reference/config-reference) lists every section and key the migrated config must satisfy.
- The migration system's founding decision ([ADR 0014](../_adr/0014-versioned-migration-system.md)).
