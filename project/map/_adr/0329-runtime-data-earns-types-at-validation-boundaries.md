# ADR 0329: Runtime data earns its types at validation boundaries

**Status**: accepted. Extends the canonical config authority in [ADR 0026](0026-typed-config-schema.md), uses the Git-derived guard universe in [ADR 0324](0324-structural-guards-declare-git-derived-source-universes.md), and keeps validation separate from the absence and fallback policy in [ADR 0328](0328-absence-and-unknown-observations-stay-distinct.md). The launch contract closes setup-document runtime validation: its explicit major now carries compatibility, and unknown fields fail instead of being discarded.

## Context

TypeScript types disappear at runtime. JSON files, subprocess reports, package metadata, caches, and linter output can therefore disagree with an asserted type even when the consuming code type-checks. Several runtime paths parsed those values and acquired object types through direct or double assertions. A malformed value then travelled beyond its source and failed later in code that reasonably assumed the declared fields existed.

The boundaries do not all share one failure policy. An absent optional file may be normal, an unreadable advisory cache may trigger a fallback, and a malformed readable cache may either rebuild or refuse according to whether authoritative fetching is allowed. Validation must establish shape without replacing those caller-owned decisions.

The setup config document adds a compatibility constraint. Its published editor schema and runtime validator share one strict snapshot, so a misspelled, retired, or newer field cannot look accepted while producing no setup effect. Its explicit document major is the boundary for incompatible shapes.

Finally, the unsafe pattern is narrower than the TypeScript `as` operator. Library integration, branded compile-time proofs, and broad record access after complete manual projection can be sound. A repository-wide assertion ban would create noise and encourage performative property checks rather than validating external data.

## Decision

**Runtime data receives a declared type only after a schema or complete explicit validator earns it.**

[`src/shared/runtime_decode.ts`](../../../src/shared/runtime_decode.ts) owns the policy-free entry points. `decodeJson(schema, text, source)` parses into `unknown`; `decodeUnknown(schema, value, source)` validates an already-decoded value. Both return the schema's output type. Failures name a bounded source and a bounded set of path-qualified issues. Callers retain their own absence, fallback, rebuild, and recovery policy around that capability.

Schemas live with the canonical shape or the boundary they describe, and inferred runtime types derive from them. The config-document runtime schema is the same strict `configDocSchema` that supplies its live TypeScript type and published editor schema. It rejects unknown keys at every depth and validates every known field. One subsequent version check rejects an unsupported major. The runtime maintains no second field list.

[`tests/runtime_boundary_lint_test.ts`](../../../tests/runtime_boundary_lint_test.ts) permanently guards authored runtime and script code over the declared `authored-deno` universe. Its syntax-aware analysis catches direct and double assertions over `JSON.parse`, local aliases and parsed locals, unknown-returning local decoders asserted by their caller, and parsed values returned as declared object types without validation. It deliberately does not flag assertions unrelated to decoded runtime data.

A complete manual projection may use an exact exception keyed by path, enclosing function, and rule. The entry states why every consumed field is earned, and the guard fails if the site disappears, moves shape, duplicates another entry, or carries a vague reason. Test-output parsing follows the separate test-decoder contract rather than this runtime-and-script rule.

## Consequences

- Malformed external data fails at the boundary with its file, command, cache, or linter source in the error, before downstream behavior consumes it.
- A new runtime JSON trust assertion enrolls automatically when Git sees its authored Deno file. The guard permits normal narrowing and makes each exceptional manual projection locally reviewable.
- Schema definitions become part of integrating an external JSON producer. Upstream additive fields remain harmless where the boundary uses a loose object, but every known field that discern consumes must keep its real runtime type.
- Setup config documents fail on unknown keys at the runtime boundary. Authors update their schema and discern release together; incompatible document shapes use a new declared major.
- Decoder errors are intentionally uniform only at the validation seam. Callers still decide whether absence is normal, whether an unreadable observation is advisory, and whether malformed cached data can be rebuilt.
- The AST detector recognizes the trust shapes present in authored code. A genuinely new way to move parsed data may require extending the detector; exact stale-checked exceptions do not become a general bypass.

## Alternatives considered

- **Ban every TypeScript assertion.** Rejected because assertion syntax is not the defect class. It would flag sound integration and proofs while encouraging noisy manual checks that do not necessarily validate a complete boundary.
- **Silently discard unknown setup-document fields.** Rejected because a misspelled or retired input would report success while leaving the requested install incomplete.
- **Write a second permissive config validator by hand.** Rejected because its known-field list could drift from the live config type and generated schema.
- **Add the decoder without structural enforcement.** Rejected because a future direct assertion would type-check and silently reopen the same trust jump.
- **Make the decoder choose absence and cache policy.** Rejected because those outcomes belong to the caller and differ legitimately by boundary.
