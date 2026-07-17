---
title: Result contracts and protocol adapters
description: How result vocabulary, Zod schemas, generated contracts, and protocol validation stay synchronized.
order: 50
aliases:
  - result envelope internals
  - DiscernResult
  - result schemas
  - MCP output schema
---

# Result contracts and protocol adapters

_Every verb builds one result object; types, runtime validation, generated contracts, and protocol adapters all converge on it._

The result system has 3 layers in [`result.ts`](../../../src/shared/result.ts): plan steps describe intended work, step results record what happened, and `Diagnostic` plus `DiscernResult<TData>` carry failures and verb-specific data. Human output, `--json`, and the Model Context Protocol (MCP) render the same object rather than recomputing an outcome for each surface ([ADR 0028](../_adr/0028-result-envelope-and-diagnostics.md)).

## The serialized envelope

`serializeResult` emits the wire keys that are present on a result:

| Field              | Role                                                              |
| ------------------ | ----------------------------------------------------------------- |
| `ok`, `verb`       | Universal success flag and verb discriminator.                    |
| `dry_run`, `plan`  | A preview and the steps it would apply.                           |
| `steps`            | Applied steps with outcomes, duration, and output metadata.       |
| `diagnostics`      | Normalized failures with a reproduce command and captured output. |
| `data`             | The schema-backed payload for one verb.                           |
| `hints`            | Advisory next actions that never decide success.                  |
| `error`, `message` | A stable refusal slug and human explanation.                      |

The shared renderers consume `EnginePlan` and `StepResult`; verb-specific human views may add presentation, but they read the settled result fields.

## Runtime schemas and enrollment

[`result_schemas.ts`](../../../src/shared/result_schemas.ts) defines a strict Zod envelope, every verb's `data` schema, and the output schema that combines them. A verb core types its payload as `z.infer` from that schema, so drift becomes a compile error. MCP uses those same output schemas for `structuredContent`, and the SDK validates each tool result at runtime ([ADR 0041](../_adr/0041-self-describing-mcp-surface.md)).

[`result_contracts.ts`](../../../src/shared/result_contracts.ts) is the public-contract registry. Each entry maps a command path and literal verb to its output schema, with an MCP tool name where the command is exposed. The faithfulness suite runs real cores and validates their serialized output. Its enrollment check requires every registered contract to have a test or explicit debt status; an MCP contract cannot sit in debt.

## Generated consumer contracts

`deno task codegen` projects the registry into:

- [`schema/discern-results.schema.json`](../../../schema/discern-results.schema.json), whose entry points cover CLI results and MCP tool wrappers;
- [`types/discern-json.d.ts`](../../../types/discern-json.d.ts), including lookup maps by verb, command, and MCP tool.

Runtime schemas remain strict. The generated JSON Schema permits additive object fields so an older consumer can accept a compatible later release. [`result_codegen_test.ts`](../../../tests/result_codegen_test.ts) fails when committed artifacts or command enrollment drift ([ADR 0097](../_adr/0097-publish-json-result-contracts.md)).

## Protocol adapters

[`server.ts`](../../../src/engine/mcp/server.ts) exposes thin adapters over result-returning cores. A tool returns human `content`, schema-validated `structuredContent`, and `isError`; it does not implement a second result path. Tool annotations record whether a call is read-only or destructive. Surface-parity tests tie tool names, schemas, and CLI verbs back to their registries.

The public caller contract belongs in [MCP tools and results](../70-reference/mcp-and-results.md). This page owns the implementation seams that keep that contract accurate.

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

- `steps` and `plan` are mutually exclusive on the wire. A preview cannot claim applied outcomes.
- Full job output is a best-effort OS temporary artifact. Registered artifacts age out after 24 hours; failure to write or reap one cannot change a job's result.
- A new JSON-emitting command needs registry enrollment, a per-verb schema, faithfulness coverage, and regenerated artifacts. MCP exposure also needs the server adapter and surface-parity coverage.
- The relevant source files contain no unfinished-work markers for result-contract behavior.
