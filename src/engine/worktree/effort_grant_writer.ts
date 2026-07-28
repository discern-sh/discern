/**
 * The human-operated desk's capability to create effort landing authority.
 *
 * The shipped import graph permits only the desk to depend on this module.
 * Keeping creation separate from reads and cleanup prevents another runtime
 * surface from acquiring the writer through an alias, re-export, or helper.
 */

import { dirname } from "@std/path";
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
  grantedAt = new Date().toISOString(),
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
  const temp = `${path}.tmp-${crypto.randomUUID()}`;
  let cleanupError: unknown;
  try {
    await Deno.writeTextFile(temp, `${JSON.stringify(grant)}\n`, {
      createNew: true,
    });
    await Deno.rename(temp, path);
  } finally {
    try {
      await Deno.remove(temp);
    } catch (error) {
      if (!(error instanceof Deno.errors.NotFound)) {
        cleanupError = error;
      }
    }
  }
  if (cleanupError !== undefined) {
    throw cleanupError;
  }
  return { status: "granted", grant };
}
