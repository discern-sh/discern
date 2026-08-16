/**
 * The coding-agent **identity catalogue** — one vocabulary shared by discern's
 * native provider integrations and the logbook's advisory identity signals.
 *
 * An entry may be native (discern can emit its instructions/configuration),
 * detectable (one or more process, MCP-client, or host-filesystem markers), or
 * both. `AGENT_NAMES` is derived from the entries carrying `nativeName`, so a
 * future native integration starts here and the total `PROVIDERS` record then
 * forces its full integration to be declared. Signal-only agents do not become
 * setup choices merely because the logbook can notice a marker for them.
 *
 * The process marker set follows laravel/agent-detector's published catalogue.
 * These markers are evidence only: callers record marker NAMES, never values,
 * and no product behaviour branches on a match.
 */

/** One conjunction for recognizing process-environment evidence. */
export interface AgentEnvironmentRule {
  /** At least one of these non-empty variables must be present. */
  readonly anyOf?: readonly string[];
  /** Every one of these non-empty variables must be present. */
  readonly allOf?: readonly string[];
  /** None of these variables may be present. */
  readonly noneOf?: readonly string[];
}

/** Values of the conventional `AI_AGENT` declaration recognized for an agent. */
export interface AiAgentRule {
  readonly exact?: readonly string[];
  readonly prefixes?: readonly string[];
}

/** One coding-agent identity and the honest signals discern knows for it. */
export interface AgentIdentityDefinition {
  /** Stable logbook vocabulary. */
  readonly id: string;
  readonly label: string;
  /** Present only when discern has a native provider integration. */
  readonly nativeName?: string;
  /** Stable display/config order for native providers. */
  readonly nativeOrder?: number;
  /** Project-relative path of the compiled instruction file this agent reads —
   * the provider surface a instruction-parity reading can name. Present exactly
   * beside `nativeName`; `PROVIDERS` derives its `instructionFile.path` from it. */
  readonly instructionPath?: string;
  readonly environment?: readonly AgentEnvironmentRule[];
  readonly aiAgent?: AiAgentRule;
  /** Ambient host markers, deliberately distinct from invocation-scoped ones. */
  readonly hostFiles?: readonly string[];
  /** Extra normalized MCP aliases beyond id, label, and nativeName. */
  readonly mcpAliases?: readonly string[];
}

/**
 * Every identity discern can describe. The entries carrying `nativeName`
 * are the supported-provider set; all other named entries are signal-only.
 * `custom` is the privacy-preserving fallback for an unknown non-empty
 * `AI_AGENT` declaration — the declaration's value is never retained.
 */
export const AGENT_CATALOGUE = [
  {
    id: "cursor",
    label: "Cursor",
    nativeName: "cursor",
    nativeOrder: 3,
    instructionPath: "AGENTS.md",
    environment: [{ anyOf: ["CURSOR_AGENT"] }],
    mcpAliases: ["cursor-vscode"],
  },
  {
    id: "claude",
    label: "Claude Code",
    nativeName: "claude_code",
    nativeOrder: 0,
    instructionPath: "CLAUDE.md",
    environment: [{
      anyOf: ["CLAUDECODE", "CLAUDE_CODE"],
      noneOf: ["CLAUDE_CODE_IS_COWORK"],
    }],
    aiAgent: { prefixes: ["claude-code"] },
  },
  {
    id: "cowork",
    label: "Claude Cowork",
    environment: [{
      anyOf: ["CLAUDECODE", "CLAUDE_CODE"],
      allOf: ["CLAUDE_CODE_IS_COWORK"],
    }],
  },
  {
    id: "devin",
    label: "Devin",
    hostFiles: ["/opt/.devin"],
  },
  {
    id: "replit",
    label: "Replit",
    environment: [{ anyOf: ["REPL_ID"] }],
  },
  {
    id: "gemini",
    label: "Gemini",
    nativeName: "gemini",
    nativeOrder: 2,
    instructionPath: "GEMINI.md",
    environment: [{ anyOf: ["GEMINI_CLI"] }],
    mcpAliases: ["gemini-cli"],
  },
  {
    id: "codex",
    label: "Codex",
    nativeName: "codex",
    nativeOrder: 1,
    instructionPath: "AGENTS.md",
    environment: [{
      anyOf: ["CODEX_SANDBOX", "CODEX_CI", "CODEX_THREAD_ID"],
    }],
    mcpAliases: ["codex-mcp-client"],
  },
  {
    id: "v0",
    label: "v0",
    aiAgent: { exact: ["v0"] },
  },
  {
    id: "augment-cli",
    label: "Augment CLI",
    environment: [{ anyOf: ["AUGMENT_AGENT"] }],
  },
  {
    id: "opencode",
    label: "OpenCode",
    environment: [{ anyOf: ["OPENCODE_CLIENT", "OPENCODE"] }],
  },
  {
    id: "amp",
    label: "Amp",
    environment: [{ anyOf: ["AMP_CURRENT_THREAD_ID"] }],
  },
  {
    id: "copilot",
    label: "GitHub Copilot",
    nativeName: "copilot",
    nativeOrder: 4,
    instructionPath: "AGENTS.md",
    environment: [{
      anyOf: [
        "COPILOT_MODEL",
        "COPILOT_ALLOW_ALL",
        "COPILOT_GITHUB_TOKEN",
        "COPILOT_CLI",
      ],
    }],
    aiAgent: { exact: ["github-copilot", "github-copilot-cli"] },
    mcpAliases: ["github-copilot-cli"],
  },
  {
    id: "antigravity",
    label: "Antigravity",
    environment: [{ anyOf: ["ANTIGRAVITY_AGENT"] }],
  },
  {
    id: "pi",
    label: "Pi",
    environment: [{ anyOf: ["PI_CODING_AGENT"] }],
  },
  {
    id: "kiro-cli",
    label: "Kiro CLI",
    environment: [{ anyOf: ["KIRO_AGENT_PATH"] }],
  },
  {
    id: "custom",
    label: "Custom agent",
  },
] as const satisfies readonly AgentIdentityDefinition[];

/** Stable identity vocabulary recorded in `driver.agent_signals[].agent`. */
export type AgentIdentity = (typeof AGENT_CATALOGUE)[number]["id"];

/** The lifetime/provenance classes a logbook identity signal can carry. */
export const AGENT_SIGNAL_SOURCES = [
  "process-environment",
  "mcp-client",
  "host-filesystem",
] as const;

/** One signal provenance class. */
export type AgentSignalSource = (typeof AGENT_SIGNAL_SOURCES)[number];

/**
 * Each source class's evidence lifetime. `invocation` evidence is scoped to the
 * run that carried it (a process variable, a per-call client declaration);
 * `ambient` evidence is persistent host state that outlives any one invocation,
 * so it can corroborate a reading but must never drive one — a reader that let
 * a persistent host marker classify runs would attribute every run on that
 * host forever. A total record over the source union: a new source class fails
 * compilation until its lifetime is classified, and every reader inherits the
 * answer.
 */
export const AGENT_SIGNAL_SOURCE_LIFETIMES = {
  "process-environment": "invocation",
  "mcp-client": "invocation",
  "host-filesystem": "ambient",
} as const satisfies Record<AgentSignalSource, "invocation" | "ambient">;

/**
 * The display label for one identity id, falling back to the id itself for
 * vocabulary this release doesn't know — logbook events may carry ids written
 * by a newer release's catalogue.
 */
export function agentLabel(id: string): string {
  for (const identity of AGENT_CATALOGUE) {
    if (identity.id === id) {
      return identity.label;
    }
  }
  return id;
}

type NativeAgentEntry = Extract<
  (typeof AGENT_CATALOGUE)[number],
  {
    readonly nativeName: string;
    readonly nativeOrder: number;
    readonly instructionPath: string;
  }
>;

/** One agent for which discern provides native project integration. */
export type NativeAgentName = NativeAgentEntry["nativeName"];

/** Derive the non-empty native tuple from the catalogue without a second list. */
function nativeAgentNames(): readonly [
  NativeAgentName,
  ...NativeAgentName[],
] {
  const entries: NativeAgentEntry[] = [];
  for (const identity of AGENT_CATALOGUE) {
    if ("nativeName" in identity && "nativeOrder" in identity) {
      entries.push(identity);
    }
  }
  const names = entries.sort((a, b) => a.nativeOrder - b.nativeOrder).map((e) =>
    e.nativeName
  );
  if (names.length === 0) {
    throw new Error("the agent catalogue must declare a native provider");
  }
  return names as [NativeAgentName, ...NativeAgentName[]];
}

/** The native provider set, derived from {@link AGENT_CATALOGUE}. */
export const AGENT_NAMES = nativeAgentNames();

/** The catalogue-owned display label for one native provider. */
export function agentLabelForNative(name: NativeAgentName): string {
  for (const identity of AGENT_CATALOGUE) {
    if ("nativeName" in identity && identity.nativeName === name) {
      return identity.label;
    }
  }
  throw new Error(`missing agent-catalogue entry for native provider ${name}`);
}

/** The catalogue-owned compiled-instruction path for one native provider. */
export function instructionPathForNative(name: NativeAgentName): string {
  for (const identity of AGENT_CATALOGUE) {
    if (
      "nativeName" in identity && identity.nativeName === name &&
      identity.instructionPath !== undefined
    ) {
      return identity.instructionPath;
    }
  }
  throw new Error(
    `missing agent-catalogue instruction path for native provider ${name}`,
  );
}
