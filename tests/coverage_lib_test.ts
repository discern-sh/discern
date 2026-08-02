/**
 * The coverage metric counts the repo's OWN `src/` tree and nothing else.
 *
 * Guard for the class of defect where a path filter matches by substring
 * instead of anchored prefix: a bare `/src/` also sweeps in dependency and
 * workspace files (a `src/` directory inside `node_modules` or a nested
 * package), so code outside the measured tree
 * moves the number the standard holds. The vectors below pin the anchored
 * definition from every direction a lookalike path can approach it.
 */

import { assertEquals } from "@std/assert";
import { renderTable, srcLineCoverage } from "../scripts/coverage_lib.ts";

const ROOT = "/repo/checkout";

/** Record the requested operation. */
function record(path: string, found: number, hit: number): string {
  return [`SF:${path}`, `LF:${found}`, `LH:${hit}`, "end_of_record"].join(
    "\n",
  );
}

const LCOV = [
  record(`${ROOT}/src/engine/dispatch.ts`, 10, 9),
  record(`${ROOT}/src/shared/config.ts`, 10, 8),
  // A workspace member with its own src/ segment — not the repo's src/.
  record(`${ROOT}/packages/example/src/components/button.tsx`, 10, 1),
  // Dependency source shipped with a src/ directory.
  record(
    `${ROOT}/node_modules/.deno/zod@4.4.3/node_modules/zod/src/index.ts`,
    5,
    0,
  ),
  // A sibling directory whose name merely starts with "src".
  record(`${ROOT}/srcery/tool.ts`, 3, 3),
  // Outside the repo entirely.
  record("/elsewhere/src/other.ts", 4, 4),
].join("\n");

Deno.test("srcLineCoverage counts only files under the repo root's src/", () => {
  const cov = srcLineCoverage(LCOV, ROOT);
  assertEquals(cov.files.map((f) => f.path), [
    "src/engine/dispatch.ts",
    "src/shared/config.ts",
  ]);
  assertEquals(cov.found, 20);
  assertEquals(cov.hit, 17);
  assertEquals(cov.pct, 85);
});

Deno.test("a trailing slash on the repo root changes nothing", () => {
  assertEquals(srcLineCoverage(LCOV, `${ROOT}/`), srcLineCoverage(LCOV, ROOT));
});

Deno.test("an empty report is 0%, not NaN", () => {
  const cov = srcLineCoverage("", ROOT);
  assertEquals(cov.pct, 0);
  assertEquals(cov.files, []);
});

Deno.test("renderTable derives its rows and total from the same parse", () => {
  const lines = renderTable(srcLineCoverage(LCOV, ROOT)).split("\n");
  assertEquals(lines.length, 3);
  assertEquals(lines[0]?.trim(), "src/engine/dispatch.ts   90.0%  9/10");
  assertEquals(lines[1]?.trim(), "src/shared/config.ts     80.0%  8/10");
  assertEquals(lines[2]?.trim(), "All src/ files           85.0%  17/20");
});
