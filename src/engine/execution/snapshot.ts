/** Bounded complete byte capture. No path is removed by this module. */
import type { z } from "@zod/zod";
import { dirname, join } from "@std/path";
import { encodeBase64 } from "@std/encoding/base64";
import { runGit } from "../../shared/subprocess.ts";
import { sha256Hex } from "../../shared/sha256.ts";
import { ArtifactPathSchema } from "../completion/evidence.ts";
import {
  type FileSchema,
  type GitSnapshot,
  GitSnapshotSchema,
  type WorkspaceSnapshot,
} from "./snapshot_schema.ts";
export interface CaptureBounds {
  readonly maxFiles: number;
  readonly maxBytes: number;
  readonly gitTimeoutMs: number;
}

/** Git output must be complete, bounded, and settled before a filesystem effect. */
export async function executionGit(
  path: string,
  args: string[],
  bounds: CaptureBounds,
): Promise<string> {
  const result = await runGit(args, {
    cwd: path,
    env: { GIT_OPTIONAL_LOCKS: "0" },
    timeoutMs: bounds.gitTimeoutMs,
    maxOutputBytes: bounds.maxBytes,
    quiesceDescendants: true,
  });
  if (!result.success) {
    throw new Error(
      `Git ${
        args[0]
      } failed: ${result.stderr.trim()}. Preserve the environment for recovery.`,
    );
  }
  return result.stdout;
}

/** An intermediate symlink could make a familiar leaf refer outside the checkout. */
export async function containedFile(
  root: string,
  path: string,
): Promise<string> {
  ArtifactPathSchema.parse(path);
  let parent = dirname(path);
  while (parent !== ".") {
    try {
      const stat = await Deno.lstat(join(root, parent));
      if (!stat.isDirectory || stat.isSymlink) {
        throw new Error(`Capture path has a non-directory ancestor: ${path}`);
      }
    } catch (error) {
      if (!(error instanceof Deno.errors.NotFound)) throw error;
    }
    parent = dirname(parent);
  }
  return join(root, path);
}

/** Keep file bytes and link text without following a captured leaf symlink. */
async function captureFile(
  root: string,
  path: string,
  ignored: boolean,
  budget: { remaining: number },
): Promise<z.infer<typeof FileSchema>> {
  if (path.includes("\ufffd")) {
    throw new Error(
      "A filename cannot be represented losslessly; retain the checkout for manual capture.",
    );
  }
  const target = await containedFile(root, path);
  let stat: Deno.FileInfo;
  try {
    stat = await Deno.lstat(target);
  } catch (error) {
    if (!(error instanceof Deno.errors.NotFound)) throw error;
    return { path, kind: "missing", contents: "", executable: false, ignored };
  }
  if (!stat.isFile && !stat.isSymlink) {
    throw new Error(
      `Capture refuses a directory, device, or other special file: ${path}`,
    );
  }
  if (stat.size > budget.remaining) {
    throw new Error(
      `Capture byte limit reached at ${path}; retain the checkout and increase the explicit capture bound.`,
    );
  }
  const contents = stat.isSymlink
    ? await Deno.readLink(target)
    : encodeBase64(await Deno.readFile(target));
  budget.remaining -= stat.isSymlink
    ? new TextEncoder().encode(contents).length
    : Math.ceil(contents.length * 3 / 4);
  if (budget.remaining < 0) {
    throw new Error(
      "Capture exceeded its byte bound while a file changed; retain the checkout.",
    );
  }
  return {
    path,
    kind: stat.isSymlink ? "symlink" : "file",
    contents,
    executable: ((stat.mode ?? 0) & 0o111) !== 0,
    ignored,
  };
}

/** Keep raw index and staged binary patches as well as present working bytes. */
async function captureOnce(
  root: string,
  bounds: CaptureBounds,
): Promise<GitSnapshot> {
  const git = (args: string[]): Promise<string> =>
    executionGit(root, args, bounds);
  const head = (await git(["rev-parse", "HEAD"])).trim();
  const tree = (await git(["rev-parse", "HEAD^{tree}"])).trim();
  const branchResult = await runGit(["symbolic-ref", "-q", "HEAD"], {
    cwd: root,
  });
  if (!branchResult.success && branchResult.code !== 1) {
    throw new Error("Git could not inspect checkout attachment.");
  }
  const gitDir = (await git(["rev-parse", "--absolute-git-dir"])).trim();
  const indexPath = join(gitDir, "index");
  const indexEntries = await git(["ls-files", "--stage", "-z"]);
  const indexFlags = await git(["ls-files", "-v", "-z"]);
  if (
    indexFlags.split("\0").some((entry) => /^[a-zS] /u.test(entry)) ||
    (await git(["rev-parse", "--shared-index-path"])).trim() !== ""
  ) {
    throw new Error(
      "Assumed-unchanged, sparse, or split indexes require their own restoration contract; preserve the checkout and normalize its index before release.",
    );
  }
  if (
    indexEntries.split("\0").some((entry) =>
      entry.startsWith("160000 ") || /^\d+ [0-9a-f]+ [123]\t/u.test(entry)
    )
  ) {
    throw new Error(
      "Submodules or unresolved index stages need their own capture contract; this environment is unavailable.",
    );
  }
  const names = new Set(
    (await git([
      "ls-files",
      "--cached",
      "--others",
      "--exclude-standard",
      "-z",
    ])).split("\0").filter(Boolean),
  );
  const ignored = new Set(
    (await git([
      "ls-files",
      "--others",
      "--ignored",
      "--exclude-standard",
      "-z",
    ])).split("\0").filter(Boolean),
  );
  for (const path of ignored) names.add(path);
  if (names.size > bounds.maxFiles) {
    throw new Error(
      "Capture file limit reached; retain the checkout and increase the explicit capture bound.",
    );
  }
  const budget = { remaining: bounds.maxBytes };
  const files = [];
  for (const path of [...names].sort()) {
    files.push(await captureFile(root, path, ignored.has(path), budget));
  }
  const index = encodeBase64(await Deno.readFile(indexPath));
  const stagedPatch = await git([
    "diff",
    "--cached",
    "--binary",
    "--full-index",
    "--no-ext-diff",
    "--no-textconv",
    "HEAD",
    "--",
  ]);
  if (
    new TextEncoder().encode(stagedPatch).length +
        Math.ceil(index.length * 3 / 4) > budget.remaining
  ) {
    throw new Error(
      "Index capture exceeds the byte bound; retain the checkout.",
    );
  }
  return GitSnapshotSchema.parse({
    format: "execution-git-snapshot-v1",
    head,
    tree,
    branch: branchResult.success ? branchResult.stdout.trim() : null,
    git_dir: gitDir,
    index_path: indexPath,
    index,
    index_entries: indexEntries,
    staged_patch: stagedPatch,
    status: await git([
      "status",
      "--porcelain=v1",
      "--untracked-files=all",
      "--ignore-submodules=none",
    ]),
    files,
  });
}

/** The digest covers serialized adapter state before it becomes release evidence. */
export async function snapshotValue(
  value: unknown,
): Promise<WorkspaceSnapshot> {
  return { value, digest: await sha256Hex(JSON.stringify(value)) };
}

/** A mutation during either observation cannot authorize later cleanup. */
export async function captureGitSnapshot(
  root: string,
  bounds: CaptureBounds,
  indexFile: string | undefined = Deno.env.get("GIT_INDEX_FILE"),
): Promise<GitSnapshot> {
  if (indexFile !== undefined) {
    throw new Error(
      "An alternate Git index requires its own restoration contract; use the checkout's native index before releasing it.",
    );
  }
  if (
    ![bounds.maxFiles, bounds.maxBytes, bounds.gitTimeoutMs].every((bound) =>
      Number.isSafeInteger(bound) && bound > 0
    )
  ) {
    throw new TypeError(
      "Capture requires finite positive file, byte, and Git time bounds.",
    );
  }
  const first = await captureOnce(root, bounds);
  const second = await captureOnce(root, bounds);
  if (JSON.stringify(first) !== JSON.stringify(second)) {
    throw new Error(
      "Checkout changed during capture; no complete artifact authorizes cleanup. Stop conflicting writers and retry recovery.",
    );
  }
  return second;
}
