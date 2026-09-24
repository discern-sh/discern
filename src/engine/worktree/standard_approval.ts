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

/** How the owner's approval tokens resolved against the exact proposal set. */
export type StandardApprovalResolution =
  | { readonly kind: "invalid"; readonly message: string }
  | { readonly kind: "awaiting" }
  | {
    readonly kind: "approved";
    readonly proposals: StandardLimitProposalData[];
  };

/** Decide an approval set (pure). The tokens must equal the challenge set
 * exactly: a duplicate or unknown token is an error, and a missing token or
 * an unconfirmed decision leaves the proposals awaiting the owner. */
export function resolveStandardApprovals(
  approvals: readonly StandardLimitApprovalRequestData[],
  request: { readonly confirmed: boolean; readonly names: readonly string[] },
): StandardApprovalResolution {
  const current = approvals.map(({ proposal }) => proposal.standard).join(
    ", ",
  ) || "(none)";
  const requested = [...new Set(request.names)].sort();
  if (requested.length !== request.names.length) {
    return {
      kind: "invalid",
      message:
        `Duplicate --approve-standard tokens are not an exact approval set. Expected proposals: ${current}.`,
    };
  }
  const expected = approvals.map(({ token }) => token);
  const extras = requested.filter((token) => !expected.includes(token));
  if (extras.length > 0) {
    return {
      kind: "invalid",
      message:
        `--approve-standard contains a token for no current exact proposal: ${
          extras.join(", ")
        }. Current proposals: ${current}.`,
    };
  }
  if (approvals.length === 0) return { kind: "approved", proposals: [] };
  if (
    !request.confirmed || expected.some((token) => !requested.includes(token))
  ) {
    return { kind: "awaiting" };
  }
  return {
    kind: "approved",
    proposals: approvals.map(({ proposal }) =>
      cloneStandardLimitProposal(proposal)
    ),
  };
}

/** Each proposal as the owner reviews it, with its approval token. */
export function standardApprovalLines(
  approvals: readonly StandardLimitApprovalRequestData[],
): string {
  return approvals.map(({ proposal, token }) =>
    `${proposal.standard}: ${proposal.trunk_limit} → ${proposal.proposed_limit} ` +
    `(measured ${proposal.measurement}; delta ${
      proposal.delta >= 0 ? "+" : ""
    }${proposal.delta})\n` +
    `  Reason: ${proposal.reason}\n` +
    `  Responsible paths: ${proposal.evidence_paths.join(", ")}\n` +
    `  Approval token: ${token}`
  ).join("\n\n");
}
