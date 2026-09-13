/**
 * The capability to record or consume an effort's submission. Only the landing
 * may import it: the queue is derived from these records, so no other surface
 * may write one.
 */
import { dirname } from "@std/path";
import {
  atomicReplaceJson,
  removeIfExists,
} from "../../shared/atomic_write.ts";
import { gitAdminStatePath } from "../../shared/git_admin_state.ts";
import { ON_DISK_FORMATS } from "../../shared/on_disk_formats.ts";
import {
  readSubmission,
  type Submission,
  SubmissionSchema,
} from "./submission.ts";

/** Record or replace the effort's submission with the exact revision given. */
export async function recordSubmission(
  cwd: string,
  submission: Omit<Submission, "version">,
): Promise<Submission> {
  const path = await gitAdminStatePath(cwd, "submission");
  if (path === undefined) {
    throw new Error("Git could not resolve the submission path.");
  }
  const record = SubmissionSchema.parse({
    version: ON_DISK_FORMATS.submission.version,
    ...submission,
  });
  await Deno.mkdir(dirname(path), { recursive: true });
  await atomicReplaceJson(path, record, {
    mode: 0o600,
    sync: true,
    trailingNewline: true,
  });
  return record;
}

/** Consume the submission after its landing, or withdraw it; absence is settled. */
export async function clearSubmission(cwd: string): Promise<void> {
  const path = await gitAdminStatePath(cwd, "submission");
  if (path === undefined) {
    throw new Error(
      "Git could not resolve this worktree's submission path, so the submission could not be cleared.",
    );
  }
  await removeIfExists(path);
}

/**
 * Consume exactly the submission a landing recorded. A replacement submission
 * recorded since the snapshot survives: settling the older landing must never
 * spend the newer record. Absence and a replaced record are both settled.
 */
export async function clearSubmissionIfCurrent(
  cwd: string,
  submissionId: string,
): Promise<{ readonly cleared: boolean; readonly replaced: boolean }> {
  const current = await readSubmission(cwd);
  if (current.status !== "submitted") {
    return { cleared: false, replaced: false };
  }
  if (current.submission.id !== submissionId) {
    return { cleared: false, replaced: true };
  }
  await clearSubmission(cwd);
  return { cleared: true, replaced: false };
}
