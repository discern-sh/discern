/**
 * Ignored-file drift detection for worktrees.
 *
 * Git cannot tell us whether ignored files were edited: ignored files are outside
 * the index by design. The honest signal is therefore a worktree-local baseline
 * recorded after discern finishes preparing the worktree, then a later comparison
 * before the worktree is removed. We report changed ignored roots only, collapsed
 * to top-level directories so generated trees do not flood the user.
 */

import { dirname, isAbsolute, join } from "@std/path";
import { runGit } from "../../shared/subprocess.ts";

const BASELINE_VERSION = 1;
const CHANGE_CAP = 20;

interface IgnoredRootFingerprint {
  path: string;
  kind: "file" | "dir" | "symlink" | "other" | "missing";
  digest: string;
  files: number;
  bytes: number;
}

interface IgnoredBaseline {
  version: 1;
  roots: IgnoredRootFingerprint[];
}

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
  const path = await ignoredBaselinePath(cwd);
  const roots = await snapshotIgnoredRoots(cwd);
  if (path === undefined || roots === undefined) {
    return;
  }
  try {
    await Deno.stat(path);
    return;
  } catch (e) {
    if (!(e instanceof Deno.errors.NotFound)) {
      return;
    }
  }
  const baseline: IgnoredBaseline = { version: BASELINE_VERSION, roots };
  try {
    await Deno.mkdir(dirname(path), { recursive: true });
    await Deno.writeTextFile(path, `${JSON.stringify(baseline, null, 2)}\n`);
  } catch {
    // Best effort: a missing baseline makes graduate skip the drift warning rather
    // than fail setup or invent a noisy full ignored-file listing.
  }
}

/** Compare the current ignored roots with the setup-time baseline. */
export async function inspectIgnoredFileChanges(
  cwd: string,
  enabled: boolean,
): Promise<IgnoredFileChangeSummary> {
  if (!enabled) {
    return ignoredFileDriftDisabled();
  }
  const path = await ignoredBaselinePath(cwd);
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
  const current = await snapshotIgnoredRoots(cwd);
  if (current === undefined) {
    return unavailable();
  }

  const previous = new Map(baseline.roots.map((root) => [root.path, root]));
  const changed = current
    .filter((root) => previous.get(root.path)?.digest !== root.digest)
    .map((root) => root.path)
    .sort();
  return {
    status: changed.length > 0 ? "changed" : "unchanged",
    changed_roots: changed.slice(0, CHANGE_CAP),
    changed_total: changed.length,
    truncated: changed.length > CHANGE_CAP,
  };
}

function unavailable(): IgnoredFileChangeSummary {
  return {
    status: "unavailable",
    changed_roots: [],
    changed_total: 0,
    truncated: false,
  };
}

async function ignoredBaselinePath(cwd: string): Promise<string | undefined> {
  const run = await runGit([
    "rev-parse",
    "--git-path",
    "discern-ignored-baseline",
  ], {
    cwd,
  });
  if (!run.success) {
    return undefined;
  }
  const raw = run.stdout.trim();
  if (raw === "") {
    return undefined;
  }
  return isAbsolute(raw) ? raw : join(cwd, raw);
}

async function readBaseline(
  path: string,
): Promise<IgnoredBaseline | undefined> {
  let raw: string;
  try {
    raw = await Deno.readTextFile(path);
  } catch {
    return undefined;
  }
  try {
    const parsed = JSON.parse(raw) as Partial<IgnoredBaseline>;
    if (parsed.version !== BASELINE_VERSION || !Array.isArray(parsed.roots)) {
      return undefined;
    }
    return {
      version: BASELINE_VERSION,
      roots: parsed.roots.filter(isFingerprint),
    };
  } catch {
    return undefined;
  }
}

function isFingerprint(value: unknown): value is IgnoredRootFingerprint {
  if (typeof value !== "object" || value === null) {
    return false;
  }
  const root = value as Partial<IgnoredRootFingerprint>;
  return typeof root.path === "string" &&
    typeof root.digest === "string" &&
    typeof root.files === "number" &&
    typeof root.bytes === "number";
}

async function snapshotIgnoredRoots(
  cwd: string,
): Promise<IgnoredRootFingerprint[] | undefined> {
  const roots = await listIgnoredRoots(cwd);
  if (roots === undefined) {
    return undefined;
  }
  const out: IgnoredRootFingerprint[] = [];
  for (const root of roots) {
    out.push(await fingerprintRoot(cwd, root));
  }
  return out.sort((a, b) => a.path.localeCompare(b.path));
}

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
      roots.add(await collapseIgnoredRoot(cwd, raw));
    }
  }
  return [...roots].sort();
}

async function collapseIgnoredRoot(cwd: string, raw: string): Promise<string> {
  const cleaned = raw.replace(/^\.\//, "");
  const [first] = cleaned.split("/");
  if (first !== undefined && first !== "" && cleaned.includes("/")) {
    try {
      const stat = await Deno.lstat(join(cwd, first));
      if (stat.isDirectory) {
        return `${first}/`;
      }
    } catch {
      // Fall back to the exact git-reported path below.
    }
  }
  return cleaned;
}

async function fingerprintRoot(
  cwd: string,
  label: string,
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
      digest: await hashText(`missing\0${label}`),
      files: 0,
      bytes: 0,
    };
  }
  if (stat.isDirectory) {
    const tree = await fingerprintDirectory(abs, rel);
    return { path: ensureDirLabel(label), kind: "dir", ...tree };
  }
  if (stat.isSymlink) {
    let target = "";
    try {
      target = await Deno.readLink(abs);
    } catch {
      target = "<unreadable>";
    }
    return {
      path: label,
      kind: "symlink",
      digest: await hashText(`symlink\0${label}\0${target}`),
      files: 1,
      bytes: 0,
    };
  }
  if (stat.isFile) {
    const bytes = await Deno.readFile(abs);
    return {
      path: label,
      kind: "file",
      digest: await hashBytes(bytes, `file\0${label}\0`),
      files: 1,
      bytes: stat.size,
    };
  }
  return {
    path: label,
    kind: "other",
    digest: await hashText(`other\0${label}\0${stat.size}`),
    files: 1,
    bytes: stat.size,
  };
}

function ensureDirLabel(label: string): string {
  return label.endsWith("/") ? label : `${label}/`;
}

async function fingerprintDirectory(
  absRoot: string,
  relRoot: string,
): Promise<{ digest: string; files: number; bytes: number }> {
  const parts: string[] = [];
  let files = 0;
  let bytes = 0;

  async function walk(abs: string, rel: string): Promise<void> {
    let entries: Deno.DirEntry[];
    try {
      entries = [];
      for await (const entry of Deno.readDir(abs)) {
        entries.push(entry);
      }
    } catch {
      parts.push(`unreadable-dir\0${rel}`);
      return;
    }
    entries.sort((a, b) => a.name.localeCompare(b.name));
    for (const entry of entries) {
      const childAbs = join(abs, entry.name);
      const childRel = `${rel}/${entry.name}`;
      let stat: Deno.FileInfo;
      try {
        stat = await Deno.lstat(childAbs);
      } catch {
        parts.push(`missing\0${childRel}`);
        continue;
      }
      if (stat.isDirectory) {
        await walk(childAbs, childRel);
      } else if (stat.isSymlink) {
        let target = "";
        try {
          target = await Deno.readLink(childAbs);
        } catch {
          target = "<unreadable>";
        }
        files += 1;
        parts.push(`symlink\0${childRel}\0${target}`);
      } else if (stat.isFile) {
        const data = await Deno.readFile(childAbs);
        files += 1;
        bytes += stat.size;
        parts.push(`file\0${childRel}\0${await sha256Hex(data)}`);
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

async function hashText(text: string): Promise<string> {
  return await sha256Hex(new TextEncoder().encode(text));
}

async function sha256Hex(bytes: Uint8Array): Promise<string> {
  const stable = new Uint8Array(bytes.byteLength);
  stable.set(bytes);
  const digest = await crypto.subtle.digest("SHA-256", stable.buffer);
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}
