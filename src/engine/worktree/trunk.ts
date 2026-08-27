/** Resolve the configured integration branch from explicit structured state. */

import type { EnvReader } from "../../shared/env.ts";
import { DISCERN_ENVIRONMENT_VARIABLES } from "../../shared/environment_variables.ts";

/** The fallback integration branch when neither environment nor config names one. */
export const DEFAULT_INTEGRATION_BRANCH = "main";

/**
 * The integration branch: `DISCERN_TRUNK` wins, then the config-derived
 * fallback, then `main`. Worktree lifecycle and checkout identity share this
 * resolver so the trunk branch can never split across the two surfaces.
 */
export function integrationBranch(
  fallback?: string,
  envReader: EnvReader = Deno.env,
): string {
  const env = envReader.get(DISCERN_ENVIRONMENT_VARIABLES.trunk);
  if (env !== undefined && env !== "") {
    return env;
  }
  if (fallback !== undefined && fallback !== "") {
    return fallback;
  }
  return DEFAULT_INTEGRATION_BRANCH;
}
