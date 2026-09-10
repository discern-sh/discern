/**
 * Terminal presentation for live completion facts. One presenter consumes the
 * same facts every other surface reads: counts become a transient status line,
 * failures and waits become durable lines, and nothing here re-derives a
 * percentage, an estimate, or a second progress model — the sentences arrive
 * already composed with the facts.
 */
import type { CompletionObservationFact } from "../completion/events.ts";
import { completionFailureSentence } from "../completion/progress_prose.ts";
import type { GateTtyProgress } from "./gate_tty.ts";

/** One live consumer of completion facts for a single gate run. */
export interface GateProgressPresenter {
  observe(fact: CompletionObservationFact): void;
}

/** Facts observed before the output policy exists; the handle announcement lives here. */
const SLOT_BUFFER_LIMIT = 16;

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

/** Create the mutable slot one verb invocation owns. */
export function gateProgressPresenterSlot(): GateProgressPresenterSlot {
  const buffered: CompletionObservationFact[] = [];
  let current: GateProgressPresenter | undefined;
  return {
    observe(fact: CompletionObservationFact): void {
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
   * `coordination` presents only queue, environment, pending, and operation
   * facts — for an outer operation whose nested validation presents its own
   * producer facts and failures, so nothing prints twice.
   */
  readonly scope?: "all" | "coordination";
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
  const coordinationOnly = target.scope === "coordination";
  return {
    observe(fact: CompletionObservationFact): void {
      if (fact.kind === "failure") {
        if (!coordinationOnly) {
          durable(completionFailureSentence(fact.failure), "failure");
        }
        return;
      }
      if (fact.kind !== "progress") return;
      const progress = fact.progress;
      if (progress.phase === "producer") {
        if (coordinationOnly) return;
        // Start and settle already reach the terminal as job facts; the value
        // here is the producer's own counts while it runs.
        if (progress.state !== "running" || progress.work === undefined) return;
        if (
          progress.work.units === undefined &&
          progress.work.results === undefined
        ) return;
        transient(progress.reason);
        return;
      }
      durable(
        progress.reason,
        progress.owner_must_act === true || progress.phase === "pending"
          ? "warning"
          : undefined,
      );
    },
  };
}
