/** Candidate enforcement names the exact expected predecessor, including unlanded pins. */
import type { Candidate } from "../completion/candidate.ts";
import type { CompletionBlocker } from "../completion/protocol.ts";
import type { PlannedStandard } from "../gate/standard_plan.ts";
import { readTrunkConfig, verifyTrunkLimits } from "../gate/standard_limits.ts";
import {
  buildStandardLimitProposalRebindPlan,
  type StandardLimitProposalRebindContext,
} from "../gate/standard_proposal_plan.ts";
import type { StandardLimitProposalData } from "../../shared/result_schemas.ts";
import { sha256Hex } from "../../shared/sha256.ts";
import {
  type CandidateDecisions,
  verifyCandidateDecisions,
} from "./authority.ts";
import type { SourceRevision } from "../completion/identity.ts";
import { sameSource } from "./model.ts";

/** Conservative config identity until the serial cutover supplies its protected-definition projection. */
export async function predecessorPolicyIdentity(
  root: string,
  predecessor: string,
): Promise<string> {
  const read = await readTrunkConfig(root, predecessor);
  if (read.kind === "unreadable" || read.kind === "parse_failed") {
    throw new Error(read.reason);
  }
  return await sha256Hex(read.kind === "absent" ? "absent-config" : read.text);
}

/** Check protected limits and separate decisions against the immutable predecessor commit. */
export async function evaluatePredecessorPolicy(input: {
  readonly root: string;
  readonly candidate: Candidate;
  readonly standards: readonly PlannedStandard[];
  readonly current: CandidateDecisions;
  readonly authorized: CandidateDecisions;
}): Promise<readonly CompletionBlocker[]> {
  const decision = verifyCandidateDecisions(input.current, input.authorized);
  if (decision !== undefined) return [decision];
  const policy = await predecessorPolicyIdentity(
    input.root,
    input.candidate.expected_predecessor.head,
  );
  if (policy !== input.candidate.policy) {
    return [{
      kind: "stale-evidence",
      evidence_ids: [],
      reason: "policy-changed",
    }];
  }
  const proposals = new Map(
    input.current.proposals.filter((proposal) =>
      proposal.bound_commit === input.candidate.head &&
      proposal.trunk_commit === input.candidate.expected_predecessor.head
    ).map((proposal) => [proposal.standard, proposal]),
  );
  if (proposals.size !== input.current.proposals.length) {
    return [{
      kind: "missing-judgment",
      subjects: ["standard-proposal-subject"],
    }];
  }
  const limits = await verifyTrunkLimits(
    input.root,
    input.candidate.expected_predecessor.head,
    [...input.standards],
    proposals,
  );
  return limits.blocking
    ? [{ kind: "validation-failed", evidence_ids: [] }]
    : [];
}

/** Existing renewal rules retain the proposal's measured decision and changed-path evidence. */
export function renewCandidateProposal(
  context: StandardLimitProposalRebindContext,
): StandardLimitProposalData | CompletionBlocker {
  const renewed = buildStandardLimitProposalRebindPlan(context);
  return renewed.ok ? renewed.plan.proposal : {
    kind: "missing-judgment",
    subjects: [
      `standard-proposal:${context.standard.name}:${renewed.message}`,
    ],
  };
}

export interface UnlandedPinRevision {
  readonly source: SourceRevision;
  readonly predecessor: string;
  readonly policy: string;
  readonly standard: string;
  readonly from: number;
  readonly to: number;
  readonly direction: "up" | "down";
}

/** Return an authoring instruction only. It never changes a pin, source, or queue order. */
export function reviseUnlandedPin(
  current: UnlandedPinRevision,
  ownerDecision: UnlandedPinRevision | null,
  landed: boolean,
): CompletionBlocker | {
  readonly kind: "revise-source";
  readonly source: SourceRevision;
  readonly decision: UnlandedPinRevision;
} {
  const exact = ownerDecision !== null &&
    sameSource(current.source, ownerDecision.source) &&
    JSON.stringify(current) === JSON.stringify(ownerDecision);
  if (
    landed || !exact || !Number.isFinite(current.from) ||
    !Number.isFinite(current.to) || current.from === current.to
  ) {
    return {
      kind: "missing-judgment",
      subjects: [`unlanded-pin:${current.standard}`],
    };
  }
  return { kind: "revise-source", source: current.source, decision: current };
}
