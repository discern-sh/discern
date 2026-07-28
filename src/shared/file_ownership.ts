/**
 * File ownership declarations for discern's project-tree artifact registry.
 *
 * The marker form is intentional: an entry may be malformed in memory with no
 * marker or several markers, so the forcing-function test can prove that the
 * registry rejects both cases. Production declarations carry one marker.
 */

/** The three File ownership buckets, in documentation order. */
export const FILE_OWNERSHIP_BUCKETS = [
  "project-owned",
  "shared",
  "generated",
] as const;

/** One of the three File ownership buckets. */
export type FileOwnershipBucket = (typeof FILE_OWNERSHIP_BUCKETS)[number];

/** The explicit category for a provider-created path discern does not write. */
export const PROVIDER_LOCAL = "provider-local" as const;

/** A declared File ownership bucket or the provider-local outside category. */
export type FileOwnershipKind = FileOwnershipBucket | typeof PROVIDER_LOCAL;

/** The provenance classes for artifacts discern continues to write or maintain. */
export const WRITTEN_ARTIFACT_CLASSES = [
  "context-loaded",
  "comment-incapable",
  "comment-capable-non-context",
] as const;

/** One provenance class for a Shared or Generated artifact. */
export type WrittenArtifactClass = (typeof WRITTEN_ARTIFACT_CLASSES)[number];

/**
 * One written artifact's provenance declaration. Comment-capable output carries
 * the source description its producer renders into the marker.
 */
export interface WrittenArtifactClassDeclaration {
  readonly "context-loaded"?: true;
  readonly "comment-incapable"?: true;
  readonly "comment-capable-non-context"?: string;
}

/** The minimum identity needed to validate a written-artifact declaration. */
export interface ClassifiableWrittenArtifact {
  readonly id: string;
  readonly writtenArtifact: WrittenArtifactClassDeclaration;
}

/** Shared source descriptions used by registry declarations and producers. */
export const ARTIFACT_PROVENANCE_SOURCES = {
  config: "the bundled project configuration template",
  gitignore: "the bundled .gitignore fragment and provider registry",
  worktreeEnvironment: "[worktree] in discern.toml",
  codexConfig: "the Codex integration and discern.toml",
  codexEnvironment: "the Codex worktree integration",
  codexRules: "the bundled Codex project rules",
} as const;

/** Reusable declarations for the 2 classes that need no source description. */
export const CONTEXT_LOADED_ARTIFACT = {
  "context-loaded": true,
} as const satisfies WrittenArtifactClassDeclaration;
export const COMMENT_INCAPABLE_ARTIFACT = {
  "comment-incapable": true,
} as const satisfies WrittenArtifactClassDeclaration;

/** Declare comment-capable output and the source its marker names. */
export function commentCapableNonContextArtifact(
  source: string,
): WrittenArtifactClassDeclaration {
  return { "comment-capable-non-context": source };
}

/**
 * Resolve one written-artifact declaration to its single class, rejecting zero,
 * several, or a comment-capable class without a source description.
 */
export function declaredWrittenArtifactClass(
  entry: ClassifiableWrittenArtifact,
): WrittenArtifactClass {
  const selected: WrittenArtifactClass[] = [];
  for (const artifactClass of WRITTEN_ARTIFACT_CLASSES) {
    if (entry.writtenArtifact[artifactClass] !== undefined) {
      selected.push(artifactClass);
    }
  }
  if (selected.length !== 1) {
    throw new Error(
      `${entry.id} must declare exactly one of context-loaded, ` +
        `comment-incapable, or comment-capable-non-context; found ${selected.length}`,
    );
  }
  const artifactClass = selected[0];
  if (artifactClass === undefined) {
    throw new Error(`${entry.id} has no written-artifact class`);
  }
  if (
    artifactClass === "comment-capable-non-context" &&
    entry.writtenArtifact[artifactClass]?.trim() === ""
  ) {
    throw new Error(
      `${entry.id} must name the source for its provenance marker`,
    );
  }
  return artifactClass;
}

/**
 * One path's ownership declaration. Exactly one property must be present.
 * `provider-local` carries the reason the path sits outside File ownership.
 */
export interface FileOwnershipDeclaration {
  readonly "project-owned"?: true;
  readonly shared?: true;
  readonly generated?: true;
  readonly "provider-local"?: string;
}

/** The minimum identity needed to validate an ownership declaration. */
export interface OwnablePath {
  readonly id: string;
  readonly ownership: FileOwnershipDeclaration;
}

/**
 * Resolve one declaration to its single kind, rejecting zero, several, or an
 * unexplained provider-local marker.
 */
export function declaredFileOwnership(entry: OwnablePath): FileOwnershipKind {
  const selected: FileOwnershipKind[] = [];
  for (const bucket of FILE_OWNERSHIP_BUCKETS) {
    if (entry.ownership[bucket] === true) {
      selected.push(bucket);
    }
  }
  if (entry.ownership[PROVIDER_LOCAL] !== undefined) {
    selected.push(PROVIDER_LOCAL);
  }
  if (selected.length !== 1) {
    throw new Error(
      `${entry.id} must declare exactly one of project-owned, shared, ` +
        `generated, or provider-local; found ${selected.length}`,
    );
  }
  const kind = selected[0];
  if (kind === undefined) {
    throw new Error(`${entry.id} has no file ownership declaration`);
  }
  if (
    kind === PROVIDER_LOCAL &&
    entry.ownership[PROVIDER_LOCAL]?.trim() === ""
  ) {
    throw new Error(`${entry.id} must explain why it is provider-local`);
  }
  return kind;
}
