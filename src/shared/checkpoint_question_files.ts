/**
 * Repository-backed checkpoint questions.
 *
 * The commit-tree reader consumes a regular blob from one named Git tree. It
 * never resolves a filesystem path, so a candidate checkout cannot replace a
 * governing question through an edit or a symbolic link. The live reader is
 * the strict authoring boundary: it requires the configured path to be a
 * regular tracked file and validates the same byte and UTF-8 limits before the
 * configuration is accepted.
 */

import { join } from "@std/path";
import { runGit } from "./subprocess.ts";

/** Largest repository-authored checkpoint question: 64 KiB of UTF-8 bytes. */
export const CHECKPOINT_QUESTION_FILE_MAX_BYTES = 64 * 1024;

/** Why one configured question file could not become judgment prose. */
export const CHECKPOINT_QUESTION_FILE_FAILURES = [
  "missing",
  "not_regular_blob",
  "not_tracked",
  "oversized",
  "invalid_utf8",
  "unreadable",
] as const;
export type CheckpointQuestionFileFailure =
  (typeof CHECKPOINT_QUESTION_FILE_FAILURES)[number];

/** One resolved file, retaining its exact decoded text and normalized path. */
export type CheckpointQuestionFileRead =
  | { ok: true; path: string; question: string }
  | {
    ok: false;
    path: string;
    reason: CheckpointQuestionFileFailure;
    detail?: string;
  };

/** Git modes whose tree entry is an ordinary file rather than a symlink. */
function regularBlobMode(mode: string): boolean {
  return mode === "100644" || mode === "100755";
}

/** Decode the authored bytes without replacement characters or newline edits. */
function decodeQuestion(
  path: string,
  bytes: Uint8Array,
): CheckpointQuestionFileRead {
  if (bytes.length > CHECKPOINT_QUESTION_FILE_MAX_BYTES) {
    return { ok: false, path, reason: "oversized" };
  }
  try {
    return {
      ok: true,
      path,
      question: new TextDecoder("utf-8", { fatal: true }).decode(bytes),
    };
  } catch {
    return { ok: false, path, reason: "invalid_utf8" };
  }
}

/** Split a NUL-delimited Git machine response without inventing empty rows. */
function nulRecords(value: string): string[] {
  return value.split("\0").filter((record) => record !== "");
}

/**
 * Read one question from the current checkout for strict live-config
 * validation. The path must be a regular file in both the filesystem and the
 * Git index; staged additions qualify, while ignored and untracked files do
 * not promise a future governing blob.
 */
export async function readLiveCheckpointQuestionFile(
  root: string,
  path: string,
): Promise<CheckpointQuestionFileRead> {
  let info: Deno.FileInfo;
  try {
    info = await Deno.lstat(join(root, path));
  } catch (error) {
    if (error instanceof Deno.errors.NotFound) {
      return { ok: false, path, reason: "missing" };
    }
    return {
      ok: false,
      path,
      reason: "unreadable",
      detail: error instanceof Error ? error.message : String(error),
    };
  }
  if (!info.isFile || info.isSymlink) {
    return { ok: false, path, reason: "not_regular_blob" };
  }
  if (info.size > CHECKPOINT_QUESTION_FILE_MAX_BYTES) {
    return { ok: false, path, reason: "oversized" };
  }

  const indexed = await runGit(
    ["--literal-pathspecs", "ls-files", "--stage", "-z", "--", path],
    { cwd: root, maxOutputBytes: 128 * 1024 },
  );
  if (!indexed.success) {
    return {
      ok: false,
      path,
      reason: "unreadable",
      detail: indexed.stderr,
    };
  }
  const records = nulRecords(indexed.stdout);
  if (records.length === 0) {
    return { ok: false, path, reason: "not_tracked" };
  }
  if (records.length !== 1) {
    return { ok: false, path, reason: "not_regular_blob" };
  }
  const record = records[0];
  if (record === undefined) {
    return { ok: false, path, reason: "not_regular_blob" };
  }
  const tab = record.indexOf("\t");
  const [mode, oid, stage] = tab === -1 ? [] : record.slice(0, tab).split(" ");
  if (
    mode === undefined || oid === undefined || stage !== "0" ||
    !regularBlobMode(mode) || /^0+$/.test(oid)
  ) {
    return { ok: false, path, reason: "not_regular_blob" };
  }

  try {
    return decodeQuestion(path, await Deno.readFile(join(root, path)));
  } catch (error) {
    return {
      ok: false,
      path,
      reason: "unreadable",
      detail: error instanceof Error ? error.message : String(error),
    };
  }
}

/**
 * Read one question from `commit` without consulting the checkout. `ls-tree`
 * establishes the regular-blob boundary and yields the object id; `cat-file`
 * then reads that immutable object under a 64-KiB-plus-one ceiling.
 */
export async function readCheckpointQuestionFileAtCommit(
  root: string,
  commit: string,
  path: string,
): Promise<CheckpointQuestionFileRead> {
  const listed = await runGit(
    ["--literal-pathspecs", "ls-tree", "-z", commit, "--", path],
    { cwd: root, maxOutputBytes: 128 * 1024 },
  );
  if (!listed.success) {
    return {
      ok: false,
      path,
      reason: "unreadable",
      detail: listed.stderr,
    };
  }
  const records = nulRecords(listed.stdout);
  if (records.length === 0) {
    return { ok: false, path, reason: "missing" };
  }
  if (records.length !== 1) {
    return { ok: false, path, reason: "not_regular_blob" };
  }
  const record = records[0];
  if (record === undefined) {
    return { ok: false, path, reason: "not_regular_blob" };
  }
  const tab = record.indexOf("\t");
  const [mode, type, oid] = tab === -1 ? [] : record.slice(0, tab).split(" ");
  if (
    mode === undefined || type !== "blob" || oid === undefined ||
    !regularBlobMode(mode)
  ) {
    return { ok: false, path, reason: "not_regular_blob" };
  }

  const shown = await runGit(["cat-file", "blob", oid], {
    cwd: root,
    maxOutputBytes: CHECKPOINT_QUESTION_FILE_MAX_BYTES + 1,
  });
  if (shown.outputLimitExceeded === true) {
    return { ok: false, path, reason: "oversized" };
  }
  if (!shown.success || shown.stdoutBytes === undefined) {
    return {
      ok: false,
      path,
      reason: "unreadable",
      detail: shown.stderr,
    };
  }
  return decodeQuestion(path, shown.stdoutBytes);
}

/** Product-facing account of one file failure at the named authority boundary. */
export function checkpointQuestionFileFailureMessage(
  read: Extract<CheckpointQuestionFileRead, { ok: false }>,
  authority: "live configuration" | "governing Git tree",
): string {
  const path = JSON.stringify(read.path);
  switch (read.reason) {
    case "missing":
      return `question file ${path} is missing from the ${authority}`;
    case "not_regular_blob":
      return `question file ${path} is not a regular Git blob in the ${authority}`;
    case "not_tracked":
      return `question file ${path} is not tracked in the Git index`;
    case "oversized":
      return `question file ${path} exceeds the ${CHECKPOINT_QUESTION_FILE_MAX_BYTES}-byte limit`;
    case "invalid_utf8":
      return `question file ${path} is not valid UTF-8`;
    case "unreadable":
      return `discern could not read question file ${path} from the ${authority}`;
  }
}
