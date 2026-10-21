import { discernAttributionEnabled, type EnvReader } from "./env.ts";
import { DISCERN_NAME, DISCERN_URL } from "./product_identity.ts";
import { GENERATED_ARTIFACT_MARKER_PREFIX } from "./git_conventions.ts";
import type { ArtifactProvenance } from "./file_ownership.ts";
export {
  DISCERN_MACHINE,
  GENERATED_ARTIFACT_MARKER_PREFIX,
} from "./git_conventions.ts";
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

/** The canonical blue hue shared by Discern's browser and terminal Appearance. */
export const DISCERN_ACCENT_HUE = 255;

/** The text wordmark used by decorative human-facing headings. */
export const DISCERN_WORDMARK = `${DISCERN_MARK} ${DISCERN_NAME}`;

/**
 * What a marker claims: the whole file for Generated output, or the declared
 * scope within a Shared file.
 */
function provenanceClaim(scope: string | undefined): string {
  return scope === undefined
    ? GENERATED_ARTIFACT_MARKER_PREFIX.slice(2)
    : `${scope} managed `;
}

/** The attributed provenance body used unless the process opts out. */
function attributedArtifactMarkerBody(
  claim: string,
  source: string,
): string {
  return `${claim}by ${DISCERN_NAME} via ${source} | ${DISCERN_URL}`;
}

/** The source-only provenance body used when attribution is disabled. */
function unattributedArtifactMarkerBody(
  claim: string,
  source: string,
): string {
  return `${claim}via ${source}`;
}

/** A provenance marker's text without the format-specific hash-comment prefix. */
export function artifactProvenanceMarkerBody(
  provenance: ArtifactProvenance,
  env: EnvReader = Deno.env,
): string {
  const claim = provenanceClaim(provenance.scope);
  return discernAttributionEnabled(env)
    ? attributedArtifactMarkerBody(claim, provenance.source)
    : unattributedArtifactMarkerBody(claim, provenance.source);
}

/**
 * Identify discern's content in a comment-capable artifact outside agent
 * context. Callers supply the registry-owned provenance: a Shared file's marker
 * claims only its declared scope, a Generated file's marker the whole file. The
 * shared renderer applies the process-wide attribution preference.
 */
export function artifactProvenanceMarker(
  provenance: ArtifactProvenance,
  env: EnvReader = Deno.env,
): string {
  return `# ${artifactProvenanceMarkerBody(provenance, env)}`;
}

/**
 * Whether a line is a marker for this provenance's source, in either
 * attribution mode and claiming either its scope or the whole file, so a
 * rewrite replaces a marker rendered under either ownership.
 */
export function isArtifactProvenanceMarker(
  line: string,
  provenance: ArtifactProvenance,
): boolean {
  const claims = [provenanceClaim(undefined)];
  if (provenance.scope !== undefined) {
    claims.push(provenanceClaim(provenance.scope));
  }
  return claims.some((claim) =>
    line === `# ${attributedArtifactMarkerBody(claim, provenance.source)}` ||
    line === `# ${unattributedArtifactMarkerBody(claim, provenance.source)}`
  );
}

/** Remove every known provenance marker while preserving the file's line endings. */
export function stripArtifactProvenanceMarker(
  text: string,
  provenance: ArtifactProvenance,
): string {
  const eol = text.includes("\r\n") ? "\r\n" : "\n";
  return text.split(/\r?\n/).filter((line) =>
    !isArtifactProvenanceMarker(line, provenance)
  ).join(eol);
}
