/** Metadata captured from actual Git merge outcomes, independent of verb success. */
import { z } from "@zod/zod";
import { ON_DISK_FORMATS } from "./on_disk_formats.ts";

/** Bound one invocation's metadata without treating omitted observations as successes. */
export const MERGE_ATTEMPT_LIMIT = 64;
export const MERGE_PATH_LIMIT = 200;
/** Combined path bytes keep even an acceptance queue's invocation below one MiB. */
export const MERGE_PATH_BYTES_LIMIT = 8192;

const revisionSchema = z.string().regex(/^(?:[a-f0-9]{40}|[a-f0-9]{64})$/)
  .nullable();

/** Only repository-relative Git paths belong in local merge evidence. */
const pathSchema = z.string().min(1).max(4096).refine((path) =>
  !path.startsWith("/") && !path.includes("\0") &&
  !path.split("/").some((part) => part === ".." || part === ".")
);

/** Shared identity and outcome vocabulary for author and integration checkouts. */
export const mergeAttemptSchema = z.strictObject({
  effort: z.string().min(1).max(1024),
  route: z.enum(["update", "accept"]),
  head: revisionSchema,
  incoming: revisionSchema,
  outcome: z.enum(["merged", "conflict"]),
  conflicts: z.array(z.strictObject({
    path: pathSchema,
    generated: z.boolean(),
  })).max(MERGE_PATH_LIMIT).refine((entries) =>
    new TextEncoder().encode(JSON.stringify(entries)).length <=
      MERGE_PATH_BYTES_LIMIT
  ),
  paths_omitted: z.number().int().nonnegative(),
});
export type MergeAttempt = z.infer<typeof mergeAttemptSchema>;

/** Missing evidence stays unknown; an empty list records no merge. */
export const mergeActivitySchema = z.strictObject({
  version: z.literal(ON_DISK_FORMATS.logbookMergeActivity.version),
  attempts: z.array(mergeAttemptSchema).max(MERGE_ATTEMPT_LIMIT),
  omitted: z.number().int().nonnegative(),
});
export type MergeActivity = z.infer<typeof mergeActivitySchema>;

/** Bound paths and preserve unknown revisions as explicit missing evidence. */
export function boundMergeAttempt(
  input: Omit<MergeAttempt, "paths_omitted">,
): MergeAttempt {
  const conflicts: MergeAttempt["conflicts"] = [];
  let bytes = 2;
  for (const entry of input.conflicts.slice(0, MERGE_PATH_LIMIT)) {
    if (!pathSchema.safeParse(entry.path).success) continue;
    bytes += new TextEncoder().encode(JSON.stringify(entry)).length +
      (conflicts.length === 0 ? 0 : 1);
    if (bytes > MERGE_PATH_BYTES_LIMIT) break;
    conflicts.push(entry);
  }
  return {
    ...input,
    head: revisionSchema.safeParse(input.head).success ? input.head : null,
    incoming: revisionSchema.safeParse(input.incoming).success
      ? input.incoming
      : null,
    conflicts,
    paths_omitted: input.conflicts.length - conflicts.length,
  };
}
