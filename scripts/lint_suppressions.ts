/**
 * Measure authored Deno lint suppression directives as a discern standard.
 *
 * Usage: `deno task lint-suppressions`. The command lists each directive on
 * stderr and prints `DISCERN_METRIC lint_suppressions <count>` on stdout.
 */

import { REPO_ROOT } from "../tests/repo_authored_paths.ts";
import { structuralGuardScope } from "../tests/structural_guard_scope.ts";
import { lintSuppressionsInFiles } from "./lint_suppressions_lib.ts";

const findings = await lintSuppressionsInFiles(
  REPO_ROOT,
  await structuralGuardScope({
    guard: "scripts/lint_suppressions.ts#authored-deno-directives",
    universe: "authored-deno",
  }),
);
for (const finding of findings) {
  console.error(`${finding.file}:${finding.line} ${finding.directive}`);
}
const fileCount = new Set(findings.map((finding) => finding.file)).size;
console.error(
  `${findings.length} Deno lint suppression directives across ${fileCount} files. ` +
    "Fix the named lint rule and remove the directive.",
);
console.log(`DISCERN_METRIC lint_suppressions ${findings.length}`);
