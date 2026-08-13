/** Package-backed Proof receipt following the shared Gate workflow. */

import type { StepResult } from "../../shared/result.ts";
import type {
  GateData,
  GateStandard,
  Proof,
} from "../../shared/result_schemas.ts";
import { type GateTtyOptions, renderGateTtyTable } from "./gate_tty.ts";
import { renderGateProofReceipt } from "./presentation.ts";

type GateProofRecord = NonNullable<GateData["gate_proof"]>;

/** Render the truthful Proof receipt and exact one-line relay. */
export function renderDoneTtyProofPanel(
  proof: Proof,
  options: GateTtyOptions,
  record?: GateProofRecord,
  steps: readonly StepResult[] = [],
): string {
  return renderGateProofReceipt(proof, record, steps, options);
}

/** Render the complete green TTY tail: workflow, Standards, then Proof receipt. */
export function renderDoneTtySummary(
  steps: readonly StepResult[],
  proof: Proof,
  options: GateTtyOptions,
  standards: readonly GateStandard[] = [],
  record?: GateProofRecord,
): string {
  return `${renderGateTtyTable(steps, options, standards)}\n\n${
    renderDoneTtyProofPanel(proof, options, record, steps)
  }`;
}
