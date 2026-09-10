/**
 * One sentence per progress fact, shared by every surface. Terminal, JSON,
 * MCP, and the operation journal present these words instead of composing
 * their own, so an owner reads the same account everywhere. Counts stay
 * counts: unequal units mean no sentence here derives a percentage or a time
 * estimate, and an unknown total stays unknown.
 */
import type { CompletionFailure, ProducerWork } from "./events.ts";

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
