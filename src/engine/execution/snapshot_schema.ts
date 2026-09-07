/** Recovery byte shapes are data leaves, independent of capture or execution. */
import { z } from "@zod/zod";
import { isAbsolute, normalize, SEPARATOR_PATTERN } from "@std/path";
import { DigestSchema, ObjectIdSchema } from "../completion/identity.ts";

export const SnapshotSchema = z.strictObject({
  digest: DigestSchema,
  value: z.unknown(),
});
export type WorkspaceSnapshot = z.infer<typeof SnapshotSchema>;
/** Native checkout names are literal filesystem data, not portable artifact declarations. */
export const CheckoutPathSchema = z.string().min(1).refine(
  (path) =>
    !isAbsolute(path) && normalize(path) === path &&
    !/[\0\ufffd]/u.test(path) &&
    !path.split(SEPARATOR_PATTERN).some((part) =>
      part === "" || part === "." || part === ".." ||
      part.toLowerCase() === ".git"
    ),
  "checkout file must be a literal relative path outside Git administration",
);
export const FileSchema = z.strictObject({
  path: CheckoutPathSchema,
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
  opaque_ignored_repositories: z.array(z.strictObject({
    path: CheckoutPathSchema,
    administration: z.enum(["file", "directory"]),
  })).optional(),
});
export type GitSnapshot = z.infer<typeof GitSnapshotSchema>;
