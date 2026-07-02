/**
 * Terminal-width funnel guard — width-aware human output funnels through
 * `src/lib/text.ts`, where the wrap helper lives.
 *
 * The grouped `discern --help` and `doctor`'s execution model wrap their prose to
 * the terminal width with {@link wrapText}, reading the width with
 * {@link terminalWidth}. The risk going forward is a NEW human-facing surface that
 * reads the console width itself (`Deno.consoleSize()` / `$COLUMNS`) and then prints
 * long prose WITHOUT wrapping — or wraps it with a second, slightly-different
 * algorithm. Either way the DX drifts.
 *
 * You cannot guard "all prose wraps" structurally: whether a line SHOULD wrap is a
 * judgment (a description should; a data table, a JSON blob, or a file path should
 * not), and discern can't tell them apart. What you CAN guard is the door: the
 * terminal width is read in exactly ONE module, the same module that exports
 * `wrapText`. So any code that becomes width-aware is forced through `lib/text.ts`
 * and meets the wrap helper there — no second ad-hoc reader can quietly diverge.
 * This is the `discern-cure-a-bug` move applied to a presentation concern: pin the
 * single source of width, not every call site that should wrap.
 */

import { assert } from "@std/assert";
import { walk } from "@std/fs";
import { fromFileUrl, join, relative } from "@std/path";

const REPO = fromFileUrl(new URL("../", import.meta.url));

/** The one module allowed to read the terminal width (it pairs it with wrapText). */
const HOME = join("src", "lib", "text.ts");

/** Source with comments removed, so the scan sees calls, not prose that merely
 * mentions `$COLUMNS` while documenting the behaviour. */
function codeOnly(src: string): string {
  return src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/[^\n]*/g, "");
}

/** The terminal-dimension reads that must funnel through {@link HOME}. */
const WIDTH_READS = ["Deno.consoleSize", "COLUMNS"];

Deno.test("the terminal width is read only in lib/text.ts (the wrapText funnel)", async () => {
  const offenders: string[] = [];
  for await (const entry of walk(join(REPO, "src"), { exts: [".ts"] })) {
    const rel = relative(REPO, entry.path);
    if (rel === HOME) {
      continue;
    }
    const code = codeOnly(await Deno.readTextFile(entry.path));
    for (const read of WIDTH_READS) {
      if (code.includes(read)) {
        offenders.push(`${rel}  (${read})`);
      }
    }
  }
  assert(
    offenders.length === 0,
    `terminal-width reads must funnel through ${HOME} (terminalWidth + wrapText), so ` +
      `width-aware human output always meets the shared wrap helper and can't diverge ` +
      `into an ad-hoc reader that wraps differently — or not at all. Replace the direct ` +
      `read with terminalWidth():\n  ${offenders.join("\n  ")}`,
  );
});
