/**
 * The guideline compiler: one single-source-of-truth, agent-agnostic guideline
 * tree (`.icculus/guidelines/*.md`) compiled into many generated agent-specific
 * outputs (CLAUDE.md, AGENTS.md, …). The TS port of the shell `engine/guidelines`
 * recipe — dependency-free plain concatenation, so the same source can never
 * diverge per agent.
 *
 * It does two INDEPENDENT jobs, each idempotent and safe to run from anywhere:
 *   1. Concatenate `.icculus/guidelines/*.md` (sorted) into every configured
 *      agent file, per `[project].agents` in `.icculus/config.toml`.
 *   2. Reconcile the `.claude/skills/<skill>` symlinks with `.icculus/skills/` —
 *      linking author-once skills so the agent can discover them, and pruning
 *      links whose skill has been removed — so the two stay in lock-step.
 *
 * Job 2 runs even when job 1 has no sources to compile, so a freshly-scaffolded
 * project still gets discoverable skills.
 *
 * No generated-file banner is prepended to the agent files: the guideline
 * source's own opening text carries the edit-the-source-not-the-copies rule, so a
 * banner would only ride along in every agent's context for zero benefit.
 */

import { ensureDir } from "@std/fs";
import { basename, dirname, join } from "@std/path";
import { Config } from "../shared/config_read.ts";
import { Logger } from "../lib/log.ts";

/** What a single `compileGuidelines` run accomplished. */
export interface GuidelinesResult {
  /** Output paths (relative to `root`) written, in agent-config order. */
  agentsWritten: string[];
  /** Skills (re)linked into `.claude/skills/` in pass 1. */
  skillsLinked: number;
  /** Dangling skill links pruned from `.claude/skills/` in pass 2. */
  skillsPruned: number;
}

/**
 * Map a `[project].agents` entry to the file path (relative to the project root)
 * `compileGuidelines` writes for it. This is the one table to extend when
 * teaching the harness a new agent product — for example a future Junie:
 * `junie: ".junie/guidelines.md"`. An unknown agent yields `undefined` and is
 * warned about and skipped, never guessed.
 */
const AGENT_OUTPUT_PATH: Readonly<Record<string, string>> = {
  claude_code: "CLAUDE.md",
  codex: "AGENTS.md",
};

/** The output path for an agent name, or undefined when unmapped. */
function agentOutputPath(agent: string): string | undefined {
  return Object.hasOwn(AGENT_OUTPUT_PATH, agent)
    ? AGENT_OUTPUT_PATH[agent]
    : undefined;
}

/** The relative symlink target a managed `.claude/skills/<skill>` link holds. */
function skillLinkTarget(skill: string): string {
  return `../../.icculus/skills/${skill}`;
}

/** Stat a path without following symlinks; undefined when it does not exist. */
async function lstat(path: string): Promise<Deno.FileInfo | undefined> {
  try {
    return await Deno.lstat(path);
  } catch (err) {
    if (err instanceof Deno.errors.NotFound) {
      return undefined;
    }
    throw err;
  }
}

/**
 * Compile the guideline blob into the configured agent files and reconcile the
 * skill symlinks. Resolves to a summary of what changed. The worktree lifecycle
 * calls this with the discovered project `root`; the name and signature are a
 * cross-module contract.
 */
export async function compileGuidelines(
  root: string,
  logger?: Logger,
): Promise<GuidelinesResult> {
  // info/ok → stdout (matching the shell `output.sh`), UNLESS the caller passes
  // its own logger to control the stream — e.g. `upgrade --json` passes its
  // json-mode logger so this narration is suppressed and the JSON object stays
  // the only thing on stdout.
  const log = logger ??
    new Logger({ json: false, noColor: false, humanStream: "stdout" });

  const sourcesDir = join(root, ".icculus/guidelines");
  const skillsDir = join(root, ".icculus/skills");
  const claudeSkillsDir = join(root, ".claude/skills");

  // --- job 1: compile the guideline blob into agent files (best-effort) -----
  //
  // Collect the guideline sources, compile them into one blob, and write that to
  // each configured agent file. A missing dir or empty source set is NOT fatal:
  // it warns and skips, so job 2 (skill links) below still runs.
  const agentsWritten: string[] = [];

  const sources = await collectSources(sourcesDir);
  if (sources.length === 0) {
    log.warn(
      `guidelines: no sources in ${sourcesDir}/*.md — skipping agent-file compilation.`,
    );
  } else {
    // Concatenate the sorted sources, each followed by a newline (matching the
    // shell's `cat "$_src" >> …; printf '\n'`).
    let compiled = "";
    for (const src of sources) {
      compiled += await Deno.readTextFile(src);
      compiled += "\n";
    }

    const config = await Config.load(root);
    for (const agent of config.array("project.agents")) {
      const rel = agentOutputPath(agent);
      if (rel === undefined) {
        log.warn(
          `guidelines: unknown agent '${agent}' in [project].agents — skipping (no output mapping).`,
        );
        continue;
      }
      const out = join(root, rel);
      // Create the parent directory for nested targets (e.g. .junie/guidelines.md).
      await ensureDir(dirname(out));
      await Deno.writeTextFile(out, compiled);
      // A generated file should be readable like any other source (mode 0644).
      await Deno.chmod(out, 0o644);
      agentsWritten.push(rel);
    }

    if (agentsWritten.length === 0) {
      log.warn(
        'guidelines: no known agents in [project].agents — compiled nothing. Set agents = ["claude_code", …].',
      );
    }
  }

  // --- job 2: reconcile skill symlinks (always) -----------------------------
  //
  // Mirror `.icculus/skills/<skill>` into `.claude/skills/<skill>` so author-once
  // skills are discoverable by the agent. A reconcile, not just an add: pass 1
  // links every live skill, pass 2 prunes links whose skill is gone. Runs
  // unconditionally — independent of job 1 — so a project with no guideline
  // sources still gets discoverable skills.
  const skillsLinked = await linkSkills(skillsDir, claudeSkillsDir, log);
  const skillsPruned = await pruneSkillLinks(skillsDir, claudeSkillsDir);

  // --- summary --------------------------------------------------------------
  const writtenList = agentsWritten.length > 0
    ? agentsWritten.join(",")
    : "(none)";
  log.ok(
    `guidelines: compiled ${sources.length} source(s) into ${agentsWritten.length} agent file(s): ${writtenList}`,
  );
  log.info(
    skillsPruned > 0
      ? `skills linked into .claude/skills/: ${skillsLinked} (pruned ${skillsPruned} stale)`
      : `skills linked into .claude/skills/: ${skillsLinked}`,
  );

  return { agentsWritten, skillsLinked, skillsPruned };
}

/**
 * Collect the guideline source files (`*.md`) under `sourcesDir`, sorted by path.
 * A missing directory yields an empty list (the caller warns and skips). Sorting
 * keeps the concatenation order stable regardless of directory-read order.
 */
async function collectSources(sourcesDir: string): Promise<string[]> {
  const sources: string[] = [];
  // NotFound surfaces during iteration (Deno.readDir is lazy), so the try must
  // wrap the for-await, not the readDir call.
  try {
    for await (const entry of Deno.readDir(sourcesDir)) {
      if (entry.isFile && entry.name.endsWith(".md")) {
        sources.push(join(sourcesDir, entry.name));
      }
    }
  } catch (err) {
    if (err instanceof Deno.errors.NotFound) {
      return [];
    }
    throw err;
  }
  sources.sort();
  return sources;
}

/**
 * Pass 1 — link every live skill. For each directory under `.icculus/skills/`,
 * (re)create the symlink `.claude/skills/<skill>` → `../../.icculus/skills/<skill>`.
 * Idempotent: an existing symlink is removed first, so a renamed or retargeted
 * skill is corrected. A non-symlink at the target (a real file or directory a
 * user dropped there) is left untouched and warned about, so we never clobber it.
 * Returns the count of links (re)created.
 */
async function linkSkills(
  skillsDir: string,
  claudeSkillsDir: string,
  log: Logger,
): Promise<number> {
  let linked = 0;
  // Collect first, so `.claude/skills/` is created only when there is a skill to
  // link (matching the shell, which guards the mkdir on the source dir existing).
  // NotFound surfaces during iteration, so the try wraps the for-await.
  const skills: string[] = [];
  try {
    for await (const entry of Deno.readDir(skillsDir)) {
      if (entry.isDirectory) {
        skills.push(entry.name);
      }
    }
  } catch (err) {
    if (err instanceof Deno.errors.NotFound) {
      return 0;
    }
    throw err;
  }
  if (skills.length === 0) {
    return 0;
  }

  await ensureDir(claudeSkillsDir);
  for (const skill of skills) {
    const link = join(claudeSkillsDir, skill);
    const info = await lstat(link);
    if (info !== undefined && !info.isSymlink) {
      log.warn(
        `guidelines: ${link} exists and is not a symlink — leaving it alone.`,
      );
      continue;
    }
    // Remove any existing symlink first so the target is always refreshed.
    if (info !== undefined) {
      await Deno.remove(link);
    }
    // Relative target keeps the link valid if the project tree is moved.
    await Deno.symlink(skillLinkTarget(skill), link);
    linked++;
  }
  return linked;
}

/**
 * Pass 2 — prune stale links. A skill removed from `.icculus/skills/` leaves its
 * `.claude/skills/<skill>` symlink behind, now dangling. Remove every symlink we
 * created (target = the exact relative path we write) whose source skill is gone.
 * Matching that exact target is what makes pruning safe: a real file/dir, or a
 * user's own symlink pointing elsewhere, never matches and is left alone —
 * silently, since a link that is not ours is not a conflict to report. Returns
 * the count pruned.
 */
async function pruneSkillLinks(
  skillsDir: string,
  claudeSkillsDir: string,
): Promise<number> {
  let pruned = 0;
  // NotFound surfaces during iteration, so the try wraps the for-await.
  try {
    for await (const entry of Deno.readDir(claudeSkillsDir)) {
      if (!entry.isSymlink) {
        continue;
      }
      const skill = basename(entry.name);
      if ((await lstat(join(skillsDir, skill)))?.isDirectory) {
        continue;
      }
      const link = join(claudeSkillsDir, skill);
      if (await Deno.readLink(link) === skillLinkTarget(skill)) {
        await Deno.remove(link);
        pruned++;
      }
    }
  } catch (err) {
    if (err instanceof Deno.errors.NotFound) {
      return 0;
    }
    throw err;
  }
  return pruned;
}
