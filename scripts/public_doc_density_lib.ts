/**
 * Measure the manual's navigable reading units and prose words — the corpus
 * behind `[standards.public_doc_leaf_density]`.
 *
 * The former Map projection had short route leaves. The migrated baseline
 * consolidates those routes into longer purpose-shaped pages, so counting
 * files alone would report a density collapse even though searchable `##`
 * topics preserve the reader's addressable destinations. One reading unit is
 * therefore either a published non-index page or one level-two topic. Both
 * sides come from the strict published manual projection. Frontmatter and code
 * enter neither count; Reference remains part of this complete-navigation
 * measure even though the separate reading-grade measure excludes it.
 */

import { discoverDocs, type DocEntry } from "../src/lib/docs.ts";
import { buildManualProjection } from "../src/lib/manual.ts";
import { measuredManualProse } from "./manual_prose_lib.ts";
import { proseWordCount } from "./prose_lib.ts";

export interface PublicDocMetrics {
  leaves: number;
  words: number;
}

/**
 * Resolve the exact public documentation projection used by publishing and
 * the public leaf-density Standard.
 */
export async function publicDocEntries(
  repoRoot: string,
  docsDir: string,
): Promise<DocEntry[]> {
  const tree = await discoverDocs({ cwd: repoRoot, dir: docsDir });
  if (tree === undefined) {
    throw new Error(`no documentation tree at ${docsDir}`);
  }
  return (await buildManualProjection(tree.entries)).pages.map((page) =>
    page.entry
  );
}

/** Count prose words and reader-addressable units in the published projection. */
export async function measurePublicDocs(
  repoRoot: string,
  docsDir: string,
): Promise<PublicDocMetrics> {
  let leaves = 0;
  let words = 0;
  for (const entry of await publicDocEntries(repoRoot, docsDir)) {
    const markdown = await Deno.readTextFile(entry.absPath);
    words += proseWordCount(measuredManualProse(markdown));
    if (entry.slug.toLowerCase() !== "readme") leaves++;
    leaves += markdown.match(/^##\s+\S/gmu)?.length ?? 0;
  }
  return { leaves, words };
}
