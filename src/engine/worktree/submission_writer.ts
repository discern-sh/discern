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
import { type Submission, SubmissionSchema } from "./submission.ts";

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
