/** MCP progress observes the same completion facts every other surface reads. */
import {
  type CompletionFailure,
  type CompletionProgress,
  withCompletionObserver,
} from "../completion/events.ts";
import { completionFailureSentence } from "../completion/progress_prose.ts";

export interface CompletionProgressNotification {
  readonly method: "notifications/progress";
  readonly params: {
    readonly progressToken: string | number;
    readonly progress: number;
    readonly message: string;
    readonly _meta: {
      readonly discern_completion?: CompletionProgress;
      readonly discern_failure?: CompletionFailure;
    };
  };
}

/** A client-supplied progress token opts into bounded messages, never a second operation. */
export async function withMcpCompletionProgress<T>(
  meta: Record<string, unknown> | undefined,
  send: (notification: CompletionProgressNotification) => Promise<void>,
  operation: () => Promise<T>,
): Promise<T> {
  const token = meta?.progressToken;
  if (typeof token !== "string" && typeof token !== "number") {
    return await operation();
  }
  let progress = 0;
  let previous: string | undefined;
  return await withCompletionObserver(async (fact) => {
    if (fact.kind === "failure") {
      // Each failure fact is a distinct moment; the observer already emits it
      // once per established failure.
      await send({
        method: "notifications/progress",
        params: {
          progressToken: token,
          progress: ++progress,
          message: completionFailureSentence(fact.failure),
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
        message: fact.progress.reason,
        _meta: { discern_completion: fact.progress },
      },
    });
  }, operation);
}
