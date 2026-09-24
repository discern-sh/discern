/** Exact checkpoint and standard decisions shared by landing and queue admission. */
import type { CheckpointDrop } from "../../shared/checkpoint_drops.ts";
import {
  AWAITING_DECLARATION_SLUG,
  AWAITING_VARIANCE_SLUG,
} from "../../shared/declarations.ts";
import { fire, HINTS, hintTexts } from "../../shared/hints.ts";
import type {
  AuthorizedVarianceData,
  StandardLimitApprovalRequestData,
  StandardLimitProposalData,
} from "../../shared/result_schemas.ts";
import { buildStandardPlan } from "../gate/standard_plan.ts";
import {
  cloneStandardLimitProposal,
  inspectActiveStandardLimitProposals,
  sameStandardLimitProposalSet,
} from "../gate/standard_proposal_state.ts";
import type { EffortCheckout, LandingSubject } from "./accept_subject.ts";
import { ACCEPT_NOTHING_LANDED, refusal } from "./accept_support.ts";
import {
  type AcceptanceCheckpointState,
  resolveVarianceInterlock,
  serveUnmetConclusion,
  type StandingUnmetConclusion,
} from "./acceptance_checkpoints.ts";
import {
  resolveStandardApprovals,
  standardApprovalLines,
  standardLimitApprovalRequests,
} from "./standard_approval.ts";

/** A reopened or missing checkpoint declaration routes back to `done`. */
function refuseDeclarationsStale(ids: readonly string[]): never {
  refusal(
    AWAITING_DECLARATION_SLUG,
    `Landing needs a current conclusion for every governing checkpoint, and ${
      ids.length === 1 ? "one is" : `${ids.length} are`
    } missing or no longer current: ${ids.join(", ")}. Run \`discern ` +
      "done` — it serves each question with its evidence and records your " +
      `conclusion — then re-run \`discern accept\`. ${ACCEPT_NOTHING_LANDED}`,
    {
      hints: hintTexts([
        fire(HINTS["accept-declarations-stale"], { ids: [...ids] }),
      ]),
    },
  );
}

/** Serve the owner's one complete variance decision over every unmet checkpoint. */
function refuseAwaitingVariance(
  unmet: readonly StandingUnmetConclusion[],
  missing: readonly string[],
  confirmed: boolean,
): never {
  const ids = unmet.map((entry) => entry.id);
  const decision = confirmed
    ? `The landing decision must also cover every declared-unmet checkpoint; missing: ${
      missing.join(", ")
    }.`
    : `Landing is the owner's decision, and ${
      unmet.length === 1
        ? "one declared-unmet conclusion additionally requires"
        : `${unmet.length} declared-unmet conclusions additionally require`
    } the owner to authorize a variance.`;
  const command = `discern accept --confirmed ${
    ids.map((id) => `--variance ${id}`).join(" ")
  }`;
  refusal(
    AWAITING_VARIANCE_SLUG,
    `${decision}\n\n${
      unmet.map(serveUnmetConclusion).join("\n\n")
    }\n\nRelay each question and rationale to the owner. Once the owner ` +
      `accepts this landing AND each named variance in the current ` +
      `conversation, re-run \`${command}\`. Recorded standing and effort ` +
      `grants never authorize a variance. ${ACCEPT_NOTHING_LANDED}`,
    {
      hints: hintTexts([
        fire(HINTS["accept-authorize-variance"], { ids }),
        fire(HINTS["accept-review-via-status"]),
      ]),
    },
  );
}

/** Resolve the variance interlock, throwing the typed refusal when it stops. */
export function enforceAcceptanceCheckpoints(
  state: AcceptanceCheckpointState,
  request: { confirmed: boolean; varianceIds: readonly string[] },
): AuthorizedVarianceData[] {
  const interlock = resolveVarianceInterlock(state, request);
  switch (interlock.kind) {
    case "declarations-stale":
      return refuseDeclarationsStale(interlock.ids);
    case "invalid-variances":
      return refusal(
        "invalid_value",
        `${interlock.message} ${ACCEPT_NOTHING_LANDED}`,
      );
    case "awaiting":
      return refuseAwaitingVariance(
        interlock.unmet,
        interlock.missing,
        interlock.confirmed,
      );
    case "authorized":
      return interlock.variances;
  }
}

/** Serve the exact standard-limit proposals the owner must approve by token. */
function refuseAwaitingStandardApproval(
  approvals: readonly StandardLimitApprovalRequestData[],
  confirmed: boolean,
  requested: readonly string[],
): never {
  const missing = approvals.filter((approval) =>
    !requested.includes(approval.token)
  );
  const detail = standardApprovalLines(approvals);
  const command = `discern accept --confirmed ${
    approvals.map(({ token }) => `--approve-standard ${token}`).join(" ")
  }`;
  const opening = confirmed
    ? `The owner approval set is incomplete; missing: ${
      missing.map(({ proposal }) => proposal.standard).join(", ")
    }.`
    : "This Proof contains a standard limit proposal that requires a separate, exact owner decision.";
  refusal(
    "awaiting_standard_approval",
    `${opening}\n\n${detail}\n\nRelay every value and reason to the owner. ` +
      `Only after they approve these exact tuples, re-run \`${command}\`. ` +
      `If they decline, leave acceptance stopped, restore the trunk limit in ` +
      `this branch, and run \`discern done\` under ordinary enforcement. ` +
      `Standing grants, effort grants, generic landing consent, prior variances, ` +
      `and earlier standard approvals never cover this decision. ${ACCEPT_NOTHING_LANDED}`,
    {
      hints: hintTexts([fire(HINTS["accept-review-via-status"])]),
      data: {
        standard_approvals_required: approvals.map(({ proposal, token }) => ({
          proposal: cloneStandardLimitProposal(proposal),
          token,
        })),
      },
    },
  );
}

/** Resolve the current proposal authority and enforce the narrow approval set. */
export async function enforceStandardLimitApprovals(
  effort: EffortCheckout,
  subject: LandingSubject,
  request: { readonly confirmed: boolean; readonly names: readonly string[] },
): Promise<StandardLimitProposalData[]> {
  const proofProposals = [...(subject.proof.standard_proposals ?? [])].sort((
    left,
    right,
  ) => left.standard.localeCompare(right.standard));
  if (subject.atHead) {
    const inspected = await inspectActiveStandardLimitProposals(
      effort.path,
      effort.trunk,
      buildStandardPlan(effort.ctx.config).standards,
    );
    const active = [...inspected.active.values()].sort((left, right) =>
      left.standard.localeCompare(right.standard)
    );
    if (!sameStandardLimitProposalSet(proofProposals, active)) {
      refusal(
        "proposal_stale",
        "The standard limit proposal record no longer matches the honored Proof. A reason change, revocation, or stale record restores ordinary enforcement. Run `discern done` to revalidate the current exact proposal; nothing has been landed.",
      );
    }
  }
  const approvals = await standardLimitApprovalRequests(proofProposals);
  const resolution = resolveStandardApprovals(approvals, request);
  switch (resolution.kind) {
    case "invalid":
      return refusal(
        "invalid_value",
        `${resolution.message} ${ACCEPT_NOTHING_LANDED}`,
      );
    case "awaiting":
      return refuseAwaitingStandardApproval(
        approvals,
        request.confirmed,
        request.names,
      );
    case "approved":
      return resolution.proposals;
  }
}

/** Refuse an acceptance whose declaration binding cannot be read. */
export function refuseUnreadableDeclarationEvidence(
  drops: readonly CheckpointDrop[],
): void {
  if (
    !drops.some((drop) => drop.reason === "declaration_evidence_unavailable")
  ) {
    return;
  }
  refusal(
    "checkpoint_evidence_unavailable",
    "Acceptance cannot read the checkpoint declaration evidence that the validated Proof must bind to. Nothing was landed and the worktree is intact. Restore the declaration store, run `discern done --rerun`, then retry acceptance.",
    { data: { checkpoint_drops: [...drops] } },
  );
}
