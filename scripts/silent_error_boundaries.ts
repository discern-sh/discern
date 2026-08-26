/** Validate and measure the complete named deliberate error-discard population. */

import {
  bestEffortSources,
  measureBestEffortBoundaries,
} from "../tests/best_effort_guard.ts";

const population = measureBestEffortBoundaries(await bestEffortSources());
console.error(
  `${population} named deliberate error-discard boundaries; every registry ID and live site matches exactly.`,
);
console.log(`DISCERN_METRIC silent_error_boundaries ${population}`);
