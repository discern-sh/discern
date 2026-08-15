/**
 * The invocation id currently recording in this process, published so the
 * gate's job runner can stamp it into the environment of the discern children
 * it spawns ({@link import("../jobs/command.ts").spawnJob}). The recorder mints
 * the id; this seam only carries it across the process.
 *
 * Last write wins: a CLI process records one verb, so the value is exact
 * there. The long-lived MCP server could in principle overlap two effectful
 * verbs, in which case a child links to the newest sibling invocation in the
 * same session — advisory evidence, never authority.
 */

let activeInvocation: string | undefined;

/** Record the invocation now driving this process. */
export function setActiveInvocationId(invocation: string): void {
  activeInvocation = invocation;
}

/** The invocation to attribute spawned discern children to, if any. */
export function activeInvocationId(): string | undefined {
  return activeInvocation;
}
