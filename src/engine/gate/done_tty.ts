/** Package-backed Proof following the shared Gate workflow. */

import type { StepResult } from "../../shared/result.ts";
import type {
  GateData,
  GateStandard,
  LandingAuthorityData,
  Proof,
} from "../../shared/result_schemas.ts";
import { type GateTtyOptions, renderGateTtyTable } from "./gate_tty.ts";
import { renderGateProof } from "./presentation.ts";

type GateProofRecord = NonNullable<GateData["gate_proof"]>;

/** Render the truthful Proof and exact one-line relay. */
export function renderDoneTtyProofPanel(
  proof: Proof,
  options: GateTtyOptions,
  record?: GateProofRecord,
  steps: readonly StepResult[] = [],
  landingAuthority?: LandingAuthorityData,
): string {
  return renderGateProof(
    proof,
    record,
    steps,
    options,
    landingAuthority,
  );
}

/** Render the complete green TTY tail: workflow, Standards, then Proof. */
export function renderDoneTtySummary(
  steps: readonly StepResult[],
  proof: Proof,
  options: GateTtyOptions,
  standards: readonly GateStandard[] = [],
  record?: GateProofRecord,
  landingAuthority?: LandingAuthorityData,
): string {
  return `${renderGateTtyTable(steps, options, standards)}\n\n${
    renderDoneTtyProofPanel(
      proof,
      options,
      record,
      steps,
      landingAuthority,
    )
  }`;
}
