#!/usr/bin/env -S deno run --allow-read --allow-run=shellcheck
/**
 * lint-sh.ts — run shellcheck over every shell source in the repo.
 *
 * The harness is POSIX shell: the engine recipes and agent ship under
 * `#!/usr/bin/env sh`, and install.sh is the bootstrap installer. zsh — the
 * default macOS interactive shell — is far more lenient than the dash/bash that
 * actually run these scripts, so eyeballing in a terminal hides portability
 * bugs. shellcheck is the static net for that class. It is wired into the gate
 * as the `shellcheck` slot, so `agent finish` (locally and in CI) runs it.
 *
 * Discovery is by content, not a hand-kept list: any file under templates/ that
 * is a shell script (a `#!…sh` shebang, or a `.sh` name) is linted, so a newly
 * added recipe is covered automatically — there is no list to forget.
 *
 * Two codes are excluded globally:
 *   SC1091  recipes source their libraries through a runtime variable
 *           (`. "$ICCULUS_LIB/…"`) — a path shellcheck cannot resolve
 *           statically, so "not following" is unavoidable here, not a defect.
 *   SC2016  the recipes' printf format strings intentionally carry literal `$`
 *           and backticks (help text) — exactly what SC2016 flags.
 */
import { walk } from "@std/fs";

const ROOT = new URL("../", import.meta.url).pathname;
const EXCLUDED_CODES = ["SC1091", "SC2016"];

/** Is this file a shell script? A `.sh` name, or a `#!…sh` shebang. */
async function isShell(path: string): Promise<boolean> {
  if (path.endsWith(".sh")) return true;
  if (path.endsWith(".awk")) return false;
  try {
    const text = await Deno.readTextFile(path);
    const firstLine = text.split("\n", 1)[0] ?? "";
    return /^#!.*\bsh\b/.test(firstLine);
  } catch {
    return false;
  }
}

const files: string[] = [];
for await (const entry of walk(`${ROOT}templates`, { includeDirs: false })) {
  if (await isShell(entry.path)) files.push(entry.path);
}
// The repo's own bootstrap installer lives at the root, not under templates/.
files.push(`${ROOT}install.sh`);
files.sort();

if (files.length === 0) {
  console.error("lint-sh: found no shell files to check.");
  Deno.exit(1);
}

let result: Deno.CommandOutput;
try {
  result = await new Deno.Command("shellcheck", {
    args: [`--exclude=${EXCLUDED_CODES.join(",")}`, ...files],
    stdout: "inherit",
    stderr: "inherit",
  }).output();
} catch (err) {
  if (err instanceof Deno.errors.NotFound) {
    console.error(
      "lint-sh: shellcheck is not installed. Install it first " +
        "(`brew install shellcheck`, `apt-get install shellcheck`, …).",
    );
    Deno.exit(127);
  }
  throw err;
}

if (result.success) {
  console.log(`shellcheck: clean (${files.length} shell files).`);
} else {
  console.error("\nshellcheck reported issues (see above).");
}
Deno.exit(result.code);
