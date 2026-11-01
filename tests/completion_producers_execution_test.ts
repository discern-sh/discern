import { assert, assertEquals, assertRejects } from "@std/assert";
import { executeValidation } from "../src/engine/validation/execute.ts";
import { planValidation } from "../src/engine/validation/plan.ts";
import type { ProducerDeclaration } from "../src/shared/config_schema.ts";
import { SYSTEM_SCHEDULER } from "../src/shared/scheduler.ts";
import { assembleCandidate } from "../src/engine/validation/selection.ts";
import {
  assemblyRecord,
  captured,
  claimed,
  COMPLETION_CLOCK,
  countedRuntime,
  fenceOf,
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
  assertEquals(result.evidence.length, snap.requirements.length);
  assert(result.evidence.every((e) => e.outcome.kind === "unrun"));
  assertEquals(
    result.blockers.filter((b) => b.kind === "validation-failed").length,
    1,
  );
  const bare = await snapshot({
    producers: recipes({ "jobs.test": {}, "jobs.bare": { run: "exit 1" } }),
  });
  const test = planValidation(bare, observation(), {
    kind: "test",
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

Deno.test("failed extraction and artifacts naming another candidate fail required consumers", async () => {
  const snap = await snapshot({
    obligations: obligations().map((o) => ({
      ...o,
      input: { producer: "jobs.test", extract: "extract" },
      inputs: ["src/**"],
    })),
  });
  const plan = planValidation(snap, observation(), {
    kind: "done",
    mode: "strict",
    requirements: snap.requirements,
  });
  const execution = claimed(snap, plan);
  {
    const { runtime } = countedRuntime({
      produce: () =>
        Promise.resolve({
          ...captured(),
          artifacts: [{
            attempt_id: execution.attempt.identity.id,
            candidate_id: "00000000-0000-4000-8000-000000000999",
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
  const differences = {
    run: { run: "another command" },
    inputs: { inputs: ["other/**"] },
    artifacts: { artifacts: ["other.txt"] },
    environment: { environment: ["OTHER"] },
    toolchain: { toolchain: ["other.lock"] },
    timeout: { timeout: 30 },
    needs: { needs: ["jobs.build"] },
  } satisfies Record<keyof ProducerDeclaration, Partial<ProducerDeclaration>>;
  for (
    const [field, difference] of [
      ["identical", {}],
      ...Object.entries(differences),
    ] as const
  ) {
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
        "jobs.build": { ...PRODUCER_RECIPE, run: "build" },
        "jobs.same": {
          ...PRODUCER_RECIPE,
          ...difference,
        },
      },
      obligations: declarations,
    });
    const plan = planValidation(snap, observation(), {
      kind: "done",
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
      field === "identical" ? 1 : field === "needs" ? 3 : 2,
      field,
    );
    assertEquals(result.evidence.length, 3);
    assertEquals(result.blockers.length, 1);
    const assembly = assemblyRecord(snap);
    assertEquals(
      assembleCandidate(
        snap,
        snap.candidate_id,
        snap.candidate,
        snap.requirements,
        [...recorded(execution, result.evidence), assembly],
        "strict",
        fenceOf(assembly),
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
      { ...captured(), outcome: "cancelled" as const, complete: false },
      { ...captured(), complete: false },
      captured(""),
      captured("DISCERN_METRIC covered NaN"),
    ]
  ) {
    const snap = await snapshot();
    const plan = planValidation(snap, observation(), {
      kind: "done",
      mode: "strict",
      requirements: snap.requirements,
    });
    const { runtime } = countedRuntime({
      produce: () => Promise.resolve(capture),
    });
    const execution = claimed(snap, plan);
    const assembly = assemblyRecord(snap);
    const result = await executeValidation(
      snap,
      plan,
      execution,
      runtime,
      COMPLETION_CLOCK,
    );
    assert(result.blockers.length > 0);
    if (capture.outcome === "cancelled") {
      assert(
        result.blockers.every((b) =>
          b.kind === "cancelled" || b.kind === "missing-evidence"
        ),
      );
      assert(
        result.evidence.every((e) =>
          e.outcome.kind === "cancelled" || e.outcome.kind === "unrun"
        ),
      );
    }
    assertEquals(
      assembleCandidate(
        snap,
        snap.candidate_id,
        snap.candidate,
        snap.requirements,
        [
          ...recorded(execution, result.evidence, "failed"),
          assembly,
        ],
        "strict",
        fenceOf(assembly),
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

/** Two sibling job producers, optionally released by one shared dependency. */
async function siblingSnapshot(
  shared: boolean,
): Promise<Awaited<ReturnType<typeof snapshot>>> {
  const needs = shared ? { needs: ["jobs.base"] } : {};
  return await snapshot({
    producers: recipes({
      ...(shared ? { "jobs.base": { run: "base" } } : {}),
      "jobs.writer": { run: "write", ...needs },
      "jobs.sibling": { run: "sibling", ...needs },
    }),
    obligations: ["writer", "sibling"].map((id) => ({
      requirement: { id, kind: "job", definition: "d".repeat(64) },
      input: { producer: `jobs.${id}` },
    })),
  });
}

/** Each later verification takes one more event-loop turn, so siblings finish verifying apart. */
async function staggeredVerification(call: number): Promise<void> {
  for (let turn = 0; turn < call; turn++) {
    await new Promise<void>((resolve) =>
      SYSTEM_SCHEDULER.scheduleTimeout(resolve, 0)
    );
  }
}

for (const shared of [false, true]) {
  Deno.test(
    `producers released together all verify before any of them runs (${
      shared ? "shared dependency" : "no dependency"
    })`,
    async () => {
      const snap = await siblingSnapshot(shared);
      const plan = planValidation(snap, observation(), {
        kind: "done",
        mode: "strict",
        requirements: snap.requirements,
      });
      const events: string[] = [];
      let calls = 0;
      const { runtime } = countedRuntime({
        verify: async (_execution, verification) => {
          if (verification?.allowCancelled === true) return;
          await staggeredVerification(++calls);
          events.push("verified");
        },
        produce: (producer) => {
          events.push(producer.selector);
          return Promise.resolve(captured());
        },
      });
      const result = await executeValidation(
        snap,
        plan,
        claimed(snap, plan),
        runtime,
        COMPLETION_CLOCK,
      );
      assertEquals(result.blockers, []);
      const firstSibling = Math.min(
        events.indexOf("jobs.writer"),
        events.indexOf("jobs.sibling"),
      );
      assert(firstSibling >= 0, events.join(", "));
      assertEquals(
        events.lastIndexOf("verified") < firstSibling,
        true,
        events.join(", "),
      );
    },
  );
}

Deno.test("a sibling whose verification refuses releases the producers waiting on it", async () => {
  const snap = await siblingSnapshot(false);
  const plan = planValidation(snap, observation(), {
    kind: "done",
    mode: "strict",
    requirements: snap.requirements,
  });
  let calls = 0;
  const { runtime, counts } = countedRuntime({
    verify: async (_execution, verification) => {
      if (verification?.allowCancelled === true) return;
      const call = ++calls;
      await staggeredVerification(call);
      if (call === 3) throw new Error("checkout changed");
    },
  });
  const result = await executeValidation(
    snap,
    plan,
    claimed(snap, plan),
    runtime,
    COMPLETION_CLOCK,
  );
  assertEquals(counts.size, 1);
  assertEquals(
    result.evidence.map((e) => e.outcome.kind).sort(),
    ["failed", "passed"],
  );
});
