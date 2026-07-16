/**
 * The docs search projection. It deliberately sits outside docs.ts: the shell
 * supplies route/section context, while this module owns the public boundary
 * and the stripped, weighted fields consumed by the client-side matcher.
 */

import { type DocEntry, isPublicDoc } from "../src/lib/docs.ts";
import { stripAdrCitations } from "../src/lib/adr_citations.ts";
import { parseFrontmatter } from "../src/lib/frontmatter.ts";
import { inlineToPlain, renderMarkdownHtml } from "../src/lib/markdown.ts";

/** One route eligible to contribute to the search projection. */
export interface SearchSource {
  route: string;
  section: string;
  entry: DocEntry;
}

/** One searchable heading and its destination fragment. */
export interface SearchHeading {
  id: string;
  text: string;
}

/** One client-side search record. Field separation preserves rank weights. */
export interface SearchPage {
  route: string;
  title: string;
  section: string;
  description: string;
  aliases: string[];
  headings: SearchHeading[];
  codeTerms: string[];
  body: string;
}

/** The whole client-side index. No query or usage data travels the other way. */
export interface SearchIndex {
  pages: SearchPage[];
}

export type ReadSearchSource = (path: string) => Promise<string>;

/** Decision records are history, not launch-search product guidance. */
export function isSearchableSource(source: SearchSource): boolean {
  return isPublicDoc(source.entry) && source.entry.section !== "_adr";
}

/** Flatten Markdown to readable search prose while retaining literal terms. */
export function markdownSearchText(markdown: string): string {
  const lines: string[] = [];
  let inFence = false;
  for (const raw of markdown.split(/\r?\n/)) {
    if (/^\s*(```|~~~)/.test(raw)) {
      inFence = !inFence;
      continue;
    }
    const withoutBlockSyntax = inFence ? raw : raw
      .replace(/^\s{0,3}#{1,6}\s+/, "")
      .replace(/^\s*>\s?/, "")
      .replace(/^\s*(?:[-+*]|\d+[.)])\s+/, "")
      .replace(/^\s*\|?\s*:?-{3,}:?(?:\s*\|\s*:?-{3,}:?)+\s*\|?\s*$/, "");
    const plain = inlineToPlain(withoutBlockSyntax)
      .replace(/\s+/g, " ")
      .trim();
    if (plain !== "") lines.push(plain);
  }
  return lines.join(" ");
}

/** Extract fenced and inline code as a distinct, higher-weight search field. */
export function markdownCodeTerms(markdown: string): string[] {
  const terms: string[] = [];
  let fence: string[] | undefined;
  for (const raw of markdown.split(/\r?\n/)) {
    if (/^\s*(```|~~~)/.test(raw)) {
      if (fence === undefined) {
        fence = [];
      } else {
        const block = fence.join(" ").replace(/\s+/g, " ").trim();
        if (block !== "") terms.push(block);
        fence = undefined;
      }
      continue;
    }
    if (fence !== undefined) {
      fence.push(raw);
      continue;
    }
    for (const match of raw.matchAll(/`+([^`]+?)`+/g)) {
      const term = match[1]?.replace(/\s+/g, " ").trim();
      if (term) terms.push(term);
    }
  }
  if (fence !== undefined) {
    const block = fence.join(" ").replace(/\s+/g, " ").trim();
    if (block !== "") terms.push(block);
  }
  return [...new Set(terms)];
}

/** Build one record from the same stripped human projection the page renders. */
export function searchPageFromMarkdown(
  source: SearchSource,
  markdown: string,
): SearchPage {
  const { body } = parseFrontmatter(markdown);
  const stripped = stripAdrCitations(body);
  const rendered = renderMarkdownHtml(stripped);
  return {
    route: source.route,
    title: source.entry.title,
    section: source.section,
    description: source.entry.description,
    aliases: source.entry.aliases,
    headings: rendered.headings
      .filter((heading) => heading.depth >= 2)
      .map((heading) => ({ id: heading.id, text: heading.text })),
    codeTerms: markdownCodeTerms(stripped),
    body: markdownSearchText(stripped),
  };
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
