/** Measure the ambient-state exception registries for their down-only Standards. */

import {
  AMBIENT_MUTATION_BOUNDARIES,
  AMBIENT_READ_BOUNDARIES,
} from "./ambient_state_lint.ts";

console.log(
  `DISCERN_METRIC ambient_read_boundaries ${AMBIENT_READ_BOUNDARIES.length}`,
);
console.log(
  `DISCERN_METRIC ambient_mutation_boundaries ${AMBIENT_MUTATION_BOUNDARIES.length}`,
);
