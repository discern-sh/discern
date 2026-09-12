---
aliases:
  - runtime data boundary
  - JSON validation
  - external command output
  - runtime decoder
---

# Runtime data boundaries

_How files, subprocess output, caches, and other external values earn the TypeScript types discern uses._

Type annotations do not validate runtime values. Authored runtime and script code therefore treats decoded data as `unknown` until a schema or complete explicit validator establishes the fields the caller consumes ([ADR 0329](../_adr/0329-runtime-data-earns-types-at-validation-boundaries.md)).

## The shared boundary

Use [`decodeJson`](../../../src/shared/runtime_decode.ts) for JSON text and `decodeUnknown` for an already-decoded value. Each takes a Zod schema and a short source label, returns the schema's output type, and reports bounded path-qualified issues. The capability owns parsing and validation only; it does not decide whether a file may be absent, whether an observation is advisory, or whether a malformed cache may be rebuilt.

Place a schema beside the canonical shape or the boundary it describes. Derive the consumed TypeScript type with `z.output` instead of maintaining an interface with the same fields. Use a loose object when an external producer may add fields discern does not consume. Keep every consumed field fully typed; a permissive root does not weaken a known field.

The main starting points are:

| Data entering runtime code                                                       | Shape and decoding authority                                                                                              |
| -------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------- |
| Setup answers documents                                                          | [`configDocRuntimeSchema`](../../../src/shared/config_schema.ts) and [`decodeConfigDoc`](../../../src/lib/config_doc.ts)  |
| Deno module graphs, storage reports, package metadata, and the JSR licence cache | [`third_party_codegen.ts`](../../../scripts/third_party_codegen.ts)                                                       |
| Vale JSON reports                                                                | [`prose_lib.ts`](../../../scripts/prose_lib.ts)                                                                           |
| Canon Editor snapshot subprocess output                                          | [`snapshot.ts`](../../../scripts/canon_editor/snapshot.ts) and [`pipeline.ts`](../../../scripts/canon_editor/pipeline.ts) |
| Embedded first- and third-party legal bundles                                    | [`license_bundle_schemas.ts`](../../../src/shared/license_bundle_schemas.ts)                                              |

## Setup-document boundary

The setup config document has one closed shape. `configDocSchema` generates the published editor schema, supplies its inferred TypeScript input, and is also exported as `configDocRuntimeSchema`. Root and nested unknown keys therefore fail before setup plans any effects. This keeps misspelled or retired inputs from looking successful while leaving part of the requested install unwritten.

[`loadConfigDoc`](../../../src/lib/config_doc.ts) uses `decodeConfigDoc`. After schema validation, its single version check refuses a declared major this build does not understand. The explicit document major, not silent field dropping, is the compatibility boundary. An unknown key or a known field with the wrong type is malformed input and fails with its source.

## Caller policy stays outside validation

Read presence and validation as separate decisions. The filesystem helpers in [`fs_presence.ts`](../../../src/shared/fs_presence.ts) distinguish absence from failure ([ADR 0328](../_adr/0328-absence-and-unknown-observations-stay-distinct.md)); the decoder distinguishes valid data from malformed data. A caller may return `undefined` for a genuinely absent optional manifest or rebuild a malformed cache only when authoritative fetching is enabled. It does not route a data-producing read through `bestEffort`: that capability accepts side effects and returns only `void` ([ADR 0341](../_adr/0341-deliberate-error-discard-is-a-named-side-effect-boundary.md)).

Do not catch a validation error merely to turn readable malformed data into absence. When product behavior converts a specific decode failure into a fallback, the exact syntax site belongs to [`BEST_EFFORT_BOUNDARIES`](../../../src/shared/best_effort.ts) with its owner, operation, observability, and reason. Tests should include a syntactically valid value with a wrong consumed field type and assert that the failure names the source before downstream work runs.

## Permanent enforcement

[`runtime_boundary_lint_test.ts`](../../../tests/runtime_boundary_lint_test.ts) scans the Git-derived `authored-deno` universe through the structural-guard declaration in [`structural_guard_scope.ts`](../../../tests/structural_guard_scope.ts). It follows direct and aliased `JSON.parse` calls through local assignments and rejects assertion-shaped trust jumps, equivalent double assertions, and functions that return parsed data as a declared object type without validation.

The rule targets assertion-shaped trust jumps in runtime and script code. Other uses of the `as` keyword stay outside its predicate. A complete manual projection can carry an exact path, enclosing-function, and rule exception with a specific reason. Duplicate, vague, moved, or removed exceptions fail. Test-side command and fixture JSON follows the decoder and falling-ceiling contract on [Testing](testing.md).

When the detector reports a new boundary, add or reuse a real schema and decode at the source. Register an exception only when the function has already established the entire declared shape or constructs a fresh typed value from individually validated fields.

## Public compatibility and internal formats

[ADR 0390](../_adr/0390-public-contracts-preserve-behavior-and-independent-format-versions.md) separates stable caller behavior from documentation and private format revisions. The [public-contract registry](../../../src/shared/public_schemas.ts) owns each publication's policy; [the manifest comparator](../../../scripts/contract_manifest_compatibility.ts) holds identities, grammar, defaults, and safety annotations while allowing descriptive text to change.

[The shared schema-documentation projection](../../../scripts/public_contract_compatibility_common.ts) visits schema children only. A property named `description` or an object inside a default remains input data. Reuse that boundary when adding a schema-bearing surface.

[The local-format registry](../../../src/shared/on_disk_formats.ts) owns private versions and forward-skew policy. Its current Git-administration format numbers are absent from the frozen conventions manifest; public Proof-note versions remain published. An internal version change still needs compatible readers or migration and recovery coverage. The [format tests](../../../tests/on_disk_formats_test.ts) govern those obligations; a passing public-manifest comparison does not establish them.
