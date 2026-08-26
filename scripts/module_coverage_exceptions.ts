/** Reviewed legacy modules below the product's per-module line coverage floor. */

import type { ModuleCoverageException } from "./coverage_lib.ts";

/** A useful behavioral floor: at least four of every five executable lines. */
export const MODULE_LINE_COVERAGE_FLOOR = 80;

/**
 * Temporary exact-path debts. A module may improve above its recorded value,
 * but may neither regress nor remain here after reaching the floor.
 */
export const MODULE_COVERAGE_EXCEPTIONS = [] as const satisfies
  readonly ModuleCoverageException[];
