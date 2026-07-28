/**
 * The capability to consume or revoke an effort landing grant.
 *
 * Only the human-operated desk and successful acceptance may import this
 * module. Grant creation remains desk-only in effort_grant_writer.ts.
 */

import { gitAdminStatePath } from "../../shared/git_admin_state.ts";

/** Revoke this worktree's grant. Repeating the revoke is a no-op. */
export async function clearEffortGrant(cwd: string): Promise<boolean> {
  const path = await gitAdminStatePath(cwd, "effortGrant");
  if (path === undefined) {
    return false;
  }
  try {
    await Deno.remove(path);
    return true;
  } catch (error) {
    if (error instanceof Deno.errors.NotFound) {
      return false;
    }
    throw error;
  }
}
