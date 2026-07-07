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
 *     strict guidance template engine against the resolved-config context, so a
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

import { join, relative } from "@std/path";
import { copy, ensureDir, walk } from "@std/fs";
import {
  type DiscernConfig,
  resolveConfiguredAgents,
} from "../shared/config_schema.ts";
import type { Logger } from "./log.ts";
import { resolveBundledSkillsDir, resolveSkillsDir } from "./paths.ts";
import { providerFor, skillsDirsForAgents } from "./providers.ts";
import { guidanceContext } from "../engine/guidance_render.ts";
import {
  type GuidanceContext,
  renderGuidanceTemplate,
} from "../engine/guidance_template.ts";

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
  overridesBundled: boolean;
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
  const names: string[] = [];
  try {
    for await (const entry of Deno.readDir(dir)) {
      if (entry.isDirectory) {
        names.push(entry.name);
      }
    }
  } catch (error) {
    if (error instanceof Deno.errors.NotFound) {
      return [];
    }
    throw error;
  }
  return names.sort();
}

/** The names of the skills bundled in the binary (`templates/skills/`). */
export async function bundledSkillNames(): Promise<string[]> {
  return await dirNames(await resolveBundledSkillsDir());
}

/** The identity a `SKILL.md` declares in its frontmatter. Only the fields every
 * skill must carry are surfaced; any other key in the block is ignored. */
export interface SkillFrontmatter {
  /** The `name:` value — the skill's canonical name (must equal its directory). */
  name: string;
  /** The `description:` value — what it does and when to reach for it. */
  description: string;
}

/** Strip one layer of matching surrounding single or double quotes, if present. */
function unquote(value: string): string {
  if (value.length >= 2) {
    const first = value[0];
    if ((first === '"' || first === "'") && value[value.length - 1] === first) {
      return value.slice(1, -1);
    }
  }
  return value;
}

/**
 * Parse the leading frontmatter of a `SKILL.md` into its declared `name` and
 * `description`. A SKILL.md opens with a `---`-fenced block of flat `key: value`
 * lines — the shape every bundled and authored skill carries — and this is the ONE
 * place that block is read, so a guard and any future consumer agree by construction
 * (single source of truth). Deliberately tiny and dependency-free: keys match up to
 * the first colon; a value is the rest of its line, trimmed, with one layer of
 * surrounding quotes removed (single-line scalars only — the format skills use).
 *
 * Throws when the opening `---` fence is missing or unterminated — a structurally
 * broken file is a loud failure, never a silent empty parse. A well-fenced block that
 * merely omits `name`/`description` yields an empty string for the absent field, which
 * the well-formedness guard then rejects with a precise, per-skill message.
 */
export function parseSkillFrontmatter(text: string): SkillFrontmatter {
  const lines = text.split(/\r?\n/);
  if (lines[0]?.trim() !== "---") {
    throw new Error("missing opening '---' frontmatter fence");
  }
  let end = -1;
  for (let i = 1; i < lines.length; i++) {
    if (lines[i]?.trim() === "---") {
      end = i;
      break;
    }
  }
  if (end === -1) {
    throw new Error("unterminated frontmatter fence (no closing '---')");
  }
  let name = "";
  let description = "";
  for (let i = 1; i < end; i++) {
    const line = lines[i] ?? "";
    const colon = line.indexOf(":");
    if (colon === -1) {
      continue;
    }
    const key = line.slice(0, colon).trim();
    const value = unquote(line.slice(colon + 1).trim());
    if (key === "name") {
      name = value;
    } else if (key === "description") {
      description = value;
    }
  }
  return { name, description };
}

/**
 * Resolve the effective skill set: every bundled built-in plus every authored
 * skill under `[skills].dir`, keyed by name, with an authored skill overriding a
 * bundled one of the same name. Returned sorted by name.
 */
export async function resolveEffectiveSkills(
  root: string,
  config: DiscernConfig,
): Promise<SkillEntry[]> {
  const bundledDir = await resolveBundledSkillsDir();
  const bundled = await dirNames(bundledDir);
  const { abs: authoredDir } = resolveSkillsDir(root, config);
  const authored = await dirNames(authoredDir);

  const byName = new Map<string, SkillEntry>();
  for (const name of bundled) {
    byName.set(name, {
      name,
      source: "bundled",
      srcAbs: join(bundledDir, name),
      overridesBundled: false,
    });
  }
  for (const name of authored) {
    byName.set(name, {
      name,
      source: "authored",
      srcAbs: join(authoredDir, name),
      overridesBundled: byName.has(name),
    });
  }
  return [...byName.values()].sort((a, b) => a.name.localeCompare(b.name));
}

/** A listing row for `discern skills list`. */
export interface SkillListing {
  name: string;
  source: SkillSource;
  /** True when this authored skill shadows a bundled built-in. */
  overridesBundled: boolean;
  /** True when a bundled built-in of this name exists (shadowed or not). */
  hasBundled: boolean;
}

/** The effective set as listing rows (for `discern skills list`). */
export async function listSkills(
  root: string,
  config: DiscernConfig,
): Promise<SkillListing[]> {
  const bundled = new Set(await bundledSkillNames());
  const effective = await resolveEffectiveSkills(root, config);
  return effective.map((e) => ({
    name: e.name,
    source: e.source,
    overridesBundled: e.overridesBundled,
    hasBundled: bundled.has(e.name),
  }));
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
 * strict guidance template engine against `ctx` (so `{{docs_dir}}`-style tokens
 * become the project's configured paths — a stray or misspelled token throws,
 * exactly like a built-in guidance section); any other file passes through
 * byte-for-byte. The ONE transform both the write path
 * ({@link materializeSkillsDir}, {@link ejectSkill}) and the currency check
 * ({@link checkSkillsCurrent}) apply, so the check can never disagree with what
 * a refresh would place.
 */
async function renderedBundledFile(
  srcPath: string,
  ctx: GuidanceContext,
): Promise<Uint8Array> {
  if (!rendersViaEngine(srcPath)) {
    return await Deno.readFile(srcPath);
  }
  const text = await Deno.readTextFile(srcPath);
  return new TextEncoder().encode(renderGuidanceTemplate(text, ctx));
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
  ctx: GuidanceContext,
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

/** Stat without following symlinks; undefined when the path does not exist. */
async function lstat(path: string): Promise<Deno.FileInfo | undefined> {
  try {
    return await Deno.lstat(path);
  } catch (error) {
    if (error instanceof Deno.errors.NotFound) {
      return undefined;
    }
    throw error;
  }
}

/** True when `path` resolves (following symlinks) to something that exists. */
async function targetExists(path: string): Promise<boolean> {
  try {
    await Deno.stat(path);
    return true;
  } catch {
    return false;
  }
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
  try {
    const text = await Deno.readTextFile(
      join(claudeSkillsDir, MATERIALIZED_MANIFEST),
    );
    const parsed = JSON.parse(text);
    if (Array.isArray(parsed)) {
      return new Set(parsed.filter((n): n is string => typeof n === "string"));
    }
  } catch {
    // absent or corrupt — nothing to reconcile this run.
  }
  return new Set();
}

/** Record the skill names discern now owns, sorted so the file is byte-stable run
 * to run (it is never diffed today, but determinism here costs nothing). */
async function writeMaterializedNames(
  claudeSkillsDir: string,
  names: string[],
): Promise<void> {
  await Deno.writeTextFile(
    join(claudeSkillsDir, MATERIALIZED_MANIFEST),
    `${JSON.stringify([...names].sort(), null, 2)}\n`,
  );
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
  const effective = await resolveEffectiveSkills(root, config);
  // The same resolved-config context the guidance compiler renders against —
  // one context for both rendered surfaces (ADR 0102).
  const ctx = guidanceContext(config);
  const total: MaterializeResult = {
    copied: 0,
    linked: 0,
    pruned: 0,
    errors: [],
  };
  for (const rel of dirs) {
    try {
      const r = await materializeSkillsDir(
        rel,
        join(root, rel),
        effective,
        ctx,
        log,
      );
      total.copied += r.copied;
      total.linked += r.linked;
      total.pruned += r.pruned;
    } catch (error) {
      // Isolate per directory: a denied/failed write into one agent's skills dir
      // is recorded and the rest still materialize (ADR 0065).
      const msg = `could not materialize skills into ${rel}: ${
        error instanceof Error ? error.message : String(error)
      }`;
      log?.warn(msg);
      total.errors.push(msg);
    }
  }
  return total;
}

/**
 * Reconcile ONE agent skills directory with the effective skill set: render
 * bundled skills in ({@link copyRenderedSkillTree}, against `ctx`), symlink
 * authored ones (relative, so edits are live and the link survives
 * a tree move), and prune entries discern owns that are no longer effective — a
 * removed authored skill's dangling symlink AND a real-directory copy of a bundled
 * skill a newer binary stopped shipping (tracked via {@link MATERIALIZED_MANIFEST},
 * per directory, so it self-heals instead of needing a one-off migration per
 * removal). A genuinely foreign entry — a name discern never materialized — is left
 * untouched and warned about, so a stray drop-in is never clobbered. `skillsRel` is
 * the project-relative path (for logs); `skillsAbs` is where the work happens.
 * discern-allow-retrospective: "no longer effective" is the current effective set.
 */
async function materializeSkillsDir(
  skillsRel: string,
  skillsAbs: string,
  effective: SkillEntry[],
  ctx: GuidanceContext,
  log?: Logger,
): Promise<Omit<MaterializeResult, "errors">> {
  const managed = new Map(effective.map((e) => [e.name, e]));

  // The names discern materialized on the LAST run, in THIS directory. A real dir
  // under one of these names that is no longer effective is a stale copy discern
  // placed (e.g. a bundled skill dropped from a newer binary) — safe to prune.
  // Without this record such an orphan is indistinguishable from a user drop-in.
  // discern-allow-retrospective: "no longer effective" is the current effective set.
  const ownedBefore = await readMaterializedNames(skillsAbs);

  let pruned = 0;
  const foreign: string[] = [];

  // Prune pass: remove entries we manage (recreated below) and entries discern owns
  // that are now stale — a dangling symlink (a removed authored skill) or a real
  // directory whose name discern materialized before but no longer ships. Anything
  // else is a foreign drop-in: leave it, and warn (never clobber it).
  // discern-allow-retrospective: "no longer ships" is the current bundled set.
  try {
    for await (const entry of Deno.readDir(skillsAbs)) {
      if (entry.name === MATERIALIZED_MANIFEST) {
        continue; // discern's own ownership record, not a skill
      }
      const path = join(skillsAbs, entry.name);
      const realDir = entry.isDirectory && !entry.isSymlink;
      if (managed.has(entry.name)) {
        await removeAny(path, realDir);
        continue;
      }
      if (entry.isSymlink && !(await targetExists(path))) {
        await removeAny(path, false);
        pruned++;
      } else if (realDir && ownedBefore.has(entry.name)) {
        await removeAny(path, true);
        pruned++;
      } else {
        foreign.push(entry.name);
      }
    }
  } catch (error) {
    if (!(error instanceof Deno.errors.NotFound)) {
      throw error;
    }
    // No skills dir yet — created below only if there is anything to place.
  }

  warnForeignSkills(log, skillsRel, foreign);

  if (effective.length === 0) {
    // Nothing to place; still record the now-empty ownership set when the dir
    // exists, so a later run can tell a future orphan from a foreign drop-in.
    if (await targetExists(skillsAbs)) {
      await writeMaterializedNames(skillsAbs, []);
    }
    return { copied: 0, linked: 0, pruned };
  }

  await ensureDir(skillsAbs);
  let copied = 0;
  let linked = 0;
  for (const skill of effective) {
    const target = join(skillsAbs, skill.name);
    // A foreign real directory left over (name not managed) can't reach here —
    // every effective name was removed in the prune pass. But a real non-symlink
    // a user dropped under a managed name would have been removed above; that is
    // acceptable since the agent skills dir is discern-generated.
    const existing = await lstat(target);
    if (existing !== undefined) {
      // Should be gone (prune handles managed names); guard defensively.
      await removeAny(target, existing.isDirectory && !existing.isSymlink);
    }
    if (skill.source === "bundled") {
      await copyRenderedSkillTree(skill.srcAbs, target, ctx);
      copied++;
    } else {
      await Deno.symlink(relative(skillsAbs, skill.srcAbs), target);
      linked++;
    }
  }

  // Record what discern now owns in THIS dir, so the next run can prune any of these
  // names a future binary stops shipping — the self-healing the manifest exists for.
  await writeMaterializedNames(skillsAbs, effective.map((e) => e.name));

  log?.info(
    pruned > 0
      ? `skills materialized into ${skillsRel}/: ${copied} bundled, ${linked} authored (pruned ${pruned} stale)`
      : `skills materialized into ${skillsRel}/: ${copied} bundled, ${linked} authored`,
  );
  return { copied, linked, pruned };
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
  const bundledDir = await resolveBundledSkillsDir();
  const src = join(bundledDir, name);
  if (!(await lstat(src))?.isDirectory) {
    const available = (await bundledSkillNames()).join(", ");
    throw new Error(
      `no bundled skill named "${name}" (available: ${available || "none"})`,
    );
  }
  const { rel: skillsRel, abs: skillsAbs } = resolveSkillsDir(root, config);
  const destAbs = join(skillsAbs, name);
  const destRel = join(skillsRel, name);
  if (await lstat(destAbs) !== undefined) {
    throw new Error(
      `an authored skill already exists at ${destRel} — remove it first to re-eject`,
    );
  }
  await ensureDir(skillsAbs);
  await copyRenderedSkillTree(src, destAbs, guidanceContext(config));
  // The embedded-templates filesystem reports files read-only; make the ejected
  // copy writable so it can actually be edited.
  await chmodWritable(destAbs);
  return { name, destAbs, destRel };
}

/** Best-effort: ensure a freshly-copied tree is writable (recursively). */
async function chmodWritable(dir: string): Promise<void> {
  try {
    await Deno.chmod(dir, 0o755);
    for await (const entry of Deno.readDir(dir)) {
      const path = join(dir, entry.name);
      if (entry.isDirectory) {
        await chmodWritable(path);
      } else if (entry.isFile) {
        await Deno.chmod(path, 0o644);
      }
    }
  } catch {
    // best-effort; an un-chmod-able file is still readable/editable on most hosts
  }
}

/** Claude Code's provider skills directory, for callers that report or clean it.
 * Sourced from the registry (the SSOT) — `claude_code` always declares a skills
 * dir (guarded by the total Provider record + providers_test); the undefined branch
 * is unreachable in practice and only guards a broken registry. */
export function claudeSkillsDirOf(root: string): string {
  const dir = providerFor("claude_code")?.skillsDir;
  if (dir === undefined) {
    throw new Error(
      "registry invariant broken: claude_code declares no skillsDir",
    );
  }
  return join(root, dir);
}

// ── currency check (ADR 0034, extended to skills) ───────────────────────────
// The stateless skills analog of `checkGuidanceCurrent`: re-resolve the effective
// set and compare it to what is materialized on disk, with NO stored hash. (The
// MATERIALIZED_MANIFEST is reconciliation state the WRITE path uses for pruning;
// this is read-only OBSERVATION, the dual the gate and `status` consume.) Because it
// and `materializeSkills` both go through `resolveEffectiveSkills`, the check can
// never disagree with what a refresh would place — the same single-source guarantee
// guidance has.

/** One materialized skills entry that does not match what `discern refresh` would
 * place. */
export interface SkillsDriftEntry {
  /** Project-relative skills dir the drift is in. */
  dir: string;
  /**
   * `missing` — the whole dir is absent (the expected state of a gitignored artifact
   * on a fresh checkout; non-blocking, exactly like a missing guidance file).
   * `stale` — the dir exists but an effective skill is absent / differs from its
   * source, or a managed entry lingers that is no longer effective (real drift: a
   * hand-edit or an un-refreshed change; this is what blocks `finish`).
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
  ctx: GuidanceContext,
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
  ctx: GuidanceContext,
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
  ctx: GuidanceContext,
): Promise<SkillsDriftEntry[]> {
  const drift: SkillsDriftEntry[] = [];
  const managed = new Map(effective.map((e) => [e.name, e]));

  // Whole dir absent → missing (non-blocking), and only when something is expected.
  if (await lstat(abs) === undefined) {
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
      // Not effective: a stale managed entry (or dangling link) discern should have
      // pruned, versus a foreign drop-in it must never touch.
      const stale = ownedBefore.has(entry.name) ||
        (entry.isSymlink && !(await targetExists(path)));
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
  const ctx = guidanceContext(config);
  const drift: SkillsDriftEntry[] = [];
  for (const rel of dirs) {
    drift.push(...await checkSkillsDir(rel, join(root, rel), effective, ctx));
  }
  return drift;
}
