/** Immutable v1 mapping from structured worktree state to public identity. */

/**
 * Every constant and input axis used by the live identity derivation.
 *
 * `seed` is a deterministic branch-derived ordering and replay value. POSIX
 * `cksum` is not cryptographic; neither `seed` nor any sibling field is an
 * entropy, authorization, secrecy, or security boundary.
 */
export const WORKTREE_IDENTITY_CONTRACT = Object.freeze(
  {
    checksum: "posix-cksum",
    portBase: 17290,
    portSpan: 2000,
    dnsLabelLimit: 63,
    databaseInputs: ["project-slug", "worktree-id"],
    branchInputs: ["branch-prefix", "worktree-id"],
    seedInput: "full-branch",
    slugCollisionPrefix: "wt-",
  } as const,
);
