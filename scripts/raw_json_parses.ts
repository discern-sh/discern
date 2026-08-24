/**
 * Measure unchecked JSON parses in TypeScript tests as a discern standard.
 *
 * Usage: `deno task raw-json-parses`. The command scans the Git-derived test
 * TypeScript universe, including executable fixture modules, and prints
 * `DISCERN_METRIC raw_json_parses <count>` on stdout.
 */

import { join } from "@std/path";
import { structuralGuardScope } from "../tests/structural_guard_scope.ts";
import { REPO_ROOT } from "../tests/repo_authored_paths.ts";

const RAW_JSON_PARSE = /JSON\.parse\(/g;
const DECODER = "tests/decode_cli_result.ts";

const files = await structuralGuardScope({
  guard: "scripts/raw_json_parses.ts#test-typescript-census",
  universe: {
    kind: "specialized",
    name: "test TypeScript including executable fixture paths",
    extensions: [".ts", ".tsx"],
    reason:
      "AUTHORED_TS_FILES deliberately excludes fixtures, but executable test fixtures also carry legacy parses.",
  },
  narrow: {
    reason:
      "The raw-parse migration governs TypeScript beneath tests except its validating decoder.",
    include: (rel) => rel.startsWith("tests/") && rel !== DECODER,
  },
});

let count = 0;
for (const file of files) {
  const source = await Deno.readTextFile(join(REPO_ROOT, file));
  count += source.match(RAW_JSON_PARSE)?.length ?? 0;
}

console.log(`DISCERN_METRIC raw_json_parses ${count}`);
