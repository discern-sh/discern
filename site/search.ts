/**
 * The docs search projection. It deliberately sits outside docs.ts: the shell
 * supplies route/section context, while this module owns the public boundary
 * and the stripped, weighted fields consumed by the client-side matcher.
 */

import { isPublicDoc } from "../src/lib/docs.ts";
import { stripAdrCitations } from "../src/lib/adr_citations.ts";
import { parseFrontmatter } from "../src/lib/frontmatter.ts";
import {
  type SearchIndex,
  type SearchPage,
  searchPageFromMarkdown as projectSearchPage,
  type SearchSource,
} from "../src/lib/docs_search.ts";

export {
  markdownCodeTerms,
  markdownSearchText,
  type SearchHeading,
  type SearchIndex,
  type SearchPage,
  type SearchSource,
} from "../src/lib/docs_search.ts";

/** The whole client-side index. No query or usage data travels the other way. */
export type ReadSearchSource = (path: string) => Promise<string>;

/** Decision records are history, not launch-search product guidance. */
export function isSearchableSource(source: SearchSource): boolean {
  return isPublicDoc(source.entry) && source.entry.section !== "_adr";
}

/** Build one record from the same stripped human projection the page renders. */
export function searchPageFromMarkdown(
  source: SearchSource,
  markdown: string,
): SearchPage {
  const { body } = parseFrontmatter(markdown);
  const stripped = stripAdrCitations(body);
  return projectSearchPage(source, stripped);
}

/** Build the index, filtering before any excluded source is even read. */
export async function buildSearchIndex(
  sources: readonly SearchSource[],
  readText: ReadSearchSource = (path) => Deno.readTextFile(path),
): Promise<SearchIndex> {
  const pages: SearchPage[] = [];
  for (const source of sources) {
    if (!isSearchableSource(source)) continue;
    pages.push(
      searchPageFromMarkdown(source, await readText(source.entry.absPath)),
    );
  }
  return { pages };
}
