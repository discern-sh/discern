/**
 * The `[jobs.prose]` gate command: Vale over the map's PROSE — a staged
 * mirror with frontmatter blanked and `_private` skipped (see
 * scripts/prose_lib.ts), so metadata can never trip the gate and a diagnostic
 * still names the real file and line. Every error blocks map-wide. With
 * `--public-custom-zero`, every discern-authored voice alert also blocks on
 * the exact public documentation projection; third-party advisories remain
 * inputs to the prose-density standard.
 *
 * With `--sarif` — how the gate job runs it — findings are emitted as a
 * SARIF 2.1.0 log, which the gate normalizes into one file/line/rule
 * diagnostic per finding instead of one opaque output blob. Without the
 * flag, Vale's line format passes through for human loops.
 *
 * Also the page-level loop behind `discern scripts prose-page`: pass file
 * arguments (paths to map pages, relative to the working directory) to lint
 * only those pages, and `--min-level=<suggestion|warning|error>` to widen
 * past the gate's error-only default.
 *
 * Usage: `deno run --allow-read --allow-write --allow-env --allow-run
 * scripts/prose_check.ts <map-dir> [--min-level=<level>] [--sarif]
 * [--public-custom-zero] [file ...]`
 */

import { dirname, fromFileUrl, join, relative, resolve } from "@std/path";
import { loadConfig } from "../src/shared/config_schema.ts";
import { resolveMapDir } from "../src/lib/paths.ts";
import {
  restoreStagePaths,
  selectProseGateAlerts,
  stageProseInput,
  valeAlertCount,
  valeJsonToSarif,
} from "./prose_lib.ts";
import { publicDocEntries } from "./public_doc_density_lib.ts";
import { runVale } from "./vale_lib.ts";

const repoRoot = dirname(dirname(fromFileUrl(import.meta.url)));

let mapDirArg: string | undefined;
let minLevel = "error";
let sarif = false;
let publicCustomZero = false;
const fileArgs: string[] = [];
for (const arg of Deno.args) {
  if (arg.startsWith("--min-level=")) {
    minLevel = arg.slice("--min-level=".length);
  } else if (arg === "--sarif") {
    sarif = true;
  } else if (arg === "--public-custom-zero") {
    publicCustomZero = true;
  } else if (mapDirArg === undefined) {
    mapDirArg = arg;
  } else {
    fileArgs.push(arg);
  }
}
const docsDir = mapDirArg ??
  resolveMapDir(repoRoot, await loadConfig(repoRoot)).abs;
const publicRelPaths = publicCustomZero
  ? new Set(
    (await publicDocEntries(repoRoot, docsDir)).map((entry) => entry.relToDocs),
  )
  : new Set<string>();

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
    const jsonOutput = sarif || publicCustomZero;
    const run = await runVale(repoRoot, [
      "--minAlertLevel",
      publicCustomZero ? "suggestion" : minLevel,
      ...(jsonOutput ? ["--output=JSON"] : []),
      ...(targets.length > 0 ? targets : [stage.dir]),
    ]);
    const decoder = new TextDecoder();
    const rawStdout = decoder.decode(run.stdout);
    let stdout = restoreStagePaths(rawStdout, stage.dir, docsDir);
    let parsed: unknown;
    let parsedOk = false;
    if (jsonOutput) {
      try {
        parsed = JSON.parse(rawStdout);
        parsedOk = true;
      } catch {
        // Unparseable Vale output (a crash, a version surprise): fall through
        // with the restored raw text, so the failure still shows its evidence.
      }
    }
    if (parsedOk) {
      const gateAlerts = publicCustomZero
        ? selectProseGateAlerts(parsed, { stageDir: stage.dir, publicRelPaths })
        : parsed;
      if (sarif) {
        stdout = JSON.stringify(valeJsonToSarif(
          gateAlerts,
          (path) => restoreStagePaths(path, stage.dir, docsDir),
        ));
      } else if (publicCustomZero) {
        stdout = restoreStagePaths(
          JSON.stringify(gateAlerts),
          stage.dir,
          docsDir,
        );
      }
      if (publicCustomZero) {
        const rawHasAlerts = Object.values(
          parsed as Record<string, unknown>,
        ).some((value) => Array.isArray(value) && value.length > 0);
        if (run.code !== 0 && !rawHasAlerts) {
          code = run.code;
        } else {
          code = valeAlertCount(
              gateAlerts as Record<string, unknown[]>,
            ) > 0
            ? 1
            : 0;
        }
      } else {
        code = run.code;
      }
    } else {
      code = run.code;
    }
    const stderr = restoreStagePaths(
      decoder.decode(run.stderr),
      stage.dir,
      docsDir,
    );
    if (stdout) console.log(stdout.trimEnd());
    if (stderr) console.error(stderr.trimEnd());
  }
} finally {
  // Deno.exit skips finally blocks, so teardown precedes the exit below.
  await Deno.remove(stage.dir, { recursive: true }).catch(() => {});
}
Deno.exit(code);
