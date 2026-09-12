/** Reuse the canonical Proof when it completely proves this exact clean tree. */
import type { DiscernResult } from "../../shared/result.ts";
import type {
  GateData,
  StandardLimitProposalData,
} from "../../shared/result_schemas.ts";
import { runGit } from "../../shared/subprocess.ts";
import { candidatePredecessor } from "../completion/candidate.ts";
import { gateProofHasCompleteEvidence, inspectGateProof } from "./proof.ts";
import { isIndeterminateStopDrop } from "../../shared/checkpoint_drops.ts";
import { inspectResolvedTrunkMerged } from "../worktree/git.ts";
import { sameStandardLimitProposalSet } from "./standard_proposal_state.ts";

/**
 * Reuse the canonical Proof only when it completely proves this exact clean
 * HEAD. This check runs before checkpoint reconciliation, so the optimization
 * cannot mutate conclusions, run fixers, measure Standards, or invoke a
 * configured job. An incomplete marker is a cache miss, never success.
 *
 * Reuse also requires the Proof's recorded predecessor to BE the trunk's
 * current tip — the exact equality acceptance requires — because ancestry
 * alone is not enough: a trunk fast-forwarded to a commit this branch already
 * contains leaves the branch merged while the Proof names a predecessor the
 * trunk no longer tips, and a reused "green" would then be unlandable. A
 * moved trunk is a cache miss, so the ordinary run re-proves against it.
 */
export async function reusableGreenProof(
  root: string,
  proposalStateFor: (root: string) => Promise<
    {
      readonly trunk: string;
      readonly proposals: StandardLimitProposalData[];
    } | undefined
  >,
): Promise<DiscernResult<GateData> | undefined> {
  const proof = await inspectGateProof(root);
  if (
    !gateProofHasCompleteEvidence(proof) ||
    proof.checkpoint_drops?.some((drop) =>
        drop.reason === "declaration_evidence_unavailable" ||
        drop.reason === "strand_check_unavailable" ||
        isIndeterminateStopDrop(drop)
      ) === true
  ) {
    return undefined;
  }
  const proposalState = await proposalStateFor(root);
  if (proposalState === undefined) return undefined;
  const merged = await inspectResolvedTrunkMerged(root, proposalState.trunk);
  if (
    merged.kind === "behind" || merged.kind === "missing" ||
    merged.kind === "unavailable"
  ) {
    return undefined;
  }
  const completion = proof.proof_data.completion;
  if (completion === undefined) return undefined;
  const tip = await runGit(
    ["rev-parse", "--verify", `refs/heads/${proposalState.trunk}^{commit}`],
    { cwd: root },
  );
  if (
    !tip.success ||
    tip.stdout.trim() !== candidatePredecessor(completion.candidate)
  ) {
    return undefined;
  }
  if (
    !sameStandardLimitProposalSet(
      proof.proof_data.standard_proposals ?? [],
      proposalState.proposals,
    )
  ) {
    return undefined;
  }
  return {
    ok: true,
    verb: "done",
    message: "Current green Proof covers this exact tree; no gate job ran.",
    data: {
      gate_ran: false,
      failed_stage: null,
      scopes_changed: [],
      proof: proof.proof_data,
    },
  };
}
