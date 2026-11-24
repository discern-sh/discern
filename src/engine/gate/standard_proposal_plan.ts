/**
 * Pure planning for `discern standards propose`: validate one targeted measured
 * breach and describe either its initial config-only commit or an unchanged
 * proposal's renewable descendant binding. No Git, filesystem, clock, or
 * subprocess capability enters this module.
 */

import type { ErrorSlug } from "../../shared/result.ts";
import {
  type EnginePlan,
  type PlanStep,
  verbatimStepLabel,
} from "../../shared/result.ts";
import type { StandardLimitProposalData } from "../../shared/result_schemas.ts";
import { validateStandardLimitReason } from "../../shared/standard_limit_reason.ts";
import { standardLimitProposalMargin } from "../../shared/standard_limit_proposal_text.ts";
import { pathMatchesPattern } from "../scopes/glob.ts";
import {
  type PlannedStandard,
  proposedStandardLimit,
} from "./standard_plan.ts";

/** Read-only facts gathered by the effectful shell before pure planning. */
export interface StandardLimitProposalContext {
  readonly standard: PlannedStandard;
  readonly reason: string;
  readonly head: string;
  readonly definitionFingerprint: string;
  readonly trunk: string;
  readonly trunkCommit: string;
  readonly trunkLimit: number;
  readonly measurement: number;
  readonly changedPaths: readonly string[];
}

/** Record fields known before the config-only proposal commit is made. */
export type PlannedStandardLimitProposal = Omit<
  StandardLimitProposalData,
  "commit" | "bound_commit"
>;

export interface StandardLimitProposalPlan {
  readonly engine: EnginePlan;
  readonly proposal: PlannedStandardLimitProposal;
}

export interface StandardLimitProposalRefusal {
  readonly ok: false;
  readonly error: ErrorSlug;
  readonly message: string;
}

export type StandardLimitProposalDecision =
  | { readonly ok: true; readonly plan: StandardLimitProposalPlan }
  | StandardLimitProposalRefusal;

/** Read-only facts gathered before renewing an unchanged proposal on a later
 * descendant. Git ancestry and the immutable origin-commit shape are observed
 * outside the pure planner; every tuple comparison remains here. */
export interface StandardLimitProposalRebindContext {
  readonly standard: PlannedStandard;
  readonly proposal: StandardLimitProposalData;
  readonly reason: string;
  readonly head: string;
  readonly definitionFingerprint: string;
  readonly trunk: string;
  readonly trunkCommit: string;
  readonly trunkLimit: number;
  readonly measurement: number;
  readonly changedPaths: readonly string[];
  readonly originIsAncestor: boolean;
  readonly trunkIsContained: boolean;
  readonly originShapeError?: string;
}

export interface StandardLimitProposalRebindPlan {
  readonly engine: EnginePlan;
  readonly proposal: StandardLimitProposalData;
}

export type StandardLimitProposalRebindDecision =
  | { readonly ok: true; readonly plan: StandardLimitProposalRebindPlan }
  | StandardLimitProposalRefusal;

/** Whether the measured value regresses against the trunk
 * bound, using the same epsilon as ordinary Standard comparison. */
function breached(
  direction: "up" | "down",
  measurement: number,
  limit: number,
): boolean {
  return direction === "up"
    ? measurement + 1e-9 < limit
    : measurement - 1e-9 > limit;
}

/** How a proposal's limit follows from a measurement: the measured value
 * alone, or with the margin it keeps as headroom named beside it. */
function measuredBasis(measurement: number, margin: number): string {
  return margin > 0
    ? `measured ${measurement} with margin ${margin} kept as headroom`
    : `measured ${measurement}`;
}

/** The limit a breach of this standard would propose, stated before any
 * measurement exists: the measured value, moved by its margin when it has one. */
export function proposedLimitRule(
  standard: Pick<PlannedStandard, "direction" | "margin">,
): string {
  if (standard.margin <= 0) return "the measured value";
  return standard.direction === "up"
    ? `the measured value less its margin ${standard.margin}`
    : `the measured value plus its margin ${standard.margin}`;
}

/** Whether a recorded proposal's limit still follows from its own figures
 * under the standard as configured now: the same margin, and the limit that
 * margin gives the recorded measurement. The one integrity rule that staleness
 * and renewal both apply. */
export function proposalFiguresHold(
  proposal: Pick<
    StandardLimitProposalData,
    "direction" | "measurement" | "margin" | "proposed_limit"
  >,
  standard: Pick<PlannedStandard, "margin">,
): boolean {
  return standardLimitProposalMargin(proposal) === standard.margin &&
    proposal.proposed_limit ===
      proposedStandardLimit(
        proposal.direction,
        proposal.measurement,
        standard.margin,
      );
}

/** Changed input paths that can account for one proposal measurement. */
function responsiblePaths(
  standard: PlannedStandard,
  changedPaths: readonly string[],
): string[] | undefined {
  const inputs = standard.inputs;
  if (inputs === undefined || inputs.length === 0) {
    return undefined;
  }
  return [
    ...new Set(
      changedPaths.filter((path) =>
        inputs.some((pattern) => pathMatchesPattern(path, pattern))
      ),
    ),
  ].sort();
}

/** Build the exact transaction, or explain why ordinary enforcement still
 * applies. A proposal is only meaningful before its branch limit has moved. */
export function buildStandardLimitProposalPlan(
  context: StandardLimitProposalContext,
): StandardLimitProposalDecision {
  const reason = validateStandardLimitReason(context.reason);
  if (!reason.ok) {
    return { ok: false, error: "invalid_value", message: reason.message };
  }
  const standard = context.standard;
  if (!Number.isFinite(context.measurement)) {
    return {
      ok: false,
      error: "precondition_failed",
      message:
        `standard '${standard.name}' has no finite fresh measurement on ${context.head}. Run \`discern standards\`, fix any measurement failure, then retry.`,
    };
  }
  if (standard.limit !== context.trunkLimit) {
    return {
      ok: false,
      error: "precondition_failed",
      message:
        `standard '${standard.name}' already changes its limit (${context.trunkLimit} on ${context.trunk}, ${standard.limit} here) without a live proposal. Restore the trunk limit, re-measure the breach, then propose it.`,
    };
  }
  if (!breached(standard.direction, context.measurement, context.trunkLimit)) {
    return {
      ok: false,
      error: "precondition_failed",
      message:
        `standard '${standard.name}' measured ${context.measurement}, which does not breach its ${
          standard.direction === "up" ? "floor" : "ceiling"
        } ${context.trunkLimit}. Improvements and held values use ordinary enforcement; there is no new limit to propose.`,
    };
  }
  const evidencePaths = responsiblePaths(standard, context.changedPaths);
  if (evidencePaths === undefined) {
    return {
      ok: false,
      error: "invalid_config",
      message:
        `standard '${standard.name}' declares no inputs, so discern cannot bind its proposed limit to responsible files. Configure [standards.${standard.name}].inputs, commit it on the trunk, update this worktree, and re-measure.`,
    };
  }
  if (evidencePaths.length === 0) {
    return {
      ok: false,
      error: "precondition_failed",
      message:
        `standard '${standard.name}' breached, but no changed path matches its configured inputs. A proposal cannot attribute the breach; change the responsible input in this effort or investigate measurement drift.`,
    };
  }
  const proposedLimit = proposedStandardLimit(
    standard.direction,
    context.measurement,
    standard.margin,
  );
  const proposal: PlannedStandardLimitProposal = {
    standard: standard.name,
    measured_commit: context.head,
    definition_fingerprint: context.definitionFingerprint,
    trunk: context.trunk,
    trunk_commit: context.trunkCommit,
    direction: standard.direction,
    trunk_limit: context.trunkLimit,
    proposed_limit: proposedLimit,
    measurement: context.measurement,
    ...(standard.margin > 0 ? { margin: standard.margin } : {}),
    delta: proposedLimit - context.trunkLimit,
    reason: reason.reason,
    evidence_paths: evidencePaths,
  };
  const bound = standard.direction === "up" ? "floor" : "ceiling";
  const steps: PlanStep[] = [
    {
      kind: "standard",
      label: verbatimStepLabel(standard.name),
      disposition: "gate",
      note:
        `bind measured ${context.measurement} and ${evidencePaths.length} responsible path(s) to ${
          context.head.slice(0, 12)
        }`,
    },
    {
      kind: "git",
      label: verbatimStepLabel(`propose-${standard.name}`),
      disposition: "run",
      note: `move ${bound} ${context.trunkLimit} → ${proposedLimit} (${
        measuredBasis(context.measurement, standard.margin)
      }) in a config-only commit and record the exact owner decision`,
    },
  ];
  return {
    ok: true,
    plan: {
      engine: {
        title: "Standard limit proposal",
        details: [
          `standard: ${standard.name}`,
          `trunk: ${context.trunk}@${context.trunkCommit.slice(0, 12)}`,
          `reason: ${reason.reason}`,
        ],
        steps,
      },
      proposal,
    },
  };
}

/** Renew only the evidence binding of an otherwise unchanged proposal. The
 * immutable config-only proposal commit and its measured parent remain fixed;
 * the current descendant, equivalent trunk baseline, and responsible paths
 * become the new live binding. */
export function buildStandardLimitProposalRebindPlan(
  context: StandardLimitProposalRebindContext,
): StandardLimitProposalRebindDecision {
  const reason = validateStandardLimitReason(context.reason);
  if (!reason.ok) {
    return { ok: false, error: "invalid_value", message: reason.message };
  }
  const { proposal, standard } = context;
  const restore =
    `Restore the ${context.trunk} limit ${proposal.trunk_limit}, commit the final tree, then run \`discern standards propose ${standard.name} --reason "…"\` once to create a new proposal.`;
  // What a replacement proposal would record, so the owner is asked about the
  // limit that would land and not only the reading behind it.
  const freshLimit = proposedStandardLimit(
    standard.direction,
    context.measurement,
    standard.margin,
  );
  const freshDecision = `Present the new limit ${freshLimit} (${
    measuredBasis(context.measurement, standard.margin)
  }), delta ${
    freshLimit - proposal.trunk_limit
  }, and technical reason "${reason.reason}" to the owner and obtain fresh agreement before recording a replacement proposal.`;
  if (context.originShapeError !== undefined) {
    return {
      ok: false,
      error: "proposal_stale",
      message:
        `standard '${standard.name}' cannot renew its proposed limit because ${context.originShapeError}. ${restore}`,
    };
  }
  if (!context.originIsAncestor) {
    return {
      ok: false,
      error: "proposal_stale",
      message:
        `standard '${standard.name}' cannot renew its proposed limit because the original proposal commit is not an ancestor of current HEAD. ${restore}`,
    };
  }
  if (!context.trunkIsContained) {
    return {
      ok: false,
      error: "proposal_stale",
      message:
        `standard '${standard.name}' cannot renew its proposed limit while current HEAD is behind ${context.trunk}. Run \`discern update\`, resolve and commit the final tree, then retry the same proposal command.`,
    };
  }
  if (
    proposal.standard !== standard.name || proposal.trunk !== context.trunk ||
    proposal.direction !== standard.direction ||
    proposal.trunk_limit !== context.trunkLimit ||
    proposal.proposed_limit !== standard.limit ||
    !proposalFiguresHold(proposal, standard) ||
    proposal.definition_fingerprint !== context.definitionFingerprint ||
    proposal.reason !== reason.reason ||
    proposal.delta !== proposal.proposed_limit - proposal.trunk_limit
  ) {
    return {
      ok: false,
      error: "proposal_stale",
      message:
        `standard '${standard.name}' changed its proposal tuple, definition, reason, or trunk baseline. An evidence renewal cannot authorize a different decision. ${freshDecision} ${restore}`,
    };
  }
  // The recorded limit already follows from the recorded measurement and
  // margin, so an unchanged reading is the whole renewal condition.
  if (context.measurement !== proposal.measurement) {
    return {
      ok: false,
      error: "proposal_stale",
      message:
        `standard '${standard.name}' now measures ${context.measurement}; the recorded proposal measured ${proposal.measurement} for its limit ${proposal.proposed_limit}. An evidence renewal cannot change the proposed value. ${freshDecision} ${restore}`,
    };
  }
  const evidencePaths = responsiblePaths(standard, context.changedPaths);
  if (evidencePaths === undefined) {
    return {
      ok: false,
      error: "invalid_config",
      message:
        `standard '${standard.name}' declares no inputs, so discern cannot renew the proposal's responsible paths. ${restore}`,
    };
  }
  if (evidencePaths.length === 0) {
    return {
      ok: false,
      error: "proposal_stale",
      message:
        `standard '${standard.name}' still measures ${context.measurement}, but no current changed path matches its configured inputs. The proposal can no longer attribute the breach. ${restore}`,
    };
  }
  const rebound: StandardLimitProposalData = {
    ...proposal,
    bound_commit: context.head,
    trunk_commit: context.trunkCommit,
    evidence_paths: evidencePaths,
  };
  return {
    ok: true,
    plan: {
      engine: {
        title: "Standard limit proposal renewal",
        details: [
          `standard: ${standard.name}`,
          `trunk: ${context.trunk}@${context.trunkCommit.slice(0, 12)}`,
          `reason: ${reason.reason}`,
        ],
        steps: [
          {
            kind: "standard",
            label: verbatimStepLabel(standard.name),
            disposition: "gate",
            note:
              `measured the unchanged value ${context.measurement} on descendant ${
                context.head.slice(0, 12)
              }`,
          },
          {
            kind: "standard",
            label: verbatimStepLabel(`rebind-${standard.name}`),
            disposition: "run",
            note:
              `renew the binding with ${evidencePaths.length} responsible path(s) without changing Git history`,
          },
        ],
      },
      proposal: rebound,
    },
  };
}
