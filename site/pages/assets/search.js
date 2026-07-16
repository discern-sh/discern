// @ts-check

/** @typedef {{ id: string, text: string }} SearchHeading */
/**
 * @typedef {{
 *   route: string,
 *   title: string,
 *   section: string,
 *   description: string,
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

const WEIGHT = Object.freeze({
  title: 100,
  aliases: 75,
  headings: 50,
  codeTerms: 30,
  body: 10,
});

/** @param {string} value @returns {string} */
function normalize(value) {
  return value.toLocaleLowerCase().replace(/\s+/g, " ").trim();
}

/**
 * @param {SearchPage} page
 * @param {string} phrase
 * @returns {number}
 */
function phraseWeight(page, phrase) {
  if (normalize(page.title).includes(phrase)) return WEIGHT.title;
  if (page.aliases.some((value) => normalize(value).includes(phrase))) {
    return WEIGHT.aliases;
  }
  if (page.headings.some((value) => normalize(value.text).includes(phrase))) {
    return WEIGHT.headings;
  }
  if (page.codeTerms.some((value) => normalize(value).includes(phrase))) {
    return WEIGHT.codeTerms;
  }
  if (normalize(`${page.description} ${page.body}`).includes(phrase)) {
    return WEIGHT.body;
  }
  return 0;
}

/**
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
 * Search entirely in the browser. No query leaves the page.
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
      score,
      snippet: snippetFor(page, terms, phrase),
    });
  }
  return results
    .sort((a, b) =>
      b.score - a.score || a.page.route.localeCompare(b.page.route)
    )
    .slice(0, limit);
}
