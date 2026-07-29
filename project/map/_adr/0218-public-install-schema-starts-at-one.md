# ADR 0218: The public install schema starts at 1

**Status**: accepted; applies the clean public baseline from [ADR 0014](0014-versioned-migration-system.md) before the first release tag.

## Context

Private development took the install schema through 23 transitions, ending at schema 24. Those migrations carried discern's own prerelease installs across changes to command names, config tables, file locations, and the installer footprint. The repository remains private and no release tag exists, so no public install has received any of those schema numbers as a compatibility promise.

Publishing schema 24 would make the private transition chain part of the supported product. The binary would retain thousands of lines of transforms, historical fixtures, old config discovery, and path metadata for layouts a public release never produced. Starting at schema 1 requires a coordinated version reset for the current private installs, but that cost is bounded before publication.

The migration mechanism remains necessary. Public releases need a monotonic schema version independent of the package version, an idempotent step runner, validation before stamping, and forward-skew refusal.

## Decision

The first public install schema is 1.

- `SCHEMA_VERSION`, the shipped template, and discern's own config record 1.
- The production `MIGRATIONS` registry starts empty. The prerelease transforms and their historical fixture corpus are deleted.
- Root `discern.toml` is the only install marker. Prerelease `.discern/config.toml` and manifest discovery are removed, along with migration-only `legacyPath` metadata in the paths registry.
- The runner, `MigrationContext`, validation boundary, and contiguous-chain guard remain. Synthetic tests inject a target schema and registry so the first public `1 → 2` path is covered before a production bump exists.
- Current private installs reset `[meta].schema_version` from 24 to 1 after this change lands. The config bytes already match the public schema, so no transform runs.
- The first public schema change appends `1 → 2`. Its test work begins by capturing a schema-1 install before the template changes, creating the public historical corpus from its true starting point.

Package version and install schema remain independent. Most releases change the package version and leave the install schema untouched.

## Consequences

The first public binary carries no compatibility code for unreleased layouts. The migration chain and fixture history describe only versions users could have installed.

A prerelease config stamped 24 is newer than the schema-1 binary and is refused until its recorded version becomes 1. The operation must be coordinated: a schema-24 binary sees that config as old and runs the deleted private chain forward again. Private consumers therefore reset the value only after discern's schema-1 change lands, then use the schema-1 binary.

The old migration ADRs remain as project history. They explain how private development reached the released config, without promising those transitions as supported upgrade paths.

## Alternatives considered

**Retain schema 24 and the private chain.** This avoids resetting the private consumers. It also publishes every prerelease layout as a permanent compatibility commitment and keeps the associated code, fixtures, discovery paths, and metadata in the first release.

**Map prerelease schema 24 to public schema 1 in the binary.** This avoids the coordinated version reset. It introduces a permanent downward-version exception into a monotonic migration model and keeps private history in the public reader.
