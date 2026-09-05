/** One active command drives one claimed validation; shared locks enclose publication only. */
import type {
  CompletionBlocker,
  EnvironmentExecutor,
  EnvironmentPlan,
  ProducerEvaluator,
} from "../completion/protocol.ts";
import { writeCompletionRecord } from "../completion/store.ts";
import { type Clock, SYSTEM_CLOCK } from "../../shared/clock.ts";
import {
  type SecureEntropy,
  SYSTEM_SECURE_ENTROPY,
} from "../../shared/entropy.ts";
import { withQueueLock } from "./repository.ts";
import {
  checkQueueClaim,
  claimQueueAssembly,
  type QueueWorkClaim,
  releaseQueueClaim,
  settleQueueClaim,
} from "./claims.ts";
import { publishAdmission } from "./admission.ts";
import { mutateQueue } from "./mutations.ts";
import { requireQueue } from "./repository.ts";

/** Execute one complete demand under the environment's lease and the queue's publication claim. */
export async function driveQueueValidation(input: {
  readonly root: string;
  readonly trunk: string;
  readonly claim: QueueWorkClaim;
  readonly plan: EnvironmentPlan;
  readonly environment: EnvironmentExecutor;
  readonly evaluator: ProducerEvaluator;
  readonly assembly_lease_ms: number;
  readonly clock?: Clock;
  readonly entropy?: SecureEntropy;
}): Promise<
  | { readonly kind: "admitted"; readonly proof_id: string }
  | CompletionBlocker
  | { readonly kind: "replan" }
> {
  const clock = input.clock ?? SYSTEM_CLOCK;
  const entropy = input.entropy ?? SYSTEM_SECURE_ENTROPY;
  const candidate = input.plan.validation.candidate;
  if (!await checkQueueClaim(input.root, input.claim, candidate, clock)) {
    return { kind: "replan" };
  }
  const execution = await input.environment.claim(
    input.plan,
    input.claim.attempt.identity.executor,
  );
  if ("kind" in execution) {
    if (execution.kind !== "recovery-incomplete") {
      await releaseQueueClaim(input.root, input.claim, candidate, clock);
    }
    return execution;
  }
  const returned = await input.environment.execute(
    execution,
    async (claimed) => {
      const validation = await input.evaluator.execute(
        input.plan.validation,
        claimed,
      );
      for (const component of validation.evidence) {
        await withQueueLock(input.root, async () => {
          if (
            !await checkQueueClaim(input.root, input.claim, candidate, clock)
          ) {
            throw new Error(
              "Queue work was superseded before evidence publication.",
            );
          }
          const written = await writeCompletionRecord(
            input.root,
            {
              version: 1,
              kind: "evidence",
              id: entropy.uuid(),
              revision: 1,
              data: component,
            },
            null,
            claimed.fence,
            clock,
          );
          if (written.kind !== "written") {
            throw new Error(
              `Component publication ${written.kind}; preserve its producing attempt.`,
            );
          }
        });
      }
      return validation;
    },
  );
  if (returned.returned.kind === "recovery-incomplete") {
    return {
      kind: "recovery-incomplete",
      record_id: execution.environment_id,
      recovery: returned.returned.recovery,
    };
  }
  if (!await checkQueueClaim(input.root, input.claim, candidate, clock)) {
    return { kind: "replan" };
  }
  if (returned.validation === null) {
    await releaseQueueClaim(input.root, input.claim, candidate, clock);
    return {
      kind: "environment-unavailable",
      reason:
        "Validation did not complete. Inspect the retained environment attempt before selecting work again.",
    };
  }
  const failed = returned.validation.blockers[0];
  if (failed !== undefined) {
    if (failed.kind !== "validation-failed") {
      await releaseQueueClaim(input.root, input.claim, candidate, clock);
    } else {await withQueueLock(input.root, async () => {
        if (!await checkQueueClaim(input.root, input.claim, candidate, clock)) {
          return;
        }
        await settleQueueClaim(input.root, input.claim, "failed", clock);
        const queue = await requireQueue(input.root);
        await mutateQueue({
          root: input.root,
          trunk: input.trunk,
          expected_stamp: queue.stamp,
          mutation: { kind: "candidate-failed", effort: input.claim.effort },
          clock,
        });
      });}
    return failed;
  }
  if (input.plan.validation.demand.kind !== "done") {
    throw new Error("Queue admission requires the complete done demand.");
  }
  const assembly = await claimQueueAssembly(
    input.root,
    input.claim,
    candidate,
    input.assembly_lease_ms,
    clock,
    entropy,
  );
  await input.evaluator.observe(input.plan.candidate_id);
  const admitted = await publishAdmission({
    root: input.root,
    trunk: input.trunk,
    claim: assembly,
    candidate,
    evaluator: input.evaluator,
    requirements: input.plan.validation.demand.requirements,
    clock,
  });
  if (admitted.kind !== "admitted") {
    await releaseQueueClaim(input.root, assembly, candidate, clock);
  }
  return admitted;
}
