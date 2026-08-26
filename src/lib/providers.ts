/**
 * The typed native-provider registry (ADR 0031): the single source of truth for
 * every integration surface — compiled instructions, worktree hooks, MCP
 * registration, project rules, skills directories, and site brand assets. Native
 * names and labels come from the broader identity catalogue (ADR 0166); this
 * record is TOTAL over that native subset, so the type checker forces a complete
 * integration for every supported provider. There is no universal agent setup
 * file, so each live
 * integration is authored against that agent's own mechanism; an absent optional
 * integration is simply skipped, never guessed.
 */

import { dirname, join, relative } from "@std/path";
import { parse as parseToml } from "@std/toml";
import type { AgentName } from "./config.ts";
import {
  AGENT_NAMES,
  type DiscernConfig,
  parseConfigOrThrow,
  resolveConfiguredAgents,
} from "../shared/config_schema.ts";
import { runGit } from "../shared/subprocess.ts";
import { resolveWorktreeRoot } from "./worktree_root.ts";
import {
  mergeJsonSettingsDedupingGroups,
  mergeJsonSettingsText,
  type SettingsSeedMerge,
} from "./settings_merge.ts";
import { TomlEditor } from "./toml_edit.ts";
import {
  agentLabelForNative,
  instructionPathForNative,
} from "../shared/agent_catalogue.ts";
import {
  mcpServerArgsForNativeAgent,
  NATIVE_MCP_TIMEOUT_POLICY,
} from "../shared/mcp_timeout_policy.ts";
import {
  ARTIFACT_PROVENANCE_SOURCES,
  COMMENT_INCAPABLE_ARTIFACT,
  commentCapableNonContextArtifact,
  CONTEXT_LOADED_ARTIFACT,
  type FileOwnershipDeclaration,
  type WrittenArtifactClassDeclaration,
} from "../shared/file_ownership.ts";
import {
  generatedArtifactMarker,
  stripGeneratedArtifactMarker,
} from "../shared/brand.ts";
import { fire, HINTS } from "../shared/hints.ts";
import type { EnvReader } from "../shared/env.ts";
import { experimentalEnvironmentEnabled } from "../shared/experimental.ts";
import {
  LIVE_REFRESH_FILE_OPS,
  type RefreshFileOps,
} from "./refresh_file_ops.ts";

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

/** One configured agent's reactivation step in the post-setup handoff. */
export interface AgentReactivation {
  readonly agent: string;
  readonly label: string;
  readonly step: string;
  readonly check_kind: "mcp" | "cli";
  readonly check: string;
  readonly recovery: string;
  readonly cli_fallback: string;
}

/** Canonical CLI activation check and fallback for every provider. */
export const ACTIVATION_CLI_CHECK = "discern status --json";
export const ACTIVATION_TOOL_INVENTORY_ACTION =
  "inspect this session's registered tool inventory before opening external documentation";

/** One provider's deterministic post-restart activation contract. */
export interface ProviderActivationCheck {
  readonly kind: "mcp" | "cli";
  readonly command: string;
  readonly recovery: string;
  readonly cliFallback: string;
}

/**
 * The post-setup reactivation handoff (ADR 0075). `begin` wires each configured agent's
 * MCP server, session hooks, and project rules, but coding agents load them at session
 * start — so the session that ran setup can't see them. At `setup done`, each configured
 * agent that wired something loading at session start gets its {@link reactivationStep};
 * an agent that wired nothing (a reuse-canonical agent) is omitted, never told to restart
 * for nothing. Lives in the registry so the per-agent wording is single-sourced (ADR
 * 0031/0072) and DERIVED from the provider's own fields, not a parallel list.
 */
export function reactivationHandoff(
  config: DiscernConfig,
): { summary: string; per_agent: AgentReactivation[] } {
  const per_agent: AgentReactivation[] = [];
  for (const name of resolveConfiguredAgents(config)) {
    const provider = providerFor(name);
    if (provider === undefined) {
      continue;
    }
    const step = reactivationStep(provider);
    if (step === undefined) {
      continue; // nothing discern wired for this agent loads at session start
    }
    const activation = activationCheck(provider);
    per_agent.push({
      agent: name,
      label: provider.label,
      step,
      check_kind: activation.kind,
      check: activation.command,
      recovery: activation.recovery,
      cli_fallback: activation.cliFallback,
    });
  }
  return {
    summary: fire(HINTS["setup-reactivate-tools"]).text,
    per_agent,
  };
}

/**
 * The reactivation step for ONE provider, DERIVED from its wiring — or `undefined` when
 * nothing discern wired for it loads at session start (a reuse-canonical agent with no
 * MCP, hooks, or project rules needs no restart, so it is never told to). The step names
 * exactly what was wired (the live `mcp` server, session `hooks`, and/or provider
 * project rules), appends the one-time `trust` action when the vendor gates committed
 * config behind one, and prepends provider-declared human setup advice when a vendor UI
 * needs a choice discern cannot make. Everything derives from {@link Provider}, so a
 * NEW vendor's reactivation follows from its declaration automatically, with no
 * hand-maintained list.
 * `engine_setup_reactivation`
 * ties this to the PROVIDERS registry (ADR 0051/0075): a vendor whose reactivation does
 * not follow from its wiring red-lights there.
 */
export function reactivationStep(provider: Provider): string | undefined {
  const loads: string[] = [];
  if (provider.mcp.kind === "wired") {
    loads.push("MCP server");
  }
  if (provider.hooks !== undefined) {
    loads.push("session hooks");
  }
  if (provider.projectRules !== undefined) {
    loads.push("project rules");
  }
  if (loads.length === 0) {
    return undefined;
  }
  const base = `start a fresh session to load the discern ${
    loads.join(" and ")
  }`;
  const reactivation = provider.trust.required
    ? `${base}, then ${provider.trust.hint}`
    : base;
  const activation = activationCheck(provider);
  const verification =
    `In that fresh session, ${ACTIVATION_TOOL_INVENTORY_ACTION}, then invoke ` +
    `\`${activation.command}\`; activation is confirmed only when that local ` +
    `action returns. If it is unavailable, ${activation.recovery}, then run ` +
    `\`discern doctor\` before consulting external documentation. Use ` +
    `\`${activation.cliFallback}\` as the local CLI fallback; generated files ` +
    "alone do not prove the session loaded the integration.";
  const step = `${reactivation}${
    /[.!?]$/.test(reactivation) ? "" : "."
  } ${verification}`;
  return provider.humanSetupAdvice === undefined
    ? step
    : `${provider.humanSetupAdvice.handoff}${
      /[.!?]$/.test(provider.humanSetupAdvice.handoff) ? "" : "."
    } Then ${step}`;
}

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

/** Aggregate MCP wiring result with the paths written only by first installs. */
export interface ProviderMcpWireResult extends McpWireResult {
  /**
   * Files changed exclusively by providers that added the server for the first
   * time. A file also repaired by an established provider is excluded.
   */
  firstInstallPaths: string[];
}

/** Invocation-wide facts every provider's MCP writer may project into its own
 * configuration format. The full configured-agent list matters for files two
 * providers co-own: either registration order must write the same entry. */
export interface McpWireContext {
  readonly agents: readonly string[];
  readonly experimentalMcpPreload: boolean;
  readonly env: EnvReader;
  /** Alternate effect sink used by the read-only tracked-refresh planner. */
  readonly files?: RefreshFileOps;
}

/** How a provider registers an MCP server in a project — idempotently, preserving
 * the file's other contents. The discern server is core infrastructure (ADR 0045),
 * always wired; there is no feature-off removal path. */
export interface McpIntegration {
  /** The project-relative config file this provider keeps its servers in. */
  readonly configFile: string;
  /** The config file's required File ownership declaration. */
  readonly ownership: FileOwnershipDeclaration;
  /** How this discern-written artifact carries provenance. */
  readonly writtenArtifact: WrittenArtifactClassDeclaration;
  /** Register `server` for this provider under `root`, idempotently. */
  register(
    root: string,
    server: McpServerSpec,
    config: DiscernConfig,
    context: McpWireContext,
  ): Promise<McpWireResult>;
}

/**
 * A provider's MCP-wiring STATUS — a typed, explicit account of how discern wires
 * its MCP server for this agent (ADR 0051's forcing-function discipline). Every
 * provider declares one, so a new agent cannot join `AGENT_NAMES` without accounting
 * for its MCP wiring: a live `integration`, an explicit `pending` marker naming the
 * committable file discern WILL write the server into once the integration is
 * authored, or `none` (the agent has no committable project-scoped MCP mechanism to
 * target). A discriminated union + the required `Provider.mcp` field make a missing
 * declaration a COMPILE error; a parity guard asserts a `pending` status names a real
 * target file. The set TIGHTENS automatically: flipping a `pending` to `wired` in a
 * later plan keeps the guard green with no edit.
 */
export type McpStatus =
  | { readonly kind: "wired"; readonly integration: McpIntegration }
  | { readonly kind: "pending"; readonly targetFile: string }
  | { readonly kind: "none" };

/** The live MCP integration for a provider, or `undefined` when its status is
 * pending/none — the ONE place "is this provider's MCP wired?" is decided, so the
 * wirer and any other consumer agree. */
export function wiredMcp(provider: Provider): McpIntegration | undefined {
  return provider.mcp.kind === "wired" ? provider.mcp.integration : undefined;
}

/**
 * Whether a provider's COMMITTED MCP/hooks config is inert until a one-time
 * trust/approval, and the exact user-facing action. discern can wire everything into
 * the repo, but several agents gate committed config behind trusting the folder — so
 * the tools still won't appear until the user trusts it. `doctor` surfaces this per
 * agent: the gap between "discern wired it" and "it actually fires".
 */
export interface TrustGate {
  /** True ⇒ committed MCP/hooks need a one-time trust/approval before they take
   * effect; false ⇒ active as soon as discern writes them. */
  readonly required: boolean;
  /** The user-facing action that grants trust (when `required`), or the reason none
   * is needed (when not). Shown verbatim by the per-agent diagnostic; always present. */
  readonly hint: string;
}

/** Provider-owned recovery wording for a failed local activation check. */
export interface ProviderActivation {
  /** Exact callable name as this provider exposes it in a fresh local session. */
  readonly callable: string;
  readonly recovery: string;
}

/** Derive the exact check from the integration kind; provider wording stays in
 * its registry entry and the CLI fallback remains shared. */
export function activationCheck(
  provider: Provider,
): ProviderActivationCheck {
  return {
    kind: provider.mcp.kind === "wired" ? "mcp" : "cli",
    command: provider.mcp.kind === "wired"
      ? provider.activation.callable
      : ACTIVATION_CLI_CHECK,
    recovery: provider.activation.recovery,
    cliFallback: ACTIVATION_CLI_CHECK,
  };
}

/** One interactive CLI entry point the desk can offer for a provider. The
 * registry owns both the user-facing wording and argv so the desk never grows a
 * vendor switch statement. `open` starts a fresh conversation; `continue`
 * resumes through the provider's own project-scoped UI or latest-session rule. */
export interface AgentCliAction {
  readonly kind: "open" | "continue";
  readonly label: string;
  readonly args: readonly string[];
}

/** A provider's terminal integration. Required on every provider so adding a
 * known agent also requires an explicit account of how the desk enters it. */
export interface AgentCliIntegration {
  readonly actions: readonly AgentCliAction[];
}

/** Host platforms whose conventional application locations setup can probe. */
export type SetupPresenceOs = "darwin" | "linux" | "windows";

/**
 * One filesystem location that proves a provider's editor is installed even when
 * its terminal-agent binary is absent from `PATH`. Absolute markers cover
 * machine-wide installs; environment-relative markers cover per-user installs
 * without baking a home directory into the registry.
 */
export type SetupFilesystemMarker =
  | {
    readonly os: SetupPresenceOs;
    readonly path: string;
    readonly baseEnv?: never;
    readonly segments?: never;
  }
  | {
    readonly os: SetupPresenceOs;
    readonly path?: never;
    readonly baseEnv: string;
    readonly segments: readonly string[];
  };

/**
 * Setup-only installation evidence beyond a provider's terminal-agent
 * {@link Provider.binaries}. Every provider declares this account explicitly so
 * another IDE surface cannot inherit a CLI-only assumption.
 */
export interface SetupPresence {
  /** Editor shell commands or other high-confidence executables on `PATH`. */
  readonly additionalPathBinaries: readonly string[];
  /** Conventional application locations, matched when any one exists. */
  readonly filesystemMarkers: readonly SetupFilesystemMarker[];
}

/**
 * Human-facing setup advice for a provider UI choice that the running agent
 * cannot observe or make. `setup done` relays the handoff; generic agent
 * instructions and runtime hints must never consume it. Documentation topics keep
 * the full explanation enrolled when another provider declares similar advice.
 */
export interface HumanSetupAdvice {
  readonly handoff: string;
  /** Vendor UI terms that must stay off generic agent-facing surfaces. */
  readonly humanOnlyTopics: readonly string[];
  /** H1 title of the provider-specific map page that owns the explanation. */
  readonly documentationTitle: string;
  readonly documentationTopics: readonly string[];
}

/**
 * How a provider co-manages an APP-MANAGED worktree-lifecycle config file — Codex's
 * autogenerated `environment.toml`, whose `[setup]`/`[cleanup]` scripts the Codex *app*
 * runs when it creates/tears down one of its own worktrees. discern merges its
 * setup/teardown commands in, preserving the app's keys, and re-emits on every refresh
 * (modelled on {@link wireProviderMcp}, NOT a one-shot seed) so it self-heals if the app
 * regenerates the file. OPTIONAL on a {@link Provider} — only an agent whose app owns
 * such a file declares it; absent ⇒ skipped, never guessed (like {@link HooksIntegration}).
 * This is distinct from `hooks` (a per-SESSION hook the agent fires): `worktreeApp` is a
 * create/teardown analogue scoped to the agent app's own worktrees.
 */
export interface WorktreeAppIntegration {
  /** The project-relative app-managed config file discern co-manages. */
  readonly configFile: string;
  /** The config file's required File ownership declaration. */
  readonly ownership: FileOwnershipDeclaration;
  /** How this discern-written artifact carries provenance. */
  readonly writtenArtifact: WrittenArtifactClassDeclaration;
  /** Merge discern's worktree setup/teardown into `configFile` under `root`,
   * idempotently, preserving the app's own keys. Returns the project-relative files
   * written (empty when already in place). */
  register(
    root: string,
    env?: EnvReader,
    files?: RefreshFileOps,
  ): Promise<string[]>;
}

/**
 * Project-local policy/rules files a provider loads from its own committed config
 * directory. These are not MCP servers or app worktree lifecycle scripts, so they get
 * their own result bucket instead of being reported as `mcp_wired`.
 */
export interface ProjectRulesIntegration {
  /** The project-relative rules file discern owns and re-emits idempotently. */
  readonly rulesFile: string;
  /** The rules entry's required File ownership declaration. */
  readonly ownership: FileOwnershipDeclaration;
  /** How this discern-written artifact carries provenance. */
  readonly writtenArtifact: WrittenArtifactClassDeclaration;
  /** Write the rules file under `root`, returning it when bytes changed. */
  register(
    root: string,
    env?: EnvReader,
    files?: RefreshFileOps,
  ): Promise<string[]>;
}

/** A provider's worktree-automation surface: where its lifecycle hooks live and
 * the hook-event vocabulary it uses. Drives `setup`'s hook-stripping. */
export interface HooksIntegration {
  /** The project-relative settings file this provider's hooks live in. */
  readonly settingsFile: string;
  /** The settings file's required File ownership declaration. */
  readonly ownership: FileOwnershipDeclaration;
  /** How this discern-written artifact carries provenance. */
  readonly writtenArtifact: WrittenArtifactClassDeclaration;
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
export interface InstructionFile {
  /** Project-relative path of the generated file. */
  readonly path: string;
  /** The agent file's required File ownership declaration. */
  readonly ownership: FileOwnershipDeclaration;
  /** How this discern-written artifact carries provenance. */
  readonly writtenArtifact: WrittenArtifactClassDeclaration;
  /**
   * Whether this is the CANONICAL agent file: the one holding the full compiled
   * body that every other provider's pointer imports (exactly one — codex /
   * AGENTS.md). Decoupled from git-tracking (ADR 0034/0128): "canonical" is about
   * being the single on-disk source the mirrors import, not about git status. The
   * `@<path>` import resolves a local file either way, so the pointer mechanism
   * is unaffected by the tracked-by-default posture.
   */
  readonly canonical: boolean;
  /**
   * When set, and a canonical agent file is also being emitted, this provider's
   * file is written as a POINTER to that file rather than a full duplicate — using
   * the provider's own include syntax (the `@path` import Claude Code AND Gemini CLI
   * both support; see {@link atImportPointer}). Receives the canonical file's
   * project-relative path; returns the whole file body. Absent → the provider always
   * gets the full compiled instructions (e.g. Codex, whose `AGENTS.md` has no import
   * directive — so it is the canonical file the others point at). The point is
   * single-source-of-truth: the instructions live in one compiled file and the mirror
   * imports it, so the two can never drift.
   */
  readonly pointer?: (canonicalPath: string) => string;
  /**
   * When true, this provider reads the CANONICAL agent file (`AGENTS.md`) natively
   * and discern emits no vendor-specific file for it — neither a duplicate body nor
   * a pointer. `path` names that canonical file (the one it reads). If no canonical
   * provider is configured in the current set, the renderer writes this path as the
   * canonical full-body file; if the canonical provider is present, the
   * reuse-canonical entry collapses into that existing write. The
   * reuse-canonical state is for agents (Cursor, Copilot, Antigravity) that consume
   * `AGENTS.md` directly; a provider that needs its own file leaves this unset and
   * uses `pointer` (a mirror) or nothing (the canonical itself). Mutually exclusive
   * with `canonical` and `pointer`.
   */
  readonly reuseCanonical?: boolean;
}

/**
 * Whether this instruction entry emits its own provider file. False only for a
 * reuse-canonical provider — it reads the canonical file, and the configured set
 * decides whether that canonical write is already covered or must be synthesized.
 */
export function emitsInstructionFile(gf: InstructionFile): boolean {
  return gf.reuseCanonical !== true;
}

/**
 * The distinct instruction-file paths discern emits for the given entries, in
 * first-seen order: a reuse-canonical entry contributes the canonical path when no
 * canonical provider is configured in this set, otherwise it contributes no
 * duplicate, and repeated paths collapse to one. The shared core behind
 * {@link allInstructionFilePaths} and the renderer's file map, so a
 * reuse-canonical provider can never leak a duplicate `AGENTS.md` into the
 * aggregators while a reuse-canonical-only set still gets the file it reads.
 */
export function emittedInstructionPaths(
  files: readonly InstructionFile[],
): string[] {
  const hasCanonical = files.some((gf) => gf.canonical);
  const out: string[] = [];
  for (const gf of files) {
    const emitsForSet = emitsInstructionFile(gf) ||
      (gf.reuseCanonical === true && !hasCanonical);
    if (emitsForSet && !out.includes(gf.path)) {
      out.push(gf.path);
    }
  }
  return out;
}

/** One provider path declared together with its File ownership. */
export interface ProviderArtifactPath {
  readonly path: string;
  readonly ownership: FileOwnershipDeclaration;
}

/** One provider path discern continues to write or maintain. */
export interface WrittenProviderArtifactPath extends ProviderArtifactPath {
  readonly writtenArtifact: WrittenArtifactClassDeclaration;
}

/** The public directory holding the landing site's provider-brand SVGs. */
export const PROVIDER_BRAND_ASSET_ROOT = "/assets/integrations" as const;

/** One public, self-contained SVG in a provider's brand set. */
export interface ProviderBrandAsset {
  readonly path: `${typeof PROVIDER_BRAND_ASSET_ROOT}/${string}.svg`;
  /** The filename, archive member, or inline element the checked-in SVG came from. */
  readonly upstream: string;
}

/** The logo forms the site can use for one integrated agent provider. */
export interface ProviderBrand {
  /** The vendor's human-readable brand or press page. */
  readonly sourceUrl: `https://${string}`;
  /** The vendor-provided archive or page from which these exact vectors came. */
  readonly assetSourceUrl: `https://${string}`;
  /** A compact, approximately square product or vendor mark. */
  readonly mark: ProviderBrandAsset;
  /**
   * A backgroundless alpha silhouette for one-color treatments. Use `mark`
   * when the compact mark already has no painted canvas; otherwise declare a
   * separate first-party SVG.
   */
  readonly silhouette: "mark" | ProviderBrandAsset;
  /** A horizontal product or vendor lockup with its wordmark. */
  readonly wordmark: ProviderBrandAsset;
  /** Provenance detail for a vendor that publishes no product-specific pair. */
  readonly note?: string;
}

/** Resolve the backgroundless asset used for one-color provider marks. */
export function providerBrandSilhouette(
  brand: ProviderBrand,
): ProviderBrandAsset {
  return brand.silhouette === "mark" ? brand.mark : brand.silhouette;
}

/** Everything provider-specific for one agent, in one typed record. The single
 * place to extend when teaching discern a new agent. */
export interface Provider {
  readonly name: AgentName;
  readonly label: string;
  /** First-party SVGs for the site's integrations surfaces. Required so a new
   * native provider cannot compile until both logo forms are accounted for. */
  readonly brand: ProviderBrand;
  /**
   * The terminal-agent executable name(s) this agent ships. The desk uses these
   * for live launch availability, and fresh setup treats them as one installation
   * signal. Semantics are **match-any**: the agent is present when ANY listed
   * binary resolves on PATH. Non-empty for every provider (the parity guard
   * enforces it).
   */
  readonly binaries: readonly string[];
  /**
   * Setup-time installation evidence that does not double as a terminal-agent
   * launcher. Required so every provider accounts for IDE-only installations.
   */
  readonly setupPresence: SetupPresence;
  /** Interactive terminal entry points exposed by `discern desk`. The first
   * detected binary is combined with these argv declarations and launched with
   * the selected worktree as cwd. */
  readonly cli: AgentCliIntegration;
  /** The compiled agent-instruction file: project-relative path + git-tracked. */
  readonly instructionFile: InstructionFile;
  /**
   * MCP-wiring status: a live integration, an explicit `pending` marker (with the
   * committable target file), or `none`. REQUIRED — a new agent must account for its
   * MCP wiring rather than leave a silent gap (ADR 0051). See {@link McpStatus}.
   */
  readonly mcp: McpStatus;
  /** Worktree-hook surface. Absent → not yet supported for this agent. */
  readonly hooks?: HooksIntegration;
  /**
   * App-managed worktree-lifecycle config (Codex's `environment.toml`). Absent → the
   * agent's app owns no such file, so discern co-manages none (skipped, never guessed).
   * See {@link WorktreeAppIntegration}; wired on every refresh by {@link wireProviderWorktreeApp}.
   */
  readonly worktreeApp?: WorktreeAppIntegration;
  /**
   * Provider-owned project-local policy/rules file(s), if the agent has such a
   * committed surface. Absent → skipped, never guessed. See
   * {@link ProjectRulesIntegration}; wired on refresh by
   * {@link wireProviderProjectRules}.
   */
  readonly projectRules?: ProjectRulesIntegration;
  /**
   * Whether this agent's COMMITTED MCP/hooks config needs a one-time trust before it
   * fires, and the exact action. REQUIRED — surfaced per agent by `doctor` so the gap
   * between "discern wired it" and "the tools appear" is never a silent surprise (the
   * four non-Claude vendors gate committed config behind a trust). See {@link TrustGate}.
   */
  readonly trust: TrustGate;
  /** Exact local recovery when the post-restart activation check is absent. */
  readonly activation: ProviderActivation;
  /** Human-facing provider setup that discern reports but never applies. */
  readonly humanSetupAdvice?: HumanSetupAdvice;
  /**
   * Project-relative directory this agent discovers SKILL.md skills in; discern
   * materializes the effective skill set into it. Absent → no skills target for
   * this agent (skipped, never guessed). All three known agents use the identical
   * SKILL.md folder format, differing only in the directory.
   */
  readonly skillsDir?: WrittenProviderArtifactPath;
  /**
   * Machine-local state files this agent keeps in the project tree — personal,
   * per-machine overrides (e.g. a local settings file) that must stay out of
   * version control. Declared here so the managed `.gitignore` block and the
   * gate's tracked-artifacts check derive them from the registry rather than a
   * hand-copied list. Absent → the agent has none.
   */
  readonly localState?: readonly ProviderArtifactPath[];
}

/**
 * An instruction file rendered as a pointer to the canonical agent file: a single
 * `@<path>` import line the agent expands in place when it loads its instruction
 * file. So the compiled instructions lives in ONE file (`AGENTS.md`) and every mirror
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
 * by the `done`/`status` currency check (ADR 0034).
 */
export function atImportPointer(canonicalPath: string): string {
  return `@${canonicalPath}\n`;
}

// ── small JSON helpers (read-or-empty, write pretty) ────────────────────────

/** Narrow unknown configuration data to a non-null, non-array object. */
function isObject(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

/** Keep only string members from an unknown array-shaped setting. */
function asStringArray(v: unknown): string[] {
  return Array.isArray(v)
    ? v.filter((x): x is string => typeof x === "string")
    : [];
}

/** Parse optional TOML leniently for provider registration, falling back to empty. */
function parseTomlObject(text: string | undefined): Record<string, unknown> {
  if (text === undefined || text.trim() === "") {
    return {};
  }
  try {
    const parsed: unknown = parseToml(text);
    return isObject(parsed) ? parsed : {};
  } catch {
    // discern-best-effort: providers-toml-decode-fallback
    return {};
  }
}

/** Traverse nested configuration objects without throwing on a scalar segment. */
function objectPath(
  root: Record<string, unknown>,
  path: readonly string[],
): unknown {
  let current: unknown = root;
  for (const segment of path) {
    if (!isObject(current)) {
      return undefined;
    }
    current = current[segment];
  }
  return current;
}

/** Read a nested setting as a filtered string array. */
function stringArrayAt(
  root: Record<string, unknown>,
  path: readonly string[],
): string[] {
  return asStringArray(objectPath(root, path));
}

/** Read a nested setting only when its terminal value is a string. */
function stringAt(
  root: Record<string, unknown>,
  path: readonly string[],
): string | undefined {
  const value = objectPath(root, path);
  return typeof value === "string" ? value : undefined;
}

/** Append an integration entry without mutating or duplicating the existing array. */
function appendUnique(base: readonly string[], addition: string): string[] {
  return base.includes(addition) ? [...base] : [...base, addition];
}

/** Read a JSON object file. Absence starts empty; malformed existing JSON refuses. */
async function readJsonObject(
  path: string,
  files: RefreshFileOps = LIVE_REFRESH_FILE_OPS,
): Promise<Record<string, unknown>> {
  let text: string;
  try {
    text = await files.readTextFile(path);
  } catch (error) {
    if (error instanceof Deno.errors.NotFound) {
      return {};
    }
    const detail = error instanceof Error ? error.message : String(error);
    throw new Error(`could not read JSON file ${path}: ${detail}`);
  }
  let v: unknown;
  try {
    v = JSON.parse(text);
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    throw new Error(`malformed JSON in ${path}: ${detail}`);
  }
  if (!isObject(v)) {
    throw new Error(`JSON in ${path} must be an object`);
  }
  return v;
}

/** Write a pretty JSON object with a trailing newline (creating parent dirs). */
async function writeJsonObject(
  path: string,
  value: unknown,
  files: RefreshFileOps = LIVE_REFRESH_FILE_OPS,
): Promise<void> {
  await files.ensureDir(dirname(path));
  await files.writeTextFile(path, `${JSON.stringify(value, null, 2)}\n`);
}

/** Write text only when bytes differ, creating the parent directory. */
async function writeTextIfChanged(
  root: string,
  rel: string,
  body: string,
  files: RefreshFileOps = LIVE_REFRESH_FILE_OPS,
): Promise<string | undefined> {
  const path = join(root, rel);
  let existing: string | undefined;
  try {
    existing = await files.readTextFile(path);
  } catch (error) {
    if (!(error instanceof Deno.errors.NotFound)) {
      const detail = error instanceof Error ? error.message : String(error);
      throw new Error(`could not read ${rel}: ${detail}`);
    }
  }
  if (existing === body) {
    return undefined;
  }
  await files.ensureDir(dirname(path));
  await files.writeTextFile(path, body);
  return rel;
}

// ── Claude Code ─────────────────────────────────────────────────────────────

/** The project-scoped, committed MCP-servers file `discern mcp` rides in. The
 * cross-tool `.mcp.json` standard: Claude Code reads it, and the GitHub Copilot CLI
 * reads the SAME file — so the two CO-OWN it. discern writes a byte-identical
 * `mcpServers.discern` entry for both via {@link registerStdioMcpJson}, so whichever
 * provider wires second is a clean no-op and the file can only ever carry one entry. */
const MCP_JSON_FILE = ".mcp.json";
const CLAUDE_SETTINGS_FILE = ".claude/settings.json";

/** Claude Code's machine-local settings override — personal, per-machine state
 * the vendor's own docs say not to commit, so discern keeps it ignored. */
const CLAUDE_LOCAL_SETTINGS_FILE = ".claude/settings.local.json";

/** Claude Code's own project skills directory. Claude Code does NOT read the
 * cross-tool `.agents/skills/` (anthropics/claude-code#31005), so it keeps its own. */
const CLAUDE_SKILLS_DIR = ".claude/skills";

/** The cross-tool Agent Skills standard project directory — Codex's only repo path
 * and Gemini's preferred alias — so the two share one materialization target. */
const AGENTS_SKILLS_DIR = ".agents/skills";

/** Gemini CLI reads its project MCP servers AND its hooks from one committable file. */
const GEMINI_SETTINGS_FILE = ".gemini/settings.json";

/** Codex reads project config from a committable TOML file (its own format, NOT
 * Claude's `.mcp.json`): MCP servers, project-doc sizing, and the extra writable
 * root discern grants for sibling worktrees live here. Its SessionStart hook lives
 * in a separate JSON file, and the Codex *app*'s worktree setup/cleanup lives in an
 * autogenerated `environment.toml`. */
const CODEX_CONFIG_FILE = ".codex/config.toml";
const CODEX_HOOKS_FILE = ".codex/hooks.json";
const CODEX_ENV_FILE = ".codex/environments/environment.toml";
const CODEX_RULES_FILE = ".codex/rules/discern.rules";
const CODEX_ENV_SETUP_SCRIPT = "discern worktree ensure";
const CODEX_ENV_CLEANUP_SCRIPT = "discern worktree teardown";
const CODEX_PROJECT_DOC_MAX_BYTES = 65536;
const CODEX_MCP_STARTUP_TIMEOUT_SEC = 30;
const CODEX_CONFIG_WRITTEN_ARTIFACT = commentCapableNonContextArtifact(
  ARTIFACT_PROVENANCE_SOURCES.codexConfig,
);
const CODEX_ENV_WRITTEN_ARTIFACT = commentCapableNonContextArtifact(
  ARTIFACT_PROVENANCE_SOURCES.codexEnvironment,
);
const CODEX_RULES_WRITTEN_ARTIFACT = commentCapableNonContextArtifact(
  ARTIFACT_PROVENANCE_SOURCES.codexRules,
);

/** Render discern's Codex rules with the current attribution preference. */
function codexDiscernRules(env: EnvReader = Deno.env): string {
  return `${
    generatedArtifactMarker(ARTIFACT_PROVENANCE_SOURCES.codexRules, env)
  }
# Put user-owned Codex rules in a separate .codex/rules/*.rules file.

prefix_rule(
    pattern = ["git", "add"],
    decision = "allow",
    justification = "Allow staging from trusted discern linked worktrees; Git writes linked-worktree indexes and locks under the main checkout .git/worktrees directory.",
)

prefix_rule(
    pattern = ["git", "commit"],
    decision = "allow",
    justification = "Allow committing from trusted discern linked worktrees; Git writes linked-worktree metadata under the main checkout .git/worktrees directory.",
)
`;
}

/** Cursor reads its project MCP servers from a committable `.cursor/mcp.json` (its
 * own file, requiring an explicit `type: "stdio"`) and its SessionStart hook from a
 * separate committable `.cursor/hooks.json`. */
const CURSOR_MCP_FILE = ".cursor/mcp.json";
const CURSOR_HOOKS_FILE = ".cursor/hooks.json";

/** The GitHub Copilot CLI reads its project MCP servers from the shared committable
 * `.mcp.json` ({@link MCP_JSON_FILE}, co-owned with Claude Code) and loads every
 * `.github/hooks/*.json`, so discern keeps its SessionStart hook in a discern-owned
 * `.github/hooks/discern.json`. */
const COPILOT_HOOKS_FILE = ".github/hooks/discern.json";

/**
 * Register a stdio MCP server into a JSON file's `mcpServers.<name>` map, writing
 * `{ type: "stdio", command, args }` — the `.mcp.json`/`.cursor/mcp.json` shape Claude
 * Code, Cursor, and the Copilot CLI all read. MERGE, never clobber: an existing file's
 * other servers and top-level keys are preserved; only this server's entry is
 * added/updated. `firstInstall` is whether the server name was absent before — the
 * restart-needed signal. Idempotent: a re-run that finds the entry already correct writes
 * nothing. The ONE writer the stdio-`mcpServers`-JSON providers share, so a file co-owned
 * by two of them (Claude + Copilot's `.mcp.json`) can only ever carry one byte-identical
 * entry, and the second provider to wire it is a no-op regardless of order. (Gemini's
 * `.gemini/settings.json` is NOT one of these — it omits `type`, inferring stdio from
 * `command`, so it keeps its own {@link registerGeminiMcp}.) The shared `.mcp.json`
 * entry also projects the environment-only MCP preload experiment into the
 * client-specific fields supported by the configured co-owners. Switching the
 * experiment off removes those fields on the next wire.
 */
async function registerStdioMcpJson(
  root: string,
  configFile: string,
  server: McpServerSpec,
  context: McpWireContext,
  timeoutSeconds?: number,
): Promise<McpWireResult> {
  const files = context.files ?? LIVE_REFRESH_FILE_OPS;
  const path = join(root, configFile);
  const doc = await readJsonObject(path, files);
  const servers = isObject(doc.mcpServers) ? doc.mcpServers : {};
  const firstInstall = !(server.name in servers);
  const desired = {
    type: "stdio",
    command: server.command,
    args: [...server.args],
    ...(timeoutSeconds !== undefined ? { timeout: timeoutSeconds * 1000 } : {}),
    ...(configFile === MCP_JSON_FILE &&
        context.experimentalMcpPreload &&
        context.agents.includes("claude_code")
      ? { alwaysLoad: true }
      : {}),
    ...(configFile === MCP_JSON_FILE &&
        context.experimentalMcpPreload &&
        context.agents.includes("copilot")
      ? { deferTools: "never" }
      : {}),
  };
  if (JSON.stringify(servers[server.name]) === JSON.stringify(desired)) {
    return { written: [], firstInstall };
  }
  doc.mcpServers = { ...servers, [server.name]: desired };
  await writeJsonObject(path, doc, files);
  return { written: [configFile], firstInstall };
}

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
  _config: DiscernConfig,
  context: McpWireContext,
): Promise<McpWireResult> {
  const files = context.files ?? LIVE_REFRESH_FILE_OPS;
  // 1. .mcp.json — the project-scoped server definition (a local stdio command),
  //    via the shared writer (the file Copilot co-owns).
  const mcp = await registerStdioMcpJson(
    root,
    MCP_JSON_FILE,
    {
      ...server,
      args: mcpServerArgsForNativeAgent("claude_code", server.args),
    },
    context,
    NATIVE_MCP_TIMEOUT_POLICY.claude_code.configured_seconds,
  );
  const written = [...mcp.written];

  // 2. .claude/settings.json — pre-approve the project-scoped server by name,
  //    preserving every other setting (hooks, permissions) already written.
  const setPath = join(root, CLAUDE_SETTINGS_FILE);
  const settings = await readJsonObject(setPath, files);
  const approved = asStringArray(settings.enabledMcpjsonServers);
  if (!approved.includes(server.name)) {
    settings.enabledMcpjsonServers = [...approved, server.name];
    await writeJsonObject(setPath, settings, files);
    written.push(CLAUDE_SETTINGS_FILE);
  }

  return { written, firstInstall: mcp.firstInstall };
}

// ── Gemini CLI ──────────────────────────────────────────────────────────────

/**
 * Register discern's MCP server for Gemini CLI: deep-merge `mcpServers.<name>`
 * (stdio: `command` + `args`) into the project-committable `.gemini/settings.json`,
 * preserving every other key — the seeded `hooks` block AND any servers the user
 * added. Gemini infers a stdio transport from the presence of `command`, so no
 * `type` field is written (unlike Claude's `.mcp.json`). No pre-approval list: Gemini
 * gates committed config behind a one-time folder trust (the trust hint), not a
 * per-server prompt. Idempotent: a re-run that finds the server already present (same
 * command+args) writes nothing — so it is not a first install and fires no restart hint.
 */
async function registerGeminiMcp(
  root: string,
  server: McpServerSpec,
  _config: DiscernConfig,
  context: McpWireContext,
): Promise<McpWireResult> {
  const files = context.files ?? LIVE_REFRESH_FILE_OPS;
  const path = join(root, GEMINI_SETTINGS_FILE);
  const settings = await readJsonObject(path, files);
  const servers = isObject(settings.mcpServers) ? settings.mcpServers : {};
  const firstInstall = !(server.name in servers);
  const desired = {
    command: server.command,
    args: mcpServerArgsForNativeAgent("gemini", server.args),
    timeout: NATIVE_MCP_TIMEOUT_POLICY.gemini.configured_seconds * 1000,
  };
  if (JSON.stringify(servers[server.name]) === JSON.stringify(desired)) {
    return { written: [], firstInstall };
  }
  settings.mcpServers = { ...servers, [server.name]: desired };
  await writeJsonObject(path, settings, files);
  return { written: [GEMINI_SETTINGS_FILE], firstInstall };
}

// ── Codex (TOML config + autogenerated environment.toml) ─────────────────────

/**
 * Apply a comment-preserving {@link TomlEditor} edit to a project-relative TOML file
 * and write it back ONLY when the bytes change — the shared idempotent-merge core for
 * Codex's two TOML surfaces (project `config.toml`, and the app's
 * `environment.toml`). An absent file starts from empty and is created (normalized
 * to end with a newline); an unchanged file is left untouched, so re-running writes
 * nothing. The edit only ever rewrites the keys it targets, so every other table,
 * key, and comment is preserved. Returns the project-relative path when it wrote,
 * else undefined.
 */
async function editTomlFile(
  root: string,
  rel: string,
  provenanceSource: string,
  edit: (editor: TomlEditor, existing: string | undefined) => void,
  env: EnvReader = Deno.env,
  files: RefreshFileOps = LIVE_REFRESH_FILE_OPS,
): Promise<string | undefined> {
  const path = join(root, rel);
  let existing: string | undefined;
  try {
    existing = await files.readTextFile(path);
  } catch (error) {
    if (!(error instanceof Deno.errors.NotFound)) throw error;
    existing = undefined;
  }
  const editor = new TomlEditor(existing ?? "");
  edit(editor, existing);
  let out = stripGeneratedArtifactMarker(editor.toString(), provenanceSource);
  const marker = generatedArtifactMarker(provenanceSource, env);
  const eol = out.includes("\r\n") ? "\r\n" : "\n";
  out = `${marker}${eol}${out}`;
  if (!out.endsWith("\n")) {
    out += "\n";
  }
  if (existing !== undefined && out === existing) {
    return undefined;
  }
  await files.ensureDir(dirname(path));
  await files.writeTextFile(path, out);
  return rel;
}

/**
 * The writable root Codex should add for discern's linked-worktree directory. Codex
 * resolves project-config relative paths from the containing `.codex/` directory,
 * so a default sibling worktree root becomes `../../<repo>.worktrees`. An absolute
 * `[worktree].root` stays absolute because the user already opted into a
 * machine-local path in `discern.toml`.
 */
function codexWritableWorktreeRoot(
  root: string,
  config: DiscernConfig,
): string {
  const worktreeRoot = resolveWorktreeRoot(root, config);
  if (config.worktree.root.startsWith("/")) {
    return worktreeRoot;
  }
  return relative(join(root, dirname(CODEX_CONFIG_FILE)), worktreeRoot);
}

/** Find the main checkout so Codex places sibling worktrees beside the repository. */
async function codexWorktreePlacementBaseRoot(root: string): Promise<string> {
  const run = await runGit(["worktree", "list", "--porcelain"], { cwd: root });
  if (!run.success) {
    return root;
  }
  for (const line of run.stdout.split("\n")) {
    if (!line.startsWith("worktree ")) {
      continue;
    }
    const mainRoot = line.slice("worktree ".length);
    if (mainRoot === "") {
      return root;
    }
    try {
      const stat = await Deno.stat(mainRoot);
      return stat.isDirectory ? await Deno.realPath(mainRoot) : root;
    } catch {
      return root;
    }
  }
  return root;
}

/**
 * Register discern's Codex project configuration: merge `[mcp_servers.<name>]`
 * (stdio: `command`, `args`, `cwd`, and safe timeouts), a set-if-absent
 * `project_doc_max_bytes`, and the extra sibling-worktree writable root into the
 * project-committable `.codex/config.toml` via the comment/structure-preserving
 * {@link TomlEditor}. Other servers, keys, comments, and user-provided
 * `sandbox_workspace_write.writable_roots` entries are preserved. `firstInstall`
 * is whether the server's table was absent before — the restart signal.
 * Idempotent: a re-run that finds the config already correct writes nothing.
 */
async function registerCodexProjectConfig(
  root: string,
  server: McpServerSpec,
  config: DiscernConfig,
  context: McpWireContext,
): Promise<McpWireResult> {
  const section = `mcp_servers.${server.name}`;
  let firstInstall = false;
  const placementRoot = await codexWorktreePlacementBaseRoot(root);
  const wrote = await editTomlFile(
    root,
    CODEX_CONFIG_FILE,
    ARTIFACT_PROVENANCE_SOURCES.codexConfig,
    (editor, existing) => {
      const parsed = parseTomlObject(existing);
      const roots = appendUnique(
        stringArrayAt(parsed, ["sandbox_workspace_write", "writable_roots"]),
        codexWritableWorktreeRoot(placementRoot, config),
      );
      editor.setStringArray("sandbox_workspace_write.writable_roots", roots);
      if (!editor.hasRootKey("project_doc_max_bytes")) {
        editor.setRootNumber(
          "project_doc_max_bytes",
          CODEX_PROJECT_DOC_MAX_BYTES,
        );
      }
      firstInstall = !editor.hasSection(section);
      editor.setNumber(
        `${section}.tool_timeout_sec`,
        NATIVE_MCP_TIMEOUT_POLICY.codex.configured_seconds,
      );
      editor.setNumber(
        `${section}.startup_timeout_sec`,
        CODEX_MCP_STARTUP_TIMEOUT_SEC,
      );
      editor.setStringArray(
        `${section}.args`,
        mcpServerArgsForNativeAgent("codex", server.args),
      );
      editor.setString(`${section}.command`, server.command);
      editor.deleteKey(`${section}.cwd`);
    },
    context.env,
    context.files,
  );
  return { written: wrote !== undefined ? [wrote] : [], firstInstall };
}

/** Claim a Codex environment script key only while absent or still set to Discern's default. */
function shouldWriteCodexEnvScript(
  current: string | undefined,
  discernOwned: string,
): boolean {
  return current === undefined || current === discernOwned;
}

/**
 * Co-manage the Codex *app*'s autogenerated `environment.toml`: merge
 * `[setup].script = "discern worktree ensure"` and
 * `[cleanup].script = "discern worktree teardown"` into it via {@link TomlEditor},
 * preserving the app's own autogenerated keys (`[[actions]]`, … and any comments) —
 * discern owns a script key only while it is absent or still set to discern's
 * default. A user-customized script value is preserved. Codex's schema REQUIRES top-level
 * `version` (number) and `name` (string): discern seeds `version = 1` and
 * `name = "Discern"` when ABSENT — so a from-scratch file (one discern wrote before
 * the user configured a Codex environment) validates and gives immediate access to
 * Codex environments — but preserves the app's own `version`/`name` when it created
 * the file (set-if-absent). Those scripts run as bare commands in the worktree cwd
 * with no stdin when the Codex app creates/tears down one of ITS OWN worktrees (under
 * `$CODEX_HOME/worktrees`); discern's own sibling worktrees stay driven by its CLI/MCP
 * verbs + the SessionStart hook. Safe when the file is absent (created), and re-emitted
 * on every refresh so it self-heals if the app regenerates the file without taking
 * ownership of a user's custom commands. Idempotent: a re-run that finds everything
 * already set writes nothing. Returns the files written.
 */
async function registerCodexEnvironment(
  root: string,
  env: EnvReader = Deno.env,
  files: RefreshFileOps = LIVE_REFRESH_FILE_OPS,
): Promise<string[]> {
  const wrote = await editTomlFile(
    root,
    CODEX_ENV_FILE,
    ARTIFACT_PROVENANCE_SOURCES.codexEnvironment,
    (editor, existing) => {
      const parsed = parseTomlObject(existing);
      // Codex rejects the file unless top-level `version`/`name` are present; seed
      // defaults when absent, but never clobber the app's own values on a merge.
      if (!editor.hasRootKey("version")) {
        editor.setRootNumber("version", 1);
      }
      if (!editor.hasRootKey("name")) {
        editor.setRootString("name", "Discern");
      }
      const setupScript = stringAt(parsed, ["setup", "script"]);
      if (shouldWriteCodexEnvScript(setupScript, CODEX_ENV_SETUP_SCRIPT)) {
        editor.setString("setup.script", CODEX_ENV_SETUP_SCRIPT);
      }
      const cleanupScript = stringAt(parsed, ["cleanup", "script"]);
      if (shouldWriteCodexEnvScript(cleanupScript, CODEX_ENV_CLEANUP_SCRIPT)) {
        editor.setString("cleanup.script", CODEX_ENV_CLEANUP_SCRIPT);
      }
    },
    env,
    files,
  );
  return wrote !== undefined ? [wrote] : [];
}

/**
 * Write discern's Codex project-local rules file. This is a discern-owned file
 * separate from Codex's user-owned `.codex/rules/default.rules`; refresh may update
 * this one to keep the linked-worktree Git allowances exact, but it never mutates a
 * user's rules files.
 */
async function registerCodexRules(
  root: string,
  env: EnvReader = Deno.env,
  files: RefreshFileOps = LIVE_REFRESH_FILE_OPS,
): Promise<string[]> {
  const wrote = await writeTextIfChanged(
    root,
    CODEX_RULES_FILE,
    codexDiscernRules(env),
    files,
  );
  return wrote !== undefined ? [wrote] : [];
}

/**
 * Strip discern's contribution back out of the project-committable
 * `.codex/config.toml` — the uninstall inverse of {@link registerCodexProjectConfig},
 * co-located so the two can never disagree on what discern wrote. Removes the
 * `[mcp_servers.discern]` table, discern's sibling-worktree `writable_roots`
 * entry (recomputed from the SAME resolver register used, so it is removed
 * exactly), and the set-if-absent `project_doc_max_bytes` when it still holds
 * discern's default. Other servers, keys, comments, and user-provided writable
 * roots are preserved. Returns the new TOML text, or `null` when nothing but
 * discern's own content was left (delete the file). A user-provided
 * `project_doc_max_bytes` (any other value) is kept.
 */
export async function stripDiscernFromCodexConfig(
  existingText: string,
  root: string,
  config: DiscernConfig,
): Promise<string | null> {
  const editor = new TomlEditor(existingText);
  editor.deleteSection(`mcp_servers.${DISCERN_MCP_SERVER.name}`);

  const placementRoot = await codexWorktreePlacementBaseRoot(root);
  const discernRoot = codexWritableWorktreeRoot(placementRoot, config);
  const parsed = parseTomlObject(existingText);
  const roots = stringArrayAt(parsed, [
    "sandbox_workspace_write",
    "writable_roots",
  ]);
  const remaining = roots.filter((r) => r !== discernRoot);
  if (roots.length !== remaining.length) {
    if (remaining.length === 0) {
      editor.deleteKey("sandbox_workspace_write.writable_roots");
      const afterKey = parseTomlObject(editor.toString());
      const section = objectPath(afterKey, ["sandbox_workspace_write"]);
      if (isObject(section) && Object.keys(section).length === 0) {
        editor.deleteSection("sandbox_workspace_write");
      }
    } else {
      editor.setStringArray(
        "sandbox_workspace_write.writable_roots",
        remaining,
      );
    }
  }

  if (
    objectPath(parsed, ["project_doc_max_bytes"]) ===
      CODEX_PROJECT_DOC_MAX_BYTES
  ) {
    editor.deleteRootKey("project_doc_max_bytes");
  }

  const out = stripGeneratedArtifactMarker(
    editor.toString(),
    ARTIFACT_PROVENANCE_SOURCES.codexConfig,
  );
  return Object.keys(parseTomlObject(out)).length === 0 ? null : out;
}

/**
 * Strip discern's contribution back out of the Codex app's `environment.toml` —
 * the uninstall inverse of {@link registerCodexEnvironment}. Removes discern's
 * `[setup]`/`[cleanup]` scripts (only while they still hold discern's default
 * command; a user-customized script is preserved), then deletes the file
 * outright when the only thing left is the `version`/`name` shell discern seeds
 * for a from-scratch file — but keeps it (scripts stripped) when the Codex app
 * owns the file (its own `version`/`name`/`[[actions]]`), restoring sole app
 * ownership without discarding the app's config.
 */
export function stripDiscernFromCodexEnv(existingText: string): string | null {
  const editor = new TomlEditor(existingText);
  const parsed = parseTomlObject(existingText);

  const dropScriptSection = (section: string, discernScript: string): void => {
    if (stringAt(parsed, [section, "script"]) !== discernScript) {
      return;
    }
    editor.deleteKey(`${section}.script`);
    const after = objectPath(parseTomlObject(editor.toString()), [section]);
    if (isObject(after) && Object.keys(after).length === 0) {
      editor.deleteSection(section);
    }
  };
  dropScriptSection("setup", CODEX_ENV_SETUP_SCRIPT);
  dropScriptSection("cleanup", CODEX_ENV_CLEANUP_SCRIPT);

  const withoutMarker = stripGeneratedArtifactMarker(
    editor.toString(),
    ARTIFACT_PROVENANCE_SOURCES.codexEnvironment,
  );
  const remaining = parseTomlObject(withoutMarker);
  const keys = Object.keys(remaining);
  const isDiscernShell = keys.every((k) => k === "version" || k === "name") &&
    remaining.version === 1 && remaining.name === "Discern";
  if (keys.length === 0 || isDiscernShell) {
    return null;
  }
  return withoutMarker;
}

// ── Cursor & GitHub Copilot (reuse-canonical instructions + skills) ──────────────

/**
 * Register discern's MCP server for Cursor: write the stdio server into the
 * project-committable `.cursor/mcp.json` under `mcpServers` (Cursor's own file,
 * requiring the explicit `type: "stdio"` the shared writer emits), preserving any
 * other servers/keys. No pre-approval list — Cursor gates committed servers behind
 * workspace trust + per-tool approval (the trust hint), not a settings key.
 * Idempotent via {@link registerStdioMcpJson}.
 */
async function registerCursorMcp(
  root: string,
  server: McpServerSpec,
  _config: DiscernConfig,
  context: McpWireContext,
): Promise<McpWireResult> {
  return await registerStdioMcpJson(root, CURSOR_MCP_FILE, {
    ...server,
    args: mcpServerArgsForNativeAgent("cursor", server.args),
  }, context);
}

/**
 * Register discern's MCP server for the GitHub Copilot CLI: write the stdio server
 * into the shared project-committable `.mcp.json` ({@link MCP_JSON_FILE}, co-owned
 * with Claude Code), preserving any other servers/keys. NO `enabledMcpjsonServers`
 * pre-approval (that is Claude's key) — Copilot gates committed config behind a
 * one-time folder trust (the trust hint), not a per-server list. Because it writes
 * the byte-identical entry through the shared writer, a project that also configures
 * Claude has the two register into one file with the second run a clean no-op,
 * either order. Idempotent via {@link registerStdioMcpJson}.
 */
async function registerCopilotMcp(
  root: string,
  server: McpServerSpec,
  _config: DiscernConfig,
  context: McpWireContext,
): Promise<McpWireResult> {
  return await registerStdioMcpJson(
    root,
    MCP_JSON_FILE,
    {
      ...server,
      args: mcpServerArgsForNativeAgent("copilot", server.args),
    },
    context,
    NATIVE_MCP_TIMEOUT_POLICY.copilot.configured_seconds,
  );
}

// ── the registry ────────────────────────────────────────────────────────────

/**
 * Every provider, keyed by {@link AgentName}. A TOTAL Record, so a new agent
 * cannot be added to `AGENT_NAMES` without a complete provider here (a compile
 * error) — that is the mechanism that keeps the registry the single source of
 * truth. Rule: `AGENTS.md` (codex) is the one CANONICAL agent file (it holds the
 * full body; the others point at it); all compiled files are TRACKED by default,
 * so a bare clone carries the same instructions a local session reads (ADR 0128).
 */
export const PROVIDERS: Record<AgentName, Provider> = {
  claude_code: {
    name: "claude_code",
    label: agentLabelForNative("claude_code"),
    brand: {
      sourceUrl: "https://www.anthropic.com/news",
      assetSourceUrl: "https://www.anthropic.com/press-kit",
      mark: {
        path: "/assets/integrations/claude-code-mark.svg",
        upstream:
          "Anthropic media resources/Anthropic logos/Claude logos/4 Claude icon/SVG/ClaudeIcon-Square.svg",
      },
      silhouette: {
        path: "/assets/integrations/claude-code-silhouette.svg",
        upstream:
          "Anthropic media resources/Anthropic logos/Claude logos/4 Claude icon/SVG/ClaudeIcon-Square.svg (glyph layer)",
      },
      wordmark: {
        path: "/assets/integrations/claude-code-wordmark.svg",
        upstream:
          "Anthropic media resources/Anthropic logos/Claude logos/2 Claude Code logo/SVG/Claude Code logo - Slate.svg",
      },
    },
    binaries: ["claude"],
    setupPresence: {
      additionalPathBinaries: [],
      filesystemMarkers: [],
    },
    cli: {
      actions: [
        { kind: "open", label: "Open in Claude Code", args: [] },
        {
          kind: "continue",
          label: "Continue in Claude Code",
          args: ["--continue"],
        },
      ],
    },
    instructionFile: {
      path: instructionPathForNative("claude_code"),
      ownership: { generated: true },
      writtenArtifact: CONTEXT_LOADED_ARTIFACT,
      canonical: false,
      pointer: atImportPointer,
    },
    mcp: {
      kind: "wired",
      integration: {
        configFile: MCP_JSON_FILE,
        ownership: { shared: true },
        writtenArtifact: COMMENT_INCAPABLE_ARTIFACT,
        register: registerClaudeCodeMcp,
      },
    },
    hooks: {
      settingsFile: CLAUDE_SETTINGS_FILE,
      ownership: { shared: true },
      writtenArtifact: COMMENT_INCAPABLE_ARTIFACT,
      worktreeEventKeys: ["WorktreeCreate", "WorktreeRemove"],
      sessionHookNeedle: "worktree",
    },
    // discern pre-approves the MCP server by name in .claude/settings.json
    // (enabledMcpjsonServers), so no separate trust/approval prompt gates it.
    trust: {
      required: false,
      hint:
        "discern pre-approves its MCP server (enabledMcpjsonServers in .claude/settings.json) — no separate trust prompt.",
    },
    activation: {
      callable: "mcp__discern__discern_status",
      recovery:
        "close and reopen Claude Code in this project, then check whether the project MCP server was loaded",
    },
    skillsDir: {
      path: CLAUDE_SKILLS_DIR,
      ownership: { generated: true },
      writtenArtifact: CONTEXT_LOADED_ARTIFACT,
    },
    // Claude Code's settings.local.json is the vendor's own per-machine override
    // file — never meant to be shared, so discern keeps it ignored.
    localState: [{
      path: CLAUDE_LOCAL_SETTINGS_FILE,
      ownership: {
        "provider-local":
          "Claude Code creates and maintains this per-machine override. discern only keeps it out of Git.",
      },
    }],
  },
  codex: {
    name: "codex",
    label: agentLabelForNative("codex"),
    brand: {
      sourceUrl: "https://openai.com/brand/",
      assetSourceUrl: "https://cdn.openai.com/brand/openai-logos.zip",
      mark: {
        path: "/assets/integrations/codex-mark.svg",
        upstream: "OpenAI-logos/SVGs/OAI_OpenAI-Blossom_Black.svg",
      },
      silhouette: "mark",
      wordmark: {
        path: "/assets/integrations/codex-wordmark.svg",
        upstream: "OpenAI-logos/SVGs/OAI_OpenAI_Wordmark_Black.svg",
      },
      note:
        "OpenAI's public kit has no Codex-specific asset, so Codex uses the OpenAI vendor mark and wordmark.",
    },
    binaries: ["codex"],
    setupPresence: {
      additionalPathBinaries: [],
      filesystemMarkers: [],
    },
    cli: {
      actions: [
        { kind: "open", label: "Open in Codex", args: [] },
        {
          kind: "continue",
          label: "Continue in Codex",
          args: ["resume"],
        },
      ],
    },
    instructionFile: {
      path: instructionPathForNative("codex"),
      ownership: { generated: true },
      writtenArtifact: CONTEXT_LOADED_ARTIFACT,
      canonical: true,
    },
    skillsDir: {
      path: AGENTS_SKILLS_DIR,
      ownership: { generated: true },
      writtenArtifact: CONTEXT_LOADED_ARTIFACT,
    },
    // MCP is wired: discern merges `[mcp_servers.discern]` into the project-committable
    // `.codex/config.toml` via the comment-preserving TOML editor (its own format, NOT
    // Claude's .mcp.json), gated by a one-time directory trust (see trust).
    mcp: {
      kind: "wired",
      integration: {
        configFile: CODEX_CONFIG_FILE,
        ownership: { shared: true },
        writtenArtifact: CODEX_CONFIG_WRITTEN_ARTIFACT,
        register: registerCodexProjectConfig,
      },
    },
    // SessionStart-only hooks surface in the committable `.codex/hooks.json` (JSON, so
    // the default deep-merge): the per-session `discern worktree ensure` re-ready step.
    // No worktree create/remove event, so discern's own worktrees stay CLI/MCP-driven
    // (empty worktreeEventKeys). A committed hook won't run until its hash is approved.
    hooks: {
      settingsFile: CODEX_HOOKS_FILE,
      ownership: { shared: true },
      writtenArtifact: COMMENT_INCAPABLE_ARTIFACT,
      worktreeEventKeys: [],
      sessionHookNeedle: "discern worktree ensure",
    },
    // The Codex *app* runs `environment.toml` [setup]/[cleanup] when IT creates/tears
    // down one of its own worktrees — a create/teardown analogue discern co-manages
    // (preserving the app's autogenerated keys), re-emitted on every refresh.
    worktreeApp: {
      configFile: CODEX_ENV_FILE,
      ownership: { shared: true },
      writtenArtifact: CODEX_ENV_WRITTEN_ARTIFACT,
      register: registerCodexEnvironment,
    },
    // Narrow project-local exec-policy rules for the linked-worktree happy path:
    // allow only the expected Git staging/commit prefixes, not broad git, push,
    // shell wrappers, destructive commands, or sandbox bypass.
    projectRules: {
      rulesFile: CODEX_RULES_FILE,
      ownership: { shared: true },
      writtenArtifact: CODEX_RULES_WRITTEN_ARTIFACT,
      register: registerCodexRules,
    },
    // Committed .codex/ config is inert until the directory is trusted, and a
    // committed hook won't run until its hash is approved. Project-local rules are
    // part of that trusted .codex/ layer and likewise require a fresh/trusted load.
    trust: {
      required: true,
      hint:
        'one-time directory trust for .codex/ project config and rules (set trust_level = "trusted"), plus per-hook hash approval before a committed hook runs (bypass: --dangerously-bypass-hook-trust).',
    },
    activation: {
      callable: "mcp__discern__discern_status",
      recovery:
        "open a new Codex task for this project and re-check the project integration; if it remains absent, restart the Codex app",
    },
  },
  gemini: {
    name: "gemini",
    label: agentLabelForNative("gemini"),
    brand: {
      sourceUrl: "https://gemini.google/about/",
      assetSourceUrl: "https://gemini.google/about/",
      mark: {
        path: "/assets/integrations/gemini-mark.svg",
        upstream: "inline header SVG (mark layer)",
      },
      silhouette: "mark",
      wordmark: {
        path: "/assets/integrations/gemini-wordmark.svg",
        upstream: "inline header SVG",
      },
    },
    binaries: ["gemini"],
    setupPresence: {
      additionalPathBinaries: [],
      filesystemMarkers: [],
    },
    cli: {
      actions: [
        { kind: "open", label: "Open in Gemini", args: [] },
        {
          kind: "continue",
          label: "Continue in Gemini",
          args: ["--resume", "latest"],
        },
      ],
    },
    // GEMINI.md points at the canonical AGENTS.md via Gemini's `@path` Memory Import
    // (verified vendor support — `.md`-only, which `@AGENTS.md` satisfies), exactly
    // like Claude Code, so the body lives in one file and the mirror can't drift.
    instructionFile: {
      path: instructionPathForNative("gemini"),
      ownership: { generated: true },
      writtenArtifact: CONTEXT_LOADED_ARTIFACT,
      canonical: false,
      pointer: atImportPointer,
    },
    // Gemini reads .gemini/skills/ AND the .agents/skills/ alias (which takes
    // precedence) — use the shared alias so Codex + Gemini dedupe to one dir.
    skillsDir: {
      path: AGENTS_SKILLS_DIR,
      ownership: { generated: true },
      writtenArtifact: CONTEXT_LOADED_ARTIFACT,
    },
    // MCP is wired: discern deep-merges `mcpServers.discern` into the
    // project-committable `.gemini/settings.json` (Gemini's own format, NOT .mcp.json),
    // inert in safe mode until the folder is trusted (see trust). The seeded `hooks`
    // block and this MCP entry deep-merge into the one file.
    mcp: {
      kind: "wired",
      integration: {
        configFile: GEMINI_SETTINGS_FILE,
        ownership: { shared: true },
        writtenArtifact: COMMENT_INCAPABLE_ARTIFACT,
        register: registerGeminiMcp,
      },
    },
    // SessionStart-only hooks surface: Gemini has no worktree create/remove event, so
    // discern's own worktrees stay CLI/MCP-driven and only the per-session
    // `discern worktree ensure` re-ready step is seeded (empty worktreeEventKeys). The
    // seed sets hooksConfig.enabled = true so the hook actually fires (see trust).
    hooks: {
      settingsFile: GEMINI_SETTINGS_FILE,
      ownership: { shared: true },
      writtenArtifact: COMMENT_INCAPABLE_ARTIFACT,
      worktreeEventKeys: [],
      sessionHookNeedle: "discern worktree ensure",
    },
    // Committed .gemini/settings.json is inert in safe mode until the folder is
    // trusted; its hooks additionally require hooksConfig.enabled = true to fire.
    trust: {
      required: true,
      hint:
        "trust the workspace so committed .gemini/settings.json loads in safe mode (bypass: --skip-trust or GEMINI_CLI_TRUST_WORKSPACE=true); hooks also require hooksConfig.enabled = true to fire.",
    },
    activation: {
      callable: "discern_status",
      recovery:
        "start a new Gemini CLI session in this project after completing the workspace trust step, then check again",
    },
  },
  cursor: {
    name: "cursor",
    label: agentLabelForNative("cursor"),
    brand: {
      sourceUrl: "https://cursor.com/brand",
      assetSourceUrl:
        "https://ptht05hbb1ssoooe.public.blob.vercel-storage.com/assets/brand/cursor-brand-assets.zip",
      mark: {
        path: "/assets/integrations/cursor-mark.svg",
        upstream: "General Logos/Cube/SVG/CUBE_2D_LIGHT.svg",
      },
      silhouette: "mark",
      wordmark: {
        path: "/assets/integrations/cursor-wordmark.svg",
        upstream:
          "General Logos/Lockup Horizontal/SVG/LOCKUP_HORIZONTAL_2D_LIGHT.svg",
      },
    },
    // `cursor-agent` is the high-confidence CLI signal. The generic `agent` alias is
    // deliberately NOT a setup-detection signal: unrelated tools commonly use it.
    binaries: ["cursor-agent"],
    // The IDE ships separately from cursor-agent. Its `cursor` shell command and
    // conventional application locations are installation evidence for setup, but
    // neither is a terminal-agent launcher for the desk.
    setupPresence: {
      additionalPathBinaries: ["cursor"],
      filesystemMarkers: [
        { os: "darwin", path: "/Applications/Cursor.app" },
        {
          os: "darwin",
          baseEnv: "HOME",
          segments: ["Applications", "Cursor.app"],
        },
        {
          os: "windows",
          baseEnv: "LOCALAPPDATA",
          segments: ["Programs", "Cursor", "Cursor.exe"],
        },
        {
          os: "windows",
          baseEnv: "ProgramFiles",
          segments: ["Cursor", "Cursor.exe"],
        },
        { os: "linux", path: "/usr/bin/cursor" },
        { os: "linux", path: "/usr/share/cursor/cursor" },
        { os: "linux", path: "/opt/cursor/AppRun" },
        {
          os: "linux",
          baseEnv: "HOME",
          segments: ["Applications", "Cursor.AppImage"],
        },
      ],
    },
    cli: {
      actions: [
        { kind: "open", label: "Open in Cursor", args: [] },
        {
          kind: "continue",
          label: "Continue in Cursor",
          args: ["resume"],
        },
      ],
    },
    // Cursor reads the canonical AGENTS.md natively at the repo root, so discern emits
    // no Cursor-specific file (reuse-canonical: no duplicate body, no pointer).
    instructionFile: {
      path: instructionPathForNative("cursor"),
      ownership: { generated: true },
      writtenArtifact: CONTEXT_LOADED_ARTIFACT,
      canonical: false,
      reuseCanonical: true,
    },
    // Cursor reads the cross-tool .agents/skills/ — the shared alias, so it dedupes
    // onto Codex's/Gemini's target rather than adding a dir of its own.
    skillsDir: {
      path: AGENTS_SKILLS_DIR,
      ownership: { generated: true },
      writtenArtifact: CONTEXT_LOADED_ARTIFACT,
    },
    // MCP is wired: discern writes the stdio `discern mcp` server into the
    // project-committable `.cursor/mcp.json` (Cursor's own file, with type: "stdio"),
    // preserving other servers/keys; idempotent; gated by workspace trust + per-tool
    // approval (see trust), not a pre-approval list.
    mcp: {
      kind: "wired",
      integration: {
        configFile: CURSOR_MCP_FILE,
        ownership: { shared: true },
        writtenArtifact: COMMENT_INCAPABLE_ARTIFACT,
        register: registerCursorMcp,
      },
    },
    // SessionStart-only hooks surface in the committable `.cursor/hooks.json`: the
    // per-session `discern worktree ensure` re-ready step. No worktree create/remove
    // event (empty worktreeEventKeys), so discern's own worktrees stay CLI/MCP-driven.
    // Cursor's hook groups carry the command at the group level (`{ command }`), which
    // the default merge can't dedup — so it uses the group-dedup seed strategy to stay
    // idempotent across re-seeds.
    hooks: {
      settingsFile: CURSOR_HOOKS_FILE,
      ownership: { shared: true },
      writtenArtifact: COMMENT_INCAPABLE_ARTIFACT,
      worktreeEventKeys: [],
      sessionHookNeedle: "discern worktree ensure",
      mergeSeed: mergeJsonSettingsDedupingGroups,
    },
    // Committed .cursor/ MCP is inert until the workspace is trusted, and tool use is
    // approval-gated by default.
    trust: {
      required: true,
      hint:
        "trust the workspace, then approve the discern MCP server's tools on first use (bypass for headless: --approve-mcps).",
    },
    activation: {
      callable: "discern_status",
      recovery:
        "reload the Cursor window, start a new agent conversation in this workspace, and check again",
    },
    humanSetupAdvice: {
      handoff:
        "Turn off External File Protection under Cursor Settings → Agents → Auto-Run for uninterrupted edits from Local sessions into discern-created sibling worktrees. This user-wide setting lets Cursor's built-in file tools write outside the open workspace. To keep it enabled, start the session with Cursor's Worktree option.",
      humanOnlyTopics: [
        "External File Protection",
        "Cursor Settings",
        "Worktree option",
      ],
      documentationTitle: "Cursor integration",
      documentationTopics: [
        "External File Protection",
        "Cursor Settings",
        "user-wide",
        "Worktree option",
        "`[worktree].root`",
        "session ends",
      ],
    },
  },
  copilot: {
    name: "copilot",
    label: agentLabelForNative("copilot"),
    brand: {
      sourceUrl: "https://brand.github.com/brand-identity/copilot",
      assetSourceUrl: "https://brand.github.com/GitHub_Logos.zip",
      mark: {
        path: "/assets/integrations/github-copilot-mark.svg",
        upstream: "GitHub Logos/SVG/Copilot_Icon_Black.svg",
      },
      silhouette: "mark",
      wordmark: {
        path: "/assets/integrations/github-copilot-wordmark.svg",
        upstream: "GitHub Logos/SVG/GitHub_Copilot_Lockup_Black.svg",
      },
    },
    // The Copilot CLI ships as `copilot` — NOT `gh copilot` (the deprecated extension).
    binaries: ["copilot"],
    setupPresence: {
      additionalPathBinaries: [],
      filesystemMarkers: [],
    },
    cli: {
      actions: [
        { kind: "open", label: "Open in GitHub Copilot", args: [] },
        {
          kind: "continue",
          label: "Continue in GitHub Copilot",
          args: ["--resume"],
        },
      ],
    },
    // The Copilot CLI reads the canonical AGENTS.md natively as its primary
    // instructions (it has no @import directive), so discern emits no
    // Copilot-specific file (reuse-canonical).
    instructionFile: {
      path: instructionPathForNative("copilot"),
      ownership: { generated: true },
      writtenArtifact: CONTEXT_LOADED_ARTIFACT,
      canonical: false,
      reuseCanonical: true,
    },
    // Copilot reads the cross-tool .agents/skills/ — the shared alias, deduped onto the
    // existing target.
    skillsDir: {
      path: AGENTS_SKILLS_DIR,
      ownership: { generated: true },
      writtenArtifact: CONTEXT_LOADED_ARTIFACT,
    },
    // MCP is wired: discern writes the stdio `discern mcp` server into the shared
    // committable `.mcp.json` (co-owned with Claude Code, byte-identical) — NO
    // enabledMcpjsonServers pre-approval (Copilot gates via folder trust, not that key).
    // Idempotent and order-independent with Claude's wiring (the shared writer).
    mcp: {
      kind: "wired",
      integration: {
        configFile: MCP_JSON_FILE,
        ownership: { shared: true },
        writtenArtifact: COMMENT_INCAPABLE_ARTIFACT,
        register: registerCopilotMcp,
      },
    },
    // SessionStart-only hooks surface in a discern-owned `.github/hooks/discern.json`
    // (Copilot loads every `.github/hooks/*.json`). sessionStart fires per-prompt in
    // interactive mode, so the seeded `discern worktree ensure` must stay idempotent —
    // it is. No worktree create/remove event (empty worktreeEventKeys). Copilot's hook
    // groups carry the command at the group level (`{ bash }`), so this uses the
    // group-dedup seed strategy to re-seed idempotently.
    hooks: {
      settingsFile: COPILOT_HOOKS_FILE,
      ownership: { shared: true },
      writtenArtifact: COMMENT_INCAPABLE_ARTIFACT,
      worktreeEventKeys: [],
      sessionHookNeedle: "discern worktree ensure",
      mergeSeed: mergeJsonSettingsDedupingGroups,
    },
    // Committed .mcp.json / .github/hooks config is inert until the folder is trusted.
    trust: {
      required: true,
      hint:
        "add the folder to trustedFolders in ~/.copilot/config.json (bypass for headless: --allow-all-tools --allow-all-paths).",
    },
    activation: {
      callable: "discern_status",
      recovery:
        "start a new Copilot CLI session in the trusted folder and check again",
    },
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
    const dir = providerFor(agent)?.skillsDir?.path;
    if (dir !== undefined && !dirs.includes(dir)) {
      dirs.push(dir);
    }
  }
  return dirs;
}

// ── registry-derived agent-path aggregators ─────────────────────────────────
// The SINGLE place every cross-cutting consumer (the seed `.gitignore`, the
// neutral-scope defaults, improve's agent-file probe, the gitignore-convergence
// migration, and the parity guard) reads agent-specific paths FROM. Each derives
// from `PROVIDERS`, so adding an agent to `AGENT_NAMES` extends them for free — no
// hand-maintained second list to fall out of sync (the ADR 0031/0042 contract).

/** Every provider's instruction-file entry, in registry order (paths may repeat —
 * the reuse-canonical providers share `AGENTS.md`). The registry-derived input
 * to {@link allInstructionFilePaths} and to any consumer that must reason about
 * the FULL provider surface (e.g. `setup begin`'s instruction-file migration),
 * so no caller hand-copies the `AGENT_NAMES → instructionFile` walk. */
export function allInstructionFiles(): InstructionFile[] {
  return AGENT_NAMES.map((a) => PROVIDERS[a].instructionFile);
}

/** Every compiled instruction-file path discern emits across all known agents
 * (CLAUDE.md, AGENTS.md, GEMINI.md, …), in registry order. Reuse-canonical
 * providers collapse into the canonical provider's path here, so the set never
 * carries `AGENTS.md` twice. */
export function allInstructionFilePaths(): string[] {
  return emittedInstructionPaths(allInstructionFiles());
}

/**
 * Every project-relative artifact discern may write for the selected providers,
 * derived from their registry entries. Setup's write plan and refresh consumers
 * use this instead of copying MCP, hooks, rules, app, instruction, and skills
 * paths into a second list.
 */
export function writtenProviderArtifactPathsForAgents(
  agents: readonly string[],
): string[] {
  const out: string[] = [];
  const add = (path: string | undefined): void => {
    if (path !== undefined && !out.includes(path)) out.push(path);
  };
  for (const agent of agents) {
    const provider = providerFor(agent);
    if (provider === undefined) continue;
    add(provider.instructionFile.path);
    if (provider.mcp.kind === "wired") {
      add(provider.mcp.integration.configFile);
    }
    add(provider.hooks?.settingsFile);
    add(provider.worktreeApp?.configFile);
    add(provider.projectRules?.rulesFile);
    add(provider.skillsDir?.path);
  }
  return out;
}

/** Every distinct skills directory discern materializes into across all known
 * agents — `.claude/skills` plus the shared `.agents/skills`, deduped. */
export function allSkillsDirs(): string[] {
  return skillsDirsForAgents(AGENT_NAMES);
}

/** The exact gate-neutral materialized-skills directory for every known agent,
 * with a trailing slash so scope matching treats it as a directory prefix.
 * Provider-owned siblings such as commands, hooks, and settings stay outside
 * this set and therefore remain real project changes. */
export function neutralAgentScopePaths(): string[] {
  return allSkillsDirs().map((dir) => `${dir.replace(/\/+$/, "")}/`);
}

/** Top-level provider directory prefixes used only to group setup's integration
 * file review. This presentation concern is intentionally broader than the exact
 * materialized-skills paths the neutral scope owns. */
export function agentIntegrationPrefixes(): string[] {
  const out: string[] = [];
  for (const dir of allSkillsDirs()) {
    const top = `${dir.split("/")[0]}/`;
    if (!out.includes(top)) {
      out.push(top);
    }
  }
  return out;
}

/** Every machine-local provider state file across all known agents, deduped in
 * registry order — per-machine overrides that must stay out of version control. */
export function allLocalStateFiles(): string[] {
  const out: string[] = [];
  for (const name of AGENT_NAMES) {
    for (const entry of PROVIDERS[name].localState ?? []) {
      const file = entry.path;
      if (!out.includes(file)) {
        out.push(file);
      }
    }
  }
  return out;
}

/**
 * The per-kind artifact posture across all known agents — the single source the
 * managed `.gitignore` block, its registry widening, and the gate's
 * tracked-artifacts check all derive from. The kinds carry the ownership
 * distinction the ignore posture needs: `instructionFiles` are compiled but TRACKED
 * (committed so a bare clone — a cloud agent's only view — reads the same page);
 * only `materializedDirs` (republished wholesale by the binary) and
 * `localStateFiles` (per-machine state) belong out of version control. A new
 * provider auto-enrols each of its paths with the right posture.
 */
export interface AgentArtifactPosture {
  /** Compiled instruction files — tracked, never in the managed ignore block. */
  instructionFiles: string[];
  /** Materialized directories discern republishes — ignored. */
  materializedDirs: string[];
  /** Machine-local provider state files — ignored. */
  localStateFiles: string[];
}

/** The registry-derived {@link AgentArtifactPosture} for all known agents. */
export function agentArtifactPosture(): AgentArtifactPosture {
  return {
    instructionFiles: allInstructionFilePaths(),
    materializedDirs: allSkillsDirs(),
    localStateFiles: allLocalStateFiles(),
  };
}

/**
 * Wire discern's MCP server into the project for each configured agent whose MCP is
 * WIRED (idempotent). An agent whose status is `pending`/`none` is skipped — its
 * server is added by hand (pending) or it has no committable target (none). Returns
 * the files written across all providers plus whether any provider added the server
 * for the first time.
 */
export async function wireProviderMcp(
  root: string,
  agents: readonly string[],
  server: McpServerSpec = DISCERN_MCP_SERVER,
  config: DiscernConfig = parseConfigOrThrow(""),
  env: EnvReader = Deno.env,
  files?: RefreshFileOps,
): Promise<ProviderMcpWireResult> {
  const context: McpWireContext = {
    agents,
    experimentalMcpPreload: experimentalEnvironmentEnabled(
      "experimentalMcpPreload",
      env,
    ),
    env,
    ...(files === undefined ? {} : { files }),
  };
  const written: string[] = [];
  const firstInstallPaths = new Set<string>();
  const establishedPaths = new Set<string>();
  let firstInstall = false;
  for (const agent of agents) {
    const provider = providerFor(agent);
    const mcp = provider !== undefined ? wiredMcp(provider) : undefined;
    if (mcp !== undefined) {
      const r = await mcp.register(root, server, config, context);
      written.push(...r.written);
      firstInstall = firstInstall || r.firstInstall;
      for (const path of r.written) {
        (r.firstInstall ? firstInstallPaths : establishedPaths).add(path);
      }
    }
  }
  return {
    written: [...new Set(written)],
    firstInstall,
    firstInstallPaths: [...firstInstallPaths].filter((path) =>
      !establishedPaths.has(path)
    ),
  };
}

/**
 * Co-manage each configured agent's APP-MANAGED worktree-lifecycle config (Codex's
 * `environment.toml`), idempotently — the worktree-app analogue of {@link wireProviderMcp},
 * run alongside it on every refresh so the file self-heals if the agent app regenerates
 * it. An agent that declares no {@link Provider.worktreeApp} is skipped (never guessed),
 * so this stays registry-driven: a new agent with such a file just declares one. Returns
 * the project-relative files written across all providers (deduped).
 */
export async function wireProviderWorktreeApp(
  root: string,
  agents: readonly string[],
  env: EnvReader = Deno.env,
  files?: RefreshFileOps,
): Promise<string[]> {
  const written: string[] = [];
  for (const agent of agents) {
    const integration = providerFor(agent)?.worktreeApp;
    if (integration !== undefined) {
      written.push(...(await integration.register(root, env, files)));
    }
  }
  return [...new Set(written)];
}

/**
 * Co-manage each configured agent's project-local rules/policy file(s), idempotently.
 * These are distinct from MCP registration and app-managed worktree lifecycle files,
 * so refresh reports them under `project_rules_wired`.
 */
export async function wireProviderProjectRules(
  root: string,
  agents: readonly string[],
  env: EnvReader = Deno.env,
  files?: RefreshFileOps,
): Promise<string[]> {
  const written: string[] = [];
  for (const agent of agents) {
    const integration = providerFor(agent)?.projectRules;
    if (integration !== undefined) {
      written.push(...(await integration.register(root, env, files)));
    }
  }
  return [...new Set(written)];
}
