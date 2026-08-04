/**
 * The guideline compiler (ADR 0020): the EFFECTFUL orchestrator that writes the
 * generated per-provider agent files (CLAUDE.md, AGENTS.md, GEMINI.md, …),
 * materializes skills, and wires provider integration artifacts (MCP, worktree app
 * config, project rules). The pure content — what each file should contain — is
 * computed by `renderAgentFiles` in `./guidance_render.ts`, the single source this
 * writer and the `status`/`done` currency check both use, so a generated file can
 * never silently disagree with what a refresh produces (ADR 0034). It writes each
 * provider file named in `[project].agents`.
 *
 * The files carry no banner — they open with the guidance itself; `base.md`'s
 * in-body "never hand-edit" section conveys their generated-ness to every agent,
 * and the currency check guards drift. Nothing is hand-edited: edit your sources,
 * or discern's built-ins, and recompile.
 *
 * Two independent jobs, both safe to run from anywhere: materialize skills into
 * each configured agent's skills dir (`.claude/skills/`, `.agents/skills/`; see
 * lib/skills.ts + the registry), and compile the agent files via
 * `renderAgentFiles`.
 */

import { ensureDir } from "@std/fs";
import { dirname, join } from "@std/path";
import { adrIndexState } from "../lib/adr_index.ts";
import { type DiscernConfig, loadConfig } from "../shared/config_schema.ts";
import type { DiscernResult } from "../shared/result.ts";
import type { RefreshData } from "../shared/result_schemas.ts";
import { resolveGuidanceSources } from "../lib/paths.ts";
import { wireProviderHooks } from "../lib/provider_hooks.ts";
import { materializeSkills } from "../lib/skills.ts";
import {
  DISCERN_MCP_SERVER,
  providerFor,
  skillsDirsForAgents,
  wireProviderMcp,
  wireProviderProjectRules,
  wireProviderWorktreeApp,
} from "../lib/providers.ts";
import {
  fire,
  type FiredHint,
  HINTS,
  hintTexts,
  mergeHintTexts,
} from "../shared/hints.ts";
import {
  agentFilePaths,
  guidanceAgents,
  renderAgentFiles,
} from "./guidance_render.ts";
import { Logger } from "../lib/log.ts";
import { reconcileReceiptNotesFetch } from "./gate/receipt_notes.ts";
import {
  ensureDiscernGitattributesBlock,
  GITATTRIBUTES_REL,
  refusedGitattributesPatternLabel,
} from "../lib/agent_gitattributes.ts";

/** What a single `compileGuidelines` run accomplished. */
export interface GuidelinesResult {
  /** Output paths (relative to `root`) written, in agent-config order. */
  agentsWritten: string[];
  /** Tracked Agent files and Shared files whose bytes or executable bit changed.
   * Internal trigger evidence for refresh's commit advisory; the public data shape
   * continues to report paths in its existing per-artifact buckets. */
  trackedArtifactsChanged: string[];
  /** Managed attributes files whose discern-owned block changed. Kept separate
   * so update can commit this Shared derived region without treating the whole
   * file as safe for generated-conflict auto-resolution. */
  gitattributesChanged: string[];
  /** Project files written wiring each agent's MCP server (`.mcp.json`, settings). */
  mcpWired: string[];
  /** Provider hook/settings files re-seeded with discern's hook groups. */
  hooksWired: string[];
  /** Project files written co-managing an agent app's worktree-lifecycle config
   * (Codex's `environment.toml` [setup]/[cleanup]). Empty when no configured agent
   * declares one, or when all were already in place. */
  worktreeAppWired: string[];
  /** Project-local provider policy/rules files written, such as Codex exec rules. */
  projectRulesWired: string[];
  /** Local Git config keys whose managed receipt-note fetch mappings changed. */
  receiptNotesFetchChanged: string[];
  /** The ADR README whose maintained record lists this run regenerated — at
   * most one path; empty when the index is current or the project carries no
   * index markers (the index is opt-in by construction). */
  adrIndexWritten: string[];
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

export interface CompileGuidelinesOptions {
  /**
   * Acceptance reconciles this integration before writing the note, where its
   * fail-open result is recorded. Its later checkout refresh skips the duplicate
   * pass so the same transport error cannot make a successful landing look red.
   */
  readonly reconcileReceiptNotesFetch?: boolean;
}

/** The non-blank refresh errors a caller should treat as failed artifacts.
 * Whitespace-only entries are ignored so accidental empty strings don't turn a
 * successful refresh into a failure. */
export function guidanceRefreshErrors(
  result: Pick<GuidelinesResult, "errors">,
): string[] {
  return result.errors
    .map((error) => error.trim())
    .filter((error) => error.length > 0);
}

/** Whether a guidance refresh completed without any non-blank artifact errors. */
export function guidanceRefreshSucceeded(
  result: Pick<GuidelinesResult, "errors">,
): boolean {
  return guidanceRefreshErrors(result).length === 0;
}

/** Reconcile generated merge attributes and reduce failures to refresh errors. */
async function reconcileGeneratedMergeAttributes(
  root: string,
  config: DiscernConfig,
  log: Logger,
): Promise<{ changed: string[]; errors: string[] }> {
  try {
    const result = await ensureDiscernGitattributesBlock(
      root,
      config,
      agentFilePaths(config),
    );
    const changed = result.operations.length > 0 ? [GITATTRIBUTES_REL] : [];
    if (changed.length > 0) {
      log.info(`reconciled the discern block in ${GITATTRIBUTES_REL}`);
    }
    for (const refused of result.refused) {
      log.warn(
        `refresh: ${refusedGitattributesPatternLabel(refused)} pattern ${
          JSON.stringify(refused.pattern)
        } was omitted from ${GITATTRIBUTES_REL}: ${refused.reason}.`,
      );
    }
    return { changed, errors: [] };
  } catch (error) {
    const message = `could not maintain ${GITATTRIBUTES_REL}: ${
      errText(error)
    }`;
    log.warn(message);
    return { changed: [], errors: [message] };
  }
}

/** Render the compile summary as the stable `refresh` data payload. */
function refreshData(result: GuidelinesResult): RefreshData {
  return {
    agents_written: result.agentsWritten,
    mcp_wired: result.mcpWired,
    hooks_wired: result.hooksWired,
    worktree_app_wired: result.worktreeAppWired,
    project_rules_wired: result.projectRulesWired,
    receipt_notes_fetch_changed: result.receiptNotesFetchChanged,
    adr_index_written: result.adrIndexWritten,
    skills: {
      copied: result.skillsCopied,
      linked: result.skillsLinked,
      pruned: result.skillsPruned,
    },
    errors: guidanceRefreshErrors(result),
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
  const errors = guidanceRefreshErrors(result);
  const failed = errors.length > 0;
  const hints = !failed && result.trackedArtifactsChanged.length > 0
    ? mergeHintTexts(
      hintTexts([fire(HINTS["refresh-commit-tracked-artifacts"])]),
      result.hints,
    )
    : result.hints;
  return {
    ok: !failed,
    verb: "refresh",
    ...(failed
      ? {
        error: "partial_refresh",
        message:
          `${errors.length} artifact(s) failed to refresh; see data.errors.`,
      }
      : {}),
    hints,
    data: refreshData(result),
  };
}

/** Normalise an unknown thrown value into a message string. */
function errText(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/**
 * Compile the agent files from the built-in guidance + the project's sources, and
 * materialize skills. Resolves to a summary of
 * what changed. The worktree lifecycle and `upgrade` call this with the discovered
 * project `root`; the name and signature are a cross-module contract.
 */
export async function compileGuidelines(
  root: string,
  logger?: Logger,
  options: CompileGuidelinesOptions = {},
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

  // --- job 1: materialize skills into each configured agent's skills dir --------
  let skills = { copied: 0, linked: 0, pruned: 0 };
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

  // --- job 2: MCP integration (ADR 0045) --------------------------------------
  // The MCP server is core infrastructure — an idempotent
  // integration artifact (re-)established for every configured agent on each
  // refresh / upgrade / worktree-setup. A
  // FIRST install yields the restart hint (surfaced to the user AND the result
  // `hints`). Best-effort: a hiccup must not fail the compile.
  let mcpWired: string[] = [];
  const hints: FiredHint[] = [];
  try {
    const r = await wireProviderMcp(root, agents, DISCERN_MCP_SERVER, config);
    mcpWired = r.written;
    if (r.written.length > 0) {
      log.info(
        `registered the discern MCP server in: ${r.written.join(", ")}`,
      );
    }
    if (r.firstInstall) {
      const restartHint = fire(HINTS["refresh-mcp-first-install"]);
      hints.push(restartHint);
      log.info(restartHint.text);
    }
  } catch (error) {
    const msg = `could not update the MCP integration: ${errText(error)}`;
    log.warn(msg);
    errors.push(msg);
  }

  // --- job 2a: provider session hooks (worktree/session readiness) -----------
  // Hook files are committed provider settings: not generated, but not fire-and-
  // forget seeds either. Re-apply only the configured provider hook seeds through
  // their merge strategies, preserving user settings and extra hooks.
  let hooksWired: string[] = [];
  try {
    const r = await wireProviderHooks(root, config);
    hooksWired = r.written;
    errors.push(...r.errors);
    if (hooksWired.length > 0) {
      log.info(`re-seeded provider hooks in: ${hooksWired.join(", ")}`);
    }
  } catch (error) {
    const msg = `could not update the provider hook integration: ${
      errText(error)
    }`;
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

  // --- job 2d: receipt-note fetch transport -----------------------------------
  // Local receipt recording is unconditional at acceptance. Transport remains
  // opt-in: only "fetch" adds an optional additive mapping, and returning to
  // "local" removes only mappings marked as managed by this integration.
  let receiptNotesFetchChanged: string[] = [];
  if (options.reconcileReceiptNotesFetch !== false) {
    try {
      const reconciled = await reconcileReceiptNotesFetch(
        root,
        config.repository.receipt_notes,
      );
      receiptNotesFetchChanged = [
        ...new Set([
          ...reconciled.added,
          ...reconciled.removed,
        ]),
      ];
      errors.push(...reconciled.errors);
      if (receiptNotesFetchChanged.length > 0) {
        log.info(
          `updated receipt-note fetch transport in: ${
            receiptNotesFetchChanged.join(", ")
          }`,
        );
      }
    } catch (error) {
      const msg = `could not update receipt-note fetch transport: ${
        errText(error)
      }`;
      log.warn(msg);
      errors.push(msg);
    }
  }

  // --- job 2e: the maintained ADR index ---------------------------------------
  // The record lists in the ADR README (`<map dir>/_adr/README.md`) are
  // regenerated from the record files on disk whenever the README carries the
  // index markers; a README without them is never touched, so the index is
  // opt-in by construction. Stateless like the agent-file compile: the expected
  // content is recomputed each run, and the same computation backs the
  // `status`/`done` currency checks. Best-effort: a failure is recorded, never
  // fatal.
  let adrIndexWritten: string[] = [];
  try {
    const state = await adrIndexState(root, config.map.dir);
    if (state.kind === "stale") {
      await Deno.writeTextFile(join(root, state.path), state.expected);
      adrIndexWritten = [state.path];
      log.info(`regenerated the ADR index in ${state.path}`);
    } else if (state.kind === "invalid") {
      const msg =
        `could not regenerate the ADR index in ${state.path}: ${state.issue}`;
      log.warn(msg);
      errors.push(msg);
    }
  } catch (error) {
    const msg = `could not maintain the ADR index: ${errText(error)}`;
    log.warn(msg);
    errors.push(msg);
  }

  // --- job 3: compile the agent files -----------------------------------------
  const agentsWritten: string[] = [];
  const agentFilesChanged: string[] = [];

  // Render the expected content for every configured provider — the SINGLE source
  // of the compiled-file content, shared with the `status`/`done` currency check
  // (ADR 0034) — then write each. A provider that declares an import (Claude Code)
  // already gets a pointer to the canonical file here, not a duplicate body.
  let rendered: Map<string, string>;
  try {
    rendered = await renderAgentFiles(root, config);
  } catch (error) {
    const msg = `could not compute the agent files: ${errText(error)}`;
    log.warn(msg);
    errors.push(msg);
    const attributes = await reconcileGeneratedMergeAttributes(
      root,
      config,
      log,
    );
    errors.push(...attributes.errors);
    return summarize(
      agentsWritten,
      agentFilesChanged,
      attributes.changed,
      mcpWired,
      hooksWired,
      worktreeAppWired,
      projectRulesWired,
      receiptNotesFetchChanged,
      adrIndexWritten,
      hints,
      skills,
      errors,
    );
  }
  for (const agent of agents) {
    const gf = providerFor(agent)?.guidanceFile;
    if (gf === undefined) {
      log.warn(
        `refresh: unknown agent '${agent}' in [project].agents — skipping (no output mapping).`,
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
      let changed = true;
      try {
        const existing = await Deno.readTextFile(out);
        const stat = await Deno.stat(out);
        changed = existing !== fileBody || ((stat.mode ?? 0) & 0o111) !== 0;
      } catch {
        // Preserve the existing write path when inspection is unavailable. The
        // write below remains the authority on whether this artifact can refresh.
        changed = true;
      }
      await Deno.writeTextFile(out, fileBody);
      // A generated file should be readable like any other source (mode 0644).
      await Deno.chmod(out, 0o644);
      agentsWritten.push(rel);
      if (changed) {
        agentFilesChanged.push(rel);
      }
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
      ? 'refresh: no known providers in [project].agents — compiled nothing. Set agents = ["claude_code", …].'
      : "refresh: configured guidance providers rendered no agent files — check [project].agents and provider guidance mappings.";
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

  // --- job 4: generated-artifact merge attributes ---------------------------
  // Agent paths become built-in candidates in the same refresh that writes
  // them, so reconcile after compilation. Tracked files remain candidates when
  // a write failed or a configured provider was removed. A scope pattern whose
  // meaning Git attributes cannot preserve is omitted and reported; doctor
  // keeps that warning visible after this run.
  const attributes = await reconcileGeneratedMergeAttributes(
    root,
    config,
    log,
  );
  errors.push(...attributes.errors);
  return summarize(
    agentsWritten,
    agentFilesChanged,
    attributes.changed,
    mcpWired,
    hooksWired,
    worktreeAppWired,
    projectRulesWired,
    receiptNotesFetchChanged,
    adrIndexWritten,
    hints,
    skills,
    errors,
  );
}

/** Build the result. The skills narration is emitted once by `materializeSkills`,
 * so this does not repeat it. */
function summarize(
  agentsWritten: string[],
  agentFilesChanged: string[],
  gitattributesChanged: string[],
  mcpWired: string[],
  hooksWired: string[],
  worktreeAppWired: string[],
  projectRulesWired: string[],
  receiptNotesFetchChanged: string[],
  adrIndexWritten: string[],
  hints: FiredHint[],
  skills: { copied: number; linked: number; pruned: number },
  errors: string[],
): GuidelinesResult {
  return {
    agentsWritten,
    trackedArtifactsChanged: [
      ...new Set([
        ...agentFilesChanged,
        ...gitattributesChanged,
        ...mcpWired,
        ...hooksWired,
        ...worktreeAppWired,
        ...projectRulesWired,
        ...adrIndexWritten,
      ]),
    ],
    gitattributesChanged,
    mcpWired,
    hooksWired,
    worktreeAppWired,
    projectRulesWired,
    receiptNotesFetchChanged,
    adrIndexWritten,
    hints: hintTexts(hints),
    skillsCopied: skills.copied,
    skillsLinked: skills.linked,
    skillsPruned: skills.pruned,
    errors,
  };
}
