/** Emit the public marketing corpus's deterministic reading-grade Standard. */

import { projectSiteProse, siteProseReadingGrade } from "./site_prose_lib.ts";

console.log(
  `DISCERN_METRIC site_reading_grade ${
    siteProseReadingGrade(projectSiteProse())
  }`,
);
