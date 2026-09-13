/** Progress facts stay actionable on text-only live and reconnect surfaces. */
import {
  assert,
  assertEquals,
  assertStringIncludes,
  assertThrows,
} from "@std/assert";
import { join } from "@std/path";
import { emitCompletionProgress } from "../src/engine/completion/events.ts";
import { openOperationJournal } from "../src/engine/completion/operation_journal.ts";
import { operationProgressResult } from "../src/engine/completion/progress_result.ts";
import { producerWorkSentence } from "../src/engine/completion/progress_prose.ts";
import { withMcpCompletionProgress } from "../src/engine/mcp/progress.ts";
import { createProducerProgressObserver } from "../src/engine/validation/producer_progress.ts";
import { renderMcpResult } from "../src/engine/mcp/server.ts";
import {
  PRODUCER_WORK_STATES,
  ProgressWorkSchema,
} from "../src/shared/result_schemas.ts";
import { withTempDir } from "./helpers.ts";
import { gitInit } from "./engine_helpers.ts";
import { z } from "@zod/zod";
import { object } from "../src/shared/result_markdown_values.ts";

/** Every reported work field has a text obligation or an explicit state assertion. */
const WORK = {
  producer: "future-obligation",
  state: "running",
  units: { kind: "bundles", completed: 13, total: 19 },
  results: { passed: 37, failed: 2, skipped: 5 },
  active: ["active-orbit", "active-comet"],
  elapsed_ms: 147242,
  partial: true,
  output_path: "/tmp/future-producer.log",
} as const;

/** Expected text for each leaf of the schema; new fields must declare an obligation. */
const WORK_OBLIGATIONS = {
  producer: [WORK.producer],
  state: ["Running"],
  units: { kind: ["bundles"], completed: ["13 of"], total: ["of 19"] },
  results: {
    passed: ["37 passed"],
    failed: ["2 failures"],
    skipped: ["5 skipped"],
  },
  active: [...WORK.active],
  elapsed_ms: ["147.2 s"],
  partial: ["counts are incomplete"],
  output_path: [WORK.output_path],
};

/** Require examples and text obligations for every current and future schema field. */
function assertWorkFieldCoverage(
  schema: Record<string, unknown>,
  example: Record<string, unknown>,
  obligations: Record<string, unknown> = WORK_OBLIGATIONS,
): string[] {
  const properties = object(schema.properties);
  assert(properties !== undefined);
  assertEquals(Object.keys(example).sort(), Object.keys(properties).sort());
  assertEquals(Object.keys(obligations).sort(), Object.keys(properties).sort());
  const expected: string[] = [];
  for (const [key, value] of Object.entries(properties)) {
    const childSchema = object(value);
    if (
      childSchema !== undefined && object(childSchema.properties) !== undefined
    ) {
      const child = object(example[key]);
      assert(child !== undefined);
      const childObligations = object(obligations[key]);
      assert(childObligations !== undefined);
      expected.push(
        ...assertWorkFieldCoverage(childSchema, child, childObligations),
      );
    } else {
      const leaf = obligations[key];
      assert(Array.isArray(leaf) && leaf.length > 0);
      for (const fact of leaf) {
        assert(typeof fact === "string" && fact.length > 0);
        expected.push(fact);
      }
    }
  }
  return expected;
}

Deno.test("every producer work field has a readable evidence obligation", () => {
  const expected = assertWorkFieldCoverage(
    z.toJSONSchema(ProgressWorkSchema),
    WORK,
  );
  const rendered = producerWorkSentence(WORK);
  for (const fact of expected) assertStringIncludes(rendered, fact);
});

Deno.test("protocol active-only changes reach live MCP text", async () => {
  const messages: string[] = [];
  await withMcpCompletionProgress({ progressToken: "test" }, (notification) => {
    messages.push(notification.params.message);
    return Promise.resolve();
  }, () => {
    const observer = createProducerProgressObserver({ candidate_id: null });
    for (const active of ["orbit", "comet"]) {
      observer.output({
        kind: "line",
        label: "future-obligation",
        text: `DISCERN_PROGRESS ${JSON.stringify({ active: [active] })}`,
      });
    }
    return Promise.resolve();
  });
  assertEquals(messages.length, 2);
  assertStringIncludes(messages[0] ?? "", "orbit");
  assertStringIncludes(messages[1] ?? "", "comet");
});

Deno.test("reconnect merges each producer once, preserves lifecycle, and clears a new run", async () => {
  await withTempDir(async (root) => {
    await Deno.writeTextFile(join(root, "readme"), "evidence fixture\n");
    await gitInit(root);
    const journal = await openOperationJournal(root, {
      verb: "done",
      path: root,
    });
    assert(journal !== undefined);
    const running = {
      phase: "producer" as const,
      state: "running",
      candidate_id: null,
      reason: producerWorkSentence(WORK),
      work: WORK,
    };
    await journal.observe({ kind: "progress", progress: running });
    let read = await operationProgressResult(root);
    assertEquals(read.data?.account.length, 1);
    assertStringIncludes(
      renderMcpResult(read).content[0]?.text ?? "",
      journal.handle,
    );
    assert(read.data !== undefined);
    assertStringIncludes(
      await Deno.readTextFile(read.data.record_path),
      journal.handle,
    );
    for (
      const outcome of PRODUCER_WORK_STATES.filter((state) =>
        state !== "running"
      )
    ) {
      const work = { producer: WORK.producer, state: outcome };
      await journal.observe({
        kind: "progress",
        progress: {
          ...running,
          state: "finished",
          reason: `${WORK.producer} ${outcome}.`,
          work,
        },
      });
      read = await operationProgressResult(root);
      assertEquals(read.data?.account.length, 1);
      assertStringIncludes(read.data?.account[0] ?? "", outcome);
      assert(!(read.data?.account[0] ?? "").includes("Running"));
      assertEquals(read.data?.producers?.[0]?.active, []);
    }
    await journal.observe({
      kind: "progress",
      progress: {
        ...running,
        work: { producer: WORK.producer, state: "running" },
      },
    });
    read = await operationProgressResult(root);
    assertEquals(read.data?.producers?.[0]?.units, undefined);
    assertEquals(read.data?.producers?.[0]?.results, undefined);
    assertEquals(read.data?.producers?.[0]?.output_path, undefined);
    assertEquals(read.data?.producers?.[0]?.partial, undefined);
  });
});

Deno.test("a complete unit count never supplies a producer verdict", () => {
  const unknown = producerWorkSentence({
    producer: "future-obligation",
    units: { kind: "bundles", completed: 19, total: 19 },
  });
  assert(!unknown.includes("passed"));
  assert(!unknown.includes("finished"));
});

Deno.test("live producer terminal facts carry the engine verdict independently of counts", async () => {
  const messages: string[] = [];
  await withMcpCompletionProgress(
    { progressToken: "terminal" },
    (notification) => {
      messages.push(notification.params.message);
      return Promise.resolve();
    },
    () => {
      emitCompletionProgress({
        phase: "producer",
        state: "finished",
        candidate_id: null,
        reason: "future-obligation failed.",
        work: { producer: "future-obligation" },
      });
      return Promise.resolve();
    },
  );
  assertStringIncludes(messages[0] ?? "", "failed");
});

Deno.test("the work evidence guard rejects an unrelated new field or nested counter without an obligation", () => {
  const schema = z.toJSONSchema(ProgressWorkSchema);
  const properties = object(schema.properties);
  assert(properties !== undefined);
  assertThrows(() =>
    assertWorkFieldCoverage({
      ...schema,
      properties: { ...properties, orbit_counter: { type: "number" } },
    }, WORK)
  );
  const results = object(properties.results);
  assert(results !== undefined);
  assertThrows(() =>
    assertWorkFieldCoverage({
      ...schema,
      properties: {
        ...properties,
        results: {
          ...results,
          properties: {
            ...object(results.properties),
            orbit_counter: { type: "number" },
          },
        },
      },
    }, WORK)
  );
});
