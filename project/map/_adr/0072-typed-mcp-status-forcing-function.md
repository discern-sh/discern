# ADR 0072: A provider's MCP wiring is a typed status, accounted by a forcing function

**Status**: accepted; applies [ADR 0051](0051-canonical-set-parity.md) (every canonical set tied to its satellites) to the MCP seam of [ADR 0031](0031-typed-provider-integration.md), and builds on [ADR 0045](0045-mcp-is-core-infrastructure.md) (MCP is core infrastructure)

## Context

The provider registry modelled MCP wiring as `mcp?: McpIntegration` — optional, with a `// TODO(provider:codex)` comment where Codex's and Gemini's integrations would go. That is a **silent, unenforced gap**. Nothing distinguishes "this agent has no committable MCP mechanism" from "we haven't wired it yet"; nothing fails when a new agent is added with no MCP declaration at all; and the only record of the intended target file was prose in a comment. As discern goes from three agents to six — four of which _do_ have a committable MCP target that a later plan will wire — an unenforced optional field is exactly the drift ADR 0051 forbids: a member of a canonical set with no mechanical tie back to it.

## Decision

**`Provider.mcp` is a required, typed `McpStatus`, and a forcing-function test asserts every provider accounts for its MCP wiring.**

```ts
type McpStatus =
  | { kind: "wired"; integration: McpIntegration }
  | { kind: "pending"; targetFile: string } // committable, not yet authored
  | { kind: "none" }; // no committable MCP mechanism
```

- The field is **required**, so a new agent in `AGENT_NAMES` cannot compile without declaring its MCP status — the compile-time half of the forcing function (the strongest tie, ADR 0051).
- `pending` carries the **named committable target file** discern will write the server into once the integration is authored (`codex → .codex/config.toml`, `gemini → .gemini/settings.json`) — the intent that was a comment is now typed data the diagnostic and the test read.
- A parity test (`tests/agent_parity_test.ts`) is the runtime half: it loops the registry and asserts each provider is `wired`, `pending` with a real target file, or `none`. It **passes in this phase** (Claude wired; Codex and Gemini pending) and **tightens automatically**: a later plan flipping a `pending` to `wired` keeps it green with no edit — the set of pending shrinks, the invariant holds.
- `wiredMcp(provider)` is the one place "is this MCP wired?" is decided; the wirer registers only `wired` providers. `doctor` reports a `pending` MCP explicitly, with its target file, so the gap is visible rather than mistaken for a bug.

The explicit *no*s:

- **No vendor's `register()` is authored here.** Codex/Gemini MCP is Plan B. This is the typed status + the forcing function only; the `pending` marker names where the server will go, nothing more.
- **`none` is kept as a distinct state.** An agent that genuinely has no committable project-scoped MCP target is not the same as one whose wiring is merely pending; conflating them would make "accounted for" meaningless.

## Consequences

- **A new agent must account for its MCP, mechanically.** The required union field is a compile error if omitted; the parity test fails if a `pending` names no target. The silent TODO can't recur.
- **The diagnostic tells the truth.** `doctor` distinguishes wired from committable-but-pending (with the file), so an operator sees _why_ an agent's tools aren't there yet and what discern will wire.
- **The guard tightens itself as the vendors land.** B/C/D flip `pending → wired` and the test stays green automatically — the ADR 0051 payoff for this seam.
- **A small migration of the field's readers.** `wireProviderMcp` and `doctor` read `mcp.kind` / `wiredMcp` instead of a present `mcp?`; the registry entries gained a one-line status. No behaviour change for the wirer (pending is skipped, exactly as a present-but-absent `mcp?` was).

## Alternatives considered

- **Keep `mcp?` optional and add a separate `mcpPending` list.** Rejected: a second hand-maintained list is the drift ADR 0051 eliminates; one typed field per provider is the single source.
- **A boolean `mcpWired` plus a `mcpTarget` string.** Rejected: two fields that can contradict each other (wired _and_ a target? neither?) where a discriminated union makes the illegal states impossible to express.
- **Leave it a comment and rely on review.** Rejected outright — that is the status quo the gap came from; ADR 0051 exists because "a policy without a forcing function is a hope."
