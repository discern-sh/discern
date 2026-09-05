import { assert, assertEquals, assertRejects } from "@std/assert";
import { executeValidation } from "../src/engine/validation/execute.ts";
import { planValidation } from "../src/engine/validation/plan.ts";
import { assembleCandidate } from "../src/engine/validation/selection.ts";
import {
  assemblyRecord,
  captured,
  claimed,
  COMPLETION_CLOCK,
  countedRuntime,
  obligations,
  observation,
  PRODUCER_RECIPE,
  recipes,
  recorded,
  snapshot,
} from "./completion_producers_fixtures.ts";

Deno.test("dependency failure prevents its consumers from executing; diagnostic-only jobs retain failure", async () => {
  const snap = await snapshot({
    producers: recipes({
      "jobs.test": { needs: ["jobs.build"] },
      "jobs.build": { run: "build" },
    }),
  });
  const plan = planValidation(snap, observation(), {
    kind: "done",
    context: "local",
    mode: "strict",
    requirements: snap.requirements,
  });
  const { runtime, counts } = countedRuntime();
  const result = await executeValidation(snap, plan, claimed(snap, plan), {
    ...runtime,
    produce: (producer, execution) =>
      producer.selector === "jobs.build"
        ? Promise.resolve({ ...captured(), outcome: "failed" })
        : runtime.produce(producer, execution),
  }, COMPLETION_CLOCK);
  assertEquals(counts.size, 0);
  assert(result.evidence.every((e) => e.outcome.kind === "failed"));
  const bare = await snapshot({
    producers: recipes({ "jobs.test": {}, "jobs.bare": { run: "exit 1" } }),
  });
  const test = planValidation(bare, observation(), {
    kind: "test",
    context: "local",
    mode: "strict",
    producers: ["jobs.bare"],
    readings: "already-produced",
  });
  const failed = await executeValidation(
    bare,
    test,
    claimed(bare, test),
    countedRuntime({
      produce: () => Promise.resolve({ ...captured(), outcome: "failed" }),
    }).runtime,
    COMPLETION_CLOCK,
  );
  assertEquals(failed.evidence, []);
  assert(failed.blockers.length > 0);
});

Deno.test("failed extraction and artifacts with another candidate or context fail required consumers", async () => {
  const snap = await snapshot({
    obligations: obligations().map((o) => ({
      ...o,
      input: { producer: "jobs.test", extract: "extract" },
      inputs: ["src/**"],
    })),
  });
  const plan = planValidation(snap, observation(), {
    kind: "done",
    context: "local",
    mode: "strict",
    requirements: snap.requirements,
  });
  const execution = claimed(snap, plan);
  for (const context of ["local", "foreign"]) {
    const { runtime } = countedRuntime({
      produce: () =>
        Promise.resolve({
          ...captured(),
          artifacts: [{
            attempt_id: execution.attempt.identity.id,
            candidate_id: context === "local"
              ? "00000000-0000-4000-8000-000000000999"
              : execution.candidate_id,
            context,
            path: "out.txt",
            digest: "a".repeat(64),
            bytes: 1,
          }],
        }),
    });
    const result = await executeValidation(
      snap,
      plan,
      execution,
      runtime,
      COMPLETION_CLOCK,
    );
    assert(result.evidence.every((e) => e.outcome.kind === "failed"));
  }
  const result = await executeValidation(
    snap,
    plan,
    execution,
    countedRuntime({
      extract: () => Promise.resolve({ ...captured(), outcome: "failed" }),
    }).runtime,
    COMPLETION_CLOCK,
  );
  assert(result.evidence.every((e) => e.outcome.kind === "failed"));
});

Deno.test("E09: extraction starts while an unrelated job is held open", async () => {
  const slow = Promise.withResolvers<void>();
  const extracted = Promise.withResolvers<void>();
  const snap = await snapshot({
    producers: recipes({
      "jobs.test": {},
      "jobs.unrelated": { run: "unrelated" },
    }),
    obligations: [
      ...obligations().map((o) => ({
        ...o,
        input: { producer: "jobs.test", extract: "cat" },
        inputs: ["src/**"],
      })),
      {
        requirement: {
          id: "unrelated",
          context: "local",
          kind: "job",
          definition: "d".repeat(64),
        },
        input: { producer: "jobs.unrelated" },
      },
    ],
  });
  let unrelatedFinished = false;
  const { runtime } = countedRuntime({
    produce: async (producer) => {
      if (producer.selector === "jobs.unrelated") {
        await slow.promise;
        unrelatedFinished = true;
      }
      return captured();
    },
    extract: (_o, capture) => {
      assertEquals(unrelatedFinished, false);
      extracted.resolve();
      return Promise.resolve(capture);
    },
  });
  const plan = planValidation(snap, observation(), {
    kind: "done",
    context: "local",
    mode: "strict",
    requirements: snap.requirements,
  });
  const execution = claimed(snap, plan);
  const running = executeValidation(
    snap,
    plan,
    execution,
    runtime,
    COMPLETION_CLOCK,
  );
  try {
    await extracted.promise;
    assertEquals(unrelatedFinished, false);
  } finally {
    slow.resolve();
  }
  const result = await running;
  assertEquals(result.blockers, []);
});

Deno.test("physical deduplication requires matching recipe identity; each protected bound still applies", async () => {
  for (const timeout of [undefined, 30]) {
    const declarations = obligations().map((o) => ({
      ...o,
      input: {
        producer: o.requirement.id === "gaps" ? "jobs.same" : "jobs.test",
      },
      ...(o.standard === undefined ? {} : {
        standard: {
          ...o.standard,
          limit: o.requirement.id === "gaps" ? 0 : o.standard.limit,
        },
      }),
    }));
    const snap = await snapshot({
      producers: {
        "jobs.test": PRODUCER_RECIPE,
        "jobs.same": {
          ...PRODUCER_RECIPE,
          ...(timeout === undefined ? {} : { timeout }),
        },
      },
      obligations: declarations,
    });
    const plan = planValidation(snap, observation(), {
      kind: "done",
      context: "local",
      mode: "strict",
      requirements: snap.requirements,
    });
    const execution = claimed(snap, plan);
    const { runtime, counts } = countedRuntime();
    const result = await executeValidation(
      snap,
      plan,
      execution,
      runtime,
      COMPLETION_CLOCK,
    );
    assertEquals(
      [...counts.values()].reduce((a, b) => a + b, 0),
      timeout === undefined ? 1 : 2,
    );
    assertEquals(result.evidence.length, 3);
    assertEquals(result.blockers.length, 1);
    assertEquals(
      assembleCandidate(
        snap,
        snap.candidate_id,
        snap.candidate,
        snap.requirements,
        [...recorded(execution, result.evidence), assemblyRecord(snap)],
        "strict",
        new Set(),
        COMPLETION_CLOCK,
      ).kind,
      "incomplete",
    );
  }
});

Deno.test("E01 E05: failed, incomplete and malformed producer captures cannot satisfy consumers", async () => {
  for (
    const capture of [
      { ...captured(), outcome: "failed" as const },
      { ...captured(), complete: false },
      captured(""),
      captured("DISCERN_METRIC covered NaN"),
    ]
  ) {
    const snap = await snapshot();
    const plan = planValidation(snap, observation(), {
      kind: "done",
      context: "local",
      mode: "strict",
      requirements: snap.requirements,
    });
    const { runtime } = countedRuntime({
      produce: () => Promise.resolve(capture),
    });
    const execution = claimed(snap, plan);
    const result = await executeValidation(
      snap,
      plan,
      execution,
      runtime,
      COMPLETION_CLOCK,
    );
    assert(result.blockers.length > 0);
    assertEquals(
      assembleCandidate(
        snap,
        snap.candidate_id,
        snap.candidate,
        snap.requirements,
        [
          ...recorded(execution, result.evidence, "failed"),
          assemblyRecord(snap),
        ],
        "strict",
        new Set(),
        COMPLETION_CLOCK,
      ).kind,
      "incomplete",
    );
  }
});

Deno.test("claim mismatch is rejected before effects and candidate mutation stales all scope evidence", async () => {
  const snap = await snapshot();
  const plan = planValidation(snap, observation(), {
    kind: "done",
    context: "local",
    mode: "strict",
    requirements: snap.requirements,
  });
  const execution = claimed(snap, plan);
  const { runtime, counts } = countedRuntime();
  await assertRejects(() =>
    executeValidation(
      snap,
      plan,
      { ...execution, candidate_id: "wrong" },
      runtime,
      COMPLETION_CLOCK,
    )
  );
  assertEquals(counts.size, 0);
  let mutated = false;
  const mutating = countedRuntime({
    produce: () => {
      mutated = true;
      return Promise.resolve(captured());
    },
    verify: () => {
      if (mutated) return Promise.reject(new Error("tracked mutation"));
      return Promise.resolve();
    },
  });
  const result = await executeValidation(
    snap,
    plan,
    execution,
    mutating.runtime,
    COMPLETION_CLOCK,
  );
  assert(result.evidence.every((e) => e.outcome.kind === "stale"));
  assertEquals(result.evidence.length, 3);
});
