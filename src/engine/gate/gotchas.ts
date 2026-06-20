/**
 * The "a gate step failed" failure pointer — the TS port of the shell
 * `lib/gotchas.sh`. ALWAYS written to stderr (like the shell's `>&2`), so it
 * never pollutes the gate's stdout. Aims an agent at the project's gotchas doc
 * (`[project].gotchas_doc`); an empty gotchas_doc disables the doc line.
 */

import type { Config } from "../../shared/config_read.ts";
import { palette, writeStderr } from "../output.ts";

/** Print the failure pointer to stderr. */
export function gotchasHint(
  config: Config,
  root: string,
  color: boolean,
): void {
  const doc = config.get("project.gotchas_doc", "");
  const c = palette(color);
  writeStderr("\n");
  writeStderr(
    `${c.dim}── a gate step failed ───────────────────────────────────────${c.reset}\n`,
  );
  if (doc !== "") {
    writeStderr(
      "If the error above is not self-explanatory, the non-obvious ways\n",
    );
    writeStderr(
      "this gate fails — each with its fix — are written down here:\n",
    );
    writeStderr(`  ${c.cyan}${root}/${doc}${c.reset}\n`);
  } else {
    writeStderr(
      "If the error above is not self-explanatory, record the fix in a\n",
    );
    writeStderr(
      "gotchas doc and point [project].gotchas_doc in .icculus/config.toml at it,\n",
    );
    writeStderr("so the next failure carries its own guidance.\n");
  }
  writeStderr(
    `${c.dim}─────────────────────────────────────────────────────────────${c.reset}\n`,
  );
}
