---
title: Compatibility policy
description: Where the public compatibility policy lives, which comparators and tests enforce it, and how members become evolving.
order: 45
publish: true
aliases:
  - compatibility policy
  - PUBLIC_SCHEMA_PUBLICATIONS
  - evolving members
  - open vocabularies
  - closed vocabularies
  - release baseline
  - compatibility guard
---

# Compatibility policy

_The mechanism behind the public compatibility promise: the publication registry, the per-policy comparators, the baseline selection, and the guard that enforces them. The promise itself is the manual's [compatibility page](https://discern.sh/docs/reference/compatibility); the reasoning is [ADR 0409](../_adr/0409-public-contracts-split-durable-enforcement-from-session-judgment.md)._

## The registry

`PUBLIC_SCHEMA_PUBLICATIONS` in [`src/shared/public_schemas.ts`](../../../src/shared/public_schemas.ts) is the single source for the eight publications. Each entry records the surface's public `$id`, its generated repository artifact under `schema/`, its schema major, and its compatibility policy. The generator writes the policy into the artifact, so a tagged baseline carries the rules it was published under. To change what a surface promises, change its registry entry; the guard, the generated manual table, and the artifact all follow.

The publications split into two tiers. The durable tier keeps hard gate enforcement permanently: `discern.toml`, the setup config document, the landing Proof note, the conventions manifest, and the release comparison. The session tier — the CLI grammar manifest, the MCP tools manifest, and the result contracts — is destined for a stop-mode checkpoint with owner variance, so a deliberate deprecation can land with its record in Proof. That checkpoint does not exist yet: **at launch the same gate guard enforces every publication**, and [`project/TODO.md`](../../TODO.md) records the split as pending work.

## The comparators and the baseline

[`scripts/public_schema_compatibility.ts`](../../../scripts/public_schema_compatibility.ts) implements the per-policy structural comparison for the JSON Schema publications; [`scripts/contract_manifest_compatibility.ts`](../../../scripts/contract_manifest_compatibility.ts) implements it for the generated manifests (CLI grammar, MCP tools, conventions). Each comparator reads the policy recorded in the baseline artifact and rejects the changes that policy forbids.

[`scripts/public_schema_release_baseline.ts`](../../../scripts/public_schema_release_baseline.ts) selects the baseline: the highest valid `v<SemVer>` release tag, with tags at `HEAD` excluded so a release candidate compares with its predecessor instead of anchoring on itself. With no predecessor tag the ratchet stays unarmed, which is what lets untagged trunk stage coordinated contract changes before the first release.

[`tests/public_schema_compatibility_guard_test.ts`](../../../tests/public_schema_compatibility_guard_test.ts) is the gate-side guard: it runs the comparators over every registered publication on each gate run, so a forbidden change fails `discern done` before it can reach a tagged release.

## Evolving members

A result contract becomes evolving through the `stability` field on `ResultContract` in [`src/shared/result_contracts.ts`](../../../src/shared/result_contracts.ts); workstream 2A delivers the field and the comparator pruning. One `stability: "evolving"` marks the contract's CLI command paths, its MCP tool, and its result schema together, and configuration keys carry the same fact through schema metadata. Every comparison prunes evolving members first, then validates both the complete artifact and the pruned one.

Graduation is deletion: removing the `stability` marker makes the member stable from the next release, and the comparator starts holding it to the stable rules. Adding the marker to a member that was stable in the baseline is a break — the guard refuses it like any other demotion. The evolving set is published on the manual's compatibility page and in the artifacts; CLI help and MCP descriptions stay unmarked.

## The enum rule

Every input enum is append-only: a new `discern.toml` enum value, setup-document enum value, flag value, or MCP tool input value is compatible, and a removal fails the comparator.

Every output enum carries a role, recorded in two registries and identified by schema metadata on the Zod enum rather than by membership, so an unrelated enum with the same values cannot change role by accident:

- **Open vocabularies** publish as `type: string` with the known members as metadata, so additions are compatible by construction. Open at launch: error slugs, advisory kinds, step kinds, step dispositions, checkpoint drop reasons, proof status, consent source, and every other output enum the engine only carries or displays.
- **Closed decision vocabularies** stay closed because engine code branches on the value when reading; a new member is a break for that artifact alone — a schema major for the proof note or releases, a recorded retirement on the session tier. Closed at launch: validation mode, step outcome, diagnostic severity, proposal direction, evidence purpose, requirement kind, checkpoint mode, exception state, landing-authority kind, and the release comparison's two vocabularies, `status` and `publication`.

An output enum registered in neither set fails the guard, so a new vocabulary cannot ship unclassified. Workstream 2A delivers the registries and the open-vocabulary projection.

## Where the policy is written down

- The decision record: `project/map/_private/planning/discern-public-contract.md`, sections "Decisions taken on 2026-09-17" and Part 1.
- The rationale: [ADR 0409](../_adr/0409-public-contracts-split-durable-enforcement-from-session-judgment.md), amending [ADR 0208](../_adr/0208-public-contracts-version-by-schema-major.md) (identity and majors) and [ADR 0390](../_adr/0390-public-contracts-preserve-behavior-and-independent-format-versions.md) (documentation and private formats).
- The public promise: the manual's [compatibility page](https://discern.sh/docs/reference/compatibility) (`project/manual/30-reference/compatibility.md`).
- The comparison mechanics as they stand today: [Compatibility by schema version](mcp-and-results.md#compatibility-by-schema-version).
