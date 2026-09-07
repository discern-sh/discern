import { ON_DISK_FORMATS } from "../src/shared/on_disk_formats.ts";
import { assert, assertEquals } from "@std/assert";
import type { ComponentEvidence } from "../src/engine/completion/evidence.ts";
import { CompletionRecordSchema } from "../src/engine/completion/records.ts";
import { executeValidation } from "../src/engine/validation/execute.ts";
import { planValidation } from "../src/engine/validation/plan.ts";
import { assembleCandidate } from "../src/engine/validation/selection.ts";
import {
  assemblyRecord,
  captured,
  claimed,
  COMPLETION_CLOCK,
  completionId,
  CONDITIONS,
  countedRuntime,
  FILES,
  obligations,
  observation,
  PRODUCER_RECIPE,
  recorded,
  snapshot,
} from "./completion_producers_fixtures.ts";

/** Execute and record one candidate context with the counted runtime. */
async function passing(
  snap: Awaited<ReturnType<typeof snapshot>>,
  context = "local",
  sequence = 1,
): Promise<
  {
    plan: ReturnType<typeof planValidation>;
    execution: ReturnType<typeof claimed>;
    result: Awaited<ReturnType<typeof executeValidation>>;
    records: ReturnType<typeof recorded>;
  }
> {
  const plan = planValidation(snap, observation(), {
    kind: "done",
    context,
    mode: "strict",
    requirements: snap.requirements,
  });
  const execution = claimed(snap, plan, sequence);
  const result = await executeValidation(
    snap,
    plan,
    execution,
    countedRuntime().runtime,
    COMPLETION_CLOCK,
  );
  return {
    plan,
    execution,
    result,
    records: recorded(execution, result.evidence),
  };
}

Deno.test("E01: every nonpassing component state prevents aggregate Proof with a valid publication claim", async () => {
  const snap = await snapshot();
  const prior = await passing(snap);
  const outcomes: Record<
    ComponentEvidence["outcome"]["kind"],
    ComponentEvidence["outcome"]
  > = {
    passed: {
      kind: "passed",
      capture_complete: true,
      metrics: { covered: 3, population: 4, gaps: 1 },
    },
    failed: { kind: "failed", reason: "producer failed" },
    cancelled: { kind: "cancelled", reason: "cancelled" },
    unrun: { kind: "unrun", reason: "not executed" },
    stale: { kind: "stale", reason: "candidate mutated" },
  };
  for (const outcome of Object.values(outcomes)) {
    const records = prior.records.map((record) =>
      record.kind === "evidence"
        ? CompletionRecordSchema.parse({
          ...record,
          data: { ...record.data, outcome },
        })
        : record
    );
    assertEquals(
      assembleCandidate(
        snap,
        snap.candidate_id,
        snap.candidate,
        snap.requirements,
        [...records, assemblyRecord(snap)],
        "strict",
        new Set(),
        COMPLETION_CLOCK,
      ).kind,
      outcome.kind === "passed" ? "complete" : "incomplete",
    );
  }
  assertEquals(
    assembleCandidate(
      snap,
      snap.candidate_id,
      snap.candidate,
      snap.requirements,
      prior.records,
      "strict",
      new Set(),
      COMPLETION_CLOCK,
    ).kind,
    "incomplete",
  );
  const older = assemblyRecord(snap);
  const newer = CompletionRecordSchema.parse({
    ...older,
    id: completionId(2000),
    data: {
      ...older.data,
      identity: {
        ...older.data.identity,
        id: completionId(2000),
        sequence: 1000,
      },
      state: { kind: "finished", outcome: "failed", finished_at: 120 },
    },
  });
  assertEquals(
    assembleCandidate(
      snap,
      snap.candidate_id,
      snap.candidate,
      snap.requirements,
      [...prior.records, older, newer],
      "strict",
      new Set(),
      COMPLETION_CLOCK,
    ).kind,
    "incomplete",
  );
});

Deno.test("E04: every applicability dimension invalidates required consumer reuse", async () => {
  const baseline = await snapshot();
  const prior = await passing(baseline);
  const changes: Record<
    keyof ComponentEvidence["applicability"],
    Parameters<typeof snapshot>[0]
  > = {
    producer: {
      producers: { "jobs.novel": PRODUCER_RECIPE },
      obligations: obligations().map((o) => ({
        ...o,
        input: { producer: "jobs.novel" },
      })),
    },
    context: {
      conditions: [{
        ...CONDITIONS[0],
        context: "ci",
        seed: 42,
        environment: { MODE: "test" },
        identity: "a".repeat(64),
      }],
      obligations: obligations("ci"),
    },
    policy: { candidate: { ...baseline.candidate, policy: "c".repeat(64) } },
    protected_definitions: {
      obligations: obligations().map((o) => ({
        ...o,
        requirement: { ...o.requirement, definition: "d".repeat(64) },
      })),
    },
    command: {
      producers: { "jobs.test": { ...PRODUCER_RECIPE, run: "different" } },
    },
    extractor: {
      obligations: obligations().map((o) => ({
        ...o,
        input: { producer: "jobs.test", extract: "cat" },
        inputs: ["src/**"],
      })),
    },
    inputs: {
      inputs: {
        ...FILES,
        files: {
          ...FILES.files,
          "src/a.ts": { ...FILES.files["src/a.ts"], digest: "e".repeat(64) },
        },
      },
    },
    denominator_inputs: {
      obligations: obligations().map((o) =>
        o.standard === undefined ? o : {
          ...o,
          standard: {
            ...o.standard,
            per: { kind: "extent", measure: "words", globs: ["docs/**"] },
          },
        }
      ),
    },
    toolchain: {
      inputs: {
        ...FILES,
        files: {
          ...FILES.files,
          "tool.lock": { ...FILES.files["tool.lock"], digest: "f".repeat(64) },
        },
      },
    },
    environment: {
      conditions: [{
        context: "local",
        seed: 42,
        environment: { MODE: "production" },
        identity: "a".repeat(64),
      }],
    },
    seed: {
      conditions: [{
        context: "local",
        seed: 43,
        environment: { MODE: "test" },
        identity: "a".repeat(64),
      }],
    },
    closure: {
      producers: {
        "jobs.test": {
          run: PRODUCER_RECIPE.run,
          needs: [],
          artifacts: [],
          environment: ["MODE"],
          toolchain: ["tool.lock"],
        },
      },
    },
  };
  for (const [dimension, change] of Object.entries(changes)) {
    const changed = await snapshot(change);
    const plan = planValidation(changed, observation(prior.records), {
      kind: "done",
      context: dimension === "context" ? "ci" : "local",
      mode: "strict",
      requirements: changed.requirements,
    });
    assert(plan.producers.length > 0, dimension);
    assert(plan.reused.length < changed.requirements.length, dimension);
  }
  const per = obligations().map((o) =>
    o.standard === undefined ? o : {
      ...o,
      standard: {
        ...o.standard,
        per: {
          kind: "extent" as const,
          measure: "words" as const,
          globs: ["docs/**"],
        },
      },
    }
  );
  const denominatorBaseline = await snapshot({ obligations: per });
  const denominatorPrior = await passing(denominatorBaseline);
  const changed = await snapshot({
    obligations: per,
    inputs: {
      ...FILES,
      files: {
        ...FILES.files,
        "docs/a.md": {
          ...FILES.files["docs/a.md"],
          words: 30,
          digest: "9".repeat(64),
        },
      },
    },
  });
  const plan = planValidation(changed, observation(denominatorPrior.records), {
    ...denominatorPrior.plan.demand,
    kind: "done",
    requirements: changed.requirements,
  });
  assertEquals(plan.reused.length, 1);
  assertEquals(plan.producers[0]?.consumers.length, 2);
});

Deno.test("E06: declared closure reuses across candidates; unknown closure stays candidate-bound", async () => {
  for (const declared of [true, false]) {
    const producers = {
      "jobs.test": declared ? PRODUCER_RECIPE : {
        run: PRODUCER_RECIPE.run,
        needs: [],
        artifacts: [],
        environment: [],
        toolchain: [],
      },
    };
    const baseline = await snapshot({ producers });
    const prior = await passing(baseline);
    const next = await snapshot({
      producers,
      candidate_id: completionId(55),
      candidate: { ...baseline.candidate, head: "e".repeat(40) },
    });
    const plan = planValidation(next, observation(prior.records), {
      kind: "done",
      context: "local",
      mode: "strict",
      requirements: next.requirements,
    });
    assertEquals(plan.reused.length, declared ? 3 : 0);
    if (declared) {
      const records = [...prior.records, assemblyRecord(next)];
      const assembled = assembleCandidate(
        next,
        next.candidate_id,
        next.candidate,
        next.requirements,
        records,
        "strict",
        new Set(),
        COMPLETION_CLOCK,
      );
      assertEquals(assembled.kind, "complete");
      if (assembled.kind === "complete") {
        assert(
          assembled.proof.receipts.every((r) =>
            r.candidate_id === next.candidate_id
          ),
        );
      }
    }
  }
});

Deno.test("E10 V08: started/failed/report reruns supersede only matching subjects; diagnostics cannot clear composition failure", async () => {
  const snap = await snapshot({
    producers: {
      "jobs.test": PRODUCER_RECIPE,
      "jobs.independent": { ...PRODUCER_RECIPE, run: "independent producer" },
    },
    obligations: obligations().map((o) => ({
      ...o,
      input: {
        producer: o.requirement.id === "coverage"
          ? "jobs.test"
          : "jobs.independent",
      },
    })),
  });
  const prior = await passing(snap);
  const forced = planValidation(
    snap,
    observation(prior.records),
    prior.plan.demand,
    new Set(),
    prior.execution.attempt.identity.id,
  );
  assertEquals(forced.reused.length, 0);
  assertEquals(forced.producers.length, 2);
  const selected = snap.requirements.filter((r) => r.id === "coverage");
  const rerunPlan = planValidation(snap, observation(), {
    kind: "standards",
    context: "local",
    mode: "report",
    requirements: selected,
  });
  const rerun = claimed(
    snap,
    rerunPlan,
    2,
    prior.execution.attempt.identity.id,
  );
  const active = CompletionRecordSchema.parse({
    version: ON_DISK_FORMATS.completionRecord.version,
    revision: 1,
    kind: "attempt",
    id: rerun.attempt.identity.id,
    data: rerun.attempt,
  });
  const activePlan = planValidation(
    snap,
    observation([...prior.records, active]),
    prior.plan.demand,
  );
  assertEquals(activePlan.reused.length, 2);
  assertEquals(activePlan.blockers[0]?.kind, "waiting-for-operation");
  assertEquals(
    planValidation(
      snap,
      observation([...prior.records, active]),
      prior.plan.demand,
      new Set(),
      rerun.attempt.identity.id,
    ).blockers[0]?.kind,
    "waiting-for-operation",
  );
  for (
    const capture of [{ ...captured(), outcome: "failed" as const }, captured()]
  ) {
    const result = await executeValidation(
      snap,
      rerunPlan,
      rerun,
      countedRuntime({ produce: () => Promise.resolve(capture) }).runtime,
      COMPLETION_CLOCK,
    );
    const records = [
      ...prior.records,
      ...recorded(
        rerun,
        result.evidence,
        capture.outcome === "passed" ? "passed" : "failed",
      ),
    ];
    const blocked = planValidation(
      snap,
      observation(records),
      prior.plan.demand,
    );
    assertEquals(blocked.reused.length, 2);
    assertEquals(
      blocked.producers.length,
      capture.outcome === "passed" ? 1 : 0,
    );
    assertEquals(blocked.blockers.length, capture.outcome === "passed" ? 0 : 1);
    if (capture.outcome === "passed") {
      assertEquals(
        blocked.producers[0]?.consumers.length,
        1,
        "report evidence requires a fresh strict producer, never authority conversion",
      );
    } else {
      assertEquals(
        blocked.blockers[0]?.kind,
        "validation-failed",
        "a failed report remains red and requires an explicit rerun",
      );
    }
    const explicit = planValidation(
      snap,
      observation(records),
      prior.plan.demand,
      new Set(),
      rerun.attempt.identity.id,
    );
    assertEquals(explicit.producers[0]?.consumers.length, 1);
    const failing = snap.requirements.find((r) => r.id === "coverage");
    if (failing === undefined) throw new Error("missing fixture");
    const diagnosticPlan = planValidation(snap, observation(records), {
      kind: "diagnostic",
      context: "local",
      mode: "strict",
      failing_requirement: failing,
      source: snap.candidate.source,
      base: snap.candidate.expected_predecessor.head,
    });
    const diagnostic = claimed(snap, diagnosticPlan, 3);
    const diagnosticResult = await executeValidation(
      snap,
      diagnosticPlan,
      diagnostic,
      countedRuntime().runtime,
      COMPLETION_CLOCK,
    );
    assertEquals(
      assembleCandidate(
        snap,
        snap.candidate_id,
        snap.candidate,
        snap.requirements,
        [
          ...records,
          ...recorded(diagnostic, diagnosticResult.evidence),
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

Deno.test("E13: compatible partial contexts assemble; missing, substituted and report-only lanes do not", async () => {
  const snap = await snapshot({
    obligations: [...obligations(), ...obligations("ci")],
    conditions: [...CONDITIONS, {
      context: "ci",
      seed: 42,
      environment: { MODE: "test" },
      identity: "a".repeat(64),
    }],
  });
  const local = await passing(snap);
  const ci = await passing(snap, "ci", 2);
  const assemble = (records: typeof local.records) =>
    assembleCandidate(
      snap,
      snap.candidate_id,
      snap.candidate,
      snap.requirements,
      [...records, assemblyRecord(snap)],
      "strict",
      new Set(),
      COMPLETION_CLOCK,
    );
  assertEquals(assemble(local.records).kind, "incomplete");
  assertEquals(assemble([...local.records, ...ci.records]).kind, "complete");
  assertEquals(
    assembleCandidate(
      snap,
      completionId(999),
      snap.candidate,
      snap.requirements,
      [...local.records, ...ci.records],
      "strict",
    ).kind,
    "incomplete",
  );
  for (const field of ["policy", "context"] as const) {
    const wrong = ci.records.map((r) =>
      r.kind !== "evidence" ? r : CompletionRecordSchema.parse({
        ...r,
        data: {
          ...r.data,
          applicability: {
            ...r.data.applicability,
            [field]: field === "context" ? "substitute" : "f".repeat(64),
          },
        },
      })
    );
    assertEquals(assemble([...local.records, ...wrong]).kind, "incomplete");
  }
  const report = ci.records.map((r) =>
    r.kind === "attempt" || r.kind === "evidence"
      ? CompletionRecordSchema.parse({
        ...r,
        data: { ...r.data, mode: "report" },
      })
      : r
  );
  assertEquals(assemble([...local.records, ...report]).kind, "incomplete");
  assertEquals(
    assembleCandidate(
      snap,
      snap.candidate_id,
      snap.candidate,
      snap.requirements,
      [...local.records, ...report, assemblyRecord(snap, "report")],
      "report",
      new Set(),
      COMPLETION_CLOCK,
    ).kind,
    "complete",
  );
});

Deno.test("explicit retry bounds all earlier terminal failures while retaining unrelated green and live work", async () => {
  const names = ["amber", "birch", "cedar"];
  const first = obligations()[0];
  assert(first !== undefined);
  const declarations = names.map((id) => ({
    requirement: { ...first.requirement, id },
    input: { producer: `jobs.${id}` },
  }));
  const snap = await snapshot({
    producers: Object.fromEntries(names.map((id) => [
      `jobs.${id}`,
      { ...PRODUCER_RECIPE, run: id },
    ])),
    obligations: declarations,
  });
  const green = await passing(snap);
  const records = [...green.records];
  const failed = [];
  for (const [index, id] of names.slice(0, 2).entries()) {
    const plan = planValidation(snap, observation(), {
      kind: "standards",
      context: "local",
      mode: "strict",
      requirements: snap.requirements.filter((r) => r.id === id),
    });
    const execution = claimed(snap, plan, index + 2);
    // Reusable subjects remain the same even when an earlier source candidate differs.
    execution.attempt.identity.candidate_id = completionId(80 + index);
    records.push(...recorded(execution, [], "failed"));
    failed.push(execution.attempt.identity.id);
  }
  const boundary = failed[1];
  assert(boundary !== undefined);
  const blocked = planValidation(snap, observation(records), green.plan.demand);
  assertEquals(blocked.blockers.length, 2);
  const retry = planValidation(
    snap,
    observation(records),
    green.plan.demand,
    new Set(),
    boundary,
  );
  assertEquals(retry.blockers, []);
  assertEquals(retry.producers.map((p) => p.selector).sort(), [
    "jobs.amber",
    "jobs.birch",
  ]);
  assertEquals(retry.reused.map((r) => r.requirement.id), ["cedar"]);
  const later = claimed(snap, retry, 4, boundary);
  const active = CompletionRecordSchema.parse({
    version: ON_DISK_FORMATS.completionRecord.version,
    revision: 1,
    kind: "attempt",
    id: later.attempt.identity.id,
    data: later.attempt,
  });
  for (const extra of [[active], recorded(later, [], "failed")]) {
    const protectedPlan = planValidation(
      snap,
      observation([...records, ...extra]),
      green.plan.demand,
      new Set(),
      boundary,
    );
    assertEquals(protectedPlan.blockers.length, 2);
    assertEquals(protectedPlan.producers, []);
    assertEquals(protectedPlan.reused.map((r) => r.requirement.id), ["cedar"]);
  }
});

Deno.test("evaluator audits only selectable newest evidence and never falls back after corruption", async () => {
  const { withTempDir } = await import("./helpers.ts");
  const { gitInit } = await import("./engine_helpers.ts");
  const { retainArtifact } = await import(
    "../src/engine/validation/artifacts.ts"
  );
  const { createProducerEvaluator } = await import(
    "../src/engine/validation/evaluator.ts"
  );
  await withTempDir(async (root) => {
    await Deno.writeTextFile(`${root}/source`, "fixture");
    await gitInit(root);
    const snap = await snapshot();
    const old = await passing(snap, "local", 1);
    const latest = await passing(snap, "local", 2);
    const records = [];
    for (const [name, run] of [["old", old], ["latest", latest]] as const) {
      const artifact = await retainArtifact(
        root,
        {
          attempt_id: run.execution.attempt.identity.id,
          candidate_id: snap.candidate_id,
          context: "local",
        },
        `${name}.txt`,
        new TextEncoder().encode(name),
      );
      records.push(...run.records.map((record) =>
        record.kind === "evidence"
          ? {
            ...record,
            data: { ...record.data, artifacts: [artifact] },
          }
          : record
      ));
    }
    const current = observation(records);
    const evaluator = createProducerEvaluator({
      root,
      snapshot: snap,
      observe: () => Promise.resolve(current),
    });
    const open = Deno.open;
    const reads: string[] = [];
    Deno.open = (path, options) => {
      if (options?.read && /\/(old|latest)\.txt$/.test(String(path))) {
        reads.push(String(path));
      }
      return open(path, options);
    };
    try {
      await evaluator.observe(snap.candidate_id);
      assertEquals(reads.map((path) => path.split("/").at(-1)), ["latest.txt"]);
      const demand = {
        kind: "done" as const,
        context: "local",
        mode: "strict" as const,
        requirements: snap.requirements,
      };
      const plan = evaluator.plan(current, demand, snap.candidate_id);
      assertEquals(plan.producers.length, 0);
      assertEquals(plan.reused.length, snap.requirements.length);
      const path = reads[0];
      assert(path !== undefined);
      await Deno.writeTextFile(path, "changed evidence");
      await evaluator.observe(snap.candidate_id);
      const invalid = evaluator.plan(current, demand, snap.candidate_id);
      assertEquals(invalid.reused.length, 0);
      assert(invalid.producers.length > 0 || invalid.blockers.length > 0);
      assert(
        reads.every((path) => path.endsWith("/latest.txt")),
        "old passing artifacts cannot rescue a corrupt newest attempt",
      );
    } finally {
      Deno.open = open;
    }
  });
});
