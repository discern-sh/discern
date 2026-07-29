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

Before serialization, the CLI and MCP keep any registered `next-step` hint already present and add the registry's `failure-recovery` floor when none exists. `serializeResult` rejects a failed envelope that still lacks a registered actionable hint.

A runnable discern command inside a hint is a typed reference, never prose ([ADR 0217](../_adr/0217-envelope-command-references-render-per-surface.md)). [`command_reference.ts`](../../../src/shared/command_reference.ts) owns the constructors, the token grammar, and one renderer per surface. `fire` resolves references to the CLI spelling and keeps the authored form beside the fired hint; the MCP completion boundary re-renders from that form — tool spellings with parameters, CLI spellings for owner-relayed commands, and an explicit shell instruction for a verb with no tool — before the envelope is observed, recorded, and rendered. Recorded hint identity stays the registry id on both surfaces. `serializeResult` also refuses a hint that still carries an unresolved reference token.

## Runtime schemas and enrollment

[`result_schemas.ts`](../../../src/shared/result_schemas.ts) owns the strict envelope and each verb's data and output schemas. Verb cores infer payload types from it; MCP validates `structuredContent` against it ([ADR 0041](../_adr/0041-self-describing-mcp-surface.md)).

[`result_contracts.ts`](../../../src/shared/result_contracts.ts) maps command paths, literal verbs, and MCP tools to output schemas. Faithfulness tests execute real cores. Every entry needs coverage or explicit debt; MCP debt is forbidden.

## Generated consumer contracts

`deno task codegen` projects the registry into:

- [`schema/discern-results.schema.json`](../../../schema/discern-results.schema.json), whose entry points cover CLI results and MCP tool wrappers;
- [`types/discern-json.d.ts`](../../../types/discern-json.d.ts), including lookup maps by verb, command, and MCP tool.

Runtime schemas stay strict. The generated schema admits additive fields and publishes current error slugs as metadata, so an older version-1 consumer accepts a compatible release ([ADR 0208](../_adr/0208-public-contracts-version-by-schema-major.md)). [`result_codegen_test.ts`](../../../tests/result_codegen_test.ts) fails when committed artifacts or command enrollment drift ([ADR 0097](../_adr/0097-publish-json-result-contracts.md)).

## Protocol adapters

[`server.ts`](../../../src/engine/mcp/server.ts) adapts result cores to MCP `content`, `structuredContent`, `isError`, and effect annotations without duplicating outcome logic. Parity tests bind tools, schemas, and verbs. `MCP_SHELL_ONLY_VERBS`, declared beside the `TOOLS` table with a reason per member, records the verbs deliberately left without a tool; the parity guard reconciles the two halves against the whole verb vocabulary, and the hint renderer's shell-instruction fallback covers exactly the declared set. Caller behavior belongs in [MCP tools & results](../70-reference/mcp-and-results.md).

The MCP instructions render the policies required on that surface from the operating-policy registry. The guidance templates remain authored Markdown. The parity guard checks each required policy with its registered probes. Adding a policy enrolls both surfaces in the same test ([ADR 0214](../_adr/0214-mcp-instructions-render-operating-policies.md)).

## Where it lives in code

| Concern                           | Source                                                                                                                                                                                                            |
| --------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Result and renderer vocabulary    | [`result.ts`](../../../src/shared/result.ts)                                                                                                                                                                      |
| Envelope serialization            | [`result_serialization.ts`](../../../src/shared/result_serialization.ts)                                                                                                                                          |
| Command references and renderers  | [`command_reference.ts`](../../../src/shared/command_reference.ts), guarded by [`hint_surface_rendering_test.ts`](../../../tests/hint_surface_rendering_test.ts)                                                  |
| Strict runtime schemas            | [`result_schemas.ts`](../../../src/shared/result_schemas.ts)                                                                                                                                                      |
| Command and MCP contract registry | [`result_contracts.ts`](../../../src/shared/result_contracts.ts)                                                                                                                                                  |
| Generated contract builder        | [`result_codegen.ts`](../../../src/shared/result_codegen.ts)                                                                                                                                                      |
| MCP adapters                      | [`server.ts`](../../../src/engine/mcp/server.ts)                                                                                                                                                                  |
| Operating policy registry         | [`operating_policies.ts`](../../../src/shared/operating_policies.ts)                                                                                                                                              |
| Contract and policy faithfulness  | [`result_schemas_test.ts`](../../../tests/result_schemas_test.ts), [`result_codegen_test.ts`](../../../tests/result_codegen_test.ts), [`agent_policy_parity_test.ts`](../../../tests/agent_policy_parity_test.ts) |

## Current state & gotchas

- `steps` and `plan` are mutually exclusive. A fail-fast sibling is `cancelled`; a configured step that did not run is `skipped`.
- Full job output is a best-effort OS temporary artifact. Registered artifacts become eligible for removal after 24 hours. One repository-shared sweep runs at most hourly, inspects and removes at most 500 entries per page, and carries a cursor across pages; failure to write or reap an artifact cannot change a job's result ([ADR 0117](../_adr/0117-temp-output-artifacts-are-reaped-by-age.md), [ADR 0216](../_adr/0216-temp-retention-is-repository-throttled-and-inspection-bounded.md)).
- A new JSON-emitting command needs registry enrollment, a per-verb schema, faithfulness coverage, and regenerated artifacts. MCP exposure also needs the server adapter and surface-parity coverage.
