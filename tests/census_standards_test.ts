/** Configuration contracts for the mechanical census Standards. */

import { assert, assertEquals } from "@std/assert";
import { BEST_EFFORT_BOUNDARIES } from "../src/shared/best_effort.ts";
import { loadConfig } from "../src/shared/config_schema.ts";
import { REPO_ROOT } from "./repo_authored_paths.ts";
import { registeredSpawnBoundaryCount } from "./spawn_surfaces.ts";
import {
  processExitBoundaryCount,
  processOutputBoundaryCount,
} from "../src/shared/process_boundaries.ts";
import { COMPLEXITY_HOTSPOT_BUDGETS } from "../scripts/complexity_hotspots.ts";

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
  assert(
    typeof standards.silent_error_boundaries?.limit === "number" &&
      Object.keys(BEST_EFFORT_BOUNDARIES).length <=
        standards.silent_error_boundaries.limit,
    "the live silent-error population must remain within its protected ceiling",
  );
  assertEquals(standards.subprocess_spawn_boundaries?.direction, "down");
  assertEquals(
    standards.subprocess_spawn_boundaries?.limit,
    registeredSpawnBoundaryCount(),
    "the spawn ceiling starts at the exact registry population the guard validates",
  );
  assertEquals(standards.process_output_boundaries?.direction, "down");
  assertEquals(standards.process_exit_boundaries?.direction, "down");
  assertEquals(
    standards.process_output_boundaries?.run,
    standards.process_exit_boundaries?.run,
    "process output and exit boundaries share one validated source scan",
  );
  assertEquals(
    standards.process_output_boundaries?.limit,
    processOutputBoundaryCount(),
    "the output ceiling starts at the exact registry population the guard validates",
  );
  assertEquals(
    standards.process_exit_boundaries?.limit,
    processExitBoundaryCount(),
    "the exit ceiling starts at the exact registry population the guard validates",
  );
  assertEquals(standards.complexity_hotspots?.direction, "down");
  assertEquals(standards.complexity_hotspots?.run, "deno task complexity");
  assert(
    typeof standards.complexity_hotspots?.limit === "number" &&
      COMPLEXITY_HOTSPOT_BUDGETS.length <= standards.complexity_hotspots.limit,
    "the reviewed hotspot population must remain within its protected ceiling",
  );
});
