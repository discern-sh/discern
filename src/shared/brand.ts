import { discernAttributionEnabled, type EnvReader } from "./env.ts";

/** The product name used in machine-readable and generated-file identity. */
export const DISCERN_NAME = "discern";

/** The canonical product URL used in generated-file identity. */
export const DISCERN_URL = "https://discern.sh";

/** The canonical project mark: U+25EE, UP-POINTING TRIANGLE WITH RIGHT HALF BLACK. */
export const DISCERN_MARK = "◮";

/** The text wordmark used by decorative human-facing headings. */
export const DISCERN_WORDMARK = `${DISCERN_MARK} ${DISCERN_NAME}`;

/** The shared opening of every hash-comment provenance marker. */
export const GENERATED_ARTIFACT_MARKER_PREFIX = "# Generated automatically ";

/** The attributed provenance body used unless the process opts out. */
function attributedArtifactMarkerBody(source: string): string {
  return `Generated automatically by ${DISCERN_NAME} via ${source} | ${DISCERN_URL}`;
}

/** The source-only provenance body used when attribution is disabled. */
function unattributedArtifactMarkerBody(source: string): string {
  return `Generated automatically via ${source}`;
}

/** An alternate attributed marker body accepted during reconciliation. */
function alternateAttributedArtifactMarkerBody(source: string): string {
  return `Generated automatically by ${DISCERN_NAME}. See: ${source} | ${DISCERN_URL}`;
}

/** A marker body refresh recognizes and removes during reconciliation. */
function legacyArtifactMarkerBody(source: string): string {
  return `${DISCERN_NAME} | generated from ${source} | ` +
    `hand edits to this discern-owned content are overwritten | ${DISCERN_URL}`;
}

/** A provenance marker's text without the format-specific hash-comment prefix. */
export function generatedArtifactMarkerBody(
  source: string,
  env: EnvReader = Deno.env,
): string {
  return discernAttributionEnabled(env)
    ? attributedArtifactMarkerBody(source)
    : unattributedArtifactMarkerBody(source);
}

/**
 * Identify discern-owned content in a comment-capable artifact outside agent
 * context. Callers supply the registry-owned source description; the shared
 * renderer applies the process-wide attribution preference.
 */
export function generatedArtifactMarker(
  source: string,
  env: EnvReader = Deno.env,
): string {
  return `# ${generatedArtifactMarkerBody(source, env)}`;
}

/** Whether a line is a recognized marker for this source. */
export function isGeneratedArtifactMarker(
  line: string,
  source: string,
): boolean {
  return [
    attributedArtifactMarkerBody(source),
    unattributedArtifactMarkerBody(source),
    alternateAttributedArtifactMarkerBody(source),
    legacyArtifactMarkerBody(source),
  ].some((body) => line === `# ${body}`);
}

/** Remove every known provenance marker while preserving the file's line endings. */
export function stripGeneratedArtifactMarker(
  text: string,
  source: string,
): string {
  const eol = text.includes("\r\n") ? "\r\n" : "\n";
  return text.split(/\r?\n/).filter((line) =>
    !isGeneratedArtifactMarker(line, source)
  ).join(eol);
}

/** Couple a Git author name and email with their canonical commit trailer. */
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
export const DISCERN_MACHINE = coAuthorIdentity(
  DISCERN_NAME,
  "done@discern.sh",
);

/**
 * The product category — the searchable two-word phrase naming what discern
 * is. Every carrier (the README's positioning line, the social card's tag
 * line) quotes it verbatim; the vocabulary guards interpolate this constant,
 * so renaming the category here fails every carrier that didn't follow.
 */
export const DISCERN_CATEGORY = "quality harness";
