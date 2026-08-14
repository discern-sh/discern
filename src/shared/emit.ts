/**
 * The single emission chokepoint for a verb's quiet CLI result (ADR 0030).
 *
 * `serializeResult` (`result_serialization.ts`) defines the wire SHAPE; this defines the one
 * place that shape is PRINTED. `emitResult` is the ONLY code that writes a
 * `DiscernResult` envelope to stdout — the installer's `Logger.result` and every
 * engine verb route through it, so JSON and Markdown each have one stdout
 * owner rather than a dozen hand-rolled sites that could drift.
 *
 * Pairs with the one silence rule (the engine `Out`/runner go quiet in agent
 * result mode): together they guarantee that either projection is the only
 * result on stdout. The architectural guard test asserts `serializeResult` is
 * called only here and in the MCP renderer.
 */

import type { DiscernResult } from "./result.ts";
import { serializeResult } from "./result_serialization.ts";
import { observeResult } from "./result_capture.ts";
import { withFailureRecoveryHint } from "./hints.ts";
import { resultPresenterForVerb } from "./result_contracts.ts";
import { renderResultMarkdown } from "./result_markdown.ts";

/** The two quiet CLI projections owned by this emission boundary. */
export type ResultOutputFormat = "json" | "markdown";

let activeResultOutputFormat: ResultOutputFormat = "json";

/** Select the projection the next quiet CLI result emits. */
export function setResultOutputFormat(format: ResultOutputFormat): void {
  activeResultOutputFormat = format;
}

/** Write a verb's selected quiet result to stdout. Also feeds the
 * observed-result seam, so the logbook recorder can lift per-step timings from
 * the same envelope the caller received. */
export function emitResult(result: DiscernResult): void {
  const prepared = withFailureRecoveryHint(result);
  observeResult(prepared);
  const serialized = serializeResult(prepared);
  if (activeResultOutputFormat === "markdown") {
    console.log(
      renderResultMarkdown(
        serialized,
        resultPresenterForVerb(prepared.verb),
      ).trimEnd(),
    );
    return;
  }
  console.log(JSON.stringify(serialized));
}
