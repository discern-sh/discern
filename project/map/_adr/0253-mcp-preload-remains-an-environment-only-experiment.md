# ADR 0253: MCP startup loading remains an environment-only experiment

**Status**: accepted; extends the self-describing surface of [ADR 0041](0041-self-describing-mcp-surface.md), the shared `.mcp.json` writer of [ADR 0074](0074-co-owned-mcp-json.md), and the instruction registry of [ADR 0214](0214-mcp-instructions-render-operating-policies.md).

## Context

Some MCP clients keep tool schemas out of the model's initial context and reveal them through search. Discern's first response was portable: put the core lifecycle first in the server instructions, keep those instructions within the smallest known client budget, and make `discern_status` the named gateway whose result points to the next tool.

Startup-loading controls do not have the same portability. Claude Code supports per-tool Anthropic metadata and a whole-server `alwaysLoad: true` field. GitHub Copilot CLI supports a whole-server `deferTools: "never"` field but no per-tool equivalent. Gemini already exposes every enabled schema. Codex and Cursor have no documented server-originated eager override. Copilot in VS Code has no documented server field. The two known whole-server fields can coexist in the shared `.mcp.json` in tested client versions, but that is client behavior rather than an MCP contract.

An earlier, unlanded implementation put `[mcp].always_load` in every project's config and added an Anthropic toggle to the MCP tool registry. That made one provider's implementation detail look like a stable discern feature and gave a project-wide boolean semantics the supported clients cannot share.

## Decision

The bounded startup instructions and canonical lifecycle remain part of discern's MCP contract. They are provider-neutral and useful whether a client exposes schemas eagerly or through search.

Discern publishes no provider-specific startup metadata in `tools/list`. The per-tool `anthropic/alwaysLoad` capability and its `discern_status` default are removed.

Discern exposes no MCP startup-loading setting in `discern.toml`, its template, schema, generated reference, or feature canon.

Whole-server startup loading remains available only as an environment experiment:

- `DISCERN_EXPERIMENTAL_MCP_PRELOAD=1` enables it. No other value does.
- If Claude Code is configured, refresh writes `"alwaysLoad": true` to discern's shared `.mcp.json` entry.
- If GitHub Copilot is configured, refresh writes `"deferTools": "never"` to the same entry.
- If both are configured, either provider registration order writes both fields and the second writer is a no-op.
- Other provider files receive neither field.
- A later refresh without the enabled experiment removes both fields.

The variable belongs to a canonical registry of experimental environment names. Its guard scans authored TypeScript for unregistered names, checks the internal experiment page against the registry, and exercises the activation value. Provider and refresh tests bind the registered switch to every supported projection.

Experimental behaviors are documented on one engine-internals page rather than the public integration and configuration surfaces. They are not a compatibility promise. A later decision may remove this behavior or promote it to a supported feature if provider controls converge.

## Consequences

- Every project keeps the previous MCP configuration by default. No new `discern.toml` table or generated config surface ships.
- Power users can evaluate eager schema exposure across the two clients with known server controls without hand-editing the discern-owned entry after each refresh.
- The shared writer still produces one order-independent entry. A project configured for only one of the two providers receives only that provider's field.
- The environment value is local, while `.mcp.json` is committed. A refresh in an environment where the experiment is off removes the fields, so this is unsuitable as durable team policy.
- Client changes can invalidate the tested field behavior. Keeping the seam experimental makes removal a local code-and-doc change rather than a config migration.

## Alternatives considered

- **Keep `[mcp].always_load`.** Rejected because the boolean suggests provider parity and adds a vendor-driven concept to every project's stable config.
- **Keep a per-tool provider metadata toggle.** Rejected because only one supported provider implements it and only one discern tool used it.
- **Load every tool by default.** Rejected because it imposes context and startup cost on all sessions and changes behavior for users who did not ask for it.
- **Remove startup-loading support entirely.** Rejected for now because the environment seam provides useful evaluation evidence for two supported clients without committing discern to a public interface.
