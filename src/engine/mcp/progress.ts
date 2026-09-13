/** MCP progress observes the same completion facts every other surface reads. */
import {
  type CompletionFailure,
  type CompletionProgress,
  withCompletionObserver,
} from "../completion/events.ts";
import {
  completionFailureSentence,
  completionProgressSentence,
} from "../completion/progress_prose.ts";
import type { ProgressWait } from "../../shared/result_schemas.ts";
import { progressWaitSentence, readWait } from "../completion/progress_wait.ts";
import { SYSTEM_CLOCK } from "../../shared/clock.ts";

export interface CompletionProgressNotification {
  readonly method: "notifications/progress";
  readonly params: {
    readonly progressToken: string | number;
    readonly progress: number;
    readonly message: string;
    readonly _meta: {
      readonly discern_completion?: CompletionProgress;
      readonly discern_failure?: CompletionFailure;
      readonly discern_wait?: ProgressWait;
    };
  };
}

/** A client-supplied progress token opts into bounded messages, never a second operation. */
export async function withMcpCompletionProgress<T>(
  meta: Record<string, unknown> | undefined,
  send: (notification: CompletionProgressNotification) => Promise<void>,
  operation: () => Promise<T>,
  now: () => number = SYSTEM_CLOCK.wallNow,
): Promise<T> {
  const token = meta?.progressToken;
  if (typeof token !== "string" && typeof token !== "number") {
    return await operation();
  }
  let progress = 0;
  let previous: string | undefined;
  const waits = new Map<string, ProgressWait>();
  const activeWaits = (): string[] =>
    [...waits.values()].map((wait) =>
      progressWaitSentence(readWait(wait, now(), true))
    );
  return await withCompletionObserver(async (fact) => {
    if (fact.kind === "wait") {
      if (fact.wait.state === "waiting") waits.set(fact.wait.id, fact.wait);
      else waits.delete(fact.wait.id);
      await send({
        method: "notifications/progress",
        params: {
          progressToken: token,
          progress: ++progress,
          message: activeWaits().concat(
            fact.wait.state === "waiting"
              ? []
              : [progressWaitSentence(fact.wait)],
          ).join(" "),
          _meta: { discern_wait: fact.wait },
        },
      });
      return;
    }
    if (fact.kind === "failure") {
      // Each failure fact is a distinct moment; the observer already emits it
      // once per established failure.
      await send({
        method: "notifications/progress",
        params: {
          progressToken: token,
          progress: ++progress,
          message: [completionFailureSentence(fact.failure), ...activeWaits()]
            .join(" "),
          _meta: { discern_failure: fact.failure },
        },
      });
      return;
    }
    if (fact.kind !== "progress") return;
    const current = JSON.stringify(
      Object.entries(fact.progress).sort(([left], [right]) =>
        left.localeCompare(right)
      ),
    );
    if (current === previous) return;
    previous = current;
    await send({
      method: "notifications/progress",
      params: {
        progressToken: token,
        progress: ++progress,
        message: activeWaits()
          .concat(completionProgressSentence(fact.progress)).join(" "),
        _meta: { discern_completion: fact.progress },
      },
    });
  }, operation);
}
