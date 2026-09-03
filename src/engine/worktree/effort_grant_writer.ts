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
import { type EnginePlan, verbatimStepLabel } from "../../shared/result.ts";
import { type EffortGrant, readEffortGrant } from "./effort_grant.ts";
import { ON_DISK_FORMATS } from "../../shared/on_disk_formats.ts";

export type EffortGrantWrite =
  | { readonly status: "granted"; readonly grant: EffortGrant }
  | { readonly status: "already_granted"; readonly grant: EffortGrant };

/** Preview the same grant observation and marker path the writer revalidates. */
export async function effortGrantPlan(
  cwd: string,
  branch: string,
): Promise<EnginePlan> {
  const current = await readEffortGrant(cwd);
  if (current.status === "newer") {
    throw new Error(current.reason);
  }
  const path = await gitAdminStatePath(cwd, "effortGrant");
  if (path === undefined) {
    throw new Error("Git could not resolve the effort-grant path.");
  }
  const unchanged = current.status === "granted" &&
    current.grant.branch === branch;
  return {
    title: "Landing pre-authorization plan",
    details: [
      `Task: ${cwd}`,
      `Branch: ${branch}`,
      `Authority record: ${path}`,
    ],
    steps: [{
      kind: "git",
      label: verbatimStepLabel("record landing pre-authorization"),
      disposition: unchanged ? "skip" : "run",
      note: unchanged
        ? `landing pre-authorization already belongs to ${branch}`
        : `record human landing authority for ${branch}`,
    }],
  };
}

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
  if (current.status === "newer") {
    throw new Error(current.reason);
  }
  if (current.status === "granted" && current.grant.branch === branch) {
    return { status: "already_granted", grant: current.grant };
  }
  const path = await gitAdminStatePath(cwd, "effortGrant");
  if (path === undefined) {
    throw new Error("Git could not resolve the effort-grant path.");
  }
  const grant: EffortGrant = {
    version: ON_DISK_FORMATS.effortGrant.version,
    branch,
    granted_at: grantedAt,
  };
  await Deno.mkdir(dirname(path), { recursive: true });
  await atomicReplaceJson(path, grant, {
    mode: 0o666,
    sync: false,
    trailingNewline: true,
  });
  return { status: "granted", grant };
}
