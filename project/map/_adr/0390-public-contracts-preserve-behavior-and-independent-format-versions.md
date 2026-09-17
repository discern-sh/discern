# ADR 0390: Public contracts preserve behavior and independent format versions

> **Amendment ([ADR 0409](0409-public-contracts-split-durable-enforcement-from-session-judgment.md)).** The uniform comparison regime splits into tiers: durable publications keep the hard gate, session publications move toward recorded judgment with owner variance, evolving members are exempt from comparison, and output vocabularies are open or closed by role. The documentation and private-format boundaries this record sets are unchanged.

**Status**: accepted on 2026-09-12. Amends [ADR 0208](0208-public-contracts-version-by-schema-major.md) and the format-publication boundary of [ADR 0368](0368-local-durable-formats-declare-forward-skew.md).

## Context

The owner wants the launch contracts to support later integration checks and queue improvements within the same public schema major. The manifest comparison froze descriptive text and private formats' current version numbers. Explaining an additive capability or evolving a recovery journal therefore required a new public major even when existing callers remained compatible.

## Decision

CLI help, MCP display titles and descriptions, and JSON Schema documentation may evolve within a public major while preserving existing behavior. JSON Schema documentation means `$comment`, `description`, `examples`, and `title` at schema nodes. Properties named after these keywords, literal defaults, and constant values remain structural. Command identities, grammar, defaults, tool ordering, safety annotations, and accepted input contracts retain their existing protections. A wording edit does not authorize a behavior change; review still judges that meaning.

The conventions manifest publishes each local format's identity, location, version-field name, and newer-version policy. Git-administration formats' current version numbers stay in the internal format registry. They are omitted from the public conventions contract. A Git-note format retains its published version because its payload type identifies a durable public schema.

Internal format changes still require reader/writer compatibility review, preservation or migration of supported stored state, and interruption recovery. Older binaries must follow the registered forward-skew policy and never overwrite newer records. This decision changes no record format or migration itself. It does not authorize deleting historical Proof or treating unknown authority as permission.

The public-schema generator, manifest comparator, and their shared JSON helpers own these boundaries. The first publication remains the compatibility baseline. Optional result fields and optional configuration additions follow the existing policy; closed result vocabularies retain their types and meanings.

## Consequences

Documentation can describe additive features without a new public major. Private journal versions can advance independently of that major. The gate continues to reject changed names, defaults, safety annotations, and public Proof-note versions.

The schema checker cannot prove that revised prose preserves meaning. Review must assess that question. Durable-format tests continue to check the registry and forward skew; the manifest is not an upgrade or recovery oracle.

Regression cases cover nested schema documentation, properties and literal data named `description`, unchanged input constraints, and every registered local format. Future format families enter through the same registry-derived projection.

## Alternatives considered

- Freeze prose byte-for-byte: this makes ordinary documentation maintenance require a new contract major.
- Ignore annotation-like names everywhere: this also ignores real input properties and literal values with those names.
- Publish private current versions as immutable constants: this couples internal recovery changes to public schema identity. The internal registry already owns those versions.
