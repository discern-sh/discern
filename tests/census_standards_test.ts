/** Configuration contracts for the mechanical census Standards. */

import { assertEquals } from "@std/assert";
import { BEST_EFFORT_BOUNDARIES } from "../src/shared/best_effort.ts";
import { loadConfig } from "../src/shared/config_schema.ts";
import { REPO_ROOT } from "./repo_authored_paths.ts";
import { registeredSpawnBoundaryCount } from "./spawn_surfaces.ts";

Deno.test("mechanical census Standards are distinct falling ceilings", async () => {
  const standards = (await loadConfig(REPO_ROOT)).standards;
  assertEquals(standards.unsafe_type_assertions?.direction, "down");
  assertEquals(standards.unsafe_type_assertions?.run, "deno task cast-census");
  assertEquals(standards.lint_suppressions?.direction, "down");
  assertEquals(standards.lint_exclusions?.direction, "down");
  assertEquals(standards.lint_exclusions?.metric, "lint_exclusions");
  assertEquals(
    standards.lint_exclusions?.run,
    standards.lint_suppressions?.run,
    "lint directives and effective exclusions share one measurement process",
  );
  assertEquals(standards.silent_error_boundaries?.direction, "down");
  assertEquals(
    standards.silent_error_boundaries?.limit,
    Object.keys(BEST_EFFORT_BOUNDARIES).length,
    "the silent-error ceiling starts at the exact registry population the guard validates",
  );
  assertEquals(standards.subprocess_spawn_boundaries?.direction, "down");
  assertEquals(
    standards.subprocess_spawn_boundaries?.limit,
    registeredSpawnBoundaryCount(),
    "the spawn ceiling starts at the exact registry population the guard validates",
  );
});
