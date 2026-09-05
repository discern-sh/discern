/** The queue driver preserves categorical failures at the existing execution ports. */
import { assert, assertEquals } from "@std/assert";
import { withTempDir } from "./helpers.ts";
import { compositionFixture } from "./completion_queue_git_fixture.ts";
import {
  COMPLETION_CLOCK,
  COMPLETION_RECOVERY,
} from "./completion_fixtures.ts";
import { driveQueueValidation } from "../src/engine/landing_queue/driver.ts";
import { requireQueue } from "../src/engine/landing_queue/repository.ts";
import { readCompletionRecord } from "../src/engine/completion/store.ts";
import { RecoverySchema } from "../src/engine/completion/environment.ts";
import type {
  CompletionBlocker,
  EnvironmentExecutor,
  EnvironmentPlan,
  ProducerEvaluator,
} from "../src/engine/completion/protocol.ts";

Deno.test("completion baseline: queue driver releases only returned failures and retains recovery ownership", async () => {
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
      const retained = scenario.endsWith("recovery") ||
        scenario === "stale-claim";
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
