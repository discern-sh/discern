import { ON_DISK_FORMATS } from "../../shared/on_disk_formats.ts";
export const INLINE_GIT_SNAPSHOT_FORMAT =
  `${ON_DISK_FORMATS.executionGitSnapshot.id}-v${ON_DISK_FORMATS.executionGitSnapshot.version}` as const;
export const SOURCE_OBSERVATION_FORMAT =
  `${ON_DISK_FORMATS.executionSourceObservation.id}-v${ON_DISK_FORMATS.executionSourceObservation.version}` as const;
export const RECOVERY_MANIFEST_FORMAT =
  `${ON_DISK_FORMATS.executionGitManifest.id}-v${ON_DISK_FORMATS.executionGitManifest.version}` as const;
export const RELEASE_OBSERVATION_FORMAT =
  `${ON_DISK_FORMATS.executionReleaseObservation.id}-v${ON_DISK_FORMATS.executionReleaseObservation.version}` as const;
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
export const PayloadReferenceSchema = z.string().regex(
  /^sha256:[0-9a-f]{64}:(?:0|[1-9][0-9]*)$/u,
).refine(
  (value) => Number.isSafeInteger(Number(value.split(":")[2])),
  "payload byte count must be a safe integer",
);
export const EXECUTION_DOCUMENT_BYTES = 64 * 1024 * 1024;

export const GitSnapshotSchema = z.strictObject({
  format: z.enum([
    INLINE_GIT_SNAPSHOT_FORMAT,
    SOURCE_OBSERVATION_FORMAT,
    RECOVERY_MANIFEST_FORMAT,
    RELEASE_OBSERVATION_FORMAT,
  ]),
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
}).refine(
  (snapshot) => {
    if (snapshot.format === SOURCE_OBSERVATION_FORMAT) {
      return snapshot.index === "" && snapshot.staged_patch === "" &&
        snapshot.files.length === 0;
    }
    if (snapshot.format === INLINE_GIT_SNAPSHOT_FORMAT) return true;
    return PayloadReferenceSchema.safeParse(snapshot.index).success &&
      snapshot.files.every((file) =>
        file.kind !== "file" ||
        PayloadReferenceSchema.safeParse(file.contents).success
      );
  },
  "snapshot payload representation must match its declared observation format",
);
export type GitSnapshot = z.infer<typeof GitSnapshotSchema>;
