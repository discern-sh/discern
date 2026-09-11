/**
 * Terminal presentation for live completion facts. One presenter consumes the
 * same facts every other surface reads: counts become a transient status line,
 * failures and waits become durable lines, and nothing here re-derives a
 * percentage, an estimate, or a second progress model — the sentences arrive
 * already composed with the facts.
 */
import { SYSTEM_CLOCK } from "../../shared/clock.ts";
import { byteWriter } from "../output.ts";
import type {
  CompletionObservationFact,
  CompletionProgress,
} from "../completion/events.ts";
import {
  completionFailureSentence,
  completionProgressSentence,
} from "../completion/progress_prose.ts";
import type { GateTtyProgress } from "./gate_tty.ts";

/**
 * Static output cannot replace a line, so a producer's counts are rationed:
 * a line is written when its failure count changes or its counts turn
 * partial, otherwise at most once per this interval, and once more with the
 * final counts when the producer settles. A live frame replaces its transient
 * line instead and shows every snapshot.
 */
export const STATIC_COUNTS_CADENCE_MS = 20_000;

/** One live consumer of completion facts for a single gate run. */
export interface GateProgressPresenter {
  observe(fact: CompletionObservationFact): void;
}

/** Facts observed before the output policy exists; the handle announcement lives here. */
const SLOT_BUFFER_LIMIT = 16;

/**
 * Which presenter owns one fact. Producer facts — a producer's own counts and
 * each established failure — belong to the run executing that producer;
 * coordination facts — queue, environment, pending, and the operation itself —
 * belong to the outermost operation. Every fact has exactly one owner, so a
 * nested validation and the operation enclosing it never present the same
 * sentence twice.
 */
export type CompletionFactOwner = "producer" | "coordination";

/** Classify one fact by the presenter that owns it. */
export function completionFactOwner(
  fact: CompletionObservationFact,
): CompletionFactOwner {
  if (fact.kind === "failure") return "producer";
  if (fact.kind === "progress" && fact.progress.phase === "producer") {
    return "producer";
  }
  return "coordination";
}

/**
 * The registration point a surrounding observer scope feeds: the verb body
 * sets the presenter once its output policy exists, and the few facts
 * observed before that moment replay into it so the reconnect-handle
 * announcement still reaches the terminal. A quiet run never registers.
 */
export interface GateProgressPresenterSlot {
  observe(fact: CompletionObservationFact): void;
  set(presenter: GateProgressPresenter): void;
}

/**
 * Create the mutable slot one verb invocation owns. A slot scoped to one
 * owner passes only that owner's facts to whichever presenter registers —
 * a nested operation's slot takes the producer side while its enclosing
 * operation presents the coordination.
 */
export function gateProgressPresenterSlot(
  scope: CompletionFactOwner | "all" = "all",
): GateProgressPresenterSlot {
  const buffered: CompletionObservationFact[] = [];
  let current: GateProgressPresenter | undefined;
  return {
    observe(fact: CompletionObservationFact): void {
      if (scope !== "all" && completionFactOwner(fact) !== scope) return;
      if (current !== undefined) current.observe(fact);
      else if (buffered.length < SLOT_BUFFER_LIMIT) buffered.push(fact);
    },
    set(presenter: GateProgressPresenter): void {
      current = presenter;
      for (const fact of buffered.splice(0)) presenter.observe(fact);
    },
  };
}

/** How one presenter reaches the terminal: a live frame or a static writer. */
export interface GateProgressPresenterTarget {
  readonly live?: Pick<GateTtyProgress, "note" | "transient">;
  /** Static human runs append whole lines through the run's own sink. */
  readonly write?: (line: string) => void;
  /**
   * Present only one owner's facts: `coordination` for an outer operation
   * whose nested validation presents its own producer facts and failures.
   */
  readonly scope?: CompletionFactOwner | "all";
  /** Monotonic milliseconds for the static counts cadence; injected by tests. */
  readonly now?: () => number;
}

/** Build the presenter for one gate run's chosen output mode. */
export function createGateProgressPresenter(
  target: GateProgressPresenterTarget,
): GateProgressPresenter {
  let lastDurable = "";
  let lastTransient = "";
  const durable = (text: string, tone?: "warning" | "failure"): void => {
    if (text === lastDurable) return;
    lastDurable = text;
    if (target.live !== undefined) target.live.note(text, tone);
    else target.write?.(`${text}\n`);
  };
  const transient = (text: string): void => {
    if (text === lastTransient) return;
    lastTransient = text;
    if (target.live !== undefined) target.live.transient(text);
    else target.write?.(`${text}\n`);
  };
  const scope = target.scope ?? "all";
  const now = target.now ?? ((): number => SYSTEM_CLOCK.monotonicNow());
  const rationed = new Map<string, {
    writtenAt: number;
    failed: number | undefined;
    partial: boolean;
    held: string | undefined;
  }>();
  const counts = (progress: CompletionProgress): void => {
    if (target.live !== undefined) {
      transient(progress.reason);
      return;
    }
    const producer = progress.work?.producer ?? "";
    const failed = progress.work?.results?.failed;
    const partial = progress.work?.partial === true;
    const last = rationed.get(producer);
    const due = last === undefined || failed !== last.failed ||
      (partial && !last.partial) ||
      now() - last.writtenAt >= STATIC_COUNTS_CADENCE_MS;
    if (due) {
      transient(progress.reason);
      rationed.set(producer, {
        writtenAt: now(),
        failed,
        partial,
        held: undefined,
      });
    } else {
      rationed.set(producer, { ...last, held: progress.reason });
    }
  };
  const settled = (producer: string): void => {
    const held = rationed.get(producer)?.held;
    if (held !== undefined) transient(held);
    rationed.delete(producer);
  };
  return {
    observe(fact: CompletionObservationFact): void {
      if (scope !== "all" && completionFactOwner(fact) !== scope) return;
      if (fact.kind === "failure") {
        durable(completionFailureSentence(fact.failure), "failure");
        return;
      }
      if (fact.kind !== "progress") return;
      const progress = fact.progress;
      if (progress.phase === "producer") {
        // Start and settle already reach the terminal as job facts; the value
        // here is the producer's own counts while it runs, and the final
        // counts once it settles.
        if (progress.work === undefined) return;
        if (progress.state === "finished") {
          settled(progress.work.producer);
          return;
        }
        if (progress.state !== "running") return;
        if (
          progress.work.units === undefined &&
          progress.work.results === undefined
        ) return;
        counts(progress);
        return;
      }
      durable(
        completionProgressSentence(progress),
        progress.owner_must_act === true || progress.phase === "pending"
          ? "warning"
          : undefined,
      );
    },
  };
}

/**
 * Register a run's presenter once its output policy exists. A live frame
 * carries the facts inside the frame; a static human run appends the same
 * sentences through the run's own byte sink; a quiet result registers nothing,
 * because the envelope is its entire output.
 */
export function registerGateProgressPresenter(
  slot: GateProgressPresenterSlot,
  outputKind: string,
  live: Pick<GateTtyProgress, "note" | "transient"> | undefined,
  write: ((bytes: Uint8Array) => void) | undefined,
): void {
  if (outputKind === "quiet-result") return;
  const encoder = new TextEncoder();
  slot.set(createGateProgressPresenter(
    live !== undefined ? { live } : {
      write: (line): void => {
        (write ?? byteWriter("stderr"))(encoder.encode(line));
      },
    },
  ));
}
