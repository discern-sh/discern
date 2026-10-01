/** Product routes and read-only evidence carried by Desk foreground journeys. */
import type { GateProofCheckData } from "../../shared/result_schemas.ts";

/** Sentinel selection values that route back into Desk orchestration. */
export const DESK_ROUTES = {
  back: "\x00back",
} as const;

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
