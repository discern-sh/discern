# ADR 0097: Publish generated JSON result contracts

**Status**: accepted; extends [ADR 0028](0028-result-envelope-and-diagnostics.md) and [ADR 0041](0041-self-describing-mcp-surface.md)

## Context

discern already treats `DiscernResult` as the one machine-readable result shape: the CLI's `--json` output and MCP `structuredContent` both serialize the same object. ADR 0041 made the MCP surface self-describing by backing each tool with a Zod output schema and a faithfulness test, but that contract remained internal. End users writing TypeScript integrations, CI helpers, or MCP-aware wrappers had to infer result shapes from examples or from source files.

The repo also has a successful precedent for public generated artifacts: `deno task codegen` publishes the config JSON Schema and config reference from the canonical config schema, and tests fail when committed artifacts drift. A result contract needs the same discipline. Hand-written public types would be especially risky here because a stale MCP output schema is not just inaccurate: the SDK validates every tool result against it.

There are two extra wrinkles. First, several CLI-only commands emit JSON but are not MCP tools (`setup`, `upgrade`, `preset`, `config`, `skills`, worktree subcommands). Second, not every CLI command path emits a `DiscernResult` JSON object at all (`identity`, `mcp`, hook plumbing, and config read helpers), so a public "all commands" artifact needs explicit exclusions rather than silence.

## Decision

discern publishes generated public result contracts:

- `schema/discern-results.schema.json` is the language-neutral contract for CLI `--json` results and MCP tool-result wrappers.
- `types/discern-json.d.ts` is the standalone TypeScript view generated from the same registry.

The source of truth is a registry in `src/shared/result_contracts.ts`. Each contract names its stable id, the CLI command path(s), the literal serialized `verb`, the Zod output schema, and the MCP tool name when one exists. The registry also carries the explicit list of CLI command paths that intentionally do not publish a `DiscernResult` JSON contract.

Public output schemas use literal `verb` values. Consumers can switch on `result.verb` and get a real discriminated union. The generated TypeScript file also exposes lookup maps by serialized verb, by CLI command path, by MCP `structuredContent` tool name, and by full MCP tool-result wrapper.

The JSON Schema root accepts either a CLI `DiscernResult` or an MCP tool-result wrapper. It also publishes named `DiscernCliJsonResult` and `DiscernMcpJsonResult` union entrypoints under `$defs`; `x-discern-contracts` maps each CLI command path and MCP tool back to the relevant per-result schema. The CLI union includes a discriminator mapping on `verb` for tooling that understands that extension, while plain JSON Schema consumers can still choose a specific per-verb `$defs` entry themselves.

The public JSON Schema is compatibility-open for output objects: codegen strips `additionalProperties: false` markers that come from strict runtime Zod objects, while preserving map value schemas expressed through `additionalProperties`. Runtime and MCP validation remain strict because they still use the original Zod schemas. This keeps accidental extra runtime fields visible in tests and MCP validation, without making additive public output fields a breaking change for consumers pinned to an older schema.

`deno task codegen` writes the result schema and TypeScript definitions alongside the existing config artifacts. Tests assert that:

- the committed artifacts match the generator;
- every public result schema has the expected literal `verb`;
- public verb values use the CLI's space-separated command vocabulary rather than colon-delimited subcommands;
- the public JSON Schema omits closed-object `additionalProperties: false` markers;
- the schema root reaches both the CLI and MCP union entrypoints;
- every registered CLI command path is either covered or explicitly excluded;
- every MCP tool uses the same output schema the public registry publishes.

The explicit noes:

- **No hand-written public TypeScript types.** They would become a second contract to maintain.
- **No source scanning as the contract.** The registry is the public decision point; tests tie it to the command tree and MCP table.
- **No contract for non-JSON plumbing commands.** Hook entry points and plain config read helpers keep their narrow text/stdio contracts.

## Consequences

TypeScript and non-TypeScript consumers get a deterministic contract for discern's machine output. The schema remains useful outside npm/JSR, while the `.d.ts` gives TypeScript users a zero-runtime-dependency view.

Adding or renaming a JSON-emitting command now has another required step: enroll it in the result-contract registry, or explicitly exclude it if it does not publish a `DiscernResult`. The gate makes that choice visible instead of letting the public artifact drift behind the CLI.

The public schema is intentionally a little wider than some happy-path result cores because the top-level CLI can emit `invalid_config`/`invalid_toml` refusals before a verb core runs. That shared refusal remains part of the published CLI contract even when MCP reaches the same core through a different preflight path.

The public schema is also intentionally wider than the runtime Zod schemas for additive object fields. That is the output-contract compatibility policy: consumers validate the fields they understand, while newer discern releases can add fields without turning an older pinned schema into a rejection machine.

The generated TypeScript file is verbose because it is standalone and repeats structural envelope fields rather than importing internal Zod types. That verbosity is acceptable for a generated artifact: it avoids a runtime dependency and keeps the public contract readable from one file.

## Alternatives considered

**Publish TypeScript first from `z.infer` aliases.** This would be compact, but it makes the public artifact depend on internal module paths and Zod. JSON Schema is the more portable canonical artifact.

**Generate from the Cliffy command tree automatically.** The command tree knows names and flags, not the emitted payload shape. It also cannot distinguish a global `--json` option that a helper ignores from a real `DiscernResult` surface. The registry plus parity test is more honest.

**Only publish MCP schemas.** MCP was the easiest surface because it was already schema-backed, but CLI `--json` is the broader public contract. Publishing only MCP would leave CI and shell integrations guessing.
