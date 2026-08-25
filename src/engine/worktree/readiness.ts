import type { GitCount } from "../../shared/git_count.ts";

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

/** Whether the observed branch state and proof support "Ready to land". */
export function isReadyToLand(
  facts: LandingReadinessFacts,
  proofHonored: boolean,
): boolean {
  return proofHonored && isLandingCandidate(facts);
}
