/**
 * Transient ownership marker for processes launched by the desk.
 *
 * The marker is deliberately an advisory process-context signal, not a security
 * boundary: descendants inherit it, and a user can unset or forge it. Only the
 * interactive desk and debugging context consume it; project state and lifecycle
 * authority never depend on it.
 */

import { DISCERN_ENVIRONMENT_VARIABLES } from "../../shared/environment_variables.ts";

/** Environment key inherited by every arbitrary-code child the desk launches. */
export const DESK_SESSION_ENV = DISCERN_ENVIRONMENT_VARIABLES.deskSession;

const DESK_SESSION_VALUE = "1";

/** The environment overlay for a shell, coding agent, or Project Script. */
export function deskSessionEnv(): Record<string, string> {
  return { [DESK_SESSION_ENV]: DESK_SESSION_VALUE };
}

/**
 * The environment overlay that keeps an inherited marker from reaching a child.
 * A child environment merges over its parent's, so a blank value is the only
 * way to neutralize the marker without clearing everything else the parent
 * holds. Spawn funnels whose children must behave the same whether or not the
 * launcher sits beneath a desk apply this overlay before any caller override.
 */
export function withoutDeskSessionEnv(): Record<string, string> {
  return { [DESK_SESSION_ENV]: "" };
}

/** Whether this process is a descendant of a desk-owned child session. */
export function inDeskSession(
  env: Pick<typeof Deno.env, "get"> = Deno.env,
): boolean {
  return env.get(DESK_SESSION_ENV) === DESK_SESSION_VALUE;
}
