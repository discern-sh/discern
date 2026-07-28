/** The product name used in machine-readable and generated-file identity. */
export const DISCERN_NAME = "discern";

/** The canonical product URL used in generated-file identity. */
export const DISCERN_URL = "https://discern.sh";

/** The canonical project mark: U+25EE, UP-POINTING TRIANGLE WITH RIGHT HALF BLACK. */
export const DISCERN_MARK = "◮";

/** The text wordmark used by decorative human-facing headings. */
export const DISCERN_WORDMARK = `${DISCERN_MARK} ${DISCERN_NAME}`;

/** The shared opening of every hash-comment provenance marker. */
export const GENERATED_ARTIFACT_MARKER_PREFIX =
  `# ${DISCERN_NAME} | generated from `;

/** A provenance marker's text without the format-specific hash-comment prefix. */
export function generatedArtifactMarkerBody(source: string): string {
  return `${DISCERN_NAME} | generated from ${source} | ` +
    `hand edits to this discern-owned content are overwritten | ${DISCERN_URL}`;
}

/**
 * Identify discern-owned content in a comment-capable artifact outside agent
 * context. Callers supply the registry-owned source description; the product
 * name, overwrite warning, and URL remain one shared string.
 */
export function generatedArtifactMarker(source: string): string {
  return `# ${generatedArtifactMarkerBody(source)}`;
}

/** Remove one exact provenance marker while preserving the file's line endings. */
export function stripGeneratedArtifactMarker(
  text: string,
  source: string,
): string {
  const eol = text.includes("\r\n") ? "\r\n" : "\n";
  const marker = generatedArtifactMarker(source);
  return text.split(/\r?\n/).filter((line) => line !== marker).join(eol);
}

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
