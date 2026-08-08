/**
 * Measure the public manual's leaves and words — the corpus behind the
 * `[standards.public_doc_leaf_density]` floor.
 *
 * The corpus is the public guidance projection every published surface serves
 * — the site, terminal help, search, and the llms editions — composed from the
 * document model's own predicates, never a private re-derivation: the shared
 * reader indexes the map (underscore-prefixed subtrees — _private, _internal,
 * _adr — excluded, as ever), the tier-level allowlist (`isBundledDocEntry`)
 * admits the root front door and the public-audience sections, and the one
 * publication predicate (`publicDocs`) admits the published pages. A
 * contributor-tier page counts toward neither number — those tiers absorb
 * material cut from public pages, so a floor over them would punish exactly
 * that move — and a `publish: false` page is not yet part of the corpus. A
 * leaf is a published Markdown page whose basename is not README.md; README
 * files are directory indexes, not leaves. Words measure prose: the
 * frontmatter block is metadata, never content.
 */

import { basename } from "@std/path";
import { isBundledDocEntry } from "../src/lib/paths.ts";
import { parseFrontmatter } from "../src/lib/frontmatter.ts";
import { discoverDocs, type DocEntry, publicDocs } from "../src/lib/docs.ts";

export interface PublicDocMetrics {
  leaves: number;
  words: number;
}

/** Count Unicode word tokens while retaining apostrophes and hyphens within words. */
function wordCount(text: string): number {
  return text.match(/[\p{L}\p{N}][\p{L}\p{N}'-]*/gu)?.length ?? 0;
}

/** The top-level section an entry belongs to; root files keep their name. */
function docTopLevel(entry: DocEntry): string {
  return entry.relToDocs.split("/")[0] ?? entry.relToDocs;
}

/**
 * Resolve the exact public documentation projection shared by publishing,
 * density measurement, and public prose enforcement.
 */
export async function publicDocEntries(
  repoRoot: string,
  docsDir: string,
): Promise<DocEntry[]> {
  const tree = await discoverDocs({ cwd: repoRoot, dir: docsDir });
  if (tree === undefined) {
    throw new Error(`no documentation tree at ${docsDir}`);
  }
  return publicDocs(tree.entries).filter((entry) =>
    isBundledDocEntry(docTopLevel(entry))
  );
}

/** Count words and non-index leaves in the published documentation projection. */
export async function measurePublicDocs(
  repoRoot: string,
  docsDir: string,
): Promise<PublicDocMetrics> {
  let leaves = 0;
  let words = 0;
  for (const entry of await publicDocEntries(repoRoot, docsDir)) {
    const { body } = parseFrontmatter(await Deno.readTextFile(entry.absPath));
    words += wordCount(body);
    if (basename(entry.absPath) !== "README.md") {
      leaves++;
    }
  }
  return { leaves, words };
}
