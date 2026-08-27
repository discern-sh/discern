/**
 * The human-operated desk's capability to create effort landing authority.
 *
 * The shipped import graph permits only the desk to depend on this module.
 * Keeping creation separate from reads and cleanup prevents another runtime
 * surface from acquiring the writer through an alias, re-export, or helper.
 */

import { dirname } from "@std/path";
import { atomicReplaceJson } from "../../shared/atomic_write.ts";
import { gitAdminStatePath } from "../../shared/git_admin_state.ts";
import { type EffortGrant, readEffortGrant } from "./effort_grant.ts";

export type EffortGrantWrite =
  | { readonly status: "granted"; readonly grant: EffortGrant }
  | { readonly status: "already_granted"; readonly grant: EffortGrant };

/**
 * Record a desk-granted landing authority. Repeating the same grant is a no-op;
 * a branch rename replaces stale state with the human's current decision.
 */
export async function grantEffort(
  cwd: string,
  branch: string,
  grantedAt: string,
): Promise<EffortGrantWrite> {
  const current = await readEffortGrant(cwd);
  if (current.status === "granted" && current.grant.branch === branch) {
    return { status: "already_granted", grant: current.grant };
  }
  const path = await gitAdminStatePath(cwd, "effortGrant");
  if (path === undefined) {
    throw new Error("Git could not resolve the effort-grant path.");
  }
  const grant: EffortGrant = { branch, granted_at: grantedAt };
  await Deno.mkdir(dirname(path), { recursive: true });
  await atomicReplaceJson(path, grant, {
    mode: 0o666,
    sync: false,
    trailingNewline: true,
  });
  return { status: "granted", grant };
}
