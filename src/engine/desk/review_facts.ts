/**
 * The facts a Desk review's consequence lines rest on, and where each comes
 * from.
 *
 * A review line is true because of one fact: something status observed
 * about the task, something the lifecycle core's own preview found, or
 * nothing beyond the registry's declaration that the action always does
 * it. The action and command registries name these facts on their
 * consequence items; this table says how each fact holds and which field
 * it rests on, so every line a review shows carries its source. Pure.
 */

import type { StatusFleetEntry } from "../../shared/result_schemas.ts";
import type { DeskActionContext, DeskConsequenceMark } from "./model.ts";

/** What one task's lifecycle core previewed, in the Desk's terms. */
export interface DeskPlanFacts {
  /** The revision a landing lands, its commits, and its diff stats. */
  readonly lands?: {
    readonly sha: string;
    /** Absent when Git could not count them. */
    readonly commits?: number;
    readonly files: number;
    readonly insertions: number;
    readonly deletions: number;
  };
  /** Present when the trunk moved after the Proof: the landing composes
   * the work with the trunk in a separate copy first. */
  readonly integrates?: { readonly behind?: number };
  /** Who approves the landing. */
  readonly authority?: {
    readonly kind: "conversation" | "pre-authorized" | "standing" | "partial";
    /** Standing scopes that cover the tree, when a standing grant does. */
    readonly scopes?: readonly string[];
    /** Changed paths a standing grant covers, when only some are. */
    readonly covered?: number;
  };
  /** Pre-authorized queued work that lands after this landing. */
  readonly queueWalk?: readonly {
    readonly title: string;
    readonly branch: string;
  }[];
  /** A landing running now that this one waits behind. */
  readonly landingInProgress?: { readonly title: string };
  /** Ignored roots changed since setup that the removal discards. */
  readonly ignoredRoots?: readonly string[];
  /** The effect ends the task's landing pre-authorization. */
  readonly endsGrant?: boolean;
  /** The effect takes the task out of the landing queue. */
  readonly leavesQueue?: boolean;
  /** The effect removes the task's recorded Proof. */
  readonly removesProof?: boolean;
  /** Work a removal would discard, counted, in the core's words. */
  readonly discards?: readonly string[];
  /** Work a removal can't rule out discarding, in the core's words. */
  readonly uncertain?: readonly string[];
  /** The exact version a queue entry records. */
  readonly revision?: string;
  /** What a new task's start creates. */
  readonly creates?: {
    readonly branch: string;
    readonly base: string;
    readonly commit: string;
    /** External resources setup creates for it. */
    readonly resources: number;
  };
  /** A Project Script run: its literal argv and where it runs. */
  readonly script?: {
    readonly argv: readonly string[];
    readonly where: string;
  };
  /** The setup step a retry resumes from. */
  readonly setupStep?: string;
  /** Owner decisions a landing needs that only the CLI records today. */
  readonly exception?: {
    readonly variances: readonly string[];
    readonly standardApprovals: number;
  };
  /** Checkpoint answers missing or outdated: the checks must run again. */
  readonly staleDeclarations?: readonly string[];
}

/** What every review line can read: the preview, and the observed task
 * when the review concerns one. */
export interface DeskReviewFacts {
  readonly context?: DeskActionContext;
  readonly plan: DeskPlanFacts;
}

/** What a task action's review lines read: the task is always observed. */
export interface DeskActionReviewFacts extends DeskReviewFacts {
  readonly context: DeskActionContext;
}

/** A status field a line rests on; `queue` is the fleet's landing queue. */
export type DeskStatusField = keyof StatusFleetEntry | "queue";

/** A preview fact a line rests on. */
export type DeskPlanField = keyof DeskPlanFacts;

/** Where one review line's words come from. */
export type DeskReviewSource =
  | { readonly kind: "status"; readonly field: DeskStatusField }
  | { readonly kind: "plan"; readonly key: DeskPlanField }
  /** The registry declares the action always does this. */
  | {
    readonly kind: "registry";
    readonly bucket: string;
    readonly index: number;
  }
  /** What a finished effect reported. */
  | { readonly kind: "result"; readonly field: string };

/** One fact: the source it rests on and whether it holds. */
interface DeskReviewFact {
  readonly source:
    | { readonly kind: "status"; readonly field: DeskStatusField }
    | { readonly kind: "plan"; readonly key: DeskPlanField };
  readonly holds: (facts: DeskReviewFacts) => boolean;
}

/** A fact status observed about the task; it never holds without one. */
function observed(
  field: DeskStatusField,
  holds: (context: DeskActionContext) => boolean,
): DeskReviewFact {
  return {
    source: { kind: "status", field },
    holds: (facts) => facts.context !== undefined && holds(facts.context),
  };
}

/** A fact the core's preview found. */
function previewed(
  key: DeskPlanField,
  holds: (plan: DeskPlanFacts) => boolean = (plan) => plan[key] !== undefined,
): DeskReviewFact {
  return { source: { kind: "plan", key }, holds: (facts) => holds(facts.plan) };
}

/** A preview list fact that holds while it lists anything. */
function listed(
  key: "queueWalk" | "ignoredRoots" | "discards" | "uncertain",
): DeskReviewFact {
  return previewed(key, (plan) => (plan[key]?.length ?? 0) > 0);
}

/**
 * Every fact a consequence line may depend on. A line naming one shows only
 * while it holds, so a review never claims an effect the task cannot have.
 */
export const DESK_REVIEW_FACTS = {
  granted: observed("landing_authority", (context) => context.effortGranted),
  "not-granted": observed(
    "landing_authority",
    (context) => !context.effortGranted,
  ),
  queued: observed("queue", (context) => context.queued),
  "proof-honored": observed("gate_proof", (context) => context.proofHonored),
  "proof-recorded": observed("gate_proof", (context) => context.proofRecorded),
  "metadata-recorded": observed(
    "task",
    (context) => context.taskMetadataRecorded,
  ),
  stale: observed("last_activity", (context) => context.idle !== undefined),
  resources: observed(
    "resources",
    (context) => (context.resources?.length ?? 0) > 0,
  ),
  "resources-unreadable": observed(
    "resources",
    (context) => context.resources === undefined,
  ),
  lands: previewed("lands"),
  direct: previewed(
    "integrates",
    (plan) => plan.lands !== undefined && plan.integrates === undefined,
  ),
  integrates: previewed("integrates"),
  authority: previewed("authority"),
  "queue-walk": listed("queueWalk"),
  "landing-in-progress": previewed("landingInProgress"),
  "ignored-roots": listed("ignoredRoots"),
  "ends-grant": previewed("endsGrant", (plan) => plan.endsGrant === true),
  "leaves-queue": previewed("leavesQueue", (plan) => plan.leavesQueue === true),
  "removes-proof": previewed(
    "removesProof",
    (plan) => plan.removesProof === true,
  ),
  discards: listed("discards"),
  uncertain: listed("uncertain"),
  revision: previewed("revision"),
  creates: previewed("creates"),
  script: previewed("script"),
  "setup-step": previewed("setupStep"),
} as const satisfies Readonly<Record<string, DeskReviewFact>>;

export type DeskReviewFactName = keyof typeof DESK_REVIEW_FACTS;

/** The source a line naming this fact rests on. */
export function factSource(name: DeskReviewFactName): DeskReviewSource {
  const fact: DeskReviewFact = DESK_REVIEW_FACTS[name];
  return fact.source;
}

/** Whether one named fact holds. */
export function factHolds(
  name: DeskReviewFactName,
  facts: DeskReviewFacts,
): boolean {
  const fact: DeskReviewFact = DESK_REVIEW_FACTS[name];
  return fact.holds(facts);
}

/** A commit as reviews and the inspector abbreviate it. */
export function shortCommit(sha: string): string {
  return sha.slice(0, 7);
}

/** Added and removed line counts a line shows after its words. */
export interface DeskDiffCounts {
  readonly insertions: number;
  readonly deletions: number;
}

/**
 * One declared consequence: its mark, its words, the fact it needs, and the
 * diff counts it shows. Words may expand to one line per listed fact.
 */
export interface DeskConsequenceItem<F extends DeskReviewFacts> {
  readonly mark: DeskConsequenceMark;
  readonly text: string | ((facts: F) => string | readonly string[]);
  readonly when?: DeskReviewFactName;
  readonly diff?: (facts: F) => DeskDiffCounts | undefined;
}

/** One resolved consequence line, with the source it rests on. */
export interface DeskConsequenceLine {
  readonly mark: DeskConsequenceMark;
  readonly text: string;
  readonly diff?: DeskDiffCounts;
  readonly source: DeskReviewSource;
}

/** One consequence item, optionally shown only while a fact holds. */
export function consequence<F extends DeskReviewFacts>(
  mark: DeskConsequenceMark,
  text: DeskConsequenceItem<F>["text"],
  when?: DeskReviewFactName,
  diff?: DeskConsequenceItem<F>["diff"],
): DeskConsequenceItem<F> {
  return {
    mark,
    text,
    ...(when === undefined ? {} : { when }),
    ...(diff === undefined ? {} : { diff }),
  };
}

/**
 * Resolve a registry's declared consequences against the facts: each item
 * whose fact holds becomes one line per sentence, sourced from that fact, or
 * from its place in the registry when it names none.
 */
export function resolveConsequences<F extends DeskReviewFacts>(
  bucket: string,
  items: readonly DeskConsequenceItem<F>[],
  facts: F,
): DeskConsequenceLine[] {
  return items.flatMap((item, index) => {
    if (item.when !== undefined && !factHolds(item.when, facts)) return [];
    const words = typeof item.text === "string" ? item.text : item.text(facts);
    const diff = item.diff?.(facts);
    const source: DeskReviewSource = item.when === undefined
      ? { kind: "registry", bucket, index }
      : factSource(item.when);
    return (typeof words === "string" ? [words] : words).map((text) => ({
      mark: item.mark,
      text,
      ...(diff === undefined ? {} : { diff }),
      source,
    }));
  });
}
