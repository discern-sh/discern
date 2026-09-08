/** Shared pre-job protocol for every strict and report Gate entry point. */

import type {
  CheckpointPreflight,
  DeclarationRequest,
} from "../checkpoints/preflight.ts";
import type { DiscernResult } from "../../shared/result.ts";
import type { GateData } from "../../shared/result_schemas.ts";

export type CheckpointGateResolution =
  | { kind: "refuse"; result: DiscernResult<GateData> }
  | { kind: "proceed"; preflight: CheckpointPreflight };

export type DonePreamble =
  | { kind: "reuse"; result: DiscernResult<GateData> }
  | { kind: "refuse"; result: DiscernResult<GateData> }
  | { kind: "proceed"; preflight?: CheckpointPreflight };

export interface DonePreambleOperations {
  readonly reusableGreenProof: (
    root: string,
  ) => Promise<DiscernResult<GateData> | undefined>;
  readonly resolveCheckpointGate: (
    root: string,
    request: DeclarationRequest,
    mode: "strict" | "report",
    ciRecovery: boolean,
    signal?: AbortSignal,
  ) => Promise<CheckpointGateResolution>;
  readonly unchangedTreeRerunRefusal: (
    root: string,
    rerunRequested: boolean,
    evidenceNow?: string,
  ) => Promise<DiscernResult<GateData> | undefined>;
  readonly gateRunEvidenceIdentity: (
    root: string,
    checkpoint?: Pick<CheckpointPreflight, "evidence" | "policyCommit">,
  ) => Promise<string | undefined>;
}

/** Resolve safe Proof reuse, checkpoint reconciliation, then rerun protection. */
export async function resolveDonePreamble(
  root: string,
  options: {
    mode: "strict" | "report";
    declarations: DeclarationRequest;
    rerunRequested: boolean;
    ciRecovery: boolean;
    /** Candidate selection may change the exact tree whose rerun is judged. */
    deferRerunGuard?: boolean;
    signal?: AbortSignal;
  },
  operations: DonePreambleOperations,
): Promise<DonePreamble> {
  const hasDeclarations = options.declarations.met.length > 0 ||
    options.declarations.unmet !== undefined;
  if (
    options.mode === "strict" && !options.rerunRequested && !hasDeclarations
  ) {
    const reused = await operations.reusableGreenProof(root);
    if (reused !== undefined) return { kind: "reuse", result: reused };
  }
  const checkpoints = await operations.resolveCheckpointGate(
    root,
    options.declarations,
    options.mode,
    options.ciRecovery,
    options.signal,
  );
  if (checkpoints.kind === "refuse") return checkpoints;
  if (options.mode === "strict" && !options.deferRerunGuard) {
    const refusal = await operations.unchangedTreeRerunRefusal(
      root,
      options.rerunRequested,
      await operations.gateRunEvidenceIdentity(root, checkpoints.preflight),
    );
    if (refusal !== undefined) return { kind: "refuse", result: refusal };
  }
  return { kind: "proceed", preflight: checkpoints.preflight };
}
