/**
 * Environment-only experimental behavior switches.
 *
 * These switches are intentionally outside `discern.toml`: they let maintainers
 * and power users exercise reversible behavior without creating a public project
 * contract. The registry is the single source of truth for their environment
 * variable names; its enrollment guard holds every use and the internal reference
 * page to the same set.
 */

import type { EnvReader } from "./env.ts";

/** Exact value that enables an environment-only experiment. */
export const EXPERIMENTAL_ENV_ENABLED_VALUE = "1";

/** Every environment variable that enables an experimental behavior. */
export const EXPERIMENTAL_ENVIRONMENT_VARIABLES = {
  mcpPreload: "DISCERN_EXPERIMENTAL_MCP_PRELOAD",
} as const;

/** A registered environment-only experiment. */
export type ExperimentalEnvironmentVariable =
  keyof typeof EXPERIMENTAL_ENVIRONMENT_VARIABLES;

/** Whether one registered experiment is enabled in the supplied environment. */
export function experimentalEnvironmentEnabled(
  experiment: ExperimentalEnvironmentVariable,
  env: EnvReader = Deno.env,
): boolean {
  return env.get(EXPERIMENTAL_ENVIRONMENT_VARIABLES[experiment]) ===
    EXPERIMENTAL_ENV_ENABLED_VALUE;
}
