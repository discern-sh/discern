/**
 * The Desk's review projection.
 *
 * `reviewFor` turns one registry offer or command, the observed task, and
 * what its lifecycle core previewed into everything a review sheet shows:
 * the question, consequence lines in registry order (each carrying the fact
 * it rests on), blockers from typed preview facts, the revision binding the
 * apply is held to, and the exact plan and command one key away. Result
 * sheets for failed effects come from the same line vocabulary. Pure.
 */

import type { EnginePlan } from "../../shared/result.ts";
import type { DiscernResult } from "../../shared/result.ts";
import { z } from "@zod/zod";
import { AcceptLandingStateSchema } from "../../shared/accept_landing_state.ts";
import { LandingOutcomeSchema } from "../../shared/result_schemas.ts";
import { commandEvidence } from "../../shared/command_evidence.ts";
import {
  DESK_ACTION_LABELS,
  DESK_COMMAND_LABELS,
  labelName,
} from "../../shared/desk_vocabulary.ts";
import { renderResultReading } from "../../shared/emit.ts";
import { resultPresenterForVerb } from "../../shared/result_contracts.ts";
import {
  consequenceLines,
  DESK_ACTION_REGISTRY,
  DESK_BINDING_FACTS,
  type DeskAction,
  type DeskActionOffer,
  type DeskBindingFact,
  type DeskConfirmationPolicy,
  type DeskRow,
  deskRowId,
} from "./model.ts";
import {
  commandConsequenceLines,
  DESK_COMMAND_REGISTRY,
  type DeskCommand,
  type DeskCommandFacts,
  type DeskCommandMetadata,
} from "./commands.ts";
import type { DeskPlanFacts, DeskReviewSource } from "./review_facts.ts";
import {
  type DeskConfirm,
  type DeskCoreExpectation,
  type DeskExpected,
  type DeskFollowingTask,
  type DeskResultSheet,
  type DeskReview,
  type DeskReviewAlternative,
  type DeskReviewLine,
  untilChosen,
} from "./flow_types.ts";

/** What a review concerns: one task's registry offer, or a Desk command. */
export type DeskReviewTarget =
  | {
    readonly kind: "action";
    readonly row: DeskRow;
    readonly offer: DeskActionOffer;
    /** The trunk's head when the review was read. */
    readonly trunkHead?: string;
  }
  | {
    readonly kind: "command";
    readonly command: DeskCommand;
    readonly facts: DeskCommandFacts;
  };

/** What a flow read before its review: the core's plan and preview facts. */
export interface DeskReviewRead {
  /** The core's own plan; the technical plan disclosure renders this object. */
  readonly plan?: EnginePlan;
  readonly facts?: DeskPlanFacts;
  /** The exact argv with its actual flags, when it differs from the registry's. */
  readonly argv?: readonly string[];
  readonly core?: DeskCoreExpectation;
  /** Binding facts only the preview can supply, by registry name. */
  readonly bound?: Readonly<Partial<Record<DeskBindingFact, string>>>;
  /** Further reasons confirm cannot run, beyond the preview's facts. */
  readonly blockers?: readonly string[];
  /** A question other than the registry's, such as a resumed branch's. */
  readonly question?: string;
  /** Lines that precede the registry's, such as a stored brief. */
  readonly lead?: readonly DeskReviewLine[];
  /** What the effect is called while it runs. */
  readonly running?: string;
  /** The title of the reader that shows what an opened page left. */
  readonly reads?: string;
  /** Queued tasks that land after it. */
  readonly follows?: readonly DeskFollowingTask[];
  /** Confirm asks this next question instead of applying. */
  readonly next?: DeskConfirm;
  /** The sheet offers only its safe choice and its alternatives. */
  readonly noConfirm?: boolean;
  readonly safeLabel?: string;
  readonly confirmLabel?: string;
  readonly footnote?: string;
  readonly alternatives?: readonly DeskReviewAlternative[];
  /** Ask for the branch name before the destructive button can run. */
  readonly challenge?: string;
}

/** The facts the observation gives a binding: the task and the trunk. */
export interface DeskBindingObservation {
  readonly row: DeskRow;
  readonly trunkHead?: string;
}

/** Binding facts the observation alone can read, and so re-check. */
const OBSERVED_BINDINGS: Readonly<
  Partial<
    Record<DeskBindingFact, (seen: DeskBindingObservation) => string>
  >
> = {
  "worktree-identity": ({ row }) => deskRowId(row),
  path: ({ row }) => row.entry.path,
  branch: ({ row }) => row.entry.branch,
  "branch-head": ({ row }) => row.entry.registration?.head ?? "unknown",
  "trunk-head": ({ trunkHead }) => trunkHead ?? "unknown",
  "dirty-stamp": ({ row }) =>
    `${row.entry.clean ?? "unknown"}:${row.entry.changed_files ?? "unknown"}`,
  clean: ({ row }) => String(row.entry.clean ?? "unknown"),
  "grant-absent": ({ row }) => String(row.decision.context.effortGranted),
  "grant-record": ({ row }) => String(row.decision.context.effortGranted),
  "grant-and-queue": ({ row }) =>
    `${row.decision.context.effortGranted}:${row.decision.context.queued}`,
  "contained-tip": ({ row }) => row.entry.contained_in ?? "none",
  "setup-step": ({ row }) => JSON.stringify(row.entry.setup ?? null),
  title: ({ row }) => row.entry.task?.title ?? row.task.name,
  authority: ({ row }) =>
    `${row.entry.landing_authority?.kind ?? "conversation-required"}:${
      row.entry.landing_authority?.source ?? "none"
    }`,
};

/** What moved, as the Changed banner says it. */
function bindingChange(fact: DeskBindingFact, trunk: string): string {
  switch (fact) {
    case "branch-head":
      return "a new commit";
    case "trunk-head":
      return `${trunk} moved`;
    case "dirty-stamp":
    case "clean":
      return "its files changed";
    case "title":
      return "its title changed";
    case "grant-absent":
    case "grant-record":
    case "grant-and-queue":
    case "authority":
      return "its landing approval changed";
    case "contained-tip":
      return "the branch containing it moved";
    case "setup-step":
      return "its setup moved on";
    default:
      return "its checkout changed";
  }
}

/** Every binding fact the observation can read for this review. */
function observedBinding(
  facts: readonly DeskBindingFact[],
  seen: DeskBindingObservation,
): Partial<Record<DeskBindingFact, string>> {
  const bound: Partial<Record<DeskBindingFact, string>> = {};
  for (const fact of facts) {
    const read = OBSERVED_BINDINGS[fact];
    if (read !== undefined) bound[fact] = read(seen);
  }
  return bound;
}

/**
 * What moved since a review read its binding, as the Changed banner's words,
 * or nothing while every observed binding fact holds.
 */
export function reviewDrift(
  expected: DeskExpected,
  seen: DeskBindingObservation,
): string | undefined {
  for (const [fact, value] of Object.entries(expected.facts)) {
    const binding = DESK_BINDING_FACTS.find((known) => known === fact);
    const read = binding === undefined ? undefined : OBSERVED_BINDINGS[binding];
    if (binding === undefined || read === undefined) continue;
    if (read(seen) !== value) {
      return bindingChange(binding, seen.row.decision.context.trunk);
    }
  }
  return undefined;
}

/** The safe and confirm words a confirmation policy asks with. */
function policyLabels(
  policy: DeskConfirmationPolicy,
): { readonly safe: string; readonly confirm?: string } {
  return policy.kind === "none"
    ? { safe: "Close" }
    : { safe: policy.noLabel, confirm: policy.yesLabel };
}

/**
 * Typed preview facts that keep confirm disabled: an owner decision the
 * Desk can't record, or checkpoint answers the checks must renew.
 */
function previewBlockers(
  facts: DeskPlanFacts,
  exception: string,
): string[] {
  return [
    ...(facts.exception === undefined ? [] : [
      `Needs your exception, which the desk can't record yet. Run in a terminal: ${exception}`,
    ]),
    ...(facts.staleDeclarations === undefined ? [] : [
      `Its checkpoint answers are missing or outdated (${
        facts.staleDeclarations.join(", ")
      }), so ${labelName(DESK_ACTION_LABELS.done)} again before landing`,
    ]),
  ];
}

/** The exact hand-off a landing exception needs, by branch. */
function exceptionArgv(row: DeskRow): readonly string[] {
  return row.observation.exceptionArgvs?.get(row.entry.branch) ??
    ["discern", "accept", "--target", row.entry.branch, "--confirmed"];
}

/**
 * A typed confirmation's text. It must name something to type: an empty one
 * would let an empty field confirm, so the review fails instead.
 */
function challengeOf(
  read: DeskReviewRead,
): { readonly challenge?: { readonly mustEqual: string } } {
  if (read.challenge === undefined) return {};
  if (read.challenge.trim() === "") {
    throw new TypeError("A typed confirmation must name something to type.");
  }
  return { challenge: { mustEqual: read.challenge } };
}

/** One task action's review. */
function actionReview(
  target: Extract<DeskReviewTarget, { readonly kind: "action" }>,
  read: DeskReviewRead,
): DeskReview {
  const { row, offer } = target;
  const facts = read.facts ?? {};
  const metadata = DESK_ACTION_REGISTRY[offer.action];
  const labels = policyLabels(metadata.confirmation);
  const exception = facts.exception === undefined
    ? undefined
    : exceptionArgv(row);
  const command = commandEvidence(
    exception ?? read.argv ?? offer.command.argv,
  );
  const blockers = [
    ...previewBlockers(facts, command),
    ...(read.blockers ?? []),
  ];
  const confirmLabel = read.noConfirm === true
    ? undefined
    : read.confirmLabel ?? labels.confirm;
  return {
    question: read.question ?? offer.reviewTitle,
    subject: {
      id: deskRowId(row),
      title: row.task.name,
      branch: row.entry.branch,
      path: row.entry.path,
    },
    lines: [
      ...(read.lead ?? []),
      ...consequenceLines(offer.action, {
        context: row.decision.context,
        plan: facts,
      }),
    ],
    blockers,
    expected: {
      // What the observation reads, it alone binds: a preview never
      // overrides an observed fact the apply re-checks.
      facts: {
        ...read.bound,
        ...observedBinding(metadata.binding, {
          row,
          ...(target.trunkHead === undefined
            ? {}
            : { trunkHead: target.trunkHead }),
        }),
      },
      ...(read.core === undefined ? {} : { core: read.core }),
    },
    disclosures: {
      ...(read.plan === undefined ? {} : { plan: read.plan }),
      command,
      ...(facts.lands === undefined ? {} : {
        changes: {
          taskId: deskRowId(row),
          files: facts.lands.files,
          insertions: facts.lands.insertions,
          deletions: facts.lands.deletions,
        },
      }),
      ...(exception === undefined ? {} : { open: "command" as const }),
    },
    safeLabel: read.safeLabel ?? labels.safe,
    ...(confirmLabel === undefined ? {} : { confirmLabel }),
    ...(offer.action === "drop" ? { destructive: true } : {}),
    alternatives: read.alternatives ?? [],
    ...(read.follows === undefined || read.follows.length === 0
      ? {}
      : { follows: read.follows }),
    ...challengeOf(read),
    ...(confirmLabel === undefined && read.footnote === undefined ? {} : {
      footnote: read.footnote ??
        untilChosen("changes", confirmLabel ?? labels.safe),
    }),
    ...confirmOf(read, confirmLabel),
  };
}

/** What confirming does: the next question, or the effect. */
function confirmOf(
  read: DeskReviewRead,
  confirmLabel: string | undefined,
): { readonly confirm?: DeskConfirm } {
  if (confirmLabel === undefined) return {};
  if (read.next !== undefined) return { confirm: read.next };
  return {
    confirm: {
      kind: "apply",
      running: read.running ?? "Running",
      ...(read.reads === undefined ? {} : { reads: read.reads }),
    },
  };
}

/** One Desk command's review. */
function commandReview(
  target: Extract<DeskReviewTarget, { readonly kind: "command" }>,
  read: DeskReviewRead,
): DeskReview {
  const metadata: DeskCommandMetadata = DESK_COMMAND_REGISTRY[target.command];
  const labels = policyLabels(metadata.confirmation);
  const facts = read.facts ?? {};
  const confirmLabel = read.noConfirm === true
    ? undefined
    : read.confirmLabel ?? labels.confirm;
  return {
    question: read.question ??
      `${labelName(DESK_COMMAND_LABELS[target.command])}?`,
    lines: [
      ...(read.lead ?? []),
      ...commandConsequenceLines(target.command, {
        ...target.facts,
        plan: facts,
      }),
    ],
    blockers: read.blockers ?? [],
    expected: {
      facts: { ...read.bound },
      ...(read.core === undefined ? {} : { core: read.core }),
    },
    disclosures: {
      ...(read.plan === undefined ? {} : { plan: read.plan }),
      command: commandEvidence(
        read.argv ?? metadata.command?.(target.facts).argv ?? ["discern"],
      ),
    },
    safeLabel: read.safeLabel ?? labels.safe,
    ...(confirmLabel === undefined ? {} : { confirmLabel }),
    alternatives: read.alternatives ?? [],
    ...(confirmLabel === undefined ? {} : {
      footnote: read.footnote ?? untilChosen("changes", confirmLabel),
    }),
    ...confirmOf(read, confirmLabel),
  };
}

/** Project one review from its target and what its flow read. */
export function reviewFor(
  target: DeskReviewTarget,
  read: DeskReviewRead,
): DeskReview {
  return target.kind === "action"
    ? actionReview(target, read)
    : commandReview(target, read);
}

/** The commands whose failures read in a result sheet, and their words. */
interface ResultCopy {
  readonly title: (title: string) => string;
  /** What the failure left as it was. */
  readonly keeps: (trunk: string) => readonly string[];
  /** The next step, in words. */
  readonly next: (trunk: string) => string;
}

/** Result sheet words by the action whose effect failed. */
const RESULT_COPY: Readonly<Partial<Record<DeskAction, ResultCopy>>> = {
  accept: {
    title: (title) => `${title} didn't land`,
    keeps: (trunk) => [
      `Nothing landed; ${trunk} is unchanged`,
      "The task is as it was: branch, checkout and Proof",
    ],
    next: (trunk) =>
      `Hand it to its agent to resolve, or update it from ${trunk}`,
  },
  submit: {
    title: (title) => `${title} wasn't queued`,
    keeps: () => ["Nothing joined the landing queue"],
    next: () => "Read the output, then review it again",
  },
  done: {
    title: (title) => `Checks failed on ${title}`,
    keeps: () => ["No Proof was recorded for this commit"],
    next: () => "Hand it to its agent to fix, or view its changes",
  },
  update: {
    title: (title) => `${title} wasn't updated`,
    keeps: () => ["Its checks and Proof are as they were"],
    next: () => "Hand it to its agent to resolve, or view its changes",
  },
};

/** The diagnostics a result sheet names beneath what stopped. */
const RESULT_DETAIL_LINES = 4;

/** What stopped, in one line, with the paths or failures beneath it. */
function stoppedLine(result: DiscernResult): DeskReviewLine {
  const message = (result.message ?? "It didn't complete").split("\n")[0] ??
    "It didn't complete";
  const detail = (result.diagnostics ?? []).slice(0, RESULT_DETAIL_LINES)
    .map((diagnostic) =>
      diagnostic.file === undefined
        ? diagnostic.message
        : `${diagnostic.file}${
          diagnostic.line === undefined ? "" : `:${diagnostic.line}`
        }`
    );
  return {
    mark: "failure",
    text: message,
    ...(detail.length === 0 ? {} : { detail }),
    source: { kind: "result", field: "message" },
  };
}

/** What an acceptance recorded about the landings it made. */
const LandingEffectsSchema = z.object({
  landing: AcceptLandingStateSchema,
  landings: z.array(LandingOutcomeSchema).optional(),
});

/** The first sentence of a reason, which says why without the route. */
function firstSentence(text: string): string {
  const end = text.search(/\.(\s|$)/u);
  return end < 0 ? text : text.slice(0, end + 1);
}

/**
 * A landing that moved the trunk and then stopped: what landed, what
 * stopped and why, and what a refused walk left as it was. It never says
 * the trunk is unchanged, because it is not.
 */
function partialLandingSheet(
  failed: ResultSubject,
  result: DiscernResult,
  effects: z.infer<typeof LandingEffectsSchema>,
): Pick<DeskResultSheet, "title" | "lines"> {
  const walked = (effects.landings ?? []).filter((landing) =>
    !landing.selected
  );
  const titleOf = failed.titleOf ?? ((branch: string) => branch);
  const stopped = walked.filter((landing) => landing.status !== "landed");
  const landings: DeskReviewSource = { kind: "result", field: "landings" };
  return {
    title: stopped.length === 0
      ? `${failed.title} landed, but not everything finished`
      : `${failed.title} landed; ${
        stopped.map((landing) => titleOf(landing.branch)).join(", ")
      } didn't`,
    lines: [
      {
        mark: "evidence",
        text: `Landed ${failed.title} on ${failed.trunk}`,
        source: { kind: "result", field: "landing" },
      },
      ...walked.filter((landing) => landing.status === "landed").map((
        landing,
      ): DeskReviewLine => ({
        mark: "evidence",
        text: `${titleOf(landing.branch)} landed too`,
        source: landings,
      })),
      ...(stopped.length === 0 ? [stoppedLine(result)] : stopped.map((
        landing,
      ): DeskReviewLine => ({
        mark: "failure",
        text: `${titleOf(landing.branch)} didn't land`,
        ...(landing.reason === undefined
          ? {}
          : { detail: [firstSentence(landing.reason)] }),
        source: landings,
      }))),
      ...stopped.filter((landing) => landing.status === "refused").map((
        landing,
      ): DeskReviewLine => ({
        mark: "keeps",
        text: `${
          titleOf(landing.branch)
        } is as it was: branch, checkout and Proof`,
        source: landings,
      })),
    ],
  };
}

/** The task a failed effect concerns, as its result sheet names it. */
interface ResultSubject {
  readonly action: DeskAction;
  readonly title: string;
  readonly trunk: string;
  readonly taskId?: string;
  /** A branch's task title, for the further tasks an effect reached. */
  readonly titleOf?: (branch: string) => string;
}

/** A failed effect's result sheet, in the registry's words for its action. */
export function resultSheet(
  failed: ResultSubject,
  result: DiscernResult,
  command: string,
): DeskResultSheet {
  const copy = RESULT_COPY[failed.action];
  const source = (index: number): DeskReviewSource => ({
    kind: "registry",
    bucket: `${failed.action}:result`,
    index,
  });
  const effects = failed.action === "accept"
    ? LandingEffectsSchema.safeParse(result.data)
    : undefined;
  const partial = effects?.success === true && effects.data.landing.trunk_landed
    ? partialLandingSheet(failed, result, effects.data)
    : undefined;
  const keeps = copy?.keeps(failed.trunk) ?? [];
  return {
    ...(partial ?? {
      title: copy?.title(failed.title) ??
        `${labelName(DESK_ACTION_LABELS[failed.action])} didn't complete`,
      lines: [
        stoppedLine(result),
        ...keeps.map((text, index): DeskReviewLine => ({
          mark: "keeps",
          text,
          source: source(index),
        })),
        ...(copy === undefined ? [] : [{
          mark: "changes" as const,
          text: copy.next(failed.trunk),
          source: source(keeps.length),
        }]),
      ],
    }),
    tone: partial === undefined ? "danger" : "warning",
    output: renderResultReading(
      result,
      resultPresenterForVerb(result.verb),
      resultPresenterForVerb,
    ),
    command,
    ...(failed.taskId === undefined ? {} : { taskId: failed.taskId }),
  };
}

/** A failure without a result envelope, such as a refusal the core threw. */
export function failureSheet(
  title: string,
  text: string,
  command: string,
): DeskResultSheet {
  const [first = text, ...rest] = text.split("\n");
  return {
    title,
    tone: "danger",
    lines: [{
      mark: "failure",
      text: first,
      source: { kind: "result", field: "message" },
    }],
    ...(rest.length === 0 ? {} : { output: text }),
    command,
  };
}
