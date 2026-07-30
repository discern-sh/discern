/**
 * The `[jobs.prose]` gate command: Vale at error severity over the map's
 * PROSE — a staged mirror with frontmatter blanked and `_private` skipped
 * (see scripts/prose_lib.ts), so a metadata block can never trip the gate
 * and a diagnostic still names the real file and line.
 *
 * Also the page-level loop behind `discern scripts prose-page`: pass file
 * arguments (paths to map pages, relative to the working directory) to lint
 * only those pages, and `--min-level=<suggestion|warning|error>` to widen
 * past the gate's error-only default.
 *
 * Usage: `deno run --allow-read --allow-write --allow-env --allow-run
 * scripts/prose_check.ts <map-dir> [--min-level=<level>] [file ...]`
 * — exits with Vale's own exit code.
 */

import { dirname, fromFileUrl, join, relative, resolve } from "@std/path";
import { loadConfig } from "../src/shared/config_schema.ts";
import { resolveMapDir } from "../src/lib/paths.ts";
import { restoreStagePaths, stageProseInput } from "./prose_lib.ts";
import { runVale } from "./vale_lib.ts";

const repoRoot = dirname(dirname(fromFileUrl(import.meta.url)));

let mapDirArg: string | undefined;
let minLevel = "error";
const fileArgs: string[] = [];
for (const arg of Deno.args) {
  if (arg.startsWith("--min-level=")) {
    minLevel = arg.slice("--min-level=".length);
  } else if (mapDirArg === undefined) {
    mapDirArg = arg;
  } else {
    fileArgs.push(arg);
  }
}
const docsDir = mapDirArg ??
  resolveMapDir(repoRoot, await loadConfig(repoRoot)).abs;

const stage = await stageProseInput(docsDir);
let code = 1;
try {
  // A file argument narrows the run to that page's staged copy. A path that
  // has no staged copy isn't lintable prose (outside the map, or `_private`).
  const targets: string[] = [];
  const unstaged: string[] = [];
  for (const file of fileArgs) {
    const staged = join(stage.dir, relative(resolve(docsDir), resolve(file)));
    try {
      await Deno.stat(staged);
      targets.push(staged);
    } catch {
      unstaged.push(file);
    }
  }
  if (unstaged.length > 0) {
    console.error(
      `prose_check: not a lintable map page (outside ${docsDir}, or a ` +
        `_private path): ${unstaged.join(", ")}`,
    );
    code = 2;
  } else {
    const run = await runVale(repoRoot, [
      "--minAlertLevel",
      minLevel,
      ...(targets.length > 0 ? targets : [stage.dir]),
    ]);
    const decoder = new TextDecoder();
    const stdout = restoreStagePaths(
      decoder.decode(run.stdout),
      stage.dir,
      docsDir,
    );
    const stderr = restoreStagePaths(
      decoder.decode(run.stderr),
      stage.dir,
      docsDir,
    );
    if (stdout) console.log(stdout.trimEnd());
    if (stderr) console.error(stderr.trimEnd());
    code = run.code;
  }
} finally {
  // Deno.exit skips finally blocks, so teardown precedes the exit below.
  await Deno.remove(stage.dir, { recursive: true }).catch(() => {});
}
Deno.exit(code);
