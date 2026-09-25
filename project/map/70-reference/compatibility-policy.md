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

_The mechanism behind the public compatibility promise: the publication registry, the comparators, the evolving tier, the vocabulary registries, the baseline, and the guards. The promise itself is the manual's [compatibility page](https://discern.sh/docs/reference/compatibility). The reasoning is [ADR 0409](../_adr/0409-public-contracts-split-durable-enforcement-from-session-judgment.md)._

## The registry

`PUBLIC_SCHEMA_PUBLICATIONS` in [`src/shared/public_schemas.ts`](../../../src/shared/public_schemas.ts) is the single source for the eight publications. Each entry records the surface's public `$id`, its generated artifact under `schema/`, its schema major, its compatibility policy, and the contract sentence a reader sees. The generator writes the policy into the artifact, so a tagged baseline carries the rules it was published under. `compatibilityContract` renders the same-major promise for a policy. The manual's reference table and the contract digest both render that sentence; neither restates it. To change what a surface promises, change its registry entry. The guard, the generated manual table, the digest, and the artifact all follow.

The publications split into two tiers. The durable tier keeps hard gate enforcement permanently: `discern.toml`, the setup config document, the landing Proof note, the conventions manifest, and the release comparison. The session tier is the CLI grammar manifest, the MCP tools manifest, and the result contracts. It is destined for a stop-mode checkpoint with owner variance, so a deliberate deprecation can land with its record in Proof. That checkpoint does not exist yet. **At launch the same gate guard enforces every publication.** [`project/TODO.md`](../../TODO.md) records the split as pending work.

## The comparators and the baseline

[`scripts/public_schema_compatibility.ts`](../../../scripts/public_schema_compatibility.ts) compares the JSON Schema publications by policy. [`scripts/contract_manifest_compatibility.ts`](../../../scripts/contract_manifest_compatibility.ts) does the same for the generated manifests: CLI grammar, MCP tools, and conventions. Each comparator reads the policy recorded in the baseline artifact and rejects the changes that policy forbids. Every comparison validates the complete baseline and current artifacts first: a schema must compile, and a manifest must index every tool, resource, and command by its identity and carry an object for every request schema. It then compares their stable members, as [Evolving members](#evolving-members) explains, so a malformed evolving record is reported rather than pruned away.

[`scripts/public_schema_release_baseline.ts`](../../../scripts/public_schema_release_baseline.ts) selects the baseline: the highest valid `v<SemVer>` release tag. Tags at `HEAD` are excluded, so a release candidate compares with its predecessor instead of anchoring on itself. With no predecessor tag the ratchet stays unarmed. That is what lets untagged trunk stage coordinated contract changes before the first release.

[`tests/public_schema_compatibility_guard_test.ts`](../../../tests/public_schema_compatibility_guard_test.ts) is the gate-side guard. It runs the comparators over every registered publication on each gate run, so a forbidden change fails `discern done` before it can reach a tagged release. Every rule below has a synthetic fixture there.

## Evolving members

A result contract becomes evolving through the `stability` field on `ResultContract` in [`src/shared/result_contracts.ts`](../../../src/shared/result_contracts.ts). One `stability: "evolving"` marks the contract's CLI command paths, its MCP tool, and its result schema together. The result schema stamps `x-discern-stability` on the contract's definitions and `stability` on its metadata record. The CLI and MCP manifests carry `stability` on every command and tool the contract owns, looked up through the contract registry. A configuration section becomes evolving through Zod metadata on its schema. The JSON Schema output carries that through as `x-discern-stability` on the section node, and [`tests/config_codegen_test.ts`](../../../tests/config_codegen_test.ts) holds every published section equal to what its schema registered. No other list of evolving members exists.

`withoutEvolvingMembers` in [`scripts/public_contract_compatibility_common.ts`](../../../scripts/public_contract_compatibility_common.ts) projects an artifact onto its stable members. Evolving records leave the root arrays. Evolving definitions and properties leave with their required mentions and pure references. A definition only evolving members reached is retired; one a stable member still reaches survives. A root vocabulary array follows the same rule: one that only retired nodes named leaves with them, so an evolving contract can take its own vocabulary with it, while one a stable node still names is held. Both comparators validate the complete artifacts first, then compare the projections. Graduation is deletion: removing the marker makes the member appear as an addition. Adding the marker to a member that was stable in the baseline makes it appear as a removal, which the guard refuses like any other. Neither needs a rule of its own. A second guard fails on any publication that lists an evolving member by name without the marker. CLI help and MCP descriptions stay unmarked by decision. The manual's compatibility page and the artifacts carry the fact.

## The enum rule

Input enumerations are append-only. The schema comparator keeps only removals under `config-input`. The manifest comparator treats tool input enumerations, including one nested in a union such as an input that also accepts null, and the `choices` of a positional or flag the same way. Every other keyword of a request schema is held member by member, so a union that gains or loses an alternative is a change. The CLI manifest records those choices from the enum type a command registers, for a positional and for a flag with one enum-typed value, so the rule has real input as soon as a command declares one.

Output enumerations carry a role. The registries in [`src/shared/result.ts`](../../../src/shared/result.ts) record it, and a binding identifies it rather than membership. `RESULT_OPEN_VOCABULARIES` and `RESULT_DECISION_VOCABULARIES` map each `x-discern-…` root key to a declaration name and its members. [`src/shared/result_vocabulary.ts`](../../../src/shared/result_vocabulary.ts) builds every strict runtime enumeration from an entry and binds the instance to its key in a dedicated Zod registry. The public generators stamp that key onto the node as `x-discern-vocabulary`. Zod's own conversion carries nothing, so an unrelated enumeration with the same values cannot change role by accident.

- **Open vocabularies** publish as `type: string` and keep the key. Their known members sit under the key at the schema root, so additions are compatible by construction. The comparator refuses a removed member. The declarations export one `DiscernKnown…` union per published vocabulary. Open at launch: error slugs, advisory kinds, step kinds, step dispositions, both checkpoint drop reason families, proof statuses, consent sources, and every other output value the engine only carries or displays.
- **Closed decision vocabularies** stay enumerated, because engine code branches on the value when reading. The comparator reports a member added or removed under `result-output`. Closed at launch: validation mode, step outcome, diagnostic severity, proposal direction, evidence purpose, requirement kind, checkpoint mode, exception state, landing-authority kind, and the release comparison's status and publication.

[`tests/result_vocabularies_test.ts`](../../../tests/result_vocabularies_test.ts) walks every enumerated value set in the results, proof-note, and releases schemas. It fails on one registered in neither registry, on an open vocabulary published as anything but a string, on a root that disagrees with its registry, and on a registered vocabulary no publication uses. Adding a member to an open vocabulary is one array edit. A new output enumeration cannot ship unclassified.

## The proof-note reader and the MCP boundary

The durable readers in [`src/engine/gate/proof_notes.ts`](../../../src/engine/gate/proof_notes.ts) and [`src/engine/gate/proof_records.ts`](../../../src/engine/gate/proof_records.ts) apply the writer contract through `withOpenVocabulariesAsStrings`. That helper walks a Zod schema and rebuilds only the path to each open enumeration as a string, keeping each rebuilt node's metadata so the projection still hoists and describes the same definitions. Object strictness, refinements, and every closed vocabulary stay as written. A note from a newer writer that names an unknown checkpoint drop reason or consent source therefore reads as a valid Proof. One naming an unknown validation mode is refused. The few engine switches over open vocabularies carry a default branch for the same reason.

A value read that way can flow into a result, so the output schema each MCP tool advertises is the same projection of its registry schema. The SDK validates every call's structured content against the advertised schema; without the projection a `status` call reporting a Proof with an unknown drop reason would fail at the server while the CLI reported it. [`tests/engine_mcp_surface_test.ts`](../../../tests/engine_mcp_surface_test.ts) holds every advertised schema to the projection and carries one such Proof through `status`.

## Positional arguments, order, and resources

The CLI comparator holds every existing positional argument by slot: its name, whether it is required, its value count, and its value types. Its choices are append-only. A new positional argument is admitted only when it is optional, which by index also makes it trailing. The listing order of commands, tools, and resources is not compared.

The server registers every resource and template from the `RESOURCES` table in [`src/engine/mcp/server.ts`](../../../src/engine/mcp/server.ts). The MCP tools manifest publishes the table's names, kinds, and URIs. The comparator holds them append-only by name with immutable kind and URI. A live test lists both the concrete resources and the templates from a running server and matches them to the manifest, because MCP lists the two through separate calls.

## Result contract aggregates

Within the result publication, a result-role aggregate may widen only when its definition contains `oneOf` and annotation keywords, and the baseline exposes one acyclic same-instance route to it from the top-level branches. A recognized aggregate cannot add named properties. The route must be a pure top-level `$ref` to the aggregate. Constrained references and applicators such as `allOf` or `dependentSchemas` count as routes but cannot grant widening authority. Repeated references and wrapper branches count separately. An ambiguous aggregate or a nested union stays closed.

The same rule permits a role's first aggregate. The baseline must have no registry references for that role, every current role reference must introduce a definition, one new aggregate must contain only `oneOf` and annotation keywords with the full current reference set, and one pure top-level entrypoint must be its sole route. In config schemas, a new named property must accept every value admitted for that name by the baseline object's `additionalProperties` schema. Tuple schemas compare `prefixItems` by position ([ADR 0208](../_adr/0208-public-contracts-version-by-schema-major.md)).

## Where the policy is written down

- Every published member on one page: the generated [public contract digest](../_internal/public-contract-digest.md), rendered from the committed artifacts by `deno task codegen`.
- The program that closed the contract before the first tag: [ADR 0410](../_adr/0410-the-public-contract-programme-closes-before-the-first-tag.md).
- The rationale: [ADR 0409](../_adr/0409-public-contracts-split-durable-enforcement-from-session-judgment.md), amending [ADR 0208](../_adr/0208-public-contracts-version-by-schema-major.md) (identity and majors) and [ADR 0390](../_adr/0390-public-contracts-preserve-behavior-and-independent-format-versions.md) (documentation and private formats).
- The public promise: the manual's [compatibility page](https://discern.sh/docs/reference/compatibility) (`project/manual/30-reference/compatibility.md`).
- The runtime side of the vocabularies: [Result contracts and protocol adapters](../50-engine-internals/the-result-envelope.md#runtime-schemas-and-enrollment).
