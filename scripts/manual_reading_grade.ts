/** Emit the manual's purpose-scoped deterministic reading-complexity metric. */

import { dirname, fromFileUrl } from "@std/path";
import { manualReadingGrade, projectManualProse } from "./manual_prose_lib.ts";

const repoRoot = dirname(dirname(fromFileUrl(import.meta.url)));
console.log(
  `DISCERN_METRIC manual_reading_grade ${
    manualReadingGrade(await projectManualProse(repoRoot))
  }`,
);
