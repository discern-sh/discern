/**
 * The invocation id currently recording in this process, published so the
 * subprocess boundaries can stamp it into the environment of discern children.
 * The recorder mints the id; this seam only carries it across the process.
 *
 * Last write wins: a CLI process records one verb, so the value is exact
 * there. The long-lived MCP server could in principle overlap two effectful
 * verbs, in which case a child links to the newest sibling invocation in the
 * same session — advisory evidence, never authority.
 */

import { DISCERN_ENVIRONMENT_VARIABLES } from "./environment_variables.ts";

let activeInvocation: string | undefined;

/** Record the invocation now driving this process. */
export function setActiveInvocationId(invocation: string): void {
  activeInvocation = invocation;
}

/**
 * Final child-environment overlay: automated work belongs to the current
 * invocation. An interactive handoff starts independent decisions and clears
 * even an inherited marker. With no recorder, automation preserves inheritance.
 */
export function spawnedByEnv(
  lineage: "automation" | "interactive" = "automation",
): Record<string, string> {
  if (lineage === "interactive") {
    return { [DISCERN_ENVIRONMENT_VARIABLES.spawnedBy]: "" };
  }
  return activeInvocation === undefined
    ? {}
    : { [DISCERN_ENVIRONMENT_VARIABLES.spawnedBy]: activeInvocation };
}
