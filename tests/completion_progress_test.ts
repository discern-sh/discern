/** Progress is isolated per invocation and has no effect on its outcome. */
import { assertEquals, assertRejects } from "@std/assert";
import {
  emitCompletionProgress,
  withCompletionObserver,
} from "../src/engine/completion/events.ts";
import {
  type CompletionProgressNotification,
  withMcpCompletionProgress,
} from "../src/engine/mcp/progress.ts";

Deno.test("completion progress uses the client's token and keeps concurrent calls separate", async () => {
  const calls = ["first", "second"].map(async (name) => {
    const notes: CompletionProgressNotification[] = [];
    const value = await withMcpCompletionProgress(
      { progressToken: name },
      (notification) => {
        notes.push(notification);
        return Promise.resolve();
      },
      async () => {
        emitCompletionProgress({
          phase: "producer",
          state: "running",
          candidate_id: name,
          reason: `${name} running`,
        });
        await Promise.resolve();
        emitCompletionProgress({
          phase: "pending",
          state: "missing-authority",
          candidate_id: name,
          reason: `${name} needs authority`,
        });
        return name;
      },
    );
    assertEquals(value, name);
    assertEquals(
      notes.map((
        note,
      ) => [
        note.params.progressToken,
        note.params.progress,
        note.params._meta.discern_completion.candidate_id,
      ]),
      [[name, 1, name], [name, 2, name]],
    );
  });
  await Promise.all(calls);
});

Deno.test("completion progress failures cannot replace a result or an operation failure", async () => {
  const fail = (): Promise<void> =>
    Promise.reject(new Error("observer unavailable"));
  const emit = (): void =>
    emitCompletionProgress({
      phase: "queue",
      state: "waiting",
      candidate_id: null,
      reason: "Waiting for current execution.",
    });
  assertEquals(
    await withCompletionObserver(fail, () => {
      emit();
      return Promise.resolve("landed");
    }),
    "landed",
  );
  await assertRejects(
    () =>
      withCompletionObserver(fail, () => {
        emit();
        return Promise.reject(new Error("real failure"));
      }),
    Error,
    "real failure",
  );
  let notifications = 0;
  await withMcpCompletionProgress(undefined, () => {
    notifications++;
    return Promise.resolve();
  }, () => {
    emit();
    return Promise.resolve();
  });
  assertEquals(notifications, 0);
});
