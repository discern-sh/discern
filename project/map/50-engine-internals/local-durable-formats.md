---
title: Local durable formats
description: Find the authority for versioned Git-admin records and apply the forward-version rule.
order: 35
aliases:
  - on-disk formats
  - Git-admin formats
  - forward version
  - newer discern record
---

# Local durable formats

_Every local document declares what version it is and what an older binary may do with newer bytes._

[`ON_DISK_FORMATS`](../../../src/shared/on_disk_formats.ts) is the sole inventory for versioned documents under discern's Git-admin namespace and for Proof notes. It joins storage placement to the current version, version field, reader, writers, and forward-version policy. Read the registry for the live members; do not maintain another table here.

The policy boundary distinguishes refusal from observation:

- `refuse` protects authority and effect-replay evidence. A reader that finds version N newer than its registered version stops the consuming or replacing operation, retains the bytes, and tells the operator to update discern.
- `observe` protects advisory caches and histories. The caller may continue without the record's contents, but the inspecting surface names the skew and no writer, expiry pass, pruning pass, or cleanup replaces the bytes.

Absence is not version 1. A record must carry its registered in-band version before its remaining schema is trusted. Compatibility for an older version exists only where a reader explicitly declares it. The Gate Proof has no reader for text without a version: a fresh strict gate replaces that cache, while a newer JSON marker remains untouched.

[`GIT_ADMIN_STATE`](../../../src/shared/git_admin_state.ts) remains the authority for path, sharing scope, kind, lifetime, bounds, and validation writes. The format registry covers every coordinate that contains a document. `UNVERSIONED_GIT_ADMIN_STATE` explains the remaining operating-system locks, secret capability key, live-process leases, generated command directory, and presence-only setup sentinel. Adding a coordinate without choosing one side fails [`on_disk_formats_test.ts`](../../../tests/on_disk_formats_test.ts).

The registry-level guard constructs a future-version carrier for every member and verifies classification and recovery wording. Store-specific tests own the stronger behavior: whether reads refuse or omit advisory data, and whether update, removal, expiry, recovery, and garbage collection preserve the exact bytes. The resource suite additionally proves the registered `intent` → `ready` transition and cleanup-before-retry boundary ([ADR 0367](../_adr/0367-worktree-local-state-records-intent-before-effects.md)).

## Changing a format

1. Change the member's version in [`on_disk_formats.ts`](../../../src/shared/on_disk_formats.ts); never add a writer-local version constant.
2. Decide whether older supported records migrate, refuse, or remain advisory. Missing-version fallback is not a migration.
3. Make every reader return a distinct newer-version outcome before validating the rest of the shape.
4. Prove that every write and cleanup path preserves a newer fixture byte-for-byte.
5. Update the public format reference when the record is user-inspectable, and record a compatibility-significant decision as an ADR.

The format registry inventories contracts. Each subsystem retains its own schema and atomic/recovery mechanics; the shared authority prevents them from inventing versions or forward-skew policy independently ([ADR 0368](../_adr/0368-local-durable-formats-declare-forward-skew.md)).
