/**
 * The guideline compiler (ADR 0020): the EFFECTFUL orchestrator that writes the
 * generated per-provider agent files (CLAUDE.md, AGENTS.md, GEMINI.md, …),
 * materializes skills, and wires provider integration artifacts (MCP, worktree app
 * config, project rules). The pure content — what each file should contain — is
 * computed by `renderAgentFiles` in `./guidance_render.ts`, the single source this
 * writer and the `status`/`finish` currency check both use, so a generated file can
 * never silently disagree with what a refresh produces (ADR 0034). It writes each
 * provider file named in `[guidance].agents` (falling back to the pre-migration
 * `[project].agents`).
 *
 * The files carry no banner — they open with the guidance itself; `base.md`'s
 * in-body "never hand-edit" section conveys their generated-ness to every agent,
 * and the currency check guards drift. Nothing is hand-edited: edit your sources,
 * or discern's built-ins, and recompile.
 *
 * Two independent jobs, each gated on its feature and safe to run from anywhere:
 *   - `features.skills`  → materialize skills into each configured agent's skills
 *     dir (`.claude/skills/`, `.agents/skills/`; see lib/skills.ts + the registry);
 *   - `features.guidance`→ compile the agent files via `renderAgentFiles`.
 * The skills job runs even when guidance is off, so skills stay discoverable.
 */

import { ensureDir } from "@std/fs";
import { dirname, join } from "@std/path";
import { loadConfig } from "../shared/config_schema.ts";
import { isFeatureEnabled } from "../shared/features.ts";
import type { DiscernResult } from "../shared/result.ts";
import type { RefreshData } from "../shared/result_schemas.ts";
import { resolveGuidanceSources } from "../lib/paths.ts";
import { materializeSkills } from "../lib/skills.ts";
import {
  DISCERN_MCP_SERVER,
  MCP_RESTART_HINT,
  providerFor,
  skillsDirsForAgents,
  wireProviderMcp,
  wireProviderProjectRules,
  wireProviderWorktreeApp,
} from "../lib/providers.ts";
import { guidanceAgents, renderAgentFiles } from "./guidance_render.ts";
import { Logger } from "../lib/log.ts";

/** What a single `compileGuidelines` run accomplished. */
export interface GuidelinesResult {
  /** Output paths (relative to `root`) written, in agent-config order. */
  agentsWritten: string[];
  /** Project files written wiring each agent's MCP server (`.mcp.json`, settings). */
  mcpWired: string[];
  /** Project files written co-managing an agent app's worktree-lifecycle config
   * (Codex's `environment.toml` [setup]/[cleanup]). Empty when no configured agent
   * declares one, or when all were already in place. */
  worktreeAppWired: string[];
  /** Project-local provider policy/rules files written, such as Codex exec rules. */
  projectRulesWired: string[];
  /** Agent/user-facing advice from this run (e.g. the MCP first-install restart hint). */
  hints: string[];
  /** Bundled skills copied, summed across every configured agent's skills dir. */
  skillsCopied: number;
  /** Authored skills symlinked, summed across every configured agent's skills dir. */
  skillsLinked: number;
  /** Stale managed skill entries pruned, summed across every agent's skills dir. */
  skillsPruned: number;
  /** Per-artifact failures isolated during the compile — a skills dir, the MCP
   * wiring, or one agent file — so a single failure can't abort the rest (ADR 0065).
   * Empty on a fully clean compile. */
  errors: string[];
}

/** Render the compile summary as the stable `refresh` data payload. */
function refreshData(result: GuidelinesResult): RefreshData {
  return {
    agents_written: result.agentsWritten,
    mcp_wired: result.mcpWired,
    worktree_app_wired: result.worktreeAppWired,
    project_rules_wired: result.projectRulesWired,
    skills: {
      copied: result.skillsCopied,
      linked: result.skillsLinked,
      pruned: result.skillsPruned,
    },
    errors: result.errors,
  };
}

/**
 * The result-returning core behind `discern refresh` and `discern_refresh`.
 * Narration is controlled by the caller's logger; by default it is suppressed, so
 * tests and MCP never leak human text onto their machine channels.
 */
export async function refreshResult(
  root: string,
  logger = new Logger({ json: true, noColor: true }),
): Promise<DiscernResult> {
  const result = await compileGuidelines(root, logger);
  const failed = result.errors.length > 0;
  return {
    ok: !failed,
    verb: "refresh",
    ...(failed
      ? {
        error: "partial_refresh",
        message:
          `${result.errors.length} artifact(s) failed to refresh; see data.errors.`,
      }
      : {}),
    hints: result.hints,
    data: refreshData(result),
  };
}

/** Normalise an unknown thrown value into a message string. */
function errText(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
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
  // info/ok → stdout, UNLESS the caller passes
  // its own logger to control the stream — e.g. `upgrade --json` passes its
  // json-mode logger so this narration is suppressed and the JSON object stays
  // the only thing on stdout.
  const log = logger ??
    new Logger({ json: false, noColor: false, humanStream: "stdout" });

  const config = await loadConfig(root);
  const agents = guidanceAgents(config);

  // Per-artifact failures collected across all three jobs, so one (e.g. a sandbox
  // denial writing a skills dir) is isolated and reported rather than aborting the
  // rest (ADR 0065).
  const errors: string[] = [];

  // --- job 1: materialize skills into each configured agent's skills dir (gated) --
  let skills = { copied: 0, linked: 0, pruned: 0 };
  if (isFeatureEnabled(config, "skills")) {
    try {
      const r = await materializeSkills(
        root,
        config,
        skillsDirsForAgents(agents),
        log,
      );
      skills = { copied: r.copied, linked: r.linked, pruned: r.pruned };
      errors.push(...r.errors);
    } catch (error) {
      const msg = `could not materialize skills: ${errText(error)}`;
      log.warn(msg);
      errors.push(msg);
    }
  }

  // --- job 2: MCP integration (always; ADR 0045) ------------------------------
  // The MCP server is core infrastructure, not a toggle — an idempotent
  // integration artifact (re-)established for every configured agent on each
  // refresh / upgrade / worktree-setup, independent of the guidance feature. A
  // FIRST install yields the restart hint (surfaced to the user AND the result
  // `hints`). Best-effort: a hiccup must not fail the compile.
  let mcpWired: string[] = [];
  const hints: string[] = [];
  try {
    const r = await wireProviderMcp(root, agents, DISCERN_MCP_SERVER, config);
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
  } catch (error) {
    const msg = `could not update the MCP integration: ${errText(error)}`;
    log.warn(msg);
    errors.push(msg);
  }

  // --- job 2b: app-managed worktree-lifecycle config (always; ADR 0045 timing) -
  // Co-manage each agent app's autogenerated worktree-lifecycle file (Codex's
  // `environment.toml`), re-emitted on every refresh so it self-heals if the app
  // regenerates it — modelled on the MCP wiring above, not a one-shot seed. Skipped for
  // an agent that declares none. Best-effort: a hiccup is recorded, never fatal.
  let worktreeAppWired: string[] = [];
  try {
    worktreeAppWired = await wireProviderWorktreeApp(root, agents);
    if (worktreeAppWired.length > 0) {
      log.info(
        `co-managed app worktree lifecycle in: ${worktreeAppWired.join(", ")}`,
      );
    }
  } catch (error) {
    const msg = `could not update the worktree-app integration: ${
      errText(error)
    }`;
    log.warn(msg);
    errors.push(msg);
  }

  // --- job 2c: project-local provider rules/policy files ----------------------
  // These are neither MCP entries nor app worktree lifecycle files. Codex uses this
  // surface for narrow project-local exec-policy rules that smooth trusted
  // linked-worktree Git staging/commit operations.
  let projectRulesWired: string[] = [];
  try {
    projectRulesWired = await wireProviderProjectRules(root, agents);
    if (projectRulesWired.length > 0) {
      log.info(
        `co-managed project rules in: ${projectRulesWired.join(", ")}`,
      );
    }
  } catch (error) {
    const msg = `could not update the project-rules integration: ${
      errText(error)
    }`;
    log.warn(msg);
    errors.push(msg);
  }

  // --- job 3: compile the agent files (gated) --------------------------------
  const agentsWritten: string[] = [];
  if (!isFeatureEnabled(config, "guidance")) {
    log.info("guidance feature is off — no agent files compiled.");
    return summarize(
      agentsWritten,
      mcpWired,
      worktreeAppWired,
      projectRulesWired,
      hints,
      skills,
      errors,
    );
  }

  // Render the expected content for every configured provider — the SINGLE source
  // of the compiled-file content, shared with the `status`/`finish` currency check
  // (ADR 0034) — then write each. A provider that declares an import (Claude Code)
  // already gets a pointer to the canonical file here, not a duplicate body.
  let rendered: Map<string, string>;
  try {
    rendered = await renderAgentFiles(root, config);
  } catch (error) {
    const msg = `could not compute the agent files: ${errText(error)}`;
    log.warn(msg);
    errors.push(msg);
    return summarize(
      agentsWritten,
      mcpWired,
      worktreeAppWired,
      projectRulesWired,
      hints,
      skills,
      errors,
    );
  }
  for (const agent of agents) {
    const gf = providerFor(agent)?.guidanceFile;
    if (gf === undefined) {
      log.warn(
        `refresh: unknown agent '${agent}' in [guidance].agents — skipping (no output mapping).`,
      );
      continue;
    }
  }
  for (const [rel, fileBody] of rendered) {
    // Isolate per agent file: a denied write to one provider's file doesn't abort
    // the others (ADR 0065).
    try {
      const out = join(root, rel);
      await ensureDir(dirname(out));
      await Deno.writeTextFile(out, fileBody);
      // A generated file should be readable like any other source (mode 0644).
      await Deno.chmod(out, 0o644);
      agentsWritten.push(rel);
    } catch (error) {
      const msg = `could not write ${rel}: ${errText(error)}`;
      log.warn(msg);
      errors.push(msg);
    }
  }
  if (rendered.size === 0) {
    const knownGuidanceAgents = agents.filter((agent) =>
      providerFor(agent)?.guidanceFile !== undefined
    );
    const msg = knownGuidanceAgents.length === 0
      ? 'refresh: no known providers in [guidance].agents — compiled nothing. Set agents = ["claude_code", …].'
      : "refresh: configured guidance providers rendered no agent files — check [guidance].agents and provider guidance mappings.";
    log.warn(msg);
  } else if (agentsWritten.length === 0) {
    log.warn(
      `refresh: rendered ${rendered.size} agent file(s) but wrote none; see warnings above.`,
    );
  } else {
    const sourceCount = (await resolveGuidanceSources(root, config)).length;
    log.ok(
      `refresh: compiled ${sourceCount} source(s) + built-in guidance into ${agentsWritten.length} agent file(s): ${
        agentsWritten.join(",")
      }`,
    );
  }
  return summarize(
    agentsWritten,
    mcpWired,
    worktreeAppWired,
    projectRulesWired,
    hints,
    skills,
    errors,
  );
}

/** Build the result. The skills narration is emitted once by `materializeSkills`,
 * so this does not repeat it. */
function summarize(
  agentsWritten: string[],
  mcpWired: string[],
  worktreeAppWired: string[],
  projectRulesWired: string[],
  hints: string[],
  skills: { copied: number; linked: number; pruned: number },
  errors: string[],
): GuidelinesResult {
  return {
    agentsWritten,
    mcpWired,
    worktreeAppWired,
    projectRulesWired,
    hints,
    skillsCopied: skills.copied,
    skillsLinked: skills.linked,
    skillsPruned: skills.pruned,
    errors,
  };
}
