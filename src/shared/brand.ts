/** The canonical project mark: U+25EE, UP-POINTING TRIANGLE WITH RIGHT HALF BLACK. */
export const DISCERN_MARK = "◮";

/** The text wordmark used by decorative human-facing headings. */
export const DISCERN_WORDMARK = `${DISCERN_MARK} discern`;

function coAuthorIdentity<
  const Name extends string,
  const Email extends string,
>(
  name: Name,
  email: Email,
): {
  readonly name: Name;
  readonly email: Email;
  readonly trailer: string;
} {
  return {
    name,
    email,
    trailer: `Co-Authored-By: ${name} <${email}>`,
  };
}

/** The identity attached to commits whose diffs discern composes. */
export const DISCERN_BOT = coAuthorIdentity(
  "discern-bot",
  "bot@discern.sh",
);

/**
 * The product category — the searchable two-word phrase naming what discern
 * is. Every carrier (the README's positioning line, the social card's tag
 * line) quotes it verbatim; the vocabulary guards interpolate this constant,
 * so renaming the category here fails every carrier that didn't follow.
 */
export const DISCERN_CATEGORY = "quality harness";
