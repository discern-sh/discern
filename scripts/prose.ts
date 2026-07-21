/**
 * Measure the documentation's prose-lint alert count and emit it as a discern
 * standard metric.
 *
 * This is the measurement command behind `[standards.prose]`. Discern runs it
 * on demand via `discern standards`, scans the output for the LAST
 * `DISCERN_METRIC prose <number>` line, and holds it at or below the configured
 * ceiling — the docs' prose-issue count may only fall.
 *
 * The underlying linter is Vale (`.vale.ini` plus the project vocabulary under
 * `.vale/config/`), but the metric name stays implementation-neutral — "prose",
 * not "vale" — so the standard reads as a quality target, mirroring
 * `[standards.coverage]`. Only the command names the tool. Error-severity findings
 * additionally block the gate via `[jobs.prose]`; this standard tracks the whole
 * advisory backlog (every severity) so the number shrinks over time rather than
 * merely not regressing past zero.
 *
 * Usage: `deno task prose <map-dir>` (the `[standards.prose]` run command).
 * Prints a human
 * breakdown to stderr for context, then the metric line to stdout.
 */

import { dirname, fromFileUrl } from "@std/path";
import { loadConfig } from "../src/shared/config_schema.ts";
import { resolveMapDir } from "../src/lib/paths.ts";
import { stageProseInput } from "./prose_lib.ts";

interface Alert {
  Severity: string;
}

// Vale exits non-zero when it finds error-severity alerts; that is not a failure
// of the MEASUREMENT (the count is the point), so its JSON is read regardless of
// the exit code — mirroring how the standards runner ignores the run's exit status.
const repoRoot = dirname(dirname(fromFileUrl(import.meta.url)));
const docsDir = Deno.args[0] ??
  resolveMapDir(repoRoot, await loadConfig(repoRoot)).abs;
// Measure PROSE, not metadata: Vale reads a staged mirror with frontmatter
// blanked (scripts/prose_lib.ts) so a metadata block never counts as an alert.
const stage = await stageProseInput(docsDir);
const run = await new Deno.Command("vale", {
  args: ["--output=JSON", stage],
  stdout: "piped",
  stderr: "piped",
}).output();
await Deno.remove(stage, { recursive: true }).catch(() => {});

const stdout = new TextDecoder().decode(run.stdout);
let report: Record<string, Alert[]>;
try {
  report = JSON.parse(stdout) as Record<string, Alert[]>;
} catch {
  console.error(new TextDecoder().decode(run.stderr));
  throw new Error(
    "vale did not emit parseable JSON — is it installed and has `vale sync` run?",
  );
}

let errors = 0;
let warnings = 0;
let suggestions = 0;
for (const alerts of Object.values(report)) {
  for (const alert of alerts) {
    if (alert.Severity === "error") {
      errors++;
    } else if (alert.Severity === "warning") {
      warnings++;
    } else if (alert.Severity === "suggestion") {
      suggestions++;
    }
  }
}
const total = errors + warnings + suggestions;

console.error(
  `${docsDir} prose alerts: ${total} (${errors} error, ${warnings} warning, ${suggestions} suggestion)`,
);
console.log(`DISCERN_METRIC prose ${total}`);
