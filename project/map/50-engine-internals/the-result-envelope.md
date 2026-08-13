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

_Every verb builds one result object. Types, runtime validation, generated contracts, and protocol adapters converge on it._

[`result.ts`](../../../src/shared/result.ts) defines plans, executed steps, diagnostics, and `DiscernResult<TData>`. Human output, `--json`, and the Model Context Protocol (MCP) render that one object ([ADR 0028](../_adr/0028-result-envelope-and-diagnostics.md)).

## Human CLI groups

Human views declare stable `HumanOutputGroup<T>` ids. `renderHumanOutputGroups` omits empty groups and separates populated ones; plans use `PlanStep.group`, live output uses `Out.group` or `Logger.group`, and labels draw headings. discern owns picker groups: `groupedSelectOptions` gives every populated group, including the first, a non-selectable package heading. The package owns terminal I/O, editing, frames, and restoration; `withPromptBoundary` adds one blank outside redraw accounting ([ADR 0250](../_adr/0250-discern-managed-human-output-declares-semantic-groups.md)).

Plan and result renderers preserve step order. When a `PlanStep.group` value returns after another group, the renderer opens another visible run and qualifies its non-rendered ID by occurrence. Directly authored `HumanOutputGroup` IDs reject duplicates.

Boundaries mark changes in meaning; a homogeneous list stays one group. Machine protocols, scalar stdout, document bodies, framed tables, and project-owned streams retain their own structure.

The Git-derived [`human_output_grouping_test.ts`](../../../tests/human_output_grouping_test.ts) rejects local spacing, direct prompt separators, and Cliffy prompt calls that bypass the shared boundary across authored TypeScript. Imported Cliffy classes enroll by structure, including aliases and new prompt kinds. Renderer tests cover recurring plan and result groups. Behavior tests cover plan stages, status regions, desk buckets, and every improvement category.

## Step-label ownership

[`BUILT_IN_STEP_LABELS`](../../../src/shared/result.ts) owns the stable labels for operations discern performs. Its values use kebab-case. Human output, JSON, MCP results, the Logbook, and the execution model consume those same values.

Configured job, scope, standard, resource, command, and path identifiers stay outside the registry. `verbatimStepLabel` marks that boundary in TypeScript and preserves the configured spelling on every output surface.

[`built_in_step_labels_test.ts`](../../../tests/built_in_step_labels_test.ts) checks the registry's spelling and scans the Git-derived authored-TypeScript universe for inline static labels at `PlanStep` construction sites. The `StepLabel` type also rejects a static string routed through a file-local constant. Test modules are outside the structural scan because they construct forbidden fixtures and cannot emit product results. A new built-in operation must enroll in the registry; a project-owned identifier must enter through `verbatimStepLabel`.

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

A runnable discern command inside a hint uses a typed reference ([ADR 0217](../_adr/0217-envelope-command-references-render-per-surface.md)). [`command_reference.ts`](../../../src/shared/command_reference.ts) owns the constructors, the token grammar, and one renderer per surface: over MCP a tool-backed command names the tool with its arguments as parameters, a verb with no tool is an explicit shell instruction, and an owner-relayed command keeps the CLI spelling every caller reads on the CLI. `fire` resolves the CLI spelling and keeps the authored form beside the fired hint; the MCP boundary re-renders from it before the envelope is observed, recorded, and rendered. Hint identity stays the registry id on both surfaces, and `serializeResult` refuses an unresolved token.

## Runtime schemas and enrollment

[`result_schemas.ts`](../../../src/shared/result_schemas.ts) owns the strict envelope and each verb's data and output schemas. Verb cores infer payload types from it; MCP validates `structuredContent` against it ([ADR 0041](../_adr/0041-self-describing-mcp-surface.md)).

[`result_contracts.ts`](../../../src/shared/result_contracts.ts) maps command paths, literal verbs, and MCP tools to output schemas. Faithfulness tests execute real cores. Every entry needs coverage or explicit debt; MCP debt is forbidden.

## Generated consumer contracts

`deno task codegen` projects the registry into:

- [`schema/discern-results.schema.json`](../../../schema/discern-results.schema.json), whose entry points cover CLI results and MCP tool wrappers;
- [`types/discern-json.d.ts`](../../../types/discern-json.d.ts), including lookup maps by verb, command, and MCP tool.

Runtime schemas stay strict. The generated schema admits additive fields and publishes current error slugs as metadata, so an older version-1 consumer accepts a compatible release ([ADR 0208](../_adr/0208-public-contracts-version-by-schema-major.md)). [`result_codegen_test.ts`](../../../tests/result_codegen_test.ts) fails when committed artifacts or command enrollment drift ([ADR 0097](../_adr/0097-publish-json-result-contracts.md)).

## Protocol adapters

[`server.ts`](../../../src/engine/mcp/server.ts) adapts result cores to MCP `content`, `structuredContent`, `isError`, and effect annotations without duplicating outcome logic. Parity tests bind tools, schemas, and verbs. `MCP_SHELL_ONLY_VERBS`, declared beside `TOOLS` with a reason per member, records the verbs without a tool. The parity guard reconciles the registries against the verb vocabulary. Caller behavior belongs in [MCP tools & results](../70-reference/mcp-and-results.md).

The MCP instructions render the policies required on that surface from the operating-policy registry. The guidance templates remain authored Markdown. The parity guard checks each required policy with its registered probes. Adding a policy enrolls both surfaces in the same test ([ADR 0214](../_adr/0214-mcp-instructions-render-operating-policies.md)).

## Where it lives in code

| Concern                           | Source                                                                                                                                                                                                            |
| --------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Result and renderer vocabulary    | [`result.ts`](../../../src/shared/result.ts)                                                                                                                                                                      |
| Human output adapters             | [`output.ts`](../../../src/engine/output.ts), [`log.ts`](../../../src/lib/log.ts), [`prompts.ts`](../../../src/lib/prompts.ts)                                                                                    |
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
