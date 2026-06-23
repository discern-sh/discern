/**
 * The guideline compiler (ADR 0020): assemble discern's **bundled, feature-aware
 * built-in harness guidance** plus the project's **own config-pointed sources**
 * into the generated per-provider agent files (CLAUDE.md, AGENTS.md, GEMINI.md, …).
 *
 * The compiled body is, in order:
 *   1. discern's built-in base guidance (always),
 *   2. a built-in section for each ENABLED feature (a disabled feature's guidance
 *      is omitted automatically — that is the mechanism behind feature toggles),
 *   3. the user's `[guidance].sources` (default `guidance.md`, globs allowed),
 *      appended so they extend the built-ins.
 *
 * It writes each provider file named in `[guidance].agents` (falling back to the
 * pre-migration `[project].agents`). The files carry no banner — they open with
 * the guidance itself; `base.md`'s in-body "never hand-edit" section conveys
 * their generated-ness to every agent (ADR 0034), and the `finish`/`status`
 * currency check guards drift. Nothing is hand-edited: edit your sources, or
 * discern's built-ins, and recompile.
 *
 * Two independent jobs, each gated on its feature and safe to run from anywhere:
 *   - `features.skills`  → materialize skills into `.claude/skills/` (see lib/skills.ts);
 *   - `features.guidance`→ compile the agent files described above.
 * The skills job runs even when guidance is off, so skills stay discoverable.
 */

import { ensureDir } from "@std/fs";
import { dirname, join } from "@std/path";
import { type DiscernConfig, loadConfig } from "../shared/config_schema.ts";
import { type Feature, isFeatureEnabled } from "../shared/features.ts";
import { resolveGuidanceSources, resolveTemplatesDir } from "../lib/paths.ts";
import { materializeSkills } from "../lib/skills.ts";
import {
  MCP_RESTART_HINT,
  providerFor,
  unwireProviderMcp,
  wireProviderMcp,
} from "../lib/providers.ts";
import { Logger } from "../lib/log.ts";

/** What a single `compileGuidelines` run accomplished. */
export interface GuidelinesResult {
  /** Output paths (relative to `root`) written, in agent-config order. */
  agentsWritten: string[];
  /** Project files written wiring each agent's MCP server (`.mcp.json`, settings). */
  mcpWired: string[];
  /** Project files changed removing the MCP server (when `features.mcp` is off). */
  mcpRemoved: string[];
  /** Agent/user-facing advice from this run (e.g. the MCP first-install restart hint). */
  hints: string[];
  /** Bundled skills copied into `.claude/skills/`. */
  skillsCopied: number;
  /** Authored skills symlinked into `.claude/skills/`. */
  skillsLinked: number;
  /** Stale managed skill entries pruned from `.claude/skills/`. */
  skillsPruned: number;
}

/** Default providers to emit when neither `[guidance].agents` nor the legacy
 * `[project].agents` is set. */
const DEFAULT_AGENTS: readonly string[] = ["claude_code", "codex"];

/**
 * The built-in guidance sections, in compile order. The base section is always
 * included; every other section is gated on its feature, so disabling a feature
 * drops its guidance from the compiled output automatically.
 */
const BUILTIN_SECTIONS: ReadonlyArray<{ file: string; feature?: Feature }> = [
  { file: "base.md" },
  { file: "worktrees.md", feature: "worktrees" },
  { file: "ratchets.md", feature: "ratchets" },
  { file: "skills.md", feature: "skills" },
  { file: "docs.md", feature: "docs" },
];

/** The providers to emit: `[guidance].agents`, else the legacy `[project].agents`,
 * else the default pair. */
function guidanceAgents(config: DiscernConfig): string[] {
  if (config.guidance.agents.length > 0) {
    return config.guidance.agents;
  }
  const legacy = config.project.agents ?? [];
  return legacy.length > 0 ? legacy : [...DEFAULT_AGENTS];
}

/**
 * Read and concatenate discern's built-in guidance sections for the enabled
 * features, in {@link BUILTIN_SECTIONS} order. A missing section file is skipped
 * defensively (the distribution ships them, but a custom templates tree might not).
 */
async function builtinGuidance(config: DiscernConfig): Promise<string> {
  const dir = join(await resolveTemplatesDir(), "guidance");
  let out = "";
  for (const section of BUILTIN_SECTIONS) {
    if (section.feature && !isFeatureEnabled(config, section.feature)) {
      continue;
    }
    let text: string;
    try {
      text = await Deno.readTextFile(join(dir, section.file));
    } catch (err) {
      if (err instanceof Deno.errors.NotFound) {
        continue;
      }
      throw err;
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
 * Compile the agent files from the built-in guidance + the project's sources, and
 * materialize skills. Each job is gated on its feature. Resolves to a summary of
 * what changed. The worktree lifecycle and `upgrade` call this with the discovered
 * project `root`; the name and signature are a cross-module contract.
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

  const config = await loadConfig(root);
  const agents = guidanceAgents(config);

  // --- job 1: materialize skills into .claude/skills/ (gated) ----------------
  let skills = { copied: 0, linked: 0, pruned: 0 };
  if (isFeatureEnabled(config, "skills")) {
    skills = await materializeSkills(root, config, log);
  }

  // --- job 2: MCP integration (gated on features.mcp; ADR 0030/0031) ----------
  // An idempotent integration artifact, independent of the guidance feature. When
  // ON, (re-)establish the server for every configured agent on each refresh /
  // upgrade / worktree-setup; when OFF, REMOVE any previously-wired config. A
  // FIRST install yields the restart hint (surfaced to the user AND the result
  // `hints`). Best-effort: a hiccup must not fail the compile.
  let mcpWired: string[] = [];
  let mcpRemoved: string[] = [];
  const hints: string[] = [];
  try {
    if (isFeatureEnabled(config, "mcp")) {
      const r = await wireProviderMcp(root, agents);
      mcpWired = r.written;
      if (r.written.length > 0) {
        log.info(
          `registered the discern MCP server in: ${r.written.join(", ")}`,
        );
      }
      if (r.firstInstall) {
        hints.push(MCP_RESTART_HINT);
        log.info(MCP_RESTART_HINT);
      }
    } else {
      mcpRemoved = await unwireProviderMcp(root, agents);
      if (mcpRemoved.length > 0) {
        log.info(
          `removed the discern MCP server (mcp feature off) from: ${
            mcpRemoved.join(", ")
          }`,
        );
      }
    }
  } catch (error) {
    log.warn(
      `could not update the MCP integration: ${
        error instanceof Error ? error.message : String(error)
      }`,
    );
  }

  // --- job 3: compile the agent files (gated) --------------------------------
  const agentsWritten: string[] = [];
  if (!isFeatureEnabled(config, "guidance")) {
    log.info("guidance feature is off — no agent files compiled.");
    return summarize(agentsWritten, mcpWired, mcpRemoved, hints, skills);
  }

  let body = await builtinGuidance(config);
  const sources = await resolveGuidanceSources(root, config);
  for (const src of sources) {
    body += await Deno.readTextFile(src);
    body += "\n";
  }
  const compiled = body;

  // The canonical agent file the pointer mirrors import: the canonical provider in
  // this run (codex → AGENTS.md). When none is emitted there is nothing to point
  // at, so every file gets the full compiled body instead.
  const canonicalRel = agents
    .map((a) => providerFor(a)?.guidanceFile)
    .find((g) => g !== undefined && g.canonical)?.path;

  for (const agent of agents) {
    const gf = providerFor(agent)?.guidanceFile;
    if (gf === undefined) {
      log.warn(
        `refresh: unknown agent '${agent}' in [guidance].agents — skipping (no output mapping).`,
      );
      continue;
    }
    const out = join(root, gf.path);
    await ensureDir(dirname(out));
    // A provider that supports an import (Claude Code) writes a pointer to the
    // canonical file instead of duplicating the whole body — but only when that
    // file is actually being emitted, and isn't this same file. Otherwise the full
    // compiled guidance is written.
    let fileBody = compiled;
    if (
      gf.pointer !== undefined && canonicalRel !== undefined &&
      canonicalRel !== gf.path
    ) {
      fileBody = gf.pointer(canonicalRel);
    }
    await Deno.writeTextFile(out, fileBody);
    // A generated file should be readable like any other source (mode 0644).
    await Deno.chmod(out, 0o644);
    agentsWritten.push(gf.path);
  }

  if (agentsWritten.length === 0) {
    log.warn(
      'refresh: no known providers in [guidance].agents — compiled nothing. Set agents = ["claude_code", …].',
    );
  } else {
    log.ok(
      `refresh: compiled ${sources.length} source(s) + built-in guidance into ${agentsWritten.length} agent file(s): ${
        agentsWritten.join(",")
      }`,
    );
  }
  return summarize(agentsWritten, mcpWired, mcpRemoved, hints, skills);
}

/** Build the result. The skills narration is emitted once by `materializeSkills`,
 * so this does not repeat it. */
function summarize(
  agentsWritten: string[],
  mcpWired: string[],
  mcpRemoved: string[],
  hints: string[],
  skills: { copied: number; linked: number; pruned: number },
): GuidelinesResult {
  return {
    agentsWritten,
    mcpWired,
    mcpRemoved,
    hints,
    skillsCopied: skills.copied,
    skillsLinked: skills.linked,
    skillsPruned: skills.pruned,
  };
}
