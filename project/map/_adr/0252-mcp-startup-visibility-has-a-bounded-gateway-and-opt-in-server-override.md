# ADR 0252: MCP startup visibility has a bounded gateway and an opt-in server override

**Status**: accepted; extends the self-describing surface of [ADR 0041](0041-self-describing-mcp-surface.md), the shared `.mcp.json` writer of [ADR 0074](0074-co-owned-mcp-json.md), and the instruction registry of [ADR 0214](0214-mcp-instructions-render-operating-policies.md).

## Context

discern exposes 17 MCP tools with typed input and output schemas. Claude Code now enables Tool Search by default: it puts tool names and server instructions into the initial context, while deferring most schemas until a search selects them. This is a Claude client policy layered over MCP. The protocol's `tools/list` response still carries complete definitions and gives each tool an open `_meta` object for vendor data.

The server instructions were 3,758 UTF-8 bytes. Claude Code truncates that field at 2KB. `discern_done` first appeared at byte 2,333; prepare, test, await, and accept followed it. The text meant to teach a schema-deferred client how to discover the lifecycle therefore lost the lifecycle at exactly the boundary where it mattered. The CLI remained fully visible and cheap to invoke, which gave an agent a rational reason to choose it over an MCP tool whose schema it had not discovered.

Loading all 17 schemas by default would reverse the failure at a permanent context cost. The frequently needed entry point is `discern_status`: it is read-only, orients the session, and its structured result names what is true and which MCP action comes next. A selective default and a project-wide escape hatch serve different users.

## Decision

**The MCP startup surface is a bounded gateway.** `MCP_CORE_LIFECYCLE` is the canonical sequence: status, start, prepare, test, done, update, await, accept. Server instructions name that lifecycle first and occupy fewer than `MCP_INSTRUCTIONS_BYTE_LIMIT` (2,048 UTF-8 bytes). A class guard checks both properties and proves itself against synthetic over-budget and out-of-order instructions. The tool listing derives its lifecycle prefix from the same sequence.

**Each tool has an internal Claude startup-loading toggle.** `McpTool.anthropicAlwaysLoad` is optional registry data. Registration maps a true value to `_meta["anthropic/alwaysLoad"] = true`; omission emits no vendor metadata. `discern_status` starts enabled. The tools/list test walks every registry member, so changing the boolean on another tool is the whole internal experiment and a new tool auto-enrols.

**Projects have one whole-server control.** `[mcp].always_load` is a typed boolean, off by default. When true, the shared stdio `.mcp.json` writer adds `"alwaysLoad": true` to `mcpServers.discern`; when false or absent, it removes the property. Claude Code and Copilot still co-own one byte-identical entry in either registration order. Cursor's separate `.cursor/mcp.json` and the other provider formats do not receive the property. The template and generated configuration reference expose the setting, and `discern refresh` projects a changed value into provider config.

The server does not detect its client or suppress the tool `_meta` for other clients. MCP reserves `_meta` for implementation-specific data, so clients that do not know Anthropic's key can ignore it. Users do not configure a per-tool list: discern owns the gateway defaults, while users choose only whether their project pays the context cost for the whole server.

## Consequences

- Claude Code sees `discern_status` without a Tool Search step and receives the complete lifecycle before its instruction cutoff.
- The other 16 schemas remain deferred by default. A project can load all of them with one config value, and can reverse that choice without hand-editing `.mcp.json` only to have refresh remove it.
- The 2KB budget is now a product contract. Adding an operating policy or capability pointer may require tightening existing prose before the gate accepts it.
- The per-tool toggle is intentionally vendor-named internal data. A second client's startup-loading mechanism would need its own mapped field rather than pretending the Anthropic key is portable behavior.
- Whole-server loading can increase startup latency and context use. That cost remains opt-in.

## Alternatives considered

- **Set `alwaysLoad: true` for every project.** Rejected because all 17 schemas would occupy every Claude Code session even though status is the only universal gateway.
- **Expose a user-configured list of eager tools.** Rejected because it leaks a volatile vendor optimization and tool inventory into project config. An internal boolean makes experiments cheap; one whole-server switch covers the legitimate user preference.
- **Rely on Tool Search with longer instructions.** Rejected because Claude Code truncates the field that tells the model what to search for.
- **Tell users to hand-edit `.mcp.json`.** Rejected because refresh owns the discern entry and correctly converges it back to config. The desired state belongs in `discern.toml` and the shared writer.
