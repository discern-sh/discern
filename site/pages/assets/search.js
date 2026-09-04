/* Generated from the shared documentation-search source. Regenerate rather than edit. */
// @ts-check

/** @typedef {{ id: string, text: string }} SearchHeading */
/**
 * @typedef {{
 *   route: string,
 *   title: string,
 *   section: string,
 *   description: string,
 *   kind: "tutorial" | "guide" | "explanation" | "reference" | "troubleshooting" | null,
 *   aliases: string[],
 *   headings: SearchHeading[],
 *   codeTerms: string[],
 *   body: string
 * }} SearchPage
 */
/**
 * @typedef {{
 *   page: SearchPage,
 *   heading: SearchHeading | null,
 *   score: number,
 *   snippet: string
 * }} SearchResult
 */

export const SEARCH_FIELD_WEIGHT = Object.freeze({
  title: 100,
  aliases: 75,
  headings: 50,
  codeTerms: 30,
  body: 10,
});

/**
 * Prefer task-shaped teaching and recovery pages when otherwise comparable.
 * Exact title, alias, heading, and code matches still outweigh this bounded
 * editorial tie-break, so an exact contract query continues to reach Reference.
 */
export const SEARCH_KIND_WEIGHT = Object.freeze({
  tutorial: 14,
  guide: 20,
  explanation: 8,
  reference: 0,
  troubleshooting: 24,
  other: 0,
});

/**
 * Fold case and whitespace so every search field shares one lexical form.
 * @param {string} value
 * @returns {string}
 */
function normalize(value) {
  return value.toLocaleLowerCase().replace(/\s+/g, " ").trim();
}

/**
 * Use the highest-priority field containing the complete query phrase.
 *
 * @param {SearchPage} page
 * @param {string} phrase
 * @returns {number}
 */
function phraseWeight(page, phrase) {
  if (normalize(page.title).includes(phrase)) return SEARCH_FIELD_WEIGHT.title;
  if (page.aliases.some((value) => normalize(value).includes(phrase))) {
    return SEARCH_FIELD_WEIGHT.aliases;
  }
  if (page.headings.some((value) => normalize(value.text).includes(phrase))) {
    return SEARCH_FIELD_WEIGHT.headings;
  }
  if (page.codeTerms.some((value) => normalize(value).includes(phrase))) {
    return SEARCH_FIELD_WEIGHT.codeTerms;
  }
  if (normalize(`${page.description} ${page.body}`).includes(phrase)) {
    return SEARCH_FIELD_WEIGHT.body;
  }
  return 0;
}

/**
 * Select the first heading containing the phrase or every individual term.
 *
 * @param {SearchPage} page
 * @param {string[]} terms
 * @param {string} phrase
 * @returns {SearchHeading | null}
 */
function matchingHeading(page, terms, phrase) {
  return page.headings.find((heading) => {
    const text = normalize(heading.text);
    return text.includes(phrase) || terms.every((term) => text.includes(term));
  }) ?? null;
}

/**
 * Crop body text around the phrase or first matching term, falling back to the
 * page description when neither appears.
 *
 * @param {SearchPage} page
 * @param {string[]} terms
 * @param {string} phrase
 * @returns {string}
 */
function snippetFor(page, terms, phrase) {
  const source = page.body || page.description;
  const normalized = normalize(source);
  let at = normalized.indexOf(phrase);
  let matchedLength = phrase.length;
  if (at < 0) {
    for (const term of terms) {
      at = normalized.indexOf(term);
      if (at >= 0) {
        matchedLength = term.length;
        break;
      }
    }
  }
  if (at < 0) return page.description;

  let start = Math.max(0, at - 72);
  let end = Math.min(source.length, at + matchedLength + 112);
  if (start > 0) {
    const nextSpace = source.indexOf(" ", start);
    if (nextSpace >= 0 && nextSpace < at) start = nextSpace + 1;
  }
  if (end < source.length) {
    const previousSpace = source.lastIndexOf(" ", end);
    if (previousSpace > at + matchedLength) end = previousSpace;
  }
  return `${start > 0 ? "…" : ""}${source.slice(start, end).trim()}${
    end < source.length ? "…" : ""
  }`;
}

/**
 * Rank documents entirely in the caller. The public docs site runs this in the
 * browser; map and help run the same matcher locally. No query leaves either
 * environment.
 *
 * @param {readonly SearchPage[]} pages
 * @param {string} query
 * @param {number} [limit]
 * @returns {SearchResult[]}
 */
export function searchPages(pages, query, limit = 12) {
  const phrase = normalize(query);
  const terms = phrase.split(" ").filter(Boolean);
  if (terms.length === 0) return [];

  /** @type {SearchResult[]} */
  const results = [];
  for (const page of pages) {
    let score = 0;
    let complete = true;
    for (const term of terms) {
      const weight = phraseWeight(page, term);
      if (weight === 0) {
        complete = false;
        break;
      }
      score += weight;
    }
    if (!complete) continue;
    score += phraseWeight(page, phrase) * 2;
    results.push({
      page,
      heading: matchingHeading(page, terms, phrase),
      score: score + (SEARCH_KIND_WEIGHT[page.kind ?? "other"] ?? 0),
      snippet: snippetFor(page, terms, phrase),
    });
  }
  return results
    .sort((a, b) =>
      b.score - a.score || a.page.route.localeCompare(b.page.route)
    )
    .slice(0, limit);
}
