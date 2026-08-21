/** Hold the selected design-system inventory to evidence in live site output. */

import { buildSite } from "../site/build.ts";
import { measureSiteComponentCoverage } from "./site_component_coverage_lib.ts";

await buildSite();
const coverage = await measureSiteComponentCoverage();
const routeGaps = coverage.flatMap((bundle) =>
  bundle.routeGaps.map((route) => `${bundle.bundle}:${route}`)
);
if (routeGaps.length > 0) {
  throw new Error(
    `live routes without a selected design-system component: ${
      routeGaps.join(", ")
    }`,
  );
}

for (const bundle of coverage) {
  const percent = 100 * bundle.witnessed.length / bundle.selected.length;
  console.log(
    `${bundle.bundle}: ${bundle.witnessed.length}/${bundle.selected.length} ` +
      `selected components witnessed (${percent.toFixed(1)}%); ` +
      `gaps: ${bundle.gaps.join(", ") || "none"}`,
  );
}
const gaps = coverage.reduce((total, bundle) => total + bundle.gaps.length, 0);
console.log(`DISCERN_METRIC site_component_gaps ${gaps}`);
