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
 *   - a bundled skill is **copied** in (its source lives in the binary, out of the
 *     project tree, so a symlink would dangle);
 *   - an authored skill is **symlinked** to `[skills].dir` (so edits are live).
 *
 * No directory is ever part-tracked/part-ignored: `[skills].dir` is 100% yours, an
 * agent skills dir is 100% generated. That removes by construction the mixed-
 * ignore trap that silently de-tracked authored skills on upgrade.
 *
 * `init`/`upgrade` materialize for the main checkout; a linked git worktree does
 * NOT inherit the gitignored agent skills dirs, so worktree setup materializes them
 * too. Materialization always reconciles, so a removed/ejected skill never lingers.
 */

import { join, relative } from "@std/path";
import { copy, ensureDir } from "@std/fs";
import type { DiscernConfig } from "../shared/config_schema.ts";
import type { Logger } from "./log.ts";
import { resolveBundledSkillsDir, resolveSkillsDir } from "./paths.ts";

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

/** The directory the provider (Claude Code) discovers skills in. */
const CLAUDE_SKILLS_REL = ".claude/skills";

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

/** What a single {@link materializeSkills} run accomplished. */
export interface MaterializeResult {
  /** Bundled skills copied into `.claude/skills/`. */
  copied: number;
  /** Authored skills symlinked into `.claude/skills/`. */
  linked: number;
  /** Stale managed entries pruned from `.claude/skills/`. */
  pruned: number;
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
  const total: MaterializeResult = { copied: 0, linked: 0, pruned: 0 };
  for (const rel of dirs) {
    const r = await materializeSkillsDir(rel, join(root, rel), effective, log);
    total.copied += r.copied;
    total.linked += r.linked;
    total.pruned += r.pruned;
  }
  return total;
}

/**
 * Reconcile ONE agent skills directory with the effective skill set: copy bundled
 * skills, symlink authored ones (relative, so edits are live and the link survives
 * a tree move), and prune entries discern owns that are no longer effective — a
 * removed authored skill's dangling symlink AND a real-directory copy of a bundled
 * skill a newer binary stopped shipping (tracked via {@link MATERIALIZED_MANIFEST},
 * per directory, so it self-heals instead of needing a one-off migration per
 * removal). A genuinely foreign entry — a name discern never materialized — is left
 * untouched and warned about, so a stray drop-in is never clobbered. `skillsRel` is
 * the project-relative path (for logs); `skillsAbs` is where the work happens.
 */
async function materializeSkillsDir(
  skillsRel: string,
  skillsAbs: string,
  effective: SkillEntry[],
  log?: Logger,
): Promise<MaterializeResult> {
  const managed = new Map(effective.map((e) => [e.name, e]));

  // The names discern materialized on the LAST run, in THIS directory. A real dir
  // under one of these names that is no longer effective is a stale copy discern
  // placed (e.g. a bundled skill dropped from a newer binary) — safe to prune.
  // Without this record such an orphan is indistinguishable from a user drop-in.
  const ownedBefore = await readMaterializedNames(skillsAbs);

  let pruned = 0;
  const foreign: string[] = [];

  // Prune pass: remove entries we manage (recreated below) and entries discern owns
  // that are now stale — a dangling symlink (a removed authored skill) or a real
  // directory whose name discern materialized before but no longer ships. Anything
  // else is a foreign drop-in: leave it, and warn (never clobber it).
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
      await copy(skill.srcAbs, target);
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
 * Copy a bundled built-in into `[skills].dir/<name>` so it can be edited. Throws
 * when `name` is not a bundled skill, or when an authored copy already exists
 * (eject never clobbers your edits). The caller is responsible for persisting
 * `[skills].dir` to config when it was unset.
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
  await copy(src, destAbs);
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

/** The provider skills directory, for callers that report or clean it. */
export function claudeSkillsDirOf(root: string): string {
  return join(root, CLAUDE_SKILLS_REL);
}
