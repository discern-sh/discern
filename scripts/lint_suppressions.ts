/**
 * Measure authored Deno lint suppression directives as a discern standard.
 *
 * Usage: `deno task lint-suppressions`. The command lists each directive on
 * stderr and prints `DISCERN_METRIC lint_suppressions <count>` on stdout.
 */

import { join } from "@std/path";
import { REPO_ROOT } from "../tests/repo_authored_paths.ts";
import { structuralGuardScope } from "../tests/structural_guard_scope.ts";
import {
  effectiveLintExclusions,
  lintSuppressionsInFiles,
} from "./lint_suppressions_lib.ts";

const authoredDenoFiles = await structuralGuardScope({
  guard: "scripts/lint_suppressions.ts#authored-deno-lint-policy",
  universe: "authored-deno",
});
const findings = await lintSuppressionsInFiles(REPO_ROOT, authoredDenoFiles);
for (const finding of findings) {
  console.error(`${finding.file}:${finding.line} ${finding.directive}`);
}
const fileCount = new Set(findings.map((finding) => finding.file)).size;
console.error(
  `${findings.length} Deno lint suppression directives across ${fileCount} files. ` +
    "Fix the named lint rule and remove the directive.",
);
const exclusions = effectiveLintExclusions(
  await Deno.readTextFile(join(REPO_ROOT, "deno.json")),
  authoredDenoFiles,
);
for (const exclusion of exclusions) {
  console.error(
    `deno.json lint.exclude '${exclusion.pattern}' excludes ` +
      `${exclusion.files.join(", ")}`,
  );
}
console.error(
  `${exclusions.length} effective lint exclusions remove authored sources. ` +
    "Remove an entry after its sources satisfy the shared lint policy.",
);
console.log(`DISCERN_METRIC lint_suppressions ${findings.length}`);
console.log(`DISCERN_METRIC lint_exclusions ${exclusions.length}`);
