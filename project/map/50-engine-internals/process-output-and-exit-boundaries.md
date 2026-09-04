---
title: Process output and exit boundaries
description: Locate the exact adapters that may write process streams or terminate the product process.
order: 58
aliases:
  - process output boundaries
  - process exit boundaries
  - Deno exit authority
  - stdout safety
---

# Process output and exit boundaries

_Every product byte and exit decision crosses a named composition edge; libraries return state upward._

[`PROCESS_OUTPUT_BOUNDARIES`](../../../src/shared/process_boundaries.ts) owns the only direct `console.*`, `Deno.stdout.write` or `writeSync`, and `Deno.stderr.write` or `writeSync` calls under `src/`. Each stable id identifies one operation within one enclosing function and states its channel, purpose, and reason. No module has blanket permission.

The ordinary route is higher-level. A verb builds `DiscernResult`; [`emitResult`](../../../src/shared/emit.ts) selects its JSON or Markdown projection. Human narration crosses [`Logger`](../../../src/lib/log.ts) or [`Out`](../../../src/engine/output.ts), both configured over the shared narration sink. Raw document bodies, shell-facing scalar values, and supervised child bytes cross the engine's stdout, stderr, or selected byte adapter only after their owning feature decides that raw output is the contract ([ADR 0344](../_adr/0344-process-egress-and-termination-have-exact-boundaries.md)).

[`PROCESS_EXIT_BOUNDARIES`](../../../src/shared/process_boundaries.ts) owns the direct `Deno.exit` population. The valid edges are Cliffy validation, recorded action dispatch, top-level dispatch, crash reporting, and signal restoration. Lower modules return a number, a result, or a typed refusal. [`CliRefusal`](../../../src/engine/logbook/cli.ts) lets a helper report expected failure without choosing a presentation or terminating the process.

The MCP server uses the same result cores with quiet `Logger` and runner instances. Project-command streams are piped or discarded; only the SDK's stdio transport writes protocol frames to stdout. [`engine_mcp_test.ts`](../../../tests/engine_mcp_test.ts) plants a successful repository command that attempts to log during a tool call. Any unframed line makes the protocol decoder fail.

[`process_boundaries.ts`](../../../scripts/process_boundaries.ts) scans the Git-derived `authored-ts` universe narrowed to `src/`. It follows the live local aliases and bound properties, rejects unknown calls, and rejects stale rows independently. The same validated run emits the `process_output_boundaries` and `process_exit_boundaries` metrics. Their falling standards hold the exact live registry sizes; removal lowers the populations permanently when pinned.

The rule covers production process egress under `src/`. Standalone scripts own their separate executable presentation surfaces.

## Where it lives in code

| Concern                           | Source                                                                                                                               |
| --------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------ |
| Exact output and exit registries  | [`process_boundaries.ts`](../../../src/shared/process_boundaries.ts)                                                                 |
| Structural scan and both metrics  | [`process_boundaries.ts`](../../../scripts/process_boundaries.ts)                                                                    |
| Engine output adapters            | [`output.ts`](../../../src/engine/output.ts)                                                                                         |
| Result projection                 | [`emit.ts`](../../../src/shared/emit.ts)                                                                                             |
| CLI refusal and action dispatch   | [`cli.ts`](../../../src/engine/logbook/cli.ts)                                                                                       |
| Crash and top-level dispatch      | [`main.ts`](../../../src/main.ts)                                                                                                    |
| Signal restoration                | [`process_signals.ts`](../../../src/engine/process_signals.ts)                                                                       |
| Planted structural and MCP guards | [`process_boundaries_test.ts`](../../../tests/process_boundaries_test.ts), [`engine_mcp_test.ts`](../../../tests/engine_mcp_test.ts) |
