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
import { runGit } from "../../shared/subprocess.ts";
import {
  type EffortGrant,
  EffortGrantSchema,
  readEffortGrant,
} from "./effort_grant.ts";
import { SYSTEM_SECURE_ENTROPY } from "../../shared/entropy.ts";
import { withCompletionPublication } from "../operation_lock.ts";
import { ON_DISK_FORMATS } from "../../shared/on_disk_formats.ts";

export type EffortGrantWrite =
  | { readonly status: "granted"; readonly grant: EffortGrant }
  | { readonly status: "already_granted"; readonly grant: EffortGrant };

/** The grant covers the effort's branch; the checkout must be on it. */
async function assertGrantSubject(cwd: string, branch: string): Promise<void> {
  const head = await runGit(["symbolic-ref", "--quiet", "HEAD"], { cwd });
  if (!head.success || head.stdout.trim() !== `refs/heads/${branch}`) {
    throw new Error(
      "Select the effort's named branch in its worktree before recording a landing grant.",
    );
  }
}

/** Preview the same grant observation and marker path the writer revalidates. */
export async function effortGrantPlan(
  cwd: string,
  branch: string,
): Promise<EnginePlan> {
  await assertGrantSubject(cwd, branch);
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
    title: "Landing pre-authorization",
    details: [
      `Task: ${cwd}`,
      `Branch: ${branch}`,
      "Any later green discern done on this branch is covered until it lands.",
      "A checkpoint variance, a standard proposal, or an emergency is never covered.",
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

/** Record the desk's decision for the effort; an unchanged grant keeps its identity. */
export async function grantEffort(
  cwd: string,
  branch: string,
  grantedAt: string,
): Promise<EffortGrantWrite> {
  await assertGrantSubject(cwd, branch);
  return await withCompletionPublication(cwd, async () => {
    const current = await readEffortGrant(cwd);
    if (current.status === "newer") throw new Error(current.reason);
    if (current.status === "granted" && current.grant.branch === branch) {
      return { status: "already_granted", grant: current.grant };
    }
    const path = await gitAdminStatePath(cwd, "effortGrant");
    if (path === undefined) {
      throw new Error("Git could not resolve the effort-grant path.");
    }
    const grant = EffortGrantSchema.parse({
      version: ON_DISK_FORMATS.effortGrant.version,
      id: SYSTEM_SECURE_ENTROPY.uuid(),
      branch,
      granted_at: grantedAt,
    });
    await Deno.mkdir(dirname(path), { recursive: true });
    await atomicReplaceJson(path, grant, {
      mode: 0o600,
      sync: true,
      trailingNewline: true,
    });
    return { status: "granted", grant };
  });
}
