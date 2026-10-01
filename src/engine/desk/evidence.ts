/**
 * Tier-two evidence for the settled selection: the commits a task or branch
 * holds beyond the trunk, the files they change, a dirty checkout's
 * uncommitted files, and a failed task's last recorded failure.
 *
 * The status survey carries none of these, so the inspector reads them for
 * the one item the owner settled on: at most three Git commands, each with a
 * timeout, through an injected runner, and the retained operation record for
 * a failed run. Each section fails on its own. Each part of the evidence is
 * kept by only the facts that change it: the committed part (commits and
 * files) by the head and the trunk's head, the uncommitted part by the dirty
 * stamp, and the failure by the run that failed. So an agent's edits re-read
 * only the uncommitted files, and the committed sections never blink back
 * to Reading… while it works. Each part keeps the 32 most recently used
 * items, and returning to a task whose head has not moved reads nothing.
 */

import { parsePorcelainZ, splitNulRecords } from "../../shared/git_paths.ts";
import type { StatusData } from "../../shared/result_schemas.ts";
import type { DeskRow } from "./model.ts";

/** Commits listed per item; more are counted, not shown. */
export const DESK_EVIDENCE_COMMITS = 20;

/** Changed files kept per item, largest first. */
export const DESK_EVIDENCE_FILES = 200;

/** Each Git read gives up after this long. */
export const DESK_EVIDENCE_TIMEOUT_MS = 2_000;

/** Items whose evidence each part of the cache keeps. */
export const DESK_EVIDENCE_CACHE_SIZE = 32;

/** One commit beyond the trunk. */
export interface DeskCommit {
  readonly sha: string;
  readonly subject: string;
  /** Committer time, ISO 8601. */
  readonly at?: string;
}

/** One changed path and its line counts; binary files have none. */
export interface DeskFileStat {
  readonly path: string;
  readonly status: "added" | "removed" | "updated";
  readonly added?: number;
  readonly removed?: number;
}

/** One failure the last run recorded. */
export interface DeskFailureEvidence {
  readonly name: string;
  readonly message: string;
  readonly file?: string;
  readonly line?: number;
}

/** One section's read: what it found, or why it couldn't. */
export type DeskEvidenceSection<T> =
  | { readonly state: "ready"; readonly value: T }
  | { readonly state: "failed"; readonly error: string };

/**
 * What an item's evidence shows: each section once it has been read, and
 * absent until then.
 */
export interface DeskEvidence {
  readonly commits?: DeskEvidenceSection<readonly DeskCommit[]>;
  readonly files?: DeskEvidenceSection<readonly DeskFileStat[]>;
  /** Present when the checkout had uncommitted files. */
  readonly uncommitted?: DeskEvidenceSection<readonly DeskFileStat[]>;
  /** Present for a failed run; empty when no record was retained. */
  readonly failure?: DeskEvidenceSection<readonly DeskFailureEvidence[]>;
}

/** The parts evidence is read and kept in, each by its own facts. */
export const DESK_EVIDENCE_PARTS = [
  "committed",
  "uncommitted",
  "failure",
] as const;
export type DeskEvidencePart = (typeof DESK_EVIDENCE_PARTS)[number];

/** One read's parts: whichever it was asked for. */
export interface DeskEvidenceRead {
  readonly committed?: {
    readonly commits: DeskEvidenceSection<readonly DeskCommit[]>;
    readonly files: DeskEvidenceSection<readonly DeskFileStat[]>;
  };
  readonly uncommitted?: DeskEvidenceSection<readonly DeskFileStat[]>;
  readonly failure?: DeskEvidenceSection<readonly DeskFailureEvidence[]>;
}

/** The one item the slot reads, and every fact its evidence depends on. */
export interface DeskEvidenceSubject {
  /** Where Git runs: the task's checkout, or the main checkout for a branch. */
  readonly cwd: string;
  /** `HEAD` in a checkout, or a branch name. */
  readonly ref: string;
  readonly head?: string;
  readonly trunk: string;
  readonly trunkHead?: string;
  /** Present when the checkout has uncommitted files. */
  readonly dirty?: string;
  /** Present when the task's last run of a verb failed, and when it did. */
  readonly failed?: {
    readonly branch: string;
    readonly verb: string;
    readonly at: string;
  };
}

/** How evidence reaches Git and the operation journal. */
export interface DeskEvidenceReader {
  git(
    args: readonly string[],
    cwd: string,
    signal: AbortSignal,
  ): Promise<{ success: boolean; stdout: string; stderr: string }>;
  failures(
    branch: string,
    verb: string,
  ): Promise<readonly DeskFailureEvidence[] | undefined>;
}

/** The facts that change one part, as its cache key. */
function partKey(...facts: readonly string[]): string {
  return facts.join("\u0000");
}

/**
 * Each part's cache key: the committed part by the head and the trunk's
 * head, the uncommitted part by the dirty stamp, the failure by the run
 * that failed. A part the subject doesn't have has no key.
 */
export function evidenceKeys(
  subject: DeskEvidenceSubject,
): Readonly<Partial<Record<DeskEvidencePart, string>>> {
  return {
    committed: partKey(
      subject.cwd,
      subject.ref,
      subject.head ?? "",
      subject.trunk,
      subject.trunkHead ?? "",
    ),
    ...(subject.dirty === undefined
      ? {}
      : { uncommitted: partKey(subject.cwd, subject.dirty) }),
    ...(subject.failed === undefined ? {} : {
      failure: partKey(
        subject.failed.branch,
        subject.failed.verb,
        subject.failed.at,
      ),
    }),
  };
}

/** The trunk's head: the main checkout's registered commit. */
export function trunkHead(data: StatusData | undefined): string | undefined {
  return data?.fleet?.find((entry) => entry.is_main)?.registration?.head;
}

/** The evidence subject for a task row. */
export function taskEvidenceSubject(
  row: DeskRow,
  data: StatusData | undefined,
  trunk: string,
): DeskEvidenceSubject {
  const entry = row.entry;
  const head = entry.registration?.head;
  const trunkTip = trunkHead(data);
  const failed = entry.last_action?.outcome === "failed"
    ? entry.last_action
    : undefined;
  return {
    cwd: entry.path,
    ref: "HEAD",
    trunk,
    ...(head === undefined ? {} : { head }),
    ...(trunkTip === undefined ? {} : { trunkHead: trunkTip }),
    ...(entry.clean === false
      ? { dirty: `${entry.changed_files ?? "?"}@${entry.last_activity ?? ""}` }
      : {}),
    ...(failed === undefined || entry.branch === "" ? {} : {
      failed: { branch: entry.branch, verb: failed.verb, at: failed.at },
    }),
  };
}

/** The evidence subject for a branch without a checkout. */
export function branchEvidenceSubject(
  branch: string,
  root: string,
  data: StatusData | undefined,
  trunk: string,
): DeskEvidenceSubject {
  const head = data?.parked_tasks?.find((task) => task.branch === branch)
    ?.head;
  const trunkTip = trunkHead(data);
  return {
    cwd: root,
    ref: branch,
    trunk,
    ...(head === undefined ? {} : { head }),
    ...(trunkTip === undefined ? {} : { trunkHead: trunkTip }),
  };
}

/** Git's own diagnostic, or a sentence when it printed none. */
function gitError(result: { stderr: string }): string {
  return result.stderr.trim() || "Git returned a non-zero status.";
}

/** Parse `%h%x00%s%x00%cI` lines. */
export function parseCommits(output: string): DeskCommit[] {
  return output.split("\n").flatMap((line) => {
    const [sha, subject, at] = line.split("\u0000");
    if (sha === undefined || sha === "" || subject === undefined) return [];
    return [{ sha, subject, ...(at === undefined || at === "" ? {} : { at }) }];
  });
}

/** The change a raw status letter names. */
function fileStatus(letter: string): DeskFileStat["status"] {
  return letter.startsWith("A")
    ? "added"
    : letter.startsWith("D")
    ? "removed"
    : "updated";
}

/** Parse `git diff --raw --numstat -z`: raw records, then numstat records. */
export function parseFileStats(output: string): DeskFileStat[] {
  const fields = splitNulRecords(output);
  const statuses = new Map<string, DeskFileStat["status"]>();
  const counts = new Map<string, { added?: number; removed?: number }>();
  for (let index = 0; index < fields.length; index += 1) {
    const field = fields[index] ?? "";
    if (field.startsWith(":")) {
      const path = fields[index + 1];
      index += 1;
      if (path === undefined || path === "") continue;
      statuses.set(path, fileStatus(field.split(" ").at(-1) ?? "M"));
      continue;
    }
    const [added, removed, path] = field.split("\t");
    if (path === undefined || path === "") continue;
    const parsedAdded = Number(added);
    const parsedRemoved = Number(removed);
    counts.set(path, {
      ...(Number.isInteger(parsedAdded) ? { added: parsedAdded } : {}),
      ...(Number.isInteger(parsedRemoved) ? { removed: parsedRemoved } : {}),
    });
  }
  const files = [...statuses].map(([path, status]): DeskFileStat => ({
    path,
    status,
    ...(counts.get(path) ?? {}),
  }));
  const size = (file: DeskFileStat): number =>
    (file.added ?? 0) + (file.removed ?? 0);
  return files.sort((left, right) =>
    size(right) - size(left) || left.path.localeCompare(right.path)
  ).slice(0, DESK_EVIDENCE_FILES);
}

/** Parse `git status --porcelain=v1 -z` into changed files. */
function parseUncommitted(output: string): DeskFileStat[] {
  return parsePorcelainZ(output).map((entry) => ({
    path: entry.path,
    status: entry.status === "??" ? "added" : fileStatus(
      entry.status.replaceAll(" ", "") || "M",
    ),
  }));
}

/** Run one Git read into its section. */
async function section<T>(
  reader: DeskEvidenceReader,
  args: readonly string[],
  cwd: string,
  signal: AbortSignal,
  parse: (stdout: string) => T,
): Promise<DeskEvidenceSection<T>> {
  try {
    const result = await reader.git(args, cwd, signal);
    return result.success
      ? { state: "ready", value: parse(result.stdout) }
      : { state: "failed", error: gitError(result) };
  } catch (error) {
    return {
      state: "failed",
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

/**
 * Read the asked parts of one item's tier-two evidence: each section
 * succeeds or fails alone, and at most three Git commands run.
 */
export async function readSelectedEvidence(
  subject: DeskEvidenceSubject,
  reader: DeskEvidenceReader,
  signal: AbortSignal,
  parts: readonly DeskEvidencePart[] = DESK_EVIDENCE_PARTS,
): Promise<DeskEvidenceRead> {
  const range = `${subject.trunk}..${subject.ref}`;
  const committed = parts.includes("committed");
  const [commits, files, uncommitted, failure] = await Promise.all([
    committed
      ? section(
        reader,
        [
          "log",
          "--format=%h%x00%s%x00%cI",
          "-n",
          String(DESK_EVIDENCE_COMMITS),
          range,
        ],
        subject.cwd,
        signal,
        parseCommits,
      )
      : undefined,
    committed
      ? section(
        reader,
        [
          "diff",
          "--raw",
          "--numstat",
          "-z",
          "--no-renames",
          `${subject.trunk}...${subject.ref}`,
        ],
        subject.cwd,
        signal,
        parseFileStats,
      )
      : undefined,
    subject.dirty === undefined || !parts.includes("uncommitted")
      ? undefined
      : section(
        reader,
        ["status", "--porcelain=v1", "-z"],
        subject.cwd,
        signal,
        parseUncommitted,
      ),
    subject.failed === undefined || !parts.includes("failure")
      ? undefined
      : failures(reader, subject.failed.branch, subject.failed.verb),
  ]);
  return {
    ...(commits === undefined || files === undefined
      ? {}
      : { committed: { commits, files } }),
    ...(uncommitted === undefined ? {} : { uncommitted }),
    ...(failure === undefined ? {} : { failure }),
  };
}

/** The retained record's failures, or none when nothing was retained. */
async function failures(
  reader: DeskEvidenceReader,
  branch: string,
  verb: string,
): Promise<DeskEvidenceSection<readonly DeskFailureEvidence[]>> {
  try {
    return { state: "ready", value: await reader.failures(branch, verb) ?? [] };
  } catch (error) {
    return {
      state: "failed",
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

/** Whether a part's read is kept: a failed section is read again next time. */
function settled(value: DeskEvidencePartValue): boolean {
  const sections = value.part === "committed"
    ? [value.commits, value.files]
    : [value.section];
  return sections.every((section) => section.state === "ready");
}

/** One part's kept read. */
type DeskEvidencePartValue =
  | {
    readonly part: "committed";
    readonly commits: DeskEvidenceSection<readonly DeskCommit[]>;
    readonly files: DeskEvidenceSection<readonly DeskFileStat[]>;
  }
  | {
    readonly part: "uncommitted";
    readonly section: DeskEvidenceSection<readonly DeskFileStat[]>;
  }
  | {
    readonly part: "failure";
    readonly section: DeskEvidenceSection<readonly DeskFailureEvidence[]>;
  };

/** Evidence kept per part and key, most recently used last. */
export interface DeskEvidenceCache {
  readonly parts: Readonly<
    Record<
      DeskEvidencePart,
      readonly (readonly [string, DeskEvidencePartValue])[]
    >
  >;
}

/** A cache with nothing in it. */
export function emptyEvidenceCache(): DeskEvidenceCache {
  return { parts: { committed: [], uncommitted: [], failure: [] } };
}

/** One part's kept read for a key, if any. */
function kept(
  cache: DeskEvidenceCache,
  part: DeskEvidencePart,
  key: string | undefined,
): DeskEvidencePartValue | undefined {
  return key === undefined
    ? undefined
    : cache.parts[part].find(([candidate]) => candidate === key)?.[1];
}

/**
 * What the cache shows for a subject. The committed part and the failure
 * show only for their exact key; the uncommitted files show the checkout's
 * newest read while a new one is read, since every edit restamps them.
 */
export function cachedEvidence(
  cache: DeskEvidenceCache,
  subject: DeskEvidenceSubject,
): DeskEvidence {
  const keys = evidenceKeys(subject);
  const committed = kept(cache, "committed", keys.committed);
  const failure = kept(cache, "failure", keys.failure);
  const uncommitted = keys.uncommitted === undefined
    ? undefined
    : kept(cache, "uncommitted", keys.uncommitted) ??
      cache.parts.uncommitted.findLast(([key]) =>
        key.startsWith(partKey(subject.cwd, ""))
      )?.[1];
  return {
    ...(committed?.part === "committed"
      ? { commits: committed.commits, files: committed.files }
      : {}),
    ...(uncommitted?.part === "uncommitted"
      ? { uncommitted: uncommitted.section }
      : {}),
    ...(failure?.part === "failure" ? { failure: failure.section } : {}),
  };
}

/** The parts a subject still needs read: unkept, or kept only as a failure. */
export function evidenceToRead(
  cache: DeskEvidenceCache,
  subject: DeskEvidenceSubject,
): DeskEvidencePart[] {
  const keys = evidenceKeys(subject);
  return DESK_EVIDENCE_PARTS.filter((part) => {
    if (keys[part] === undefined) return false;
    const value = kept(cache, part, keys[part]);
    return value === undefined || !settled(value);
  });
}

/** One read part as the cache keeps it. */
function partValue(
  read: DeskEvidenceRead,
  part: DeskEvidencePart,
): DeskEvidencePartValue | undefined {
  switch (part) {
    case "committed":
      return read.committed === undefined
        ? undefined
        : { part, ...read.committed };
    case "uncommitted":
      return read.uncommitted === undefined
        ? undefined
        : { part, section: read.uncommitted };
    case "failure":
      return read.failure === undefined
        ? undefined
        : { part, section: read.failure };
  }
}

/**
 * Keep what a read found for a subject, and make every part the subject has
 * the most recently used, read now or kept from before; each part drops its
 * oldest beyond the cache size.
 */
export function rememberEvidence(
  cache: DeskEvidenceCache,
  subject: DeskEvidenceSubject,
  read: DeskEvidenceRead,
): DeskEvidenceCache {
  const keys = evidenceKeys(subject);
  const parts = { ...cache.parts };
  for (const part of DESK_EVIDENCE_PARTS) {
    const key = keys[part];
    const value = partValue(read, part) ?? kept(cache, part, key);
    if (key === undefined || value === undefined) continue;
    parts[part] = [
      ...parts[part].filter(([candidate]) => candidate !== key),
      [key, value] as const,
    ].slice(-DESK_EVIDENCE_CACHE_SIZE);
  }
  return { parts };
}
