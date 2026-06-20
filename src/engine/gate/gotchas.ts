/**
 * The "a gate step failed" failure pointer — the TS port of the shell
 * `lib/gotchas.sh`. Printed to stderr when a gated stage fails (non-`--json`),
 * aiming an agent at the project's gotchas doc (`[project].gotchas_doc`). An
 * empty gotchas_doc disables the doc line, matching the config schema.
 */

import type { Config } from "../../shared/config_read.ts";
import type { Out } from "../output.ts";

/** Print the failure pointer to stderr via the gate's output surface. */
export function gotchasHint(config: Config, root: string, out: Out): void {
  const doc = config.get("project.gotchas_doc", "");
  const c = out.c;
  out.raw("\n");
  out.raw(
    `${c.dim}── a gate step failed ───────────────────────────────────────${c.reset}\n`,
  );
  if (doc !== "") {
    out.raw(
      "If the error above is not self-explanatory, the non-obvious ways\n",
    );
    out.raw("this gate fails — each with its fix — are written down here:\n");
    out.raw(`  ${c.cyan}${root}/${doc}${c.reset}\n`);
  } else {
    out.raw(
      "If the error above is not self-explanatory, record the fix in a\n",
    );
    out.raw(
      "gotchas doc and point [project].gotchas_doc in .icculus/config.toml at it,\n",
    );
    out.raw("so the next failure carries its own guidance.\n");
  }
  out.raw(
    `${c.dim}─────────────────────────────────────────────────────────────${c.reset}\n`,
  );
}
