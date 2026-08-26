/**
 * The agent-integration coverage reference as a registry projection: the
 * maintainer page under `project/map/_internal/` compiles from the
 * live provider registry (`PROVIDERS` in `src/lib/providers.ts`) plus the
 * authored verdict commentary held here (ADR 0260, following ADR 0257).
 *
 * The registry separates derived facts from authored judgments. Every cell a machine can answer — which file a
 * provider's instructions, skills, MCP, hooks, worktree-app, and rules surfaces
 * live in, its trust gate, its default-set membership, and which files are
 * tracked or ignored —
 * is DERIVED from the engine at codegen, so the page cannot claim wiring the
 * registry does not declare. Only the judgment layer is authored: per-agent
 * verdicts, the seam narratives, and the gaps. Both layers are total over
 * `AGENT_NAMES`: derivation because `PROVIDERS` is a total record, commentary
 * because it is typed per agent — so a new provider fails the gate until the
 * research answers for it here too. `PROVIDER_FIELD_NOTES` is held to the
 * live field union of `PROVIDERS` at render time, so a new `Provider` field
 * cannot ship undocumented. `tests/agent_integration_coverage_codegen_test.ts`
 * holds the committed page to this renderer and the two agent axes (this
 * page's and the cross-agent reference's) to the one native catalogue.
 */

import {
  AGENT_NAMES,
  type NativeAgentName,
} from "../src/shared/agent_catalogue.ts";
import { DEFAULT_AGENTS } from "../src/shared/config_schema.ts";
import {
  agentArtifactPosture,
  DISCERN_MCP_SERVER,
  emitsInstructionFile,
  type Provider,
  PROVIDERS,
} from "../src/lib/providers.ts";
import { renderProviderTrustMarkdown } from "../src/shared/provider_trust.ts";
import {
  mcpServerArgsForNativeAgent,
  NATIVE_MCP_TIMEOUT_POLICY,
} from "../src/shared/mcp_timeout_policy.ts";
import { TOOLS } from "../src/engine/mcp/server.ts";
import { BEHAVIOUR_DIMENSIONS } from "./cross_agent_registry.ts";

// ── derivation helpers (shared by matrix cells and per-agent fact rows) ──────

/** Render a count for technical prose. */
function countWord(n: number): string {
  return String(n);
}

/** The one canonical instruction file every pointer and reuse entry resolves to. */
function canonicalInstructionPath(): string {
  const canonical = AGENT_NAMES.map((name) => PROVIDERS[name].instructionFile)
    .find((gf) => gf.canonical);
  if (canonical === undefined) {
    throw new Error("no provider declares the canonical instruction file");
  }
  return canonical.path;
}

/** Inline-code span for a project-relative path. */
function code(path: string): string {
  return `\`${path}\``;
}

/** Inline-code span for a directory path, with the trailing slash readers expect. */
function dirCode(path: string): string {
  return `\`${path.replace(/\/+$/, "")}/\``;
}

/** The providers (other than `name`) sharing the same skills directory. */
function skillsCoTenants(name: NativeAgentName): NativeAgentName[] {
  const dir = PROVIDERS[name].skillsDir?.path;
  if (dir === undefined) return [];
  return AGENT_NAMES.filter((other) =>
    other !== name && PROVIDERS[other].skillsDir?.path === dir
  );
}

/** The providers (other than `name`) whose wired MCP config is the same file. */
function mcpCoOwners(name: NativeAgentName): NativeAgentName[] {
  const mcp = PROVIDERS[name].mcp;
  if (mcp.kind !== "wired") return [];
  return AGENT_NAMES.filter((other) => {
    if (other === name) return false;
    const otherMcp = PROVIDERS[other].mcp;
    return otherMcp.kind === "wired" &&
      otherMcp.integration.configFile === mcp.integration.configFile;
  });
}

/** How one provider's compiled instructions are produced, as a compact phrase. */
function instructionMode(provider: Provider, withGlyph: boolean): string {
  const gf = provider.instructionFile;
  if (gf.reuseCanonical === true) {
    return `${withGlyph ? "reuse-canonical: " : ""}reads ${
      code(canonicalInstructionPath())
    } (no own file)`;
  }
  const status = withGlyph ? "wired: " : "";
  if (gf.canonical) {
    return `${status}${code(gf.path)} — canonical body`;
  }
  if (gf.pointer !== undefined) {
    return `${status}${code(gf.path)} — pointer ${
      code(gf.pointer(canonicalInstructionPath()).trim())
    }`;
  }
  return `${status}${code(gf.path)} — full body`;
}

/** The MCP server invocation one provider's registration writes, as argv text. */
function mcpServerInvocation(name: NativeAgentName): string {
  const args = mcpServerArgsForNativeAgent(name, DISCERN_MCP_SERVER.args);
  return [DISCERN_MCP_SERVER.command, ...args].join(" ");
}

/** One provider's MCP call-duration policy, as a compact phrase. */
function mcpTimeoutPhrase(name: NativeAgentName): string {
  const policy = NATIVE_MCP_TIMEOUT_POLICY[name];
  if (policy.capability === "configurable") {
    return `${
      policy.configured_seconds / 60
    }-minute tool calls; \`await\` holds one call up to ${
      policy.await_call_seconds / 60
    } minutes`;
  }
  return `surface-dependent client bounds (strictest ${policy.strictest_surface_seconds}s), so \`await\` answers in ${policy.await_call_seconds}s continuation slices`;
}

/** One provider's worktree-hook surface, as a compact phrase. */
function hooksPhrase(provider: Provider, withFile: boolean): string {
  const hooks = provider.hooks;
  if (hooks === undefined) {
    return "none";
  }
  const events = hooks.worktreeEventKeys.length > 0
    ? `${
      hooks.worktreeEventKeys.map((key) => code(key)).join("/")
    } + SessionStart`
    : "SessionStart only";
  return withFile
    ? `wired: ${events} (${code(hooks.settingsFile)})`
    : `wired: ${events}`;
}

/** Which artifacts are tracked or ignored, from the shared source. */
function posturePhrase(name: NativeAgentName): string {
  const provider = PROVIDERS[name];
  const posture = agentArtifactPosture();
  const parts: string[] = [];
  const skills = provider.skillsDir?.path;
  if (skills !== undefined && posture.materializedDirs.includes(skills)) {
    parts.push(`${dirCode(skills)} ignored`);
  }
  for (const state of provider.localState ?? []) {
    if (posture.localStateFiles.includes(state.path)) {
      parts.push(`${code(state.path)} ignored`);
    }
  }
  if (emitsInstructionFile(provider.instructionFile)) {
    parts.push(`${code(provider.instructionFile.path)} tracked`);
  } else {
    parts.push("no own instruction file");
  }
  return parts.join("; ");
}

// ── the seam axis: one derived coverage-matrix row per integration seam ──────

/** One integration seam: a coverage-matrix row derived from the live registry. */
export interface IntegrationSeam {
  /** Stable registry id (the canonical-set member name). */
  readonly id: string;
  /** Row label in the coverage matrix. */
  readonly label: string;
  /** The matrix cell for one provider, derived from its registry entry. */
  cell(provider: Provider): string;
}

export const INTEGRATION_SEAMS = [
  {
    id: "instructions",
    label: "Instruction file",
    cell: (p) => instructionMode(p, true),
  },
  {
    id: "skills",
    label: "Skills dir materialized",
    cell: (p) =>
      p.skillsDir === undefined
        ? "none"
        : `wired: ${dirCode(p.skillsDir.path)} ${
          skillsCoTenants(p.name).length > 0 ? "(shared)" : "(its own)"
        }`,
  },
  {
    id: "mcp",
    label: "MCP wired via committed config",
    cell: (p) => {
      if (p.mcp.kind === "none") return "none; no committable target";
      if (p.mcp.kind === "pending") {
        return `pending: target ${code(p.mcp.targetFile)}`;
      }
      const coOwned = mcpCoOwners(p.name).length > 0 ? "co-owned; " : "";
      const gate = p.trust.required ? "trust-gated" : "pre-approved";
      return `wired: ${code(p.mcp.integration.configFile)} (${coOwned}${gate})`;
    },
  },
  {
    id: "worktree-hooks",
    label: "Worktree / session hooks",
    cell: (p) => hooksPhrase(p, true),
  },
  {
    id: "worktree-app",
    label: "App-managed worktree lifecycle co-managed",
    cell: (p) =>
      p.worktreeApp === undefined
        ? "—"
        : `wired: ${code(p.worktreeApp.configFile)}`,
  },
  {
    id: "project-rules",
    label: "Project rules file",
    cell: (p) =>
      p.projectRules === undefined
        ? "—"
        : `wired: ${code(p.projectRules.rulesFile)}`,
  },
  {
    id: "trust",
    label: "One-time trust before committed config fires",
    cell: (p) => p.trust.required ? "required" : "none needed",
  },
  {
    id: "ignore-posture",
    label: "Tracked and ignored files (managed block)",
    cell: (p) => posturePhrase(p.name),
  },
  {
    id: "currency",
    label: "Generated-file currency check",
    cell: (p) =>
      emitsInstructionFile(p.instructionFile)
        ? "current: instructions + skills"
        : "current: skills (no own instruction file)",
  },
  {
    id: "default-set",
    label: "In `DEFAULT_AGENTS` (fresh install, no detection)",
    cell: (p) =>
      (DEFAULT_AGENTS as readonly string[]).includes(p.name)
        ? "included"
        : "opt-in",
  },
  {
    id: "os-sandbox",
    label: "OS-sandbox config emitted by discern",
    cell: () => "none",
  },
] as const satisfies readonly IntegrationSeam[];

// ── per-agent registry-facts rows (a fuller projection of the same record) ───

/** One derived fact row in a provider's own section table. */
interface AgentFactRow {
  readonly label: string;
  value(provider: Provider): string;
}

const AGENT_FACT_ROWS: readonly AgentFactRow[] = [
  { label: "Instructions", value: (p) => instructionMode(p, false) },
  {
    label: "Skills",
    value: (p) => {
      if (p.skillsDir === undefined) return "—";
      const tenants = skillsCoTenants(p.name);
      return tenants.length === 0
        ? `${dirCode(p.skillsDir.path)} — its own directory`
        : `${dirCode(p.skillsDir.path)} — shared with ${
          tenants.map((t) => code(t)).join(", ")
        }`;
    },
  },
  {
    label: "MCP",
    value: (p) => {
      if (p.mcp.kind === "none") return "no committable target";
      if (p.mcp.kind === "pending") {
        return `pending — discern would write ${code(p.mcp.targetFile)}`;
      }
      const coOwners = mcpCoOwners(p.name);
      const shared = coOwners.length > 0
        ? ` (co-owned with ${coOwners.map((c) => code(c)).join(", ")})`
        : "";
      return `${code(`${mcpServerInvocation(p.name)}`)} in ${
        code(p.mcp.integration.configFile)
      }${shared}`;
    },
  },
  {
    label: "MCP call duration",
    value: (p) => mcpTimeoutPhrase(p.name),
  },
  {
    label: "Hooks",
    value: (p) => {
      const hooks = p.hooks;
      if (hooks === undefined) return "—";
      const merge = hooks.mergeSeed === undefined
        ? "JSON deep-merge"
        : "group-dedup merge";
      return `${hooksPhrase(p, false).replace(/^wired: /, "")} in ${
        code(hooks.settingsFile)
      } (seed strategy: ${merge})`;
    },
  },
  {
    label: "Worktree app",
    value: (p) =>
      p.worktreeApp === undefined
        ? "—"
        : `co-manages ${code(p.worktreeApp.configFile)}`,
  },
  {
    label: "Project rules",
    value: (p) =>
      p.projectRules === undefined
        ? "—"
        : `owns ${code(p.projectRules.rulesFile)}`,
  },
  {
    label: "Trust",
    value: (p) =>
      p.trust.required
        ? `required — ${renderProviderTrustMarkdown(p.trust)}`
        : renderProviderTrustMarkdown(p.trust),
  },
  {
    label: "Detection",
    value: (p) => {
      const parts = [
        `PATH binaries ${p.binaries.map((b) => code(b)).join(", ")}`,
      ];
      if (p.setupPresence.additionalPathBinaries.length > 0) {
        parts.push(
          `setup-only evidence ${
            p.setupPresence.additionalPathBinaries.map((b) => code(b)).join(
              ", ",
            )
          }`,
        );
      }
      if (p.setupPresence.filesystemMarkers.length > 0) {
        parts.push(
          `${p.setupPresence.filesystemMarkers.length} filesystem markers`,
        );
      }
      return parts.join("; ");
    },
  },
  {
    label: "Desk entry",
    value: (p) =>
      p.cli.actions.map((action) =>
        `${action.kind}: ${
          code([...p.binaries.slice(0, 1), ...action.args].join(" "))
        }`
      ).join(" · "),
  },
  {
    label: "Human setup advice",
    value: (p) =>
      p.humanSetupAdvice === undefined
        ? "—"
        : `declared — relayed at \`setup done\` (see the "${p.humanSetupAdvice.documentationTitle}" map page)`,
  },
  {
    label: "Local state",
    value: (p) =>
      p.localState === undefined || p.localState.length === 0
        ? "—"
        : p.localState.map((state) => `${code(state.path)} (ignored)`).join(
          ", ",
        ),
  },
  {
    label: "Default set",
    value: (p) =>
      (DEFAULT_AGENTS as readonly string[]).includes(p.name)
        ? `in ${code("DEFAULT_AGENTS")}`
        : `opt-in — add ${code(`"${p.name}"`)} to ${code("[project].agents")}`,
  },
];

// ── the authored layer: field notes, per-agent verdicts, seams, gaps ─────────

/**
 * Authored meaning for every field of the `Provider` record. The renderer
 * derives the live field union from `PROVIDERS` and refuses to render when a
 * field is missing here or a note has gone stale — so the field table cannot
 * silently omit a new registry capability again.
 */
export const PROVIDER_FIELD_NOTES: Readonly<
  Record<string, { readonly meaning: string; readonly absent: string | null }>
> = {
  name: { meaning: "The registry key (an `AGENT_NAMES` entry)", absent: null },
  label: {
    meaning: "Display label, owned by the identity catalogue",
    absent: null,
  },
  brand: {
    meaning: "First-party logo SVGs for the site's integrations surfaces",
    absent: null,
  },
  binaries: {
    meaning:
      "Terminal-agent executable name(s) for PATH auto-detect — **match-any** (ADR 0069)",
    absent: null,
  },
  setupPresence: {
    meaning:
      "Setup-only installation evidence (editor binaries, app locations) beyond the terminal agent",
    absent: null,
  },
  cli: {
    meaning:
      "Interactive open/continue entry points `discern desk` launches, `argv` included",
    absent: null,
  },
  instructionFile: {
    meaning:
      "`{ path, canonical, pointer?, reuseCanonical? }` — the compiled instruction file, or reuse-canonical",
    absent: null,
  },
  mcp: {
    meaning:
      "`McpStatus`: `wired` \\| `pending` (committable target) \\| `none` (ADR 0072)",
    absent: null,
  },
  hooks: {
    meaning:
      "`{ settingsFile, worktreeEventKeys, sessionHookNeedle, mergeSeed? }`",
    absent: "no worktree-hook surface — skipped",
  },
  worktreeApp: {
    meaning:
      "`{ configFile, register() }` — co-manage an app-auto-generated lifecycle file (ADR 0073)",
    absent: "no app-managed lifecycle file — skipped",
  },
  projectRules: {
    meaning:
      "`{ rulesFile, register() }` — a discern-owned policy/rules file the agent loads from committed config",
    absent: "no project-rules surface — skipped",
  },
  trust: {
    meaning:
      "`TrustGate { required, explanation, actions }` — one-time trust for committed MCP/hooks, with literal machine facts separated from prose",
    absent: null,
  },
  activation: {
    meaning:
      "Provider-owned local recovery when the exact post-restart integration check is unavailable",
    absent: null,
  },
  humanSetupAdvice: {
    meaning:
      "Vendor-UI setup a human must perform; relayed at `setup done`, never applied (ADR 0075)",
    absent: "no human-only setup step",
  },
  skillsDir: {
    meaning: "Project-relative dir to materialize the skill set into",
    absent: "no skills target — skipped",
  },
  localState: {
    meaning:
      "Machine-local provider state files the managed `.gitignore` keeps out of version control",
    absent: "the agent keeps none in the project tree",
  },
};

/** One provider's authored section: a short epithet plus the verdict prose. */
export interface AgentCommentary {
  /** Heading suffix after the provider label. */
  readonly epithet: string;
  /** Verbatim Markdown rendered below the derived fact table. */
  readonly body: string;
}

export const AGENT_COMMENTARY: Readonly<
  Record<NativeAgentName, AgentCommentary>
> = {
  claude_code: {
    epithet: "wired end-to-end",
    body:
      `Claude Code drives its worktree lifecycle through hooks in \`.claude/settings.json\` (ADR 0011/0040): \`SessionStart → discern worktree ensure\`, \`WorktreeCreate → discern worktree hook create\`, and \`WorktreeRemove → discern worktree hook remove\`. \`WorktreeCreate\` passes \`{name, cwd}\` on stdin. discern creates the linked worktree, runs setup, and writes the worktree path to stdout without a trailing newline for Claude Code to read. \`WorktreeRemove\` passes \`{worktree_path}\` and attempts resource teardown. The provider-specific payload adapter lives in \`src/lib/worktree_hooks.ts\`. The agent-agnosticism guard in \`tests/agent_agnostic_test.ts\` forbids \`.claude\` paths under the stack-neutral \`src/engine/**\` tree (ADR 0040).

MCP needs no trust step. \`registerClaudeCodeMcp\` writes the stdio server into the shared \`.mcp.json\`, which GitHub Copilot co-owns through the same byte-identical writer (ADR 0074), and pre-approves the server through \`enabledMcpjsonServers\` in \`.claude/settings.json\`. The additive, idempotent merge in \`src/lib/settings_merge.ts\` appends hook groups with command-string deduplication, unions permission arrays, and sets other keys when absent. The seed carries \`permissions.deny: ["Read(./.env)"]\`. Claude Code reads Skills from \`.claude/skills/\`; it does not read the cross-tool \`.agents/skills/\` (anthropics/claude-code#31005, open). The vendor's per-machine \`settings.local.json\` stays ignored.`,
  },
  codex: {
    epithet: "canonical instructions + the widest committed-config surface",
    body:
      `Codex holds the **canonical full-body \`AGENTS.md\`** because it has no instruction-file import directive. The file carries the compiled body imported or reused by the other providers (ADR 0032/0043; {{g:expected-divergence}}).

Its committed-config surface is now the widest of the five, all merged idempotently and comment-preservingly:

- **MCP + project config** — \`registerCodexProjectConfig\` merges \`[mcp_servers.discern]\` (command, args, tool/startup timeouts), a set-if-absent \`project_doc_max_bytes\` instruction-file headroom, and the sibling-worktree writable root into \`sandbox_workspace_write.writable_roots\` in \`<repo>/.codex/config.toml\` via the comment-preserving \`TomlEditor\`, preserving other servers, keys, and comments. \`mcp_servers\` is **not** on Codex's narrow project-scope ignored-keys list, so the file rides in the repo like Claude's \`.mcp.json\`.
- **The \`ensure\` step** — \`templates/.codex/hooks.json.tmpl\` seeds a committable \`.codex/hooks.json\` \`SessionStart\` hook running \`discern worktree ensure\`.
- **The setup and teardown pair** — \`registerCodexEnvironment\` co-manages the Codex app's generated \`.codex/environments/environment.toml\`: \`[setup].script → discern worktree ensure\` and \`[cleanup].script → discern worktree teardown\`. It seeds the top-level \`version\` and \`name\` fields when absent and re-emits discern's entries on every refresh if the app regenerates the file (ADR 0073). The pair fires for Codex-app-managed worktrees under \`$CODEX_HOME/worktrees\`. discern's sibling worktrees use the portable \`SessionStart\` hook. Cleanup has an open reliability bug at \`openai/codex#19480\`, so \`discern worktree prune\` provides out-of-band reclamation.
- **Exec-policy rules** — \`registerCodexRules\` owns a narrow \`.codex/rules/discern.rules\`: prefix allowances for \`git add\` and \`git commit\` only, so the linked-worktree happy path (Git writing metadata under the main checkout's \`.git/worktrees/\`) clears Codex's approval layer without granting broad git, push, shell wrappers, or sandbox bypass. It is separate from any user-owned \`.codex/rules/*.rules\` file, which discern never touches.

The trust gate is two-stage: a one-time directory trust activates the committed \`.codex/\` layers, and each committed hook additionally needs its hash approved before it runs (the registry's structured trust actions name both, and \`doctor\` relays them).`,
  },
  gemini: {
    epithet: "wired, opt-in by default",
    body:
      `\`GEMINI.md\` is a pointer. Gemini's verified Markdown-only Memory Import accepts \`@AGENTS.md\`, the same one-line import that Claude Code uses (ADR 0043 §5). Gemini prefers the cross-tool \`.agents/skills/\` alias over \`.gemini/skills/\`, so Codex and Gemini share one Skills materialization target.

One committable file carries both wired seams: \`registerGeminiMcp\` deep-merges \`mcpServers.discern\` (stdio inferred from \`command\` — Gemini takes no \`type\` field, which is why it does not share the \`.mcp.json\`-shape writer) into \`.gemini/settings.json\`, preserving the seeded \`hooks\` block and the user's own servers; the seed sets \`hooksConfig.enabled: true\` because without it the \`SessionStart → discern worktree ensure\` hook never fires. Both seams are inert in Folder-Trust "safe mode" until the folder is user-trusted; the compiled \`GEMINI.md\` is read regardless of trust, so instructions are unaffected.

Live code supersedes 2 older ADR descriptions. ADR 0032 describes \`GEMINI.md\` as “still a full copy” and Claude's pointer as carrying a “do-not-edit banner.” ADR 0043 §5 changed \`GEMINI.md\` to an \`@AGENTS.md\` pointer. The current \`atImportPointer\` emits a bare \`@AGENTS.md\` line because Claude Code strips HTML comments before the model sees them. \`base.md\` carries the generated-file instruction in band, and the currency check guards the output. Use the registry and generated artifacts as the current authority.`,
  },
  cursor: {
    epithet: "wired, reuse-canonical",
    body:
      `Cursor reads the canonical root \`AGENTS.md\` and the cross-tool \`.agents/skills/\`. Its \`reuseCanonical\` declaration means discern emits no Cursor-specific Instructions body or pointer and reuses the shared Skills directory (ADR 0070). \`registerCursorMcp\` writes the stdio server into committable \`.cursor/mcp.json\` with Cursor's required explicit \`type: "stdio"\` through the shared \`registerStdioMcpJson\` writer. The \`.cursor/hooks.json\` seed carries \`sessionStart → discern worktree ensure\` and uses a group-dedup merge because Cursor stores the command at the hook-group level.

Cursor's MCP **call-duration policy** is surface-dependent. Its project \`.cursor/mcp.json\` feeds the integrated development environment (IDE) and the CLI or Agent Client Protocol (ACP) path. The CLI stops tool calls at 60 seconds and has no supported override. discern's server therefore declares \`--strict-tool-calls\`, and \`discern_await\` returns lossless 45-second continuation slices (the behavior reference {{x:mcp-call-duration}} carries the vendor evidence).

Detection uses \`cursor-agent\` as its \`PATH\` signal because unrelated tools commonly claim the generic \`agent\` alias. The \`cursor\` shell command in the IDE and the application locations count as setup-only installation evidence. Cursor declares \`humanSetupAdvice\` because External File Protection is a user-wide setting that discern cannot change; \`setup done\` relays that handoff. Committed \`.cursor/\` configuration remains inert until the workspace is trusted, and tool use requires approval by default (\`--approve-mcps\` bypasses approval in headless mode). Cursor 2.4 fixed earlier 2026 CLI Skill-loading bugs. Re-verify the \`cursor-agent\` binary before relying on Skills there.`,
  },
  copilot: {
    epithet: "wired, reuse-canonical",
    body:
      `Copilot CLI reads \`AGENTS.md\` natively as its primary instructions and reads \`.agents/skills/\`, so Instructions and Skills reuse discern's existing artifacts. It has no \`@import\` requirement. Copilot shares \`.mcp.json\` with Claude Code (ADR 0074). \`registerCopilotMcp\` writes the byte-identical stdio entry through the shared writer, making provider order irrelevant. Copilot gates on folder trust and does not use Claude Code's \`enabledMcpjsonServers\` pre-approval. The CLI ignores \`.github/mcp.json\` without a diagnostic (copilot-cli #1886), so discern writes the shared root file.

The \`ensure\` step seeds \`sessionStart → discern worktree ensure\` into discern-owned \`.github/hooks/discern.json\`; Copilot loads every \`.github/hooks/*.json\` file. The group-dedup merge re-seeds it idempotently. \`sessionStart\` fires for each prompt in interactive mode, and \`worktree ensure\` is safe to rerun. The trust grant lives in user-level \`trustedFolders\` within \`~/.copilot/config.json\`. Unattended startup needs \`--allow-all-tools --allow-all-paths\` or a pre-seeded \`COPILOT_HOME\`. Copilot's fail-closed \`preToolUse\` hook supports \`modifiedArgs\`, making it a candidate for the pre-execution guard surveyed in the worktree-isolation research. That possible feature does not affect the current worktree lifecycle.`,
  },
};

/** One seam narrative: how a whole integration surface works across agents. */
export interface SeamNarrative {
  readonly title: string;
  readonly body: string;
}

/** The five cross-agent seam narratives (authored; derived lists interpolate). */
export function seamNarratives(): readonly SeamNarrative[] {
  const toolNames = TOOLS.map((tool) => code(tool.name)).join(", ");
  return [
    {
      title: "Instructions compile (one body, many mirrors)",
      body:
        `\`discern refresh\` composes built-in \`base.md\`, the enabled feature sections, and the project's \`[instructions].sources\` into one body. It writes the configured provider files through \`src/engine/instruction_render.ts\` and \`src/engine/instructions.ts\`. \`AGENTS.md\` is the canonical full-body file because Codex has no import directive. Other providers declare an \`@AGENTS.md\` pointer or \`reuseCanonical\` when they read \`AGENTS.md\` directly. Claude Code and Gemini support the same byte-identical \`@path\` import, so \`atImportPointer\` serves both (ADR 0032/0043). \`renderAgentFiles\` feeds the writer and the \`status\` and \`done\` currency checks from committed configuration (ADR 0034). ADR 0128 keeps the Agent files tracked, and the Gate fails when a committed copy differs from its sources.`,
    },
    {
      title: "Skills materialization",
      body:
        `\`src/lib/skills.ts\` reconciles the effective Skill set into each configured agent's Skills directory (ADR 0042). The effective set combines bundled Skills from the binary with authored Skills under \`[skills].dir\`; an authored Skill wins when names collide. Bundled Skills are copied because their source lives inside the binary. Authored Skills are symlinked so source edits remain live. Claude Code reads \`.claude/skills/\`; Codex, Gemini, Cursor, and Copilot read the shared \`.agents/skills/\`. A default install therefore writes those 2 directories, while a Codex-and-Gemini project writes the shared directory. The per-directory \`.discern-materialized.json\` manifest lets a later run prune stale discern-owned copies while preserving foreign drop-ins. \`checkSkillsCurrent\` resolves the effective set again and compares bundled bytes and authored symlinks with disk; \`discern done\` blocks on \`stale\` (ADR 0043).`,
    },
    {
      title: "MCP wiring",
      body:
        `\`DISCERN_MCP_SERVER\` in \`src/lib/providers.ts\` defines the shared \`discern mcp\` server. \`src/engine/mcp/server.ts\` exposes verbs as tools over the official MCP software development kit (SDK) on standard input and output (ADR 0038/0041). The same server binary serves each client. Provider adapters register it in the file that client reads and apply the call-duration policy from \`src/shared/mcp_timeout_policy.ts\`. Configurable clients receive \`--long-tool-calls\` and an hour-long tool budget. Cursor receives \`--strict-tool-calls\` and continuation slices because its limit varies by surface. The adapters are \`registerClaudeCodeMcp\`, \`registerGeminiMcp\`, \`registerCodexProjectConfig\`, \`registerCursorMcp\`, and \`registerCopilotMcp\`. Cursor and Copilot share \`registerStdioMcpJson\` for their byte-identical \`{ type: "stdio" }\` entries; Copilot co-owns root \`.mcp.json\` with Claude Code (ADR 0074). ADR 0045 classifies MCP as core infrastructure, so refresh, upgrade, and worktree setup always run the wirer. The first installation returns a restart hint derived from the registry's provider-specific restart and trust state (ADR 0075). Tool availability still follows agent-independent feature gates: \`discern_map\` requires \`docs\`, and lifecycle tools require \`worktrees\`. ADR 0062 lets the server track and re-aim its logical working root on \`discern_start\`. The live tool table currently exposes ${toolNames}.`,
    },
    {
      title: "Worktree hooks (the Claude-coupled spine)",
      body:
        `Claude Code drives discern's isolated-worktree workflow through \`SessionStart\`, \`WorktreeCreate\`, and \`WorktreeRemove\` hooks in \`.claude/settings.json\` (ADR 0011/0040). Each \`HooksIntegration\` record names the settings file, event keys, session-hook needle, and any \`mergeSeed\` strategy required by the vendor's hook-group format. The parity test requires the seed template to contain those events and the session-hook needle. \`providersWithHooks()\` returns Claude Code, Codex, Gemini, Cursor, and Copilot. Claude Code declares the full create, remove, and session-start set. The other providers declare a \`SessionStart\` surface with empty \`worktreeEventKeys\` and seed \`discern worktree ensure\` into their committable file. Codex also provides \`environment.toml [cleanup]\` for its app-managed worktrees (see {{g:lifecycle-teardown}}). Every provider can reach the full lifecycle through discern's CLI and MCP verbs. Claude Code alone auto-fires create and remove through the agent hook contract.`,
    },
    {
      title: "Settings, gitignore, and convergence",
      body:
        `The additive, idempotent JSON merge in \`src/lib/settings_merge.ts\` appends hook groups, deduplicates by command string or group strategy, unions permission arrays, and sets other keys when absent. Codex's comment-preserving \`TomlEditor\` provides the corresponding guarantee for TOML surfaces. The managed \`.gitignore\` block ignores each agent's materialized Skills directory and declared \`localState\` files. Compiled Instructions and co-owned settings, MCP, and hook files stay tracked (ADR 0128). \`src/lib/agent_gitignore.ts\` reconciles the block during every \`discern upgrade\`, absorbs old discern-owned fragments, and derives current artifacts from the provider registry. The managed \`.gitattributes\` block uses the same registry to mark generated artifacts for merge and review metadata (ADR 0259). A future provider therefore enters both convergence paths through its registry declaration (ADR 0043, ADR 0093).`,
    },
  ];
}

/** One gap section: authored decision input, renumber-safe via \`{{g:<id>}}\`. */
export interface GapSection {
  readonly id: string;
  readonly title: string;
  readonly body: string;
}

export const GAPS = [
  {
    id: "gemini-default",
    title: "Gemini: wired with opt-in default status",
    body:
      `**Status.** Instructions through a pointer, Skills, MCP, and the \`SessionStart\` hook are live. Gemini remains outside \`DEFAULT_AGENTS\`. The behavior reference confirms that Gemini natively reads \`GEMINI.md\` and supports \`@file.md\` imports, so the \`@AGENTS.md\` pointer uses a documented provider mechanism.

**What remains.**

- **Promotion to \`DEFAULT_AGENTS\`** requires a maintainer decision to emit Gemini artifacts for each fresh installation. The current opt-in default keeps the no-detection footprint at \`claude_code\` and \`codex\`. Setup already enrolls Gemini when it detects the \`gemini\` binary on \`PATH\`.

**Uncertainties.**

- **Folder Trust gates committed configuration.** Per the behavior reference, Gemini ignores project \`.gemini/settings.json\`, including discern's MCP entry and hook, until the folder receives a user trust grant. \`--skip-trust\` and \`GEMINI_CLI_TRUST_WORKSPACE=true\` bypass that gate. Gemini reads compiled \`GEMINI.md\` before trust, so instructions remain available. Codex has a corresponding one-time trust boundary ({{g:codex-surface}}).
- **Schema/version volatility.** Gemini's MCP and worktree surfaces are moving fast (native \`--worktree\` and per-OS sandbox support landed ~v0.36.0 and are partly experimental). Any wired config should be version-aware.`,
  },
  {
    id: "codex-surface",
    title: "Codex: MCP, hooks, environment.toml, and exec rules all wired",
    body:
      `**Status.** Codex's project configuration carries \`[mcp_servers.discern]\`, instruction-file headroom through \`project_doc_max_bytes\`, and the sibling-worktree writable root. discern-owned \`.codex/rules/discern.rules\` grants the narrow \`git add\` and \`git commit\` prefix allowances required by the linked-worktree flow. The Codex integration section records each mechanism.

**Uncertainties.**

- **A two-stage trust boundary gates it.** User-level \`~/.codex/config.toml [projects."<path>"].trust_level\` activates project \`.codex/\` layers. Each committed hook also needs a one-time hash approval before it runs. The project configuration remains inert until those grants. Gemini uses a similar one-time directory trust boundary.
- **Committable teardown has a bounded scope.** \`environment.toml [cleanup].script\` runs when Codex archives or evicts a Codex-managed worktree. It has an open reliability bug at \`#19480\`. \`discern worktree prune\` provides out-of-band reclamation.
- **\`environment.toml\` is app-worktree-scoped.** The \`[setup]\`/\`[cleanup]\` scripts fire when the Codex _app_ creates/tears down a worktree (\`$CODEX_HOME/worktrees\`); for discern's own sibling worktrees the portable, always-available hook is \`SessionStart\`. The bare CLI has no \`--worktree\` flag yet.`,
  },
  {
    id: "lifecycle-teardown",
    title:
      "Worktree lifecycle hooks: committable everywhere, uneven on teardown",
    body:
      `Claude Code provides an explicit \`WorktreeCreate\` and \`WorktreeRemove\` contract. Each provider has a committable \`SessionStart\` hook that can run setup. Codex also has a committable \`environment.toml [setup]\` and \`[cleanup]\` pair. Teardown reliability and scope vary:

- **Claude Code** — \`WorktreeRemove\`, reliable. The benchmark.
- **Codex** — \`environment.toml [cleanup].script\`, committable on worktree archive or eviction, scoped to Codex-managed worktrees, with an open reliability bug at \`#19480\`.
- **GitHub Copilot** — \`sessionEnd\` fires in the CLI (next-best).
- **Gemini** — \`SessionEnd\` is advisory and may not run after a crash.
- **Cursor** — \`sessionEnd\` is in the committable file; its firing in \`cursor-agent\` remains unverified.

**Operational consequence.** The agent-agnostic CLI and MCP verbs implement the lifecycle: \`discern start\`, \`discern update\`, \`discern accept\`, and the \`worktree\` command group. \`discern worktree prune\` performs out-of-band reclamation. The \`SessionStart\` hook can run \`ensure\` for each provider. Claude Code can re-root through \`EnterWorktree\`, and Copilot can use \`/cwd\` or \`/worktree\`. Codex, Cursor, and Gemini pin the root at launch, so entering a worktree requires a fresh session (behavior reference {{x:mid-session-reroot}}).`,
  },
  {
    id: "expected-divergence",
    title: "Keep Codex as the canonical full-body Instruction file",
    body:
      `Codex has no instruction-file import directive, so \`AGENTS.md\` holds the canonical full body that other providers import or reuse. ADR 0043 records this required asymmetry. Keep \`AGENTS.md\` as the on-disk source for provider mirrors. Cursor and Copilot read that canonical file directly and therefore need no provider-specific Instruction file.`,
  },
] as const satisfies readonly GapSection[];

// ── rendering ────────────────────────────────────────────────────────────────

const BANNER =
  "<!-- GENERATED by `deno task codegen` from PROVIDERS (src/lib/providers.ts) via scripts/agent_integration_registry.ts — do NOT edit by hand. Change the provider registry or the commentary registry and regenerate. -->";

const TITLE = "Agent integration coverage";

const LEDE =
  `_This reference records discern's current integration for each coding agent: compiled Instructions, materialized Skills, Model Context Protocol (MCP) registration, hooks, trust, and tracked or ignored files. The [cross-agent behavior reference](cross-agent-behaviour-reference.md) records the vendor capabilities these integrations use._`;

/** The preamble block quote; derived counts and names interpolate. */
function preamble(): string {
  const count = AGENT_NAMES.length;
  const labels = AGENT_NAMES.map((name) => PROVIDERS[name].label).join(", ");
  return `> **What this is.** A maintainer reference compiled from the live engine. Every path, status, and per-agent cell below derives from the typed \`PROVIDERS\` registry in \`src/lib/providers.ts\` during code generation. The cross-agent behavior reference records vendor capabilities; this page records the discern integration that currently uses them. Use it as evidence when deciding whether to change default providers, rely on a hook surface, or close an integration gap. It covers the ${
    countWord(count)
  } agents discern models today: ${labels}.
>
> **How this grows.** The \`AGENT_NAMES\` catalog in \`src/shared/agent_catalogue.ts\` supplies the agent axis to this page and the [cross-agent behavior reference](cross-agent-behaviour-reference.md). A new provider extends each derived cell because \`PROVIDERS\` is a total record. The typed commentary layer in \`scripts/agent_integration_registry.ts\` fails the Gate until verdict prose covers that provider. Edit the commentary source and run \`deno task codegen\`; code generation overwrites hand edits to this page.
>
> **Freshness.** The Gate regenerates and diffs the derived layer, so its state matches the provider registry at the last code generation. The authored commentary and vendor-behavior claims summarize the cross-agent behavior reference and carry that page's mid-2026 freshness boundary.`;
}

/** The authored headline; derived agent facts interpolate. */
function headline(): string {
  const count = AGENT_NAMES.length;
  const names = AGENT_NAMES.map((name) => code(name)).join(", ");
  const defaults = DEFAULT_AGENTS.map((name) => code(name)).join(", ");
  const optIns = AGENT_NAMES.filter((name) =>
    !(DEFAULT_AGENTS as readonly string[]).includes(name)
  ).map((name) => PROVIDERS[name].label).join(", ");
  return `discern models **${
    countWord(count)
  }** agents (${names}) as a total \`Record<AgentName, Provider>\` in \`src/lib/providers.ts\` (ADR 0031). The type checker requires a complete entry for each provider and prevents provider-specific behavior from drifting into separate lists. Current coverage differs by provider:

- **Claude Code is wired end-to-end:** Instructions, Skills, MCP, and the worktree-lifecycle hooks. It alone exposes the \`WorktreeCreate\`/\`WorktreeRemove\` contract.
- **Codex and Gemini have Instructions, Skills, MCP, and a \`SessionStart\` hook.** Each uses a provider-specific committable file and requires a one-time trust grant. Codex also receives the \`environment.toml\` setup and cleanup pair and a discern-owned execution-policy rules file.
- **Cursor and GitHub Copilot are wired as reuse-canonical providers** (ADR 0070): both read the canonical \`AGENTS.md\` and the cross-tool \`.agents/skills/\` natively, so discern emits no instruction file for them and dedupes their skills onto the shared dir; each needed only an MCP \`register()\` and a \`SessionStart\` hook.
- **The fresh-install default is ${defaults}** (\`DEFAULT_AGENTS\`, \`src/shared/config_schema.ts\`). ${optIns} remain opt-in when setup does not detect them on \`PATH\`.

Claude Code can drive the isolated-worktree lifecycle through agent hooks. Every provider can run the lifecycle through discern's agent-agnostic CLI and MCP verbs: \`discern start\`, \`discern update\`, and \`discern accept\`. The automatic in-agent create and remove actions are specific to Claude Code.`;
}

/** The authored registry-mechanics section below the derived field table. */
const REGISTRY_MECHANICS =
  `The machinery that makes "add the next vendor" a registry declaration:

- **PATH auto-detect (ADR 0069).** \`binaries\` lists the agent's matching CLI executables; \`setupPresence\` adds editor-only installation evidence. \`detectAgentsOnPath()\` scans \`PATH\`, and \`discern setup\` seeds a fresh install's \`[project].agents\` from the detected set or \`DEFAULT_AGENTS\`. Setup persists that result in configuration, and runtime resolution reads the recorded value.
- **Reuse-canonical Instructions (ADR 0070).** \`instructionFile.reuseCanonical\` marks an agent that reads the canonical \`AGENTS.md\` natively and needs no provider-specific file. Cursor and Copilot use this mode. The \`emitsInstructionFile\` predicate governs the renderer, writer, and aggregators, so each provider's Instructions are written and counted once.
- **Typed MCP status (ADR 0072).** \`mcp\` is a required discriminated \`McpStatus\`: \`wired\`, \`pending\` with a committable target file, or \`none\`. A missing declaration is a compile error. The parity test requires a \`pending\` entry to name a real target. Every current agent is \`wired\`; the derived matrix surfaces a later regression to \`pending\` at the next code generation.
- **App-managed worktree-lifecycle seam (ADR 0073).** An optional \`worktreeApp\` co-manages a configuration file that the agent app generates, such as Codex's \`environment.toml\`. \`wireProviderWorktreeApp\` re-emits the discern-owned entries on every refresh alongside MCP wiring, preserves the app's keys, and repairs entries after the app rewrites the file. Codex declares this seam; other providers skip it when \`worktreeApp\` is absent.
- **Provider-driven settings seam (ADR 0071).** \`settingsSeeds()\` derives each hooks provider's settings file + per-provider merge strategy (default: the JSON deep-merge; group-dedup where the vendor's hook groups hold the command at the group level). The scaffolder routes settings templates by that registry-derived set, so a new hooks provider seeds purely from a \`HooksIntegration\` declaration + a dropped template.
- **Trust diagnostic and activation (ADR 0075).** \`trust\` records whether committed MCP servers and hooks need a one-time folder trust and names the required action. \`activation\` owns the provider-specific local recovery. The post-setup handoff derives the exact MCP-or-CLI check, recovery, and CLI fallback from those registry facts; generated files alone never count as activation evidence.

**Coverage gaps fail the Gate through these mechanisms:**

1. **The total \`Record\`** — a new name in \`AGENT_NAMES\` without a complete \`PROVIDERS\` entry is a compile error (ADR 0031), and the required \`mcp\` / \`trust\` / \`activation\` / \`binaries\` / \`brand\` / \`cli\` fields make their declaration compile-mandatory too.
2. **The parity test** (\`tests/agent_parity_test.ts\`) — for every \`AGENT_NAMES\` entry it asserts tracked and ignored file state, neutral scopes, each hooks provider's seed template (event keys + session-hook needle), non-empty \`binaries\`, the canonical and reuse-canonical invariants, an accounted MCP status, and trust metadata. A new agent fails the Gate at each incomplete seam (ADR 0043/0051).
3. **\`discern doctor\`** reports per-configured-agent coverage explicitly (\`src/commands/doctor.ts\` §8b): for each agent it prints what is wired (Instructions, Skills, MCP, and hooks) and the one-time trust step (or that none is needed) — so the expected divergences are visible rather than read as a bug.
4. **This page itself** — code generation derives the cells from \`PROVIDERS\`, and the Gate diffs the committed copy. The typed commentary layer fails compilation until verdict prose covers a new agent.`;

/** The authored reading of the derived coverage matrix. */
const MATRIX_COMMENTARY =
  `**Cursor and Copilot reuse canonical Instructions and Skills.** Their \`reuse-canonical\` cells mean that discern emits no provider-specific Instruction file and materializes Skills into the shared directory. **Every agent reads committed MCP configuration.** Claude pre-approves the server without a trust prompt. Codex, Gemini, Cursor, and Copilot require a one-time trust grant or per-tool approval. Every agent also has a wired \`SessionStart\` hook for \`discern worktree ensure\`. Claude provides a committable \`WorktreeRemove\` hook, and Codex provides \`environment.toml [cleanup]\` for Codex-managed worktrees. Teardown reliability and scope vary, so discern owns creation and removal for its worktrees. The OS-sandbox row is empty because discern currently emits no sandbox configuration. The [worktree-isolation research](../_private/research/worktree-isolation-research.md) surveys provider capabilities outside this page's integration scope.`;

const SEE_ALSO = `## See also

- [Cross-agent behavior reference](cross-agent-behaviour-reference.md) records what each agent supports: hooks, sandboxes, cwd and re-root behavior, MCP root mobility, trust, and configuration surfaces. This page cites it for every vendor-behavior claim.
- [Worktree isolation research](../_private/research/worktree-isolation-research.md) surveys the OS-sandbox and pre-execution-guard options behind the empty sandbox row.
- [Agent instruction files research](../_private/research/agent-instruction-files-research.md) records the research behind the Instructions compilation seam.`;

const SOURCES = `## Sources

The derived layer needs no verification pass: it is read from the code below at every codegen.

**Code**

- \`src/lib/providers.ts\` — the typed provider registry: \`PROVIDERS\`, \`DISCERN_MCP_SERVER\`, \`atImportPointer\`, the MCP adapters (\`registerClaudeCodeMcp\`, \`registerGeminiMcp\`, \`registerCodexProjectConfig\`, \`registerCursorMcp\`, \`registerCopilotMcp\`, sharing the \`registerStdioMcpJson\` writer), the Codex worktree-app and rules adapters, and the registry-derived aggregators.
- \`src/shared/agent_catalogue.ts\` — the identity catalogue \`AGENT_NAMES\`, labels, and instructions paths derive from.
- \`src/shared/config_schema.ts\` — \`DEFAULT_AGENTS\`, \`resolveConfiguredAgents\`.
- \`src/shared/mcp_timeout_policy.ts\` — the per-agent call-duration policy and capability flags.
- \`src/lib/skills.ts\` — per-agent skills materialization + \`checkSkillsCurrent\`.
- \`src/engine/instruction_render.ts\`, \`src/engine/instructions.ts\` — the pure renderer + effectful compiler; the MCP + worktree-app + rules wiring; the instruction currency check.
- \`src/lib/settings_merge.ts\` and the per-agent seed templates under \`templates/\` — the settings merge + the \`SessionStart\` seeds.
- \`src/lib/worktree_hooks.ts\` — the \`WorktreeCreate\` / \`WorktreeRemove\` adapter; the cwd-based \`worktree teardown\` that Codex's \`[cleanup]\` reuses.
- \`src/engine/mcp/server.ts\` — the \`discern mcp\` server and its tool surface (the derived tool list above).
- \`src/commands/doctor.ts\` (§8b) — the per-agent coverage report.
- \`src/lib/agent_gitignore.ts\`, \`templates/.gitignore.fragment\` — gitignore convergence + seed.
- \`tests/agent_agnostic_test.ts\`, \`tests/agent_parity_test.ts\` — the agent-agnosticism guard and the registry-derived parity forcing function.

**ADRs**

- 0031 — one typed provider registry for every agent-specific integration.
- 0032 — the Claude Code mirror imports \`AGENTS.md\` (pointer mechanism; its \`GEMINI.md\`-full-copy and banner premises superseded by 0043 / the live code).
- 0034 — generated agent files are guarded by a stateless currency check (ADR 0128 records that they are tracked by default).
- 0040 — the worktree hooks parse their payload in the binary (no \`jq\`).
- 0042 — per-agent skills materialization.
- 0043 — the provider registry is the enforced single source for every agent surface.
- 0045 — the MCP server is core infrastructure.
- 0062 — the MCP server tracks its own working root.
- 0069/0070/0071/0072 — PATH auto-detect, reuse-canonical instructions, the provider-driven settings seam, and the typed MCP status.
- 0073 — discern co-manages Codex's auto-generated \`environment.toml\`.
- 0074 — Claude Code and GitHub Copilot co-own the shared \`.mcp.json\` through one stdio writer.
- 0075 — the post-setup reactivation handoff derives from the registry.
- 0128 — Agent files are committed; 0259 — generated artifacts carry review metadata via the managed \`.gitattributes\`.
- 0260 — this page compiles from the provider registry (the decision behind the generated banner above).

**Vendor behavior** comes from the [cross-agent behavior reference](cross-agent-behaviour-reference.md) and its cited vendor documentation and issue trackers.`;

/** Resolve \`{{g:<id>}}\` gap citations and \`{{x:<id>}}\` behavior-reference
 * citations to live section numbers, or throw on an unknown id — so neither
 * this page's gap list nor the companion's dimension order can strand a
 * reference. */
export function resolveCitationTokens(markdown: string): string {
  const gaps = new Map<string, number>(
    GAPS.map((gap, index) => [gap.id, index + 1]),
  );
  const dimensions = new Map<string, number>(
    BEHAVIOUR_DIMENSIONS.map((dimension, index) => [dimension.id, index + 1]),
  );
  return markdown.replace(
    /\{\{([gx]):([a-z0-9-]+)\}\}/g,
    (token, kind: string, id: string) => {
      if (kind === "g") {
        const number = gaps.get(id);
        if (number === undefined) {
          throw new Error(`${token} cites no gap section`);
        }
        return `Gaps §${number}`;
      }
      const number = dimensions.get(id);
      if (number === undefined) {
        throw new Error(`${token} cites no behavior-reference dimension`);
      }
      return `§${number}`;
    },
  );
}

/** The derived Provider-record field table, held to the live field union. */
function renderFieldTable(): string {
  const seen: string[] = [];
  for (const name of AGENT_NAMES) {
    for (const field of Object.keys(PROVIDERS[name])) {
      if (!seen.includes(field)) {
        seen.push(field);
      }
    }
  }
  const noted = Object.keys(PROVIDER_FIELD_NOTES);
  const missing = seen.filter((field) => !noted.includes(field));
  const stale = noted.filter((field) => !seen.includes(field));
  if (missing.length > 0 || stale.length > 0) {
    throw new Error(
      `PROVIDER_FIELD_NOTES out of step with the live Provider record — ` +
        `missing: [${missing.join(", ")}], stale: [${stale.join(", ")}]`,
    );
  }
  const rows = seen.map((field) => {
    const note = PROVIDER_FIELD_NOTES[field];
    if (note === undefined) {
      throw new Error(`no field note for ${field}`);
    }
    return `| ${
      code(note.absent === null ? field : `${field}?`)
    } | ${note.meaning} | ${note.absent ?? "(required)"} |`;
  });
  return [
    "| Field | Meaning | Absent ⇒ |",
    "| --- | --- | --- |",
    ...rows,
  ].join("\n");
}

/** The derived declaration snippet for the two agent sets. */
function renderAgentSetsSnippet(): string {
  const names = AGENT_NAMES.map((name) => `"${name}"`).join(", ");
  const defaults = DEFAULT_AGENTS.map((name) => `"${name}"`).join(", ");
  return [
    "```ts",
    `AGENT_NAMES = [${names}]; // src/shared/agent_catalogue.ts (native catalogue order)`,
    `DEFAULT_AGENTS = [${defaults}]; // src/shared/config_schema.ts (no-detection floor)`,
    "```",
  ].join("\n");
}

/** The derived coverage matrix: every seam row across every agent column. */
function renderCoverageMatrix(): string {
  const header = [
    "Integration capability",
    ...AGENT_NAMES.map((name) => PROVIDERS[name].label),
  ];
  const rows = INTEGRATION_SEAMS.map((seam) =>
    `| ${seam.label} | ${
      AGENT_NAMES.map((name) => seam.cell(PROVIDERS[name])).join(" | ")
    } |`
  );
  return [
    `| ${header.join(" | ")} |`,
    `| ${header.map(() => "---").join(" | ")} |`,
    ...rows,
  ].join("\n");
}

/** One provider's section: derived fact table + authored commentary. */
function renderAgentSection(name: NativeAgentName): string {
  const provider = PROVIDERS[name];
  const commentary = AGENT_COMMENTARY[name];
  const rows = AGENT_FACT_ROWS.map((row) =>
    `| ${row.label} | ${row.value(provider)} |`
  );
  return [
    `### ${provider.label} — ${commentary.epithet}`,
    "",
    "| Registry fact | Live declaration |",
    "| --- | --- |",
    ...rows,
    "",
    commentary.body,
  ].join("\n");
}

/** The whole coverage page, ready for the codegen write chokepoint. */
export function renderAgentIntegrationCoverageDoc(): string {
  const agentSections = AGENT_NAMES.map((name) => renderAgentSection(name))
    .join("\n\n");
  const seamSections = seamNarratives().map((seam) =>
    `### ${seam.title}\n\n${seam.body}`
  ).join("\n\n");
  const gapSections = GAPS.map((gap, index) =>
    `### ${index + 1}. ${gap.title}\n\n${gap.body}`
  ).join("\n\n");
  return resolveCitationTokens([
    BANNER,
    "",
    `# ${TITLE}`,
    "",
    LEDE,
    "",
    preamble(),
    "",
    "---",
    "",
    "## The headline (read this first)",
    "",
    headline(),
    "",
    "---",
    "",
    "## How discern models an agent — the provider registry",
    "",
    "Everything agent-specific lives in one typed record per agent in `src/lib/providers.ts` (ADR 0031), keyed by `AgentName`. The field table is derived from the live record — a new `Provider` field cannot render until this page's notes explain it:",
    "",
    renderFieldTable(),
    "",
    "The known set and the default set are declared once each:",
    "",
    renderAgentSetsSnippet(),
    "",
    "`resolveConfiguredAgents(config)` resolves which agents a run targets: `[project].agents` → `DEFAULT_AGENTS`. It stays a **pure reader**. Setup resolves the default through auto-detection and stores the result; runtime reads that stored choice. Every cross-cutting consumer (the gitignore seed, neutral-scope defaults, the audit's agent-file probe, and gitignore convergence) reads agent paths from the registry-derived `allInstructionFilePaths()`, `allSkillsDirs()`, `neutralAgentScopePaths()`, and `agentArtifactPosture()` aggregators. Those aggregators own the path lists (ADR 0043).",
    "",
    REGISTRY_MECHANICS,
    "",
    "---",
    "",
    "## Integration map — per agent",
    "",
    "Each fact table below is a projection of the agent's `PROVIDERS` entry — regenerated at codegen, so a cell cannot outlive the declaration it reads. The prose below each table is the authored verdict layer.",
    "",
    agentSections,
    "",
    "---",
    "",
    "## Coverage matrix",
    "",
    "Every coverage-matrix cell derives from the provider registry. `wired` names a discern-owned integration; `reuse-canonical` means the agent reads canonical `AGENTS.md`; `none` names a gap; and — means the seam does not apply to that agent.",
    "",
    renderCoverageMatrix(),
    "",
    MATRIX_COMMENTARY,
    "",
    "---",
    "",
    "## The seams in detail",
    "",
    seamSections,
    "",
    "---",
    "",
    "## Gaps and closure requirements",
    "",
    "Each gap provides decision input by stating the work required to close it and the remaining uncertainty.",
    "",
    gapSections,
    "",
    "---",
    "",
    SEE_ALSO,
    "",
    SOURCES,
    "",
  ].join("\n"));
}
