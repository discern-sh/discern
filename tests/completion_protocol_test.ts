/** Compile-time negative contracts keep domain ports from collapsing phases or outcomes. */
import { assertEquals } from "@std/assert";
import type {
  ClaimedExecution,
  CompletionBlocker,
  CompletionEvent,
  EnvironmentExecutor,
  LandingPublisher,
  ProducerEvaluator,
  QueuePlanner,
  ValidationDemand,
  ValidationPlan,
} from "../src/engine/completion/protocol.ts";

Deno.test("completion ports require claims, preserve refusals, and separate pure plans from execution", () => {
  // These assignments fail type-checking if a port broadens or erases a boundary.
  const boundaries: {
    producer_plan_is_pure: ReturnType<ProducerEvaluator["plan"]> extends
      Promise<unknown> ? false : true;
    producer_needs_claim: Parameters<ProducerEvaluator["execute"]>[1] extends
      ClaimedExecution ? true : false;
    plan_cannot_execute: ValidationPlan extends
      Parameters<ProducerEvaluator["execute"]>[1] ? false : true;
    claim_can_refuse: CompletionBlocker extends
      Awaited<ReturnType<EnvironmentExecutor["claim"]>> ? true : false;
    queue_plan_is_pure: ReturnType<QueuePlanner["plan"]> extends
      Promise<unknown> ? false : true;
    landing_can_refuse: CompletionBlocker extends
      Awaited<ReturnType<LandingPublisher["publish"]>> ? true : false;
    prepare_cannot_measure: { kind: "prepare"; measurement: "required" } extends
      ValidationDemand ? false : true;
    events_cannot_authorize: CompletionEvent extends
      Parameters<LandingPublisher["publish"]>[0] ? false : true;
    judgment_is_not_recovery:
      Extract<CompletionBlocker, { kind: "missing-judgment" }> extends
        Extract<CompletionBlocker, { kind: "recovery-incomplete" }> ? false
        : true;
    authority_is_not_evidence:
      Extract<CompletionBlocker, { kind: "missing-authority" }> extends
        Extract<CompletionBlocker, { kind: "stale-evidence" }> ? false : true;
  } = {
    producer_plan_is_pure: true,
    producer_needs_claim: true,
    plan_cannot_execute: true,
    claim_can_refuse: true,
    queue_plan_is_pure: true,
    landing_can_refuse: true,
    prepare_cannot_measure: true,
    events_cannot_authorize: true,
    judgment_is_not_recovery: true,
    authority_is_not_evidence: true,
  };
  assertEquals(Object.values(boundaries).every(Boolean), true);
});
