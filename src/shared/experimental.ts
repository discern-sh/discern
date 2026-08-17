/**
 * Environment-only experimental behavior switches.
 *
 * These public, unstable switches stay outside `discern.toml`: they let users
 * exercise reversible behavior without creating a stable project setting. The
 * complete environment-variable definition registry owns their names and public
 * reference copy; this module derives the typed experiment subset and owns each
 * exact activation rule — a switch activates on the exact value `1`, and a
 * valued experiment activates only on its own exact syntax.
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

/** Exact syntax a valued experiment accepts: a positive whole number. */
const EXPERIMENTAL_POSITIVE_INTEGER = /^[1-9][0-9]*$/;

/**
 * The per-call `await` bound cap in seconds, or undefined when the experiment
 * is off. Activates only on a positive whole number of seconds; empty, absent,
 * zero, and non-numeric values stay off. The cap can only shorten a call: its
 * consumer takes the minimum of this value and the transport-safe bound.
 */
export function experimentalAwaitCallSeconds(
  env: EnvReader = Deno.env,
): number | undefined {
  const value = env.get(
    EXPERIMENTAL_ENVIRONMENT_VARIABLES.experimentalAwaitCallSeconds,
  );
  if (value === undefined || !EXPERIMENTAL_POSITIVE_INTEGER.test(value)) {
    return undefined;
  }
  return Number.parseInt(value, 10);
}
