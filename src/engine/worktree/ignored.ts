/**
 * Ignored-file drift detection for worktrees.
 *
 * Git cannot tell us whether ignored files were edited: ignored files are outside
 * the index by design. The signal is therefore a worktree-local baseline recorded
 * after discern finishes preparing the worktree, then a later comparison before
 * the worktree is removed. Inspection keeps Git's exact ignored roots and always
 * begins with metadata. A bounded budget upgrades small roots to content hashes so
 * harmless rematerialisation stays quiet; large roots remain metadata-only, making
 * their cost proportional to entries rather than bytes. Only the final changed
 * labels collapse to top-level directories, keeping the human report quiet without
 * broadening the filesystem scan.
 */

import { dirname, join } from "@std/path";
import { z } from "@zod/zod";
import { atomicReplaceJson } from "../../shared/atomic_write.ts";
import { bestEffort } from "../../shared/best_effort.ts";
import { gitAdminStatePath } from "../../shared/git_admin_state.ts";
import { runGit } from "../../shared/subprocess.ts";
import {
  lstatIfExists,
  readBytesIfExists,
  readDirIfExists,
  readLinkIfExists,
  readTextIfExists,
} from "../../shared/fs_presence.ts";

const BASELINE_VERSION = 2;
const CHANGE_CAP = 20;
const CONTENT_HASH_BUDGET_BYTES = 16 * 1024 * 1024;
const CONTENT_HASH_BUDGET_FILES = 2_048;

type FingerprintMode = "content" | "metadata";

interface IgnoredRootFingerprint {
  path: string;
  kind: "file" | "dir" | "symlink" | "other" | "missing";
  mode: FingerprintMode;
  digest: string;
  files: number;
  bytes: number;
}

const ignoredRootFingerprintSchema = z.object({
  path: z.string(),
  kind: z.enum(["file", "dir", "symlink", "other", "missing"]),
  mode: z.enum(["content", "metadata"]),
  digest: z.string(),
  files: z.number(),
  bytes: z.number(),
});

/** The complete versioned ignored-file baseline accepted from durable state. */
const ignoredBaselineSchema = z.object({
  version: z.literal(BASELINE_VERSION),
  roots: z.array(ignoredRootFingerprintSchema),
});

type IgnoredBaseline = z.infer<typeof ignoredBaselineSchema>;

export interface IgnoredFileChangeSummary {
  status:
    | "disabled"
    | "baseline_missing"
    | "unavailable"
    | "unchanged"
    | "changed";
  changed_roots: string[];
  changed_total: number;
  truncated: boolean;
}

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
  // not pay to fingerprint the tree merely to discover the file already exists.
  // An older/invalid schema is deliberately replaced so an upgrade cannot leave
  // a worktree permanently stuck with a baseline the inspector cannot read.
  if (await readBaseline(path) !== undefined) {
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
  const baseline = await readBaseline(path);
  if (baseline === undefined) {
    return {
      status: "baseline_missing",
      changed_roots: [],
      changed_total: 0,
      truncated: false,
    };
  }
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
async function readBaseline(
  path: string,
): Promise<IgnoredBaseline | undefined> {
  const raw = await readTextIfExists(path);
  if (raw === undefined) return undefined;
  try {
    const parsed: unknown = JSON.parse(raw);
    const result = ignoredBaselineSchema.safeParse(parsed);
    return result.success ? result.data : undefined;
  } catch (error) {
    if (!(error instanceof SyntaxError)) throw error;
    // discern-best-effort: ignored-baseline-decode-fallback
    return undefined;
  }
}

/** Fingerprint Git's current ignored roots, promoting eligible roots to bounded content hashes. */
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

/** Read Git's NUL-delimited ignored entries and return stable root labels. */
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

/** Describe an ignored root by kind and either bounded content or stable metadata. */
async function fingerprintRoot(
  cwd: string,
  label: string,
  mode: FingerprintMode,
  byteBudget = CONTENT_HASH_BUDGET_BYTES,
  fileBudget = CONTENT_HASH_BUDGET_FILES,
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
      files: 0,
      bytes: 0,
    };
  }
  if (stat.isDirectory) {
    const tree = mode === "content"
      ? await contentFingerprintDirectory(
        abs,
        rel,
        byteBudget,
        fileBudget,
      )
      : await metadataFingerprintDirectory(abs, rel);
    if (tree !== undefined) {
      return {
        path: ensureDirLabel(label),
        kind: "dir",
        mode,
        ...tree,
      };
    }
    return await fingerprintRoot(cwd, label, "metadata");
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
      files: 1,
      bytes: 0,
    };
  }
  if (stat.isFile) {
    if (mode === "content") {
      if (stat.size > byteBudget || fileBudget < 1) {
        return await fingerprintRoot(cwd, label, "metadata");
      }
      try {
        const bytes = await Deno.readFile(abs);
        return {
          path: label,
          kind: "file",
          mode,
          digest: await hashBytes(bytes, `file\0${label}\0`),
          files: 1,
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
      files: 1,
      bytes: stat.size,
    };
  }
  return {
    path: label,
    kind: "other",
    mode: "metadata",
    digest: await hashText(`other\0${label}\0${stat.size}`),
    files: 1,
    bytes: stat.size,
  };
}

/** Keep directory fingerprint labels distinguishable with a trailing slash. */
function ensureDirLabel(label: string): string {
  return label.endsWith("/") ? label : `${label}/`;
}

/** Hash a deterministic recursive inventory without reading file contents. */
async function metadataFingerprintDirectory(
  absRoot: string,
  relRoot: string,
): Promise<{ digest: string; files: number; bytes: number }> {
  const parts: string[] = [];
  let files = 0;
  let bytes = 0;

  /** Record a stable metadata entry for every descendant without reading contents. */
  async function walk(abs: string, rel: string): Promise<void> {
    const entries = await readDirIfExists(abs);
    if (entries === undefined) {
      parts.push(`missing-dir\0${rel}`);
      return;
    }
    entries.sort((a, b) => a.name.localeCompare(b.name));
    for (const entry of entries) {
      const childAbs = join(abs, entry.name);
      const childRel = `${rel}/${entry.name}`;
      const stat = await lstatIfExists(childAbs);
      if (stat === undefined) {
        parts.push(`missing\0${childRel}`);
        continue;
      }
      if (stat.isDirectory) {
        await walk(childAbs, childRel);
      } else if (stat.isSymlink) {
        const target = await readLinkIfExists(childAbs) ?? "<missing>";
        files += 1;
        parts.push(`symlink\0${childRel}\0${target}`);
      } else if (stat.isFile) {
        files += 1;
        bytes += stat.size;
        parts.push(fileMetadataPart(childRel, stat));
      } else {
        files += 1;
        bytes += stat.size;
        parts.push(`other\0${childRel}\0${stat.size}`);
      }
    }
  }

  await walk(absRoot, relRoot);
  return {
    digest: await hashText(parts.join("\n")),
    files,
    bytes,
  };
}

/** Encode size, modification time, and inode into one deterministic file record. */
function fileMetadataPart(path: string, stat: Deno.FileInfo): string {
  return `file\0${path}\0${stat.size}\0${stat.mtime?.getTime() ?? "unknown"}\0${
    stat.ino ?? "unknown"
  }`;
}

/** Spend one global I/O budget on the smallest eligible ignored roots first. */
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
      if (root.kind !== "file" && root.kind !== "dir") {
        return false;
      }
      if (baseline === undefined) {
        return true;
      }
      const before = previous.get(root.path);
      return before?.mode === "content" && before.kind === root.kind;
    })
    .sort((a, b) => {
      const aRank = a.kind === "file" ? 0 : 1;
      const bRank = b.kind === "file" ? 0 : 1;
      return aRank - bRank || a.bytes - b.bytes || a.files - b.files ||
        a.path.localeCompare(b.path);
    });
  let bytesLeft = CONTENT_HASH_BUDGET_BYTES;
  let filesLeft = CONTENT_HASH_BUDGET_FILES;
  const content = new Map<string, IgnoredRootFingerprint>();
  for (const candidate of candidates) {
    if (candidate.bytes > bytesLeft || candidate.files > filesLeft) {
      continue;
    }
    // Reserve the candidate's whole observed cost before reading. A root that
    // races, becomes unreadable, or aborts at its final member must not refund
    // the budget and let later failures multiply the supposedly bounded I/O.
    bytesLeft -= candidate.bytes;
    filesLeft -= candidate.files;
    const fingerprint = await fingerprintRoot(
      cwd,
      candidate.path,
      "content",
      candidate.bytes,
      candidate.files,
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

/** Hash a directory's contents deterministically or abandon it when the budget or a read fails. */
async function contentFingerprintDirectory(
  absRoot: string,
  relRoot: string,
  byteBudget: number,
  fileBudget: number,
): Promise<{ digest: string; files: number; bytes: number } | undefined> {
  const parts: string[] = [];
  let files = 0;
  let bytes = 0;

  /** Read descendants within the reserved budget and abort on any unstable input. */
  async function walk(abs: string, rel: string): Promise<boolean> {
    const entries = await readDirIfExists(abs);
    if (entries === undefined) return false;
    entries.sort((a, b) => a.name.localeCompare(b.name));
    for (const entry of entries) {
      const childAbs = join(abs, entry.name);
      const childRel = `${rel}/${entry.name}`;
      const stat = await lstatIfExists(childAbs);
      if (stat === undefined) return false;
      if (stat.isDirectory) {
        if (!(await walk(childAbs, childRel))) {
          return false;
        }
      } else if (stat.isSymlink) {
        if (files + 1 > fileBudget) {
          return false;
        }
        const target = await readLinkIfExists(childAbs);
        if (target === undefined) return false;
        files += 1;
        parts.push(`symlink\0${childRel}\0${target}`);
      } else if (stat.isFile) {
        if (files + 1 > fileBudget || bytes + stat.size > byteBudget) {
          return false;
        }
        const data = await readBytesIfExists(childAbs);
        if (data === undefined) return false;
        files += 1;
        bytes += stat.size;
        parts.push(`file\0${childRel}\0${await sha256Hex(data)}`);
      } else {
        if (files + 1 > fileBudget || bytes + stat.size > byteBudget) {
          return false;
        }
        files += 1;
        bytes += stat.size;
        parts.push(`other\0${childRel}\0${stat.size}`);
      }
    }
    return true;
  }

  if (!(await walk(absRoot, relRoot))) {
    return undefined;
  }
  return {
    digest: await hashText(parts.join("\n")),
    files,
    bytes,
  };
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
