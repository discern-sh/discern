/**
 * The PURE guidance renderer (ADR 0034): compute the exact content `discern
 * refresh` would write for each provider's agent file, with NO side effects.
 *
 * This is the SINGLE source of the compiled-file content. The writer
 * (`compileGuidelines`) renders here and writes; the currency checker
 * (`checkGuidanceCurrent`, consumed by `discern status` and `discern finish`)
 * renders here and compares to disk. Because both go through
 * {@link renderAgentFiles}, the check can never disagree with what a refresh would
 * produce — there is no second copy of the compile logic, and no stored hash to
 * keep in sync.
 *
 * The compiled body is, in order: discern's built-in guidance sections, then the
 * user's `[guidance].sources`. Each
 * provider file is either that full body or — for a provider that declares a
 * `pointer` and is not itself canonical — a pointer importing the canonical file.
 *
 * This module is effect-free (reads only) and deliberately free of the skills/MCP
 * machinery in `guidelines.ts`, so the gate and `status` can import the check
 * without pulling those in.
 */

import { join } from "@std/path";
import {
  type DiscernConfig,
  loadConfig,
  resolveConfiguredAgents,
} from "../shared/config_schema.ts";
import { resolveGuidanceSources, resolveTemplatesDir } from "../lib/paths.ts";
import {
  emitsGuidanceFile,
  emittedGuidancePaths,
  type GuidanceFile,
  providerFor,
  skillsDirsForAgents,
} from "../lib/providers.ts";
import {
  type GuidanceContext,
  renderGuidanceTemplate,
} from "./guidance_template.ts";
import { normalizeDocsDir } from "../shared/docs_path.ts";

/**
 * The built-in guidance sections, in compile order. Every section always
 * compiles; a section that applies only to a configured state gates itself with
 * a template conditional (ratchets.md renders only when at least one
 * `[ratchets]` table exists — activation by presence, ADR 0101) and an
 * all-conditional section that renders to nothing is dropped.
 */
const BUILTIN_SECTIONS: ReadonlyArray<{ file: string }> = [
  { file: "base.md" },
  { file: "worktrees.md" },
  { file: "ratchets.md" },
  { file: "skills.md" },
  { file: "docs.md" },
];

/**
 * The providers to emit: `[guidance].agents`, else the legacy `[project].agents`,
 * else the default pair. Re-exported under the long-standing `guidanceAgents` name;
 * the resolution itself lives in the shared schema module ({@link
 * resolveConfiguredAgents}) so the compiler and the skills currency check share it.
 */
export const guidanceAgents = resolveConfiguredAgents;

/**
 * The template context the built-in sections render against — a PURE function of
 * COMMITTED config. It must read NOTHING that varies between two runs on the same
 * commit (no git branch/status, env, clock, randomness, absolute paths, or
 * gitignored/per-worktree files); that purity is what keeps the generated files'
 * currency check deterministic and the gate stable (ADR 0034). In particular
 * `main_branch` is the committed `[project].main_branch`, NEVER the
 * `DISCERN_MAIN_BRANCH`
 * env override — that runtime override lives in the worktree/git layer, not in the
 * loaded config this reads. Keep it minimal: add a variable or predicate only when
 * a template actually uses it.
 */
export function guidanceContext(config: DiscernConfig): GuidanceContext {
  // The agent files and skills dirs THIS project actually generates, named from the
  // SAME registry source renderAgentFiles / materializeSkills write to (config
  // agents → provider guidance-file paths / skills dirs), so the list base.md prints
  // can never drift from what is produced. Each item is backticked since a
  // comma-joined list can't be wrapped per-item by the `{{var}}` template.
  const agents = resolveConfiguredAgents(config);
  const codeList = (items: readonly string[]): string =>
    items.map((i) => `\`${i}\``).join(", ");
  // The files discern actually emits for the configured set: a reuse-canonical
  // provider contributes the canonical file when no canonical provider is present,
  // and repeated paths collapse — so the never-edit sentence names each generated
  // file once.
  const agentFiles = emittedGuidancePaths(guidanceFilesFor(agents));
  return {
    vars: {
      branch_prefix: config.project.branch_prefix,
      docs_dir: normalizeDocsDir(config.docs.dir),
      // The deferred-work ledger's configured location. No built-in guidance
      // section consumes it yet; bundled-skill rendering does (ADR 0102), and it
      // is exposed here so both surfaces read one context.
      todo_path: config.project.todo,
      // The authored-skills and recipes directories, likewise consumed by the
      // rendered-skill surface (ADR 0102) rather than any built-in section.
      skills_dir: config.skills.dir,
      recipes_dir: config.recipes.dir,
      main_branch: config.project.main_branch,
      guidance_sources: codeList(config.guidance.sources),
      generated_agent_files: codeList(agentFiles),
      materialized_skills_dirs: codeList(skillsDirsForAgents(agents)),
    },
    preds: {
      has_ratchets: Object.keys(config.ratchets).length > 0,
      has_worktree_resources: Object.keys(config.worktree.resources).length > 0,
    },
  };
}

/**
 * Read, template, and concatenate discern's built-in guidance sections, in
 * {@link BUILTIN_SECTIONS} order. Each section is rendered
 * against {@link guidanceContext} so generic prose can name the project's real
 * branch prefix / integration branch and drop config-gated content. ONLY built-in
 * sections are templated — the user's `[guidance].sources` are appended verbatim by
 * {@link composeGuidanceBody}. A missing section file is skipped defensively (the
 * distribution ships them, but a custom templates tree might not).
 */
async function builtinGuidance(config: DiscernConfig): Promise<string> {
  const dir = join(await resolveTemplatesDir(), "guidance");
  const ctx = guidanceContext(config);
  let out = "";
  for (const section of BUILTIN_SECTIONS) {
    let text: string;
    try {
      text = await Deno.readTextFile(join(dir, section.file));
    } catch (err) {
      if (err instanceof Deno.errors.NotFound) {
        continue;
      }
      throw err;
    }
    text = renderGuidanceTemplate(text, ctx);
    // A section a conditional collapsed to nothing contributes nothing — no stray
    // blank line, no empty heading.
    if (text.trim() === "") {
      continue;
    }
    out += text;
    if (!out.endsWith("\n")) {
      out += "\n";
    }
    out += "\n";
  }
  return out;
}

/**
 * The full compiled guidance body: the built-in sections followed by
 * the user's `[guidance].sources`. A single Markdown horizontal rule separates
 * shipped guidance from user-authored guidance, so the ownership boundary is
 * visible without changing either side's prose.
 */
export async function composeGuidanceBody(
  root: string,
  config: DiscernConfig,
): Promise<string> {
  let body = await builtinGuidance(config);
  const sources = await resolveGuidanceSources(root, config);
  if (sources.length > 0) {
    const builtIn = body.trimEnd();
    body = builtIn === "" ? "" : `${builtIn}\n\n---\n\n`;
  }
  for (const src of sources) {
    body += await Deno.readTextFile(src);
    body += "\n";
  }
  return body;
}

/** The guidance-file entries for the configured agents, in order, dropping unknown
 * names (no provider). The input to {@link agentFileContents} and the emitted-paths
 * aggregator, so both read the same registry-resolved list. */
function guidanceFilesFor(agents: readonly string[]): GuidanceFile[] {
  return agents
    .map((a) => providerFor(a)?.guidanceFile)
    .filter((g): g is GuidanceFile => g !== undefined);
}

/**
 * The agent-file content map for the given guidance entries and composed body —
 * PURE, keyed by project-relative path. Each entry gets the full body, or — when it
 * declares a `pointer` and a DIFFERENT canonical file is also emitted — that
 * pointer. A reuse-canonical entry adds no vendor-specific file; when no canonical
 * provider is configured in this set, it causes its canonical read path to carry
 * the full body. A Map keyed by path means a duplicate path collapses to one, never
 * written twice. The core {@link renderAgentFiles} computes content with, factored
 * out so a synthetic provider set can be exercised in tests without an install.
 */
export function agentFileContents(
  files: readonly GuidanceFile[],
  body: string,
): Map<string, string> {
  // The canonical agent file the pointer mirrors import (codex → AGENTS.md). When a
  // configured set has only reuse-canonical providers, their read path becomes the
  // canonical file for that set.
  const configuredCanonical = files.find((g) => g.canonical);
  const canonicalRel = configuredCanonical?.path ??
    files.find((g) => g.reuseCanonical === true)?.path;
  const out = new Map<string, string>();
  for (const gf of files) {
    if (!emitsGuidanceFile(gf)) {
      if (configuredCanonical === undefined && gf.path === canonicalRel) {
        out.set(gf.path, body);
      }
      continue; // reuse-canonical: no vendor-specific file.
    }
    let fileBody = body;
    if (
      gf.pointer !== undefined && canonicalRel !== undefined &&
      canonicalRel !== gf.path
    ) {
      fileBody = gf.pointer(canonicalRel);
    }
    out.set(gf.path, fileBody);
  }
  return out;
}

/**
 * The expected content of every agent file `discern refresh` would write, keyed by
 * project-relative path. Each configured provider gets the full body, or — when it
 * declares a `pointer` and a different canonical file is also emitted — that
 * pointer. A reuse-canonical provider adds no vendor-specific file; if no canonical
 * provider is configured in the set, its read path is rendered as the canonical
 * full-body file. Unknown agent names are skipped (the writer warns about them).
 * PURE: reads only.
 */
export async function renderAgentFiles(
  root: string,
  config?: DiscernConfig,
): Promise<Map<string, string>> {
  const cfg = config ?? await loadConfig(root);
  const body = await composeGuidanceBody(root, cfg);
  return agentFileContents(guidanceFilesFor(guidanceAgents(cfg)), body);
}

/** One generated agent file that does not match what `refresh` would write. */
export interface GuidanceDriftEntry {
  /** Project-relative path of the generated file. */
  path: string;
  /**
   * `missing` — absent on disk (the expected state of an untracked artifact on a
   * fresh checkout); `stale` — present but its bytes differ from the recompiled
   * body (a real drift: a hand-edit, or an un-refreshed source/config change).
   */
  reason: "missing" | "stale";
  /** What `refresh` would write. */
  expected: string;
  /** The current on-disk bytes — present only when `reason` is `stale`. */
  actual?: string;
}

/**
 * Compare every agent file `refresh` would write against what is on disk, and
 * return the ones that don't match (empty = all current). The stateless currency
 * check (ADR 0034): recompile in memory via
 * {@link renderAgentFiles}, diff against disk — no stored hash. PURE: reads only.
 */
export async function checkGuidanceCurrent(
  root: string,
  config?: DiscernConfig,
): Promise<GuidanceDriftEntry[]> {
  const expectedFiles = await renderAgentFiles(root, config);
  const drift: GuidanceDriftEntry[] = [];
  for (const [rel, expected] of expectedFiles) {
    let actual: string;
    try {
      actual = await Deno.readTextFile(join(root, rel));
    } catch (err) {
      if (err instanceof Deno.errors.NotFound) {
        drift.push({ path: rel, reason: "missing", expected });
        continue;
      }
      throw err;
    }
    if (actual !== expected) {
      drift.push({ path: rel, reason: "stale", expected, actual });
    }
  }
  return drift;
}
