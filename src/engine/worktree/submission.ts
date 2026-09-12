/**
 * The effort's submission: the exact revision its agent asked to land.
 *
 * `accept` writes it beside the effort grant, under this linked worktree's
 * Git administration directory, so no branch can forge it and Git removes it
 * with the worktree. A later `accept` from the same effort replaces it; a
 * landing consumes it. The landing queue is the list of these records, so a
 * green run its agent never submitted is absent from the queue and lands only
 * by the owner's explicit act. This module reads; `submission_writer.ts`
 * holds the capability to record and consume.
 */

import { z } from "@zod/zod";
import { CompletionProofPointerSchema } from "../../shared/completion_proof.ts";
import { gitAdminStatePath } from "../../shared/git_admin_state.ts";
import {
  inspectOnDiskRecordVersion,
  newerOnDiskFormatMessage,
  ON_DISK_FORMATS,
} from "../../shared/on_disk_formats.ts";
import { inspectOnDiskJsonFile } from "../../shared/on_disk_json.ts";
import {
  NameSchema,
  ObjectIdSchema,
  RecordIdSchema,
} from "../completion/identity.ts";

/** The submitted revision and the complete Proof that vouches for it. */
export const SubmissionSchema = z.strictObject({
  version: z.literal(ON_DISK_FORMATS.submission.version),
  id: RecordIdSchema,
  effort_id: NameSchema,
  branch: z.string().min(1),
  head: ObjectIdSchema,
  tree: ObjectIdSchema,
  proof: CompletionProofPointerSchema,
  submitted_at: z.string().refine(
    (value) => !Number.isNaN(Date.parse(value)),
    "submission time must be ISO-8601",
  ),
});
export type Submission = z.infer<typeof SubmissionSchema>;

export type SubmissionRead =
  | { readonly status: "submitted"; readonly submission: Submission }
  | { readonly status: "missing" }
  | { readonly status: "invalid"; readonly reason: string }
  | { readonly status: "newer"; readonly reason: string }
  | { readonly status: "unavailable"; readonly reason: string };

/** Validate a persisted submission without accepting absence as version 1. */
export function parseSubmission(raw: string): SubmissionRead {
  let value: unknown;
  try {
    value = JSON.parse(raw);
  } catch {
    return { status: "invalid", reason: "the submission is not valid JSON" };
  }
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    return {
      status: "invalid",
      reason: "the submission is not a JSON object",
    };
  }
  const version = inspectOnDiskRecordVersion(
    "submission",
    value as Record<string, unknown>,
  );
  if (version.status === "newer") {
    return {
      status: "newer",
      reason: newerOnDiskFormatMessage("submission", version.found),
    };
  }
  const parsed = SubmissionSchema.safeParse(value);
  if (version.status !== "current" || !parsed.success) {
    return {
      status: "invalid",
      reason:
        "the submission does not name a supported effort, branch, exact revision, and Proof; run discern accept from the effort's worktree to submit it again",
    };
  }
  return { status: "submitted", submission: parsed.data };
}

/** Read this worktree's submission. Unreadable or malformed state fails closed. */
export async function readSubmission(cwd: string): Promise<SubmissionRead> {
  const read = await inspectOnDiskJsonFile(
    "submission",
    await gitAdminStatePath(cwd, "submission"),
    parseSubmission,
  );
  return read.status === "recorded"
    ? read.value
    : read.status === "malformed"
    ? { status: "invalid", reason: "the submission is malformed" }
    : read;
}
