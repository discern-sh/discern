/** Recovery byte shapes are data leaves, independent of capture or execution. */
import { z } from "@zod/zod";
import { ArtifactPathSchema } from "../completion/evidence.ts";
import { DigestSchema, ObjectIdSchema } from "../completion/identity.ts";

export const SnapshotSchema = z.strictObject({
  digest: DigestSchema,
  value: z.unknown(),
});
export type WorkspaceSnapshot = z.infer<typeof SnapshotSchema>;
export const FileSchema = z.strictObject({
  path: ArtifactPathSchema,
  kind: z.enum(["file", "symlink", "missing"]),
  contents: z.string(),
  executable: z.boolean(),
  ignored: z.boolean(),
});
export const GitSnapshotSchema = z.strictObject({
  format: z.literal("execution-git-snapshot-v1"),
  head: ObjectIdSchema,
  tree: ObjectIdSchema,
  branch: z.string().nullable(),
  git_dir: z.string(),
  index_path: z.string(),
  index: z.string(),
  index_entries: z.string(),
  staged_patch: z.string(),
  status: z.string(),
  files: z.array(FileSchema),
});
export type GitSnapshot = z.infer<typeof GitSnapshotSchema>;
