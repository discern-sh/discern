import type { IgnoredFileChangeSummary } from "../../shared/ignored_file_changes.ts";
export type { IgnoredFileChangeSummary } from "../../shared/ignored_file_changes.ts";
/**
 * Ignored-file drift detection for worktrees.
 *
 * Git cannot tell us whether ignored files were edited: ignored files are outside
 * the index by design. The signal is therefore a worktree-local baseline recorded
 * after discern finishes preparing the worktree, then a later comparison before
 * the worktree is removed. Inspection keeps Git's exact ignored roots, and its
 * cost follows the number of roots Git reports, never what lies beneath them.
 *
 * A directory Git reports as ignored as a whole is opaque: only its presence is
 * recorded, and nothing inside it is ever listed or read. A dependency or build
 * tree therefore costs one entry however large it grows, on any filesystem.
 * Individually ignored files carry the signal. Each begins with metadata, and a
 * bounded budget upgrades the smallest to content hashes so a harmless rewrite
 * stays quiet. Only the final changed labels collapse to top-level directories,
 * keeping the human report quiet without broadening the inspection.
 */

import { dirname, join } from "@std/path";
import { z } from "@zod/zod";
import { atomicReplaceJson } from "../../shared/atomic_write.ts";
import { bestEffort } from "../../shared/best_effort.ts";
import { gitAdminStatePath } from "../../shared/git_admin_state.ts";
import { runGit } from "../../shared/subprocess.ts";
import { readTextIfExists } from "../../shared/fs_presence.ts";
import {
  inspectOnDiskJsonVersion,
  newerOnDiskFormatMessage,
  ON_DISK_FORMATS,
} from "../../shared/on_disk_formats.ts";

const BASELINE_VERSION = ON_DISK_FORMATS.ignoredBaseline.version;
const CHANGE_CAP = 20;
const CONTENT_HASH_BUDGET_BYTES = 16 * 1024 * 1024;
const CONTENT_HASH_BUDGET_FILES = 2_048;

/**
 * How one root was fingerprinted. `presence` records that an opaque directory
 * exists; `metadata` records one entry's own size, time, and identity;
 * `content` records a file's bytes.
 */
type FingerprintMode = "content" | "metadata" | "presence";

interface IgnoredRootFingerprint {
  path: string;
  kind: "file" | "dir" | "symlink" | "other" | "missing";
  mode: FingerprintMode;
  digest: string;
  bytes: number;
}

const ignoredRootFingerprintSchema = z.object({
  path: z.string(),
  kind: z.enum(["file", "dir", "symlink", "other", "missing"]),
  mode: z.enum(["content", "metadata", "presence"]),
  digest: z.string(),
  bytes: z.number(),
});

/** The complete versioned ignored-file baseline accepted from durable state. */
const ignoredBaselineSchema = z.object({
  version: z.literal(BASELINE_VERSION),
  roots: z.array(ignoredRootFingerprintSchema),
});

type IgnoredBaseline = z.infer<typeof ignoredBaselineSchema>;

/** The inert summary used when detection is switched off. */
export function ignoredFileDriftDisabled(): IgnoredFileChangeSummary {
  return {
    status: "disabled",
    changed_roots: [],
    changed_total: 0,
    truncated: false,
  };
}

/** True when a summary should be shown to a human. */
export function hasIgnoredFileChanges(
  summary: IgnoredFileChangeSummary,
): boolean {
  return summary.status === "changed" && summary.changed_total > 0;
}

/** Record the current ignored-root baseline for this worktree. Best effort. */
export async function recordIgnoredFileBaseline(
  cwd: string,
  enabled: boolean,
): Promise<void> {
  if (!enabled) {
    return;
  }
  const path = await gitAdminStatePath(cwd, "ignoredBaseline");
  if (path === undefined) {
    return;
  }
  // A valid baseline is immutable for the life of the worktree: re-entry must
  // not pay to fingerprint the roots merely to discover the file already exists.
  // An older/invalid schema is deliberately replaced so an upgrade cannot leave
  // a worktree permanently stuck with a baseline the inspector cannot read.
  const standing = await readBaseline(path);
  if (standing.status === "recorded" || standing.status === "newer") {
    return;
  }
  const roots = await snapshotIgnoredRoots(cwd);
  if (roots === undefined) {
    return;
  }
  const baseline: IgnoredBaseline = { version: BASELINE_VERSION, roots };
  await bestEffort("ignored-baseline-record", async () => {
    await Deno.mkdir(dirname(path), { recursive: true });
    await atomicReplaceJson(path, baseline, {
      mode: 0o666,
      sync: false,
      space: 2,
      trailingNewline: true,
    });
  });
}

/** Bind a removal review to the same bounded ignored-root fingerprints used by drift inspection. */
export async function ignoredRemovalFingerprint(
  cwd: string,
): Promise<string | undefined> {
  const roots = await snapshotIgnoredRoots(cwd);
  return roots === undefined
    ? undefined
    : await hashText(JSON.stringify(roots));
}

/** Compare the current ignored roots with the setup-time baseline. */
export async function inspectIgnoredFileChanges(
  cwd: string,
  enabled: boolean,
): Promise<IgnoredFileChangeSummary> {
  if (!enabled) {
    return ignoredFileDriftDisabled();
  }
  const path = await gitAdminStatePath(cwd, "ignoredBaseline");
  if (path === undefined) {
    return unavailable();
  }
  const baselineRead = await readBaseline(path);
  if (baselineRead.status === "newer") {
    return {
      status: "newer",
      changed_roots: [],
      changed_total: 0,
      truncated: false,
      reason: baselineRead.reason,
    };
  }
  if (baselineRead.status !== "recorded") {
    return {
      status: "baseline_missing",
      changed_roots: [],
      changed_total: 0,
      truncated: false,
    };
  }
  const baseline = baselineRead.baseline;
  const current = await snapshotIgnoredRoots(cwd, baseline);
  if (current === undefined) {
    return unavailable();
  }

  const previous = new Map(baseline.roots.map((root) => [root.path, root]));
  const next = new Map(current.map((root) => [root.path, root]));
  const exactRoots = new Set([...previous.keys(), ...next.keys()]);
  const changed = [
    ...new Set(
      [...exactRoots]
        .filter((path) => {
          const before = previous.get(path);
          const after = next.get(path);
          return before?.kind !== after?.kind || before?.mode !== after?.mode ||
            before?.digest !== after?.digest;
        })
        .map(collapseChangedRoot),
    ),
  ].sort();
  return {
    status: changed.length > 0 ? "changed" : "unchanged",
    changed_roots: changed.slice(0, CHANGE_CAP),
    changed_total: changed.length,
    truncated: changed.length > CHANGE_CAP,
  };
}

/** Represent an unreadable ignored-file comparison without alleging drift. */
function unavailable(): IgnoredFileChangeSummary {
  return {
    status: "unavailable",
    changed_roots: [],
    changed_total: 0,
    truncated: false,
  };
}

/** Load a versioned ignored-root baseline only when every fingerprint is valid. */
type IgnoredBaselineRead =
  | { readonly status: "recorded"; readonly baseline: IgnoredBaseline }
  | { readonly status: "missing" | "malformed" }
  | { readonly status: "newer"; readonly reason: string };

/** Inspect the ignored-root baseline without collapsing forward skew. */
async function readBaseline(
  path: string,
): Promise<IgnoredBaselineRead> {
  const raw = await readTextIfExists(path);
  if (raw === undefined) return { status: "missing" };
  const version = inspectOnDiskJsonVersion("ignoredBaseline", raw);
  if (version.status === "newer") {
    return {
      status: "newer",
      reason: newerOnDiskFormatMessage("ignoredBaseline", version.found),
    };
  }
  try {
    const parsed: unknown = JSON.parse(raw);
    const result = ignoredBaselineSchema.safeParse(parsed);
    return result.success
      ? { status: "recorded", baseline: result.data }
      : { status: "malformed" };
  } catch (error) {
    if (!(error instanceof SyntaxError)) throw error;
    // discern-best-effort: ignored-baseline-decode-fallback
    return { status: "malformed" };
  }
}

/** Fingerprint Git's current ignored roots, promoting eligible files to bounded content hashes. */
async function snapshotIgnoredRoots(
  cwd: string,
  baseline?: IgnoredBaseline,
): Promise<IgnoredRootFingerprint[] | undefined> {
  const roots = await listIgnoredRoots(cwd);
  if (roots === undefined) {
    return undefined;
  }
  const metadata: IgnoredRootFingerprint[] = [];
  for (const root of roots) {
    metadata.push(await fingerprintRoot(cwd, root, "metadata"));
  }
  return await contentFingerprintWithinBudget(cwd, metadata, baseline);
}

/**
 * Read Git's NUL-delimited ignored entries and return stable root labels. In
 * `matching` mode Git names a directory that an ignore rule covers as one
 * entry and does not descend into it, so the listing is the inspection
 * boundary: one root per ignored directory, one per individually ignored file.
 */
async function listIgnoredRoots(cwd: string): Promise<string[] | undefined> {
  const run = await runGit([
    "status",
    "--porcelain=v1",
    "-z",
    "--ignored=matching",
    "--untracked-files=all",
  ], { cwd });
  if (!run.success) {
    return undefined;
  }
  const roots = new Set<string>();
  for (const record of run.stdout.split("\0")) {
    if (!record.startsWith("!! ")) {
      continue;
    }
    const raw = record.slice(3);
    if (raw !== "") {
      roots.add(raw.replace(/^\.\//, ""));
    }
  }
  return [...roots].sort();
}

/** Collapse nested ignored changes to their top-level directory for concise reporting. */
function collapseChangedRoot(raw: string): string {
  const cleaned = raw.replace(/^\.\//, "");
  const slash = cleaned.indexOf("/");
  if (slash > 0) {
    return `${cleaned.slice(0, slash)}/`;
  }
  return cleaned;
}

/**
 * Describe one ignored root from its own directory entry. A directory is
 * opaque: the fingerprint records that it exists and never opens it. A file is
 * described by bounded content or by its own metadata.
 */
async function fingerprintRoot(
  cwd: string,
  label: string,
  mode: "content" | "metadata",
  byteBudget = CONTENT_HASH_BUDGET_BYTES,
): Promise<IgnoredRootFingerprint> {
  const rel = label.endsWith("/") ? label.slice(0, -1) : label;
  const abs = join(cwd, rel);
  let stat: Deno.FileInfo;
  try {
    stat = await Deno.lstat(abs);
  } catch {
    return {
      path: label,
      kind: "missing",
      mode: "metadata",
      digest: await hashText(`missing\0${label}`),
      bytes: 0,
    };
  }
  if (stat.isDirectory) {
    const dirLabel = ensureDirLabel(label);
    return {
      path: dirLabel,
      kind: "dir",
      mode: "presence",
      digest: await hashText(`dir\0${dirLabel}`),
      bytes: 0,
    };
  }
  if (stat.isSymlink) {
    let target = "";
    try {
      target = await Deno.readLink(abs);
    } catch {
      // discern-best-effort: ignored-symlink-target-fallback
      target = "<unreadable>";
    }
    return {
      path: label,
      kind: "symlink",
      mode: "metadata",
      digest: await hashText(`symlink\0${label}\0${target}`),
      bytes: 0,
    };
  }
  if (stat.isFile) {
    if (mode === "content") {
      if (stat.size > byteBudget) {
        return await fingerprintRoot(cwd, label, "metadata");
      }
      try {
        const bytes = await Deno.readFile(abs);
        return {
          path: label,
          kind: "file",
          mode,
          digest: await hashBytes(bytes, `file\0${label}\0`),
          bytes: stat.size,
        };
      } catch {
        return await fingerprintRoot(cwd, label, "metadata");
      }
    }
    return {
      path: label,
      kind: "file",
      mode,
      digest: await hashText(fileMetadataPart(label, stat)),
      bytes: stat.size,
    };
  }
  return {
    path: label,
    kind: "other",
    mode: "metadata",
    digest: await hashText(`other\0${label}\0${stat.size}`),
    bytes: stat.size,
  };
}

/** Keep directory fingerprint labels distinguishable with a trailing slash. */
function ensureDirLabel(label: string): string {
  return label.endsWith("/") ? label : `${label}/`;
}

/** Encode size, modification time, and inode into one deterministic file record. */
function fileMetadataPart(path: string, stat: Deno.FileInfo): string {
  return `file\0${path}\0${stat.size}\0${stat.mtime?.getTime() ?? "unknown"}\0${
    stat.ino ?? "unknown"
  }`;
}

/** Spend one global I/O budget on the smallest eligible ignored files first. */
async function contentFingerprintWithinBudget(
  cwd: string,
  metadata: IgnoredRootFingerprint[],
  baseline?: IgnoredBaseline,
): Promise<IgnoredRootFingerprint[]> {
  const previous = new Map(
    (baseline?.roots ?? []).map((root) => [root.path, root]),
  );
  const candidates = metadata
    .filter((root) => {
      if (root.kind !== "file") {
        return false;
      }
      if (baseline === undefined) {
        return true;
      }
      // Inspection honours the baseline's chosen mode, so a file cannot become
      // a content read merely because it was compared by metadata at setup.
      return previous.get(root.path)?.mode === "content";
    })
    .sort((a, b) => a.bytes - b.bytes || a.path.localeCompare(b.path));
  let bytesLeft = CONTENT_HASH_BUDGET_BYTES;
  let filesLeft = CONTENT_HASH_BUDGET_FILES;
  const content = new Map<string, IgnoredRootFingerprint>();
  for (const candidate of candidates) {
    if (candidate.bytes > bytesLeft || filesLeft < 1) {
      continue;
    }
    // Reserve the candidate's whole observed cost before reading. A file that
    // races or becomes unreadable must not refund the budget and let later
    // failures multiply the supposedly bounded I/O.
    bytesLeft -= candidate.bytes;
    filesLeft -= 1;
    const fingerprint = await fingerprintRoot(
      cwd,
      candidate.path,
      "content",
      candidate.bytes,
    );
    if (fingerprint.mode !== "content") {
      continue;
    }
    content.set(candidate.path, fingerprint);
  }
  return metadata
    .map((root) => content.get(root.path) ?? root)
    .sort((a, b) => a.path.localeCompare(b.path));
}

/** Hash bytes with an optional domain-separating prefix. */
async function hashBytes(bytes: Uint8Array, prefix = ""): Promise<string> {
  if (prefix === "") {
    return await sha256Hex(bytes);
  }
  const encoded = new TextEncoder().encode(prefix);
  const combined = new Uint8Array(encoded.length + bytes.length);
  combined.set(encoded, 0);
  combined.set(bytes, encoded.length);
  return await sha256Hex(combined);
}

/** Encode text as UTF-8 before computing its stable SHA-256 digest. */
async function hashText(text: string): Promise<string> {
  return await sha256Hex(new TextEncoder().encode(text));
}

/** Copy input onto a stable buffer and render its SHA-256 digest in lowercase hex. */
async function sha256Hex(bytes: Uint8Array): Promise<string> {
  const stable = new Uint8Array(bytes.byteLength);
  stable.set(bytes);
  const digest = await crypto.subtle.digest("SHA-256", stable.buffer);
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

/** Render bounded ignored-file drift evidence for an acceptance plan. */
export function ignoredFileDetails(
  summary: IgnoredFileChangeSummary,
): string[] {
  if (summary.status !== "changed" || summary.changed_total === 0) {
    return [];
  }
  const more = summary.truncated
    ? `, +${summary.changed_total - summary.changed_roots.length} more`
    : "";
  return [
    `Ignored files changed since setup: ${
      summary.changed_roots.join(", ")
    }${more}`,
  ];
}
