/**
 * File ownership declarations for discern's project-tree artifact registry.
 *
 * The marker form is intentional: an entry may be malformed in memory with no
 * marker or several markers, so the forcing-function test can prove that the
 * registry rejects both cases. Production declarations carry one marker.
 */

import { DISCERN_PROJECT_PAYLOAD_LICENSE } from "./license_registry.ts";

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
 * Where one comment-capable artifact's discern-maintained content comes from,
 * rendered into its provenance marker. A Shared artifact names the `scope` its
 * marker claims for discern, because other content in the file is not
 * discern's; Generated output has none, because its marker claims the whole file.
 */
export interface ArtifactProvenance {
  readonly source: string;
  readonly scope?: string;
}

/**
 * One written artifact's provenance declaration. Comment-capable output carries
 * the provenance its producer renders into the marker.
 */
export interface WrittenArtifactClassDeclaration {
  readonly "context-loaded"?: true;
  readonly "comment-incapable"?: true;
  readonly "comment-capable-non-context"?: ArtifactProvenance;
}

/** The minimum identity needed to validate a written-artifact declaration. */
export interface ClassifiableWrittenArtifact {
  readonly id: string;
  readonly writtenArtifact: WrittenArtifactClassDeclaration;
}

/** Shared provenance used by registry declarations and producers. */
export const ARTIFACT_PROVENANCE = {
  config: {
    source: "the bundled project configuration template",
    scope: "Scaffold and banners",
  },
  gitattributes: {
    source: "discern.toml, the source-path registry, and the provider registry",
    scope: "This block",
  },
  gitignore: {
    source: "the bundled .gitignore fragment and provider registry",
    scope: "This block",
  },
  skillsIgnore: { source: "the materialized-skills record beside it" },
  worktreeEnvironment: {
    source: "[worktree] in discern.toml",
    scope: "Worktree values",
  },
  codexConfig: {
    source: "the Codex integration and discern.toml",
    scope: "MCP server, writable-root, and doc-size entries",
  },
  codexEnvironment: {
    source: "the Codex worktree integration",
    scope: "Setup and cleanup scripts",
  },
  codexRules: {
    source: "the bundled Codex project rules",
    scope: "These rules",
  },
} as const satisfies Readonly<Record<string, ArtifactProvenance>>;

/** Reusable declarations for the 2 classes that need no source description. */
export const CONTEXT_LOADED_ARTIFACT = {
  "context-loaded": true,
} as const satisfies WrittenArtifactClassDeclaration;
export const COMMENT_INCAPABLE_ARTIFACT = {
  "comment-incapable": true,
} as const satisfies WrittenArtifactClassDeclaration;

/** Declare comment-capable output and the provenance its marker names. */
export function commentCapableNonContextArtifact(
  provenance: ArtifactProvenance,
): WrittenArtifactClassDeclaration {
  return { "comment-capable-non-context": provenance };
}

/**
 * Resolve one written-artifact declaration to its single class, rejecting zero,
 * several, or a comment-capable class without a source description or with a
 * blank scope.
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
  const provenance = entry.writtenArtifact["comment-capable-non-context"];
  if (
    artifactClass === "comment-capable-non-context" &&
    provenance?.source.trim() === ""
  ) {
    throw new Error(
      `${entry.id} must name the source for its provenance marker`,
    );
  }
  if (provenance?.scope?.trim() === "") {
    throw new Error(`${entry.id} declares a blank provenance marker scope`);
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

/** The license applied to discern-authored project payloads. */
export type DiscernProjectPayloadLicense =
  typeof DISCERN_PROJECT_PAYLOAD_LICENSE.identifier;

/**
 * Resolve the license for discern-authored material in one project artifact.
 * File ownership governs editing and overwrite behavior; project-, user-, and
 * third-party-authored portions in the same destination keep their own terms.
 */
export function discernProjectPayloadLicense(
  entry: OwnablePath,
): DiscernProjectPayloadLicense | undefined {
  return declaredFileOwnership(entry) === PROVIDER_LOCAL
    ? undefined
    : DISCERN_PROJECT_PAYLOAD_LICENSE.identifier;
}
