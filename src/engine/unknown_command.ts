/** Render the shared unknown-command refusal on human and JSON surfaces. */

import { emitResult } from "../shared/emit.ts";
import {
  fire,
  type FiredHint,
  HINTS,
  hintTexts,
  interactiveHints,
} from "../shared/hints.ts";
import { unknownCommandMessage } from "../shared/vocabulary.ts";
import { Logger } from "../lib/log.ts";

/**
 * Report an unknown word with an optional canonical suggestion. Machine output
 * keeps the registered command that owns the refusal as its discriminator.
 */
export function reportUnknownCommand(
  word: string,
  suggestion: string | undefined,
  resultVerb: "discern" | "scripts",
  opts: { json?: boolean } = {},
): void {
  const hints: FiredHint[] = [
    ...(suggestion !== undefined
      ? [fire(HINTS["unknown-command-suggestion"], { command: suggestion })]
      : []),
    fire(HINTS["unknown-command-help"]),
  ];
  if (opts.json ?? false) {
    emitResult({
      ok: false,
      verb: resultVerb,
      error: "unknown_command",
      message: unknownCommandMessage(word),
      hints: hintTexts(hints),
    });
    return;
  }
  new Logger({ json: false, noColor: false }).failure(
    unknownCommandMessage(word),
    interactiveHints(hints).map((hint) => hint.text),
  );
}
