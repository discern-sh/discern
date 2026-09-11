/** Static output rations counts; a live frame shows every snapshot. */
import { assertEquals } from "@std/assert";
import type { CompletionProgress } from "../src/engine/completion/events.ts";
import {
  createGateProgressPresenter,
  STATIC_COUNTS_CADENCE_MS,
} from "../src/engine/gate/progress_presenter.ts";

/** One producer snapshot the way the producer observer would emit it. */
function snapshot(
  completed: number,
  failed: number,
  partial = false,
): CompletionProgress {
  const tail = failed === 0 ? "no failures so far" : `${failed} failure so far`;
  return {
    phase: "producer",
    state: "running",
    candidate_id: null,
    reason: `Running test: ${completed} of 8 partitions done, ${tail}${
      partial ? "; counts are incomplete" : ""
    }.`,
    work: {
      producer: "test",
      units: { kind: "partitions", completed, total: 8 },
      results: { failed },
      ...(partial ? { partial: true } : {}),
    },
  };
}

const FINISHED: CompletionProgress = {
  phase: "producer",
  state: "finished",
  candidate_id: null,
  reason: "test passed.",
  work: { producer: "test" },
};

Deno.test("static output writes counts on change, on cadence, and once more when the producer settles", () => {
  let clock = 0;
  const lines: string[] = [];
  const presenter = createGateProgressPresenter({
    write: (line) => lines.push(line.trimEnd()),
    now: () => clock,
  });
  const observe = (progress: CompletionProgress): void =>
    presenter.observe({ kind: "progress", progress });
  // The first snapshot is written; the next ones inside the cadence are held.
  observe(snapshot(1, 0));
  clock = 1_000;
  observe(snapshot(2, 0));
  clock = 2_000;
  observe(snapshot(3, 0));
  assertEquals(lines, [snapshot(1, 0).reason]);
  // A failure count change is written the moment it is known.
  clock = 3_000;
  observe(snapshot(4, 1));
  assertEquals(lines.at(-1), snapshot(4, 1).reason);
  // Unchanged failures wait for the cadence.
  clock = 4_000;
  observe(snapshot(5, 1));
  clock = 3_000 + STATIC_COUNTS_CADENCE_MS;
  observe(snapshot(6, 1));
  assertEquals(lines.at(-1), snapshot(6, 1).reason);
  // Counts turning partial are written immediately.
  clock += 1_000;
  observe(snapshot(7, 1, true));
  assertEquals(lines.at(-1), snapshot(7, 1, true).reason);
  // The held final counts are written when the producer settles.
  clock += 1_000;
  observe(snapshot(8, 1, true));
  observe(FINISHED);
  assertEquals(lines, [
    snapshot(1, 0).reason,
    snapshot(4, 1).reason,
    snapshot(6, 1).reason,
    snapshot(7, 1, true).reason,
    snapshot(8, 1, true).reason,
  ]);
  // Nothing is held after settlement.
  observe(FINISHED);
  assertEquals(lines.length, 5);
});

Deno.test("a live frame replaces its transient line with every snapshot", () => {
  const transient: string[] = [];
  const presenter = createGateProgressPresenter({
    live: {
      note: (): void => {},
      transient: (text): void => {
        transient.push(text);
      },
    },
    now: () => 0,
  });
  for (let completed = 1; completed <= 4; completed++) {
    presenter.observe({
      kind: "progress",
      progress: snapshot(completed, 0),
    });
  }
  assertEquals(transient.length, 4);
});
