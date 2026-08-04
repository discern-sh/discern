# Scope: 70-reference

Read [`project/map/_internal/documenter-agent-brief.md`](../documenter-agent-brief.md) first.

## What this subtree documents

The public reference tier for discern's commands, configuration, environment variables, MCP results, written files, supported platforms, prerequisites, and worktree identity values. The neighboring guides explain workflows; this tier states the contracts readers need to verify them.

## Files to produce

| File                       | Topic                                                                                        |
| -------------------------- | -------------------------------------------------------------------------------------------- |
| `README.md`                | Public 200–350-word overview and curated reading order.                                      |
| `cli-reference.md`         | Generated command, subcommand, flag, and command-alias reference.                            |
| `config-reference.md`      | Generated `discern.toml` section, key, type, default, and key-alias reference.               |
| `environment-variables.md` | Generated public `DISCERN_*` names, grouped purpose, and short descriptions.                 |
| `mcp-and-results.md`       | Public MCP tools, resources, result-envelope wrapper, published schemas, and CLI exit codes. |
| `artifact-ownership.md`    | Approved Files & ownership exemplar, relocated without re-styling.                           |
| `platforms-and-prereqs.md` | Supported release targets, required tools, identity selectors, and tokens.                   |

## Source files to read

- `src/shared/cli_reference_codegen.ts`, `src/shared/config_codegen.ts`, `src/shared/environment_variables.ts`, and `scripts/codegen.ts` (generated references)
- `tests/cli_reference_codegen_test.ts`, `tests/config_codegen_test.ts`, and `tests/environment_variables_codegen_test.ts` (generated-output guards)
- `src/engine/mcp/server.ts`, `src/shared/result.ts`, and `src/shared/result_contracts.ts` (public MCP/result interface)
- `schema/discern-results.schema.json` and `types/discern-json.d.ts` (published result contracts)
- `install.sh`, `scripts/build.ts`, and `src/commands/doctor.ts` (platforms and prerequisites)
- `src/shared/env.ts`, `src/engine/worktree/identity.ts`, `src/engine/worktree/tokens.ts`, and `src/engine/worktree/resources.ts` (environment and identity contract)

## Area owned

- The `70-reference` map path and its ordering, metadata, and lookup aliases.
- Generated reference targets and their codegen drift guards.
- The public MCP/result contract and platform/prerequisite inventory.

## Existing-doc content to preserve

`artifact-ownership.md` is an approved exemplar. Preserve its register and body; change only its location, metadata, and links required by the move.

## Known overlaps / handoffs

- **`../10-getting-started/`** owns installation, setup, and upgrade tasks. Link to reference pages rather than retaining reference leaves there.
- **`../30-worktrees/`** owns the identity lifecycle and resource guides. This tier keeps the selector, env, and token lookup tables.
- **`../50-engine-internals/`** owns result-schema and MCP implementation details. Keep only caller-visible contracts here.
- **`../60-agent-integrations/`** owns provider-specific setup files and trust behavior. Files & ownership links to those exact inventories.

## Length-budget note

The README uses the 200–350-word overview budget. Reference leaves are unbudgeted and must remain scannable through headings and tables.
