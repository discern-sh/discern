/** Render the shared unknown-command refusal on human and JSON surfaces. */

import { emitResult } from "../shared/emit.ts";
import {
  didYouMeanHint,
  UNKNOWN_COMMAND_POINTER,
  unknownCommandMessage,
} from "../shared/vocabulary.ts";

/** Report an unknown top-level word with an optional canonical suggestion. */
export function reportUnknownCommand(
  word: string,
  suggestion: string | undefined,
  opts: { json?: boolean } = {},
): void {
  const hints = [
    ...(suggestion !== undefined ? [didYouMeanHint(suggestion)] : []),
    UNKNOWN_COMMAND_POINTER,
  ];
  if (opts.json ?? false) {
    emitResult({
      ok: false,
      verb: word,
      error: "unknown_command",
      message: unknownCommandMessage(word),
      hints,
    });
    return;
  }
  console.error(`discern: ${unknownCommandMessage(word)}`);
  for (const hint of hints) {
    console.error(`       ${hint}`);
  }
}
