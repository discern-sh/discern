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
 * Every scaffolded file is a SEED — the user's once written, never overwritten.
 * The binary's own artifacts are NOT scaffolded here: bundled skills
 * (`templates/skills/`) and built-in guidance (`templates/guidance/`) are
 * materialized/read straight from the binary, never written into the user's tree,
 * so the walker skips those subtrees entirely.
 */

import { ensureDir, walk } from "@std/fs";
import { dirname, join, relative, SEPARATOR } from "@std/path";
import {
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
 * Top-level templates subtrees that are the binary's OWN artifacts, not seeds:
 * bundled skills (materialized into `.claude/skills/`) and built-in guidance
 * (read by the compiler). The seed walk skips them so they are never written into
 * the user's tracked tree.
 */
const NON_SEED_SUBTREES: readonly string[] = ["skills/", "guidance/"];

/** True when a template-relative path is one of the binary's non-seed subtrees. */
function isNonSeed(templateRel: string): boolean {
  const p = templateRel.replaceAll("\\", "/");
  return NON_SEED_SUBTREES.some((prefix) => p.startsWith(prefix));
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
const GITIGNORE_MARKER = "# --- discern harness ---";

/**
 * Walk the templates tree and produce a complete scaffolding plan.
 *
 * Every file is a write-once SEED (create-or-skip). The binary's own artifacts
 * (`templates/skills/`, `templates/guidance/`) are skipped — they are
 * materialized/read from the binary, never seeded. `.claude/settings.json`
 * deep-merges; `.gitignore` appends the harness fragment idempotently.
 *
 * @param templatesDir   absolute path to the `templates/` tree to scaffold from
 * @param destDir        absolute destination root (the project being scaffolded)
 * @param tokens         resolved content tokens
 * @param excludeNonSeed skip the binary's own `skills/`/`guidance/` subtrees.
 *   Set when scaffolding from the BINARY's templates (`init`), where those are
 *   materialized/read from the binary rather than seeded. Left false for a preset
 *   overlay, whose `skills/` IS an intended authored-skill overlay.
 */
export async function buildPlan(params: {
  templatesDir: string;
  destDir: string;
  tokens: TokenMap;
  excludeNonSeed?: boolean;
}): Promise<Plan> {
  const { templatesDir, destDir, tokens } = params;
  const excludeNonSeed = params.excludeNonSeed ?? false;
  const ops: PlanOp[] = [];
  const unknownTokens = new Map<string, string[]>();

  for await (const entry of walk(templatesDir, { includeDirs: false })) {
    const templateRel = relative(templatesDir, entry.path).replaceAll(
      SEPARATOR,
      "/",
    );

    // Skip the binary's own artifacts — never seeded into the user's tree.
    if (excludeNonSeed && isNonSeed(templateRel)) {
      continue;
    }

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
 * Plan a single content/verbatim file write. Every seed is write-once: created
 * when absent, skipped when already present (the user's).
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
  // OR in owner read+write: a scaffolded seed is the user's to edit, but the
  // `deno compile` embedded filesystem flattens every bundled template to
  // read-only — without this, `init` would lay down a read-only `discern.toml`
  // that the user (and `discern config set`/`discern bootstrap`) then can't rewrite.
  // Any exec bit on the real source is preserved (0o555 → 0o755).
  const sourceMode = ((sourceStat.mode ?? 0o644) & 0o777) | 0o600;

  let bytes: Uint8Array;
  if (isTemplateFile(templateRel)) {
    const raw = TEXT_DECODER.decode(await Deno.readFile(sourceAbs));
    const { text, unknown } = substituteTokens(raw, tokens);
    if (unknown.length > 0) {
      params.unknownTokens.set(targetRel, unknown);
    }
    bytes = TEXT_ENCODER.encode(text);
  } else {
    // Verbatim copy: non-.tmpl seed files are token-free.
    bytes = await Deno.readFile(sourceAbs);
  }

  const targetAbs = join(destDir, targetRel);

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
 * Build the op for the root `brief.md` — a SEED file: written once with a short
 * header, never overwritten if already present (preserves any edits the user or
 * `discern bootstrap` made). Only seeded when the captured brief is non-empty (see
 * `assembleInitPlan`), so a default install's footprint stays just `discern.toml`.
 */
export async function planBrief(
  destDir: string,
  brief: string,
): Promise<PlanOp> {
  const targetRel = "brief.md";
  const targetAbs = join(destDir, targetRel);
  const body = brief.trimEnd();
  const content = `# Project brief\n\n` +
    `<!-- Captured at \`discern init\`. Read by \`discern bootstrap\` to seed\n` +
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
