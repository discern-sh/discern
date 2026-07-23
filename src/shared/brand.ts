/** The canonical project mark: U+25EE, UP-POINTING TRIANGLE WITH RIGHT HALF BLACK. */
export const DISCERN_MARK = "◮";

/** The text wordmark used by decorative human-facing headings. */
export const DISCERN_WORDMARK = `${DISCERN_MARK} discern`;

/**
 * The product category — the searchable two-word phrase naming what discern
 * is. Every carrier (the README's positioning line, the social card's tag
 * line) quotes it verbatim; the vocabulary guards interpolate this constant,
 * so renaming the category here fails every carrier that didn't follow.
 */
export const DISCERN_CATEGORY = "quality harness";
