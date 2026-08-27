/**
 * Count the public manual's leaves and words, then emit both as discern
 * standard metrics.
 *
 * The measurement itself lives in `public_doc_density_lib.ts` (the corpus
 * definition and its exclusions are documented there); this is the thin
 * `[standards.public_doc_leaf_density]` run command around it.
 */

import { dirname, fromFileUrl } from "@std/path";
import { resolveRepositoryManualDir } from "../src/lib/paths.ts";
import { measurePublicDocs } from "./public_doc_density_lib.ts";

const repoRoot = dirname(dirname(fromFileUrl(import.meta.url)));
const docsDir = Deno.args[0] ??
  resolveRepositoryManualDir(repoRoot).abs;
const metrics = await measurePublicDocs(repoRoot, docsDir);

console.error(
  `${docsDir}: ${metrics.leaves} navigable units, ${metrics.words} prose words`,
);
console.log(`DISCERN_METRIC public_doc_leaves ${metrics.leaves}`);
console.log(`DISCERN_METRIC public_doc_words ${metrics.words}`);
