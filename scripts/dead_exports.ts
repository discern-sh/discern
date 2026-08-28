/** Report declarations whose direct export is their only reachability root. */

import { join } from "@std/path";
import { REPO_ROOT } from "../tests/repo_authored_paths.ts";
import { structuralGuardScope } from "../tests/structural_guard_scope.ts";
import { deadExportsInFiles } from "./dead_exports_lib.ts";

const files = await structuralGuardScope({
  guard: "scripts/dead_exports.ts#authored-direct-exports",
  universe: "authored-deno",
});
const configText = await Deno.readTextFile(join(REPO_ROOT, "deno.json"));
const findings = await deadExportsInFiles(REPO_ROOT, files, configText);

for (const finding of findings) {
  console.error(
    `${finding.file}:${finding.line} ${finding.kind} ${finding.name}`,
  );
}
console.error(
  `${findings.length} direct named exports have no local or authored-module consumer.`,
);
console.log(`DISCERN_METRIC dead_exports ${findings.length}`);
if (findings.length > 0) Deno.exitCode = 1;
