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
import {
  type EffortGrant,
  EffortGrantSchema,
  type EffortGrantSubject,
  readEffortGrant,
} from "./effort_grant.ts";
import { inspectEffortGrantSubject } from "./effort_grant_subject.ts";
import { SYSTEM_SECURE_ENTROPY } from "../../shared/entropy.ts";
import { withCompletionPublication } from "../operation_lock.ts";
import { ON_DISK_FORMATS } from "../../shared/on_disk_formats.ts";

export interface EffortGrantPlan extends EnginePlan {
  readonly subject: EffortGrantSubject;
}

export type EffortGrantWrite =
  | { readonly status: "granted"; readonly grant: EffortGrant }
  | { readonly status: "already_granted"; readonly grant: EffortGrant };

/** Preview the same grant observation and marker path the writer revalidates. */
export async function effortGrantPlan(
  cwd: string,
  branch: string,
): Promise<EffortGrantPlan> {
  const subject = await inspectEffortGrantSubject(cwd, branch);
  const current = await readEffortGrant(cwd);
  if (current.status === "newer") {
    throw new Error(current.reason);
  }
  const path = await gitAdminStatePath(cwd, "effortGrant");
  if (path === undefined) {
    throw new Error("Git could not resolve the effort-grant path.");
  }
  const unchanged = current.status === "granted" &&
    current.grant.branch === branch && sameSubject(current.grant, subject);
  return {
    title: "Exact source landing grant",
    subject,
    details: [
      `Task: ${cwd}`,
      `Branch: ${branch}`,
      `Approved source: ${subject.source.head}`,
      `Composition procedure: ${subject.composition_procedure}`,
      "New authored changes require another source grant.",
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

/** Compare canonical source approval coordinates independently of grant metadata. */
function sameSubject(
  grant: EffortGrantSubject,
  subject: EffortGrantSubject,
): boolean {
  return JSON.stringify(grant.source) === JSON.stringify(subject.source) &&
    grant.composition_procedure === subject.composition_procedure;
}

/** Record the exact source the desk reviewed; unchanged approvals retain their identity. */
export async function grantEffort(
  cwd: string,
  branch: string,
  grantedAt: string,
  expected?: EffortGrantSubject,
): Promise<EffortGrantWrite> {
  const subject = await inspectEffortGrantSubject(cwd, branch);
  if (expected !== undefined && !sameSubject(expected, subject)) {
    throw new Error(
      "Source changed after the grant preview. Review and approve the current source; no grant was recorded.",
    );
  }
  return await withCompletionPublication(cwd, async () => {
    const currentSubject = await inspectEffortGrantSubject(cwd, branch);
    if (!sameSubject(subject, currentSubject)) {
      throw new Error(
        "Source changed before grant publication. No grant was recorded.",
      );
    }
    const current = await readEffortGrant(cwd);
    if (current.status === "newer") throw new Error(current.reason);
    if (current.status === "granted" && sameSubject(current.grant, subject)) {
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
      ...subject,
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
