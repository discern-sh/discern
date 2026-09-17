# Scope: 70-reference

Read [`project/map/_internal/documenter-agent-brief.md`](../documenter-agent-brief.md) first.

## What this subtree documents

The public reference tier for discern's commands, configuration, environment variables, Model Context Protocol (MCP) results, written files, supported platforms, prerequisites, and worktree identity values. Neighboring guides explain workflows; this tier states the contracts readers use to verify them.

## Files to produce

| File                              | Shape     | Topic                                                                                                             |
| --------------------------------- | --------- | ----------------------------------------------------------------------------------------------------------------- |
| `README.md`                       | overview  | Public front door and curated reading order.                                                                      |
| `setup-command-boundaries.md`     | reference | Exact ownership boundary among setup, refresh, upgrade, and doctor.                                               |
| `worktree-setup-step-recovery.md` | reference | Recovery contract for interrupted external setup steps in a new worktree.                                         |
| `checkpoint-when-protocol.md`     | reference | Syntax and matching semantics for checkpoint change triggers.                                                     |
| `checkpoint-state.md`             | reference | Persisted checkpoint answer, variance, and invalidation fields.                                                   |
| `result-surfaces.md`              | reference | Terminal, Markdown, JSON, and MCP projections of one prepared result.                                             |
| `mcp-and-results.md`              | reference | Public MCP tools, resources, result-envelope wrapper, published schemas, and CLI exit codes.                      |
| `compatibility-policy.md`         | reference | The public compatibility policy's registry, comparators, baseline, guard, and evolving-member mechanics.          |
| `mcp-call-duration.md`            | reference | Duration fields and timing boundaries exposed by MCP calls.                                                       |
| `progress-and-reconnect.md`       | reference | Live progress facts, the producer progress protocol, and the handle that reads a long operation back.             |
| `proof-note-format.md`            | reference | Wire format, identifiers, and validation contract for Proof notes.                                                |
| `artifact-ownership.md`           | reference | Approved Files and ownership exemplar; preserve its register and update only required links or location metadata. |
| `temp-files-and-retention.md`     | reference | Temporary artifact locations, ownership, and retention policy.                                                    |
| `crash-reports.md`                | reference | Crash-report contents, storage, redaction, and recovery contract.                                                 |
| `logbook-lifecycle.md`            | reference | Creation, retention, repair, and deletion lifecycle of Logbook data.                                              |
| `the-logbook.md`                  | reference | Public field and event reference for the Logbook record.                                                          |
| `platforms-and-prereqs.md`        | reference | Supported release targets, required tools, identity selectors, and tokens.                                        |

## Source files to read

- `src/shared/cli_reference_codegen.ts`, `src/shared/config_codegen.ts`, `src/shared/environment_variables.ts`, and `scripts/codegen.ts` (generated references)
- `tests/cli_reference_codegen_test.ts`, `tests/config_codegen_test.ts`, and `tests/environment_variables_codegen_test.ts` (generated-output guards)
- `src/engine/mcp/server.ts`, `src/shared/result.ts`, `src/shared/result_contracts.ts`, `src/shared/result_markdown.ts`, and `src/shared/result_wire.ts` (public MCP/result interface)
- `schema/discern-results.schema.json` and `types/discern-json.d.ts` (published result contracts)
- `install.sh`, `scripts/build.ts`, and `src/commands/doctor.ts` (platforms and prerequisites)
- `src/shared/env.ts`, `src/engine/worktree/identity.ts`, `src/engine/worktree/tokens.ts`, and `src/engine/worktree/resources.ts` (environment and identity contract)

## Area owned

- The `70-reference` Map path and its ordering, metadata, and lookup aliases.
- Generated reference targets and their codegen drift guards.
- The public MCP and result contract plus the platform and prerequisite inventory.

## Existing-doc content to preserve

`artifact-ownership.md` is an approved exemplar. Preserve its register and body; change only location metadata and links required by a move.

## Known overlaps / handoffs

- **`../10-getting-started/`** owns installation, setup, and upgrade tasks. Link to reference pages rather than retaining reference leaves there.
- **`../30-worktrees/`** owns the identity lifecycle and resource guides. This tier keeps the selector, environment, and token lookup tables.
- **`../50-engine-internals/`** owns result-schema and MCP implementation details. Keep only caller-visible contracts here.
- **`../60-agent-integrations/`** owns provider-specific setup files and trust behavior. Files and ownership links to those exact inventories.

## Length-budget note

The declared page shapes use the defaults in [`page-templates.md`](../page-templates.md); no local numeric exception is declared.
