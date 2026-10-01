/**
 * The owner-facing approval token for one standard limit proposal. A leaf so
 * any surface that hands the owner an approval command (acceptance refusals,
 * status, the Desk) derives the same token without the gate's module graph.
 */

import { sha256Hex } from "./sha256.ts";
import type { StandardLimitProposalData } from "./result_schemas.ts";

/** Exact owner-facing approval challenge for the tuple the public contract
 * names. The full proposal is recorded in the transaction; this token makes a
 * copied approval command stale when its value or reason changes. */
export async function standardLimitApprovalToken(
  proposal: StandardLimitProposalData,
): Promise<string> {
  const material = JSON.stringify({
    standard: proposal.standard,
    proposed_limit: proposal.proposed_limit,
    reason: proposal.reason,
  });
  return await sha256Hex(`standard-limit-approval-v1\n${material}`);
}
