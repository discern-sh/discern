/**
 * The `[checks.prose]` gate command: Vale at error severity over the map's
 * PROSE — a staged mirror with frontmatter blanked and `_private` skipped
 * (see scripts/prose_lib.ts), so a metadata block can never trip the gate
 * and a diagnostic still names the real file and line.
 *
 * Usage: `deno run --allow-read --allow-write --allow-env --allow-run
 * scripts/prose_check.ts <map-dir>` — exits with Vale's own exit code.
 */

import { dirname, fromFileUrl } from "@std/path";
import { loadConfig } from "../src/shared/config_schema.ts";
import { resolveMapDir } from "../src/lib/paths.ts";
import { restoreStagePaths, stageProseInput } from "./prose_lib.ts";

const repoRoot = dirname(dirname(fromFileUrl(import.meta.url)));
const docsDir = Deno.args[0] ??
  resolveMapDir(repoRoot, await loadConfig(repoRoot)).abs;

const stage = await stageProseInput(docsDir);
let code = 1;
try {
  const run = await new Deno.Command("vale", {
    args: ["--minAlertLevel", "error", stage],
    stdout: "piped",
    stderr: "piped",
  }).output();
  const decoder = new TextDecoder();
  const stdout = restoreStagePaths(decoder.decode(run.stdout), stage, docsDir);
  const stderr = restoreStagePaths(decoder.decode(run.stderr), stage, docsDir);
  if (stdout) console.log(stdout.trimEnd());
  if (stderr) console.error(stderr.trimEnd());
  code = run.code;
} finally {
  // Deno.exit skips finally blocks, so teardown precedes the exit below.
  await Deno.remove(stage, { recursive: true }).catch(() => {});
}
Deno.exit(code);
