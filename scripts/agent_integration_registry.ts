/**
 * The agent-integration coverage reference as a registry projection: the
 * maintainer page under `project/map/_private/research/` compiles from the
 * live provider registry (`PROVIDERS` in `src/lib/providers.ts`) plus the
 * authored verdict commentary held here (ADR 0260, following ADR 0257).
 *
 * The split is deliberate. Every cell a machine can answer — which file a
 * provider's guidance, skills, MCP, hooks, worktree-app, and rules surfaces
 * live in, its trust gate, its default-set membership, its ignore posture —
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
  emitsGuidanceFile,
  type Provider,
  PROVIDERS,
} from "../src/lib/providers.ts";
import {
  mcpServerArgsForNativeAgent,
  NATIVE_MCP_TIMEOUT_POLICY,
} from "../src/shared/mcp_timeout_policy.ts";
import { TOOLS } from "../src/engine/mcp/server.ts";
import { BEHAVIOUR_DIMENSIONS } from "./cross_agent_registry.ts";

// ── derivation helpers (shared by matrix cells and per-agent fact rows) ──────

/** Spell a small count as a word so derived prose reads naturally. */
function countWord(n: number): string {
  const words = [
    "zero",
    "one",
    "two",
    "three",
    "four",
    "five",
    "six",
    "seven",
    "eight",
    "nine",
    "ten",
    "eleven",
    "twelve",
  ];
  return words[n] ?? String(n);
}

/** The one canonical guidance file every pointer and reuse entry resolves to. */
function canonicalGuidancePath(): string {
  const canonical = AGENT_NAMES.map((name) => PROVIDERS[name].guidanceFile)
    .find((gf) => gf.canonical);
  if (canonical === undefined) {
    throw new Error("no provider declares the canonical guidance file");
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

/** How one provider's compiled guidance is produced, as a compact phrase. */
function guidanceMode(provider: Provider, withGlyph: boolean): string {
  const gf = provider.guidanceFile;
  if (gf.reuseCanonical === true) {
    return `${withGlyph ? "◑ " : ""}reads ${
      code(canonicalGuidancePath())
    } (no own file)`;
  }
  const glyph = withGlyph ? "✅ " : "";
  if (gf.canonical) {
    return `${glyph}${code(gf.path)} — canonical body`;
  }
  if (gf.pointer !== undefined) {
    return `${glyph}${code(gf.path)} — pointer ${
      code(gf.pointer(canonicalGuidancePath()).trim())
    }`;
  }
  return `${glyph}${code(gf.path)} — full body`;
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
    return "✕ none";
  }
  const events = hooks.worktreeEventKeys.length > 0
    ? `${
      hooks.worktreeEventKeys.map((key) => code(key)).join("/")
    } + SessionStart`
    : "SessionStart only";
  return withFile
    ? `✅ ${events} (${code(hooks.settingsFile)})`
    : `✅ ${events}`;
}

/** The ignore/track posture of one provider's artifacts, from the shared source. */
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
  if (emitsGuidanceFile(provider.guidanceFile)) {
    parts.push(`${code(provider.guidanceFile.path)} tracked`);
  } else {
    parts.push("no own guidance file");
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
    id: "guidance",
    label: "Guidance file",
    cell: (p) => guidanceMode(p, true),
  },
  {
    id: "skills",
    label: "Skills dir materialized",
    cell: (p) =>
      p.skillsDir === undefined
        ? "✕ none"
        : `✅ ${dirCode(p.skillsDir.path)} ${
          skillsCoTenants(p.name).length > 0 ? "(shared)" : "(its own)"
        }`,
  },
  {
    id: "mcp",
    label: "MCP wired via committed config",
    cell: (p) => {
      if (p.mcp.kind === "none") return "✕ no committable target";
      if (p.mcp.kind === "pending") {
        return `◔ pending — target ${code(p.mcp.targetFile)}`;
      }
      const coOwned = mcpCoOwners(p.name).length > 0 ? "co-owned; " : "";
      const gate = p.trust.required ? "trust-gated" : "pre-approved";
      return `✅ ${code(p.mcp.integration.configFile)} (${coOwned}${gate})`;
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
        : `✅ ${code(p.worktreeApp.configFile)}`,
  },
  {
    id: "project-rules",
    label: "Project rules file",
    cell: (p) =>
      p.projectRules === undefined
        ? "—"
        : `✅ ${code(p.projectRules.rulesFile)}`,
  },
  {
    id: "trust",
    label: "One-time trust before committed config fires",
    cell: (p) => p.trust.required ? "required" : "none needed",
  },
  {
    id: "ignore-posture",
    label: "Gitignore posture (managed block)",
    cell: (p) => posturePhrase(p.name),
  },
  {
    id: "currency",
    label: "Generated-file currency check",
    cell: (p) =>
      emitsGuidanceFile(p.guidanceFile)
        ? "✅ guidance + skills"
        : "✅ skills (no own guidance file)",
  },
  {
    id: "default-set",
    label: "In `DEFAULT_AGENTS` (fresh install, no detection)",
    cell: (p) =>
      (DEFAULT_AGENTS as readonly string[]).includes(p.name)
        ? "✅"
        : "✕ opt-in",
  },
  {
    id: "os-sandbox",
    label: "OS-sandbox config emitted by discern",
    cell: () => "✕",
  },
] as const satisfies readonly IntegrationSeam[];

// ── per-agent registry-facts rows (a fuller projection of the same record) ───

/** One derived fact row in a provider's own section table. */
interface AgentFactRow {
  readonly label: string;
  value(provider: Provider): string;
}

const AGENT_FACT_ROWS: readonly AgentFactRow[] = [
  { label: "Guidance", value: (p) => guidanceMode(p, false) },
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
      return `${hooksPhrase(p, false).replace(/^✅ /, "")} in ${
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
      p.trust.required ? `required — ${p.trust.hint}` : p.trust.hint,
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
      "Interactive open/continue entry points `discern desk` launches, argv included",
    absent: null,
  },
  guidanceFile: {
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
      "`TrustGate { required, hint }` — one-time trust for committed MCP/hooks",
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
      `The one agent whose worktree lifecycle the agent itself drives. Three hooks in \`.claude/settings.json\` (ADR 0011/0040) — \`SessionStart → discern worktree ensure\`, \`WorktreeCreate → discern worktree hook create\`, \`WorktreeRemove → discern worktree hook remove\` — make the isolated-worktree spine auto-fire from inside a session. The worktree-hook contract is the one place the engine couples to a specific agent's payload shape: \`WorktreeCreate\` hands \`{name, cwd}\` on stdin; discern creates the linked worktree, runs setup, and writes **only** the worktree path to stdout (no trailing newline) for Claude Code to read back. \`WorktreeRemove\` hands \`{worktree_path}\` and tears down resources, best-effort. The adapter lives in the feature layer (\`src/lib/worktree_hooks.ts\`), never the stack-neutral engine — the agent-agnosticism guard (\`tests/agent_agnostic_test.ts\`) forbids any \`.claude\` path under \`src/engine/**\` (ADR 0040).

MCP needs no trust step: \`registerClaudeCodeMcp\` writes the stdio server into the shared \`.mcp.json\` (the file GitHub Copilot co-owns, byte-identical via the one shared writer — ADR 0074) and pre-approves it by name via \`enabledMcpjsonServers\` in \`.claude/settings.json\`. The settings merge (\`src/lib/settings_merge.ts\`) is additive and idempotent — hook groups append (deduped by command string), permission arrays union, every other key is set-if-absent — and the seed carries \`permissions.deny: ["Read(./.env)"]\`. The skills dir is Claude's own \`.claude/skills/\` because Claude Code does _not_ read the cross-tool \`.agents/skills/\` (anthropics/claude-code#31005, open). The vendor's per-machine \`settings.local.json\` stays gitignored.`,
  },
  codex: {
    epithet: "canonical guidance + the widest committed-config surface",
    body:
      `Codex holds the **canonical full-body \`AGENTS.md\`**: it has no instruction-file import directive, so it carries the compiled body every pointer imports (ADR 0032/0043) — the single expected asymmetry the whole mirror scheme leans on ({{g:expected-divergence}}).

Its committed-config surface is now the widest of the five, all merged idempotently and comment-preservingly:

- **MCP + project config** — \`registerCodexProjectConfig\` merges \`[mcp_servers.discern]\` (command, args, tool/startup timeouts), a set-if-absent \`project_doc_max_bytes\` instruction-file headroom, and the sibling-worktree writable root into \`sandbox_workspace_write.writable_roots\` in \`<repo>/.codex/config.toml\` via the comment-preserving \`TomlEditor\`, preserving other servers, keys, and comments. \`mcp_servers\` is **not** on Codex's narrow project-scope ignored-keys list, so the file rides in the repo like Claude's \`.mcp.json\`.
- **The \`ensure\` step** — \`templates/.codex/hooks.json.tmpl\` seeds a committable \`.codex/hooks.json\` \`SessionStart\` hook running \`discern worktree ensure\`.
- **The setup/teardown pair** — \`registerCodexEnvironment\` co-manages the Codex _app_'s autogenerated \`.codex/environments/environment.toml\`: \`[setup].script → discern worktree ensure\` and \`[cleanup].script → discern worktree teardown\`, seeding the top-level \`version\`/\`name\` Codex's schema requires when absent and re-emitted on every refresh so it self-heals if the app regenerates the file (ADR 0073). The pair fires for Codex-_app_-managed worktrees (under \`$CODEX_HOME/worktrees\`), not discern's own siblings, and cleanup has an open reliability bug (\`openai/codex#19480\`) — so discern still backstops teardown via its own \`worktree prune\`.
- **Exec-policy rules** — \`registerCodexRules\` owns a narrow \`.codex/rules/discern.rules\`: prefix allowances for \`git add\` and \`git commit\` only, so the linked-worktree happy path (Git writing metadata under the main checkout's \`.git/worktrees/\`) clears Codex's approval layer without granting broad git, push, shell wrappers, or sandbox bypass. It is separate from any user-owned \`.codex/rules/*.rules\` file, which discern never touches.

The trust gate is two-stage: a one-time directory trust activates the committed \`.codex/\` layers, and each committed hook additionally needs its hash approved before it runs (the registry's \`trust.hint\` names both, and \`doctor\` relays it).`,
  },
  gemini: {
    epithet: "wired, opt-in by default",
    body:
      `\`GEMINI.md\` is a **pointer** — Gemini's Memory Import is \`.md\`-only, which \`@AGENTS.md\` satisfies (verified vendor support), so it is the same one-line import Claude Code uses and not a workaround (ADR 0043 §5). Skills reuse the cross-tool \`.agents/skills/\` alias, which Gemini prefers over \`.gemini/skills/\`, so Codex and Gemini dedupe to one materialization target.

One committable file carries both wired seams: \`registerGeminiMcp\` deep-merges \`mcpServers.discern\` (stdio inferred from \`command\` — Gemini takes no \`type\` field, which is why it does not share the \`.mcp.json\`-shape writer) into \`.gemini/settings.json\`, preserving the seeded \`hooks\` block and the user's own servers; the seed sets \`hooksConfig.enabled: true\` because without it the \`SessionStart → discern worktree ensure\` hook never fires. Both seams are inert in Folder-Trust "safe mode" until the folder is user-trusted; the compiled \`GEMINI.md\` is read regardless of trust, so guidance is unaffected.

Two live-tree corrections worth recording, because the older ADRs read otherwise: ADR 0032 described \`GEMINI.md\` as "still a full copy" and Claude's pointer as carrying a "do-not-edit banner" — **both superseded.** ADR 0043 §5 made \`GEMINI.md\` an \`@AGENTS.md\` pointer, and the live \`atImportPointer\` emits a bare \`@AGENTS.md\` line with **no** banner (Claude Code strips HTML comments before the model sees them, so a banner would be invisible; generated-ness is conveyed in-band by \`base.md\` and guarded by the currency check). Trust the registry over those two ADR lines.`,
  },
  cursor: {
    epithet: "wired, reuse-canonical",
    body:
      `Cursor reads the canonical \`AGENTS.md\` natively at the repo root and the cross-tool \`.agents/skills/\`, so discern emits **no** Cursor-specific guidance (no body, no pointer — \`reuseCanonical\`, ADR 0070) and dedupes its skills onto the shared dir. The new work was one MCP \`register()\` and one \`SessionStart\` hook: \`registerCursorMcp\` writes the stdio server into committable \`.cursor/mcp.json\` with the explicit \`type: "stdio"\` Cursor requires, via the shared \`registerStdioMcpJson\` writer; the \`.cursor/hooks.json\` seed carries \`sessionStart → discern worktree ensure\`, re-seeding idempotently through the group-dedup merge because Cursor's hook groups hold the command at the group level.

Cursor is also the one provider whose MCP **call-duration policy** is surface-dependent: its project \`.cursor/mcp.json\` feeds both the IDE and the CLI/ACP path, and the CLI stops tool calls at 60 seconds with no supported override — so discern's server declares \`--strict-tool-calls\` and \`discern_await\` answers in lossless 45-second continuation slices there instead of holding one long call (the behaviour reference {{x:mcp-call-duration}} carries the vendor evidence).

Detection is deliberately narrow: only \`cursor-agent\` is a PATH signal (the generic \`agent\` alias is too commonly claimed by unrelated tools), while the IDE's \`cursor\` shell command and app locations count as setup-only installation evidence, not launchers. Cursor is also the one provider declaring \`humanSetupAdvice\`: External File Protection is a user-wide Cursor setting discern cannot toggle, so \`setup done\` relays the handoff instead. Committed \`.cursor/\` config is inert until the workspace is trusted, and tool use is approval-gated by default (\`--approve-mcps\` bypasses for headless). CLI skill loading was buggy earlier in 2026 and is confirmed fixed in Cursor 2.4 — re-verify for the \`cursor-agent\` binary before relying on skills there.`,
  },
  copilot: {
    epithet: "wired, reuse-canonical",
    body:
      `Same shape as Cursor — the Copilot CLI reads \`AGENTS.md\` natively as its primary instructions (no \`@import\`) and reads \`.agents/skills/\`, so guidance and skills reuse discern's existing artifacts. Its one distinctive seam is that its MCP file is the **shared \`.mcp.json\`**, co-owned with Claude Code (ADR 0074): \`registerCopilotMcp\` writes the byte-identical stdio entry through the same shared writer, so whichever provider wires second is a clean no-op, order-independent — with **no** \`enabledMcpjsonServers\` pre-approval, since Copilot gates on folder trust, not that key. \`.github/mcp.json\` is silently ignored by the CLI (copilot-cli #1886), so discern does not write it.

The \`ensure\` step seeds \`sessionStart → discern worktree ensure\` into a discern-owned \`.github/hooks/discern.json\` (Copilot loads every \`.github/hooks/*.json\`), re-seeding idempotently through the group-dedup merge. \`sessionStart\` fires per-prompt in interactive mode, so the seeded command must stay idempotent — \`worktree ensure\` is. The trust grant is user-level (\`trustedFolders\` in \`~/.copilot/config.json\`); unattended spin-up needs \`--allow-all-tools --allow-all-paths\` or a pre-seeded \`COPILOT_HOME\`. Worth noting for a future feature: Copilot's \`preToolUse\` hook is the most capable of the non-Claude agents (fail-closed, with \`modifiedArgs\`) — not relevant to the worktree spine, but the strongest target if discern ever ships the pre-exec guard surveyed in the worktree-isolation research.`,
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
      title: "Guidance compile (one body, many mirrors)",
      body:
        `\`discern refresh\` composes one body — built-in \`base.md\` + a section per enabled feature + the project's \`[guidance].sources\` — and writes one file per configured agent (\`src/engine/guidance_render.ts\`, \`guidelines.ts\`). Exactly one file is **canonical** and holds the full body (\`AGENTS.md\`, because Codex has no import directive); every other provider either declares a \`pointer\` and is written as an \`@AGENTS.md\` import, or declares \`reuseCanonical\` and gets no file of its own because it reads \`AGENTS.md\` directly — so the mirrors can never drift from the source. Both Claude Code and Gemini support the byte-identical \`@path\` import, so one \`atImportPointer\` serves both (ADR 0032/0043). The compile is a **pure function of committed config** — the same renderer (\`renderAgentFiles\`) feeds both the writer and the \`status\` / \`done\` currency check, so a generated file can never silently disagree with what a refresh would produce (ADR 0034). The compiled agent files are **committed** (ADR 0128): a bare clone — a cloud agent's only view — reads the same page, and the gate fails if a committed copy drifts from its sources.`,
    },
    {
      title: "Skills materialization",
      body:
        `The effective set — bundled built-ins (shipped in the binary) ⊕ authored skills (under \`[skills].dir\`, yours win by name) — is reconciled into **every** configured agent's skills dir (\`src/lib/skills.ts\`, ADR 0042). A bundled skill is **copied** (its source is inside the binary, so a symlink would dangle); an authored skill is **symlinked** (so edits are live). Because Claude Code does not read \`.agents/skills/\` and the other four do, a default install writes **two** dirs — \`.claude/skills/\` and the shared \`.agents/skills/\` — while a Codex-plus-Gemini project writes one. A per-dir manifest (\`.discern-materialized.json\`) lets a later run prune a stale copy discern itself placed without ever clobbering a foreign drop-in. Skills join guidance under one currency discipline: \`checkSkillsCurrent\` re-resolves the effective set and diffs it against disk (bundled = byte-equal, authored = live symlink), \`done\` blocking on \`stale\` only (ADR 0043).`,
    },
    {
      title: "MCP wiring",
      body:
        `The discern MCP server is **one constant** — \`DISCERN_MCP_SERVER\` = \`discern mcp\` (\`src/lib/providers.ts\`) — exposing the verbs as tools over the official MCP SDK on stdio (\`src/engine/mcp/server.ts\`; ADR 0038/0041). The server itself is **agent-agnostic**: the same binary serves any client. What is per-agent is the _registration_ — writing the server into the file that agent reads, with that agent's capability flag from the call-duration policy (\`src/shared/mcp_timeout_policy.ts\`): a configurable client gets \`--long-tool-calls\` and an hour-long tool budget, while Cursor's surface-dependent bound gets \`--strict-tool-calls\` and continuation slices. All five modelled agents have an authored adapter: \`registerClaudeCodeMcp\` (\`.mcp.json\` + \`enabledMcpjsonServers\`), \`registerGeminiMcp\` (\`mcpServers\` deep-merged into \`.gemini/settings.json\`), \`registerCodexProjectConfig\` (\`[mcp_servers.discern]\` plus Codex project config into \`.codex/config.toml\` via the comment-preserving TOML editor), and — sharing one \`registerStdioMcpJson\` writer for the byte-identical \`{ type: "stdio" }\` shape — \`registerCursorMcp\` (\`.cursor/mcp.json\`) and \`registerCopilotMcp\` (the **shared** \`.mcp.json\`, co-owned with Claude Code, no pre-approval; ADR 0074). MCP is **core infrastructure, not a feature toggle** (ADR 0045): the wirer runs unconditionally on every \`refresh\` / \`upgrade\` / worktree-setup, and a first install surfaces a restart hint (the reactivation handoff, ADR 0075, derives each agent's exact restart-plus-trust step from this same registry). The server is feature-aware at the _tool_ level — \`discern_map\` appears only with the \`docs\` feature, and the worktree lifecycle tools only with \`worktrees\` — but those gates are agent-independent, and ADR 0062 retired the old location-based hiding (the server tracks its own working root and re-aims it on \`discern_start\`). The tool surface today, derived from the live table: ${toolNames}.`,
    },
    {
      title: "Worktree hooks (the Claude-coupled spine)",
      body:
        `discern's isolated-worktree workflow is driven, _for Claude Code_, by three hooks in \`.claude/settings.json\` (ADR 0011/0040). The \`HooksIntegration\` record names the settings file, the event keys, a session-hook needle, and (where the vendor's hook groups hold the command at the group level) a \`mergeSeed\` strategy; the parity test asserts the seed settings template actually seeds those event keys and the session-hook needle for every provider that declares a hooks surface. \`providersWithHooks()\` returns **all five** modelled agents: Claude declares the full \`WorktreeCreate\`/\`WorktreeRemove\` + \`SessionStart\` set, while Codex, Gemini, Cursor, and Copilot each declare a \`SessionStart\`-only surface (empty \`worktreeEventKeys\`) seeding \`discern worktree ensure\` into their own committable file. No other modelled agent exposes Claude's explicit worktree create/remove _contract_, so that paired event stays Claude-only (Codex has a committable \`[cleanup]\` teardown via \`environment.toml\` — see {{g:lifecycle-teardown}}). The full lifecycle is in any case reachable on every agent through the agent-agnostic CLI / MCP verbs — what the others lack is just the agent auto-firing create/remove.`,
    },
    {
      title: "Settings, gitignore, and convergence",
      body:
        `The JSON settings merge (\`src/lib/settings_merge.ts\`) is additive and idempotent — hook groups append (deduped by command string, or by the group-dedup strategy where the command lives at the group level), permission arrays union, every other key is set-if-absent — so discern never clobbers a user's settings; Codex's TOML surfaces get the same guarantee from the comment-preserving \`TomlEditor\`. The managed \`.gitignore\` block ignores only what must stay machine-local — each agent's materialized skills dir and declared \`localState\` files — while the compiled guidance files and every co-owned settings/MCP/hooks file stay tracked (ADR 0128). The block reconciler (run on every \`discern upgrade\`, \`src/lib/agent_gitignore.ts\`) absorbs old discern-owned fragments and derives agent artifacts from the registry, and the managed \`.gitattributes\` block marks generated artifacts for merge and review metadata the same registry-derived way (ADR 0259) — so a future agent's artifacts converge with no bespoke migration (ADR 0043, ADR 0093).`,
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
    title: "Gemini: fully wired; only the opt-in default remains",
    body:
      `**Status.** Done except the default. Guidance (pointer), skills, MCP, and the \`SessionStart\` hook are all live — the derived matrix above shows no Gemini gap. The behaviour reference confirms Gemini reads \`GEMINI.md\` (not \`AGENTS.md\`) natively and supports \`@file.md\` imports — which is exactly why the pointer is the right shape.

**What remains.**

- **Promotion to \`DEFAULT_AGENTS\`** — a one-line change once the maintainer decides Gemini is worth emitting for _every_ fresh install (today it is a deliberate opt-in, which keeps the no-detection footprint to the two built-in agents; PATH auto-detect already enrols it wherever the \`gemini\` binary is present at setup).

**Uncertainties.**

- **Folder Trust gates committed config.** Per the behaviour reference, Gemini ignores project \`.gemini/settings.json\` (and hence the MCP entry and hook discern writes there) until the folder is user-trusted (\`--skip-trust\` / \`GEMINI_CLI_TRUST_WORKSPACE=true\` bypasses). The _compiled \`GEMINI.md\` is read regardless of trust_, so guidance is unaffected. This is the same one-time-trust shape as Codex ({{g:codex-surface}}).
- **Schema/version volatility.** Gemini's MCP and worktree surfaces are moving fast (native \`--worktree\` and per-OS sandboxing landed ~v0.36.0 and are partly experimental). Any wired config should be version-aware.`,
  },
  {
    id: "codex-surface",
    title: "Codex: MCP, hooks, environment.toml, and exec rules all wired",
    body:
      `**Status.** Done, and since Phase B the surface has _grown_: beyond \`[mcp_servers.discern]\`, the project config now carries instruction-file headroom (\`project_doc_max_bytes\`) and the sibling-worktree writable root, and a discern-owned \`.codex/rules/discern.rules\` grants the two narrow Git prefix allowances (\`git add\`, \`git commit\`) the linked-worktree flow needs — each detailed in Codex's section above.

**Uncertainties.**

- **Two-stage trust gates it.** Trust is assigned per-user (\`~/.codex/config.toml\` \`[projects."<path>"].trust_level\`); until a directory is trusted Codex ignores its project \`.codex/\` layers — and a committed hook additionally needs a one-time hash approval before it runs. So the committed config is _committable_ but inert until those grants — the same shape as Gemini, not the "must be user-level" constraint it was once mistaken for.
- **Committable teardown, with caveats.** \`environment.toml\` \`[cleanup].script\` runs on worktree archive/eviction — a committable \`WorktreeRemove\` analogue — but it is scoped to Codex-managed worktrees and has an open reliability bug (\`#19480\`), so discern still backstops teardown via its own \`worktree prune\`.
- **\`environment.toml\` is app-worktree-scoped.** The \`[setup]\`/\`[cleanup]\` scripts fire when the Codex _app_ creates/tears down a worktree (\`$CODEX_HOME/worktrees\`); for discern's own sibling worktrees the portable, always-available hook is \`SessionStart\`. The bare CLI has no \`--worktree\` flag yet.`,
  },
  {
    id: "lifecycle-teardown",
    title:
      "Worktree lifecycle hooks: committable everywhere, uneven on teardown",
    body:
      `Claude Code is the only agent with an explicit \`WorktreeCreate\` / \`WorktreeRemove\` contract, but the others are **not** empty — every one has a committable \`SessionStart\` hook a harness can run setup from, and Codex even has a committable \`environment.toml\` \`[setup]\`/\`[cleanup]\` pair. What is uneven is **teardown reliability/scope**, not existence:

- **Claude Code** — \`WorktreeRemove\`, reliable. The benchmark.
- **Codex** — \`environment.toml\` \`[cleanup].script\`, committable, on worktree archive/eviction — a real remove hook, but scoped to Codex-managed worktrees and with an open reliability bug (\`#19480\`).
- **GitHub Copilot** — \`sessionEnd\` fires in the CLI (next-best).
- **Gemini** — \`SessionEnd\` exists but is "advisory" (not guaranteed on crash).
- **Cursor** — \`sessionEnd\` is in the committable file, but its firing in \`cursor-agent\` is unverified.

**What this actually costs.** Little. discern's worktree lifecycle is fully implemented in agent-agnostic CLI / MCP verbs (\`discern start\` / \`update\` / \`accept\` / the \`worktree\` command group), and reclamation already runs out-of-band via \`worktree prune\` — so discern never depended on an agent firing teardown. The portable win is that **\`SessionStart\` is wireable on all five** for the \`ensure\` step. The remaining Claude advantage is in-agent ergonomics, and even that is now shared: only Claude (\`EnterWorktree\`) and Copilot (\`/cwd\`, \`/worktree\`) can re-root a running session into a worktree mid-conversation; Codex, Cursor, and Gemini pin the root at launch, so "enter this worktree" is a fresh-session operation there (behaviour reference {{x:mid-session-reroot}}).`,
  },
  {
    id: "expected-divergence",
    title: "The one expected divergence to _keep_",
    body:
      `Codex's \`AGENTS.md\` having no import directive — so it is the canonical full-body file while the others point at it — is not a gap. It is the single _expected_ asymmetry (ADR 0043), and it is load-bearing: it is _why_ there is a single on-disk source the mirrors import. Leave it. (Note Cursor and Copilot lean on exactly this: they read that same canonical \`AGENTS.md\` directly, which is why they need no per-agent guidance file at all.)`,
  },
] as const satisfies readonly GapSection[];

// ── rendering ────────────────────────────────────────────────────────────────

const BANNER =
  "<!-- GENERATED by `deno task codegen` from PROVIDERS (src/lib/providers.ts) via scripts/agent_integration_registry.ts — do NOT edit by hand. Change the provider registry or the commentary registry and regenerate. -->";

const TITLE =
  "discern's agent integration coverage — what the harness wires per agent";

const LEDE =
  `_The inward-facing companion to the [cross-agent behaviour reference](cross-agent-behaviour-reference.md): not what each coding agent can do, but what discern actually wires for it today — the compiled guidance file, the materialized skills dir, the MCP registration, the hook surfaces, trust, and the gitignore footprint. The gap between what an agent supports and what discern wires is the product surface, and this is the one place it is written down._`;

/** The preamble block quote; derived counts and names interpolate. */
function preamble(): string {
  const count = AGENT_NAMES.length;
  const labels = AGENT_NAMES.map((name) => PROVIDERS[name].label).join(", ");
  return `> **What this is.** A maintainer-facing reference for discern's own per-agent integration, **compiled from the live engine**: every path, status, and per-agent cell below is derived from the typed provider registry (\`PROVIDERS\` in \`src/lib/providers.ts\`) at codegen, so the page cannot claim wiring the registry does not declare. The behaviour reference answers "can agent X do Y?" from vendor docs; this answers "does discern do Y for agent X?" from discern's code — reference input for product calls ("should we promote Gemini to the default set?", "can we rely on hooks across all agents?", "where is our weakest coverage?"), not a plan. It covers the ${
    countWord(count)
  } agents discern models today: ${labels}.
>
> **How this grows.** The agent axis is \`AGENT_NAMES\` (\`src/shared/agent_catalogue.ts\`) — the same catalogue the [behaviour reference](cross-agent-behaviour-reference.md) researches, so the two matrices can never cover different agent sets. A new provider extends every derived cell automatically (the total \`PROVIDERS\` record forces its declaration), and this registry's typed commentary layer (\`scripts/agent_integration_registry.ts\`) fails the gate until the verdict prose answers for it too. Edit the commentary there and run \`deno task codegen\`; hand edits here are overwritten.
>
> **Freshness.** The derived layer is as fresh as the last codegen — the gate regenerates and diffs it, so it cannot silently lag the engine. The authored commentary and every vendor-behaviour claim (what an agent supports) are summarised from the behaviour reference and carry its mid-2026 freshness caveat, not this page's.`;
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
  }** agents — ${names} — as a total \`Record<AgentName, Provider>\` (\`src/lib/providers.ts\`; ADR 0031), so the type checker forces a complete entry for each and provider-specific behaviour cannot drift across the codebase. Within that registry the coverage is **uneven by design**:

- **Claude Code is wired end-to-end** — guidance, skills, MCP, _and_ the worktree-lifecycle hooks (its \`WorktreeCreate\`/\`WorktreeRemove\` contract is unique to it).
- **Codex and Gemini are wired for MCP + a \`SessionStart\` hook on top of guidance + skills**, each through its own committable file, gated by a one-time trust. Codex additionally gets the \`environment.toml\` setup/cleanup pair and a discern-owned exec-policy rules file — the widest committed surface of the five.
- **Cursor and GitHub Copilot are wired as reuse-canonical providers** (ADR 0070): both read the canonical \`AGENTS.md\` and the cross-tool \`.agents/skills/\` natively, so discern emits no guidance file for them and dedupes their skills onto the shared dir; each needed only an MCP \`register()\` and a \`SessionStart\` hook.
- **The fresh-install default is ${defaults}** (\`DEFAULT_AGENTS\`, \`src/shared/config_schema.ts\`) — ${optIns} are opt-in when not auto-detected on PATH at setup.

The single sharpest line for a harness whose spine is the isolated-worktree workflow: **that spine is auto-driven by the agent only on Claude Code.** On every other agent the same lifecycle still runs — but through discern's own CLI / MCP verbs (\`discern start\` / \`update\` / \`accept\`), which are agent-agnostic, not through a hook the agent fires. The capability is present everywhere; the _in-agent ergonomics_ are Claude-only.`;
}

/** The authored registry-mechanics section below the derived field table. */
const REGISTRY_MECHANICS =
  `The machinery that makes "add the next vendor" a registry declaration:

- **PATH auto-detect (ADR 0069).** \`binaries\` lists the agent's CLI executable(s), match-any; \`setupPresence\` adds editor-only installation evidence. \`detectAgentsOnPath()\` scans \`PATH\`, and \`discern setup\` seeds a fresh install's \`[project].agents\` from the detected set (else \`DEFAULT_AGENTS\`) — once, persisted to config, **never** a runtime fallback.
- **Reuse-canonical guidance (ADR 0070).** \`guidanceFile.reuseCanonical\` marks an agent that reads the canonical \`AGENTS.md\` natively and needs no file of its own — Cursor and Copilot today. A single \`emitsGuidanceFile\` predicate gates the renderer, the writer, and the aggregators, so such a provider is written and counted exactly once — never a duplicate \`AGENTS.md\`.
- **Typed MCP status (ADR 0072).** \`mcp\` is a required discriminated \`McpStatus\`, not an optional field: \`wired\`, \`pending\` (with the committable target file), or \`none\`. A missing declaration is a compile error; the parity test asserts a \`pending\` names a real target. It tightened automatically as the vendors landed — all five agents are \`wired\` today, and the derived matrix below would surface a regression to \`pending\` on the next codegen.
- **App-managed worktree-lifecycle seam (ADR 0073).** An optional \`worktreeApp\` co-manages a config file the agent _app_ autogenerates — Codex's \`environment.toml\`. \`wireProviderWorktreeApp\` re-emits it on every refresh (alongside the MCP wiring, not a one-shot seed) so it self-heals if the app rewrites the file, preserving the app's own keys. Only Codex declares one; absent ⇒ skipped, never guessed.
- **Provider-driven settings seam (ADR 0071).** \`settingsSeeds()\` derives each hooks provider's settings file + per-provider merge strategy (default: the JSON deep-merge; group-dedup where the vendor's hook groups hold the command at the group level). The scaffolder routes settings templates by that registry-derived set, so a new hooks provider seeds purely from a \`HooksIntegration\` declaration + a dropped template.
- **Trust diagnostic and reactivation (ADR 0075).** \`trust\` records whether committed MCP/hooks need a one-time folder trust and the exact action; \`doctor\` surfaces it per agent, and the post-setup reactivation handoff derives each agent's restart-plus-trust step from the same fields — so the gap between "discern wired it" and "the tools appear" is never a silent surprise.

**Mechanisms that keep coverage honest, so a gap is a failing build, not a silent hole:**

1. **The total \`Record\`** — a new name in \`AGENT_NAMES\` without a complete \`PROVIDERS\` entry is a compile error (ADR 0031), and the required \`mcp\` / \`trust\` / \`binaries\` / \`brand\` / \`cli\` fields make their declaration compile-mandatory too.
2. **The parity test** (\`tests/agent_parity_test.ts\`) — for _every_ \`AGENT_NAMES\` entry it asserts the ignore posture, the neutral scopes, each hooks provider's seed template (event keys + session-hook needle), non-empty \`binaries\`, the one-canonical / reuse-canonical invariants, MCP status accounted, and trust metadata present. A new agent red-lights the gate on each seam until it learns it (ADR 0043/0051).
3. **\`discern doctor\`** reports per-configured-agent coverage explicitly (\`src/commands/doctor.ts\` §8b): for each agent it prints what is wired (guidance, skills, mcp, hooks) and the one-time trust step (or that none is needed) — so the expected divergences are visible rather than read as a bug.
4. **This page itself** — the derived cells regenerate from \`PROVIDERS\` at codegen and the gate diffs the committed copy, so the reference can no longer drift from the engine it describes; the typed commentary layer fails the compile until a new agent's verdict prose exists.`;

/** The authored reading of the derived coverage matrix. */
const MATRIX_COMMENTARY =
  `One read carries most of the signal. **Guidance + skills are reuse-canonical for Cursor and Copilot** — the ◑ cells — so discern emits no guidance file for them and dedupes their skills onto the shared dir. **MCP is committable on every agent** — each reads a project-committable file; the only divergence is the gate (Claude pre-approves with no trust prompt; the other four honour the committed file after a one-time trust or per-tool approval). The _worktree / session hooks_ row is the one to read carefully: every agent has a wired \`SessionStart\` hook for the \`ensure\` step, and two have a committable teardown (Claude \`WorktreeRemove\`; Codex \`environment.toml\` \`[cleanup]\`, scoped to Codex-managed worktrees) — the uneven part is teardown reliability/scope, not existence, so discern keeps owning worktree creation/removal for its own worktrees while the setup step is wired everywhere. The OS-sandbox row is uniformly empty on purpose: discern wires **no** sandbox configuration for any agent today; the per-agent _potential_ is surveyed in the [worktree-isolation research](worktree-isolation-research.md), out of scope here.`;

const SEE_ALSO = `## See also

- [cross-agent-behaviour-reference.md](cross-agent-behaviour-reference.md) — the outward axis: what each agent supports (hooks, sandboxes, cwd/re-root, MCP root mobility, trust, config surfaces). This page cites it for every vendor-behaviour claim.
- [worktree-isolation-research.md](worktree-isolation-research.md) — the OS-sandbox / pre-exec-guard options survey behind the empty sandbox row.
- [agent-instruction-files-research.md](agent-instruction-files-research.md) — the practice behind the guidance-compile seam.`;

const SOURCES = `## Sources

The derived layer needs no verification pass: it is read from the code below at every codegen.

**Code**

- \`src/lib/providers.ts\` — the typed provider registry: \`PROVIDERS\`, \`DISCERN_MCP_SERVER\`, \`atImportPointer\`, the MCP adapters (\`registerClaudeCodeMcp\`, \`registerGeminiMcp\`, \`registerCodexProjectConfig\`, \`registerCursorMcp\`, \`registerCopilotMcp\`, sharing the \`registerStdioMcpJson\` writer), the Codex worktree-app and rules adapters, and the registry-derived aggregators.
- \`src/shared/agent_catalogue.ts\` — the identity catalogue \`AGENT_NAMES\`, labels, and guidance paths derive from.
- \`src/shared/config_schema.ts\` — \`DEFAULT_AGENTS\`, \`resolveConfiguredAgents\`.
- \`src/shared/mcp_timeout_policy.ts\` — the per-agent call-duration policy and capability flags.
- \`src/lib/skills.ts\` — per-agent skills materialization + \`checkSkillsCurrent\`.
- \`src/engine/guidance_render.ts\`, \`src/engine/guidelines.ts\` — the pure renderer + effectful compiler; the MCP + worktree-app + rules wiring; the guidance currency check.
- \`src/lib/settings_merge.ts\` and the per-agent seed templates under \`templates/\` — the settings merge + the \`SessionStart\` seeds.
- \`src/lib/worktree_hooks.ts\` — the \`WorktreeCreate\` / \`WorktreeRemove\` adapter; the cwd-based \`worktree teardown\` that Codex's \`[cleanup]\` reuses.
- \`src/engine/mcp/server.ts\` — the \`discern mcp\` server and its tool surface (the derived tool list above).
- \`src/commands/doctor.ts\` (§8b) — the per-agent coverage report.
- \`src/lib/agent_gitignore.ts\`, \`templates/.gitignore.fragment\` — gitignore convergence + seed.
- \`tests/agent_agnostic_test.ts\`, \`tests/agent_parity_test.ts\` — the agent-agnosticism guard and the registry-derived parity forcing function.

**ADRs**

- 0031 — one typed provider registry for every agent-specific integration.
- 0032 — the Claude Code mirror imports \`AGENTS.md\` (pointer mechanism; its \`GEMINI.md\`-full-copy and banner premises superseded by 0043 / the live code).
- 0034 — generated agent files are guarded by a stateless currency check (their tracked-by-default posture is ADR 0128).
- 0040 — the worktree hooks parse their payload in the binary (no \`jq\`).
- 0042 — per-agent skills materialization.
- 0043 — the provider registry is the enforced single source for every agent surface.
- 0045 — the MCP server is core infrastructure, not a feature toggle.
- 0062 — the MCP server tracks its own working root.
- 0069/0070/0071/0072 — PATH auto-detect, reuse-canonical guidance, the provider-driven settings seam, and the typed MCP status.
- 0073 — discern co-manages Codex's auto-generated \`environment.toml\`.
- 0074 — Claude Code and GitHub Copilot co-own the shared \`.mcp.json\` through one stdio writer.
- 0075 — the post-setup reactivation handoff derives from the registry.
- 0128 — compiled agent files are committed; 0259 — generated artifacts carry review metadata via the managed \`.gitattributes\`.
- 0260 — this page compiles from the provider registry (the decision behind the generated banner above).

**Vendor behaviour** is not re-derived here — see the behaviour reference and its cited vendor docs / issue trackers.`;

/** Resolve \`{{g:<id>}}\` gap citations and \`{{x:<id>}}\` behaviour-reference
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
        throw new Error(`${token} cites no behaviour-reference dimension`);
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
    "`resolveConfiguredAgents(config)` resolves which agents a run targets: `[project].agents` → `DEFAULT_AGENTS`. It stays a **pure reader** — auto-detect resolves the default at setup, never here. Every cross-cutting consumer (the gitignore seed, neutral-scope defaults, the audit's agent-file probe, the gitignore convergence) reads agent paths from registry-derived aggregators — `allGuidanceFilePaths()`, `allSkillsDirs()`, `neutralAgentScopePaths()`, `agentArtifactPosture()` — never a hand-kept list (ADR 0043).",
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
    "Per integration seam, across all modelled agents — every cell derived from the registry. **✅ wired** · **◑ reuse-canonical** (discern emits nothing of its own — the agent reads the canonical `AGENTS.md`) · **✕ none/gap** · **—** not applicable to this agent.",
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
    '## Gaps & "what it would take"',
    "",
    "Decision input, not a plan. Each gap states what closing it involves and what is uncertain.",
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
