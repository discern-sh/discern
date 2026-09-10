/** Progress is isolated per invocation and has no effect on its outcome. */
import { assertEquals, assertRejects } from "@std/assert";
import {
  emitCompletionEvent,
  emitCompletionProgress,
  emitComponentUse,
  withCompletionObserver,
} from "../src/engine/completion/events.ts";
import { completionFixtures } from "./completion_fixtures.ts";
import { COMPLETION_FAMILIES } from "../src/engine/completion/records.ts";
import { EvidenceSchema } from "../src/engine/completion/evidence.ts";
import type { CompletionEvent } from "../src/engine/completion/protocol.ts";
import {
  type CompletionProgressNotification,
  withMcpCompletionProgress,
} from "../src/engine/mcp/progress.ts";

Deno.test("nested presentation observers retain detached facts for the surrounding recorder", async () => {
  const event: CompletionEvent = {
    id: "event",
    effort_id: "effort",
    source_head: "head",
    candidate_id: null,
    environment_id: null,
    attempt_id: null,
    executor_operation: "operation",
    at: 1,
    fact: {
      kind: "timing",
      interval_id: "phase",
      category: "execution",
      started_at: 0,
      finished_at: 1,
    },
  };
  const recorded: CompletionEvent[] = [];
  await withCompletionObserver((fact) => {
    if (fact.kind === "event") recorded.push(fact.event);
  }, () =>
    withCompletionObserver((fact) => {
      if (fact.kind === "event") {
        Object.assign(fact.event, { source_head: "changed" });
      }
      throw new Error("presentation unavailable");
    }, () => {
      emitCompletionEvent(event);
      return Promise.resolve();
    }));
  assertEquals(recorded, [event]);
});

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

Deno.test("producer event projection preserves every canonical component outcome", async () => {
  const fixtures = completionFixtures();
  const evidence = COMPLETION_FAMILIES.evidence.schema.parse(fixtures.evidence);
  const attempt = COMPLETION_FAMILIES.attempt.schema.parse(fixtures.attempt);
  const candidate = COMPLETION_FAMILIES.candidate.schema.parse(
    fixtures.candidate,
  );
  const environment = COMPLETION_FAMILIES.environment.schema.parse(
    fixtures.environment,
  );
  if (attempt.data.state.kind !== "claimed") {
    throw new Error("Fixture needs a claim");
  }
  const execution = {
    attempt: attempt.data,
    candidate: candidate.data,
    candidate_id: candidate.id,
    environment_id: environment.id,
    environment: environment.data,
    fence: { attempt_id: attempt.id, token: attempt.data.state.claim.token },
    signal: new AbortController().signal,
  };
  const events: CompletionEvent[] = [];
  const outcomes = EvidenceSchema.shape.outcome.options.map((option) =>
    option.shape.kind.value
  );
  await withCompletionObserver((fact) => {
    if (fact.kind === "event") events.push(fact.event);
  }, async () => {
    for (const kind of outcomes) {
      const component = EvidenceSchema.parse({
        ...evidence.data,
        outcome: kind === "passed"
          ? evidence.data.outcome
          : { kind, reason: "Recorded outcome" },
      });
      emitComponentUse(execution, component, evidence.id, "executed", 1, 100);
    }
    await Promise.resolve();
  });
  assertEquals(
    events.map((event) =>
      event.fact.kind === "producer" ? event.fact.outcome : undefined
    ),
    outcomes,
  );
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

Deno.test("MCP progress coalesces unchanged observations but reports every transition", async () => {
  const notes: CompletionProgressNotification[] = [];
  await withMcpCompletionProgress(
    { progressToken: "review" },
    (notification) => {
      notes.push(notification);
      return Promise.resolve();
    },
    () => {
      const waiting = {
        phase: "queue" as const,
        state: "waiting",
        candidate_id: "candidate",
        reason: "Waiting for a completion slot.",
      };
      emitCompletionProgress(waiting);
      emitCompletionProgress(waiting);
      emitCompletionProgress({
        ...waiting,
        state: "running",
        reason: "Validating the selected candidate.",
      });
      emitCompletionProgress(waiting);
      return Promise.resolve();
    },
  );
  assertEquals(
    notes.map((note) => note.params._meta.discern_completion.state),
    ["waiting", "running", "waiting"],
  );
  assertEquals(notes.map((note) => note.params.progress), [1, 2, 3]);
});
