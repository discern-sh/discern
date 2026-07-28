/**
 * The restricted writer-module relationships enforced over the shipped import
 * graph. A capability module may be imported or re-exported only by its named
 * production owner; aliases and helper indirection cannot change that edge.
 */

import { DISCERN_AUTHORED_COMMIT_SITES } from "../src/shared/discern_commit.ts";

export interface RestrictedWriterModule {
  readonly id: string;
  /** Repo-relative module carrying the write capability. */
  readonly module: `src/${string}.ts`;
  /** Every shipped module allowed a direct runtime dependency on it. */
  readonly allowedImporters: readonly `src/${string}.ts`[];
  /** Why the authority is this narrow, rendered in guard diagnostics. */
  readonly authority: string;
}

const commitCallers = [
  ...new Set(
    Object.values(DISCERN_AUTHORED_COMMIT_SITES).map((site) =>
      site.callerModule
    ),
  ),
].sort();

export const RESTRICTED_WRITER_MODULES = [
  {
    id: "discern-authored-commit",
    module: "src/shared/discern_commit.ts",
    allowedImporters: commitCallers,
    authority:
      "only canonical workflows whose diffs discern composes may commit them",
  },
  {
    id: "effort-grant-human-writer",
    module: "src/engine/worktree/effort_grant_writer.ts",
    allowedImporters: ["src/engine/desk/desk.ts"],
    authority: "only the human-operated desk may create effort authority",
  },
  {
    id: "effort-grant-cleanup",
    module: "src/engine/worktree/effort_grant_cleanup.ts",
    allowedImporters: [
      "src/engine/desk/desk.ts",
      "src/engine/worktree/acceptance_transaction.ts",
      "src/engine/worktree/lifecycle.ts",
    ],
    authority:
      "the desk may revoke, acceptance may claim or settle, and lifecycle cleanup may clear a grant",
  },
  {
    id: "acceptance-transaction",
    module: "src/engine/worktree/acceptance_transaction.ts",
    allowedImporters: ["src/engine/worktree/lifecycle.ts"],
    authority:
      "only acceptance lifecycle orchestration may start or recover a landing transaction",
  },
] as const satisfies readonly RestrictedWriterModule[];
