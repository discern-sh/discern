/**
 * Pure planning for `discern standards propose`: validate one fresh measured
 * breach and describe the exact config-only commit and proposal record that the
 * executor may create. No Git, filesystem, clock, or subprocess capability
 * enters this module.
 */

import type { ErrorSlug } from "../../shared/result.ts";
import {
  type EnginePlan,
  type PlanStep,
  verbatimStepLabel,
} from "../../shared/result.ts";
import type { StandardLimitProposalData } from "../../shared/result_schemas.ts";
import { validateStandardLimitReason } from "../../shared/standard_limit_reason.ts";
import { pathMatchesPattern } from "../scopes/glob.ts";
import type { PlannedStandard } from "./standard_plan.ts";

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
  "commit"
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
  const inputs = standard.inputs;
  if (inputs === undefined || inputs.length === 0) {
    return {
      ok: false,
      error: "invalid_config",
      message:
        `standard '${standard.name}' declares no inputs, so discern cannot bind its proposed limit to responsible files. Configure [standards.${standard.name}].inputs, commit it on the trunk, update this worktree, and re-measure.`,
    };
  }
  const evidencePaths = [
    ...new Set(
      context.changedPaths.filter((path) =>
        inputs.some((pattern) => pathMatchesPattern(path, pattern))
      ),
    ),
  ].sort();
  if (evidencePaths.length === 0) {
    return {
      ok: false,
      error: "precondition_failed",
      message:
        `standard '${standard.name}' breached, but no changed path matches its configured inputs. A proposal cannot attribute the breach; change the responsible input in this effort or investigate measurement drift.`,
    };
  }
  const proposedLimit = context.measurement;
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
      note:
        `move ${bound} ${context.trunkLimit} → ${proposedLimit} in a config-only commit and record the exact owner decision`,
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
