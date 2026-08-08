/** Git facts shared by every surface that claims a branch is ready to land. */
export interface LandingReadinessFacts {
  readonly clean?: boolean | undefined;
  readonly ahead?: number | null | undefined;
  readonly behind?: number | null | undefined;
}

/** Whether Git state leaves a branch eligible for a current proof. */
export function isLandingCandidate(facts: LandingReadinessFacts): boolean {
  // Unknown `behind` is a degraded Git state, not evidence that the branch is
  // behind. Preserve the existing leniency; a known positive count blocks.
  const notKnownBehind = facts.behind === null || facts.behind === undefined ||
    facts.behind === 0;
  return facts.clean === true && (facts.ahead ?? 0) > 0 && notKnownBehind;
}

/** Whether the observed branch state and proof support "Ready to land". */
export function isReadyToLand(
  facts: LandingReadinessFacts,
  proofHonored: boolean,
): boolean {
  return proofHonored && isLandingCandidate(facts);
}
