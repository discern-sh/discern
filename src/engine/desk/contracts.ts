/** Product routes and read-only evidence carried by Desk foreground journeys. */
import type { GateProofCheckData } from "../../shared/result_schemas.ts";

/** Sentinel selection values that route back into Desk orchestration. */
export const DESK_ROUTES = {
  refresh: "\x00refresh",
  quit: "\x00quit",
  back: "\x00back",
  startTask: "\x00start-task",
  runProjectScript: "\x00run-project-script",
  readDocs: "\x00read-docs",
  mainCheckout: "\x00main-checkout",
  recentCompleted: "\x00recent-completed",
} as const;

/** Route prefix for one exact status-reported branch without a worktree. */
export const DESK_UNLANDED_ROUTE_PREFIX = "\x00unlanded:";

/** Preserve an unlanded branch ref as a root-picker route. */
export function deskUnlandedRoute(branch: string): string {
  return `${DESK_UNLANDED_ROUTE_PREFIX}${branch}`;
}

/** Routes available inside the Proof-first review drill-down. */
export const DESK_REVIEW_ROUTES = {
  diff: "\x00review-diff",
  editor: "\x00review-editor",
  back: "\x00review-back",
} as const;

/** A short fleet is faster to scan directly; larger fleets gain filtering. */
export const DESK_FILTER_THRESHOLD = 8;

/** One path in the review's committed or uncommitted change set. */
export interface DeskReviewFile {
  readonly path: string;
  readonly disposition: "added" | "updated" | "removed";
  readonly added?: number;
  readonly removed?: number;
  readonly uncommitted: boolean;
}

/** A failed read that must remain a failure rather than an empty section. */
export interface DeskReviewFailure {
  readonly title: string;
  readonly command: string;
  readonly detail: string;
  readonly nextAction: string;
  readonly safeToRetry: boolean;
}

/** Configured editor evidence available to the review drill-down. */
export interface DeskEditorCommand {
  readonly command: string;
  readonly program: string;
  readonly args: readonly string[];
}

/** All observations used by the pure Proof-first review composition. */
export interface DeskReview {
  readonly trunk: string;
  readonly proof: GateProofCheckData;
  readonly commits: string;
  readonly files: readonly DeskReviewFile[];
  readonly insertions: number;
  readonly deletions: number;
  readonly failures: readonly DeskReviewFailure[];
  readonly diffCommand: string;
  readonly editor?: DeskEditorCommand;
  readonly editorUnavailableReason?: string;
}
