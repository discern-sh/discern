# ADR 0208: Public contracts version by schema major

> **Amendments.**
>
> - **[ADR 0409](0409-public-contracts-split-durable-enforcement-from-session-judgment.md) — enforcement tiers, evolving members, and vocabulary roles:** The eight publications split into a durable tier under the permanent hard gate and a session tier destined for checkpoint judgment with owner variance. Evolving members are exempt from comparison, output vocabularies are open or closed by role, and the session tier's deprecation promise departs from strict semantic versioning.
> - **[ADR 0390](0390-public-contracts-preserve-behavior-and-independent-format-versions.md) — documentation and private formats:** Descriptive CLI/MCP text and schema documentation may evolve without a new major. Private format revisions remain internal; public Proof-note versions keep their schema guarantee.
> - **[ADR 0242](0242-durable-receipts-use-a-versioned-dsse-envelope.md) — durable channel:** The landing receipt note carries a schema-fragment URI in-band as its DSSE `payloadType`. A Git note has no schema-selection channel, so the authenticated payload type names its compatibility major and published definition. The no-payload-version rule for negotiated result and configuration channels is unchanged.

**Status**: accepted; extends [ADR 0028](0028-result-envelope-and-diagnostics.md) and [ADR 0097](0097-publish-json-result-contracts.md), and applies the closed-set discipline of [ADR 0176](0176-the-closed-sets-are-a-closed-set.md)

## Context

External callers need stable contract identities for authored configuration, CLI `--json`, and MCP results before the first public release. Package releases will add fields, configuration keys, and error cases, while discern's runtime must still reject shapes and error slugs the current engine does not understand. Result consumers need an older schema from the same major to accept compatible output additions. Configuration is different: its schema validates a closed input snapshot, so an older cached copy cannot recognize keys introduced later in the same compatible major.

The result envelope already has one generated JSON Schema identity. Adding a second version fact to every payload would duplicate that authority without telling a caller which schema to validate against.

## Decision

Version tags, never ordinary trunk commits, publish contracts. Work compares with the highest valid `v<SemVer>` predecessor tag; a candidate tag at `HEAD` excludes itself. When no predecessor publication exists, every public contract uses major 1 and its root `schema/` artifact. Untagged trunk may stage coordinated contract changes in place before that first publication. The first tagged candidate also starts at major 1. This incorporates the tagged-publication decisions of [ADR 0218](0218-docs-owns-the-manual-help-owns-cli-reference.md) and [ADR 0219](0219-public-install-schema-starts-at-one.md).

The same-major compatibility rules below apply once a predecessor publication exists. Before publication, required-field and meaning changes do not create a second public major or a retained historical publication.

Public config and result schemas use `https://discern.sh/schema/v1/…` identities. The path major tracks breaking contract compatibility, not the discern package version.

**Result output is additive within version 1.** Existing result fields keep their type and meaning; releases may add optional fields. Consumers ignore unknown object fields and handle unknown error slugs defensively. Removing or renaming a result field, changing its type or meaning, or removing or renaming an error slug requires a new major schema path.

Runtime result schemas remain strict, and `ERROR_SLUGS` is the closed vocabulary the current engine may emit. The generated public result schema deliberately permits unknown object fields and leaves `error` open as a string, while `x-discern-error-slugs` publishes the current known values. An older pinned version-1 schema can therefore validate a later additive result without weakening current runtime validation.

**Configuration uses a closed schema for the current version-1 input surface.** A release may add optional configuration keys or sections without changing the meaning of existing version-1 configuration. Existing defaults are structural: changing or removing one changes the meaning of a document that omits the key and therefore requires a new major. The published schema at the stable major URL describes the newer snapshot; an older cached copy may reject configuration that uses additions. Removing an existing key, making an optional key required, or changing accepted meaning, type, or default requires a new major schema path. Engine migrations and the configuration reference remain the authority for moving authored configuration between releases.

No top-level `schema_version` field is added. The schema `$id` is the contract identity callers pin; a breaking release publishes a new major path. A payload field would repeat that identity on every result and would not replace schema selection or protocol negotiation.

## Enforcement update — September 3, 2026

`PUBLIC_SCHEMA_PUBLICATIONS` records each schema's major and compatibility policy beside its public `$id` and generated artifact. The generator writes that policy into the artifact. The guard selects the highest valid `v<SemVer>` tag that is not at `HEAD`; every enrolled artifact path and public identity in that tagged publication are append-only. CI checkouts fetch tags before running the gate. The gate compiles every current generated artifact strictly and validates the tagged baseline as JSON Schema Draft 2020-12 before it reads the tagged artifact's recorded policy and compares structure within a major. A breaking major adds a publication and artifact while retaining the earlier publication and route. A changed path, identity, same-major policy, invalid schema, or malformed marker fails the guard.

The structural comparison rejects field, result-contract, definition, and known-error-slug removals, plus type and validation changes. It permits optional properties. For configuration, when a trunk object schema admits unknown names through `additionalProperties`, a newly named property must preserve every value that catchall admitted for the name. The catchall-inclusion check permits a `type` set to add members while retaining every prior member. Other schema constructs, including `oneOf`, remain under structural comparison. Tuple positions are structural: `prefixItems` compares by index rather than as an unordered union. Result output permits optional properties on ordinary contract objects, new command or tool contracts, and additions to the open known-error-slug metadata. A recognized result-role aggregate cannot add named properties. Existing union alternatives and contract records are matched by `$ref` and contract id, so order has no compatibility meaning.

The result-contract registry owns the CLI and MCP fields that may introduce new definition references. A new contract may add both references; an existing CLI contract may add its first MCP reference. Only a matching role aggregate whose definition contains `oneOf` plus annotation keywords and is reached by one acyclic same-instance route from the trunk's top-level branches may widen. The authorizing route must be a pure top-level reference to that aggregate. Reachability still counts constrained reference objects and same-instance applicators, including `allOf` and `dependentSchemas`, when determining whether another route exists. The traversal preserves reference and wrapper-branch multiplicity while a recursion stack terminates cycles. A repeated route, a second reachable aggregate for the role, other metadata, and nested unions cannot authorize a union change.

When a role has no trunk registry references, the same rule may create its first aggregate and root entrypoint. Every current registry reference for the role must introduce a definition. One newly defined aggregate must contain only `oneOf` plus annotation keywords and the complete reference set, and one pure top-level reference to the aggregate must be its sole reachable route. A constrained or indirect entrypoint, a pre-existing unregistered reference, or a second matching aggregate keeps the root union closed.

For result output, an existing contract retains its required fields. A new field must be optional. A new command or tool contract widens the current global union without changing any existing command's output; a consumer pinned to an older schema needs the current schema before validating that new contract.

For configuration, the comparison proves that documents accepted by the tagged publication retain their meaning. An optional key or section may join the current closed schema, and a required key may become optional. An optional key cannot become required, and an existing `default` cannot change or disappear. The check does not claim that an older cached schema accepts a document using an added key.

## Consequences

- Version-1 result consumers must retain unknown fields and slugs as unknown, not treat them as impossible.
- Generators and tests must preserve the deliberate difference between strict runtime schemas and additive public validation.
- A same-major schema change must pass comparison with the last tagged publication. Untagged trunk changes are provisional; breaking changes after publication move to a new public major.
- Configuration tools may cache the version-1 schema, but must refresh it before validating configuration that uses keys introduced by a newer discern release.
- After publication, breaking changes require an additional served schema path, retention of earlier major routes, and an explicit consumer migration.
- The known-slug extension is discovery metadata, not a public enum that closes validation.

## Alternatives considered

- **Close the public result schema to today's shapes.** Rejected because a pinned version-1 result schema would reject later compatible output additions. The configuration schema remains closed because it validates authored input rather than consuming extensible output.
- **Put a version field in every envelope.** Rejected because it duplicates the schema identity without removing the need to select a schema.
