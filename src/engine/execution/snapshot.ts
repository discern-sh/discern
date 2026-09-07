/** Bounded complete byte capture. No path is removed by this module. */
import type { z } from "@zod/zod";
import { dirname, join } from "@std/path";
import { encodeBase64 } from "@std/encoding/base64";
import { runGit } from "../../shared/subprocess.ts";
import { sha256Hex } from "../../shared/sha256.ts";
import { gitPathRecord, splitNulRecords } from "../../shared/git_paths.ts";
import type { Scheduler } from "../../shared/scheduler.ts";
import {
  CheckoutPathSchema,
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
  options: {
    readonly allowedExitCodes?: readonly number[];
    readonly scheduler?: Scheduler;
  } = {},
): Promise<string> {
  const result = await runGit(args, {
    cwd: path,
    env: { GIT_OPTIONAL_LOCKS: "0" },
    timeoutMs: bounds.gitTimeoutMs,
    maxOutputBytes: bounds.maxBytes,
    quiesceDescendants: true,
    ...(options.scheduler !== undefined
      ? { scheduler: options.scheduler }
      : {}),
  });
  if (
    !result.success &&
    (result.timedOut || result.outputLimitExceeded ||
      !options.allowedExitCodes?.includes(result.code))
  ) {
    const facts = [`exit ${result.code}`];
    if (result.timedOut) facts.push(`time limit ${bounds.gitTimeoutMs} ms`);
    if (result.outputLimitExceeded) {
      facts.push(`output limit ${bounds.maxBytes} bytes`);
    }
    const detail = result.stderr.trim();
    throw new Error(
      `Git ${args[0]} failed (${facts.join("; ")})${
        detail === "" ? "." : `: ${detail}`
      } Preserve the environment for recovery.`,
    );
  }
  return result.stdout;
}

/** An intermediate symlink could make a familiar leaf refer outside the checkout. */
export async function containedFile(
  root: string,
  path: string,
): Promise<string> {
  if (!CheckoutPathSchema.safeParse(path).success) {
    throw new Error(
      `Invalid checkout capture path ${
        JSON.stringify(path)
      }: checkout file must be a literal relative path outside Git administration.`,
    );
  }
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

/** Combined commands retain the original byte ceiling for every observation. */
function checkObservationBytes(
  command: string,
  observations: readonly string[],
  bounds: CaptureBounds,
): void {
  if (
    observations.some((value) =>
      new TextEncoder().encode(value).length > bounds.maxBytes
    )
  ) {
    throw new Error(
      `Git ${command} exceeded the output limit ${bounds.maxBytes} bytes. Preserve the environment for recovery.`,
    );
  }
}

/** Keep raw index and staged binary patches as well as present working bytes. */
async function captureOnce(
  root: string,
  bounds: CaptureBounds,
): Promise<GitSnapshot> {
  const git = (args: string[]): Promise<string> =>
    executionGit(root, args, bounds);
  const identity = await executionGit(root, [
    "rev-parse",
    "HEAD",
    "HEAD^{tree}",
    "--symbolic-full-name",
    "HEAD",
  ], {
    ...bounds,
    maxBytes: Math.min(Number.MAX_SAFE_INTEGER, bounds.maxBytes * 3),
  });
  const fields = identity.split("\n");
  const [rawHead, rawTree, rawBranch, terminator] = fields;
  if (
    fields.length !== 4 || rawHead === undefined || rawTree === undefined ||
    rawBranch === undefined || terminator !== ""
  ) {
    throw new Error(
      "Git returned incomplete checkout identity fields. Preserve the environment for recovery.",
    );
  }
  checkObservationBytes(
    "rev-parse",
    fields.slice(0, 3).map((value) => `${value}\n`),
    bounds,
  );
  const head = rawHead.trim();
  const tree = rawTree.trim();
  const branch = rawBranch === "HEAD" ? "" : rawBranch.trim();
  const gitDir = (await git(["rev-parse", "--absolute-git-dir"])).trim();
  const indexPath = join(gitDir, "index");
  const taggedIndex = await executionGit(root, [
    "ls-files",
    "--stage",
    "-v",
    "-z",
  ], {
    ...bounds,
    maxBytes: Math.min(Number.MAX_SAFE_INTEGER, bounds.maxBytes * 2),
  });
  const entries = splitNulRecords(taggedIndex);
  if (
    entries.some((entry) => !/^[A-Za-z?] \d+ [0-9a-f]+ [0-3]\t/u.test(entry))
  ) {
    throw new Error(
      "Git returned incomplete index fields. Preserve the environment for recovery.",
    );
  }
  const indexEntries = entries.map((entry) => `${entry.slice(2)}\0`).join("");
  const indexFlags = entries.map((entry) =>
    `${entry.slice(0, 2)}${entry.slice(entry.indexOf("\t") + 1)}\0`
  ).join("");
  checkObservationBytes("ls-files", [indexEntries, indexFlags], bounds);
  if (
    splitNulRecords(indexFlags).some((entry) => /^[a-zS] /u.test(entry)) ||
    (await git(["rev-parse", "--shared-index-path"])).trim() !== ""
  ) {
    throw new Error(
      "Assumed-unchanged, sparse, or split indexes require their own restoration contract; preserve the checkout and normalize its index before release.",
    );
  }
  if (
    splitNulRecords(indexEntries).some((entry) =>
      entry.startsWith("160000 ") || /^\d+ [0-9a-f]+ [123]\t/u.test(entry)
    )
  ) {
    throw new Error(
      "Submodules or unresolved index stages need their own capture contract; this environment is unavailable.",
    );
  }
  const names = new Set(
    splitNulRecords(
      await git([
        "ls-files",
        "--cached",
        "--others",
        "--exclude-standard",
        "-z",
      ]),
    ),
  );
  const ignored = new Set(
    splitNulRecords(
      await git([
        "ls-files",
        "--others",
        "--ignored",
        "--exclude-standard",
        "-z",
      ]),
    ),
  );
  for (const path of ignored) names.add(path);
  if (names.size > bounds.maxFiles) {
    throw new Error(
      "Capture file limit reached; retain the checkout and increase the explicit capture bound.",
    );
  }
  const budget = { remaining: bounds.maxBytes };
  const files = [];
  const repositories: NonNullable<GitSnapshot["opaque_ignored_repositories"]> =
    [];
  for (const label of [...names].sort()) {
    const entry = gitPathRecord(label);
    if (entry.kind === "file") {
      files.push(
        await captureFile(root, entry.path, ignored.has(label), budget),
      );
      continue;
    }
    const target = await containedFile(root, entry.path);
    const directory = await Deno.lstat(target).catch(() => {
      throw new Error(
        `Git directory record ${
          JSON.stringify(label)
        } disappeared during capture. Preserve the checkout and retry after writers stop.`,
      );
    });
    if (!directory.isDirectory || directory.isSymlink || !ignored.has(label)) {
      throw new Error(
        `Capture cannot preserve Git directory record ${
          JSON.stringify(label)
        } as an ignored repository. Keep this path intact and reconcile its ownership before retrying.`,
      );
    }
    const administration = await Deno.lstat(join(target, ".git")).catch(() => {
      throw new Error(
        `Git directory record ${
          JSON.stringify(label)
        } has no readable repository administration. Preserve this path for reconciliation.`,
      );
    });
    if (
      administration.isSymlink ||
      (!administration.isFile && !administration.isDirectory)
    ) {
      throw new Error(
        `Nested repository administration at ${
          JSON.stringify(entry.path)
        } has no supported preservation contract. Keep it intact.`,
      );
    }
    repositories.push({
      path: entry.path,
      administration: administration.isDirectory ? "directory" : "file",
    });
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
    branch: branch === "" ? null : branch,
    git_dir: gitDir,
    index_path: indexPath,
    index,
    index_entries: indexEntries,
    staged_patch: stagedPatch,
    status: await git([
      "status",
      "--porcelain=v1",
      "-z",
      "--untracked-files=all",
      "--ignore-submodules=none",
    ]),
    files,
    ...(repositories.length
      ? { opaque_ignored_repositories: repositories }
      : {}),
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

/** Opaque repository boundaries authorize source-tip preservation, never temporary restoration or disposal. */
export function requireRestorableSnapshot(snapshot: GitSnapshot | null): void {
  const opaque = snapshot?.opaque_ignored_repositories?.[0];
  if (opaque !== undefined) {
    throw new Error(
      `Temporary execution cannot restore ignored nested repository ${
        JSON.stringify(opaque.path)
      } from checkout-file capture. Preserve its data and Git administration. Use source-tip validation, or reconcile this path outside the temporary environment before recovery; do not delete it to bypass capture.`,
    );
  }
}
