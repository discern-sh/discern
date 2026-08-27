/** Identity field vocabularies shared by the Engine and result schemas. */

/** Stored identity values projected through status, MCP, and status resources. */
export const WORKTREE_IDENTITY_FIELDS = [
  "id",
  "site",
  "branch",
  "port",
  "db",
  "seed",
] as const;

/** One stored identity value. */
export type WorktreeIdentityField = (typeof WORKTREE_IDENTITY_FIELDS)[number];

/** Values selectable by `discern identity`, including the derived base handle. */
export const WORKTREE_FIELDS = [
  ...WORKTREE_IDENTITY_FIELDS,
  "worktree",
] as const;

/** One resolvable identity field. */
export type WorktreeField = (typeof WORKTREE_FIELDS)[number];
