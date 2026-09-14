import { assert, assertEquals, assertRejects, assertThrows } from "@std/assert";
import { planValidation } from "../src/engine/validation/plan.ts";
import { executeValidation } from "../src/engine/validation/execute.ts";
import {
  producerRecipeKey,
  resolveProducerGraph,
} from "../src/engine/validation/catalog.ts";
import {
  ARTIFACT_EXTRACTOR,
  ARTIFACT_RECIPE,
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

Deno.test("producer recipe keys grow with dependency content without repeated JSON escaping", () => {
  const key = (depth: number, leafRun = "inspect"): string => {
    const graph = resolveProducerGraph(
      recipes(Object.fromEntries(Array.from({ length: depth }, (_, index) => [
        `jobs.phase${index}`,
        {
          run: index === 0 ? leafRun : "inspect",
          needs: index === 0 ? [] : [`jobs.phase${index - 1}`],
        },
      ]))),
      [],
    );
    return producerRecipeKey(graph.producers, `jobs.phase${depth - 1}`);
  };
  const shallow = key(4);
  const deep = key(8);
  assert(
    deep.length <= shallow.length * 3,
    "doubling a chain must not multiply escaped JSON",
  );
  assert(
    deep !== key(8, "inspect changed"),
    "a leaf change must still change its parent's identity",
  );
  assertThrows(
    () => producerRecipeKey(new Map(), "jobs.absent"),
    Error,
    "missing producer",
  );
});

Deno.test("E02 E03 E06: cold scope and build producers are demanded; valid replay has no process", async () => {
  for (const selector of ["jobs.test", "jobs.build", "scopes.unrelated.gate"]) {
    const declarations = obligations().map((o) => ({
      ...o,
      input: { producer: selector },
    }));
    const snap = await snapshot({
      producers: { [selector]: PRODUCER_RECIPE },
      obligations: declarations,
    });
    const plan = planValidation(snap, observation(), {
      kind: "done",
      mode: "strict",
      requirements: snap.requirements,
    });
    assertEquals(plan.producers.map((p) => p.selector), [selector]);
    assertEquals(plan.producers[0]?.consumers.length, 3);
    const { runtime, counts } = countedRuntime();
    const execution = claimed(snap, plan);
    const result = await executeValidation(
      snap,
      plan,
      execution,
      runtime,
      COMPLETION_CLOCK,
    );
    assertEquals(counts.get(selector), 1);
    assertEquals(result.evidence.length, 3);
    const replay = planValidation(
      snap,
      observation(recorded(execution, result.evidence)),
      plan.demand,
    );
    assertEquals(replay.producers, []);
    assertEquals(replay.reused.length, 3);
  }
});

Deno.test("selectors, consumer cycles, dependency cycles and ambiguous sources fail before effects", async () => {
  assertThrows(() => resolveProducerGraph({}, obligations()));
  assertThrows(() =>
    resolveProducerGraph(
      recipes({
        "jobs.test": { run: "first", artifacts: ["report.txt"] },
        "jobs.other": { run: "second", artifacts: ["report.txt"] },
      }),
      obligations(),
    )
  );
  assertThrows(() =>
    resolveProducerGraph(
      recipes({ "jobs.test": { needs: ["jobs.test"] } }),
      obligations(),
    )
  );
  assertThrows(() =>
    resolveProducerGraph(
      recipes({ "jobs.test": { needs: ["standards.coverage"] } }),
      obligations(),
    )
  );
  assertThrows(() =>
    resolveProducerGraph(
      recipes({ "jobs.test": {} }),
      obligations().filter((o) => o.requirement.id === "coverage").map((o) => ({
        ...o,
        input: { producer: "standards.coverage" },
      })),
    )
  );
  await assertRejects(() =>
    snapshot({
      producers: { "jobs.test": PRODUCER_RECIPE },
      obligations: obligations().map((o) => ({
        ...o,
        input: { producer: "jobs.test", run: "other" },
      })),
    })
  );
  const snap = await snapshot();
  assertThrows(() =>
    planValidation(snap, observation(), {
      kind: "done",
      mode: "strict",
      requirements: [],
    })
  );
  assertThrows(() =>
    planValidation(snap, observation(), {
      kind: "test",
      mode: "strict",
      producers: ["jobs.absent"],
      readings: "already-produced",
    })
  );
});

Deno.test("E11 E12 E17: test adds only supplied readings; prepare is measurement-free; standalone demand shares extraction", async () => {
  const declarations = obligations();
  declarations.push({
    requirement: {
      id: "costly",
      kind: "standard",
      definition: "c".repeat(64),
    },
    input: {
      producer: "jobs.instrumented",
      extract: ARTIFACT_EXTRACTOR,
      artifact: "reports/counts.txt",
    },
    inputs: ["src/**"],
    standard: {
      name: "costly",
      metric: "covered",
      scale: 1,
      direction: "up",
      limit: 1,
    },
  });
  const snap = await snapshot({
    obligations: declarations,
    producers: {
      "jobs.test": PRODUCER_RECIPE,
      "jobs.instrumented": ARTIFACT_RECIPE,
    },
  });
  const test = planValidation(snap, observation(), {
    kind: "test",
    mode: "strict",
    producers: ["jobs.test"],
    readings: "already-produced",
  });
  assertEquals(test.producers.map((p) => p.selector), ["jobs.test"]);
  assertEquals(test.producers[0]?.consumers.length, 3);
  assertEquals(
    planValidation(snap, observation(), {
      kind: "prepare",
      mode: "strict",
      measurement: "none",
    }).producers,
    [],
  );
  for (const kind of ["standards", "pin", "proposal"] as const) {
    const demand = planValidation(snap, observation(), {
      kind,
      mode: "strict",
      requirements: snap.requirements.filter((r) => r.id === "costly"),
    });
    assertEquals(demand.producers.map((p) => p.selector), [
      "jobs.instrumented",
    ]);
    assertEquals(demand.producers[0]?.recipe.run, ARTIFACT_RECIPE.run);
    assertEquals(demand.producers[0]?.consumers[0]?.input.extraction?.run, [
      ARTIFACT_EXTRACTOR,
    ]);
  }
});
