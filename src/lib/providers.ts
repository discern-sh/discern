/**
 * The typed provider registry (ADR 0031): the single source of truth for
 * everything agent-specific — the compiled guidance file, the worktree-hook
 * surface, the MCP-server registration, and the skills directory. Keyed by
 * {@link AgentName} as a TOTAL Record, so the type checker forces a complete entry
 * for every known agent and provider-specific behaviour can never drift across the
 * codebase.
 *
 * Claude Code is implemented end-to-end. Other agents carry their guidance-file
 * mapping (the long-standing behaviour) and their skills directory, with
 * `mcp`/`hooks` left as typed TODOs — there is no universal setup, so each must be
 * authored against that agent's own mechanism. An absent integration is simply
 * skipped, never guessed.
 */

import { dirname, join } from "@std/path";
import { ensureDir } from "@std/fs";
import type { AgentName } from "./config.ts";
import { AGENT_NAMES } from "../shared/config_schema.ts";
import {
  mergeJsonSettingsText,
  type SettingsSeedMerge,
} from "./settings_merge.ts";

// ── the MCP server discern registers ────────────────────────────────────────

/** The discern MCP server an agent registers — one source of truth (it is just
 * `discern mcp`, exposing the verbs as tools; see ADR 0030). */
export interface McpServerSpec {
  readonly name: string;
  readonly command: string;
  readonly args: readonly string[];
}

/** discern's own MCP server spec — what every provider's `mcp.register` installs. */
export const DISCERN_MCP_SERVER: McpServerSpec = {
  name: "discern",
  command: "discern",
  args: ["mcp"],
};

/** The advice surfaced — to users and agents alike (via the result `hints`) — when
 * a discern MCP server is registered for the FIRST time. A freshly-added MCP server
 * is typically not detected until the coding agent restarts; it persists after. */
export const MCP_RESTART_HINT =
  "A discern MCP server was registered for the first time — restart your coding agent (or reload its MCP servers) for the discern tools to become available.";

// ── the per-agent integration surfaces ──────────────────────────────────────

/** The outcome of wiring a provider's MCP server. */
export interface McpWireResult {
  /** Project-relative files written (empty when everything was already present). */
  written: string[];
  /**
   * True when the discern server was NEWLY added (absent before this run) — the
   * signal that the coding agent likely needs a restart to detect it. False on a
   * no-op or an in-place update of an already-registered server.
   */
  firstInstall: boolean;
}

/** How a provider registers an MCP server in a project — idempotently, preserving
 * the file's other contents. The discern server is core infrastructure (ADR 0045),
 * always wired; there is no feature-off removal path. */
export interface McpIntegration {
  /** The project-relative config file this provider keeps its servers in. */
  readonly configFile: string;
  /** Register `server` for this provider under `root`, idempotently. */
  register(root: string, server: McpServerSpec): Promise<McpWireResult>;
}

/** A provider's worktree-automation surface: where its lifecycle hooks live and
 * the hook-event vocabulary it uses. Drives `init`'s hook-stripping. */
export interface HooksIntegration {
  /** The project-relative settings file this provider's hooks live in. */
  readonly settingsFile: string;
  /**
   * The create/remove worktree-lifecycle hook-event keys this provider uses. MAY be
   * empty: an agent with no worktree create/remove events (the non-Claude agents)
   * declares a SessionStart-only hooks surface — `worktreeEventKeys = []` and just a
   * `sessionHookNeedle`. The hook-stripper and the parity guard both handle an empty
   * list cleanly (they iterate it).
   */
  readonly worktreeEventKeys: readonly string[];
  /** A substring identifying a SessionStart hook that drives the worktree flow. */
  readonly sessionHookNeedle: string;
  /**
   * How this provider's seed template merges into an existing settings file. Absent
   * ⇒ the default JSON deep-merge ({@link mergeJsonSettingsText}), which every
   * JSON-settings agent uses. A provider whose settings file is another format (e.g.
   * Codex's TOML, a later plan) supplies its own strategy here — so the seed/merge
   * plumbing never bakes in "JSON, at `.claude/settings.json`" as the only shape.
   */
  readonly mergeSeed?: SettingsSeedMerge;
}

/**
 * One hooks provider's settings SEED: the project-relative target file its seed
 * template writes to, plus the strategy that merges the seed into an existing file.
 * The unit the scaffolder routes settings templates by — see {@link settingsSeeds}.
 */
export interface SettingsSeed {
  readonly targetRel: string;
  readonly merge: SettingsSeedMerge;
}

/** The compiled agent-instruction file for one provider. */
export interface GuidanceFile {
  /** Project-relative path of the generated file. */
  readonly path: string;
  /**
   * Whether this is the CANONICAL agent file: the one holding the full compiled
   * body that every other provider's pointer imports (exactly one — codex /
   * AGENTS.md). Decoupled from git-tracking (ADR 0034): the compiled files are all
   * gitignored by default, so "canonical" is about being the single on-disk source,
   * not about being committed. The `@<path>` import resolves a local file
   * regardless of its git status, so the pointer mechanism is unaffected.
   */
  readonly canonical: boolean;
  /**
   * When set, and a canonical agent file is also being emitted, this provider's
   * file is written as a POINTER to that file rather than a full duplicate — using
   * the provider's own include syntax (the `@path` import Claude Code AND Gemini CLI
   * both support; see {@link atImportPointer}). Receives the canonical file's
   * project-relative path; returns the whole file body. Absent → the provider always
   * gets the full compiled guidance (e.g. Codex, whose `AGENTS.md` has no import
   * directive — so it is the canonical file the others point at). The point is
   * single-source-of-truth: the guidance lives in one compiled file and the mirror
   * imports it, so the two can never drift.
   */
  readonly pointer?: (canonicalPath: string) => string;
  /**
   * When true, this provider reads the CANONICAL agent file (`AGENTS.md`) natively
   * and discern emits **nothing** of its own for it — neither a duplicate body nor a
   * pointer. `path` names that canonical file (the one it reads), but every emit
   * site skips it ({@link emitsGuidanceFile}) and every aggregator collapses it, so
   * the file is written and counted exactly once — by the canonical provider, never
   * 3× by repointing a second provider's `path` at it. The reuse-canonical state for
   * agents (Cursor, Copilot, Antigravity) that consume `AGENTS.md` directly; a
   * provider that needs its own file leaves this unset and uses `pointer` (a mirror)
   * or nothing (the canonical itself). Mutually exclusive with `canonical` and
   * `pointer`.
   */
  readonly reuseCanonical?: boolean;
}

/**
 * Whether discern EMITS a file for this guidance entry. False only for a
 * reuse-canonical provider — it reads the canonical file another provider writes,
 * so discern produces nothing for it. The single predicate every emit site and
 * aggregator gates on, so "emits nothing" is decided in one place.
 */
export function emitsGuidanceFile(gf: GuidanceFile): boolean {
  return gf.reuseCanonical !== true;
}

/**
 * The distinct guidance-file paths discern emits for the given entries, in
 * first-seen order: reuse-canonical entries contribute nothing (their content is
 * the canonical file another provider emits), and a repeated path collapses to one.
 * The shared core behind {@link allGuidanceFilePaths} and the renderer's file map,
 * so a reuse-canonical provider can never leak a duplicate `AGENTS.md` into the
 * aggregators.
 */
export function emittedGuidancePaths(files: readonly GuidanceFile[]): string[] {
  const out: string[] = [];
  for (const gf of files) {
    if (emitsGuidanceFile(gf) && !out.includes(gf.path)) {
      out.push(gf.path);
    }
  }
  return out;
}

/** Everything provider-specific for one agent, in one typed record. The single
 * place to extend when teaching discern a new agent. */
export interface Provider {
  readonly name: AgentName;
  readonly label: string;
  /**
   * The CLI executable name(s) this agent ships as, for PATH auto-detection at
   * setup (see {@link detectAgentsOnPath}). Semantics are **match-any**: the agent
   * is "present" when ANY listed binary resolves on PATH — a vendor that ships
   * under several names (e.g. `cursor-agent` AND `agent`) lists them all, which is
   * why this is a list. Non-empty for every provider (the parity guard enforces it);
   * detection iterates `AGENT_NAMES` × these, so a new vendor extends auto-detect for
   * free.
   */
  readonly binaries: readonly string[];
  /** The compiled agent-instruction file: project-relative path + git-tracked. */
  readonly guidanceFile: GuidanceFile;
  /** MCP registration. Absent → not yet supported for this agent (a TODO). */
  readonly mcp?: McpIntegration;
  /** Worktree-hook surface. Absent → not yet supported for this agent. */
  readonly hooks?: HooksIntegration;
  /**
   * Project-relative directory this agent discovers SKILL.md skills in; discern
   * materializes the effective skill set into it. Absent → no skills target for
   * this agent (skipped, never guessed). All three known agents use the identical
   * SKILL.md folder format, differing only in the directory.
   */
  readonly skillsDir?: string;
}

/**
 * A guidance file rendered as a pointer to the canonical agent file: a single
 * `@<path>` import line the agent expands in place when it loads its instruction
 * file. So the compiled guidance lives in ONE file (`AGENTS.md`) and every mirror
 * imports it rather than duplicating the body — they can never drift from it.
 *
 * The `@path` syntax is byte-identical and vendor-supported for BOTH Claude Code
 * (`CLAUDE.md`, the mechanism a user's own `~/.claude/CLAUDE.md` uses) and Gemini
 * CLI (`GEMINI.md`, its Memory Import Processor — `.md`-only, which `@AGENTS.md`
 * satisfies), so one function serves both. Codex's `AGENTS.md` has NO import
 * directive, which is exactly why it is the canonical full-body file the others
 * point AT, never a pointer itself (verified against vendor docs; ADR 0043).
 *
 * No banner: Claude Code strips HTML comments before the model sees them, so a
 * do-not-edit banner here would be invisible to the only agent that reads this
 * file. The generated-ness is conveyed in-band by `base.md`, and drift is guarded
 * by the `finish`/`status` currency check (ADR 0034).
 */
export function atImportPointer(canonicalPath: string): string {
  return `@${canonicalPath}\n`;
}

// ── small JSON helpers (read-or-empty, write pretty) ────────────────────────

function isObject(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

function asStringArray(v: unknown): string[] {
  return Array.isArray(v)
    ? v.filter((x): x is string => typeof x === "string")
    : [];
}

/** Read a JSON object file, or `{}` when it is absent / unreadable / non-object. */
async function readJsonObject(path: string): Promise<Record<string, unknown>> {
  let text: string;
  try {
    text = await Deno.readTextFile(path);
  } catch {
    return {};
  }
  try {
    const v: unknown = JSON.parse(text);
    return isObject(v) ? v : {};
  } catch {
    return {};
  }
}

/** Write a pretty JSON object with a trailing newline (creating parent dirs). */
async function writeJsonObject(path: string, value: unknown): Promise<void> {
  await ensureDir(dirname(path));
  await Deno.writeTextFile(path, `${JSON.stringify(value, null, 2)}\n`);
}

// ── Claude Code ─────────────────────────────────────────────────────────────

const CLAUDE_MCP_FILE = ".mcp.json";
const CLAUDE_SETTINGS_FILE = ".claude/settings.json";

/** Claude Code's own project skills directory. Claude Code does NOT read the
 * cross-tool `.agents/skills/` (anthropics/claude-code#31005), so it keeps its own. */
const CLAUDE_SKILLS_DIR = ".claude/skills";

/** The cross-tool Agent Skills standard project directory — Codex's only repo path
 * and Gemini's preferred alias — so the two share one materialization target. */
const AGENTS_SKILLS_DIR = ".agents/skills";

/**
 * Register discern's MCP server for Claude Code: write the server into the
 * project-scoped `.mcp.json` (committed, shared with everyone who opens the repo),
 * and pre-approve it by name in `.claude/settings.json` (`enabledMcpjsonServers`)
 * so the agent uses it without an approval prompt. Idempotent: a second run that
 * finds both already in place writes nothing.
 */
async function registerClaudeCodeMcp(
  root: string,
  server: McpServerSpec,
): Promise<McpWireResult> {
  const written: string[] = [];

  // 1. .mcp.json — the project-scoped server definition (a local stdio command).
  //    MERGE, never clobber: an existing file's other servers and top-level keys
  //    are preserved; only this server's entry is added/updated.
  const mcpPath = join(root, CLAUDE_MCP_FILE);
  const mcpDoc = await readJsonObject(mcpPath);
  const servers = isObject(mcpDoc.mcpServers) ? mcpDoc.mcpServers : {};
  // First install = the server name was absent before — the restart-needed signal.
  const firstInstall = !(server.name in servers);
  const desired = {
    type: "stdio",
    command: server.command,
    args: [...server.args],
  };
  if (JSON.stringify(servers[server.name]) !== JSON.stringify(desired)) {
    mcpDoc.mcpServers = { ...servers, [server.name]: desired };
    await writeJsonObject(mcpPath, mcpDoc);
    written.push(CLAUDE_MCP_FILE);
  }

  // 2. .claude/settings.json — pre-approve the project-scoped server by name,
  //    preserving every other setting (hooks, permissions) already written.
  const setPath = join(root, CLAUDE_SETTINGS_FILE);
  const settings = await readJsonObject(setPath);
  const approved = asStringArray(settings.enabledMcpjsonServers);
  if (!approved.includes(server.name)) {
    settings.enabledMcpjsonServers = [...approved, server.name];
    await writeJsonObject(setPath, settings);
    written.push(CLAUDE_SETTINGS_FILE);
  }

  return { written, firstInstall };
}

// ── the registry ────────────────────────────────────────────────────────────

/**
 * Every provider, keyed by {@link AgentName}. A TOTAL Record, so a new agent
 * cannot be added to `AGENT_NAMES` without a complete provider here (a compile
 * error) — that is the mechanism that keeps the registry the single source of
 * truth. Rule: `AGENTS.md` (codex) is the one CANONICAL agent file (it holds the
 * full body; the others point at it); all compiled files are gitignored by default
 * (ADR 0034).
 */
export const PROVIDERS: Record<AgentName, Provider> = {
  claude_code: {
    name: "claude_code",
    label: "Claude Code",
    binaries: ["claude"],
    guidanceFile: {
      path: "CLAUDE.md",
      canonical: false,
      pointer: atImportPointer,
    },
    mcp: {
      configFile: CLAUDE_MCP_FILE,
      register: registerClaudeCodeMcp,
    },
    hooks: {
      settingsFile: CLAUDE_SETTINGS_FILE,
      worktreeEventKeys: ["WorktreeCreate", "WorktreeRemove"],
      sessionHookNeedle: "worktree",
    },
    skillsDir: CLAUDE_SKILLS_DIR,
  },
  codex: {
    name: "codex",
    label: "Codex",
    binaries: ["codex"],
    guidanceFile: { path: "AGENTS.md", canonical: true },
    skillsDir: AGENTS_SKILLS_DIR,
    // TODO(provider:codex): wire MCP registration — author an McpIntegration
    // against Codex's own MCP-server config mechanism (it is NOT Claude Code's
    // .mcp.json). Until then `discern mcp` must be added by hand for Codex.
    // TODO(provider:codex): declare the worktree-hook surface (HooksIntegration)
    // once Codex's hook mechanism is supported, mirroring claude_code.
  },
  gemini: {
    name: "gemini",
    label: "Gemini",
    binaries: ["gemini"],
    // GEMINI.md points at the canonical AGENTS.md via Gemini's `@path` Memory Import
    // (verified vendor support — `.md`-only, which `@AGENTS.md` satisfies), exactly
    // like Claude Code, so the body lives in one file and the mirror can't drift.
    guidanceFile: {
      path: "GEMINI.md",
      canonical: false,
      pointer: atImportPointer,
    },
    // Gemini reads .gemini/skills/ AND the .agents/skills/ alias (which takes
    // precedence) — use the shared alias so Codex + Gemini dedupe to one dir.
    skillsDir: AGENTS_SKILLS_DIR,
    // TODO(provider:gemini): wire MCP registration — author an McpIntegration
    // against the Gemini CLI's own MCP-server config (it is NOT .mcp.json).
    // TODO(provider:gemini): declare the worktree-hook surface once supported.
  },
};

/** The provider for an agent name, or undefined for an unknown name. */
export function providerFor(agent: string): Provider | undefined {
  return Object.hasOwn(PROVIDERS, agent)
    ? PROVIDERS[agent as AgentName]
    : undefined;
}

/** Every provider that declares a worktree-hook surface. */
export function providersWithHooks(): Provider[] {
  return Object.values(PROVIDERS).filter((p) => p.hooks !== undefined);
}

/**
 * The settings SEED for every hooks provider — its settings file plus the merge
 * strategy (the provider's own `mergeSeed`, or the default JSON deep-merge). The
 * single registry-derived source the scaffolder routes settings templates by
 * ({@link import("./fs_plan.ts").buildPlan}), so a new hooks provider seeds purely
 * from its registry declaration: declare a `HooksIntegration` and drop a
 * `${settingsFile}.tmpl` template — no edit to the seed/merge plumbing.
 */
export function settingsSeeds(): SettingsSeed[] {
  return providersWithHooks().flatMap((p) =>
    p.hooks !== undefined
      ? [{
        targetRel: p.hooks.settingsFile,
        merge: p.hooks.mergeSeed ?? mergeJsonSettingsText,
      }]
      : []
  );
}

/**
 * The deduplicated skills directories to materialize into for the given configured
 * agents — each agent's `skillsDir`, in first-seen order, skipping an unknown agent
 * or one with no skills target. Codex and Gemini collapse to a single
 * `.agents/skills/`; Claude Code adds its own `.claude/skills/`.
 */
export function skillsDirsForAgents(agents: readonly string[]): string[] {
  const dirs: string[] = [];
  for (const agent of agents) {
    const dir = providerFor(agent)?.skillsDir;
    if (dir !== undefined && !dirs.includes(dir)) {
      dirs.push(dir);
    }
  }
  return dirs;
}

// ── registry-derived agent-path aggregators ─────────────────────────────────
// The SINGLE place every cross-cutting consumer (the seed `.gitignore`, the
// neutral-scope defaults, the audit's agent-file probe, the gitignore-convergence
// migration, and the parity guard) reads agent-specific paths FROM. Each derives
// from `PROVIDERS`, so adding an agent to `AGENT_NAMES` extends them for free — no
// hand-maintained second list to fall out of sync (the ADR 0031/0042 contract).

/** Every compiled guidance-file path discern EMITS across all known agents
 * (CLAUDE.md, AGENTS.md, GEMINI.md, …), in registry order. Reuse-canonical
 * providers contribute nothing (they read the canonical file another provider
 * writes), and duplicates collapse — so the set never carries `AGENTS.md` twice. */
export function allGuidanceFilePaths(): string[] {
  return emittedGuidancePaths(
    AGENT_NAMES.map((a) => PROVIDERS[a].guidanceFile),
  );
}

/** Every distinct skills directory discern materializes into across all known
 * agents — `.claude/skills` plus the shared `.agents/skills`, deduped. */
export function allSkillsDirs(): string[] {
  return skillsDirsForAgents(AGENT_NAMES);
}

/**
 * The gate-neutral region for each agent's generated footprint: the top path
 * segment of every known agent's skills directory (`.claude/skills` → `.claude/`,
 * `.agents/skills` → `.agents/`), deduped in first-seen order. Seeds the neutral
 * scopes so a change under ANY agent's generated dir needs no gate — uniformly,
 * for every agent the registry knows, present and future.
 */
export function neutralAgentScopePaths(): string[] {
  const out: string[] = [];
  for (const dir of allSkillsDirs()) {
    const top = `${dir.split("/")[0]}/`;
    if (!out.includes(top)) {
      out.push(top);
    }
  }
  return out;
}

/** The project-relative paths discern GENERATES for agents that must be gitignored:
 * each compiled guidance file and each materialized skills dir. Registry-derived, so
 * the seed `.gitignore` and the convergence migration cover every agent's artifacts
 * without a hand-maintained literal list. */
export function agentArtifactPaths(): {
  guidanceFiles: string[];
  skillsDirs: string[];
} {
  return { guidanceFiles: allGuidanceFilePaths(), skillsDirs: allSkillsDirs() };
}

/**
 * Wire discern's MCP server into the project for each configured agent that
 * supports it (idempotent). Agents without an `mcp` integration are skipped
 * (their setup is a typed TODO). Returns the files written across all providers
 * plus whether any provider added the server for the first time.
 */
export async function wireProviderMcp(
  root: string,
  agents: readonly string[],
  server: McpServerSpec = DISCERN_MCP_SERVER,
): Promise<McpWireResult> {
  const written: string[] = [];
  let firstInstall = false;
  for (const agent of agents) {
    const mcp = providerFor(agent)?.mcp;
    if (mcp !== undefined) {
      const r = await mcp.register(root, server);
      written.push(...r.written);
      firstInstall = firstInstall || r.firstInstall;
    }
  }
  return { written: [...new Set(written)], firstInstall };
}
