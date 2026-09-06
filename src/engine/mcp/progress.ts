/** MCP progress observes the same completion phases used by native execution. */
import {
  type CompletionProgress,
  withCompletionObserver,
} from "../completion/events.ts";

export interface CompletionProgressNotification {
  readonly method: "notifications/progress";
  readonly params: {
    readonly progressToken: string | number;
    readonly progress: number;
    readonly message: string;
    readonly _meta: { readonly discern_completion: CompletionProgress };
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
  return await withCompletionObserver(async (fact) => {
    if (fact.kind !== "progress") return;
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
