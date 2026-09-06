import { classifyScopeImpact, type ScopeImpact } from "../scopes/scopes.ts";
/** Public acceptance composes canonical candidate, judgment, authority and environment readers. */
import type {
  CompletionBlocker,
  CompletionObservation,
} from "../completion/protocol.ts";
import type { CompletionRecord } from "../completion/records.ts";
import type { SourceRevision } from "../completion/identity.ts";
import type { CandidateAssessment } from "./planner.ts";
import { assessQueueCandidate, predecessorChain } from "./assessment.ts";
import { observedRecords } from "./repository.ts";
import { observeSourceGrant } from "./public_authority.ts";
import { observeCandidateValidation } from "../validation/candidate_observation.ts";
import {
  assessCandidateReview,
  type CandidateReview,
  readCandidateReview,
} from "../gate/candidate_review.ts";
import {
  inspectAcceptanceCheckpoints,
  resolveVarianceInterlock,
  varianceBinding,
} from "../worktree/acceptance_checkpoints.ts";
import { standardLimitApprovalRequests } from "../worktree/standard_approval.ts";
import { planEnvironment } from "../execution/registry.ts";
import { declarationIdentity } from "../execution/subjects.ts";
import { sameSource } from "./model.ts";
import { evidenceIdentityOf } from "../checkpoints/evidence.ts";
import { readOpenQuestions } from "../checkpoints/open_questions.ts";
import {
  inspectActiveStandardLimitProposals,
  sameStandardLimitProposalSet,
} from "../gate/standard_proposal_state.ts";
import type { CandidateDecisions } from "./authority.ts";
import type { StandardLimitApprovalRequestData } from "../../shared/result_schemas.ts";

export interface PublicCandidateAssessment {
  readonly assessment: CandidateAssessment;
  readonly review?: CandidateReview;
  readonly preview_actions: ScopeImpact["previewActions"];
  readonly approval_requests: readonly StandardLimitApprovalRequestData[];
}
export interface CandidateDecisionRequest {
  readonly source?: SourceRevision;
  readonly confirmed: boolean;
  readonly variance: readonly string[];
  readonly approveStandard: readonly string[];
}

/** No reading in this adapter executes a producer, grants consent or publishes queue state. */
export async function assessPublicCandidate(input: {
  readonly root: string;
  readonly trunk: string;
  readonly observation: CompletionObservation;
  readonly candidate: Extract<CompletionRecord, { kind: "candidate" }>;
  readonly context: string;
  readonly request: CandidateDecisionRequest;
}): Promise<PublicCandidateAssessment> {
  const { root, observation, candidate: record } = input;
  const candidate = record.data;
  const records = observedRecords(observation);
  const validation = await observeCandidateValidation({
    root,
    candidate_id: record.id,
    candidate,
    observation,
    context: input.context,
  });
  const requested = input.request.source !== undefined &&
    sameSource(input.request.source, candidate.source);
  const confirmed = requested && input.request.confirmed;
  const predecessors = predecessorChain(candidate, records);
  const authority = records.find((item) => item.kind === "queue")?.data.entries
    .find((entry) => entry.candidate_id === record.id)?.authority_id;
  const ownAuthority = records.find((item) =>
    item.kind === "authority" && item.id === authority
  );
  const subjects = [
    {
      candidate,
      authority: ownAuthority?.kind === "authority"
        ? ownAuthority.data
        : undefined,
    },
    ...predecessors.chain.map((item) => ({
      candidate: item.candidate,
      authority: item.authority.data,
    })),
  ];
  const grants = [];
  let sourcePath: string | undefined;
  for (const subject of subjects) {
    const grant = await observeSourceGrant(
      root,
      input.trunk,
      subject.candidate.source,
      subject.candidate.policy,
      subject.authority,
      confirmed ? input.request.source : undefined,
    );
    if (grant === undefined) continue;
    grants.push(grant.facts);
    if (sameSource(subject.candidate.source, candidate.source)) {
      sourcePath = grant.path;
    }
  }
  const proof = records.filter((
    item,
  ): item is Extract<CompletionRecord, { kind: "proof" }> =>
    item.kind === "proof" && item.data.candidate_id === record.id &&
    item.data.mode === "strict"
  ).sort((a, b) => b.data.assembled_at - a.data.assembled_at)[0];
  let review: CandidateReview | undefined;
  let current: CandidateDecisions = {
    judgments: [],
    variances: [],
    proposals: [],
  };
  let authorized: CandidateDecisions = {
    judgments: [],
    variances: [],
    proposals: [],
  };
  const blockers: CompletionBlocker[] = [];
  let approvals: StandardLimitApprovalRequestData[] = [];
  if (proof !== undefined) {
    try {
      review = await readCandidateReview(root, candidate, proof.data);
    } catch (error) {
      blockers.push({
        kind: "missing-judgment",
        subjects: [error instanceof Error ? error.message : String(error)],
      });
    }
  } else {blockers.push({
      kind: "missing-evidence",
      requirements: validation.snapshot.requirements,
    });}
  if (review !== undefined) {
    const judged = await assessCandidateReview(
      root,
      validation.config,
      candidate,
      review,
    );
    blockers.push(...judged.blockers);
    const state = await inspectAcceptanceCheckpoints(root, validation.config, {
      predecessor: candidate.expected_predecessor.head,
      stored: review.stored,
    });
    const decision = resolveVarianceInterlock(state, {
      confirmed,
      varianceIds: requested ? input.request.variance : [],
    });
    current = {
      ...judged.decisions,
      variances: state.unmet.map(varianceBinding),
    };
    authorized = {
      ...judged.decisions,
      variances: decision.kind === "authorized" ? decision.variances : [],
      proposals: [],
    };
    if (decision.kind !== "authorized") {
      blockers.push({
        kind: "missing-judgment",
        subjects: decision.kind === "awaiting"
          ? decision.unmet.map((item) => `variance:${item.id}`)
          : [decision.kind],
      });
    }
    approvals = await standardLimitApprovalRequests(review.proposals);
    const tokens = requested ? input.request.approveStandard : [];
    if (
      (approvals.length === 0 || confirmed) &&
      approvals.length === tokens.length &&
      new Set(tokens).size === tokens.length && approvals.every((item) =>
        tokens.includes(item.token)
      )
    ) authorized = { ...authorized, proposals: review.proposals };
    else {blockers.push({
        kind: "missing-judgment",
        subjects: approvals.map((item) =>
          `standard-proposal:${item.proposal.standard}`
        ),
      });}
    if (sourcePath === undefined && review.proposals.length > 0) {
      blockers.push({
        kind: "missing-judgment",
        subjects: ["standard-proposal-store-unavailable"],
      });
    }
    if (sourcePath !== undefined) {
      const proposals = await inspectActiveStandardLimitProposals(
        sourcePath,
        input.trunk,
        validation.standards,
        {
          config: validation.config,
          head: candidate.head,
          predecessor: candidate.expected_predecessor.head,
        },
      );
      if (
        !sameStandardLimitProposalSet(review.proposals, [
          ...proposals.active.values(),
        ])
      ) {
        blockers.push({
          kind: "missing-judgment",
          subjects: ["standard-proposal-changed"],
        });
      }
      const live = await readOpenQuestions(sourcePath);
      if (review.stored.status === "ok" || review.stored.status === "missing") {
        if (
          (live.status !== "ok" && live.status !== "missing") ||
          await evidenceIdentityOf(
              live.status === "ok" ? live.openQuestions : {},
            ) !== await evidenceIdentityOf(
              review.stored.status === "ok" ? review.stored.openQuestions : {},
            )
        ) {
          blockers.push({
            kind: "missing-judgment",
            subjects: ["checkpoint-declaration-changed"],
          });
        }
      }
    }
  }
  const declaration = validation.config.execution[input.context] ??
    (candidate.head === candidate.source.head ? null : undefined);
  const declarationId = declaration === undefined
    ? undefined
    : await declarationIdentity(declaration);
  const environment = records.find((item) =>
    item.kind === "environment" && item.data.declaration === declarationId &&
    item.data.ownership.kind === "borrowed" &&
    sameSource(item.data.ownership.source, candidate.source) &&
    item.data.state.kind !== "disposed"
  );
  const assessment = await assessQueueCandidate({
    root,
    observation,
    ...(proof === undefined ? {} : { proof_id: proof.id }),
    candidate_id: record.id,
    recipe: validation.recipe,
    grants,
    current_decisions: current,
    authorized_decisions: authorized,
    judgment_blockers: blockers,
    standards: validation.standards,
    config: validation.config,
    evaluator: validation.evaluator,
    demand: validation.demand,
    environment: {
      plan: (observation, plan) =>
        environment?.kind === "environment" && declaration !== undefined
          ? planEnvironment(environment.id, declaration, observation, plan)
          : {
            kind: "environment-unavailable",
            reason:
              "No declared, released environment can validate this candidate.",
          },
    },
  });
  return {
    assessment,
    ...(review === undefined ? {} : { review }),
    approval_requests: approvals,
    preview_actions: (await classifyScopeImpact(
      root,
      validation.config,
      candidate.expected_predecessor.head,
      candidate.head,
    )).previewActions,
  };
}
