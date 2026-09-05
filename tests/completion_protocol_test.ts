/** Compile-time negative contracts keep domain ports from collapsing phases or outcomes. */
import { assertEquals } from "@std/assert";
import type {
  ClaimedExecution,
  CompletionBlocker,
  CompletionEvent,
  EnvironmentExecutor,
  EnvironmentPlan,
  LandingPublisher,
  ProducerEvaluator,
  QueuePlanner,
  ValidationDemand,
  ValidationPlan,
} from "../src/engine/completion/protocol.ts";

Deno.test("completion ports require claims, preserve refusals, and separate pure plans from execution", () => {
  // These assignments fail type-checking if a port broadens or erases a boundary.
  const boundaries: {
    source_tip_needs_no_declaration:
      Extract<EnvironmentPlan, { action: "source-tip" }>["declaration"] extends
        null ? true : false;
    speculation_needs_declaration: null extends Extract<
      EnvironmentPlan,
      { action: "borrow" | "provision" | "reuse" }
    >["declaration"] ? false
      : true;
    environment_can_be_new: null extends EnvironmentPlan["expected_stamp"]
      ? true
      : false;
    landing_uses_record_identity:
      Parameters<LandingPublisher["publish"]>[0] extends
        { id: string; revision: number } ? true : false;
    candidate_is_explicit:
      Parameters<ProducerEvaluator["plan"]>["length"] extends 3 ? true : false;
    assembly_mode_is_explicit:
      Parameters<ProducerEvaluator["assemble"]>["length"] extends 5 ? true
        : false;
    environment_binds_validation:
      Parameters<EnvironmentExecutor["plan"]>[1] extends
        Parameters<ProducerEvaluator["execute"]>[0] ? true : false;
    context_is_required:
      Omit<Extract<ValidationDemand, { kind: "test" }>, "context"> extends
        ValidationDemand ? false : true;
    mode_is_required:
      Omit<Extract<ValidationDemand, { kind: "test" }>, "mode"> extends
        ValidationDemand ? false : true;
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
    prepare_cannot_measure: {
      kind: "prepare";
      context: "local";
      mode: "strict";
      measurement: "required";
    } extends ValidationDemand ? false : true;
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
    source_tip_needs_no_declaration: true,
    speculation_needs_declaration: true,
    environment_can_be_new: true,
    landing_uses_record_identity: true,
    candidate_is_explicit: true,
    assembly_mode_is_explicit: true,
    environment_binds_validation: true,
    context_is_required: true,
    mode_is_required: true,
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
