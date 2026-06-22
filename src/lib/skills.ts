/**
 * Skill resolution and materialization (ADR 0020).
 *
 * Skills come from two places, with one consistent rule: **bundled built-ins**
 * (shipped inside the binary under `templates/skills/`) plus **your authored
 * skills** (under `[skills].dir`, default `./skills`), where *yours win by name*.
 * The effective set is materialized into the provider directory `.claude/skills/`
 * (gitignored, the provider's, never the user's footprint):
 *   - a bundled skill is **copied** in (its source lives in the binary, out of the
 *     project tree, so a symlink would dangle);
 *   - an authored skill is **symlinked** to `[skills].dir` (so edits are live).
 *
 * No directory is ever part-tracked/part-ignored: `[skills].dir` is 100% yours,
 * `.claude/skills/` is 100% generated. That removes by construction the mixed-
 * ignore trap that silently de-tracked authored skills on upgrade.
 *
 * `init`/`upgrade` materialize for the main checkout; a linked git worktree does
 * NOT inherit the gitignored `.claude/skills/`, so worktree setup materializes it
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

/**
 * Reconcile `.claude/skills/` with the effective skill set: copy bundled skills,
 * symlink authored ones (relative, so edits are live and the link survives a tree
 * move), and prune managed entries that are no longer effective. Foreign entries
 * (a real directory whose name discern does not manage) are left untouched and
 * warned about, so a stray drop-in is never clobbered. Returns a summary.
 */
export async function materializeSkills(
  root: string,
  config: DiscernConfig,
  log?: Logger,
): Promise<MaterializeResult> {
  const effective = await resolveEffectiveSkills(root, config);
  const managed = new Map(effective.map((e) => [e.name, e]));
  const claudeSkillsDir = join(root, CLAUDE_SKILLS_REL);

  let pruned = 0;

  // Prune pass: remove existing entries we manage (recreated below) and any
  // dangling symlink (a previously-authored skill the user has since removed).
  try {
    for await (const entry of Deno.readDir(claudeSkillsDir)) {
      const path = join(claudeSkillsDir, entry.name);
      if (managed.has(entry.name)) {
        await removeAny(path, entry.isDirectory && !entry.isSymlink);
        continue;
      }
      if (entry.isSymlink && !(await targetExists(path))) {
        await removeAny(path, false);
        pruned++;
      }
    }
  } catch (error) {
    if (!(error instanceof Deno.errors.NotFound)) {
      throw error;
    }
    // No `.claude/skills/` yet — created below only if there is anything to place.
  }

  if (effective.length === 0) {
    return { copied: 0, linked: 0, pruned };
  }

  await ensureDir(claudeSkillsDir);
  let copied = 0;
  let linked = 0;
  for (const skill of effective) {
    const target = join(claudeSkillsDir, skill.name);
    // A foreign real directory left over (name not managed) can't reach here —
    // every effective name was removed in the prune pass. But a real non-symlink
    // a user dropped under a managed name would have been removed above; that is
    // acceptable since `.claude/skills/` is discern-generated.
    const existing = await lstat(target);
    if (existing !== undefined) {
      // Should be gone (prune handles managed names); guard defensively.
      await removeAny(target, existing.isDirectory && !existing.isSymlink);
    }
    if (skill.source === "bundled") {
      await copy(skill.srcAbs, target);
      copied++;
    } else {
      await Deno.symlink(relative(claudeSkillsDir, skill.srcAbs), target);
      linked++;
    }
  }

  log?.info(
    pruned > 0
      ? `skills materialized into .claude/skills/: ${copied} bundled, ${linked} authored (pruned ${pruned} stale)`
      : `skills materialized into .claude/skills/: ${copied} bundled, ${linked} authored`,
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
