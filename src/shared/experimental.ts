/**
 * Environment-only experimental behavior switches.
 *
 * These public, unstable switches stay outside `discern.toml`: they let users
 * exercise reversible behavior without creating a stable project setting. The
 * complete environment-variable definition registry owns their names and public
 * reference copy; this module derives the typed experiment subset and owns its
 * exact activation rule.
 */

import type { EnvReader } from "./env.ts";
import {
  DISCERN_ENVIRONMENT_VARIABLE_DEFINITIONS,
  environmentVariableNamesForGroup,
} from "./environment_variables.ts";

/** Exact value that enables an environment-only experiment. */
export const EXPERIMENTAL_ENV_ENABLED_VALUE = "1";

/** Every environment variable that enables an experimental behavior. */
export const EXPERIMENTAL_ENVIRONMENT_VARIABLES =
  environmentVariableNamesForGroup(
    DISCERN_ENVIRONMENT_VARIABLE_DEFINITIONS,
    "experimental-features",
  );

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
