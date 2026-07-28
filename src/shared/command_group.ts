/**
 * One behavior for bare command groups.
 *
 * Human mode keeps the familiar help page. Machine mode cannot mix that prose
 * with JSON, so it returns a controlled argument refusal through the ordinary
 * result boundary.
 */

import type { Command } from "@cliffy/command";
import { emitResult } from "./emit.ts";

/** Show group help to a person, or emit one actionable machine refusal. */
export function runCommandGroup(
  command: Command,
  verb: string,
  json: boolean,
): number {
  if (json) {
    emitResult({
      ok: false,
      verb,
      error: "invalid_arguments",
      message:
        `discern ${verb} needs a subcommand. Run \`discern ${verb} --help\` and choose one.`,
    });
    return 1;
  }
  command.showHelp();
  return 0;
}
