/** Small shared output operations used by Desk orchestration modules. */

import type { Out } from "../output.ts";
import { renderDeskCommandEvidence } from "./view.ts";

/** Render the copyable CLI equivalent of an action about to run. */
export function echoDeskCommand(out: Out, command: string): void {
  const rendered = renderDeskCommandEvidence(
    command,
    out.terminal.size,
    out.terminal,
  );
  out.raw(`${rendered.text}\n`);
}

/** Clear the screen before composing a complete Desk view. */
export function clearDeskBoard(out: Out): void {
  out.raw("\x1b[2J\x1b[H");
}
