---
title: Compatibility policy
description: Where the public compatibility policy lives, which comparators, registries, and guards enforce it, and how members become evolving.
order: 45
publish: true
aliases:
  - compatibility policy
  - PUBLIC_SCHEMA_PUBLICATIONS
  - evolving members
  - stability tier
  - open vocabularies
  - closed vocabularies
  - RESULT_OPEN_VOCABULARIES
  - RESULT_DECISION_VOCABULARIES
  - x-discern-vocabulary
  - release baseline
  - compatibility guard
---

# Compatibility policy

_The mechanism behind the public compatibility promise: the publication registry, the per-policy comparators, the evolving tier, the vocabulary registries, the baseline selection, and the guards that enforce them. The promise itself is the manual's [compatibility page](https://discern.sh/docs/reference/compatibility); the reasoning is [ADR 0409](../_adr/0409-public-contracts-split-durable-enforcement-from-session-judgment.md)._

## The registry

`PUBLIC_SCHEMA_PUBLICATIONS` in [`src/shared/public_schemas.ts`](../../../src/shared/public_schemas.ts) is the single source for the eight publications. Each entry records the surface's public `$id`, its generated repository artifact under `schema/`, its schema major, its compatibility policy, and the contract sentence a reader sees. The generator writes the policy into the artifact, so a tagged baseline carries the rules it was published under. `compatibilityContract` renders the same-major promise for a policy; the manual's reference table and the contract digest both render that sentence rather than restating it. To change what a surface promises, change its registry entry; the guard, the generated manual table, the digest, and the artifact all follow.

The publications split into two tiers. The durable tier keeps hard gate enforcement permanently: `discern.toml`, the setup config document, the landing Proof note, the conventions manifest, and the release comparison. The session tier — the CLI grammar manifest, the MCP tools manifest, and the result contracts — is destined for a stop-mode checkpoint with owner variance, so a deliberate deprecation can land with its record in Proof. That checkpoint does not exist yet: **at launch the same gate guard enforces every publication**, and [`project/TODO.md`](../../TODO.md) records the split as pending work.

## The comparators and the baseline

[`scripts/public_schema_compatibility.ts`](../../../scripts/public_schema_compatibility.ts) implements the per-policy structural comparison for the JSON Schema publications; [`scripts/contract_manifest_compatibility.ts`](../../../scripts/contract_manifest_compatibility.ts) implements it for the generated manifests (CLI grammar, MCP tools, conventions). Each comparator reads the policy recorded in the baseline artifact and rejects the changes that policy forbids. Every comparison validates the complete baseline and current artifacts as published, then compares their stable members (see [Evolving members](#evolving-members)).

[`scripts/public_schema_release_baseline.ts`](../../../scripts/public_schema_release_baseline.ts) selects the baseline: the highest valid `v<SemVer>` release tag, with tags at `HEAD` excluded so a release candidate compares with its predecessor instead of anchoring on itself. With no predecessor tag the ratchet stays unarmed, which is what lets untagged trunk stage coordinated contract changes before the first release.

[`tests/public_schema_compatibility_guard_test.ts`](../../../tests/public_schema_compatibility_guard_test.ts) is the gate-side guard: it runs the comparators over every registered publication on each gate run, so a forbidden change fails `discern done` before it can reach a tagged release. Every rule below has a synthetic fixture there.

## Evolving members

A result contract becomes evolving through the `stability` field on `ResultContract` in [`src/shared/result_contracts.ts`](../../../src/shared/result_contracts.ts). One `stability: "evolving"` marks the contract's CLI command paths, its MCP tool, and its result schema together: the result schema stamps `x-discern-stability` on the contract's definitions and `stability` on its metadata record, and the CLI and MCP manifests carry `stability` on every command and tool the contract owns, looked up through the contract registry. A configuration section becomes evolving through Zod metadata on its schema, which the JSON Schema output carries through as `x-discern-stability` on the section node; [`tests/config_codegen_test.ts`](../../../tests/config_codegen_test.ts) holds every published section equal to what its schema registered. No other list of evolving members exists.

`withoutEvolvingMembers` in [`scripts/public_contract_compatibility_common.ts`](../../../scripts/public_contract_compatibility_common.ts) projects an artifact onto its stable members: evolving records leave the root arrays, evolving definitions and properties leave with their required mentions and pure references, and a definition only evolving members reached is retired while one a stable member still reaches survives. Both comparators validate the complete artifacts first, then compare the projections. Graduation is deletion: removing the marker makes the member appear as an addition. Adding the marker to a member that was stable in the baseline makes it appear as a removal, which the guard refuses like any other. Neither needs a rule of its own. A second guard fails on any publication that lists an evolving member by name without the marker. CLI help and MCP descriptions stay unmarked by decision; the manual's compatibility page and the artifacts carry the fact.

## The enum rule

Input enumerations are append-only. The schema comparator keeps only removals under `config-input`, and the manifest comparator treats tool input enumerations and the `choices` of a positional or flag the same way.

Output enumerations carry a role, recorded in two registries in [`src/shared/result.ts`](../../../src/shared/result.ts) and identified by a binding rather than by membership. `RESULT_OPEN_VOCABULARIES` and `RESULT_DECISION_VOCABULARIES` map each `x-discern-…` root key to a declaration name and its members, and [`src/shared/result_vocabulary.ts`](../../../src/shared/result_vocabulary.ts) builds every strict runtime enum from an entry, binding the instance to its key in a dedicated Zod registry. The public generators stamp that key onto the node as `x-discern-vocabulary`; Zod's own conversion, which the MCP server advertises, carries nothing, so an unrelated enumeration with the same values cannot change role by accident.

- **Open vocabularies** publish as `type: string` keeping the key, with the known members under the key at the schema root, so additions are compatible by construction; the comparator refuses a removed member, and the declarations export one `DiscernKnown…` union per published vocabulary. Open at launch: error slugs, advisory kinds, step kinds, step dispositions, both checkpoint drop reason families, proof statuses, consent sources, and every other output enum the engine only carries or displays.
- **Closed decision vocabularies** stay enumerated, because engine code branches on the value when reading; the comparator reports a member added or removed under `result-output`. Closed at launch: validation mode, step outcome, diagnostic severity, proposal direction, evidence purpose, requirement kind, checkpoint mode, exception state, landing-authority kind, and the release comparison's status and publication.

[`tests/result_vocabularies_test.ts`](../../../tests/result_vocabularies_test.ts) walks every enumerated value set in the results, proof-note, and releases schemas and fails on one registered in neither registry, on an open vocabulary published as anything but a string, on a root that disagrees with its registry, and on a registered vocabulary no publication uses. Adding a member to an open vocabulary is one array edit; a new output enumeration cannot ship unclassified.

## The proof-note reader

The durable reader in [`src/engine/gate/proof_notes.ts`](../../../src/engine/gate/proof_notes.ts) applies the writer contract through `withOpenVocabulariesAsStrings`, which walks a Zod schema and rebuilds only the path to each open enumeration as a string, keeping object strictness, refinements, and every closed vocabulary. A note from a newer writer that names an unknown checkpoint drop reason or consent source therefore reads as a valid Proof; one naming an unknown validation mode is refused. The few engine switches over open vocabularies carry a default branch for the same reason.

## Positional arguments, order, and resources

The CLI comparator holds every existing positional argument by slot — its name, whether it is required, its value count, and its value types — with append-only choices, and admits a new positional only when it is optional, which by index also makes it trailing. The listing order of commands, tools, and resources is not compared. The server registers every resource and template from the `RESOURCES` table in [`src/engine/mcp/server.ts`](../../../src/engine/mcp/server.ts); the MCP tools manifest publishes the table's names, kinds, and URIs; the comparator holds them append-only by name with immutable kind and URI; and a live test lists both the concrete resources and the templates from a running server and matches them to the manifest, because MCP lists the two through separate calls.

## Result contract aggregates

Within the result publication, a result-role aggregate may widen only when its definition contains `oneOf` and annotation keywords, and the baseline exposes one acyclic same-instance route to it from the top-level branches. A recognized aggregate cannot add named properties. The route must be a pure top-level `$ref` to the aggregate; constrained references and applicators such as `allOf` or `dependentSchemas` count as routes but cannot grant widening authority, repeated references and wrapper branches count separately, and an ambiguous aggregate or a nested union stays closed. The same rule permits a role's first aggregate when the baseline has no registry references for that role, every current role reference introduces a definition, one new aggregate contains only `oneOf` and annotation keywords with the full current reference set, and one pure top-level entrypoint is its sole route. In config schemas, a new named property must accept every value admitted for that name by the baseline object's `additionalProperties` schema; tuple schemas compare `prefixItems` by position ([ADR 0208](../_adr/0208-public-contracts-version-by-schema-major.md)).

## Where the policy is written down

- The decision record: `project/map/_private/planning/discern-public-contract.md`, sections "Decisions taken on 2026-09-17" and Part 1.
- The rationale: [ADR 0409](../_adr/0409-public-contracts-split-durable-enforcement-from-session-judgment.md), amending [ADR 0208](../_adr/0208-public-contracts-version-by-schema-major.md) (identity and majors) and [ADR 0390](../_adr/0390-public-contracts-preserve-behavior-and-independent-format-versions.md) (documentation and private formats).
- The public promise: the manual's [compatibility page](https://discern.sh/docs/reference/compatibility) (`project/manual/30-reference/compatibility.md`).
- The runtime side of the vocabularies: [Result contracts and protocol adapters](../50-engine-internals/the-result-envelope.md#runtime-schemas-and-enrollment).
