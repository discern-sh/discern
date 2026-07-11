/**
 * Measure the documentation's prose-lint alert count and emit it as a discern
 * ratchet metric.
 *
 * This is the measurement command behind `[ratchets.prose]`. The harness runs it
 * on demand via `discern ratchets`, scans the output for the LAST
 * `DISCERN_METRIC prose <number>` line, and holds it at or below the configured
 * ceiling — the docs' prose-issue count may only fall.
 *
 * The underlying linter is Vale (`.vale.ini` plus the project vocabulary under
 * `.vale/config/`), but the metric name stays implementation-neutral — "prose",
 * not "vale" — so the ratchet reads as a quality target, mirroring
 * `[ratchets.coverage]`. Only the command names the tool. Error-severity findings
 * additionally block the gate via `[checks.prose]`; this ratchet tracks the whole
 * advisory backlog (every severity) so the number shrinks over time rather than
 * merely not regressing past zero.
 *
 * Usage: `deno task prose <docs-dir>` (the `[ratchets.prose]` run command).
 * Prints a human
 * breakdown to stderr for context, then the metric line to stdout.
 */

interface Alert {
  Severity: string;
}

// Vale exits non-zero when it finds error-severity alerts; that is not a failure
// of the MEASUREMENT (the count is the point), so its JSON is read regardless of
// the exit code — mirroring how the ratchet runner ignores the run's exit status.
const docsDir = Deno.args[0] ?? "map/";
const run = await new Deno.Command("vale", {
  args: ["--output=JSON", docsDir],
  stdout: "piped",
  stderr: "piped",
}).output();

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
