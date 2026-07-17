# ADR 0038: The MCP server runs on the official TypeScript SDK over stdio

> **Vocabulary amendment ([ADR 0120](0120-launch-verb-canon.md)):** Current tool pointers use `discern_map` (formerly `discern_docs`) and `discern_accept` (formerly `discern_graduate`); the decision and reasoning are unchanged.

**Status**: accepted

## Context

`discern mcp` exposes the verbs to a coding agent over the Model Context Protocol — the third rendering of the one result spine ([ADR 0028](0028-result-envelope-and-diagnostics.md)), where every verb's `DiscernResult` becomes a tool result. The first implementation was a hand-rolled JSON-RPC 2.0 loop: ~480 lines that framed newline-delimited messages off `Deno.stdin`, dispatched `initialize`/`ping`/`tools/list`/`tools/call` by hand, and managed protocol-version negotiation itself. Its stated reason for existing — written into the file — was to avoid an SDK dependency "to keep discern one self-contained binary."

That rationale was never tested; it was an assumption. We are about to deepen the MCP integration substantially (newer spec features beyond a like-for-like tool surface), which means tracking the formal protocol closely. A hand-rolled wire layer makes every spec revision our maintenance burden: version negotiation, the handshake, framing, error shapes, and whatever the next revision adds. The canonical conformance source is the official TypeScript SDK (`@modelcontextprotocol/sdk`), and the question was whether adopting it is even possible under discern's hard constraint of shipping as one self-contained `deno
compile` binary with no runtime and no network.

We verified it empirically before deciding (SDK v1.29.0, Deno 2.8.3):

- The SDK imports and runs under Deno via `npm:` specifiers; the historical `StdioServerTransport` `Buffer` incompatibility is gone.
- `deno compile` bakes it into a standalone binary that runs with **no Deno present** and under discern's least-privilege permission set (`--allow-read/write/env/run`) — no extra permissions, no network at runtime.
- It speaks the current spec revision (`2025-11-25`) natively.
- The project's existing jsr `@zod/zod` is instance-compatible with the SDK's bundled npm `zod` (Zod v4's standard-schema interface bridges the two), so tool input schemas use the zod we already depend on.

The premise behind the hand-rolled loop — that the SDK would cost us the single-binary property — is therefore false.

## Decision

`discern mcp` runs on the official MCP TypeScript SDK: a `McpServer` connected to the SDK's `StdioServerTransport`. discern owns only the **tool table** (each entry a thin adapter over a verb's `…Result()` core) and the **result rendering** (`serializeResult` → `{ content, structuredContent, isError }`); the SDK owns the JSON-RPC framing, the `initialize`/`ping` handshake, protocol-version negotiation, and tool dispatch. The hand-rolled wire layer is deleted.

The transport stays **stdio only**. discern is a local, zero-daemon tool that runs where the agent runs; it has no reason to listen on a network. We deliberately do **not** adopt the SDK's Streamable HTTP transport or its OAuth/auth surface, now or later.

Specifics worth recording:

- **Argument-less verbs register no input schema.** The SDK skips argument validation when a tool declares no schema, so those calls are accepted whether or not the client sends an (empty) `arguments` object. Verbs that take arguments register a Zod raw shape (all fields optional) and therefore require an `arguments` object on the call — which conformant clients always send.
- **Feature-gated tools are simply not registered** when their feature is off (`discern_map`, `discern_accept`). They are absent from `tools/list`, and a call to one gets the SDK's standard "tool not found" error result — replacing the old bespoke `feature_disabled` envelope. The per-call `not_initialized` envelope (no `discern.toml`) is preserved inside each handler.
- **stdin EOF is bridged to a clean shutdown.** The SDK's stdio transport closes only on an explicit `close()`, not on stdin EOF, so the server listens for stdin `end` and closes the transport — otherwise the top-level await would deadlock when the client closes the pipe.
- **`node:process` is imported through an aliased import-map entry** (`"process"`), satisfying the `no-external-import` and `no-process-global` lint rules.

## Consequences

- **Spec conformance is no longer our code to maintain.** The handshake, framing, negotiation, and error shapes track the SDK; deepening the integration is a matter of using SDK features, not re-implementing protocol. The advertised revision jumps from `2025-06-18` to `2025-11-25` at no cost.
- **The dependency surface grows and cannot be trimmed.** The SDK pulls ~70 transitive npm packages (express, hono, jose, ajv, cors, …) for its HTTP + OAuth server side, which stdio never touches. They are inert at runtime (no network; runs under least privilege), but `deno compile` **bundles the whole npm package regardless of which subpath is imported** — we measured a stdio-only import and an HTTP-only import producing a byte-identical 14.22 MB bundle, with express's `http-errors` present in the stdio-only graph. So importing only `server/stdio.js` shaves nothing; the only way to shed those deps is to fork the SDK, which would forfeit the zero-maintenance conformance that is the entire point of adopting it. We accept the cost: ~15 MB of binary growth (69 MB → 84 MB), modest against a Deno runtime floor that is already ~69 MB. "One self-contained binary" still holds — proven by compiling and running with no Deno present.
- **The tests are conformant-client tests.** The SDK strictly validates the `initialize` params (`protocolVersion`/`capabilities`/`clientInfo` all required), so the engine MCP tests send a full handshake; the test that exercised the old loop's un-terminated-final-line draining is removed, because framing is now the SDK's `ReadBuffer`.

## Alternatives considered

- **Keep the hand-rolled wire, import only SDK types.** Preserves the lean dependency graph but keeps protocol conformance as our maintenance burden — the exact cost we are trying to shed ahead of a deeper integration. Strictly worse than today once the integration grows.
- **Fork/patch the SDK to strip the HTTP + auth modules.** The only way to actually trim the ~15 MB. Rejected: it re-introduces per-upgrade maintenance and throws away the canonical-conformance benefit that justifies the SDK at all — a bad trade for 15 MB against a 69 MB floor.
