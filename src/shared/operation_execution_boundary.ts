/** Project execution and capacity admission may never hold publication ownership. */
import {
  currentOperationLocks,
  inheritedOperationLockLeases,
  readLiveOperationLease,
} from "./operation_lock_context.ts";

/** Authenticate inherited ownership too: losing async context in a child must
 * not turn the parent's common lease into permission to execute project code. */
export async function assertOutsideCommonPublication(): Promise<void> {
  if (currentOperationLocks()?.boundaries.has("common")) throw violation();
  for (const lease of inheritedOperationLockLeases()) {
    if (lease.boundary !== "common") continue;
    if (await readLiveOperationLease(lease) !== undefined) throw violation();
  }
}

/** A classified execution refusal, preserved by the public result boundary. */
export class CommonPublicationExecutionError extends Error {}

/** Explain the invariant at the rejected execution boundary. */
function violation(): Error {
  return new CommonPublicationExecutionError(
    "Project commands and capacity admission cannot run while holding the common publication boundary. Release publication ownership and retain the operation's worktree or resource lease before executing.",
  );
}
