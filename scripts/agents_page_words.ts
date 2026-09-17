/**
 * Measure the /agents page prose for its word-ceiling Standard. The page
 * promises its own context cost stays bounded; this metric holds the promise
 * against the same markup-free projection the other site Standards read.
 */

import { projectSiteProse } from "./site_prose_lib.ts";
import { proseWordCount } from "./prose_lib.ts";

const page = projectSiteProse().find(({ route }) => route === "/agents");
if (page === undefined) {
  throw new Error("the marketing-page registry no longer registers /agents");
}
console.log(`DISCERN_METRIC agents_page_words ${proseWordCount(page.prose)}`);
