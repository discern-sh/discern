---
title: Result contracts and protocol adapters
description: How result vocabulary, Zod schemas, generated contracts, and protocol validation stay synchronized.
order: 45
aliases:
  - result envelope internals
  - DiscernResult
  - result schemas
  - MCP output schema
---

# Result contracts and protocol adapters

_Every verb builds one result object; types, runtime validation, generated contracts, and protocol adapters all converge on it._

[`result.ts`](../../../src/shared/result.ts) defines plans, executed steps, diagnostics, and `DiscernResult<TData>`. Human output, `--json`, and the Model Context Protocol (MCP) render that one object ([ADR 0028](../_adr/0028-result-envelope-and-diagnostics.md)).

## The serialized envelope

`serializeResult` emits the wire keys that are present on a result:

| Field              | Role                                                                                                                                      |
| ------------------ | ----------------------------------------------------------------------------------------------------------------------------------------- |
| `ok`, `verb`       | Universal success flag and verb discriminator.                                                                                            |
| `dry_run`, `plan`  | A preview and the steps it would apply.                                                                                                   |
| `steps`            | Applied steps with outcomes, duration, and output metadata.                                                                               |
| `diagnostics`      | Normalized failures with a reproduce command and captured output.                                                                         |
| `data`             | The schema-backed payload for one verb.                                                                                                   |
| `hints`            | Advisory next actions that never decide success; failures carry at least one ([ADR 0172](../_adr/0172-hints-compile-from-a-registry.md)). |
| `error`, `message` | A stable refusal slug and human explanation.                                                                                              |

## Runtime schemas and enrollment

[`result_schemas.ts`](../../../src/shared/result_schemas.ts) owns the strict envelope and each verb's data and output schemas. Verb cores infer payload types from it; MCP validates `structuredContent` against it ([ADR 0041](../_adr/0041-self-describing-mcp-surface.md)).

[`result_contracts.ts`](../../../src/shared/result_contracts.ts) maps command paths, literal verbs, and MCP tools to output schemas. Faithfulness tests execute real cores. Every entry needs coverage or explicit debt; MCP debt is forbidden.

## Generated consumer contracts

`deno task codegen` projects the registry into:

- [`schema/discern-results.schema.json`](../../../schema/discern-results.schema.json), whose entry points cover CLI results and MCP tool wrappers;
- [`types/discern-json.d.ts`](../../../types/discern-json.d.ts), including lookup maps by verb, command, and MCP tool.

Runtime schemas stay strict. The generated schema admits additive fields and publishes current error slugs as metadata, so an older version-1 consumer accepts a compatible release ([ADR 0208](../_adr/0208-public-contracts-version-by-schema-major.md)). [`result_codegen_test.ts`](../../../tests/result_codegen_test.ts) fails when committed artifacts or command enrollment drift ([ADR 0097](../_adr/0097-publish-json-result-contracts.md)).

## Protocol adapters

[`server.ts`](../../../src/engine/mcp/server.ts) adapts result cores to MCP `content`, `structuredContent`, `isError`, and effect annotations without duplicating outcome logic. Parity tests bind tools, schemas, and verbs. Caller behavior belongs in [MCP tools & results](../70-reference/mcp-and-results.md).

## Where it lives in code

| Concern                           | Source                                                                                                                               |
| --------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------ |
| Result and renderer vocabulary    | [`result.ts`](../../../src/shared/result.ts)                                                                                         |
| Strict runtime schemas            | [`result_schemas.ts`](../../../src/shared/result_schemas.ts)                                                                         |
| Command and MCP contract registry | [`result_contracts.ts`](../../../src/shared/result_contracts.ts)                                                                     |
| Generated contract builder        | [`result_codegen.ts`](../../../src/shared/result_codegen.ts)                                                                         |
| MCP adapters                      | [`server.ts`](../../../src/engine/mcp/server.ts)                                                                                     |
| Contract faithfulness             | [`result_schemas_test.ts`](../../../tests/result_schemas_test.ts), [`result_codegen_test.ts`](../../../tests/result_codegen_test.ts) |

## Current state & gotchas

- `steps` and `plan` are mutually exclusive. A fail-fast sibling is `cancelled`; a configured step that did not run is `skipped`.
- Full job output is a best-effort OS temporary artifact. Registered artifacts age out after 24 hours; failure to write or reap one cannot change a job's result.
- A new JSON-emitting command needs registry enrollment, a per-verb schema, faithfulness coverage, and regenerated artifacts. MCP exposure also needs the server adapter and surface-parity coverage.
