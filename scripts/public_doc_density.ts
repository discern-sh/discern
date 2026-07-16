/**
 * Count published documentation leaves and words, then emit both as discern
 * standard metrics.
 *
 * The corpus follows the document model, never a private re-derivation: the
 * shared reader indexes the map (underscore-prefixed subtrees — _private,
 * _internal, _adr — excluded, as ever), and the one publication predicate
 * (`publicDocs`) admits the published pages, so a `publish: false` page counts
 * toward neither number — the standard budgets the PUBLISHED corpus, and an
 * unpublished stub or generated draft is not yet part of it. A leaf is a
 * published Markdown page whose basename is not README.md; README files are
 * directory indexes, not leaves. Words measure prose: the frontmatter block is
 * metadata, never content.
 */

import { basename, dirname, fromFileUrl } from "@std/path";
import { loadConfig } from "../src/shared/config_schema.ts";
import { resolveMapDir } from "../src/lib/paths.ts";
import { parseFrontmatter } from "../src/lib/frontmatter.ts";
import { discoverDocs, publicDocs } from "../src/lib/docs.ts";

interface PublicDocMetrics {
  leaves: number;
  words: number;
}

function wordCount(text: string): number {
  return text.match(/[\p{L}\p{N}][\p{L}\p{N}'-]*/gu)?.length ?? 0;
}

async function measurePublicDocs(
  repoRoot: string,
  docsDir: string,
): Promise<PublicDocMetrics> {
  const tree = await discoverDocs({ cwd: repoRoot, dir: docsDir });
  if (tree === undefined) {
    throw new Error(`no documentation tree at ${docsDir}`);
  }
  let leaves = 0;
  let words = 0;
  for (const entry of publicDocs(tree.entries)) {
    const { body } = parseFrontmatter(await Deno.readTextFile(entry.absPath));
    words += wordCount(body);
    if (basename(entry.absPath) !== "README.md") {
      leaves++;
    }
  }
  return { leaves, words };
}

const repoRoot = dirname(dirname(fromFileUrl(import.meta.url)));
const docsDir = Deno.args[0] ??
  resolveMapDir(repoRoot, await loadConfig(repoRoot)).abs;
const metrics = await measurePublicDocs(repoRoot, docsDir);

console.error(
  `${docsDir} public docs: ${metrics.leaves} leaves, ${metrics.words} words`,
);
console.log(`DISCERN_METRIC public_doc_leaves ${metrics.leaves}`);
console.log(`DISCERN_METRIC public_doc_words ${metrics.words}`);
