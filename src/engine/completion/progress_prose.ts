/**
 * One sentence per progress fact, shared by every surface. Terminal, JSON,
 * MCP, and the operation journal present these words instead of composing
 * their own, so an owner reads the same account everywhere. Counts stay
 * counts: unequal units mean no sentence here derives a percentage or a time
 * estimate, and an unknown total stays unknown.
 */
import type { CompletionBlocker } from "./protocol.ts";
import type {
  CompletionFailure,
  CompletionProgress,
  ProducerWork,
} from "./events.ts";

/** Bound one-line renderings; the full text stays on the underlying fact. */
const SENTENCE_MAX_CHARS = 400;

/** Collapse whitespace runs so a multi-line message reads as one line. */
function oneLine(text: string): string {
  const flat = text.replace(/\s+/gu, " ").trim();
  return flat.length <= SENTENCE_MAX_CHARS
    ? flat
    : `${flat.slice(0, SENTENCE_MAX_CHARS)}…`;
}

/** End a fragment as a sentence without doubling punctuation. */
function sentence(text: string): string {
  return /[.!?…]$/u.test(text) ? text : `${text}.`;
}

/** The running account of one producer's own reported counts. */
export function producerWorkSentence(work: ProducerWork): string {
  const parts: string[] = [];
  if (work.units !== undefined) {
    const { completed, total, kind } = work.units;
    parts.push(
      total === null
        ? `${completed} ${kind} done`
        : `${completed} of ${total} ${kind} done`,
    );
  }
  const failed = work.results?.failed;
  if (failed !== undefined) {
    parts.push(
      failed === 0
        ? "no failures so far"
        : `${failed} failure${failed === 1 ? "" : "s"} so far`,
    );
  }
  const account = parts.length === 0
    ? `Running ${work.producer}`
    : `Running ${work.producer}: ${parts.join(", ")}`;
  return sentence(
    work.partial === true ? `${account}; counts are incomplete` : account,
  );
}

/** Name a small identifier set without flooding the sentence. */
function named(values: readonly string[], noun: string): string {
  if (values.length === 0) return noun;
  if (values.length <= 3) return values.join(", ");
  return `${values.slice(0, 3).join(", ")} and ${values.length - 3} more`;
}

/** The whole account of one progress fact: what is happening, then what comes next. */
export function completionProgressSentence(
  progress: Pick<CompletionProgress, "reason" | "next">,
): string {
  return progress.next === undefined
    ? progress.reason
    : `${progress.reason} ${progress.next}`;
}

/**
 * What one pending blocker means for the reader, what happens next, and
 * whether the owner decides.
 */
export function completionBlockerAccount(
  blocker: CompletionBlocker,
): {
  readonly reason: string;
  readonly next: string;
  readonly owner_must_act: boolean;
} {
  switch (blocker.kind) {
    case "cancelled":
      return {
        reason: sentence(blocker.reason),
        next: "Run the command again to continue.",
        owner_must_act: false,
      };
    case "record-incompatible":
    case "record-corrupt":
      return {
        reason: sentence(
          `Record ${blocker.record_id} cannot be read: ${blocker.reason}`,
        ),
        next: "Follow the recovery action in status.",
        owner_must_act: false,
      };
    case "capacity-unavailable":
      return {
        reason: sentence(blocker.reason),
        next: "Run again when capacity is available.",
        owner_must_act: false,
      };
    case "missing-judgment":
      return {
        reason: `Waiting for a recorded judgment on ${
          named(blocker.subjects, "the served questions")
        }; the owner decides.`,
        next: "Landing waits until the judgment is recorded.",
        owner_must_act: true,
      };
    case "missing-authority":
      return {
        reason: `Waiting for the owner's approval covering ${
          named(
            blocker.sources.map((source) => source.branch),
            "the changed sources",
          )
        }.`,
        next: "Landing waits until the owner grants it.",
        owner_must_act: true,
      };
    case "missing-evidence":
      return {
        reason: `Required evidence is missing for ${
          named(
            blocker.requirements.map((requirement) => requirement.id),
            "required checks",
          )
        }.`,
        next: "Run the gate to produce it.",
        owner_must_act: false,
      };
    case "stale-evidence":
      return {
        reason: `Recorded evidence is stale (${blocker.reason}).`,
        next: "Run the gate again to refresh it.",
        owner_must_act: false,
      };
    case "validation-failed":
      return {
        reason: blocker.reason !== undefined
          ? sentence(blocker.reason)
          : `Validation failed${
            blocker.requirement === undefined
              ? ""
              : ` for ${blocker.requirement.id}`
          }.`,
        next: "Fix the failure and run the gate again.",
        owner_must_act: false,
      };
    case "environment-unavailable":
      return {
        reason: sentence(blocker.reason),
        next: "Run again once the environment is available.",
        owner_must_act: false,
      };
    case "recovery-incomplete":
      return {
        reason: "The execution environment needs recovery before another run.",
        next: "Follow the recovery action in status, then run again.",
        owner_must_act: false,
      };
    case "waiting-for-operation":
      return {
        reason:
          "Another active operation on this work has not finished or released its claim.",
        next: "Run again once it has finished.",
        owner_must_act: false,
      };
    case "report-only":
      return {
        reason: "This report-only run records no completion evidence.",
        next: "Run the gate as a recording run to produce evidence.",
        owner_must_act: false,
      };
  }
}

/** One failure the moment it is known: the test, the message, the reproduction. */
export function completionFailureSentence(failure: CompletionFailure): string {
  const location = failure.file === undefined
    ? ""
    : ` (${failure.file}${
      failure.line === undefined ? "" : `:${failure.line}`
    })`;
  const base = sentence(
    `${failure.name} failed${location}: ${oneLine(failure.message)}`,
  );
  return failure.reproduce_cmd === undefined
    ? base
    : `${base} Reproduce: ${failure.reproduce_cmd}`;
}

/** One retained diagnostic from a finished operation's result, as one line. */
export function diagnosticSentence(tool: string, message: string): string {
  return sentence(`${tool}: ${oneLine(message)}`);
}
