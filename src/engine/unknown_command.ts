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

/** Report an unknown top-level word with an optional canonical suggestion. */
export function reportUnknownCommand(
  word: string,
  suggestion: string | undefined,
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
      verb: word,
      error: "unknown_command",
      message: unknownCommandMessage(word),
      hints: hintTexts(hints),
    });
    return;
  }
  console.error(`discern: ${unknownCommandMessage(word)}`);
  for (const hint of interactiveHints(hints)) {
    console.error(`       ${hint.text}`);
  }
}
