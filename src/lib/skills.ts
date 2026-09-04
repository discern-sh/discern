/**
 * Skill resolution and materialization (ADR 0020).
 *
 * Skills come from two places, with one consistent rule: **bundled built-ins**
 * (shipped inside the binary under `templates/skills/`) plus **your authored
 * skills** (under `[skills].dir`, default `./skills`), where *yours win by name*.
 * The effective set is materialized into EACH configured agent's skills directory
 * (the provider registry's `skillsDir` — `.claude/skills/` for Claude Code, the
 * cross-tool `.agents/skills/` shared by Codex + Gemini; all gitignored, the
 * providers', never the user's footprint):
 *   - a bundled skill is **rendered** in (its source lives in the binary, out of
 *     the project tree, so a symlink would dangle): markdown passes through the
 *     strict instructions template engine against the resolved-config context, so a
 *     bundled skill speaks the project's configured paths, never discern's
 *     defaults (ADR 0102); every other file is copied byte-for-byte;
 *   - an authored skill is **symlinked** to `[skills].dir` (so edits are live,
 *     and its content — the user's — is never templated).
 *
 * No directory is ever part-tracked/part-ignored: `[skills].dir` is 100% yours, an
 * agent skills dir is 100% generated. That removes by construction the mixed-
 * ignore trap that silently de-tracked authored skills on upgrade.
 *
 * `setup`/`upgrade` materialize for the main checkout; a linked git worktree does
 * NOT inherit the gitignored agent skills dirs, so worktree setup materializes them
 * too. Materialization always reconciles, so a removed/ejected skill never lingers.
 */

import { dirname, join, relative } from "@std/path";
import { copy, ensureDir, walk } from "@std/fs";
import {
  type DiscernConfig,
  resolveConfiguredAgents,
} from "../shared/config_schema.ts";
import type { Logger } from "./log.ts";
import type { DiscernResult } from "../shared/result.ts";
import type { SkillListing, SkillsListData } from "../shared/result_schemas.ts";
import { resolveBundledSkillsDir, resolveSkillsDir } from "./paths.ts";
import {
  describeYamlValue,
  parseFrontmatterMapping,
  readFrontmatterBlock,
  UNTERMINATED_FRONTMATTER_ISSUE,
} from "./frontmatter.ts";
import { providerFor, skillsDirsForAgents } from "./providers.ts";
import { instructionContext } from "../engine/instruction_render.ts";
import {
  type InstructionContext,
  renderInstructionTemplate,
} from "../engine/instruction_template.ts";
import {
  lstatIfExists,
  readDirIfExists,
  readTextIfExists,
  targetExists,
} from "../shared/fs_presence.ts";
import { bestEffort } from "../shared/best_effort.ts";

/** Where a skill in the effective set comes from. */
export type SkillSource = "authored" | "bundled";

/** One skill in the effective set, with its materialization source. */
export interface SkillEntry {
  /** The skill's directory name. */
  name: string;
  /** Whether it is authored (yours) or bundled (the binary's). */
  source: SkillSource;
  /** Absolute path of the directory to materialize from. */
  srcAbs: string;
  /** True when an authored skill shadows a bundled built-in of the same name. */
  overrides_bundled: boolean;
}

/**
 * discern's ownership record inside `.claude/skills/`: the skill names it
 * materialized on the last run. It is what lets a later run prune a stale copy
 * discern itself placed (a bundled skill a newer binary stopped shipping) WITHOUT
 * clobbering a user's hand-placed drop-in — the two are otherwise indistinguishable
 * real directories. A dotfile, so the provider's skill discovery ignores it.
 */
export const MATERIALIZED_MANIFEST = ".discern-materialized.json";

/** Directory names directly under `dir` (sorted), or `[]` if `dir` is absent. */
async function dirNames(dir: string): Promise<string[]> {
  const names = (await readDirIfExists(dir) ?? [])
    .filter((entry) => entry.isDirectory)
    .map((entry) => entry.name);
  return names.sort();
}

/**
 * Public directory identities of the skills bundled in the binary.
 *
 * These names are `[skills].exclude` keys, so v1 treats each spelling as a
 * compatibility contract. The directory-parity guard makes the registry and
 * shipped tree move together; manifest generation reads this registry.
 */
export const BUNDLED_SKILLS = {
  "discern-await-the-fleet": true,
  "discern-clear-the-decks": true,
  "discern-cure-a-bug": true,
  "discern-delegate-work": true,
  "discern-document-subsystem": true,
  "discern-place-a-checkpoint": true,
  "discern-set-the-standard": true,
  "discern-teach-the-project": true,
  "discern-write-adr": true,
  "discern-write-it-once": true,
} as const;

export const BUNDLED_SKILL_NAMES: readonly string[] = Object.freeze(
  Object.keys(BUNDLED_SKILLS).sort(),
);

/** The names of the skills bundled in the binary (`templates/skills/`). */
export function bundledSkillNames(): Promise<string[]> {
  return Promise.resolve([...BUNDLED_SKILL_NAMES]);
}

// ── skill frontmatter well-formedness ───────────────────────────────────────
// A SKILL.md's frontmatter is consumed by EXTERNAL agent runtimes, which parse
// it as YAML and apply the agent-skills identity contract. The bar is exactly
// that contract: the block must be valid YAML, `name`/`description` must be
// non-empty strings, the name must match the directory, and the
// consumer-enforced limits must hold. One validator, used by the gate's
// precondition ({@link checkSkillsWellformed}) and the repo's skill guard, so
// "valid" means one thing everywhere.

/** The agent-skills naming contract consumers enforce: lowercase letters,
 * digits, and hyphens. */
export const SKILL_NAME_PATTERN = /^[a-z0-9-]+$/;

/** Consumer-enforced ceiling on a skill's `name`. */
export const SKILL_NAME_MAX_LENGTH = 64;

/** Consumer-enforced ceiling on a skill's `description`. */
export const SKILL_DESCRIPTION_MAX_LENGTH = 1024;

/** The remedy a malformed identity field usually needs, appended to its issue. */
const QUOTE_REMEDY =
  "write the value as one quoted string (a value containing `:` must be quoted)";

/**
 * Validate one SKILL.md's frontmatter against the contract external consumers
 * apply. `dirName` is the directory the skill lives in — its canonical name.
 * Returns one message per problem; empty means every consumer reads the same
 * valid identity. Keys beyond `name`/`description` (nested `metadata:`, a
 * provider's extras) are allowed, provided the block stays valid YAML.
 */
export function skillFrontmatterIssues(
  text: string,
  dirName: string,
): string[] {
  const block = readFrontmatterBlock(text);
  if (block === undefined) {
    return [
      text.split(/\r?\n/, 1)[0]?.trim() === "---"
        ? UNTERMINATED_FRONTMATTER_ISSUE
        : "missing opening '---' frontmatter fence",
    ];
  }
  const parsed = parseFrontmatterMapping(block.raw);
  if ("issue" in parsed) return [parsed.issue];

  const issues: string[] = [];
  for (const key of ["name", "description"] as const) {
    const value = parsed.attrs[key];
    if (typeof value !== "string" || value.trim() === "") {
      issues.push(
        `${key}: must be a non-empty string, but the block gives ` +
          `${describeYamlValue(value)} — ${QUOTE_REMEDY}`,
      );
    }
  }

  const name = parsed.attrs["name"];
  if (typeof name === "string" && name.trim() !== "" && name !== dirName) {
    issues.push(
      `name: is "${name}" but the skill lives in directory "${dirName}" — ` +
        "the two must match",
    );
  }
  if (
    typeof name === "string" && name.trim() !== "" &&
    (!SKILL_NAME_PATTERN.test(name) || name.length > SKILL_NAME_MAX_LENGTH)
  ) {
    issues.push(
      `name: must use only lowercase letters, digits, and hyphens, at most ` +
        `${SKILL_NAME_MAX_LENGTH} characters, so every agent runtime accepts it`,
    );
  }
  const description = parsed.attrs["description"];
  if (
    typeof description === "string" &&
    description.length > SKILL_DESCRIPTION_MAX_LENGTH
  ) {
    issues.push(
      `description: is ${description.length} characters — agent runtimes cap ` +
        `it at ${SKILL_DESCRIPTION_MAX_LENGTH}`,
    );
  }
  return issues;
}

/**
 * Every known skill — bundled built-ins plus authored ones under `[skills].dir`,
 * keyed by name, an authored skill overriding a bundled one of the same name —
 * BEFORE the `[skills].exclude` filter. The shared base the effective set, the
 * listing, and the unknown-exclusion check all derive from, so the three can
 * never disagree on what a name means.
 */
async function resolveSkillsByName(
  root: string,
  config: DiscernConfig,
  templatesDir?: string,
): Promise<Map<string, SkillEntry>> {
  const bundledDir = await resolveBundledSkillsDir(templatesDir);
  const bundled = await dirNames(bundledDir);
  const { abs: authoredDir } = resolveSkillsDir(root, config);
  const authored = await dirNames(authoredDir);

  const byName = new Map<string, SkillEntry>();
  for (const name of bundled) {
    byName.set(name, {
      name,
      source: "bundled",
      srcAbs: join(bundledDir, name),
      overrides_bundled: false,
    });
  }
  for (const name of authored) {
    byName.set(name, {
      name,
      source: "authored",
      srcAbs: join(authoredDir, name),
      overrides_bundled: byName.has(name),
    });
  }
  return byName;
}

/** Apply exclusions to one resolved skill authority in stable name order. */
function effectiveSkillsFrom(
  byName: ReadonlyMap<string, SkillEntry>,
  config: DiscernConfig,
): SkillEntry[] {
  const excluded = new Set(config.skills.exclude);
  return [...byName.values()]
    .filter((entry) => !excluded.has(entry.name))
    .sort((left, right) => left.name.localeCompare(right.name));
}

/** Excluded names absent from one resolved skill authority. */
function unknownExcludedSkillsFrom(
  byName: ReadonlyMap<string, SkillEntry>,
  config: DiscernConfig,
): string[] {
  return [...new Set(config.skills.exclude)]
    .filter((name) => !byName.has(name))
    .sort();
}

/**
 * Resolve the effective skill set: every bundled built-in plus every authored
 * skill under `[skills].dir`, with an authored skill overriding a bundled one of
 * the same name, minus the names in `[skills].exclude`. Returned sorted by name.
 */
export async function resolveEffectiveSkills(
  root: string,
  config: DiscernConfig,
): Promise<SkillEntry[]> {
  return effectiveSkillsFrom(await resolveSkillsByName(root, config), config);
}

/** The `[skills].exclude` names matching no bundled or authored skill — a likely
 * typo, surfaced as a warning (never fatal) wherever a logger is at hand. */
export async function unknownExcludedSkills(
  root: string,
  config: DiscernConfig,
): Promise<string[]> {
  return unknownExcludedSkillsFrom(
    await resolveSkillsByName(root, config),
    config,
  );
}

/** A listing row for `discern skills list` — the schema-inferred wire type
 * (`result_schemas.ts` owns the shape), re-exported for skill-domain callers. */
export type { SkillListing };

/** Every known skill as a listing row (for `discern skills list`), the excluded
 * ones included and flagged — the listing shows the whole set and what
 * `[skills].exclude` does to it, not just the survivors. */
export async function listSkills(
  root: string,
  config: DiscernConfig,
): Promise<SkillListing[]> {
  const bundled = new Set(await bundledSkillNames());
  const byName = await resolveSkillsByName(root, config);
  const excluded = new Set(config.skills.exclude);
  return [...byName.values()]
    .sort((a, b) => a.name.localeCompare(b.name))
    .map((e) => ({
      name: e.name,
      source: e.source,
      overrides_bundled: e.overrides_bundled,
      has_bundled: bundled.has(e.name),
      excluded: excluded.has(e.name),
    }));
}

/** The `discern skills list` result — the one construction the CLI emits and the
 * faithfulness suite validates against the published contract
 * (`SkillsListOutputSchema`), so the wire shape can't fork from what's tested. */
export async function skillsListResult(
  root: string,
  config: DiscernConfig,
): Promise<DiscernResult<SkillsListData>> {
  return {
    ok: true,
    verb: "skills list",
    data: { skills: await listSkills(root, config) },
  };
}

// ── bundled-skill rendering (ADR 0102) ──────────────────────────────────────

/** True when a bundled-skill file renders through the template engine (markdown
 * prose — SKILL.md and any skeleton the skill carries); everything else is
 * copied byte-for-byte. */
function rendersViaEngine(path: string): boolean {
  return path.endsWith(".md");
}

/**
 * The bytes a bundled-skill file materializes with: markdown renders through the
 * strict instructions template engine against `ctx` (so `{{map_dir}}`-style tokens
 * become the project's configured paths — a stray or misspelled token throws,
 * exactly like a built-in instruction section); any other file passes through
 * byte-for-byte. The ONE transform both the write path
 * ({@link applySkillMaterializationOperation}, {@link ejectSkill}) and the currency check
 * ({@link checkSkillsCurrent}) apply, so the check can never disagree with what
 * a refresh would place.
 */
async function renderedBundledFile(
  srcPath: string,
  ctx: InstructionContext,
): Promise<Uint8Array> {
  if (!rendersViaEngine(srcPath)) {
    return await Deno.readFile(srcPath);
  }
  const text = await Deno.readTextFile(srcPath);
  return new TextEncoder().encode(renderInstructionTemplate(text, ctx));
}

/**
 * Materialize one bundled skill's tree into `destAbs`: directories recreated,
 * markdown rendered via {@link renderedBundledFile}, other files copied (mode
 * bits preserved), any symlink replicated as a link (defensive — bundled skills
 * carry none today). Walk order is top-down, so parents exist before children.
 */
async function copyRenderedSkillTree(
  srcAbs: string,
  destAbs: string,
  ctx: InstructionContext,
): Promise<void> {
  await ensureDir(destAbs);
  for await (const entry of walk(srcAbs, { includeDirs: true })) {
    if (entry.path === srcAbs) {
      continue;
    }
    const dest = join(destAbs, relative(srcAbs, entry.path));
    if (entry.isSymlink) {
      await Deno.symlink(await Deno.readLink(entry.path), dest);
    } else if (entry.isDirectory) {
      await ensureDir(dest);
    } else if (rendersViaEngine(entry.path)) {
      await Deno.writeFile(dest, await renderedBundledFile(entry.path, ctx));
    } else {
      await copy(entry.path, dest);
    }
  }
}

/** What a single {@link materializeSkills} run accomplished. */
export interface MaterializeResult {
  /** Bundled skills copied into `.claude/skills/`. */
  copied: number;
  /** Authored skills symlinked into `.claude/skills/`. */
  linked: number;
  /** Stale managed entries pruned from `.claude/skills/`. */
  pruned: number;
  /** Per-directory failures, isolated so one agent's skills dir failing (e.g. a
   * sandbox denial writing `.agents/skills`) can't abort the others (ADR 0065).
   * Empty on a clean run. */
  errors: string[];
}

/** How one planned materialized-skill target changes. */
export type SkillMaterializationDisposition = "create" | "update" | "remove";

/** One plan-bound effect under a configured agent skills directory. */
export interface SkillMaterializationOperation {
  /** Project-relative target; a bundled-skill target classifies its whole tree. */
  readonly targetRel: string;
  readonly targetAbs: string;
  readonly dirRel: string;
  readonly disposition: SkillMaterializationDisposition;
  readonly kind: "bundled" | "authored" | "stale" | "manifest";
  /** Present for an effective bundled/authored skill. */
  readonly skill?: SkillEntry | undefined;
  /** The exact manifest bytes planned from the effective set. */
  readonly manifestText?: string | undefined;
  /** Existing directories need recursive removal before replacement. */
  readonly removeDirectory?: boolean | undefined;
}

/** One independently-failing skills-directory boundary. */
export interface SkillMaterializationDirectoryPlan {
  readonly dirRel: string;
  readonly operations: readonly SkillMaterializationOperation[];
  readonly foreign: readonly string[];
}

/** The complete read-only materialized-skills plan. */
export interface SkillMaterializationPlan {
  readonly config: DiscernConfig;
  readonly directories: readonly SkillMaterializationDirectoryPlan[];
  readonly warnings: readonly string[];
  readonly errors: readonly string[];
}

/** Read-only overlay used when another plan will create an authored skill. */
export interface PlanMaterializeSkillsOptions {
  readonly prospectiveAuthoredSkill?: SkillEntry | undefined;
  /** Explicit templates root for a host boundary that has already resolved it. */
  readonly templatesDir?: string | undefined;
}

/** Remove a file, symlink, or directory at `path`; a no-op if already gone. */
async function removeAny(path: string, isDir: boolean): Promise<void> {
  try {
    await Deno.remove(path, isDir ? { recursive: true } : undefined);
  } catch (error) {
    if (!(error instanceof Deno.errors.NotFound)) {
      throw error;
    }
  }
}

/** The names discern materialized last run (its ownership record), or `[]` when the
 * record is absent or unreadable — a corrupt record simply disables orphan pruning
 * for this run rather than risking a wrong deletion. */
async function readMaterializedNames(
  claudeSkillsDir: string,
): Promise<Set<string>> {
  const text = await readTextIfExists(
    join(claudeSkillsDir, MATERIALIZED_MANIFEST),
  );
  if (text === undefined) return new Set<string>();
  try {
    const parsed = JSON.parse(text);
    if (Array.isArray(parsed)) {
      return new Set(parsed.filter((n): n is string => typeof n === "string"));
    }
    return new Set<string>();
  } catch (error) {
    if (!(error instanceof SyntaxError)) throw error;
    // discern-best-effort: skills-materialized-manifest-decode-fallback
    return new Set<string>();
  }
}

/**
 * True when a directory entry that is NOT in the effective set is discern's own
 * stale artifact rather than a user drop-in: its name is in the ownership
 * manifest (discern placed it — a copied bundled skill or an authored skill's
 * symlink, live or not), or it is a dangling symlink (a removed authored skill
 * from a run predating the manifest). The ONE classification the prune pass
 * ({@link planMaterializeSkills}) and the currency check ({@link checkSkillsDir})
 * share, so the check can never call an entry `stale` that a refresh would then
 * refuse to prune.
 */
async function isOwnedStaleEntry(
  path: string,
  entry: Deno.DirEntry,
  ownedBefore: Set<string>,
): Promise<boolean> {
  return ownedBefore.has(entry.name) ||
    (entry.isSymlink && !(await targetExists(path)));
}

/** Surface foreign entries left untouched in `.claude/skills/` (a user drop-in under
 * an unmanaged name). The directory is discern-generated, so a stray entry is worth
 * a heads-up — but never a deletion, per the never-clobber-a-drop-in contract. */
function warnForeignSkills(
  log: Logger | undefined,
  skillsRel: string,
  foreign: string[],
): void {
  if (foreign.length === 0) {
    return;
  }
  const plural = foreign.length === 1 ? "entry" : "entries";
  log?.warn(
    `${skillsRel}/ has ${foreign.length} unmanaged ${plural} discern left untouched: ${
      foreign.sort().join(", ")
    }`,
  );
}

/**
 * Materialize the effective skill set into EVERY configured agent's skills
 * directory. `dirs` are the project-relative targets — one per agent family, from
 * {@link skillsDirsForAgents}: `.claude/skills/` for Claude Code, the cross-tool
 * `.agents/skills/` shared by Codex + Gemini. The SAME effective set is reconciled
 * into each. Returns the summary summed across all directories. An empty `dirs`
 * (no configured agent has a skills target) materializes nothing.
 */
export async function materializeSkills(
  root: string,
  config: DiscernConfig,
  dirs: readonly string[],
  log?: Logger,
): Promise<MaterializeResult> {
  return await applyMaterializeSkillsPlan(
    await planMaterializeSkills(root, config, dirs),
    log,
  );
}

/** Render the stable ownership-manifest body for one effective skill set. */
function materializedNamesText(names: readonly string[]): string {
  return `${JSON.stringify([...names].sort(), null, 2)}\n`;
}

/** Plan one configured agent skills directory without changing it. */
async function planMaterializeSkillsDir(
  root: string,
  rel: string,
  effective: SkillEntry[],
  ctx: InstructionContext,
): Promise<SkillMaterializationDirectoryPlan> {
  const abs = join(root, rel);
  const managed = new Map(effective.map((entry) => [entry.name, entry]));
  const ownedBefore = await readMaterializedNames(abs);
  const operations: SkillMaterializationOperation[] = [];
  const foreign: string[] = [];
  const seen = new Set<string>();
  const skillsDirEntry = await lstatIfExists(abs);

  if (skillsDirEntry !== undefined) {
    for await (const entry of Deno.readDir(abs)) {
      if (entry.name === MATERIALIZED_MANIFEST) {
        continue;
      }
      const path = join(abs, entry.name);
      const targetRel = join(rel, entry.name);
      const skill = managed.get(entry.name);
      if (skill !== undefined) {
        seen.add(entry.name);
        if (await skillMismatch(abs, path, entry, skill, ctx) !== undefined) {
          operations.push({
            targetRel,
            targetAbs: path,
            dirRel: rel,
            disposition: "update",
            kind: skill.source,
            skill,
            removeDirectory: entry.isDirectory && !entry.isSymlink,
          });
        }
        continue;
      }
      if (await isOwnedStaleEntry(path, entry, ownedBefore)) {
        operations.push({
          targetRel,
          targetAbs: path,
          dirRel: rel,
          disposition: "remove",
          kind: "stale",
          removeDirectory: entry.isDirectory && !entry.isSymlink,
        });
      } else {
        foreign.push(entry.name);
      }
    }
  }

  for (const skill of effective) {
    if (seen.has(skill.name)) {
      continue;
    }
    operations.push({
      targetRel: join(rel, skill.name),
      targetAbs: join(abs, skill.name),
      dirRel: rel,
      disposition: "create",
      kind: skill.source,
      skill,
    });
  }

  if (effective.length > 0 || skillsDirEntry !== undefined) {
    const manifestAbs = join(abs, MATERIALIZED_MANIFEST);
    const expected = materializedNamesText(
      effective.map((entry) => entry.name),
    );
    const current = await readTextIfExists(manifestAbs);
    if (current !== expected) {
      operations.push({
        targetRel: join(rel, MATERIALIZED_MANIFEST),
        targetAbs: manifestAbs,
        dirRel: rel,
        disposition: current === undefined ? "create" : "update",
        kind: "manifest",
        manifestText: expected,
      });
    }
  }

  operations.sort((left, right) =>
    left.kind === "manifest"
      ? 1
      : right.kind === "manifest"
      ? -1
      : left.targetRel.localeCompare(right.targetRel)
  );
  return { dirRel: rel, operations, foreign: foreign.sort() };
}

/**
 * Compute every materialized-skill create, update, and removal without writing.
 * Each configured agent directory is an independent error boundary, matching
 * materialization's partial-failure contract.
 */
export async function planMaterializeSkills(
  root: string,
  config: DiscernConfig,
  dirs: readonly string[],
  options: PlanMaterializeSkillsOptions = {},
): Promise<SkillMaterializationPlan> {
  const byName = await resolveSkillsByName(root, config, options.templatesDir);
  const prospective = options.prospectiveAuthoredSkill;
  if (prospective !== undefined) {
    byName.set(prospective.name, prospective);
  }
  const effective = effectiveSkillsFrom(byName, config);
  const unknownExcluded = unknownExcludedSkillsFrom(byName, config);
  const ctx = instructionContext(config);
  const directories: SkillMaterializationDirectoryPlan[] = [];
  const errors: string[] = [];
  for (const rel of dirs) {
    try {
      directories.push(
        await planMaterializeSkillsDir(root, rel, effective, ctx),
      );
    } catch (error) {
      errors.push(
        `could not plan skills materialization into ${rel}: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
    }
  }
  return {
    config,
    directories,
    warnings: unknownExcluded.length === 0 ? [] : [
      `[skills].exclude names no known skill: ${
        unknownExcluded.join(", ")
      } — check for a typo (\`discern skills list\` shows the known set).`,
    ],
    errors,
  };
}

/**
 * Apply one operation from a materialized-skills plan. Bundled targets classify
 * their complete copied subtree; no writer is reachable except through this
 * operation's target.
 */
export async function applySkillMaterializationOperation(
  operation: SkillMaterializationOperation,
  config: DiscernConfig,
): Promise<Omit<MaterializeResult, "errors">> {
  if (operation.kind === "stale") {
    await removeAny(operation.targetAbs, operation.removeDirectory === true);
    return { copied: 0, linked: 0, pruned: 1 };
  }
  if (operation.kind === "manifest") {
    await ensureDir(dirname(operation.targetAbs));
    await Deno.writeTextFile(operation.targetAbs, operation.manifestText ?? "");
    return { copied: 0, linked: 0, pruned: 0 };
  }
  const skill = operation.skill;
  if (skill === undefined) {
    throw new Error(
      `skill materialization plan lost the source for ${operation.targetRel}`,
    );
  }
  if (operation.disposition === "update") {
    await removeAny(operation.targetAbs, operation.removeDirectory === true);
  }
  if (skill.source === "bundled") {
    await copyRenderedSkillTree(
      skill.srcAbs,
      operation.targetAbs,
      instructionContext(config),
    );
    return { copied: 1, linked: 0, pruned: 0 };
  }
  await ensureDir(dirname(operation.targetAbs));
  await Deno.symlink(
    relative(dirname(operation.targetAbs), skill.srcAbs),
    operation.targetAbs,
  );
  return { copied: 0, linked: 1, pruned: 0 };
}

/** Apply a complete materialized-skills plan, isolating failures per directory. */
export async function applyMaterializeSkillsPlan(
  plan: SkillMaterializationPlan,
  log?: Logger,
): Promise<MaterializeResult> {
  const total: MaterializeResult = {
    copied: 0,
    linked: 0,
    pruned: 0,
    errors: [...plan.errors],
  };
  for (const warning of plan.warnings) {
    log?.warn(warning);
  }
  for (const directory of plan.directories) {
    warnForeignSkills(log, directory.dirRel, [...directory.foreign]);
    let failed = false;
    const changed = { copied: 0, linked: 0, pruned: 0 };
    for (const operation of directory.operations) {
      if (failed) {
        continue;
      }
      try {
        const result = await applySkillMaterializationOperation(
          operation,
          plan.config,
        );
        changed.copied += result.copied;
        changed.linked += result.linked;
        changed.pruned += result.pruned;
        total.copied += result.copied;
        total.linked += result.linked;
        total.pruned += result.pruned;
      } catch (error) {
        failed = true;
        const message =
          `could not materialize skills into ${directory.dirRel}: ${
            error instanceof Error ? error.message : String(error)
          }`;
        log?.warn(message);
        total.errors.push(message);
      }
    }
    if (!failed && directory.operations.length > 0) {
      log?.info(
        `skills materialized into ${directory.dirRel}/: ${changed.copied} bundled, ${changed.linked} authored` +
          (changed.pruned > 0 ? ` (pruned ${changed.pruned} stale)` : ""),
      );
    }
  }
  return total;
}

/** The outcome of an {@link ejectSkill} call. */
export interface EjectResult {
  /** The skill name ejected. */
  name: string;
  /** The destination directory the bundled copy was written to. */
  destAbs: string;
  /** The destination directory relative to the project root. */
  destRel: string;
}

/** A validated read-only plan for one bundled-skill ejection. */
export interface EjectSkillPlan extends EjectResult {
  /** Bundled source retained for the plan-bound copy. */
  srcAbs: string;
  /** Resolved config retained for exact template rendering. */
  config: DiscernConfig;
}

/** Prove every bundled entry can be read and every Markdown template renders. */
async function validateRenderedSkillTree(
  srcAbs: string,
  ctx: InstructionContext,
): Promise<void> {
  for await (const entry of walk(srcAbs, { includeDirs: false })) {
    if (entry.isSymlink) {
      await Deno.readLink(entry.path);
    } else if (entry.isFile) {
      await renderedBundledFile(entry.path, ctx);
    }
  }
}

/** Compute and validate an ejection without changing the project. */
export async function planEjectSkill(
  root: string,
  config: DiscernConfig,
  name: string,
): Promise<EjectSkillPlan> {
  const bundledDir = await resolveBundledSkillsDir();
  const srcAbs = join(bundledDir, name);
  if (!(await lstatIfExists(srcAbs))?.isDirectory) {
    const available = (await bundledSkillNames()).join(", ");
    throw new Error(
      `no bundled skill named "${name}" (available: ${available || "none"})`,
    );
  }
  const { rel: skillsRel, abs: skillsAbs } = resolveSkillsDir(root, config);
  const destAbs = join(skillsAbs, name);
  const destRel = join(skillsRel, name);
  if (await lstatIfExists(destAbs) !== undefined) {
    throw new Error(
      `an authored skill already exists at ${destRel} — remove it first to re-eject`,
    );
  }
  await validateRenderedSkillTree(srcAbs, instructionContext(config));
  return { name, srcAbs, destAbs, destRel, config };
}

/** Apply one validated ejection plan without rediscovering its source or target. */
export async function applyEjectSkillPlan(
  plan: EjectSkillPlan,
): Promise<EjectResult> {
  if (await lstatIfExists(plan.destAbs) !== undefined) {
    throw new Error(
      `an authored skill already exists at ${plan.destRel} — remove it first to re-eject`,
    );
  }
  await ensureDir(dirname(plan.destAbs));
  await copyRenderedSkillTree(
    plan.srcAbs,
    plan.destAbs,
    instructionContext(plan.config),
  );
  await chmodWritable(plan.destAbs);
  return {
    name: plan.name,
    destAbs: plan.destAbs,
    destRel: plan.destRel,
  };
}

/**
 * Copy a bundled built-in into `[skills].dir/<name>` so it can be edited. The
 * copy is RENDERED (markdown through the template engine, like materialization):
 * an ejected skill becomes authored content, and authored content carries the
 * project's real paths, never discern's internal tokens. Throws when `name` is
 * not a bundled skill, or when an authored copy already exists (eject never
 * clobbers your edits). The caller is responsible for persisting `[skills].dir`
 * to config when it was unset.
 */
export async function ejectSkill(
  root: string,
  config: DiscernConfig,
  name: string,
): Promise<EjectResult> {
  return await applyEjectSkillPlan(await planEjectSkill(root, config, name));
}

/** Best-effort: ensure a freshly-copied tree is writable (recursively). */
async function chmodWritable(dir: string): Promise<void> {
  await bestEffort("skills-ejected-tree-chmod", async () => {
    await Deno.chmod(dir, 0o755);
    for (const entry of await readDirIfExists(dir) ?? []) {
      const path = join(dir, entry.name);
      if (entry.isDirectory) {
        await chmodWritable(path);
      } else if (entry.isFile) {
        await Deno.chmod(path, 0o644);
      }
    }
  });
}

/** Claude Code's provider skills directory, for callers that report or clean it.
 * Sourced from the registry (the SSOT) — `claude_code` always declares a skills
 * dir (guarded by the total Provider record + providers_test); the undefined branch
 * is unreachable in practice and only guards a broken registry. */
export function claudeSkillsDirOf(root: string): string {
  const dir = providerFor("claude_code")?.skillsDir?.path;
  if (dir === undefined) {
    throw new Error(
      "registry invariant broken: claude_code declares no skillsDir",
    );
  }
  return join(root, dir);
}

// ── currency check (ADR 0034, extended to skills) ───────────────────────────
// The stateless skills analog of `checkInstructionCurrent`: re-resolve the effective
// set and compare it to what is materialized on disk, with NO stored hash. (The
// MATERIALIZED_MANIFEST is reconciliation state the WRITE path uses for pruning;
// this is read-only OBSERVATION, the dual the gate and `status` consume.) Because it
// and `materializeSkills` both go through `resolveEffectiveSkills`, the check can
// never disagree with what a refresh would place — the same single-source guarantee
// instructions have.

/** One materialized skills entry that does not match what `discern refresh` would
 * place. */
export interface SkillsDriftEntry {
  /** Project-relative skills dir the drift is in. */
  dir: string;
  /**
   * `missing` — the whole dir is absent (the expected state of a gitignored artifact
   * on a fresh checkout; non-blocking, exactly like a missing instruction file).
   * `stale` — the dir exists but an effective skill is absent / differs from its
   * source, or a managed entry lingers that is no longer effective (real drift: a
   * hand-edit or an un-refreshed change; this is what blocks `done`).
   * `foreign` — an unmanaged entry discern never placed (reported, never clobbered —
   * mirrors materialization's never-touch-a-drop-in contract; non-blocking).
   * discern-allow-retrospective: "no longer effective" is the current effective set.
   */
  reason: "missing" | "stale" | "foreign";
  /** The skill name involved (`""` for a whole-dir `missing`). */
  name: string;
  /** Human-readable detail for the diagnostic / hint. */
  detail: string;
}

/** Recursive content equality between a MATERIALIZED tree `a` and a BUNDLED
 * source tree `b`, with `b`'s markdown rendered against `ctx` first — the same
 * transform materialization applies ({@link renderedBundledFile}), so a
 * repointed path key reads as drift until `refresh` re-renders (ADR 0102).
 * Detects a hand-edited (or upgrade-stale) copy of a bundled skill — compared
 * by content, never mode/mtime, so the embedded-template FS's read-only
 * flattening never reads as drift. */
async function treesEqual(
  a: string,
  b: string,
  ctx: InstructionContext,
): Promise<boolean> {
  type Kind = "file" | "dir" | "symlink";
  const list = async (rootDir: string): Promise<Map<string, Kind>> => {
    const m = new Map<string, Kind>();
    // followSymlinks defaults off, so a symlink is yielded as itself (not descended).
    for await (const e of walk(rootDir, { includeDirs: true })) {
      if (e.path === rootDir) {
        continue;
      }
      const kind: Kind = e.isSymlink
        ? "symlink"
        : e.isDirectory
        ? "dir"
        : "file";
      m.set(relative(rootDir, e.path), kind);
    }
    return m;
  };
  const [ma, mb] = await Promise.all([list(a), list(b)]);
  if (ma.size !== mb.size) {
    return false;
  }
  for (const [rel, kind] of ma) {
    if (mb.get(rel) !== kind) {
      return false;
    }
    if (kind === "file") {
      const [ba, bb] = await Promise.all([
        Deno.readFile(join(a, rel)),
        renderedBundledFile(join(b, rel), ctx),
      ]);
      if (ba.length !== bb.length || !ba.every((v, i) => v === bb[i])) {
        return false;
      }
    } else if (kind === "symlink") {
      // Compare link targets, never follow them — a symlink-to-dir would otherwise
      // read as a directory and crash the byte compare (defensive: bundled skills
      // carry none today, but a future one might).
      const [la, lb] = await Promise.all([
        Deno.readLink(join(a, rel)),
        Deno.readLink(join(b, rel)),
      ]);
      if (la !== lb) {
        return false;
      }
    }
  }
  return true;
}

/** Why an on-disk entry for an EFFECTIVE skill doesn't match its source, or
 * undefined when it matches: a bundled skill must be a real dir byte-equal to its
 * source; an authored skill must be a live symlink to `[skills].dir/<name>`. */
async function skillMismatch(
  skillsAbs: string,
  path: string,
  entry: Deno.DirEntry,
  skill: SkillEntry,
  ctx: InstructionContext,
): Promise<string | undefined> {
  if (skill.source === "authored") {
    if (!entry.isSymlink) {
      return `${skill.name} should be a symlink to the authored source, not a copy`;
    }
    const expected = relative(skillsAbs, skill.srcAbs);
    let actual: string;
    try {
      actual = await Deno.readLink(path);
    } catch {
      return `${skill.name} symlink is unreadable`;
    }
    if (actual !== expected) {
      return `${skill.name} points at ${actual}, expected ${expected}`;
    }
    if (!(await targetExists(path))) {
      return `${skill.name} symlink is dangling`;
    }
    return undefined;
  }
  // bundled
  if (entry.isSymlink || !entry.isDirectory) {
    return `${skill.name} should be a copied directory`;
  }
  if (!(await treesEqual(path, skill.srcAbs, ctx))) {
    return `${skill.name} differs from the rendered bundled source (hand-edited, stale, or un-refreshed after a path reconfiguration)`;
  }
  return undefined;
}

/** Reconcile ONE materialized skills dir against the effective set, read-only. */
async function checkSkillsDir(
  rel: string,
  abs: string,
  effective: SkillEntry[],
  ctx: InstructionContext,
): Promise<SkillsDriftEntry[]> {
  const drift: SkillsDriftEntry[] = [];
  const managed = new Map(effective.map((e) => [e.name, e]));

  // Whole dir absent → missing (non-blocking), and only when something is expected.
  if (await lstatIfExists(abs) === undefined) {
    if (effective.length > 0) {
      drift.push({
        dir: rel,
        reason: "missing",
        name: "",
        detail: `${rel}/ is not materialized yet`,
      });
    }
    return drift;
  }

  const ownedBefore = await readMaterializedNames(abs);
  const seen = new Set<string>();
  for await (const entry of Deno.readDir(abs)) {
    if (entry.name === MATERIALIZED_MANIFEST) {
      continue; // discern's ownership record, not a skill
    }
    seen.add(entry.name);
    const path = join(abs, entry.name);
    const skill = managed.get(entry.name);
    if (skill === undefined) {
      // Not effective: a stale managed entry discern's refresh would prune,
      // versus a foreign drop-in it must never touch — the SAME predicate the
      // prune pass applies, so `stale` always means "a refresh clears this".
      const stale = await isOwnedStaleEntry(path, entry, ownedBefore);
      drift.push({
        dir: rel,
        reason: stale ? "stale" : "foreign",
        name: entry.name,
        detail: stale
          ? `${rel}/${entry.name} lingers but is no longer in the effective set`
          : `${rel}/${entry.name} is an unmanaged entry discern did not place`,
      });
      continue;
    }
    const mismatch = await skillMismatch(abs, path, entry, skill, ctx);
    if (mismatch !== undefined) {
      drift.push({
        dir: rel,
        reason: "stale",
        name: entry.name,
        detail: mismatch,
      });
    }
  }

  // An effective skill entirely absent from an existing dir → stale (incomplete
  // materialization, e.g. a newer binary's bundled skill not yet refreshed in).
  for (const e of effective) {
    if (!seen.has(e.name)) {
      drift.push({
        dir: rel,
        reason: "stale",
        name: e.name,
        detail: `${rel}/${e.name} is in the effective set but not materialized`,
      });
    }
  }
  return drift;
}

/**
 * Compare what `discern refresh` would materialize against what is on disk, across
 * EVERY configured agent's skills dir, and return the entries that don't match
 * (empty = all current). The stateless currency
 * check for skills: re-resolve the effective set via {@link resolveEffectiveSkills},
 * diff against disk — no stored hash. PURE: reads only.
 */
export async function checkSkillsCurrent(
  root: string,
  config: DiscernConfig,
): Promise<SkillsDriftEntry[]> {
  const dirs = skillsDirsForAgents(resolveConfiguredAgents(config));
  if (dirs.length === 0) {
    return [];
  }
  const effective = await resolveEffectiveSkills(root, config);
  const ctx = instructionContext(config);
  const drift: SkillsDriftEntry[] = [];
  for (const rel of dirs) {
    drift.push(...await checkSkillsDir(rel, join(root, rel), effective, ctx));
  }
  return drift;
}

// ── well-formedness check ───────────────────────────────────────────────────

/** One effective skill whose SKILL.md fails the frontmatter contract. */
export interface SkillWellformedness {
  /** The skill's directory name. */
  name: string;
  /** Whether the offending source is authored (yours) or bundled. */
  source: SkillSource;
  /** The file to fix, project-relative when it lives in the project. */
  file: string;
  /** One message per problem, from {@link skillFrontmatterIssues}. */
  issues: string[];
}

/**
 * Validate EVERY effective skill's SKILL.md — authored files as written,
 * bundled ones as the template engine renders them for this project (the exact
 * bytes materialization places) — against {@link skillFrontmatterIssues}.
 * Returns the skills that fail (empty = all valid). PURE: reads only. Driven
 * off {@link resolveEffectiveSkills}, the same source materialization uses, so
 * a new skill enrols in this check by existing: a malformed SKILL.md can pass
 * this gate only by being excluded — and an excluded skill ships nowhere.
 */
export async function checkSkillsWellformed(
  root: string,
  config: DiscernConfig,
): Promise<SkillWellformedness[]> {
  const effective = await resolveEffectiveSkills(root, config);
  const ctx = instructionContext(config);
  const malformed: SkillWellformedness[] = [];
  for (const skill of effective) {
    const src = join(skill.srcAbs, "SKILL.md");
    const rel = relative(root, src);
    const file = rel.startsWith("..")
      ? `${skill.name}/SKILL.md (bundled with discern)`
      : rel;
    let issues: string[];
    try {
      const bytes = skill.source === "bundled"
        ? await renderedBundledFile(src, ctx)
        : await Deno.readFile(src);
      issues = skillFrontmatterIssues(
        new TextDecoder().decode(bytes),
        skill.name,
      );
    } catch (error) {
      issues = [
        `SKILL.md could not be read: ${
          error instanceof Error ? error.message : String(error)
        }`,
      ];
    }
    if (issues.length > 0) {
      malformed.push({ name: skill.name, source: skill.source, file, issues });
    }
  }
  return malformed;
}
