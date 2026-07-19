/**
 * The single emission chokepoint for a verb's `--json` result (ADR 0030).
 *
 * `serializeResult` (result.ts) defines the wire SHAPE; this defines the one
 * place that shape is PRINTED. `emitResult` is the ONLY code that writes a
 * `DiscernResult` envelope to stdout — the installer's `Logger.result` and every
 * engine verb route through it, so the `--json` contract (one JSON object on
 * stdout, nothing else) has a single owner rather than a dozen hand-rolled
 * `console.log(JSON.stringify(serializeResult(…)))` sites that could drift.
 *
 * Pairs with the one silence rule (the engine `Out`/runner go quiet in JSON
 * mode): together they guarantee that the combined stdout+stderr of any
 * `<verb> --json` is exactly this one line. The architectural guard test asserts
 * `serializeResult` is called only here and in the MCP renderer.
 */

import { type DiscernResult, serializeResult } from "./result.ts";
import { observeResult } from "./result_capture.ts";

/** Write a verb's result envelope as the single `--json` line on stdout. Also
 * feeds the observed-result seam, so the logbook recorder can lift per-step
 * timings from the same envelope the caller received. */
export function emitResult(result: DiscernResult): void {
  observeResult(result);
  console.log(JSON.stringify(serializeResult(result)));
}
