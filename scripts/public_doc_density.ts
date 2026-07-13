/**
 * Count public documentation leaves and words, then emit both as discern
 * standard metrics.
 *
 * Public docs are Markdown files under the configured map with no
 * underscore-prefixed path segment, so _private, _internal, and _adr trees are
 * excluded. A leaf is a public Markdown page whose basename is not README.md;
 * README files are directory indexes, not leaves.
 */

import {
  basename,
  dirname,
  fromFileUrl,
  join,
  relative,
  SEPARATOR,
} from "@std/path";
import { loadConfig } from "../src/shared/config_schema.ts";
import { resolveMapDir } from "../src/lib/paths.ts";

interface PublicDocMetrics {
  leaves: number;
  words: number;
}

function isMarkdown(path: string): boolean {
  return path.endsWith(".md");
}

function hasPrivateSegment(path: string): boolean {
  return path.split(SEPARATOR).some((part) => part.startsWith("_"));
}

function wordCount(text: string): number {
  return text.match(/[\p{L}\p{N}][\p{L}\p{N}'-]*/gu)?.length ?? 0;
}

async function measurePublicDocs(docsDir: string): Promise<PublicDocMetrics> {
  let leaves = 0;
  let words = 0;

  async function walk(dir: string): Promise<void> {
    for await (const entry of Deno.readDir(dir)) {
      const path = join(dir, entry.name);
      const rel = relative(docsDir, path);
      if (hasPrivateSegment(rel)) continue;

      if (entry.isDirectory) {
        await walk(path);
        continue;
      }
      if (!entry.isFile || !isMarkdown(entry.name)) continue;

      const text = await Deno.readTextFile(path);
      words += wordCount(text);
      if (basename(entry.name) !== "README.md") {
        leaves++;
      }
    }
  }

  await walk(docsDir);
  return { leaves, words };
}

const repoRoot = dirname(dirname(fromFileUrl(import.meta.url)));
const docsDir = Deno.args[0] ??
  resolveMapDir(repoRoot, await loadConfig(repoRoot)).abs;
const metrics = await measurePublicDocs(docsDir);

console.error(
  `${docsDir} public docs: ${metrics.leaves} leaves, ${metrics.words} words`,
);
console.log(`DISCERN_METRIC public_doc_leaves ${metrics.leaves}`);
console.log(`DISCERN_METRIC public_doc_words ${metrics.words}`);
