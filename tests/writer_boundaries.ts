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
      "src/engine/worktree/accept.ts",
      "src/engine/worktree/accept_integration.ts",
    ],
    authority:
      "the desk may revoke, the acceptance transaction may claim or settle, and a landing — the direct executor or the integration executor — may consume the grant it spent",
  },
  {
    id: "acceptance-transaction",
    module: "src/engine/worktree/acceptance_transaction.ts",
    allowedImporters: [
      "src/engine/worktree/accept.ts",
      "src/engine/worktree/accept_integration.ts",
      "src/engine/worktree/accept_walk.ts",
      "src/engine/emergency/action.ts",
      "src/engine/emergency/plan.ts",
    ],
    authority:
      "the landing — its verb, its integration executor, and its queue walk's follower boundary — and the emergency route own transaction effects; emergency planning imports only the read-only interrupted-journal inspection",
  },
  {
    id: "submission-writer",
    module: "src/engine/worktree/submission_writer.ts",
    allowedImporters: [
      "src/engine/worktree/accept.ts",
      "src/engine/worktree/accept_subject.ts",
      "src/engine/worktree/accept_integration.ts",
    ],
    authority:
      "the shared proven-subject boundary records submissions; only the direct or integration landing executor consumes them; the queue is derived from these records",
  },
] as const satisfies readonly RestrictedWriterModule[];
