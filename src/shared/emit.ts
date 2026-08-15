/**
 * The single emission chokepoint for a verb's quiet CLI result (ADR 0030).
 *
 * `serializeResult` (`result_serialization.ts`) defines the wire SHAPE; this defines the one
 * place that shape is PRINTED. `emitResult` is the ONLY code that writes a
 * `DiscernResult` envelope to stdout — the installer's `Logger.result` and every
 * engine verb route through it, so JSON and Markdown each have one stdout
 * owner rather than a dozen hand-rolled sites that could drift.
 *
 * Pairs with the one silence rule (the engine `Out`/runner go quiet in result
 * mode): together they guarantee that either projection is the only
 * result on stdout. The architectural guard test asserts `serializeResult` is
 * called only here and in the MCP renderer.
 */

import type { DiscernResult } from "./result.ts";
import { serializeResult } from "./result_serialization.ts";
import { observeResult } from "./result_capture.ts";
import { withFailureRecoveryHint } from "./hints.ts";
import {
  renderResultMarkdown,
  type ResultMarkdownPresenter,
} from "./result_markdown.ts";
import type { ResultOutputFormat } from "./result_formats.ts";

let activeResultOutputFormat: ResultOutputFormat = "json";

/** The CLI entrypoint supplies presenter selection without pulling its schema
 * registry into every engine module that emits a result. */
export type ResultMarkdownPresenterResolver = (
  verb: string,
) => ResultMarkdownPresenter;

let resultMarkdownPresenterResolver:
  | ResultMarkdownPresenterResolver
  | undefined;

/** Select the projection the next quiet CLI result emits. */
export function setResultOutputFormat(format: ResultOutputFormat): void {
  activeResultOutputFormat = format;
}

/** Install contract-aware presenter selection at the outer CLI boundary. */
export function setResultMarkdownPresenterResolver(
  resolver: ResultMarkdownPresenterResolver,
): void {
  resultMarkdownPresenterResolver = resolver;
}

/** Write a verb's selected quiet result to stdout. Also feeds the
 * observed-result seam, so the logbook recorder can lift per-step timings from
 * the same envelope the caller received. */
export function emitResult(result: DiscernResult): void {
  const prepared = withFailureRecoveryHint(result);
  observeResult(prepared);
  const serialized = serializeResult(prepared);
  const presenter = activeResultOutputFormat === "markdown"
    ? resultMarkdownPresenterResolver?.(prepared.verb)
    : undefined;
  if (activeResultOutputFormat === "markdown" && presenter === undefined) {
    throw new Error(
      "internal result invariant: Markdown presenter resolver is not installed",
    );
  }
  const output = presenter === undefined
    ? JSON.stringify(serialized)
    : renderResultMarkdown(serialized, presenter).trimEnd();
  console.log(output);
}
