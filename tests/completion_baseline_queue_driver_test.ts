/** The queue driver preserves categorical failures at the existing execution ports. */
import { assert, assertEquals } from "@std/assert";
import { withTempDir } from "./helpers.ts";
import { compositionFixture } from "./completion_queue_git_fixture.ts";
import {
  COMPLETION_CLOCK,
  COMPLETION_RECOVERY,
  completionFixtures,
  completionId,
} from "./completion_fixtures.ts";
import { driveQueueValidation } from "../src/engine/landing_queue/driver.ts";
import { requireQueue } from "../src/engine/landing_queue/repository.ts";
import {
  readCompletionRecord,
  writeCompletionRecord,
} from "../src/engine/completion/store.ts";
import { COMPLETION_FAMILIES } from "../src/engine/completion/records.ts";
import { mutateQueue } from "../src/engine/landing_queue/mutations.ts";
import { observeCompletionRecords } from "../src/engine/validation/runtime.ts";
import { observedRecords } from "../src/engine/landing_queue/repository.ts";
import { RecoverySchema } from "../src/engine/completion/environment.ts";
import type {
  CompletionBlocker,
  EnvironmentExecutor,
  EnvironmentPlan,
  ProducerEvaluator,
} from "../src/engine/completion/protocol.ts";

Deno.test("completion baseline: a stopped queue driver releases scheduling independently of environment recovery", async () => {
  for (
    const scenario of [
      "claim-unavailable",
      "claim-recovery",
      "return-recovery",
      "no-validation",
      "machine-failed",
      "missing-evidence",
      "stale-claim",
    ] as const
  ) {
    await withTempDir(async (base) => {
      const f = await compositionFixture(base, false);
      const plan: EnvironmentPlan = {
        action: "source-tip",
        declaration: null,
        environment_id: f.execution.environment_id,
        expected_stamp: null,
        candidate_id: f.execution.candidate_id,
        validation: {
          candidate_id: f.execution.candidate_id,
          candidate: f.execution.candidate,
          demand: {
            kind: "done",
            context: "local",
            mode: "strict",
            requirements: [],
          },
          producers: [],
          reused: [],
          blockers: [],
        },
      };
      const recovery = RecoverySchema.parse(COMPLETION_RECOVERY);
      const failure: CompletionBlocker = scenario === "machine-failed"
        ? { kind: "validation-failed", evidence_ids: [] }
        : { kind: "missing-evidence", requirements: [] };
      let executions = 0;
      let validations = 0;
      const forbidden = (): never => {
        throw new Error(
          "A failed validation cannot plan or assemble admission",
        );
      };
      const evaluator: ProducerEvaluator = {
        observe: forbidden,
        plan: forbidden,
        assemble: forbidden,
        execute: () => {
          validations++;
          return Promise.resolve({ evidence: [], blockers: [failure] });
        },
      };
      const environment: EnvironmentExecutor = {
        observe: forbidden,
        plan: forbidden,
        recover: forbidden,
        claim: () =>
          Promise.resolve(
            scenario === "claim-unavailable"
              ? {
                kind: "environment-unavailable",
                reason: "No free environment",
              }
              : scenario === "claim-recovery"
              ? {
                kind: "recovery-incomplete",
                record_id: f.execution.environment_id,
                recovery,
              }
              : f.execution,
          ),
        execute: async (execution, validate) => {
          executions++;
          const validation =
            scenario === "no-validation" || scenario === "return-recovery"
              ? null
              : await validate(execution);
          return {
            validation,
            returned: scenario === "return-recovery"
              ? { kind: "recovery-incomplete", recovery }
              : { kind: "reset", environment: f.execution.environment },
          };
        },
      };
      const result = await driveQueueValidation({
        ...f,
        trunk: "main",
        claim: {
          fence: f.execution.fence,
          attempt: f.execution.attempt,
          effort: f.execution.candidate.source.effort_id,
        },
        plan,
        evaluator,
        environment,
        assembly_lease_ms: 50,
        clock: scenario === "stale-claim"
          ? { ...COMPLETION_CLOCK, wallNow: (): number => 300 }
          : COMPLETION_CLOCK,
      });
      const expected = scenario === "stale-claim"
        ? "replan"
        : scenario === "claim-recovery" || scenario === "return-recovery"
        ? "recovery-incomplete"
        : scenario === "claim-unavailable" || scenario === "no-validation"
        ? "environment-unavailable"
        : failure.kind;
      assertEquals(result.kind, expected, scenario);
      assertEquals(
        executions,
        scenario.startsWith("claim-") || scenario === "stale-claim" ? 0 : 1,
      );
      assertEquals(
        validations,
        scenario === "machine-failed" || scenario === "missing-evidence"
          ? 1
          : 0,
      );
      const queue = await requireQueue(f.root);
      const retained = scenario === "stale-claim";
      assertEquals(
        queue.record.data.entries[0]?.state,
        retained
          ? "active"
          : scenario === "machine-failed"
          ? "failed"
          : "eligible",
      );
      const attempt = await readCompletionRecord(f.root, {
        kind: "attempt",
        id: f.execution.fence.attempt_id,
      });
      assert(attempt.kind === "recorded" && attempt.record.kind === "attempt");
      assertEquals(
        attempt.record.data.state.kind,
        retained ? "claimed" : "finished",
      );
    });
  }
});

// The real producer/transport matrix lives in completion_queue_evidence_test.
// This port fixture isolates the older driver's distinct publication adapter.
Deno.test("queue driver preserves producer receipts after authority revocation without admission or failed-row mutation", async () => {
  await withTempDir(async (base) => {
    const f = await compositionFixture(base, false);
    const fixtures = completionFixtures();
    const producer = COMPLETION_FAMILIES.attempt.schema.parse(fixtures.attempt);
    producer.id = completionId(70);
    producer.data.identity.id = producer.id;
    assertEquals(
      (await writeCompletionRecord(
        f.root,
        producer,
        null,
        undefined,
        COMPLETION_CLOCK,
      )).kind,
      "written",
    );
    const execution = {
      ...f.execution,
      attempt: producer.data,
      fence: { ...f.execution.fence, attempt_id: producer.id },
    };
    const evidence =
      COMPLETION_FAMILIES.evidence.schema.parse(fixtures.evidence).data;
    const receipts = [
      { ...evidence, attempt_id: producer.id, artifacts: [] },
      {
        ...evidence,
        attempt_id: producer.id,
        artifacts: [],
        outcome: { kind: "failed" as const, reason: "The producer failed" },
      },
    ];
    const forbidden = (): never => {
      throw new Error("Revoked work cannot reach admission");
    };
    const plan: EnvironmentPlan = {
      action: "source-tip",
      declaration: null,
      environment_id: execution.environment_id,
      expected_stamp: null,
      candidate_id: execution.candidate_id,
      validation: {
        candidate_id: execution.candidate_id,
        candidate: execution.candidate,
        demand: {
          kind: "done",
          context: "local",
          mode: "strict",
          requirements: [],
        },
        producers: [],
        reused: [],
        blockers: [],
      },
    };
    const evaluator: ProducerEvaluator = {
      observe: forbidden,
      plan: forbidden,
      assemble: forbidden,
      execute: async () => {
        const queue = await requireQueue(f.root);
        assertEquals(
          (await mutateQueue({
            root: f.root,
            trunk: "main",
            expected_stamp: queue.stamp,
            mutation: {
              kind: "authority-revoked",
              effort: execution.candidate.source.effort_id,
            },
            clock: COMPLETION_CLOCK,
          })).kind,
          "changed",
        );
        return {
          evidence: receipts,
          blockers: [{ kind: "validation-failed", evidence_ids: [] }],
        };
      },
    };
    const environment: EnvironmentExecutor = {
      observe: forbidden,
      plan: forbidden,
      recover: forbidden,
      claim: () => Promise.resolve(execution),
      execute: async (claimed, validate) => ({
        validation: await validate(claimed),
        returned: { kind: "reset", environment: claimed.environment },
      }),
    };
    const result = await driveQueueValidation({
      ...f,
      trunk: "main",
      plan,
      evaluator,
      environment,
      claim: {
        fence: f.execution.fence,
        attempt: f.execution.attempt,
        effort: execution.candidate.source.effort_id,
      },
      assembly_lease_ms: 50,
      clock: COMPLETION_CLOCK,
    });
    assertEquals(result.kind, "replan");
    const records = observedRecords(await observeCompletionRecords(f.root));
    assertEquals(
      records.filter((r) => r.kind === "evidence").map((r) =>
        r.kind === "evidence" && r.data.outcome.kind
      ).sort(),
      ["failed", "passed"],
    );
    assertEquals(
      records.filter((r) => r.kind === "proof" || r.kind === "landing").length,
      0,
    );
    assertEquals(
      (await requireQueue(f.root)).record.data.entries[0]?.state === "failed",
      false,
    );
  });
});
