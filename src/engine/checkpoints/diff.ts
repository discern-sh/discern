/**
 * Collect the **effort diff** the trigger engine evaluates: everything that
 * changed between the effort's merge-base with the trunk and the current
 * working tree — committed, staged, unstaged, and untracked alike — plus the
 * merge-base tree listing the name-similarity predicate compares against.
 *
 * Git speaks toplevel-relative paths and the engine speaks root-relative ones,
 * so every listing is read NUL-separated (the shared `git_paths.ts` decoders)
 * and normalized through the scope classifier's prefix helpers. Rename
 * detection stays OFF (`--no-renames`), matching the classifier: a rename is a
 * deletion plus an addition, so a vacated path never silently leaves the
 * change set.
 *
 * Returns `undefined` whenever git cannot answer — the caller FAILS OPEN (no
 * checkpoint fires on unknowable state); an unreadable or special untracked
 * path keeps unknown facts so only definitions that need them fail open.
 */

import { join } from "@std/path";
import { bestEffort } from "../../shared/best_effort.ts";
import { constants as FS_CONSTANTS } from "fs";
import { type FileHandle, open } from "fs/promises";
import { runGit } from "../../shared/subprocess.ts";
import { sha256Hex } from "../../shared/sha256.ts";
import { CHECKPOINT_PATTERN_LIMITS } from "../../shared/checkpoints.ts";
import { parsePorcelainZ, splitNulRecords } from "../../shared/git_paths.ts";
import { repoPathPrefix, stripRepoPathPrefix } from "../scopes/scopes.ts";
import {
  generatedGroupForPath,
  type ResolvedGeneratedGroup,
} from "../../shared/generated_artifacts.ts";
import type {
  EffortBasePath,
  EffortChangeKind,
  EffortDiff,
  EffortFileChange,
  ResolvedCheckpoint,
} from "./types.ts";
import { factCollectionPaths } from "./triggers.ts";

/** Bytes of an untracked file inspected for a NUL byte — git's own text/binary
 * heuristic window. */
const BINARY_SNIFF_BYTES = 8000;

/** A history this large is not a pre-flight fact; only history-aware entries
 * fail open when the ordered OID list exceeds this bound. */
const HISTORY_OUTPUT_BYTES = 4 * 1024 * 1024;

/** Open policy for branch-controlled untracked paths: never block on a raced
 * FIFO or device. Descriptor and post-open identity checks reject a symlink
 * replacement before the first read. */
export const UNTRACKED_OPEN_FLAGS = FS_CONSTANTS.O_RDONLY |
  FS_CONSTANTS.O_NONBLOCK;

const PLUS = 0x2b;
const MINUS = 0x2d;
const AT = 0x40;

/** Yield exact byte lines on LF, removing an immediately preceding CR. The
 * iterator keeps a newline storm from allocating every line before a caller
 * can enforce its fact-count boundary. */
function* byteLines(bytes: Uint8Array): Generator<Uint8Array> {
  let start = 0;
  for (let index = 0; index < bytes.length; index++) {
    if (bytes[index] === 0x0a) {
      let end = index;
      if (end > start && bytes[end - 1] === 0x0d) end--;
      yield bytes.subarray(start, end);
      start = index + 1;
    }
  }
  if (start < bytes.length) {
    let end = bytes.length;
    if (end > start && bytes[end - 1] === 0x0d) end--;
    yield bytes.subarray(start, end);
  }
}

/** Extract bounded added/removed payload lines from one zero-context patch. */
function patchContent(bytes: Uint8Array, maxLines: number):
  | { status: "available"; added: Uint8Array[]; removed: Uint8Array[] }
  | { status: "unavailable"; reason: "line_limit" | "line_count" } {
  const added: Uint8Array[] = [];
  const removed: Uint8Array[] = [];
  let inHunk = false;
  for (const line of byteLines(bytes)) {
    if (line[0] === AT && line[1] === AT) {
      inHunk = true;
      continue;
    }
    if (!inHunk || line.length === 0) continue;
    const marker = line[0];
    if (marker !== PLUS && marker !== MINUS) continue;
    const payload = line.slice(1);
    if (payload.length > CHECKPOINT_PATTERN_LIMITS.maxLineBytes) {
      return { status: "unavailable", reason: "line_limit" };
    }
    if (added.length + removed.length >= maxLines) {
      return { status: "unavailable", reason: "line_count" };
    }
    (marker === PLUS ? added : removed).push(payload);
  }
  return { status: "available", added, removed };
}

export interface UntrackedInspection {
  insertions: number;
  binary: boolean | "unknown";
  retained?: Uint8Array;
  contentReason?: "file_limit" | "total_bytes" | "unreadable";
}

/** File-handle operations used between the identity boundary and bounded
 * reads. Kept narrow so the replacement-race guard can inject an observable
 * opener without replacing filesystem state globally. */
export interface UntrackedFileHandle {
  stat(): Promise<{ isFile(): boolean; dev: number; ino: number }>;
  read(
    buffer: Uint8Array,
    offset: number,
    length: number,
    position: number | null,
  ): Promise<{ bytesRead: number }>;
  close(): Promise<void>;
}

/** Open one path for untracked fact inspection. */
export type UntrackedFileOpener = (
  path: string,
) => Promise<UntrackedFileHandle | undefined>;

interface AttemptedByteBudget {
  used: number;
}

interface ContentLineBudget {
  used: number;
}

/** The opened descriptor must still name the same regular file seen before
 * and after open. Checking before the first read closes the symlink-replacement
 * race without following branch-controlled target bytes. */
function sameFileIdentity(
  left: { dev: number; ino: number | null },
  right: { dev: number; ino: number | null },
): boolean {
  return left.ino !== null && right.ino !== null &&
    left.dev === right.dev && left.ino === right.ino;
}

/** Join retained read chunks into their exact bounded byte sequence. */
function concatenate(
  chunks: readonly Uint8Array[],
  length: number,
): Uint8Array {
  const out = new Uint8Array(length);
  let offset = 0;
  for (const chunk of chunks) {
    out.set(chunk, offset);
    offset += chunk.length;
  }
  return out;
}

/** Open one branch-controlled path as a nonblocking regular file. A FIFO or
 * device opens nonblocking and is rejected by fstat before any read. The
 * caller verifies descriptor identity against the path snapshots. */
async function openUntrackedRegular(
  path: string,
): Promise<UntrackedFileHandle | undefined> {
  let file: FileHandle;
  try {
    file = await open(path, UNTRACKED_OPEN_FLAGS);
  } catch {
    // discern-best-effort: checkpoint-untracked-open-fallback
    return undefined;
  }
  try {
    if (!(await file.stat()).isFile()) {
      await bestEffort(
        "checkpoint-untracked-nonregular-close",
        async () => await file.close(),
      );
      return undefined;
    }
    return file;
  } catch {
    await bestEffort(
      "checkpoint-untracked-stat-error-close",
      async () => await file.close(),
    );
    return undefined;
  }
}

/** Inspect an untracked regular file once with bounded retention. Symlinks and
 * special files stay unknown so no branch path can expose external bytes. */
async function inspectUntracked(
  path: string,
  need: "binary" | "line_stats" | "content",
  budget: AttemptedByteBudget,
  openFile: UntrackedFileOpener = openUntrackedRegular,
): Promise<UntrackedInspection> {
  if (budget.used >= CHECKPOINT_PATTERN_LIMITS.maxTotalBytes) {
    return {
      insertions: 0,
      binary: "unknown",
      contentReason: "total_bytes",
    };
  }
  let before: Deno.FileInfo;
  try {
    before = await Deno.lstat(path);
  } catch {
    return { insertions: 0, binary: "unknown", contentReason: "unreadable" };
  }
  if (!before.isFile || before.isSymlink) {
    return { insertions: 0, binary: "unknown", contentReason: "unreadable" };
  }
  const openedFile = await openFile(path);
  if (openedFile === undefined) {
    return { insertions: 0, binary: "unknown", contentReason: "unreadable" };
  }
  const file = openedFile;
  try {
    let opened: Awaited<ReturnType<UntrackedFileHandle["stat"]>>;
    let after: Deno.FileInfo;
    try {
      opened = await file.stat();
      after = await Deno.lstat(path);
    } catch {
      return {
        insertions: 0,
        binary: "unknown",
        contentReason: "unreadable",
      };
    }
    if (
      !opened.isFile() || after.isSymlink || !after.isFile ||
      !sameFileIdentity(before, opened) ||
      !sameFileIdentity(opened, after)
    ) {
      return {
        insertions: 0,
        binary: "unknown",
        contentReason: "unreadable",
      };
    }
    const localLimit = need === "binary"
      ? BINARY_SNIFF_BYTES
      : CHECKPOINT_PATTERN_LIMITS.maxFileBytes;
    const globalRemaining = CHECKPOINT_PATTERN_LIMITS.maxTotalBytes -
      budget.used;
    const attemptLimit = need === "binary"
      ? Math.min(localLimit, globalRemaining + 1)
      : Math.min(localLimit + 1, globalRemaining + 1);
    if (attemptLimit <= 0) {
      return {
        insertions: 0,
        binary: "unknown",
        contentReason: "total_bytes",
      };
    }
    const chunk = new Uint8Array(64 * 1024);
    const retained: Uint8Array[] = [];
    let bytes = 0;
    let newlines = 0;
    let last = -1;
    let binary = false;
    let eof = false;
    while (bytes < attemptLimit) {
      const { bytesRead: read } = await file.read(
        chunk,
        0,
        Math.min(chunk.length, attemptLimit - bytes),
        null,
      );
      if (read === 0) {
        eof = true;
        break;
      }
      for (let index = 0; index < read; index++) {
        const byte = chunk[index] ?? 0;
        if (bytes + index < BINARY_SNIFF_BYTES && byte === 0) binary = true;
        if (byte === 0x0a) newlines++;
        last = byte;
      }
      if (need === "content") retained.push(chunk.slice(0, read));
      bytes += read;
      budget.used += read;
      if (binary) break;
    }
    if (budget.used > CHECKPOINT_PATTERN_LIMITS.maxTotalBytes) {
      return {
        insertions: 0,
        binary: "unknown",
        contentReason: "total_bytes",
      };
    }
    if (binary) return { insertions: 0, binary: true };
    if (need === "binary") {
      return eof || bytes >= BINARY_SNIFF_BYTES
        ? { insertions: 0, binary: false }
        : {
          insertions: 0,
          binary: "unknown",
          contentReason: "total_bytes",
        };
    }
    if (bytes > CHECKPOINT_PATTERN_LIMITS.maxFileBytes) {
      return {
        insertions: 0,
        binary: "unknown",
        contentReason: "file_limit",
      };
    }
    // Reaching the limit exactly is not itself an overflow: one final read
    // distinguishes an exact-boundary file from one byte over.
    if (bytes === attemptLimit) {
      const probe = new Uint8Array(1);
      const { bytesRead: read } = await file.read(probe, 0, 1, null);
      if (read !== 0) {
        budget.used += read;
        return {
          insertions: 0,
          binary: "unknown",
          contentReason: budget.used > CHECKPOINT_PATTERN_LIMITS.maxTotalBytes
            ? "total_bytes"
            : "file_limit",
        };
      }
    }
    const insertions = binary ? 0 : bytes === 0 ? 0 : newlines +
      (last === 0x0a ? 0 : 1);
    return {
      insertions,
      binary,
      ...(need === "content" ? { retained: concatenate(retained, bytes) } : {}),
    };
  } catch {
    return { insertions: 0, binary: "unknown", contentReason: "unreadable" };
  } finally {
    await bestEffort(
      "checkpoint-untracked-inspection-close",
      async () => await file.close(),
    );
  }
}

/** Inspect one untracked path through an explicit open boundary. Callers that
 * need a controlled filesystem boundary can observe that identity rejection
 * happens before a read. */
export async function inspectUntrackedWithOpener(
  path: string,
  need: "binary" | "line_stats" | "content",
  openFile: UntrackedFileOpener,
): Promise<UntrackedInspection> {
  return await inspectUntracked(path, need, { used: 0 }, openFile);
}

/** Map one `--name-status` letter to the effort-diff change kind. Everything
 * that is neither an addition nor a deletion (modification, type change,
 * unmerged) reads as modified — the conservative kind. */
function changeKind(status: string): EffortChangeKind {
  if (status.startsWith("A")) {
    return "added";
  }
  if (status.startsWith("D")) {
    return "deleted";
  }
  return "modified";
}

/** Parse `git diff --name-status --no-renames -z` output: records alternate
 * STATUS, PATH (rename records would carry a second path, but rename
 * detection is off). */
function parseNameStatusZ(stdout: string): { status: string; path: string }[] {
  const tokens = splitNulRecords(stdout);
  const out: { status: string; path: string }[] = [];
  for (let i = 0; i + 1 < tokens.length; i += 2) {
    const status = tokens[i];
    const path = tokens[i + 1];
    if (status !== undefined && path !== undefined) {
      out.push({ status, path });
    }
  }
  return out;
}

/** Paths whose before/after mode is a Git link (submodule). Its content and
 * binary facts are not ordinary working-tree file facts. */
function parseGitlinksZ(stdout: string): Set<string> {
  const tokens = splitNulRecords(stdout);
  const paths = new Set<string>();
  for (let index = 0; index + 1 < tokens.length; index += 2) {
    const header = tokens[index] ?? "";
    const path = tokens[index + 1];
    const modes = /^:(\d+) (\d+) /.exec(header);
    if (
      path !== undefined && modes !== null &&
      (modes[1] === "160000" || modes[2] === "160000")
    ) {
      paths.add(path);
    }
  }
  return paths;
}

/** Parse one `--numstat -z` record: `<insertions> TAB <deletions> TAB <path>`,
 * `-` marking a binary side. A path may contain a TAB, so only the first two
 * separators are structural. */
function parseNumstatRecord(
  record: string,
):
  | { insertions: number; deletions: number; binary: boolean; path: string }
  | undefined {
  const first = record.indexOf("\t");
  const second = first === -1 ? -1 : record.indexOf("\t", first + 1);
  if (first === -1 || second === -1) {
    return undefined;
  }
  const ins = record.slice(0, first);
  const del = record.slice(first + 1, second);
  const binary = ins === "-" || del === "-";
  if (
    (!binary && (!/^\d+$/.test(ins) || !/^\d+$/.test(del))) ||
    (binary && (ins !== "-" || del !== "-"))
  ) {
    return undefined;
  }
  return {
    insertions: binary ? 0 : Number(ins),
    deletions: binary ? 0 : Number(del),
    binary,
    path: record.slice(second + 1),
  };
}

/** Whether Git's kind and line-stat protocols enumerate exactly the same
 * tracked paths. A disagreement makes every per-path fact suspect, so the
 * collector fails open instead of attaching guessed 0/0 text facts. */
export function trackedEnumerationAgrees(
  nameStatus: string,
  numstat: string,
): boolean {
  const named = parseNameStatusZ(nameStatus).map((entry) => entry.path).sort();
  const measured = splitNulRecords(numstat).map(parseNumstatRecord);
  if (measured.some((entry) => entry === undefined)) return false;
  const paths = measured.flatMap((entry) =>
    entry === undefined ? [] : [entry.path]
  ).sort();
  return named.length === paths.length &&
    named.every((path, index) => path === paths[index]);
}

/**
 * Collect the effort diff at `root` against `mergeBase` (the effort's
 * merge-base commit with the trunk — the same commit whose configuration
 * governs the checkpoints, so the diff and the policy describe one boundary).
 * `undefined` when git cannot answer.
 */
export async function collectEffortDiff(
  root: string,
  mergeBase: string,
  generatedGroups: readonly ResolvedGeneratedGroup[] = [],
  definitions: readonly ResolvedCheckpoint[] = [],
): Promise<EffortDiff | undefined> {
  const prefix = await repoPathPrefix(root);
  if (prefix === undefined) {
    return undefined;
  }

  // Tracked changes, merge-base → working tree, in one pass each for kind and
  // line stats. The two listings share flags, so they enumerate the same set.
  const nameStatus = await runGit(
    ["diff", "--name-status", "--no-renames", "-z", mergeBase],
    { cwd: root },
  );
  if (!nameStatus.success) {
    return undefined;
  }
  const numstat = await runGit(
    ["diff", "--numstat", "--no-renames", "-z", mergeBase],
    { cwd: root },
  );
  if (!numstat.success) {
    return undefined;
  }
  if (!trackedEnumerationAgrees(nameStatus.stdout, numstat.stdout)) {
    return undefined;
  }
  const raw = await runGit(
    ["diff", "--raw", "--no-renames", "-z", mergeBase],
    { cwd: root },
  );
  if (!raw.success) return undefined;
  const gitlinks = parseGitlinksZ(raw.stdout);
  const stats = new Map<
    string,
    { insertions: number; deletions: number; binary: boolean | "unknown" }
  >();
  for (const record of splitNulRecords(numstat.stdout)) {
    const parsed = parseNumstatRecord(record);
    if (parsed === undefined) return undefined;
    stats.set(parsed.path, {
      insertions: parsed.insertions,
      deletions: parsed.deletions,
      binary: parsed.binary,
    });
  }
  const files: EffortFileChange[] = [];
  const seen = new Set<string>();
  const untracked = new Set<string>();
  for (const entry of parseNameStatusZ(nameStatus.stdout)) {
    const [path] = stripRepoPathPrefix([entry.path], prefix);
    if (path === undefined || path === "" || seen.has(path)) {
      continue;
    }
    seen.add(path);
    const stat = stats.get(entry.path) ??
      { insertions: 0, deletions: 0, binary: false };
    files.push({
      path,
      generated: generatedGroupForPath(generatedGroups, path) !== undefined,
      kind: changeKind(entry.status),
      ...stat,
      ...(gitlinks.has(entry.path) ? { binary: "unknown" as const } : {}),
    });
  }

  // Untracked files are invisible to `git diff`; enumerate them individually
  // and inspect them once below. Unreadable/special paths remain unknown.
  const pending = await runGit(
    ["status", "--porcelain=v1", "-z", "--untracked-files=all"],
    { cwd: root },
  );
  if (!pending.success) {
    return undefined;
  }
  for (const entry of parsePorcelainZ(pending.stdout)) {
    if (entry.status !== "??") {
      continue; // tracked pending changes already arrived via `git diff`
    }
    const [path] = stripRepoPathPrefix([entry.path], prefix);
    if (path === undefined || path === "" || seen.has(path)) {
      continue;
    }
    seen.add(path);
    untracked.add(path);
    files.push({
      path,
      generated: generatedGroupForPath(generatedGroups, path) !== undefined,
      kind: "added",
      insertions: 0,
      deletions: 0,
      binary: "unknown",
    });
  }

  const baseTree = await runGit(
    ["ls-tree", "-r", "-z", "--name-only", mergeBase],
    { cwd: root },
  );
  if (!baseTree.success) {
    return undefined;
  }
  const baseFiles: EffortBasePath[] = stripRepoPathPrefix(
    splitNulRecords(baseTree.stdout),
    prefix,
  ).map((path) => ({
    path,
    generated: generatedGroupForPath(generatedGroups, path) !== undefined,
  }));
  let history: EffortDiff["history"];
  if (
    definitions.some((definition) =>
      definition.minCommits !== undefined || definition.when !== undefined
    )
  ) {
    const listed = await runGit(
      ["rev-list", "--reverse", "--topo-order", `${mergeBase}..HEAD`],
      { cwd: root, maxOutputBytes: HISTORY_OUTPUT_BYTES },
    );
    if (!listed.success) {
      history = {
        status: "unavailable",
        reason: listed.outputLimitExceeded ? "output_limit" : "git_failed",
      };
    } else {
      const commits = listed.stdout.split("\n").filter((line) => line !== "");
      if (
        !commits.every((oid) => /^(?:[0-9a-f]{40}|[0-9a-f]{64})$/.test(oid))
      ) {
        history = { status: "unavailable", reason: "git_failed" };
      } else {
        history = {
          status: "available",
          count: commits.length,
          commits,
          fingerprint: await sha256Hex(
            `checkpoint-history/v1\n${commits.join("\n")}`,
          ),
        };
      }
    }
  }

  const draft: EffortDiff = {
    files,
    baseFiles,
    ...(history === undefined ? {} : { history }),
  };
  const facts = factCollectionPaths(definitions, draft);
  // Direct collector callers without definitions retain the legacy complete
  // untracked stats contract. Production always supplies governing definitions
  // and therefore opens only paths an admitted predicate can consume.
  if (definitions.length === 0) {
    for (const path of untracked) {
      facts.binary.add(path);
      facts.lineStats.add(path);
    }
  }
  const budget: AttemptedByteBudget = { used: 0 };
  const lineBudget: ContentLineBudget = { used: 0 };
  const collectionOrder = [...files].sort((left, right) =>
    left.path < right.path ? -1 : left.path > right.path ? 1 : 0
  );
  for (const file of collectionOrder) {
    const needsContent = facts.content.has(file.path);
    if (
      needsContent &&
      lineBudget.used >= CHECKPOINT_PATTERN_LIMITS.maxContentLines
    ) {
      file.content = file.binary === true
        ? { status: "available", added: [], removed: [] }
        : { status: "unavailable", reason: "line_count" };
      continue;
    }
    if (untracked.has(file.path)) {
      if (!facts.binary.has(file.path)) continue;
      const inspection = await inspectUntracked(
        join(root, file.path),
        needsContent
          ? "content"
          : facts.lineStats.has(file.path)
          ? "line_stats"
          : "binary",
        budget,
      );
      file.insertions = inspection.insertions;
      file.binary = inspection.binary;
      if (!needsContent) continue;
      const bytes = inspection.retained;
      if (inspection.binary === true) {
        file.content = { status: "available", added: [], removed: [] };
        continue;
      }
      if (bytes === undefined) {
        file.content = {
          status: "unavailable",
          reason: inspection.contentReason ?? "unreadable",
        };
        continue;
      }
      const lines: Uint8Array[] = [];
      let reason: "line_limit" | "line_count" | undefined;
      const remainingLines = CHECKPOINT_PATTERN_LIMITS.maxContentLines -
        lineBudget.used;
      for (const line of byteLines(bytes)) {
        if (line.length > CHECKPOINT_PATTERN_LIMITS.maxLineBytes) {
          reason = "line_limit";
          break;
        }
        if (lines.length >= remainingLines) {
          reason = "line_count";
          break;
        }
        lines.push(line);
      }
      if (reason === undefined) {
        lineBudget.used += lines.length;
        file.content = { status: "available", added: lines, removed: [] };
      } else {
        if (reason === "line_count") {
          lineBudget.used = CHECKPOINT_PATTERN_LIMITS.maxContentLines;
        }
        file.content = { status: "unavailable", reason };
      }
      continue;
    }
    if (!needsContent) continue;
    if (file.binary === true) {
      file.content = { status: "available", added: [], removed: [] };
      continue;
    }
    if (file.binary === "unknown") {
      file.content = { status: "unavailable", reason: "unreadable" };
      continue;
    }
    if (budget.used >= CHECKPOINT_PATTERN_LIMITS.maxTotalBytes) {
      file.content = { status: "unavailable", reason: "total_bytes" };
      continue;
    }
    const remaining = CHECKPOINT_PATTERN_LIMITS.maxTotalBytes - budget.used;
    const attemptLimit = Math.min(
      CHECKPOINT_PATTERN_LIMITS.maxFileBytes + 1,
      remaining + 1,
    );
    const patch = await runGit(
      [
        "diff",
        "--no-ext-diff",
        "--no-textconv",
        "--no-renames",
        "--unified=0",
        "--no-color",
        mergeBase,
        "--",
        `:(top,literal)${prefix}${file.path}`,
      ],
      { cwd: root, maxOutputBytes: attemptLimit },
    );
    const stdout = patch.stdoutBytes ?? new TextEncoder().encode(patch.stdout);
    const stderr = patch.stderrBytes ?? new TextEncoder().encode(patch.stderr);
    const attempted = patch.outputLimitExceeded
      ? attemptLimit
      : stdout.length + stderr.length;
    budget.used += attempted;
    if (!patch.success) {
      file.content = {
        status: "unavailable",
        reason: patch.outputLimitExceeded
          ? budget.used > CHECKPOINT_PATTERN_LIMITS.maxTotalBytes ||
              attemptLimit < CHECKPOINT_PATTERN_LIMITS.maxFileBytes + 1
            ? "total_bytes"
            : "file_limit"
          : "unreadable",
      };
      continue;
    }
    const parsed = patchContent(
      stdout,
      CHECKPOINT_PATTERN_LIMITS.maxContentLines - lineBudget.used,
    );
    if (parsed.status === "unavailable") {
      if (parsed.reason === "line_count") {
        lineBudget.used = CHECKPOINT_PATTERN_LIMITS.maxContentLines;
      }
      file.content = parsed;
      continue;
    }
    if (
      parsed.added.length !== file.insertions ||
      parsed.removed.length !== file.deletions
    ) {
      file.content = { status: "unavailable", reason: "patch_mismatch" };
      continue;
    }
    lineBudget.used += parsed.added.length + parsed.removed.length;
    file.content = parsed;
  }
  return draft;
}
