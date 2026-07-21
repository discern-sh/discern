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
