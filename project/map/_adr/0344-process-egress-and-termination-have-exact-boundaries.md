# ADR 0344: Process egress and termination have exact boundaries

**Status**: accepted. Extends the one-result decision in [ADR 0028](0028-result-envelope-and-diagnostics.md), applies canonical-set parity from [ADR 0051](0051-canonical-set-parity.md), and holds the remaining exception populations under the growth-proof Standard policy in [ADR 0161](0161-growth-proof-standards-and-breach-escalation.md).

## Context

The result envelope governs a verb's projections, but it did not mechanically govern every route to the process streams. Production code still contained direct console calls and asynchronous or synchronous `Deno.stdout` and `Deno.stderr` writes. A console-only rule would therefore certify a false invariant. Module-wide exceptions would be equally weak: a legitimate raw document or crash write in one function does not authorize the next function in that module to print.

Process termination had the same gap. Some calls were true process edges—CLI dispatch, parser refusal, crash handling, and signal restoration—while a project-root helper exited from below the dispatcher. A library exit prevents the caller from projecting the failure through `DiscernResult`, recording it consistently, or deciding its own host-process policy.

MCP makes output ownership a protocol property. Its stdout is line-framed JSON-RPC; one successful setup command, log call, or diagnostic written outside the quiet authorities can corrupt the whole session even when the tool's structured result is correct.

## Decision

[`PROCESS_OUTPUT_BOUNDARIES`](../../../src/shared/process_boundaries.ts) and [`PROCESS_EXIT_BOUNDARIES`](../../../src/shared/process_boundaries.ts) are the two membership authorities. Every stable id records an exact repository path, enclosing function, primitive operation, semantic purpose, and reason. Output rows also record the channel; exit rows record the termination purpose. A path alone never grants authority.

The output boundary permits only the final adapters behind the existing composition authorities:

- `emitResult` owns the complete quiet JSON or Markdown projection;
- `Logger` owns installer narration lines;
- `Out` and the engine byte writers own composed engine narration, raw content, and supervised child bytes.

Verb state still projects from `DiscernResult`. Shell-facing scalar values and raw document bodies cross the engine stdout adapter without being recast as captured console output. Operational narration crosses `Logger` or `Out`. MCP tool cores construct quiet loggers and runners; successful project-command output is discarded before the stdio transport can observe it.

Libraries return a status, result, or typed refusal. `CliRefusal` carries an expected lower-layer failure to the recorded dispatcher, which chooses the human or serialized projection and exit code. Only exact parser, recorded-action, top-level dispatch, crash, and signal functions call `Deno.exit`.

[`process_boundaries.ts`](../../../scripts/process_boundaries.ts) scans the Git-derived authored-TypeScript universe narrowed by the product contract to `src/`. It recognizes console calls, direct async and sync stream writes, aliases and bound properties, and direct or aliased `Deno.exit`. It checks syntax and registry rows in both directions before emitting `process_output_boundaries` and `process_exit_boundaries`. Both populations are falling Standards.

## Consequences

- A new direct output or exit primitive fails with its exact path, line, and enclosing function; moving or deleting an elected boundary leaves a stale-row failure.
- The six output adapters and five exit edges are reviewable populations that can only shrink without an owner-approved Standard decision.
- Standalone repository scripts keep their own presentation. They are outside the shipped process contract and do not consume product exceptions.
- A raw terminal or protocol need must route through an existing authority or earn one exact registry row. Adding an output module does not grant every function in it permission to write.
- MCP stdout remains exclusively the SDK transport. A planted successful repository command that attempts to print cannot add an unframed line.
- The structural detector follows common local aliases and bound properties. It is not a whole-program JavaScript points-to analysis; direct imported composition functions are the sanctioned path and do not need to look like primitives.

## Alternatives considered

- **Ban only `console.*`.** Rejected because direct byte writes already existed and would bypass the claimed rule.
- **Allow whole output and process modules.** Rejected because authority belongs to one operation in one function, not every future call in a convenient file.
- **Capture console output and build results from it.** Rejected because presentation text is not structured verb state and would invert the result-envelope authority.
- **Replace `Deno.exit` with process-wide mutable exit state everywhere.** Rejected because parser, signal, and crash boundaries need fail-fast termination, while ordinary libraries can already return or throw typed state.
- **Scan repository scripts too.** Rejected because the invariant is production process egress. Tooling presentation is a different process contract and would add exceptions without protecting verb or MCP output.
