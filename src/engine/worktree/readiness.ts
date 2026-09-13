import type { GitCount } from "../../shared/git_count.ts";
import {
  isPositiveGitCount,
  UNKNOWN_GIT_COUNT,
} from "../../shared/git_count.ts";

/** Git facts shared by every surface that claims a branch is ready to land. */
export interface LandingReadinessFacts {
  readonly clean?: boolean | undefined;
  readonly ahead?: GitCount | null | undefined;
  readonly behind?: GitCount | null | undefined;
}

/** Whether Git state leaves a branch eligible for a current proof. */
export function isLandingCandidate(facts: LandingReadinessFacts): boolean {
  return facts.clean === true && typeof facts.ahead === "number" &&
    facts.ahead > 0 && facts.behind === 0;
}

/**
 * Whether the observed branch state and proof support "Ready to land".
 * Honored Proof covers the exact committed HEAD, and trunk movement alone
 * does not withdraw it: acceptance composes and checks a moved trunk in its
 * own integration worktree, so a proven branch behind the trunk is still
 * ready. An unknown behind count stays ready on the same evidence — the
 * landing re-reads the trunk itself.
 */
export function isReadyToLand(
  facts: LandingReadinessFacts,
  proofHonored: boolean,
): boolean {
  return proofHonored && facts.clean === true &&
    typeof facts.ahead === "number" && facts.ahead > 0;
}

/**
 * Where a behind-trunk worktree goes next — the one routing policy shared by
 * status, hints, and queue wording, so no surface can disagree with another:
 *
 * - `accept`: the clean HEAD carries honored Proof, so the work is proven and
 *   trunk movement alone changes nothing the author must redo. `accept`
 *   composes and checks the moved trunk in a disposable integration worktree
 *   and lands the exact proven result; only a conflict, a failed combined
 *   check, or a renewed judgment routes back to the author.
 * - `update`: the work is still being authored (dirty, or its HEAD has no
 *   honored Proof), so the branch integrates the trunk in place and proves
 *   the result with `done`.
 */
export function behindTrunkRoute(
  facts: Pick<LandingReadinessFacts, "clean">,
  proofHonored: boolean,
): "accept" | "update" {
  return facts.clean === true && proofHonored ? "accept" : "update";
}

/** Whether the behind count reports an actual or unknown deficit. */
export function isBehindTrunk(
  behind: GitCount | null | undefined,
): boolean {
  return behind === UNKNOWN_GIT_COUNT ||
    (behind !== null && behind !== undefined && isPositiveGitCount(behind));
}
