/**
 * The **checkpoint vocabulary** — the types the checkpoint engine is built on.
 *
 * A checkpoint is one configured rule: a deterministic **trigger** decides when
 * an effort's diff makes a **question** relevant; the agent judges the
 * question and records a declaration. This module holds the pure data shapes
 * the engine's halves share — the effort diff (`diff.ts` collects it), the
 * resolved definition (`policy.ts` produces it from the governing config), and
 * the trigger outcomes (`triggers.ts` evaluates them; `when.ts` runs the
 * executable escape hatch) — so each half depends on data, never on another
 * half.
 */

import type { CheckpointMode, TriggerVeto } from "../../shared/checkpoints.ts";

// ── the effort diff ─────────────────────────────────────────────────────────

/** How one file changed between the effort's merge-base and its working tree. */
export type EffortChangeKind = "added" | "deleted" | "modified";

/** One changed file in the effort diff. Paths are project-root-relative, and a
 * rename is a deletion plus an addition (rename detection stays off, matching
 * the scope classifier). */
export interface EffortFileChange {
  path: string;
  kind: EffortChangeKind;
  /** Lines added; 0 for a binary file. */
  insertions: number;
  /** Lines removed; 0 for a binary file. */
  deletions: number;
  /** Whether the content is binary (line counts are then meaningless). */
  binary: boolean;
}

/**
 * The effort diff a trigger is evaluated against: everything that changed
 * between the effort's merge-base with the trunk and the current working tree —
 * committed, staged, unstaged, and untracked alike — plus the merge-base tree's
 * file listing (the name-similarity predicate compares new files against it).
 */
export interface EffortDiff {
  files: readonly EffortFileChange[];
  /** Every file path in the merge-base tree, project-root-relative. */
  baseFiles: readonly string[];
}

// ── the resolved definition ─────────────────────────────────────────────────

/**
 * One checkpoint with every trigger and review field resolved against the
 * governing configuration: scope selectors become their globs, registered
 * source-path references are expanded, and a built-in reference has its seed
 * merged under the entry's own fields. This is the shape the trigger engine,
 * subject fingerprinting, and the definition hash all consume, so "what does
 * this checkpoint mean right now" is answered in exactly one place.
 */
export interface ResolvedCheckpoint {
  id: string;
  mode: CheckpointMode;
  /** The judgment prose the agent evaluates. */
  question: string;
  /** Optional lesson prose carried into renderings. */
  teach?: string;
  /** Optional reference material carried into renderings. */
  reference?: string;
  /** The selector's resolved globs; absent means the whole effort diff. */
  selector?: {
    /** The configured scope the globs came from, when one was named. */
    scope?: string;
    globs: readonly string[];
  };
  /** Resolved `unless_changed` globs (scope names already expanded). */
  unlessChanged: readonly string[];
  /** Matched-set size threshold; absent means any matched change suffices. */
  minChangedFiles?: number;
  /** Whether the deletion-dominant delta-shape predicate must hold. */
  deletionDominant: boolean;
  /** Whether the new-file name-similarity predicate must hold. */
  similarNewFile: boolean;
  /** The executable escape-hatch command text; absent means none. */
  when?: string;
}

// ── trigger outcomes ────────────────────────────────────────────────────────

// (The trigger-veto vocabulary lives in `shared/checkpoints.ts`, beside the
// mode pair, so wire schemas can enumerate it without reaching into the
// engine; the type is re-exported above for the engine's own consumers.)

/** One name-similar pair the `similar_new_file` predicate found: the added
 * file and the existing merge-base sibling it resembles. */
export interface SimilarNewFile {
  added: string;
  existing: string;
}

/**
 * The pure, structural half of trigger evaluation — everything except the
 * executable `when` condition. When it holds, `matched` is the sorted matched
 * set (the selector's matches, or the whole diff) and `whenPending` says
 * whether a configured `when` command must still decide the firing.
 */
export type StructuralTriggerOutcome =
  | { holds: false; vetoedBy: TriggerVeto }
  | {
    holds: true;
    matched: readonly string[];
    whenPending: boolean;
    /** Evidence for the name-similarity predicate, when it was required. */
    similar?: readonly SimilarNewFile[];
  };

/** How one `when` command run concluded (`when.ts` produces it). */
export type WhenOutcome =
  | {
    kind: "fire";
    /** Subject paths the command declared via its match protocol. Composition
     * intersects them with the structural matched set; no surviving path
     * means fall back to that full set. */
    matches: readonly string[];
  }
  | { kind: "pass" }
  | {
    kind: "error";
    /** Plain-language account of the failure — the trigger fails OPEN (no
     * fire) and this advisory travels with the run. */
    advisory: string;
  };

/** The final word on one checkpoint's trigger for the current diff. */
export type TriggerOutcome =
  | { fired: false; vetoedBy?: TriggerVeto; advisory?: string }
  | { fired: true; matched: readonly string[] };
