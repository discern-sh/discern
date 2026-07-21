/**
 * Vocabulary signals — what the term registry plus the map's own link graph
 * can measure about how the canon is USED, beyond whether it drifted:
 *
 *  - a DEAD TERM: a glossary entry no live map page names or links. A term
 *    nobody reaches for is canon in name only — either the pages should use
 *    it, or the entry has outlived its subject.
 *  - a REDEFINITION: a live page restating a term bold-faced
 *    (`**term** — …`) instead of using it plainly and linking the glossary.
 *    Two definitions of one term is how vocabulary drift starts.
 *
 * The sum is the `vocabulary_debt` metric behind `[standards.vocabulary]` —
 * a ceiling that may only fall. Links are read with the same extractor the
 * map-integrity guard uses, and heading anchors with the same renderer, so a
 * link counts here exactly when it resolves there.
 *
 * Like the glossary registry, this lives under `scripts/`: it is measurement
 * tooling for this repo's own map, not part of the shipped binary.
 */

import { walk } from "@std/fs";
import { join, relative } from "@std/path";
import { GLOSSARY, type GlossaryEntry } from "./glossary_registry.ts";
import { extractDocLinks } from "../src/lib/docs_integrity.ts";
import { renderMarkdownHtml } from "../src/lib/markdown.ts";
import { parseFrontmatter } from "../src/lib/frontmatter.ts";

/** One bold-faced restatement of a term outside the glossary. */
export interface Redefinition {
  /** Path relative to the map dir. */
  file: string;
  /** 1-based line of the restatement in the source file. */
  line: number;
  /** The canonical term restated. */
  term: string;
}

export interface VocabSignals {
  /** Terms no scanned page names or links, in glossary order. */
  deadTerms: string[];
  /** Bold-faced restatements, ordered by file then line. */
  redefinitions: Redefinition[];
  /** The metric: dead terms plus redefinitions. */
  debt: number;
}

/** Where the generated glossary page lives inside the map. */
export const GLOSSARY_PAGE_REL: string = join("00-orientation", "glossary.md");

/** The name forms a term is recognised by: leading "The " dropped, and each
 * side of a "A / B" heading its own variant. */
function termVariants(term: string): string[] {
  return term
    .replace(/^the /i, "")
    .split(" / ")
    .map((v) => v.trim())
    .filter((v) => v.length > 0);
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** A variant as regex alternation: word-bounded words joined across any
 * whitespace, the last word accepting a naive plural ("capability" matches
 * "capabilities", "skill" matches "skills"). */
function variantSource(variant: string): string {
  const words = variant.split(/\s+/).map(escapeRegExp);
  const last = words.at(-1) ?? "";
  const plural = last.endsWith("y")
    ? `${last.slice(0, -1)}(?:y|ies)`
    : `${last}(?:e?s)?`;
  return [...words.slice(0, -1), plural].join(String.raw`\s+`);
}

/** Matches any plain textual use of the term. */
export function referencePattern(term: string): RegExp {
  const alts = termVariants(term).map(variantSource).join("|");
  return new RegExp(String.raw`\b(?:${alts})\b`, "i");
}

/** Matches a bold-faced restatement: `**term** — …`, `**term**: …`. */
export function redefinitionPattern(term: string): RegExp {
  const alts = termVariants(term).map(variantSource).join("|");
  return new RegExp(
    String.raw`\*\*(?:the )?(?:${alts})\*\*\s*(?:—|–|:|-{1,2})\s`,
    "gi",
  );
}

/**
 * Each term's heading anchor on the rendered glossary page, keyed by anchor.
 * Rendered with the shared renderer, so the ids are exactly the ones the
 * published page exposes and the map-integrity guard validates links against.
 */
function termsByAnchor(
  glossary: readonly GlossaryEntry[],
): Map<string, string> {
  const md = glossary.map((e) => `### ${e.term}`).join("\n\n");
  const { headings } = renderMarkdownHtml(md);
  const out = new Map<string, string>();
  headings.forEach((h, i) => {
    const term = glossary[i]?.term;
    if (term !== undefined) out.set(h.id, term);
  });
  return out;
}

/** True when the map-relative path is outside the live scan: the glossary
 * page itself (the definition site) or a `_`-prefixed tree (dated or private
 * records). */
function outsideScan(rel: string): boolean {
  return rel === GLOSSARY_PAGE_REL ||
    rel.split("/").some((segment) => segment.startsWith("_"));
}

/** Measure the vocabulary signals for a map tree against a glossary. */
export async function measureVocabSignals(
  mapDir: string,
  glossary: readonly GlossaryEntry[] = GLOSSARY,
): Promise<VocabSignals> {
  const anchors = termsByAnchor(glossary);
  const matchers = glossary.map((entry) => ({
    term: entry.term,
    reference: referencePattern(entry.term),
    redefinition: redefinitionPattern(entry.term),
  }));
  const referenced = new Set<string>();
  const redefinitions: Redefinition[] = [];

  for await (
    const entry of walk(mapDir, { includeDirs: false, exts: [".md"] })
  ) {
    const rel = relative(mapDir, entry.path);
    if (outsideScan(rel)) continue;
    const md = await Deno.readTextFile(entry.path);
    const { body } = parseFrontmatter(md);
    const offset = md.split("\n").length - body.split("\n").length;

    for (const { term, reference, redefinition } of matchers) {
      if (!referenced.has(term) && reference.test(body)) referenced.add(term);
      for (const match of body.matchAll(redefinition)) {
        redefinitions.push({
          file: rel,
          line: offset + body.slice(0, match.index).split("\n").length,
          term,
        });
      }
    }

    // A link to a term's glossary anchor references it even when the prose
    // says something else ("the shared branch").
    for (const { target } of extractDocLinks(md)) {
      const at = target.indexOf("glossary.md#");
      if (at === -1) continue;
      const term = anchors.get(target.slice(at + "glossary.md#".length));
      if (term !== undefined) referenced.add(term);
    }
  }

  const deadTerms = glossary
    .map((e) => e.term)
    .filter((term) => !referenced.has(term));
  redefinitions.sort((a, b) =>
    a.file === b.file ? a.line - b.line : a.file < b.file ? -1 : 1
  );
  return {
    deadTerms,
    redefinitions,
    debt: deadTerms.length + redefinitions.length,
  };
}
