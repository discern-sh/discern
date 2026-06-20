/**
 * The scaffolding plan: a pure description of what `init` (and `add-preset`)
 * will do to disk, built *before* anything is written.
 *
 * Separating planning from execution buys three things the spec requires:
 *   - `--dry-run` renders the plan and touches nothing.
 *   - the review-and-confirm screen lists exactly what will be written/merged.
 *   - `init` is idempotent: re-planning sees what is already present and marks
 *     each op accordingly (create vs skip).
 *
 * A plan is a flat list of `PlanOp`s. The walker turns the templates tree into a
 * plan; the executor applies a plan (or, for dry-run, the caller just renders
 * it).
 *
 * Every scaffolded file is a SEED — the user's once written, never overwritten —
 * with ONE exception: `.icculus/skills/**` are *materialized artifacts* of the
 * binary (bundled via `--include templates`), gitignored, and always overwritten
 * so a re-run refreshes them to the kit's current copy.
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
import { mergeSettings } from "./settings_merge.ts";

/** How an op relates to whatever is already on disk at its target. */
export type OpDisposition =
  | "create" // target absent → will be created
  | "skip" // seed already present, or fully-idempotent no-op
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
  /** Human-readable note rendered in dry-run / review (e.g. "skip — seed present"). */
  note?: string | undefined;
}

/** A complete plan plus any token-drift warnings gathered while building it. */
export interface Plan {
  ops: PlanOp[];
  /** Map of target path → unknown token names found in its contents. */
  unknownTokens: Map<string, string[]>;
}

const TEXT_DECODER = new TextDecoder();
const TEXT_ENCODER = new TextEncoder();

/**
 * The materialized-artifact prefix. Files under here are the binary's, not the
 * user's: copied verbatim from the bundled templates, gitignored, and always
 * overwritten so `init`/`upgrade` refresh them. (The engine's `guidelines` step
 * then symlinks them into `.claude/skills/`.)
 */
const MATERIALIZED_PREFIX = ".icculus/skills/";

/** True when a target path is a materialized artifact (always overwritten). */
export function isMaterialized(targetRel: string): boolean {
  return targetRel.replaceAll("\\", "/").startsWith(MATERIALIZED_PREFIX);
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
 * Walk the templates tree and produce a complete scaffolding plan.
 *
 * Every file is a write-once SEED (create-or-skip), except `.icculus/skills/**`,
 * which are materialized artifacts always (re)written. `.claude/settings.json`
 * deep-merges; `.gitignore` appends the harness fragment idempotently.
 *
 * @param templatesDir absolute path to the `templates/` tree to scaffold from
 * @param destDir      absolute destination root (the project being scaffolded)
 * @param tokens       resolved content tokens
 */
export async function buildPlan(params: {
  templatesDir: string;
  destDir: string;
  tokens: TokenMap;
}): Promise<Plan> {
  const { templatesDir, destDir, tokens } = params;
  const ops: PlanOp[] = [];
  const unknownTokens = new Map<string, string[]>();

  for await (const entry of walk(templatesDir, { includeDirs: false })) {
    const templateRel = relative(templatesDir, entry.path).replaceAll(
      SEPARATOR,
      "/",
    );

    if (isGitignoreFragment(templateRel)) {
      const op = await planGitignoreAppend(entry.path, destDir);
      ops.push(op);
      continue;
    }

    if (isSettingsTemplate(templateRel)) {
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
    const op = await planFileWrite({
      sourceAbs: entry.path,
      templateRel,
      targetRel,
      destDir,
      tokens,
      unknownTokens,
    });
    ops.push(op);
  }

  ops.sort((a, b) => a.targetRel.localeCompare(b.targetRel));
  return { ops, unknownTokens };
}

/**
 * Plan a single content/verbatim file write.
 *
 * Seed files (everything but `.icculus/skills/**`) are write-once: created when
 * absent, skipped when already present (the user's). Materialized artifacts are
 * always (re)written so a re-run refreshes them to the kit's bundled copy.
 */
async function planFileWrite(params: {
  sourceAbs: string;
  templateRel: string;
  targetRel: string;
  destDir: string;
  tokens: TokenMap;
  unknownTokens: Map<string, string[]>;
}): Promise<PlanOp> {
  const { sourceAbs, templateRel, targetRel, destDir, tokens } = params;
  const sourceStat = await Deno.stat(sourceAbs);
  let sourceMode = (sourceStat.mode ?? 0o644) & 0o777;
  // The harness contract decides exec-ness for shipped recipes/skills helpers;
  // OR it in so the bit survives even when the source mode is unreliable (the
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
    // Verbatim copy: skills and other non-.tmpl files are token-free.
    bytes = await Deno.readFile(sourceAbs);
  }

  const targetAbs = join(destDir, targetRel);

  // Materialized artifacts are the binary's: always overwrite so a re-run
  // refreshes them. Their bytes are token-free, so create vs overwrite carries
  // identical content — labelled `create` for a clean review either way.
  if (isMaterialized(targetRel)) {
    return {
      kind: "write",
      targetRel,
      targetAbs,
      disposition: "create",
      bytes,
      mode: sourceMode,
      note: "materialized skill (always refreshed)",
    };
  }

  // A seed: write once. If it is already present it is the user's — skip it.
  const existing = await readBytesIfExists(targetAbs);
  return {
    kind: "write",
    targetRel,
    targetAbs,
    disposition: existing === undefined ? "create" : "skip",
    bytes,
    mode: sourceMode,
    note: existing === undefined ? undefined : "seed present — left as-is",
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
    note: existing === undefined ? undefined : "seed present — left as-is",
  };
}

/**
 * Apply a plan to disk. Skips no-op (`skip`) ops; every other op creates parent
 * directories, writes bytes, and sets the recorded mode. Returns the ops that
 * actually changed disk (everything but skips), for the change summary.
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
