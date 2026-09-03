import { discernAttributionEnabled, type EnvReader } from "./env.ts";
import { DISCERN_NAME, DISCERN_URL } from "./product_identity.ts";
export {
  DISCERN_ADVISORY_URL,
  DISCERN_DOCS_URL,
  DISCERN_INSTALL_ROUTE,
  DISCERN_ISSUES_URL,
  DISCERN_NAME,
  DISCERN_RAW_INSTALL_URL,
  DISCERN_RELEASES_URL,
  DISCERN_REPOSITORY_SLUG,
  DISCERN_REPOSITORY_URL,
  DISCERN_URL,
  INSTALL_COMMAND,
  repositoryBlobUrl,
  repositoryTreeUrl,
} from "./product_identity.ts";

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
  ].some((body) => line === `# ${body}`);
}

/** The attributed body for a marker scoped to values in a shared file. */
function attributedManagedValuesMarkerBody(
  subject: string,
  source: string,
): string {
  return `${subject} managed by ${DISCERN_NAME} via ${source} | ${DISCERN_URL}`;
}

/** The source-only body for a marker scoped to values in a shared file. */
function unattributedManagedValuesMarkerBody(
  subject: string,
  source: string,
): string {
  return `${subject} managed via ${source}`;
}

/** Render a marker that claims only discern-managed values in a shared file. */
export function managedValuesMarker(
  subject: string,
  source: string,
  env: EnvReader = Deno.env,
): string {
  const body = discernAttributionEnabled(env)
    ? attributedManagedValuesMarkerBody(subject, source)
    : unattributedManagedValuesMarkerBody(subject, source);
  return `# ${body}`;
}

/** Whether a line is either attribution mode of one scoped values marker. */
export function isManagedValuesMarker(
  line: string,
  subject: string,
  source: string,
): boolean {
  return [
    attributedManagedValuesMarkerBody(subject, source),
    unattributedManagedValuesMarkerBody(subject, source),
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
