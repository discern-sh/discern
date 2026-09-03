/** Selection-boundary validation and guidance for the Standards command. */

import type { DiscernResult } from "../../shared/result.ts";
import { fire, type FiredHint, HINTS } from "../../shared/hints.ts";
import { runGit } from "../../shared/subprocess.ts";
import type { TrunkLimitsVerification } from "./standard_limits.ts";
import type { StandardPlan } from "./standard_plan.ts";

/** Refuse positional Standard names that do not exist in the live plan. */
export function invalidStandardSelectionResult(
  plan: StandardPlan,
  names: readonly string[],
): DiscernResult | undefined {
  const known = new Set(plan.standards.map((standard) => standard.name));
  const unknown = [...new Set(names.filter((name) => !known.has(name)))];
  if (unknown.length === 0) return undefined;
  return {
    ok: false,
    verb: "standards",
    error: "invalid_value",
    message: `Unknown Standard name${unknown.length === 1 ? "" : "s"}: ${
      unknown.join(", ")
    }. Configured Standards: ${[...known].join(", ") || "none"}.`,
  };
}

/** Fire an advisory only when the trunk limits could not be verified. */
export function unverifiedTrunkHint(
  verification: TrunkLimitsVerification,
): FiredHint | undefined {
  return verification.summary.status === "unverified"
    ? fire(HINTS["standards-limits-unverified"], {
      reason: verification.summary.reason,
    })
    : undefined;
}

/** Explain why standalone measurements need committed state and how to recover. */
export async function standardsCleanTreeMessage(
  root: string,
): Promise<string | undefined> {
  const status = await runGit(["status", "--porcelain", "-z"], { cwd: root });
  if (!status.success) {
    return "Standards require a clean worktree, but discern could not read git status. Fix the git status check and re-run `discern standards`; use `--force` only while authoring or debugging standards.";
  }
  if (status.stdout.trim() === "") return undefined;
  return "Standards require a clean worktree: this pass records its measurements against the exact commit (for pin reuse and gate replay), so they must describe committed state. Commit or stash changes, then re-run `discern standards`; use `--force` only while authoring or debugging standards. (The gate itself measures a dirty tree as-is — `discern done` needs no clean tree to check standards.)";
}

/** Guard pin's limits-only commit from sweeping in unrelated worktree edits. */
export async function standardsPinCleanTreeMessage(
  root: string,
): Promise<string | undefined> {
  const status = await runGit(["status", "--porcelain", "-z"], { cwd: root });
  if (!status.success) {
    return "Pinning requires a clean worktree, but discern could not read git status. Fix the git status check and re-run `discern standards --pin`.";
  }
  if (status.stdout.trim() === "") return undefined;
  return "Pinning requires a clean worktree: it commits the limit change on its own, so any other edit would be swept into that commit. Commit or stash your changes, then re-run `discern standards --pin`.";
}
