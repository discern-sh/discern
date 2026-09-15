---
aliases:
  - managed version
  - adoption compatibility
---

# Managed adoption

`meta.managed_version` answers which discern release last successfully adopted the project's managed material. Start with the [shared classifier](../../../src/shared/managed_version.ts), then the [transaction and evidence decision](../_adr/0401-managed-adoption-keeps-currency-and-proof-separate.md). The programme authority is [ADR 0400](../_adr/0400-release-records-drive-offline-release-awareness.md).

## Boundaries

The [config schema](../../../src/shared/config_schema.ts) owns the optional SemVer input; metadata ownership, public schema, template omission, and reference derive from it. The adoption value is independent of setup provenance, schema compatibility, exact binary bytes, and managed-file currency.

[Upgrade](../../../src/commands/upgrade.ts) plans the monotonic value and includes it in the atomic completion write. [Setup completion](../../../src/commands/setup.ts) includes it in its recoverable marker transaction. A successful replay changes no fact. No standalone installer path owns the project.

The [operation-effect registry](../../../src/shared/operation_effects.ts) enrolls public writers in the older-binary refusal. Internal refresh and skill plans guard their own materialization boundary. An unavailable tracked-refresh plan has no proposed rewrites or stale-file errors; its distinct type forces consumers to acknowledge the evidence boundary before accessing a plan. Status and doctor disclose that uncertainty; completion and both landing paths require currency evidence.

The [trunk check](../../../src/engine/managed_version.ts) retains the highest adoption across branches and reverts. A branch that lowers or deletes the fact must restore it or complete a newer upgrade before it can earn Proof or land.

## Where to verify

The [team journeys](../../../tests/managed_version_journey_test.ts) cover the live command boundaries. The [frozen reader tests](../../../tests/managed_version_baseline_test.ts) exercise real captured code against newer material; comparison injection alone cannot prove backward parsing or older-template behavior. The compatibility slice remains separate from the final install corpus.
