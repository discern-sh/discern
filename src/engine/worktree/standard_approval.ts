import { sha256Hex } from "../../shared/sha256.ts";
import type {
  StandardLimitApprovalRequestData,
  StandardLimitProposalData,
} from "../../shared/result_schemas.ts";
import { cloneStandardLimitProposal } from "../gate/standard_proposal_state.ts";
/** Exact owner-facing approval challenge for the tuple the public contract
 * names. The full proposal is recorded in the transaction; this token makes a
 * copied approval command stale when its value or reason changes. */
async function standardLimitApprovalToken(
  proposal: StandardLimitProposalData,
): Promise<string> {
  const material = JSON.stringify({
    standard: proposal.standard,
    proposed_limit: proposal.proposed_limit,
    reason: proposal.reason,
  });
  return await sha256Hex(`standard-limit-approval-v1\n${material}`);
}

/** Derive one exact token challenge per current proposal. */
export async function standardLimitApprovalRequests(
  proposals: readonly StandardLimitProposalData[],
): Promise<StandardLimitApprovalRequestData[]> {
  return await Promise.all(proposals.map(async (proposal) => ({
    proposal: cloneStandardLimitProposal(proposal),
    token: await standardLimitApprovalToken(proposal),
  })));
}
