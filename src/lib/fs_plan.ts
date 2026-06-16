/**
 * The scaffolding plan: a pure description of what `init`/`upgrade` will do to
 * disk, built *before* anything is written.
 *
 * Separating planning from execution buys three things the spec requires:
 *   - `--dry-run` renders the plan and touches nothing.
 *   - the review-and-confirm screen lists exactly what will be written/merged.
 *   - `init` is idempotent: re-planning sees what is already present and marks
 *     each op accordingly (create vs overwrite vs skip vs `.new`).
 *
 * A plan is a flat list of `PlanOp`s. The walker turns the templates tree into a
 * plan; the executor applies a plan (or, for dry-run, the caller just renders
 * it). Managed-file hashes are computed during planning because that is exactly
 * when the kit's intended bytes are known.
 */

import { ensureDir, walk } from "@std/fs";
import { dirname, join, relative, SEPARATOR } from "@std/path";
import {
  isContractExecutable,
  isGitignoreFragment,
  isSettingsTemplate,
  isTemplateFile,
  resolveTargetPath,
  substituteTokens,
  type TokenMap,
} from "./template.ts";
import {
  buildManifest,
  isManaged,
  type ManagedEntry,
  serializeManifest,
  sha256Hex,
} from "./manifest.ts";
import { mergeSettings } from "./settings_merge.ts";

/** How an op relates to whatever is already on disk at its target. */
export type OpDisposition =
  | "create" // target absent → will be created
  | "overwrite" // managed + pristine (or init seed re-create) → will be replaced
  | "skip" // seed already present, or fully-idempotent no-op
  | "new" // managed + user-edited → new content written to <path>.new
  | "merge" // settings.json deep-merge
  | "append"; // .gitignore fragment append

/** A single planned filesystem operation against one target path. */
export interface PlanOp {
  /** What the op does to the target. */
  kind: "write" | "merge-settings" | "append-gitignore";
  /** Target path relative to the destination root (forward-slashed). */
  targetRel: string;
  /** Absolute target path. */
  targetAbs: string;
  /** Resolved disposition vs what is already on disk. */
  disposition: OpDisposition;
  /** The exact bytes to write (for `write`; the post-merge bytes for settings/gitignore). */
  bytes: Uint8Array;
  /** Octal file mode to set after writing (preserves the source exec bit). */
  mode: number;
  /** True when the target path is a managed (upgrade-refreshed) file. */
  managed: boolean;
  /** sha256 of `bytes`, present for managed writes (recorded in the manifest). */
  sha256?: string;
  /** Human-readable note rendered in dry-run / review (e.g. "skip — seed present"). */
  note?: string;
}

/** A complete plan plus any token-drift warnings gathered while building it. */
export interface Plan {
  ops: PlanOp[];
  /** Map of target path → unknown token names found in its contents. */
  unknownTokens: Map<string, string[]>;
}

const TEXT_DECODER = new TextDecoder();
const TEXT_ENCODER = new TextEncoder();

/** Read a file's bytes, or undefined if it does not exist. */
async function readBytesIfExists(
  path: string,
): Promise<Uint8Array | undefined> {
  try {
    return await Deno.readFile(path);
  } catch (error) {
    if (error instanceof Deno.errors.NotFound) {
      return undefined;
    }
    throw error;
  }
}

/** The marker line that makes the .gitignore fragment append idempotent. */
const GITIGNORE_MARKER = "# --- icculus harness ---";

/**
 * Walk the templates tree and produce a complete plan for the given mode.
 *
 * @param templatesDir absolute path to the `templates/` tree to scaffold from
 * @param destDir      absolute destination root (the project being scaffolded)
 * @param tokens       resolved content tokens
 * @param mode         "init" (seeds are write-once) or "upgrade" (only managed,
 *                     hash-aware; seeds untouched)
 * @param recordedHash for "upgrade": a lookup of the manifest's recorded hash
 *                     for a managed target, to decide overwrite vs `.new`
 */
export async function buildPlan(params: {
  templatesDir: string;
  destDir: string;
  tokens: TokenMap;
  mode: "init" | "upgrade";
  recordedHash?: (targetRel: string) => string | undefined;
}): Promise<Plan> {
  const { templatesDir, destDir, tokens, mode, recordedHash } = params;
  const ops: PlanOp[] = [];
  const unknownTokens = new Map<string, string[]>();

  for await (const entry of walk(templatesDir, { includeDirs: false })) {
    const templateRel = relative(templatesDir, entry.path).replaceAll(
      SEPARATOR,
      "/",
    );

    if (isGitignoreFragment(templateRel)) {
      if (mode === "upgrade") {
        continue; // .gitignore is a SEED-style append; never touched on upgrade.
      }
      const op = await planGitignoreAppend(entry.path, destDir);
      ops.push(op);
      continue;
    }

    if (isSettingsTemplate(templateRel)) {
      if (mode === "upgrade") {
        continue; // settings.json is SEED (write-once merge); never touched on upgrade.
      }
      const op = await planSettingsMerge(
        entry.path,
        destDir,
        tokens,
        unknownTokens,
      );
      ops.push(op);
      continue;
    }

    const targetRel = resolveTargetPath(templateRel, tokens.project_slug);
    const managed = isManaged(targetRel);

    // On upgrade we only ever touch managed files.
    if (mode === "upgrade" && !managed) {
      continue;
    }

    const op = await planFileWrite({
      sourceAbs: entry.path,
      templateRel,
      targetRel,
      destDir,
      tokens,
      managed,
      mode,
      recordedHash,
      unknownTokens,
    });
    ops.push(op);
  }

  ops.sort((a, b) => a.targetRel.localeCompare(b.targetRel));
  return { ops, unknownTokens };
}

/** Plan a single content/verbatim file write, resolving its disposition. */
async function planFileWrite(params: {
  sourceAbs: string;
  templateRel: string;
  targetRel: string;
  destDir: string;
  tokens: TokenMap;
  managed: boolean;
  mode: "init" | "upgrade";
  recordedHash?: (targetRel: string) => string | undefined;
  unknownTokens: Map<string, string[]>;
}): Promise<PlanOp> {
  const { sourceAbs, templateRel, targetRel, destDir, tokens, managed, mode } =
    params;
  const sourceStat = await Deno.stat(sourceAbs);
  let sourceMode = (sourceStat.mode ?? 0o644) & 0o777;
  // The harness contract decides exec-ness for the dispatcher and recipes; OR
  // it in so the bit survives even when the source mode is unreliable (the
  // `deno compile` embedded filesystem reports every file as read-only).
  if (isContractExecutable(targetRel)) {
    sourceMode |= 0o755;
  }

  let bytes: Uint8Array;
  if (isTemplateFile(templateRel)) {
    const raw = TEXT_DECODER.decode(await Deno.readFile(sourceAbs));
    const { text, unknown } = substituteTokens(raw, tokens);
    if (unknown.length > 0) {
      params.unknownTokens.set(targetRel, unknown);
    }
    bytes = TEXT_ENCODER.encode(text);
  } else {
    // Verbatim copy: engine scripts are deliberately token-free.
    bytes = await Deno.readFile(sourceAbs);
  }

  const hash = await sha256Hex(bytes);
  const targetAbs = join(destDir, targetRel);
  const existing = await readBytesIfExists(targetAbs);

  // Decide the disposition.
  let disposition: OpDisposition;
  let outAbs = targetAbs;
  let outRel = targetRel;
  let note: string | undefined;

  if (existing === undefined) {
    disposition = "create";
  } else if (mode === "init") {
    if (managed) {
      // Re-running init over a managed file: refresh it (init is the source of truth).
      const existingHash = await sha256Hex(existing);
      disposition = existingHash === hash ? "skip" : "overwrite";
      if (disposition === "skip") {
        note = "unchanged";
      }
    } else {
      // SEED file already present: write-once, leave it.
      disposition = "skip";
      note = "seed present — left as-is";
    }
  } else {
    // upgrade mode, managed file present: hash-aware refresh.
    const existingHash = await sha256Hex(existing);
    const recorded = params.recordedHash?.(targetRel);
    if (existingHash === hash) {
      disposition = "skip";
      note = "already up to date";
    } else if (recorded !== undefined && existingHash === recorded) {
      // Pristine (matches what the kit last wrote): safe to overwrite.
      disposition = "overwrite";
    } else {
      // User-edited (or untracked): preserve, write the new version alongside.
      disposition = "new";
      outAbs = `${targetAbs}.new`;
      outRel = `${targetRel}.new`;
      note = "user-edited — new version written alongside";
    }
  }

  return {
    kind: "write",
    targetRel: outRel,
    targetAbs: outAbs,
    disposition,
    bytes,
    mode: sourceMode,
    managed,
    sha256: hash,
    note,
  };
}

/** Plan the deep-merge of the settings template into the project's settings. */
async function planSettingsMerge(
  sourceAbs: string,
  destDir: string,
  tokens: TokenMap,
  unknownTokens: Map<string, string[]>,
): Promise<PlanOp> {
  const raw = TEXT_DECODER.decode(await Deno.readFile(sourceAbs));
  const { text, unknown } = substituteTokens(raw, tokens);
  const targetRel = ".claude/settings.json";
  if (unknown.length > 0) {
    unknownTokens.set(targetRel, unknown);
  }
  const incoming: unknown = JSON.parse(text);

  const targetAbs = join(destDir, targetRel);
  const existingRaw = await readBytesIfExists(targetAbs);
  const existing: unknown = existingRaw === undefined
    ? {}
    : JSON.parse(TEXT_DECODER.decode(existingRaw));

  const merged = mergeSettings(existing, incoming);
  const bytes = TEXT_ENCODER.encode(`${JSON.stringify(merged, null, 2)}\n`);

  const present = existingRaw !== undefined;
  return {
    kind: "merge-settings",
    targetRel,
    targetAbs,
    disposition: "merge",
    bytes,
    mode: 0o644,
    managed: false,
    note: present ? "deep-merge into existing settings" : "create settings",
  };
}

/** Plan the idempotent append of the .gitignore fragment. */
async function planGitignoreAppend(
  sourceAbs: string,
  destDir: string,
): Promise<PlanOp> {
  const fragment = TEXT_DECODER.decode(await Deno.readFile(sourceAbs));
  const targetRel = ".gitignore";
  const targetAbs = join(destDir, targetRel);
  const existingRaw = await readBytesIfExists(targetAbs);
  const existing = existingRaw === undefined
    ? ""
    : TEXT_DECODER.decode(existingRaw);

  if (existing.includes(GITIGNORE_MARKER)) {
    // Already appended: produce a skip op carrying the unchanged bytes.
    return {
      kind: "append-gitignore",
      targetRel,
      targetAbs,
      disposition: "skip",
      bytes: existingRaw ?? new Uint8Array(),
      mode: 0o644,
      managed: false,
      note: "harness fragment already present",
    };
  }

  // Append with a single separating newline when the file is non-empty and does
  // not already end in one.
  let prefix = existing;
  if (prefix.length > 0 && !prefix.endsWith("\n")) {
    prefix += "\n";
  }
  if (prefix.length > 0) {
    prefix += "\n";
  }
  const combined = prefix + fragment;
  return {
    kind: "append-gitignore",
    targetRel,
    targetAbs,
    disposition: existingRaw === undefined ? "create" : "append",
    bytes: TEXT_ENCODER.encode(combined),
    mode: 0o644,
    managed: false,
    note: existingRaw === undefined
      ? "create .gitignore"
      : "append harness fragment",
  };
}

/**
 * Build the op for `.icculus/brief.md` — a SEED file: written once with a short
 * header, never overwritten if already present (preserves any edits the user or
 * `/bootstrap` made).
 */
export async function planBrief(
  destDir: string,
  brief: string,
): Promise<PlanOp> {
  const targetRel = ".icculus/brief.md";
  const targetAbs = join(destDir, targetRel);
  const body = brief.trimEnd();
  const content = `# Project brief\n\n` +
    `<!-- Captured at \`icculus init\`. Read by the /bootstrap skill to seed\n` +
    `     principles, guidelines, and docs. Edit freely. -->\n\n` +
    `${
      body.length > 0 ? body : "_(no description given at init — fill this in)_"
    }\n`;
  const bytes = TEXT_ENCODER.encode(content);
  const existing = await readBytesIfExists(targetAbs);
  return {
    kind: "write",
    targetRel,
    targetAbs,
    disposition: existing === undefined ? "create" : "skip",
    bytes,
    mode: 0o644,
    managed: false,
    note: existing === undefined ? undefined : "seed present — left as-is",
  };
}

/**
 * Build the op for `.icculus/manifest.json`. Always (re)written: it records the
 * exact managed hashes for the write ops in `plan`, so it must reflect this run.
 */
export async function planManifest(params: {
  destDir: string;
  kitVersion: string;
  slug: string;
  agents: string[];
  managed: ManagedEntry[];
}): Promise<PlanOp> {
  const { destDir, kitVersion, slug, agents, managed } = params;
  const targetRel = ".icculus/manifest.json";
  const targetAbs = join(destDir, targetRel);
  const manifest = buildManifest({
    kitVersion,
    generatedAt: new Date().toISOString(),
    slug,
    agents,
    managed,
  });
  const bytes = TEXT_ENCODER.encode(serializeManifest(manifest));
  const existing = await readBytesIfExists(targetAbs);
  return {
    kind: "write",
    targetRel,
    targetAbs,
    disposition: existing === undefined ? "create" : "overwrite",
    bytes,
    mode: 0o644,
    managed: false,
    note: "records managed-file hashes for upgrade",
  };
}

/**
 * Collect the managed-file entries for a plan's write ops (those classified
 * managed and carrying a hash), keyed by their *target* path with any `.new`
 * suffix removed — the manifest tracks the canonical path the kit owns.
 */
export function managedEntriesFromPlan(plan: Plan): ManagedEntry[] {
  const entries: ManagedEntry[] = [];
  for (const op of plan.ops) {
    if (op.kind !== "write" || !op.managed || op.sha256 === undefined) {
      continue;
    }
    const path = op.targetRel.endsWith(".new")
      ? op.targetRel.slice(0, -".new".length)
      : op.targetRel;
    entries.push({ path, sha256: op.sha256 });
  }
  return entries;
}

/**
 * Apply a plan to disk. Skips no-op (`skip`) ops. Creates parent directories,
 * writes bytes, and sets the recorded mode. Returns the ops that actually
 * changed disk (everything but skips), for the change summary.
 */
export async function applyPlan(plan: Plan): Promise<PlanOp[]> {
  const changed: PlanOp[] = [];
  for (const op of plan.ops) {
    if (op.disposition === "skip") {
      continue;
    }
    await ensureDir(dirname(op.targetAbs));
    await Deno.writeFile(op.targetAbs, op.bytes);
    await Deno.chmod(op.targetAbs, op.mode);
    changed.push(op);
  }
  return changed;
}
