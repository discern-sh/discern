/** Product module coverage policy: every executable module meets the floor. */

import type { ModuleCoverageException } from "./coverage_lib.ts";

/** A useful behavioral floor: at least four of every five executable lines. */
export const MODULE_LINE_COVERAGE_FLOOR = 80;

/** The gate rejects adding any exception to the universal module floor. */
export const MODULE_COVERAGE_EXCEPTIONS: readonly ModuleCoverageException[] =
  [];
