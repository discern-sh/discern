/**
 * Turn producer protocol lines into advisory completion facts.
 *
 * The observer watches each producer's live output for `DISCERN_PROGRESS`
 * lines, merges every producer's reports into one running account, and emits
 * coalesced progress facts plus one failure fact per newly established
 * failure. One shared producer counts once no matter how many requirements
 * consume it, because the account is keyed by the producer itself. Parsing is
 * presentation-only: it never changes scheduling, verdicts, or evidence.
 */
import {
  type CompletionFailure,
  emitCompletionFailure,
  emitCompletionProgress,
  type ProducerWork,
} from "../completion/events.ts";
import { producerWorkSentence } from "../completion/progress_prose.ts";
import type { JobOutputEvent, JobOutputObserver } from "../jobs/types.ts";
import { parseProducerProgressLine } from "./progress_lines.ts";

/** Bound remembered failures per producer; later repeats are not re-emitted. */
const FAILURE_MEMORY_LIMIT = 512;

/** Observe every producer's lines for one validation run. */
export function createProducerProgressObserver(input: {
  readonly candidate_id: string | null;
}): JobOutputObserver {
  const work = new Map<string, ProducerWork>();
  const emitted = new Map<string, string>();
  const failures = new Map<string, Set<string>>();
  return {
    output(event: JobOutputEvent): void {
      if (event.kind !== "line") return;
      const report = parseProducerProgressLine(event.text);
      if (report === undefined) return;
      const previous = work.get(event.label);
      if (
        report.units !== undefined || report.results !== undefined ||
        report.active !== undefined || report.elapsed_ms !== undefined ||
        report.partial === true
      ) {
        // A field once reported persists until the producer replaces it, and a
        // partial marking stays: lost counts cannot silently become whole again.
        const merged: ProducerWork = {
          ...previous,
          producer: event.label,
          ...(report.units === undefined ? {} : { units: report.units }),
          ...(report.results === undefined ? {} : { results: report.results }),
          ...(report.active === undefined ? {} : { active: report.active }),
          ...(report.elapsed_ms === undefined
            ? {}
            : { elapsed_ms: report.elapsed_ms }),
          ...(report.partial === true || previous?.partial === true
            ? { partial: true }
            : {}),
        };
        work.set(event.label, merged);
        const key = JSON.stringify(merged);
        if (emitted.get(event.label) !== key) {
          emitted.set(event.label, key);
          emitCompletionProgress({
            phase: "producer",
            state: "running",
            candidate_id: input.candidate_id,
            reason: producerWorkSentence(merged),
            work: merged,
          });
        }
      }
      if (report.failure !== undefined) {
        const seen = failures.get(event.label) ?? new Set<string>();
        failures.set(event.label, seen);
        const identity = JSON.stringify([
          report.failure.name,
          report.failure.file ?? null,
          report.failure.line ?? null,
          report.failure.message,
        ]);
        if (seen.has(identity) || seen.size >= FAILURE_MEMORY_LIMIT) return;
        seen.add(identity);
        const failure: CompletionFailure = {
          producer: event.label,
          name: report.failure.name,
          message: report.failure.message,
          ...(report.failure.file === undefined
            ? {}
            : { file: report.failure.file }),
          ...(report.failure.line === undefined
            ? {}
            : { line: report.failure.line }),
          ...(report.failure.reproduce === undefined
            ? {}
            : { reproduce_cmd: report.failure.reproduce }),
          partial: false,
        };
        emitCompletionFailure(failure);
      }
    },
  };
}

/** Deliver one child-text event to several independent observers. */
export function composeJobOutputObservers(
  ...observers: readonly (JobOutputObserver | undefined)[]
): JobOutputObserver | undefined {
  const live = observers.filter((observer) => observer !== undefined);
  if (live.length === 0) return undefined;
  if (live.length === 1) return live[0];
  return {
    output(event: JobOutputEvent): void {
      for (const observer of live) observer.output(event);
    },
  };
}
