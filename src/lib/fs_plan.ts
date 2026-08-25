/**
 * The scaffolding plan: a pure description of what `setup` (and `preset`)
 * will do to disk, built *before* anything is written.
 *
 * Separating planning from execution buys three things the spec requires:
 *   - `--dry-run` renders the plan and touches nothing.
 *   - the review-and-confirm screen lists exactly what will be written/merged.
 *   - `setup` is idempotent: re-planning sees what is already present and marks
 *     each op accordingly (create vs skip).
 *
 * A plan is a flat list of `PlanOp`s. The walker turns the templates tree into a
 * plan; the executor applies a plan (or, for dry-run, the caller just renders
 * it).
 *
 * Every scaffolded file is a SEED — the user's once written, never overwritten.
 * The binary's own artifacts are NOT scaffolded here: bundled skills
 * (`templates/skills/`) and built-in instructions (`templates/instructions/`) are
 * materialized/read straight from the binary, never written into the user's tree,
 * so the walker skips those subtrees entirely.
 */

import { ensureDir, walk } from "@std/fs";
import { dirname, join, relative, SEPARATOR } from "@std/path";
import {
  isGitignoreFragment,
  isTemplateFile,
  resolveTargetPath,
  substituteTokens,
  type TokenMap,
} from "./template.ts";
import { reconcileDiscernGitignore } from "./agent_gitignore.ts";
import { planDiscernGitattributesFile } from "./agent_gitattributes.ts";
import { SOURCE_PATHS } from "../shared/paths_registry.ts";
import type { DiscernConfig } from "../shared/config_schema.ts";
import type { SettingsSeedMerge } from "./settings_merge.ts";
import {
  providersWithHooks,
  type SettingsSeed,
  settingsSeeds,
} from "./providers.ts";
import { CONFIG_REL, type EnvReader } from "../shared/env.ts";
import { readBytesIfExists } from "../shared/fs_presence.ts";
import { isHostMetadataPath } from "../shared/host_metadata.ts";
import { formatDiscernTomlBytes } from "./tidy_format.ts";

/** How an op relates to whatever is already on disk at its target. */
export type OpDisposition =
  | "create" // target absent → will be created
  | "skip" // seed already present, or fully-idempotent no-op
  | "merge" // settings.json deep-merge
  | "append" // marked-block reconciliation against an existing file
  | "remove"; // the managed block was the file's last content

/** A single planned filesystem operation against one target path. */
export interface PlanOp {
  /** What the op does to the target. */
  kind:
    | "write"
    | "merge-settings"
    | "append-gitignore"
    | "reconcile-gitattributes";
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

/** Preserve an Error's message and stringify non-Error failures for diagnostics. */
function errorText(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/** A settings seed could not be merged safely into its co-owned target file. */
export class SettingsMergePlanError extends Error {
  readonly targetRel: string;

  constructor(
    targetRel: string,
    options: ErrorOptions & { readonly cause: unknown },
  ) {
    super(`could not merge ${targetRel}: ${errorText(options.cause)}`, options);
    this.name = "SettingsMergePlanError";
    this.targetRel = targetRel;
  }
}

/** A filesystem operation failed while applying an otherwise-valid plan. */
export class PlanApplyError extends Error {
  readonly op: PlanOp;
  readonly action: "ensure-dir" | "write" | "chmod" | "remove";

  constructor(
    op: PlanOp,
    action: "ensure-dir" | "write" | "chmod" | "remove",
    options: ErrorOptions & { readonly cause: unknown },
  ) {
    super(
      `could not ${action} for ${op.kind} ${op.disposition} op ${op.targetRel}: ${
        errorText(options.cause)
      }`,
      options,
    );
    this.name = "PlanApplyError";
    this.op = op;
    this.action = action;
  }
}

/**
 * Top-level templates subtrees that are the binary's OWN artifacts, not seeds:
 * bundled skills (materialized into `.claude/skills/`), built-in instructions (read by
 * the compiler), and the setup assets (instructions + doc skeletons that
 * `discern setup` reads/lays on demand — ADR 0024, 0036). The seed walk skips them
 * so they are never written into the user's tracked tree.
 */
const NON_SEED_SUBTREES: readonly string[] = [
  "skills/",
  "instructions/",
  "setup/",
];

/** True when a template-relative path is one of the binary's non-seed subtrees. */
function isNonSeed(templateRel: string): boolean {
  const p = templateRel.replaceAll("\\", "/");
  return NON_SEED_SUBTREES.some((prefix) => p.startsWith(prefix));
}

/**
 * Walk the templates tree and produce a complete scaffolding plan.
 *
 * Every file is a write-once SEED (create-or-skip). The binary's own artifacts
 * (`templates/skills/`, `templates/instructions/`) are skipped — they are
 * materialized/read from the binary, never seeded. Provider settings deep-merge;
 * `.gitignore` and `.gitattributes` reconcile their discern-owned blocks.
 *
 * @param templatesDir   absolute path to the `templates/` tree to scaffold from
 * @param destDir        absolute destination root (the project being scaffolded)
 * @param tokens         resolved content tokens
 * @param excludeNonSeed skip the binary's own `skills/`/`instructions/` subtrees.
 *   Set when scaffolding from the BINARY's templates (`setup`), where those are
 *   materialized/read from the binary rather than seeded. Left false for a preset
 *   overlay, whose `skills/` IS an intended authored-skill overlay.
 * @param seeds          the settings seeds to deep-merge (rather than write
 *   verbatim), each `{ targetRel, merge }`. Defaults to the registry's
 *   {@link settingsSeeds} — every hooks provider's settings file + its merge
 *   strategy — so routing is provider-driven, not a hardcoded `.claude/settings.json`
 *   special-case. A test injects a synthetic provider's seed to exercise the seam.
 */
export async function buildPlan(params: {
  templatesDir: string;
  destDir: string;
  tokens: TokenMap;
  excludeNonSeed?: boolean;
  seeds?: readonly SettingsSeed[];
  /** The agents this project configured. When set, a per-agent seed (a hooks
   * provider's settings file) is laid only for an agent in this list — so an
   * unconfigured agent leaves no inert hooks/settings behind. Omitted (e.g. by
   * preset) means no agent filtering. */
  configuredAgents?: readonly string[];
  /** Process environment for generated-file attribution rendering. */
  env?: EnvReader | undefined;
}, env: EnvReader = params.env ?? Deno.env): Promise<Plan> {
  const { templatesDir, destDir, tokens } = params;
  const excludeNonSeed = params.excludeNonSeed ?? false;
  // Registry-derived map of a per-agent seed's target path → the agent that owns it,
  // so a seed for an unconfigured agent is skipped below. Driven off the provider
  // registry, so a new hooks provider auto-enrols in the filter (and its guard).
  const agentByPerAgentTarget = new Map<string, string>();
  for (const p of providersWithHooks()) {
    if (p.hooks !== undefined) {
      agentByPerAgentTarget.set(p.hooks.settingsFile, p.name);
    }
  }
  // A settings template is one whose TARGET path a hooks provider claims as its
  // settings file — derived from the registry, so a new hooks provider's template is
  // routed (and merged with its own strategy) the moment it declares a
  // HooksIntegration. No `.claude/settings.json` literal in the core.
  const settingsByTarget = new Map<string, SettingsSeedMerge>(
    (params.seeds ?? settingsSeeds()).map((s) => [s.targetRel, s.merge]),
  );
  const ops: PlanOp[] = [];
  const unknownTokens = new Map<string, string[]>();

  for await (const entry of walk(templatesDir, { includeDirs: false })) {
    const templateRel = relative(templatesDir, entry.path).replaceAll(
      SEPARATOR,
      "/",
    );

    // The source checkout and user-authored preset directories are physical
    // trees, so host-created files can appear without entering Git. They are
    // never project seeds; keep the shared distribution-input boundary in
    // force here before any target or content planning.
    if (isHostMetadataPath(templateRel)) {
      continue;
    }

    // Skip the binary's own artifacts — never seeded into the user's tree.
    if (excludeNonSeed && isNonSeed(templateRel)) {
      continue;
    }

    if (isGitignoreFragment(templateRel)) {
      const op = await planGitignoreAppend(
        entry.path,
        destDir,
        env,
      );
      ops.push(op);
      continue;
    }

    const targetRel = resolveTargetPath(templateRel, tokens.project_slug);

    // Skip a per-agent seed whose agent this project didn't configure — so a
    // claude+codex install never gets .cursor/.gemini/.github hook files it won't use.
    if (params.configuredAgents !== undefined) {
      const owner = agentByPerAgentTarget.get(targetRel);
      if (owner !== undefined && !params.configuredAgents.includes(owner)) {
        continue;
      }
    }

    const merge = settingsByTarget.get(targetRel);
    if (merge !== undefined) {
      const op = await planSettingsMerge(
        entry.path,
        destDir,
        targetRel,
        tokens,
        merge,
        unknownTokens,
      );
      ops.push(op);
      continue;
    }

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
  // read-only — without this, `setup` would lay down a read-only `discern.toml`
  // that the user (and `discern config set`/`discern setup`) then can't rewrite.
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

/** Plan the deep-merge of a settings seed template into the project's settings file
 * at `targetRel`, using the provider's `merge` strategy. Provider-driven: the target
 * path and the strategy come from the registry's {@link settingsSeeds}, so this
 * carries no `.claude/settings.json` literal and no baked-in JSON assumption. */
async function planSettingsMerge(
  sourceAbs: string,
  destDir: string,
  targetRel: string,
  tokens: TokenMap,
  merge: SettingsSeedMerge,
  unknownTokens: Map<string, string[]>,
): Promise<PlanOp> {
  const raw = TEXT_DECODER.decode(await Deno.readFile(sourceAbs));
  const { text, unknown } = substituteTokens(raw, tokens);
  if (unknown.length > 0) {
    unknownTokens.set(targetRel, unknown);
  }

  const targetAbs = join(destDir, targetRel);
  const existingRaw = await readBytesIfExists(targetAbs);
  const existingText = existingRaw === undefined
    ? undefined
    : TEXT_DECODER.decode(existingRaw);

  let merged: string;
  try {
    merged = merge(existingText, text);
  } catch (error) {
    throw new SettingsMergePlanError(targetRel, { cause: error });
  }
  const bytes = TEXT_ENCODER.encode(merged);

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

/** Plan reconciliation of the discern-owned .gitignore block. */
async function planGitignoreAppend(
  sourceAbs: string,
  destDir: string,
  env: EnvReader = Deno.env,
): Promise<PlanOp> {
  const fragment = TEXT_DECODER.decode(await Deno.readFile(sourceAbs));
  const targetRel = ".gitignore";
  const targetAbs = join(destDir, targetRel);
  const existingRaw = await readBytesIfExists(targetAbs);
  const existing = existingRaw === undefined
    ? ""
    : TEXT_DECODER.decode(existingRaw);
  const reconciled = reconcileDiscernGitignore(
    existing,
    fragment,
    undefined,
    env,
  );
  const changed = reconciled.operations.length > 0;

  return {
    kind: "append-gitignore",
    targetRel,
    targetAbs,
    disposition: changed
      ? existingRaw === undefined ? "create" : "append"
      : "skip",
    bytes: TEXT_ENCODER.encode(changed ? reconciled.text : existing),
    mode: 0o644,
    note: changed
      ? existingRaw === undefined
        ? "create .gitignore"
        : "reconcile discern block"
      : "discern block current",
  };
}

/** Plan reconciliation of the config-derived `.gitattributes` block. */
export async function planGitattributesReconcile(
  destDir: string,
  config: DiscernConfig,
  builtInCandidates: readonly string[] = [],
  env: EnvReader = Deno.env,
): Promise<PlanOp | undefined> {
  const reconciled = await planDiscernGitattributesFile(
    destDir,
    config,
    builtInCandidates,
    env,
  );
  const changed = reconciled.operations.length > 0;
  if (!changed && reconciled.existing === undefined) {
    return undefined;
  }

  const targetRel = ".gitattributes";
  return {
    kind: "reconcile-gitattributes",
    targetRel,
    targetAbs: join(destDir, targetRel),
    disposition: changed
      ? reconciled.text === ""
        ? "remove"
        : reconciled.existing === undefined
        ? "create"
        : "append"
      : "skip",
    bytes: TEXT_ENCODER.encode(reconciled.text),
    mode: 0o644,
    note: changed
      ? reconciled.text === ""
        ? "remove empty managed file"
        : reconciled.existing === undefined
        ? "create .gitattributes"
        : "reconcile discern block"
      : "discern block current",
  };
}

/**
 * Build the op for the project brief — a SEED file at its fixed registry
 * location: written once with a short header, never overwritten if already
 * present (preserves any edits the user or `discern setup` made). Only seeded
 * when a brief is supplied (via `--brief` / `--config`; the default zero-config
 * run supplies none), so a default install's footprint stays just
 * `discern.toml`.
 */
export async function planBrief(
  destDir: string,
  brief: string,
): Promise<PlanOp> {
  const targetRel = SOURCE_PATHS.brief.defaultPath;
  const targetAbs = join(destDir, targetRel);
  const body = brief.trimEnd();
  const content = `# Project brief\n\n` +
    `<!-- Captured at \`discern setup\`. Read by the setup instructions to seed\n` +
    `     principles, instructions, and docs. Edit freely. -->\n\n` +
    `${
      body.length > 0
        ? body
        : "_(no description given at setup — fill this in)_"
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
    if (op.disposition === "remove") {
      try {
        await Deno.remove(op.targetAbs);
      } catch (error) {
        throw new PlanApplyError(op, "remove", { cause: error });
      }
      changed.push(op);
      continue;
    }
    try {
      await ensureDir(dirname(op.targetAbs));
    } catch (error) {
      throw new PlanApplyError(op, "ensure-dir", { cause: error });
    }
    try {
      const bytes = op.targetRel === CONFIG_REL
        ? await formatDiscernTomlBytes(op.targetAbs, op.bytes)
        : op.bytes;
      await Deno.writeFile(op.targetAbs, bytes);
    } catch (error) {
      throw new PlanApplyError(op, "write", { cause: error });
    }
    try {
      await Deno.chmod(op.targetAbs, op.mode);
    } catch (error) {
      throw new PlanApplyError(op, "chmod", { cause: error });
    }
    changed.push(op);
  }
  return changed;
}
