/**
 * The "a gate step failed" failure pointer. ALWAYS written to stderr, so it
 * never pollutes the gate's stdout. Aims an agent at the project's gotchas doc
 * (`[project].gotchas_doc`); an empty gotchas_doc disables the doc line.
 */

import type { DiscernConfig } from "../../shared/config_schema.ts";
import { palette, writeStderr } from "../output.ts";

/** Print the failure pointer to stderr. */
export function gotchasHint(
  config: DiscernConfig,
  root: string,
  color: boolean,
): void {
  const doc = config.project.gotchas_doc;
  const c = palette(color);
  const lead = `\n${c.dim}── a gate step failed.${c.reset}`;
  writeStderr(
    doc !== ""
      ? `${lead} If it isn't self-explanatory, this project's known gate failures and their fixes are documented in ${c.cyan}${root}/${doc}${c.reset}.\n`
      : `${lead} If it isn't self-explanatory, record the fix in a gotchas doc and point ${c.cyan}[project].gotchas_doc${c.reset} in discern.toml at it.\n`,
  );
}
