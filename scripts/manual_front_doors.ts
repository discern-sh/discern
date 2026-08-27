/** Measure the scarce promoted journeys authored in the manual root. */

import { dirname, fromFileUrl, join } from "@std/path";
import {
  MANUAL_FRONT_DOORS_END,
  MANUAL_FRONT_DOORS_START,
  manualFrontDoorDestinations,
} from "../src/lib/manual.ts";
import { resolveRepositoryManualDir } from "../src/lib/paths.ts";

const repoRoot = dirname(dirname(fromFileUrl(import.meta.url)));
const manualDir = resolveRepositoryManualDir(repoRoot).abs;
const root = await Deno.readTextFile(join(manualDir, "README.md"));
const destinations = manualFrontDoorDestinations(root);
if (destinations.length === 0) {
  throw new Error(
    `project/manual/README.md must carry direct links between ${MANUAL_FRONT_DOORS_START} and ${MANUAL_FRONT_DOORS_END}`,
  );
}
console.error(
  `project/manual/README.md: ${destinations.length} promoted journeys`,
);
console.log(`DISCERN_METRIC manual_front_doors ${destinations.length}`);
