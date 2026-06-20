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
  DEFAULT_MANAGED_SPEC,
  isManagedBy,
  MANAGED_SPEC_FILE,
  type ManagedEntry,
  type ManagedSpec,
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
  | "append" // .gitignore fragment append
  | "remove"; // managed orphan (recorded, gone from new templates) → deleted

/** A single planned filesystem operation against one target path. */
export interface PlanOp {
  /** What the op does to the target. */
  kind: "write" | "merge-settings" | "append-gitignore" | "remove";
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
  sha256?: string | undefined;
  /** Human-readable note rendered in dry-run / review (e.g. "skip — seed present"). */
  note?: string | undefined;
}

/** A complete plan plus any token-drift warnings gathered while building it. */
export interface Plan {
  ops: PlanOp[];
  /** Map of target path → unknown token names found in its contents. */
  unknownTokens: Map<string, string[]>;
}

/** Where a managed file's resolved bytes should be written, and how to label it. */
interface ManagedWriteTarget {
  disposition: OpDisposition;
  /** The path actually written (the target, or `<target>.new`). */
  outRel: string;
  /** Note rendered in review / dry-run. */
  note?: string;
}

const TEXT_DECODER = new TextDecoder();
const TEXT_ENCODER = new TextEncoder();

/**
 * Decide the disposition of a MANAGED file that is already present on disk.
 *
 * This is the single safety rule shared by `init` and `upgrade` — both must
 * agree on when it is safe to overwrite a managed file the kit owns versus when
 * the on-disk copy is the user's and must be preserved. The decision depends
 * only on three hashes, never on which command is running:
 *
 *   - on-disk == the kit's new bytes        → `skip`      (already current)
 *   - on-disk == the manifest's recorded hash → `overwrite` (Icculus wrote it,
 *                                               the user did not touch it)
 *   - otherwise (no manifest, not tracked, or hash differs — user-edited or a
 *     foreign same-named file)              → `new`       (preserve it; write
 *                                               the kit's version as `<path>.new`)
 *
 * `recorded` is the manifest's recorded sha256 for this path, or undefined when
 * there is no manifest or the path is untracked.
 */
function resolveManagedDisposition(params: {
  targetRel: string;
  /** sha256 of the bytes the kit would write this run. */
  newHash: string;
  /** sha256 of the bytes currently on disk. */
  existingHash: string;
  /** The manifest's recorded hash for this path, if any. */
  recorded: string | undefined;
}): ManagedWriteTarget {
  const { targetRel, newHash, existingHash, recorded } = params;

  if (existingHash === newHash) {
    return {
      disposition: "skip",
      outRel: targetRel,
      note: "already up to date",
    };
  }
  if (recorded !== undefined && existingHash === recorded) {
    // Pristine: matches exactly what the kit last wrote. Safe to refresh in place.
    return { disposition: "overwrite", outRel: targetRel };
  }
  // Not provably ours: no manifest, untracked, or locally changed. Never clobber.
  return {
    disposition: "new",
    outRel: `${targetRel}.new`,
    note: recorded === undefined
      ? "kept your version — new version written alongside"
      : "your edits kept — new version written alongside",
  };
}

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
 * @param managedSpec  which target paths are managed (refreshed by `upgrade`);
 *                     defaults to the built-in spec when omitted
 */
export async function buildPlan(params: {
  templatesDir: string;
  destDir: string;
  tokens: TokenMap;
  mode: "init" | "upgrade";
  recordedHash?: ((targetRel: string) => string | undefined) | undefined;
  managedSpec?: ManagedSpec | undefined;
}): Promise<Plan> {
  const { templatesDir, destDir, tokens, mode, recordedHash } = params;
  const managedSpec = params.managedSpec ?? DEFAULT_MANAGED_SPEC;
  const ops: PlanOp[] = [];
  const unknownTokens = new Map<string, string[]>();

  for await (const entry of walk(templatesDir, { includeDirs: false })) {
    const templateRel = relative(templatesDir, entry.path).replaceAll(
      SEPARATOR,
      "/",
    );

    // The managed-set declaration is installer metadata, never scaffolded.
    if (templateRel === MANAGED_SPEC_FILE) {
      continue;
    }

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
    const managed = isManagedBy(targetRel, managedSpec);

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
      recordedHash,
      unknownTokens,
    });
    ops.push(op);
  }

  ops.sort((a, b) => a.targetRel.localeCompare(b.targetRel));
  return { ops, unknownTokens };
}

/**
 * Plan a single content/verbatim file write, resolving its disposition.
 *
 * The disposition no longer depends on the command (`init` vs `upgrade`): a
 * managed file already present is resolved identically by both via
 * `resolveManagedDisposition`. The mode only governs *which* files reach this
 * function — `buildPlan` filters seed files out on upgrade — so it is not needed
 * here.
 */
async function planFileWrite(params: {
  sourceAbs: string;
  templateRel: string;
  targetRel: string;
  destDir: string;
  tokens: TokenMap;
  managed: boolean;
  recordedHash?: ((targetRel: string) => string | undefined) | undefined;
  unknownTokens: Map<string, string[]>;
}): Promise<PlanOp> {
  const { sourceAbs, templateRel, targetRel, destDir, tokens, managed } =
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
    // Nothing there yet — create it. (Same for seed and managed, init and upgrade.)
    disposition = "create";
  } else if (managed) {
    // A managed file is already present. Both `init` and `upgrade` resolve this
    // identically: overwrite only when the on-disk copy is provably the kit's
    // (matches the manifest's recorded hash); otherwise preserve and write
    // `<path>.new`. This is the safety rule that stops `init` clobbering a
    // user's hand-edited or same-named foreign managed file.
    const decision = resolveManagedDisposition({
      targetRel,
      newHash: hash,
      existingHash: await sha256Hex(existing),
      recorded: params.recordedHash?.(targetRel),
    });
    disposition = decision.disposition;
    outRel = decision.outRel;
    outAbs = join(destDir, decision.outRel);
    note = decision.note;
  } else {
    // A SEED file is already present. Seeds are write-once on both init and
    // upgrade (upgrade never even reaches a seed; init leaves it as the user's).
    disposition = "skip";
    note = "seed present — left as-is";
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
  schemaVersion: number;
  slug: string;
  agents: string[];
  managed: ManagedEntry[];
}): Promise<PlanOp> {
  const { destDir, kitVersion, schemaVersion, slug, agents, managed } = params;
  const targetRel = ".icculus/manifest.json";
  const targetAbs = join(destDir, targetRel);
  const manifest = buildManifest({
    kitVersion,
    schemaVersion,
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
 * Collect the managed-file entries for a plan's write ops that the kit actually
 * wrote *to the canonical path* — i.e. `create`, `overwrite`, and `skip` ops
 * (for `skip` the on-disk bytes already equal `sha256`). The recorded hash is
 * the kit's bytes (`sha256`), which is exactly what lands at the canonical path.
 *
 * `new` ops are deliberately omitted: there the kit's bytes went to the `.new`
 * sibling and the *user's* file remains at the canonical path. Recording the
 * kit's hash there would be a lie that flips the file to "pristine" on the next
 * run and overwrite it; recording the user's hash would do the same. Omitting it
 * leaves the canonical path untracked, so every later run keeps treating it as
 * "not provably ours" and re-preserves it — the safe outcome. (`upgrade`'s
 * `rebuildManifest` layers any *prior* recorded hash back on top for the same
 * reason.)
 */
export function managedEntriesFromPlan(plan: Plan): ManagedEntry[] {
  const entries: ManagedEntry[] = [];
  for (const op of plan.ops) {
    if (op.kind !== "write" || !op.managed || op.sha256 === undefined) {
      continue;
    }
    if (op.disposition === "new") {
      continue; // canonical path holds the user's file; do not record a hash for it.
    }
    entries.push({ path: op.targetRel, sha256: op.sha256 });
  }
  return entries;
}

/** True if a path exists on disk (file, dir, or symlink). */
async function pathExists(abs: string): Promise<boolean> {
  try {
    await Deno.lstat(abs);
    return true;
  } catch (error) {
    if (error instanceof Deno.errors.NotFound) {
      return false;
    }
    throw error;
  }
}

/**
 * Compute the managed entries for the post-upgrade manifest, reconciling the
 * prior manifest against what is actually on disk now (ADR 0014). Run *after*
 * migrations and `applyPlan`, when the tree reflects the final state.
 *
 * The rule: carry a prior entry forward only if its file still exists, then
 * overlay the kit's fresh hash for every managed file the plan wrote to its
 * canonical path. This handles every case with one on-disk test:
 *   - removed orphan / migration-renamed-away path → gone from disk → dropped.
 *   - edited orphan (no longer shipped, kept) → still on disk → kept at its
 *     prior hash, so a later upgrade still detects it.
 *   - `.new` canonical path (the user's file) → on disk → kept at its prior
 *     hash (the plan omits `.new`), so it stays correctly "not provably ours".
 *   - refreshed / created managed file → overlaid with the kit's fresh hash.
 */
export async function reconcileManagedEntries(params: {
  destDir: string;
  previous: ManagedEntry[];
  plan: Plan;
}): Promise<ManagedEntry[]> {
  const { destDir, previous, plan } = params;
  const byPath = new Map<string, string>();
  for (const entry of previous) {
    if (await pathExists(join(destDir, entry.path))) {
      byPath.set(entry.path, entry.sha256);
    }
  }
  for (const entry of managedEntriesFromPlan(plan)) {
    byPath.set(entry.path, entry.sha256);
  }
  return [...byPath.entries()].map(([path, sha256]) => ({ path, sha256 }));
}

/**
 * The plan's `.new` write ops: managed files preserved because the on-disk copy
 * was not provably the kit's, with the kit's version written alongside. Shared
 * by the review screen and the post-run summary so both report the same set.
 */
export function newFilesFromPlan(plan: Plan): PlanOp[] {
  return plan.ops.filter((op) => op.disposition === "new");
}

/** A managed orphan left in place because its on-disk copy is not the kit's. */
export interface OrphanKept {
  /** The orphaned managed path (target-relative). */
  path: string;
  /** Why it was kept (the user edited it, or it is a foreign same-named file). */
  reason: string;
}

/**
 * Reconcile orphans (ADR 0014): managed files the manifest recorded that the
 * *new* templates no longer ship. Each recorded managed path absent from the
 * freshly built plan's managed targets is an orphan. A *pristine* orphan — its
 * on-disk bytes still match the recorded hash — is planned for removal; an
 * orphan whose bytes differ (the user edited it, or it was a foreign same-named
 * file) is kept and reported, never silently deleted. A path already gone from
 * disk needs no action.
 *
 * Removal handles *deletions* only. A *rename* that must carry user edits
 * forward is an explicit migration step (ADR 0014, Phase 1), not
 * delete-then-recreate here.
 *
 * Only `upgrade` reconciles orphans: it is the command with a prior manifest to
 * diff against. `init` (even `--force`) scaffolds, it does not prune.
 */
export async function planOrphanRemovals(params: {
  destDir: string;
  /** The prior manifest's managed entries (recorded path + hash). */
  recorded: ManagedEntry[];
  /** The freshly built upgrade plan, for the set of paths still shipped. */
  plan: Plan;
}): Promise<{ removals: PlanOp[]; kept: OrphanKept[] }> {
  // Every managed canonical path the new templates still ship. A `.new` op means
  // the canonical path is still shipped (the kit copy was written alongside the
  // user's), so strip `.new` to compare against the recorded canonical path.
  const stripNew = (rel: string) => rel.replace(/\.new$/, "");
  const stillShipped = new Set(
    params.plan.ops.filter((o) => o.managed).map((o) => stripNew(o.targetRel)),
  );

  const removals: PlanOp[] = [];
  const kept: OrphanKept[] = [];
  for (const entry of params.recorded) {
    if (stillShipped.has(entry.path)) {
      continue; // still shipped — not an orphan.
    }
    const targetAbs = join(params.destDir, entry.path);
    const existing = await readBytesIfExists(targetAbs);
    if (existing === undefined) {
      continue; // already gone — nothing to remove.
    }
    if (await sha256Hex(existing) === entry.sha256) {
      removals.push({
        kind: "remove",
        targetRel: entry.path,
        targetAbs,
        disposition: "remove",
        bytes: new Uint8Array(),
        mode: 0,
        managed: true,
        note: "no longer shipped — removed",
      });
    } else {
      kept.push({
        path: entry.path,
        reason: "edited or foreign — kept, though no longer shipped",
      });
    }
  }
  return { removals, kept };
}

/**
 * Apply a plan to disk. Skips no-op (`skip`) ops. A `remove` op deletes its
 * target (tolerating one already gone); every other op creates parent
 * directories, writes bytes, and sets the recorded mode. Returns the ops that
 * actually changed disk (everything but skips), for the change summary.
 */
export async function applyPlan(plan: Plan): Promise<PlanOp[]> {
  const changed: PlanOp[] = [];
  for (const op of plan.ops) {
    if (op.disposition === "skip") {
      continue;
    }
    if (op.kind === "remove") {
      try {
        await Deno.remove(op.targetAbs);
      } catch (error) {
        if (!(error instanceof Deno.errors.NotFound)) {
          throw error;
        }
      }
      changed.push(op);
      continue;
    }
    await ensureDir(dirname(op.targetAbs));
    await Deno.writeFile(op.targetAbs, op.bytes);
    await Deno.chmod(op.targetAbs, op.mode);
    changed.push(op);
  }
  return changed;
}
