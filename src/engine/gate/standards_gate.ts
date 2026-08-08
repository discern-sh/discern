/**
 * The gate-specific side of `[standards]`: decide whether each standard is
 * measured, replayed from a receipt, or deferred, then project those decisions
 * into the shared measurement jobs. Tier-1 trunk verification and measurement
 * execution are shared with the standalone verb; this module owns only the
 * gate's replay/defer policy.
 */

import type { GateStandard } from "../../shared/result_schemas.ts";
import { runGit } from "../../shared/subprocess.ts";
import { pathMatchesPattern } from "../scopes/glob.ts";
import { collectPaths } from "../scopes/scopes.ts";
import { measurementBaselines } from "./proof.ts";
import type { PlannedJob } from "./plan.ts";
import type { PlannedStandard } from "./standard_plan.ts";
import {
  plannedStandardJob,
  type ResolvedStandard,
  type StandardAction,
  type StandardJobs,
} from "./standards.ts";

/** Compatibility name for the gate-facing view of the shared standard jobs. */
export type GateStandardJobs = StandardJobs;

// Preserve the established module surface while the implementations live at
// the shared seams both gate and standalone execution consume.
export {
  buildStandardJobs as buildGateStandardJobs,
  plannedStandardJob,
} from "./standards.ts";
export type { ResolvedStandard, StandardAction } from "./standards.ts";
export { standardJobLabel } from "./standard_plan.ts";
export {
  type TrunkLimitsVerification,
  verifyTrunkLimits,
} from "./standard_limits.ts";

/** Whether `sha` is an ancestor of (or equal to) HEAD at `root`. */
async function isAncestorOfHead(root: string, sha: string): Promise<boolean> {
  const result = await runGit(["merge-base", "--is-ancestor", sha, "HEAD"], {
    cwd: root,
  });
  return result.success;
}

/**
 * The config-only resolution — measure or defer, never replay — for callers
 * that must stay I/O-free: the dry-run plan and doctor's execution model.
 */
export function resolveStandardActionsFromConfig(
  standards: PlannedStandard[],
): ResolvedStandard[] {
  return standards.map((standard) => ({
    standard,
    action: standard.gateMeasure
      ? { kind: "measure" as const }
      : { kind: "defer" as const },
  }));
}

/**
 * Resolve each standard's gate action from the tree. Deferred standards remain
 * on demand; an input-keyed receipt replays only when every path changed since
 * that receipt falls outside the standard's declared inputs; every other
 * standard measures. This runs after the fix stage so fixer edits count.
 */
export async function resolveStandardActions(
  root: string,
  standards: PlannedStandard[],
): Promise<ResolvedStandard[]> {
  const replayable = standards.filter(
    (standard) =>
      standard.gateMeasure && standard.inputs !== undefined &&
      standard.inputs.length > 0,
  );
  const baselines = replayable.length > 0 ? await usableBaselines(root) : [];
  const changedSince = new Map<string, string[] | null>();
  const changedPaths = async (sha: string): Promise<string[] | null> => {
    let paths = changedSince.get(sha);
    if (paths === undefined) {
      paths = await collectPaths(root, sha);
      changedSince.set(sha, paths);
    }
    return paths;
  };

  const resolved: ResolvedStandard[] = [];
  for (const standard of standards) {
    if (!standard.gateMeasure) {
      resolved.push({ standard, action: { kind: "defer" } });
      continue;
    }
    const inputs = standard.inputs;
    if (inputs === undefined || inputs.length === 0) {
      resolved.push({ standard, action: { kind: "measure" } });
      continue;
    }
    let action: StandardAction = { kind: "measure" };
    for (const baseline of baselines) {
      const value = baseline.values[standard.name];
      if (value === undefined) {
        continue;
      }
      const paths = await changedPaths(baseline.head);
      if (paths === null || paths.some((path) => inputsMatch(inputs, path))) {
        continue;
      }
      action = { kind: "replay", value, from: baseline.head };
      break;
    }
    resolved.push({ standard, action });
  }
  return resolved;
}

/** Recorded baselines usable from this tree, nearest first. */
async function usableBaselines(
  root: string,
): Promise<{ head: string; values: Record<string, number> }[]> {
  const baselines: { head: string; values: Record<string, number> }[] = [];
  for (const baseline of await measurementBaselines(root)) {
    if (await isAncestorOfHead(root, baseline.head)) {
      baselines.push(baseline);
    }
  }
  return baselines;
}

/** Whether one normalized changed path matches a standard's input globs. */
function inputsMatch(inputs: string[], rawPath: string): boolean {
  const path = rawPath.trim().replace(/^\//, "");
  return path !== "" && inputs.some((glob) => pathMatchesPattern(path, glob));
}

/** The pure, config-only standards job list for I/O-free callers. */
export function planStandardJobsFromConfig(
  standards: PlannedStandard[],
): PlannedJob[] {
  return resolveStandardActionsFromConfig(standards).map(
    ({ standard, action }) => plannedStandardJob(standard, action),
  );
}

/** Gate envelope entries in configured order after the shared jobs settle. */
export function gateStandardsData(
  resolved: ResolvedStandard[],
  standards: StandardJobs,
): GateStandard[] {
  return resolved.flatMap(({ standard }) => {
    const outcome = standards.outcomes.get(standard.name);
    return outcome === undefined ? [] : [outcome];
  });
}
