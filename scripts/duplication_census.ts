/**
 * Measure maximal non-overlapping clone groups across authored Deno sources.
 *
 * Usage: `deno task duplication-census`. Diagnostics go to stderr; stdout
 * carries the two stable discern metrics consumed by Standards and tooling.
 */

import { join } from "@std/path";
import { loadConfig } from "../src/shared/config_schema.ts";
import {
  generatedGroupForPath,
  resolveGeneratedGroups,
} from "../src/shared/generated_artifacts.ts";
import { REPO_ROOT } from "../tests/repo_authored_paths.ts";
import { structuralGuardScope } from "../tests/structural_guard_scope.ts";
import {
  duplicateCloneDiagnostic,
  duplicationCensus,
  type DuplicationSource,
} from "./duplication_census_lib.ts";

const config = await loadConfig(REPO_ROOT);
const generatedGroups = resolveGeneratedGroups(config);
const authoredFiles = await structuralGuardScope({
  guard: "scripts/duplication_census.ts#authored-deno-clones",
  universe: "authored-deno",
});
const generatedFiles = authoredFiles.filter((path) =>
  generatedGroupForPath(generatedGroups, path) !== undefined
);
const generatedFileSet = new Set(generatedFiles);
const sources: DuplicationSource[] = [];
for (const path of authoredFiles) {
  sources.push({
    path,
    text: await Deno.readTextFile(join(REPO_ROOT, path)),
    ...(generatedFileSet.has(path) ? { generated: true as const } : {}),
  });
}

const census = await duplicationCensus(sources);
for (const group of census.groups) {
  console.error(duplicateCloneDiagnostic(group));
}
console.error(
  `${census.duplicateCloneGroups} maximal clone groups contribute ` +
    `${census.duplicatedLines} non-overlapping normalized duplicate lines ` +
    `across ${
      sources.length - generatedFiles.length
    } authored files; excluded ` +
    `${generatedFiles.length} declared generated files. Consolidate the named ` +
    "ranges or keep their independent-fate distinction explicit.",
);
console.log(
  `DISCERN_METRIC duplicate_clone_groups ${census.duplicateCloneGroups}`,
);
console.log(`DISCERN_METRIC duplicated_lines ${census.duplicatedLines}`);
