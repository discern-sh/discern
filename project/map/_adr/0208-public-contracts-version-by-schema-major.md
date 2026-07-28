# ADR 0208: Public contracts version by schema major

**Status**: accepted; extends [ADR 0028](0028-result-envelope-and-diagnostics.md) and [ADR 0097](0097-publish-json-result-contracts.md), and applies the closed-set discipline of [ADR 0176](0176-the-closed-sets-are-a-closed-set.md)

## Context

External callers need stable contract identities for authored configuration, CLI `--json`, and MCP results before the first public release. Package releases will add fields, configuration keys, and error cases, while discern's runtime must still reject shapes and error slugs the current engine does not understand. Result consumers need an older schema from the same major to accept compatible output additions. Configuration is different: its schema validates a closed input snapshot, so an older cached copy cannot recognize keys introduced later in the same compatible major.

The result envelope already has one generated JSON Schema identity. Adding a second version fact to every payload would duplicate that authority without telling a caller which schema to validate against.

## Decision

Public config and result schemas use `https://discern.sh/schema/v1/…` identities. The path major tracks breaking contract compatibility, not the discern package version.

**Result output is additive within version 1.** Existing result fields keep their type and meaning; releases may add optional fields. Consumers ignore unknown object fields and handle unknown error slugs defensively. Removing or renaming a result field, changing its type or meaning, or removing or renaming an error slug requires a new major schema path.

Runtime result schemas remain strict, and `ERROR_SLUGS` is the closed vocabulary the current engine may emit. The generated public result schema deliberately permits unknown object fields and leaves `error` open as a string, while `x-discern-error-slugs` publishes the current known values. An older pinned version-1 schema can therefore validate a later additive result without weakening current runtime validation.

**Configuration uses a closed schema for the current version-1 input surface.** A release may add optional configuration keys or sections without changing the meaning of existing version-1 configuration. The published schema at the stable major URL then describes that newer snapshot; an older cached copy may reject configuration that uses the additions. Removing an existing key, making an optional key required, or changing accepted meaning or type requires a new major schema path. Engine migrations and the configuration reference remain the authority for moving authored configuration between releases.

No top-level `schema_version` field is added. The schema `$id` is the contract identity callers pin; a breaking release publishes a new major path. A payload field would repeat that identity on every result and would not replace schema selection or protocol negotiation.

## Consequences

- Version-1 result consumers must retain unknown fields and slugs as unknown, not treat them as impossible.
- Generators and tests must preserve the deliberate difference between strict runtime schemas and additive public validation.
- Configuration tools may cache the version-1 schema, but must refresh it before validating configuration that uses keys introduced by a newer discern release.
- Breaking changes require a new served schema path and an explicit consumer migration.
- The known-slug extension is discovery metadata, not a public enum that closes validation.

## Alternatives considered

- **Close the public result schema to today's shapes.** Rejected because a pinned version-1 result schema would reject later compatible output additions. The configuration schema remains closed because it validates authored input rather than consuming extensible output.
- **Put a version field in every envelope.** Rejected because it duplicates the schema identity without removing the need to select a schema.
