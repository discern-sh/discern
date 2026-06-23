/**
 * The typed provider registry (ADR 0031): the single source of truth for
 * everything agent-specific — the compiled guidance file, the worktree-hook
 * surface, and the MCP-server registration. Keyed by {@link AgentName} as a TOTAL
 * Record, so the type checker forces a complete entry for every known agent and
 * provider-specific behaviour can never drift across the codebase.
 *
 * Claude Code is implemented end-to-end. Other agents carry their guidance-file
 * mapping (the long-standing behaviour) with `mcp`/`hooks` left as typed TODOs —
 * there is no universal setup, so each must be authored against that agent's own
 * mechanism. An absent integration is simply skipped, never guessed.
 */

import { dirname, join } from "@std/path";
import { ensureDir } from "@std/fs";
import type { AgentName } from "./config.ts";

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

/** How a provider registers — and removes — an MCP server in a project. Both
 * directions are idempotent and preserve the file's other contents. */
export interface McpIntegration {
  /** The project-relative config file this provider keeps its servers in. */
  readonly configFile: string;
  /** Register `server` for this provider under `root`, idempotently. */
  register(root: string, server: McpServerSpec): Promise<McpWireResult>;
  /** Remove `server` for this provider under `root`, idempotently. Returns the
   * project-relative paths changed (empty when it was already absent). */
  unregister(root: string, server: McpServerSpec): Promise<string[]>;
}

/** A provider's worktree-automation surface: where its lifecycle hooks live and
 * the hook-event vocabulary it uses. Drives `init`'s hook-stripping. */
export interface HooksIntegration {
  /** The project-relative settings file this provider's hooks live in. */
  readonly settingsFile: string;
  /** The create/remove worktree-lifecycle hook-event keys this provider uses. */
  readonly worktreeEventKeys: readonly string[];
  /** A substring identifying a SessionStart hook that drives the worktree flow. */
  readonly sessionHookNeedle: string;
}

/** Everything provider-specific for one agent, in one typed record. The single
 * place to extend when teaching discern a new agent. */
export interface Provider {
  readonly name: AgentName;
  readonly label: string;
  /** The compiled agent-instruction file: project-relative path + git-tracked. */
  readonly guidanceFile: { readonly path: string; readonly tracked: boolean };
  /** MCP registration. Absent → not yet supported for this agent (a TODO). */
  readonly mcp?: McpIntegration;
  /** Worktree-hook surface. Absent → not yet supported for this agent. */
  readonly hooks?: HooksIntegration;
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

/**
 * Remove discern's MCP server for Claude Code (the inverse of registration; used
 * when the `mcp` feature is turned off). Deletes the server from `.mcp.json` and
 * its approval from `.claude/settings.json`, both idempotently — preserving any
 * OTHER servers/settings, and removing a `.mcp.json` discern alone created rather
 * than leaving an empty husk.
 */
async function unregisterClaudeCodeMcp(
  root: string,
  server: McpServerSpec,
): Promise<string[]> {
  const written: string[] = [];

  const mcpPath = join(root, CLAUDE_MCP_FILE);
  const mcpDoc = await readJsonObject(mcpPath);
  if (isObject(mcpDoc.mcpServers) && server.name in mcpDoc.mcpServers) {
    delete mcpDoc.mcpServers[server.name];
    const hasOtherServers = Object.keys(mcpDoc.mcpServers).length > 0;
    const hasOtherKeys = Object.keys(mcpDoc).some((k) => k !== "mcpServers");
    if (!hasOtherServers && !hasOtherKeys) {
      // The file held only our server — remove it, don't leave an empty husk.
      await Deno.remove(mcpPath).catch(() => {});
    } else {
      if (!hasOtherServers) {
        delete mcpDoc.mcpServers;
      }
      await writeJsonObject(mcpPath, mcpDoc);
    }
    written.push(CLAUDE_MCP_FILE);
  }

  const setPath = join(root, CLAUDE_SETTINGS_FILE);
  const settings = await readJsonObject(setPath);
  const approved = asStringArray(settings.enabledMcpjsonServers);
  if (approved.includes(server.name)) {
    const next = approved.filter((s) => s !== server.name);
    if (next.length === 0) {
      delete settings.enabledMcpjsonServers;
    } else {
      settings.enabledMcpjsonServers = next;
    }
    await writeJsonObject(setPath, settings);
    written.push(CLAUDE_SETTINGS_FILE);
  }

  return written;
}

// ── the registry ────────────────────────────────────────────────────────────

/**
 * Every provider, keyed by {@link AgentName}. A TOTAL Record, so a new agent
 * cannot be added to `AGENT_NAMES` without a complete provider here (a compile
 * error) — that is the mechanism that keeps the registry the single source of
 * truth. Rule: `AGENTS.md` (codex) is the one git-tracked agent file; every other
 * mirror is gitignored.
 */
export const PROVIDERS: Record<AgentName, Provider> = {
  claude_code: {
    name: "claude_code",
    label: "Claude Code",
    guidanceFile: { path: "CLAUDE.md", tracked: false },
    mcp: {
      configFile: CLAUDE_MCP_FILE,
      register: registerClaudeCodeMcp,
      unregister: unregisterClaudeCodeMcp,
    },
    hooks: {
      settingsFile: CLAUDE_SETTINGS_FILE,
      worktreeEventKeys: ["WorktreeCreate", "WorktreeRemove"],
      sessionHookNeedle: "worktree",
    },
  },
  codex: {
    name: "codex",
    label: "Codex",
    guidanceFile: { path: "AGENTS.md", tracked: true },
    // TODO(provider:codex): wire MCP registration — author an McpIntegration
    // against Codex's own MCP-server config mechanism (it is NOT Claude Code's
    // .mcp.json). Until then `discern mcp` must be added by hand for Codex.
    // TODO(provider:codex): declare the worktree-hook surface (HooksIntegration)
    // once Codex's hook mechanism is supported, mirroring claude_code.
  },
  gemini: {
    name: "gemini",
    label: "Gemini",
    guidanceFile: { path: "GEMINI.md", tracked: false },
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

/**
 * Remove discern's MCP server from the project for each configured agent that
 * supports it (idempotent) — used when the `mcp` feature is turned off. Returns
 * the unique project-relative files changed.
 */
export async function unwireProviderMcp(
  root: string,
  agents: readonly string[],
  server: McpServerSpec = DISCERN_MCP_SERVER,
): Promise<string[]> {
  const written: string[] = [];
  for (const agent of agents) {
    const mcp = providerFor(agent)?.mcp;
    if (mcp !== undefined) {
      written.push(...await mcp.unregister(root, server));
    }
  }
  return [...new Set(written)];
}
