import { SOURCE_OBSERVATION_FORMAT } from "./snapshot_schema.ts";
/** Observe source semantics without retaining local restoration payloads. */
import { join } from "@std/path";
import {
  CAPTURE_METADATA_BYTES,
  type CaptureBounds,
  executionGit,
  requireNativeIndex,
} from "./snapshot.ts";
import { type GitSnapshot, GitSnapshotSchema } from "./snapshot_schema.ts";

/** Exact source attachment and index semantics; producers own their declared byte inputs. */
export async function observeSourceSnapshot(
  root: string,
  bounds: CaptureBounds,
  indexFile: string | undefined = Deno.env.get("GIT_INDEX_FILE"),
): Promise<GitSnapshot> {
  requireNativeIndex(indexFile);
  const git = (args: string[]): Promise<string> =>
    executionGit(root, args, {
      ...bounds,
      maxBytes: Math.min(bounds.maxBytes, CAPTURE_METADATA_BYTES),
    });
  const once = async (): Promise<GitSnapshot> => {
    const [head, tree, branch, gitDir, entries, status] = await Promise.all([
      git(["rev-parse", "HEAD"]),
      git(["rev-parse", "HEAD^{tree}"]),
      git(["rev-parse", "--symbolic-full-name", "HEAD"]),
      git(["rev-parse", "--absolute-git-dir"]),
      git(["ls-files", "--stage", "-v", "-z"]),
      git([
        "status",
        "--porcelain=v1",
        "-z",
        "--untracked-files=all",
        "--ignore-submodules=none",
      ]),
    ]);
    return GitSnapshotSchema.parse({
      format: SOURCE_OBSERVATION_FORMAT,
      head: head.trim(),
      tree: tree.trim(),
      branch: branch.trim() === "HEAD" ? null : branch.trim(),
      git_dir: gitDir.trim(),
      index_path: join(gitDir.trim(), "index"),
      index: "",
      index_entries: entries,
      staged_patch: "",
      status,
      files: [],
    });
  };
  const first = await once();
  const second = await once();
  if (JSON.stringify(first) !== JSON.stringify(second)) {
    throw new Error(
      "Source or index changed during observation; preserve the checkout and retry after writers stop.",
    );
  }
  return second;
}
