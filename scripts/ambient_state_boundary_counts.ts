/** Measure the ambient-state exception registries for their down-only Standards. */

import {
  AMBIENT_MUTATION_BOUNDARIES,
  AMBIENT_READ_BOUNDARIES,
} from "./ambient_state_lint.ts";
import { CLOCK_PRIMITIVE_BOUNDARIES } from "../src/shared/clock.ts";
import {
  JITTER_PRIMITIVE_BOUNDARIES,
  SCHEDULER_PRIMITIVE_BOUNDARIES,
} from "../src/shared/scheduler.ts";
import { SECURE_ENTROPY_PRIMITIVE_BOUNDARIES } from "../src/shared/entropy.ts";

console.log(
  `DISCERN_METRIC ambient_read_boundaries ${
    new Set(Object.values(AMBIENT_READ_BOUNDARIES).map((entry) => entry.path))
      .size
  }`,
);
console.log(
  `DISCERN_METRIC ambient_read_operations ${
    Object.keys(AMBIENT_READ_BOUNDARIES).length
  }`,
);
console.log(
  `DISCERN_METRIC ambient_mutation_boundaries ${
    Object.keys(AMBIENT_MUTATION_BOUNDARIES).length
  }`,
);
console.log(
  `DISCERN_METRIC clock_primitive_boundaries ${
    Object.keys(CLOCK_PRIMITIVE_BOUNDARIES).length
  }`,
);
console.log(
  `DISCERN_METRIC scheduler_primitive_boundaries ${
    Object.keys(SCHEDULER_PRIMITIVE_BOUNDARIES).length
  }`,
);
console.log(
  `DISCERN_METRIC scheduling_jitter_boundaries ${
    Object.keys(JITTER_PRIMITIVE_BOUNDARIES).length
  }`,
);
console.log(
  `DISCERN_METRIC secure_entropy_primitive_boundaries ${
    Object.keys(SECURE_ENTROPY_PRIMITIVE_BOUNDARIES).length
  }`,
);
