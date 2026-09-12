/** Producer protocol lines become coalesced facts without touching execution. */
import { assertEquals } from "@std/assert";
import {
  type CompletionFailure,
  type CompletionProgress,
  withCompletionObserver,
} from "../src/engine/completion/events.ts";
import {
  completionFailureSentence,
  producerWorkSentence,
} from "../src/engine/completion/progress_prose.ts";
import {
  composeJobOutputObservers,
  createProducerProgressObserver,
} from "../src/engine/validation/producer_progress.ts";
import type { JobOutputEvent } from "../src/engine/jobs/types.ts";

/** Collect the facts one observer emits for a scripted sequence of lines. */
async function observed(
  events: readonly JobOutputEvent[],
): Promise<{ progress: CompletionProgress[]; failures: CompletionFailure[] }> {
  const progress: CompletionProgress[] = [];
  const failures: CompletionFailure[] = [];
  await withCompletionObserver((fact) => {
    if (fact.kind === "progress") progress.push(fact.progress);
    if (fact.kind === "failure") failures.push(fact.failure);
  }, () => {
    const observer = createProducerProgressObserver({
      candidate_id: "candidate",
    });
    for (const event of events) observer.output(event);
    return Promise.resolve();
  });
  return { progress, failures };
}

/** One complete-line event carrying a protocol payload. */
function line(label: string, text: string): JobOutputEvent {
  return { kind: "line", label, text };
}

Deno.test("reports merge per producer, coalesce repeats, and keep partial sticky", async () => {
  const { progress } = await observed([
    line(
      "test",
      'DISCERN_PROGRESS {"units":{"kind":"partitions","completed":3,"total":8}}',
    ),
    line("test", "ordinary output between reports"),
    { kind: "partial", label: "test", text: "DISCERN_PROGRESS ignored" },
    line(
      "test",
      'DISCERN_PROGRESS {"units":{"kind":"partitions","completed":3,"total":8}}',
    ),
    line("test", 'DISCERN_PROGRESS {"results":{"failed":1},"partial":true}'),
    line("test", 'DISCERN_PROGRESS {"results":{"failed":1}}'),
  ]);
  assertEquals(progress.map((fact) => fact.reason), [
    "Running test: 3 of 8 partitions done.",
    "Running test: 3 of 8 partitions done, 1 failure so far; counts are incomplete.",
  ]);
  assertEquals(progress[0]?.work, {
    producer: "test",
    state: "running",
    units: { kind: "partitions", completed: 3, total: 8 },
  });
  assertEquals(progress[1]?.work?.partial, true);
  assertEquals(progress[1]?.phase, "producer");
  assertEquals(progress[1]?.candidate_id, "candidate");
});

Deno.test("each established failure emits once with its location and reproduction", async () => {
  const failureLine =
    'DISCERN_PROGRESS {"failure":{"name":"alpha holds","message":"expected 2, got 3","file":"tests/red_test.ts","line":7,"reproduce":"deno task test tests/red_test.ts --filter \'alpha holds\' --shuffle=7"}}';
  const { progress, failures } = await observed([
    line("test", failureLine),
    line("test", failureLine),
  ]);
  assertEquals(progress, []);
  assertEquals(failures, [{
    producer: "test",
    name: "alpha holds",
    message: "expected 2, got 3",
    file: "tests/red_test.ts",
    line: 7,
    reproduce_cmd:
      "deno task test tests/red_test.ts --filter 'alpha holds' --shuffle=7",
    partial: false,
  }]);
  assertEquals(
    completionFailureSentence(
      failures[0] ?? {
        producer: "",
        name: "",
        message: "",
        partial: false,
      },
    ),
    "alpha holds failed (tests/red_test.ts:7): expected 2, got 3. " +
      "Reproduce: deno task test tests/red_test.ts --filter 'alpha holds' --shuffle=7",
  );
});

Deno.test("two producers keep separate accounts and shared consumers count once", async () => {
  const { progress } = await observed([
    line(
      "test",
      'DISCERN_PROGRESS {"units":{"kind":"partitions","completed":1,"total":2}}',
    ),
    line(
      "generated:codegen",
      'DISCERN_PROGRESS {"units":{"kind":"files","completed":4,"total":null}}',
    ),
  ]);
  assertEquals(progress.map((fact) => fact.work?.producer), [
    "test",
    "generated:codegen",
  ]);
  assertEquals(progress[1]?.reason, "Running generated:codegen: 4 files done.");
  assertEquals(progress[1]?.work?.units?.total, null);
});

Deno.test("work sentences state counts without percentages or estimates", () => {
  assertEquals(
    producerWorkSentence({
      producer: "test",
      units: { kind: "partitions", completed: 3, total: 8 },
      results: { passed: 120, failed: 1, skipped: 2 },
    }),
    "Recorded progress for test: 3 of 8 partitions done, 120 passed, 1 failure, 2 skipped.",
  );
  assertEquals(
    producerWorkSentence({
      producer: "test",
      results: { passed: 12, failed: 0 },
    }),
    "Recorded progress for test: 12 passed, no failures.",
  );
  assertEquals(
    producerWorkSentence({ producer: "test" }),
    "Recorded progress for test.",
  );
});

Deno.test("composed observers each receive every event", () => {
  const seen: string[] = [];
  const record = (name: string): { output(event: JobOutputEvent): void } => ({
    output: (event): void => {
      seen.push(`${name}:${event.text}`);
    },
  });
  const composed = composeJobOutputObservers(
    record("first"),
    undefined,
    record("second"),
  );
  composed?.output(line("test", "one"));
  assertEquals(seen, ["first:one", "second:one"]);
  assertEquals(composeJobOutputObservers(undefined, undefined), undefined);
});
