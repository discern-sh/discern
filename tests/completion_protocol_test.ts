/** Compile-time negative contracts keep the evaluator port from collapsing phases or outcomes. */
import { assertEquals } from "@std/assert";
import type {
  ClaimedExecution,
  CompletionBlocker,
  DiagnosticExecution,
  ProducerEvaluator,
  ValidationDemand,
  ValidationPlan,
} from "../src/engine/completion/protocol.ts";
import type { InvalidationReason } from "../src/engine/completion/outcomes.ts";

Deno.test("completion ports require claims, preserve refusals, and separate pure plans from execution", () => {
  // These assignments fail type-checking if a port broadens or erases a boundary.
  const boundaries: {
    candidate_is_explicit:
      Parameters<ProducerEvaluator["plan"]>["length"] extends 3 ? true : false;
    assembly_attribution_is_explicit:
      Parameters<ProducerEvaluator["assemble"]>["length"] extends 6 ? true
        : false;
    mode_is_required:
      Omit<Extract<ValidationDemand, { kind: "test" }>, "mode"> extends
        ValidationDemand ? false : true;
    diagnostic_names_its_source:
      Omit<Extract<ValidationDemand, { kind: "diagnostic" }>, "source"> extends
        ValidationDemand ? false : true;
    producer_plan_is_pure: ReturnType<ProducerEvaluator["plan"]> extends
      Promise<unknown> ? false : true;
    producer_needs_claim: Parameters<ProducerEvaluator["execute"]>[1] extends
      ClaimedExecution ? true : false;
    plan_cannot_execute: ValidationPlan extends
      Parameters<ProducerEvaluator["execute"]>[1] ? false : true;
    execution_is_fenced: ClaimedExecution["fence"] extends
      { attempt_id: string; token: string } ? true : false;
    diagnostic_cannot_publish: DiagnosticExecution extends ClaimedExecution
      ? false
      : true;
    prepare_cannot_measure: {
      kind: "prepare";
      mode: "strict";
      measurement: "required";
    } extends ValidationDemand ? false : true;
    judgment_is_not_evidence:
      Extract<CompletionBlocker, { kind: "missing-judgment" }> extends
        Extract<CompletionBlocker, { kind: "missing-evidence" }> ? false
        : true;
    staleness_names_a_typed_reason:
      Extract<CompletionBlocker, { kind: "stale-evidence" }>["reason"] extends
        InvalidationReason ? true : false;
  } = {
    candidate_is_explicit: true,
    assembly_attribution_is_explicit: true,
    mode_is_required: true,
    diagnostic_names_its_source: true,
    producer_plan_is_pure: true,
    producer_needs_claim: true,
    plan_cannot_execute: true,
    execution_is_fenced: true,
    diagnostic_cannot_publish: true,
    prepare_cannot_measure: true,
    judgment_is_not_evidence: true,
    staleness_names_a_typed_reason: true,
  };
  assertEquals(Object.values(boundaries).every(Boolean), true);
});
