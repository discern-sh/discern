/**
 * The typed provider registry (ADR 0031) — the single source of truth for every
 * native integration surface, over the identity-catalogue subset (ADR 0166).
 * These guard that the registry stays total and that
 * the Claude Code MCP wiring is correct and idempotent.
 */

import {
  assert,
  assertEquals,
  assertExists,
  assertRejects,
  assertStringIncludes,
} from "@std/assert";
import { basename, dirname, join } from "@std/path";
import { fakeEnv, withTempDir } from "./helpers.ts";
import { addWorktree, gitInit } from "./engine_helpers.ts";
import { AGENT_NAMES } from "../src/shared/config_schema.ts";
import {
  allInstructionFilePaths,
  DISCERN_MCP_SERVER,
  type McpServerSpec,
  type McpWireResult,
  providerFor,
  PROVIDERS,
  providerSetupFacts,
  providersWithHooks,
  renderProviderHookSeed,
  skillsDirsForAgents,
  wiredMcp,
  wireProviderMcp as wireProviderMcpFromRegistry,
  wireProviderProjectRules as wireProviderProjectRulesFromRegistry,
  wireProviderWorktreeApp as wireProviderWorktreeAppFromRegistry,
} from "../src/lib/providers.ts";
import {
  providerTrustData,
  renderProviderTrustMarkdown,
} from "../src/shared/provider_trust.ts";
import { parse as parseToml } from "@std/toml";
import { z } from "@zod/zod";
import { decodeWith } from "./decode_cli_result.ts";
import {
  type DiscernConfig,
  parseConfigOrThrow,
} from "../src/shared/config_schema.ts";
import { DISCERN_NO_ATTRIBUTION, type EnvReader } from "../src/shared/env.ts";
import { EXPERIMENTAL_ENVIRONMENT_VARIABLES } from "../src/shared/experimental.ts";
import { generatedArtifactMarker } from "../src/shared/brand.ts";
import { ARTIFACT_PROVENANCE_SOURCES } from "../src/shared/file_ownership.ts";
import { readTextIfExists } from "../src/shared/fs_presence.ts";
const McpServerSchema = z.object({
  type: z.string().optional(),
  command: z.string(),
  args: z.array(z.string()).optional(),
  timeout: z.number().optional(),
  alwaysLoad: z.boolean().optional(),
  deferTools: z.string().optional(),
}).passthrough();

const McpConfigSchema = z.object({
  mcpServers: z.object({
    discern: McpServerSchema,
    other: McpServerSchema.optional(),
  }).passthrough(),
  someTopLevelKey: z.boolean().optional(),
}).passthrough();

const ClaudeSettingsSchema = z.object({
  enabledMcpjsonServers: z.array(z.string()),
  permissions: z.object({
    deny: z.array(z.string()),
  }).passthrough().optional(),
}).passthrough();

const CommandHookSchema = z.object({
  type: z.literal("command"),
  command: z.string(),
}).passthrough();

const HookRegistrationSchema = z.object({
  matcher: z.string().optional(),
  hooks: z.array(CommandHookSchema),
}).passthrough();

const GeminiSettingsSchema = z.object({
  mcpServers: z.object({
    discern: McpServerSchema,
    other: McpServerSchema.optional(),
  }).passthrough(),
  hooksConfig: z.object({
    enabled: z.boolean(),
  }).passthrough().optional(),
  hooks: z.record(z.string(), z.array(HookRegistrationSchema)).optional(),
}).passthrough();

const DynamicServerMapSchema = z.object({
  mcpServers: z.record(z.string(), McpServerSchema).optional(),
  zzPreExistingUserKey: z.string().optional(),
}).catchall(McpServerSchema);

import {
  CURSOR_CLI_TOOL_TIMEOUT_SECONDS,
  MCP_CONFIGURED_TOOL_TIMEOUT_SECONDS,
  MCP_LONG_TOOL_CALLS_FLAG,
  MCP_STRICT_TOOL_CALLS_FLAG,
  mcpServerArgsForNativeAgent,
  NATIVE_MCP_TIMEOUT_POLICY,
} from "../src/shared/mcp_timeout_policy.ts";

/** Call the production MCP wirer with an empty environment by default, so the
 * host running this suite cannot opt fixtures into an experiment. */
async function wireProviderMcp(
  root: string,
  agents: readonly string[],
  server: McpServerSpec = DISCERN_MCP_SERVER,
  config: DiscernConfig = parseConfigOrThrow(""),
  env: EnvReader = fakeEnv(),
): Promise<McpWireResult> {
  return await wireProviderMcpFromRegistry(root, agents, server, config, env);
}

/** Keep provider artifact tests independent of the host attribution setting. */
async function wireProviderWorktreeApp(
  root: string,
  agents: readonly string[],
  env: EnvReader = fakeEnv(),
  config: DiscernConfig = parseConfigOrThrow(""),
): Promise<string[]> {
  return await wireProviderWorktreeAppFromRegistry(root, agents, config, env);
}

/** Keep provider artifact tests independent of the host attribution setting. */
async function wireProviderProjectRules(
  root: string,
  agents: readonly string[],
  env: EnvReader = fakeEnv(),
): Promise<string[]> {
  return await wireProviderProjectRulesFromRegistry(root, agents, env);
}

Deno.test("the registry is total: every known agent has a complete provider", () => {
  for (const name of AGENT_NAMES) {
    const p = providerFor(name);
    assert(p, `no provider for ${name}`);
    assertEquals(p.name, name);
    assert(p.label.length > 0, `${name}: empty label`);
    assert(
      p.instructionFile.path.endsWith(".md"),
      `${name}: odd instruction file`,
    );
  }
  assertEquals(Object.keys(PROVIDERS).length, AGENT_NAMES.length);
});

Deno.test("setup facts project provider files, trust, and security disclosures from the registry", () => {
  for (const name of AGENT_NAMES) {
    const provider = PROVIDERS[name];
    const facts = providerSetupFacts(name);
    assertEquals(facts.agent, name);
    assertEquals(facts.label, provider.label);
    assertEquals(facts.instructionFile, provider.instructionFile.path);
    assertEquals(facts.trust, providerTrustData(name, provider.trust));
    assertEquals(facts.disclosures, provider.setupDisclosures);
    assert(facts.disclosures.length > 0, `${name}: no setup disclosure`);
    assert(
      facts.writtenFiles.includes(provider.instructionFile.path),
      `${name}: setup facts omit its compiled agent file`,
    );
  }

  assertStringIncludes(
    providerSetupFacts("claude_code").disclosures.join(" "),
    "normal MCP tool permissions",
  );
  const codex = providerSetupFacts("codex").disclosures.join(" ");
  for (
    const fact of [
      "git add",
      "git commit",
      "trailing arguments",
      "no working-directory boundary",
      "no push",
      "no broader Git",
      "general shell",
    ]
  ) {
    assertStringIncludes(codex, fact);
  }
});

Deno.test("a provider advertises enable-hooks exactly when its seed overrides hooksConfig", () => {
  for (const name of AGENT_NAMES) {
    const provider = PROVIDERS[name];
    const enablesHooks = provider.trust.actions.some((action) =>
      action.kind === "enable-hooks"
    );
    const seed = provider.hooks === undefined
      ? ""
      : renderProviderHookSeed(provider.hooks);
    assertEquals(
      enablesHooks,
      seed.includes("hooksConfig"),
      `${name}: enable-hooks action and hooksConfig override must move together`,
    );
  }
});

Deno.test("provider prompt arguments are documented, separate argv options", () => {
  for (const name of AGENT_NAMES) {
    for (const action of PROVIDERS[name].cli.actions) {
      const prompt = action.promptArgument;
      if (prompt === undefined) continue;
      assert(
        /^--[a-z0-9][a-z0-9-]*$/u.test(prompt.flag),
        `${name}:${action.kind}: prompt flag must be one standalone long option`,
      );
      assert(
        /^https:\/\//u.test(prompt.documentation),
        `${name}:${action.kind}: prompt option needs public provider documentation`,
      );
    }
  }
});

Deno.test("every native provider declares an MCP timeout capability", () => {
  assertEquals(
    Object.keys(NATIVE_MCP_TIMEOUT_POLICY).sort(),
    [...AGENT_NAMES].sort(),
  );
  for (const name of AGENT_NAMES) {
    const policy = NATIVE_MCP_TIMEOUT_POLICY[name];
    assert(policy.await_call_seconds > 0, `${name}: no safe await bound`);
    if (policy.capability === "configurable") {
      assertEquals(
        policy.configured_seconds,
        MCP_CONFIGURED_TOOL_TIMEOUT_SECONDS,
      );
      assert(
        policy.await_call_seconds < policy.configured_seconds,
        `${name}: await needs delivery headroom below its configured timeout`,
      );
    } else {
      assertEquals(
        policy.strictest_surface_seconds,
        CURSOR_CLI_TOOL_TIMEOUT_SECONDS,
      );
      assert(
        policy.await_call_seconds < policy.strictest_surface_seconds,
        `${name}: await needs delivery headroom below its strictest client surface`,
      );
    }
    assertEquals(mcpServerArgsForNativeAgent(name, ["mcp"]), [
      "mcp",
      policy.capability === "configurable"
        ? MCP_LONG_TOOL_CALLS_FLAG
        : MCP_STRICT_TOOL_CALLS_FLAG,
    ]);
  }
});

Deno.test("every known agent declares a skills directory (all SKILL.md-format)", () => {
  for (const name of AGENT_NAMES) {
    const dir = providerFor(name)?.skillsDir;
    assert(dir !== undefined && dir.path.length > 0, `${name}: no skills dir`);
  }
  // Claude keeps its own; Codex, Gemini, Cursor, and Copilot share the cross-tool standard.
  assertEquals(providerFor("claude_code")?.skillsDir?.path, ".claude/skills");
  assertEquals(providerFor("codex")?.skillsDir?.path, ".agents/skills");
  assertEquals(providerFor("gemini")?.skillsDir?.path, ".agents/skills");
  assertEquals(providerFor("cursor")?.skillsDir?.path, ".agents/skills");
  assertEquals(providerFor("copilot")?.skillsDir?.path, ".agents/skills");
});

Deno.test("skillsDirsForAgents: dedupes Codex+Gemini onto the shared .agents/skills", () => {
  // The default agent set materializes into two dirs (Claude's + the shared one).
  assertEquals(skillsDirsForAgents(["claude_code", "codex"]), [
    ".claude/skills",
    ".agents/skills",
  ]);
  // Codex + Gemini collapse to a single shared dir (no redundant materialization).
  assertEquals(skillsDirsForAgents(["codex", "gemini"]), [".agents/skills"]);
  // All three → two dirs, deduped and in first-seen order.
  assertEquals(skillsDirsForAgents(["claude_code", "codex", "gemini"]), [
    ".claude/skills",
    ".agents/skills",
  ]);
  // An unknown agent contributes nothing (skipped, never guessed).
  assertEquals(skillsDirsForAgents(["nope"]), []);
});

Deno.test("every agent renders a distinct `<label> (<file>)` setup choice", () => {
  // The `setup` agent-files Checkbox derives each option's display from the
  // registry: `${label} (${instructionFile.path})`. The label and path must be
  // 1:1 with the agent, or two agents render identically and one is silently
  // mislabelled (the "two Codexs" bug, when a hardcoded fallback labelled both
  // codex and gemini "Codex (AGENTS.md)").
  const display = (name: typeof AGENT_NAMES[number]) =>
    `${PROVIDERS[name].label} (${PROVIDERS[name].instructionFile.path})`;
  assertEquals(display("claude_code"), "Claude Code (CLAUDE.md)");
  assertEquals(display("codex"), "Codex (AGENTS.md)");
  assertEquals(display("gemini"), "Gemini (GEMINI.md)");
  // No two agents share a rendered choice.
  const rendered = AGENT_NAMES.map(display);
  assertEquals(
    new Set(rendered).size,
    AGENT_NAMES.length,
    rendered.join(" | "),
  );
});

Deno.test("the instruction-file mapping is the documented one (AGENTS.md the one canonical file)", () => {
  // Claude Code's mirror points at the canonical file rather than duplicating it,
  // so its instructionFile carries a `pointer` that emits an `@<path>` import — and it
  // is not itself canonical. (canonical is decoupled from git-tracking: ADR 0034
  // makes every compiled file gitignored.)
  const claude = providerFor("claude_code")?.instructionFile;
  assertEquals(claude?.path, "CLAUDE.md");
  assertEquals(claude?.canonical, false);
  assertEquals(typeof claude?.pointer, "function");
  assertEquals(claude?.pointer?.("AGENTS.md"), "@AGENTS.md\n");

  // The canonical file holds the full compiled body — no pointer.
  const codex = providerFor("codex")?.instructionFile;
  assertEquals(codex?.path, "AGENTS.md");
  assertEquals(codex?.canonical, true);
  assertEquals(codex?.pointer, undefined);

  // Gemini's mirror points at the canonical AGENTS.md via its `@path` Memory Import
  // (vendor-verified, `.md`-only), exactly like Claude — not a duplicated body.
  const gemini = providerFor("gemini")?.instructionFile;
  assertEquals(gemini?.path, "GEMINI.md");
  assertEquals(gemini?.canonical, false);
  assertEquals(gemini?.pointer?.("AGENTS.md"), "@AGENTS.md\n");
  // Exactly one canonical file, and it is AGENTS.md.
  const canonical = Object.values(PROVIDERS)
    .filter((p) => p.instructionFile.canonical)
    .map((p) => p.instructionFile.path);
  assertEquals(canonical, ["AGENTS.md"]);
});

Deno.test("providerFor returns undefined for an unknown agent", () => {
  assertEquals(providerFor("eliza"), undefined);
});

Deno.test("the discern MCP server spec is `discern mcp`", () => {
  assertEquals(DISCERN_MCP_SERVER, {
    name: "discern",
    command: "discern",
    args: ["mcp"],
  });
});

Deno.test("MCP status is typed and explicit: all five agents wired to their own config file", () => {
  // The typed McpStatus (ADR 0051) tightens as plans flip pending → wired: Phase B
  // wired Codex (.codex/config.toml, TOML) and Gemini (.gemini/settings.json, JSON)
  // alongside Claude (.mcp.json); Phase C wires Cursor (.cursor/mcp.json) and Copilot
  // (the SAME .mcp.json Claude uses — co-owned). Every provider carries a live
  // integration naming the committable file it writes into — no pending/undefined gap.
  assertEquals(providerFor("claude_code")?.mcp.kind, "wired");
  assertEquals(wiredMcp(PROVIDERS.claude_code)?.configFile, ".mcp.json");
  assertEquals(providerFor("codex")?.mcp.kind, "wired");
  assertEquals(wiredMcp(PROVIDERS.codex)?.configFile, ".codex/config.toml");
  assertEquals(providerFor("gemini")?.mcp.kind, "wired");
  assertEquals(wiredMcp(PROVIDERS.gemini)?.configFile, ".gemini/settings.json");
  assertEquals(providerFor("cursor")?.mcp.kind, "wired");
  assertEquals(wiredMcp(PROVIDERS.cursor)?.configFile, ".cursor/mcp.json");
  assertEquals(providerFor("copilot")?.mcp.kind, "wired");
  // Copilot co-owns Claude's .mcp.json — same file, byte-identical entry (ADR 0074).
  assertEquals(wiredMcp(PROVIDERS.copilot)?.configFile, ".mcp.json");

  // hook-stripping / the settings seam iterate exactly the providers that declare a
  // hook surface — now all five (Cursor + Copilot gained a SessionStart hook), in
  // registry order.
  assertEquals(providersWithHooks().map((p) => p.name), [
    "claude_code",
    "codex",
    "gemini",
    "cursor",
    "copilot",
  ]);

  // Only Codex co-manages app worktree lifecycle and project-rules files; every
  // other agent declares neither surface (skipped, never guessed).
  assertEquals(
    providerFor("codex")?.worktreeApp?.configFile,
    ".codex/environments/environment.toml",
  );
  assertEquals(
    providerFor("codex")?.projectRules?.rulesFile,
    ".codex/rules/discern.rules",
  );
  assertEquals(providerFor("claude_code")?.worktreeApp, undefined);
  assertEquals(providerFor("claude_code")?.projectRules, undefined);
  assertEquals(providerFor("gemini")?.worktreeApp, undefined);
  assertEquals(providerFor("gemini")?.projectRules, undefined);
  assertEquals(providerFor("cursor")?.worktreeApp, undefined);
  assertEquals(providerFor("cursor")?.projectRules, undefined);
  assertEquals(providerFor("copilot")?.worktreeApp, undefined);
  assertEquals(providerFor("copilot")?.projectRules, undefined);
});

Deno.test("Cursor & Copilot are reuse-canonical: read AGENTS.md natively, no duplicate provider file, share .agents/skills", () => {
  // Phase C's two cheap agents: instructions and skills reuse artifacts discern already
  // produces, so each is a registry declaration, not new machinery (ADR 0070).
  for (const name of ["cursor", "copilot"] as const) {
    const p = providerFor(name);
    assert(p !== undefined, `no provider for ${name}`);
    // Reuse-canonical: path names the canonical AGENTS.md it reads; discern emits
    // no provider-specific file (no duplicate body, no pointer).
    assertEquals(p.instructionFile.path, "AGENTS.md");
    assertEquals(p.instructionFile.canonical, false);
    assertEquals(p.instructionFile.reuseCanonical, true);
    assertEquals(p.instructionFile.pointer, undefined);
    // The shared cross-tool skills dir — deduped onto Codex's/Gemini's target.
    assertEquals(p.skillsDir?.path, ".agents/skills");
    // Committed MCP/hooks are inert until a one-time trust, and the action is named.
    assertEquals(p.trust.required, true);
    assert(p.trust.actions.length > 0, `${name}: trust must name an action`);
  }
  // A reuse-canonical provider leaks no duplicate AGENTS.md into the emitted set.
  const emitted = allInstructionFilePaths();
  assertEquals(emitted.filter((p) => p === "AGENTS.md").length, 1);
});

Deno.test("provider trust projections preserve typed future literals without prose parsing", () => {
  const trust = {
    required: true,
    explanation: "A synthetic provider keeps committed setup inactive.",
    actions: [{
      kind: "trust-directory" as const,
      instruction: "Enable the committed setup",
      facts: [
        { kind: "path" as const, value: ".future/settings.json" },
        { kind: "config-key" as const, value: "workspace.trust" },
        { kind: "config-value" as const, value: "enabled" },
        { kind: "flag" as const, value: "--future-trust" },
      ],
    }],
  };

  const data = providerTrustData("future", trust);
  assertEquals(data.provider, "future");
  assertEquals(data.actions[0]?.facts, trust.actions[0]?.facts);
  const markdown = renderProviderTrustMarkdown(trust);
  for (
    const literal of trust.actions[0]?.facts.map((fact) => fact.value) ?? []
  ) {
    assertStringIncludes(markdown, `\`${literal}\``);
  }
  assertStringIncludes(markdown, "key `workspace.trust` = `enabled`");
  assert(!markdown.includes(".codex/"));
});

Deno.test("every provider trust action declares typed literal facts", () => {
  for (const name of AGENT_NAMES) {
    const provider = providerFor(name);
    assert(provider !== undefined, `no provider for ${name}`);
    assert(provider.trust.actions.length > 0, `${name}: no trust actions`);
    for (const action of provider.trust.actions) {
      assert(
        action.instruction.trim().length > 0,
        `${name}: empty trust action`,
      );
      assert(
        action.facts.length > 0,
        `${name}: trust action has no typed facts`,
      );
      for (const fact of action.facts) {
        assert(
          fact.value.trim().length > 0,
          `${name}: empty ${fact.kind} fact`,
        );
      }
    }
  }
  const codexTrustPaths = PROVIDERS.codex.trust.actions.flatMap((action) =>
    action.facts.filter((fact) => fact.kind === "path").map((fact) =>
      fact.value
    )
  );
  assertEquals(codexTrustPaths.includes(".codex/"), false);
  assert(
    codexTrustPaths.includes("~/.codex/config.toml"),
    "Codex project trust belongs in the user-level config",
  );
});

Deno.test("wireProviderMcp writes .mcp.json + approval for Claude Code, idempotently", async () => {
  await withTempDir(async (dir) => {
    const first = await wireProviderMcp(dir, ["claude_code"]);
    assert(first.written.includes(".mcp.json"), first.written.join(","));
    assert(
      first.written.includes(".claude/settings.json"),
      first.written.join(","),
    );
    assert(first.firstInstall, "a fresh wire must report firstInstall");

    const mcp = decodeWith(
      McpConfigSchema,
      await Deno.readTextFile(join(dir, ".mcp.json")),
    );
    assertEquals(mcp.mcpServers.discern, {
      type: "stdio",
      command: "discern",
      args: ["mcp", MCP_LONG_TOOL_CALLS_FLAG],
      timeout: MCP_CONFIGURED_TOOL_TIMEOUT_SECONDS * 1000,
    });
    const settings = decodeWith(
      ClaudeSettingsSchema,
      await Deno.readTextFile(join(dir, ".claude/settings.json")),
    );
    assertEquals(settings.enabledMcpjsonServers, ["discern"]);

    // Idempotent: a second wiring writes nothing AND is not a first install (so
    // no restart hint fires on a re-apply).
    const second = await wireProviderMcp(dir, ["claude_code"]);
    assertEquals(second.written, []);
    assertEquals(second.firstInstall, false);
  });
});

Deno.test("the MCP preload experiment projects only configured providers' shared-entry fields", async () => {
  const variable = EXPERIMENTAL_ENVIRONMENT_VARIABLES.experimentalMcpPreload;
  const cases = [
    {
      agents: ["claude_code"],
      file: ".mcp.json",
      alwaysLoad: true,
      deferTools: undefined,
    },
    {
      agents: ["copilot"],
      file: ".mcp.json",
      alwaysLoad: undefined,
      deferTools: "never",
    },
    {
      agents: ["claude_code", "copilot"],
      file: ".mcp.json",
      alwaysLoad: true,
      deferTools: "never",
    },
    {
      agents: ["copilot", "claude_code"],
      file: ".mcp.json",
      alwaysLoad: true,
      deferTools: "never",
    },
    {
      agents: ["cursor"],
      file: ".cursor/mcp.json",
      alwaysLoad: undefined,
      deferTools: undefined,
    },
  ] as const;

  for (const testCase of cases) {
    await withTempDir(async (dir) => {
      const first = await wireProviderMcp(
        dir,
        testCase.agents,
        DISCERN_MCP_SERVER,
        parseConfigOrThrow(""),
        fakeEnv({ [variable]: "1" }),
      );
      assert(first.written.includes(testCase.file));
      let entry = decodeWith(
        McpConfigSchema,
        await Deno.readTextFile(join(dir, testCase.file)),
      ).mcpServers.discern;
      assertEquals(entry.alwaysLoad, testCase.alwaysLoad);
      assertEquals(entry.deferTools, testCase.deferTools);

      await wireProviderMcp(
        dir,
        testCase.agents,
        DISCERN_MCP_SERVER,
        parseConfigOrThrow(""),
        fakeEnv({ [variable]: "true" }),
      );
      entry = decodeWith(
        McpConfigSchema,
        await Deno.readTextFile(join(dir, testCase.file)),
      ).mcpServers.discern;
      assertEquals(entry.alwaysLoad, undefined);
      assertEquals(entry.deferTools, undefined);
    });
  }
});

Deno.test("wireProviderMcp MERGES into an existing .mcp.json, preserving other servers", async () => {
  await withTempDir(async (dir) => {
    // A project that already has its own MCP server configured.
    await Deno.writeTextFile(
      join(dir, ".mcp.json"),
      JSON.stringify(
        { mcpServers: { other: { type: "stdio", command: "other-tool" } } },
        null,
        2,
      ),
    );
    const r = await wireProviderMcp(dir, ["claude_code"]);
    // Adding discern next to an existing server is NOT a no-op, but the discern
    // name was absent → still a first install.
    assert(r.firstInstall, "discern was absent → firstInstall");
    const mcp = decodeWith(
      McpConfigSchema,
      await Deno.readTextFile(join(dir, ".mcp.json")),
    );
    assertEquals(mcp.mcpServers.other, {
      type: "stdio",
      command: "other-tool",
    }); // preserved
    assertEquals(mcp.mcpServers.discern.command, "discern"); // added
  });
});

Deno.test("wireProviderMcp refuses malformed co-owned JSON without overwriting it", async () => {
  const cases: Array<{ agent: typeof AGENT_NAMES[number]; rel: string }> = [];
  for (const agent of AGENT_NAMES) {
    const provider = PROVIDERS[agent];
    const mcp = wiredMcp(provider);
    if (mcp !== undefined && mcp.configFile.endsWith(".json")) {
      cases.push({ agent, rel: mcp.configFile });
    }
  }
  cases.push({
    agent: "claude_code",
    rel: PROVIDERS.claude_code.hooks?.settingsFile ?? ".claude/settings.json",
  });

  for (const { agent, rel } of cases) {
    await withTempDir(async (dir) => {
      const path = join(dir, rel);
      await Deno.mkdir(dirname(path), { recursive: true });
      const malformed = '{ "user": true, }\n';
      await Deno.writeTextFile(path, malformed);

      const error = await assertRejects(
        () => wireProviderMcp(dir, [agent]),
        Error,
        rel,
      );
      assertStringIncludes(error.message, "malformed JSON");
      assertEquals(await Deno.readTextFile(path), malformed);
    });
  }
});

Deno.test("wireProviderMcp preserves existing settings and unions the approval list", async () => {
  await withTempDir(async (dir) => {
    await Deno.mkdir(join(dir, ".claude"), { recursive: true });
    await Deno.writeTextFile(
      join(dir, ".claude/settings.json"),
      JSON.stringify(
        {
          permissions: { deny: ["Read(./.env)"] },
          enabledMcpjsonServers: ["other"],
        },
        null,
        2,
      ),
    );
    await wireProviderMcp(dir, ["claude_code"]);
    const settings = decodeWith(
      ClaudeSettingsSchema,
      await Deno.readTextFile(join(dir, ".claude/settings.json")),
    );
    assertExists(settings.permissions);
    assertEquals(settings.permissions.deny, ["Read(./.env)"]); // preserved
    assertEquals(settings.enabledMcpjsonServers, ["other", "discern"]); // unioned
  });
});

Deno.test("wireProviderMcp wires Gemini: mcpServers.discern into .gemini/settings.json (no type, no .mcp.json)", async () => {
  await withTempDir(async (dir) => {
    const first = await wireProviderMcp(dir, ["gemini"]);
    assertEquals(first.written, [".gemini/settings.json"]);
    assert(first.firstInstall, "a fresh Gemini wire must report firstInstall");

    const settings = decodeWith(
      GeminiSettingsSchema,
      await Deno.readTextFile(join(dir, ".gemini/settings.json")),
    );
    // Gemini infers stdio from `command` — no `type` field (unlike Claude's .mcp.json).
    assertEquals(settings.mcpServers.discern, {
      command: "discern",
      args: ["mcp", MCP_LONG_TOOL_CALLS_FLAG],
      timeout: MCP_CONFIGURED_TOOL_TIMEOUT_SECONDS * 1000,
    });
    // Gemini wires only its own file — never Claude's .mcp.json.
    await assertAbsent(join(dir, ".mcp.json"));

    // Idempotent: a second wire writes nothing and is not a first install.
    const second = await wireProviderMcp(dir, ["gemini"]);
    assertEquals(second.written, []);
    assertEquals(second.firstInstall, false);
  });
});

Deno.test("wireProviderMcp Gemini DEEP-MERGES, preserving the seeded hooks block and user servers", async () => {
  await withTempDir(async (dir) => {
    // A project whose .gemini/settings.json already carries the seeded SessionStart
    // hook (hooksConfig.enabled) AND a server the user added — both must survive.
    await Deno.mkdir(join(dir, ".gemini"), { recursive: true });
    await Deno.writeTextFile(
      join(dir, ".gemini/settings.json"),
      JSON.stringify({
        hooksConfig: { enabled: true },
        hooks: {
          SessionStart: [{
            matcher: "startup",
            hooks: [{ type: "command", command: "discern worktree ensure" }],
          }],
        },
        mcpServers: { other: { command: "other-tool" } },
      }),
    );
    const r = await wireProviderMcp(dir, ["gemini"]);
    assert(r.firstInstall, "discern was absent → firstInstall");
    const settings = decodeWith(
      GeminiSettingsSchema,
      await Deno.readTextFile(join(dir, ".gemini/settings.json")),
    );
    assertExists(settings.hooksConfig);
    assertEquals(settings.hooksConfig.enabled, true); // seeded hook preserved
    assertExists(settings.hooks);
    assertExists(settings.hooks.SessionStart);
    assertEquals(settings.hooks.SessionStart.length, 1);
    assertEquals(settings.mcpServers.other, { command: "other-tool" }); // preserved
    assertEquals(settings.mcpServers.discern.command, "discern"); // added
  });
});

Deno.test("wireProviderMcp wires Codex project config: MCP, headroom, and sibling-worktree writable root", async () => {
  await withTempDir(async (dir) => {
    // An existing config.toml with a comment AND another server — both must survive a
    // comment-preserving TOML merge (NOT a JSON rewrite).
    await Deno.mkdir(join(dir, ".codex"), { recursive: true });
    await Deno.writeTextFile(
      join(dir, ".codex/config.toml"),
      '# my codex config\n[mcp_servers.other]\ncommand = "other-tool"\n',
    );
    const first = await wireProviderMcp(dir, ["codex"]);
    assertEquals(first.written, [".codex/config.toml"]);
    assert(first.firstInstall, "discern's table was absent → firstInstall");

    const text = await Deno.readTextFile(join(dir, ".codex/config.toml"));
    assertStringIncludes(text, "# my codex config"); // comment preserved
    const parsed = parseToml(text) as {
      project_doc_max_bytes?: number;
      sandbox_workspace_write?: { writable_roots?: string[] };
      mcp_servers: {
        other?: { command?: string };
        discern?: {
          command?: string;
          args?: string[];
          startup_timeout_sec?: number;
          tool_timeout_sec?: number;
        };
      };
    };
    assertEquals(parsed.project_doc_max_bytes, 65536);
    assertEquals(parsed.sandbox_workspace_write?.writable_roots, [
      `../../${basename(dir)}.worktrees`,
    ]);
    assertEquals(
      parsed.sandbox_workspace_write?.writable_roots?.includes("../.."),
      false,
      "the writable root must never broaden to the repository parent",
    );
    assertEquals(parsed.mcp_servers.other?.command, "other-tool"); // preserved
    assertEquals(parsed.mcp_servers.discern?.command, "discern"); // added
    assertEquals(parsed.mcp_servers.discern?.args, [
      "mcp",
      MCP_LONG_TOOL_CALLS_FLAG,
    ]);
    assertEquals("cwd" in (parsed.mcp_servers.discern ?? {}), false);
    assertEquals(parsed.mcp_servers.discern?.startup_timeout_sec, 30);
    assertEquals(
      parsed.mcp_servers.discern?.tool_timeout_sec,
      MCP_CONFIGURED_TOOL_TIMEOUT_SECONDS,
    );

    // Idempotent: a second wire is a clean no-op (byte-identical TOML).
    const second = await wireProviderMcp(dir, ["codex"]);
    assertEquals(second.written, []);
    assertEquals(second.firstInstall, false);
  });
});

Deno.test("wireProviderMcp Codex removes a stale MCP cwd override", async () => {
  await withTempDir(async (dir) => {
    await Deno.mkdir(join(dir, ".codex"), { recursive: true });
    await Deno.writeTextFile(
      join(dir, ".codex/config.toml"),
      [
        "[mcp_servers.discern]",
        'cwd = ".."',
        'command = "discern"',
        'args = ["mcp"]',
        "",
      ].join("\n"),
    );

    const first = await wireProviderMcp(dir, ["codex"]);
    assertEquals(first.written, [".codex/config.toml"]);

    const parsed = parseToml(
      await Deno.readTextFile(join(dir, ".codex/config.toml")),
    ) as {
      mcp_servers: {
        discern?: Record<string, unknown>;
      };
    };
    assertEquals(parsed.mcp_servers.discern?.command, "discern");
    assertEquals(parsed.mcp_servers.discern?.args, [
      "mcp",
      MCP_LONG_TOOL_CALLS_FLAG,
    ]);
    assertEquals("cwd" in (parsed.mcp_servers.discern ?? {}), false);
  });
});

Deno.test("wireProviderMcp Codex preserves existing project-doc limit and merges writable roots", async () => {
  await withTempDir(async (dir) => {
    await Deno.mkdir(join(dir, ".codex"), { recursive: true });
    await Deno.writeTextFile(
      join(dir, ".codex/config.toml"),
      [
        "project_doc_max_bytes = 131072",
        "",
        "[sandbox_workspace_write]",
        "writable_roots = [",
        '  "../manual-worktrees",',
        "]",
        "",
        "[mcp_servers.other]",
        'command = "other-tool"',
        "",
      ].join("\n"),
    );

    const first = await wireProviderMcp(dir, ["codex"]);
    assertEquals(first.written, [".codex/config.toml"]);

    const parsed = parseToml(
      await Deno.readTextFile(join(dir, ".codex/config.toml")),
    ) as {
      project_doc_max_bytes?: number;
      sandbox_workspace_write?: { writable_roots?: string[] };
      mcp_servers: {
        other?: { command?: string };
        discern?: { command?: string };
      };
    };
    assertEquals(parsed.project_doc_max_bytes, 131072);
    assertEquals(parsed.sandbox_workspace_write?.writable_roots, [
      "../manual-worktrees",
      `../../${basename(dir)}.worktrees`,
    ]);
    assertEquals(parsed.mcp_servers.other?.command, "other-tool");
    assertEquals(parsed.mcp_servers.discern?.command, "discern");
  });
});

Deno.test("wireProviderMcp Codex derives writable roots from explicit relative and absolute [worktree].root", async () => {
  await withTempDir(async (relativeDir) => {
    const config = parseConfigOrThrow('[worktree]\nroot = "../wts"\n');
    await wireProviderMcp(relativeDir, ["codex"], DISCERN_MCP_SERVER, config);
    const parsed = parseToml(
      await Deno.readTextFile(join(relativeDir, ".codex/config.toml")),
    ) as { sandbox_workspace_write?: { writable_roots?: string[] } };
    assertEquals(parsed.sandbox_workspace_write?.writable_roots, ["../../wts"]);
  });

  await withTempDir(async (absoluteDir) => {
    const config = parseConfigOrThrow('[worktree]\nroot = "/srv/worktrees"\n');
    await wireProviderMcp(absoluteDir, ["codex"], DISCERN_MCP_SERVER, config);
    const parsed = parseToml(
      await Deno.readTextFile(join(absoluteDir, ".codex/config.toml")),
    ) as { sandbox_workspace_write?: { writable_roots?: string[] } };
    assertEquals(parsed.sandbox_workspace_write?.writable_roots, [
      "/srv/worktrees",
    ]);
  });
});

Deno.test("wireProviderMcp Codex uses the main checkout when refreshed from a linked worktree", async () => {
  await withTempDir(async (mainDir) => {
    await Deno.writeTextFile(join(mainDir, "discern.toml"), "");
    await gitInit(mainDir);
    const worktree = await addWorktree(mainDir, "codex-config");

    await wireProviderMcp(worktree, ["codex"]);
    const parsed = parseToml(
      await Deno.readTextFile(join(worktree, ".codex/config.toml")),
    ) as { sandbox_workspace_write?: { writable_roots?: string[] } };
    assertEquals(parsed.sandbox_workspace_write?.writable_roots, [
      `../../${basename(mainDir)}.worktrees`,
    ]);
  });
});

Deno.test("wireProviderWorktreeApp co-manages Codex environment.toml, preserving app keys, idempotently", async () => {
  await withTempDir(async (dir) => {
    // The Codex app autogenerates this file with its own keys — version/name and an
    // [[actions]] array-of-tables — which discern must preserve while owning only the
    // two `script` keys.
    await Deno.mkdir(join(dir, ".codex/environments"), { recursive: true });
    await Deno.writeTextFile(
      join(dir, ".codex/environments/environment.toml"),
      'version = 1\nname = "default"\n\n[[actions]]\nlabel = "lint"\n',
    );
    const first = await wireProviderWorktreeApp(dir, ["codex"]);
    assertEquals(first, [".codex/environments/environment.toml"]);

    const text = await Deno.readTextFile(
      join(dir, ".codex/environments/environment.toml"),
    );
    const parsed = parseToml(text) as {
      version: number;
      name: string;
      actions: { label: string }[];
      setup: { script: string };
      cleanup: { script: string };
    };
    // set-if-absent: discern seeds version/name only when ABSENT, so the app's own
    // values survive untouched (name stays "default", NOT clobbered to "Discern").
    assertEquals(parsed.version, 1); // app key preserved
    assertEquals(parsed.name, "default"); // app key preserved, not "Discern"
    assertEquals(parsed.actions, [{ label: "lint" }]); // app [[actions]] preserved
    assertEquals(parsed.setup.script, "discern worktree ensure");
    assertEquals(parsed.cleanup.script, "discern worktree teardown");

    // Idempotent: a second pass writes nothing.
    assertEquals(await wireProviderWorktreeApp(dir, ["codex"]), []);
  });
});

Deno.test("wireProviderWorktreeApp preserves user-customized Codex environment scripts", async () => {
  await withTempDir(async (dir) => {
    await Deno.mkdir(join(dir, ".codex/environments"), { recursive: true });
    await Deno.writeTextFile(
      join(dir, ".codex/environments/environment.toml"),
      'version = 1\nname = "custom"\n\n[setup]\nscript = "bin/setup-codex-env"\n\n[cleanup]\nscript = "bin/cleanup-codex-env"\n',
    );

    assertEquals(await wireProviderWorktreeApp(dir, ["codex"]), [
      ".codex/environments/environment.toml",
    ]);

    const text = await Deno.readTextFile(
      join(dir, ".codex/environments/environment.toml"),
    );
    assert(text.startsWith(
      `${
        generatedArtifactMarker(
          ARTIFACT_PROVENANCE_SOURCES.codexEnvironment,
        )
      }\n`,
    ));
    const parsed = parseToml(text) as {
      setup: { script: string };
      cleanup: { script: string };
    };
    assertEquals(parsed.setup.script, "bin/setup-codex-env");
    assertEquals(parsed.cleanup.script, "bin/cleanup-codex-env");
    assertEquals(await wireProviderWorktreeApp(dir, ["codex"]), []);
  });
});

Deno.test("wireProviderWorktreeApp fills missing Codex scripts without clobbering customized siblings", async () => {
  await withTempDir(async (dir) => {
    await Deno.mkdir(join(dir, ".codex/environments"), { recursive: true });
    await Deno.writeTextFile(
      join(dir, ".codex/environments/environment.toml"),
      'version = 1\nname = "custom"\n\n[setup]\nscript = "bin/setup-codex-env"\n',
    );

    assertEquals(await wireProviderWorktreeApp(dir, ["codex"]), [
      ".codex/environments/environment.toml",
    ]);

    const parsed = parseToml(
      await Deno.readTextFile(
        join(dir, ".codex/environments/environment.toml"),
      ),
    ) as {
      setup: { script: string };
      cleanup: { script: string };
    };
    assertEquals(parsed.setup.script, "bin/setup-codex-env");
    assertEquals(parsed.cleanup.script, "discern worktree teardown");
  });
});

Deno.test("wireProviderWorktreeApp creates a SCHEMA-VALID environment.toml when absent (version + name), and skips agents without one", async () => {
  await withTempDir(async (dir) => {
    // Absent file → created with discern's setup/cleanup AND the top-level keys
    // Codex's schema REQUIRES (version: number, name: string). Without these, Codex
    // rejects the file ("expected string, received undefined" at `name`), so seeding
    // them is the guard against that regression — a from-scratch file must validate.
    const config = parseConfigOrThrow(
      '[project]\nname = "Example Project"\nslug = "example"\n',
    );
    const wrote = await wireProviderWorktreeApp(
      dir,
      ["codex"],
      fakeEnv(),
      config,
    );
    assertEquals(wrote, [".codex/environments/environment.toml"]);
    const parsed = parseToml(
      await Deno.readTextFile(
        join(dir, ".codex/environments/environment.toml"),
      ),
    ) as {
      version: number;
      name: string;
      setup: { script: string };
      cleanup: { script: string };
    };
    assertEquals(parsed.version, 1);
    assertEquals(parsed.name, "Example Project");
    assertEquals(parsed.setup.script, "discern worktree ensure");
    assertEquals(parsed.cleanup.script, "discern worktree teardown");

    // Claude/Gemini declare no worktreeApp → nothing written, no file created.
    assertEquals(
      await wireProviderWorktreeApp(dir, ["claude_code", "gemini"]),
      [],
    );
  });
});

Deno.test("wireProviderProjectRules writes Codex discern.rules only, preserving user rules and staying idempotent", async () => {
  await withTempDir(async (dir) => {
    const userDefaultRules =
      '# user-owned rules\nprefix_rule(pattern = ["example"], decision = "ask")\n';
    await Deno.mkdir(join(dir, ".codex/rules"), { recursive: true });
    await Deno.writeTextFile(
      join(dir, ".codex/rules/default.rules"),
      userDefaultRules,
    );

    const first = await wireProviderProjectRules(dir, ["codex"]);
    assertEquals(first, [".codex/rules/discern.rules"]);

    const rules = await Deno.readTextFile(
      join(dir, ".codex/rules/discern.rules"),
    );
    assertEquals(rules, expectedCodexDiscernRules());
    // Structural exec-policy coverage without depending on the Codex CLI in unit tests:
    // exactly the two narrow prefixes are allowed, and no broader git/shell rule appears.
    assertEquals((rules.match(/prefix_rule/g) ?? []).length, 2);
    assertStringIncludes(rules, 'pattern = ["git", "add"]');
    assertStringIncludes(rules, 'pattern = ["git", "commit"]');
    assertStringIncludes(rules, 'decision = "allow"');
    assertStringIncludes(rules, "trusted Codex session");
    assertStringIncludes(rules, "no working-directory boundary");
    assertStringIncludes(rules, '"git push"');
    assertStringIncludes(rules, '"git reset --hard"');
    assertEquals(
      await Deno.readTextFile(join(dir, ".codex/rules/default.rules")),
      userDefaultRules,
    );

    const second = await wireProviderProjectRules(dir, ["codex"]);
    assertEquals(second, []);
  });

  await withTempDir(async (dir) => {
    const wrote = await wireProviderProjectRules(dir, [
      "claude_code",
      "gemini",
      "cursor",
      "copilot",
    ]);
    assertEquals(wrote, []);
    await assertAbsent(join(dir, ".codex/rules/discern.rules"));
  });
});

Deno.test("Codex integrations replace the opposite attribution mode", async () => {
  await withTempDir(async (dir) => {
    const attributedEnv = fakeEnv();
    const sourceOnlyEnv = fakeEnv({ [DISCERN_NO_ATTRIBUTION]: "1" });
    const config = parseConfigOrThrow('[project]\nagents = ["codex"]\n');

    await wireProviderMcp(
      dir,
      ["codex"],
      DISCERN_MCP_SERVER,
      config,
      attributedEnv,
    );
    await wireProviderWorktreeApp(dir, ["codex"], attributedEnv);
    await wireProviderProjectRules(dir, ["codex"], attributedEnv);

    await wireProviderMcp(
      dir,
      ["codex"],
      DISCERN_MCP_SERVER,
      config,
      sourceOnlyEnv,
    );
    await wireProviderWorktreeApp(dir, ["codex"], sourceOnlyEnv);
    await wireProviderProjectRules(dir, ["codex"], sourceOnlyEnv);

    for (
      const [path, source] of [
        [".codex/config.toml", ARTIFACT_PROVENANCE_SOURCES.codexConfig],
        [
          ".codex/environments/environment.toml",
          ARTIFACT_PROVENANCE_SOURCES.codexEnvironment,
        ],
        [".codex/rules/discern.rules", ARTIFACT_PROVENANCE_SOURCES.codexRules],
      ] as const
    ) {
      const text = await Deno.readTextFile(join(dir, path));
      const attributed = generatedArtifactMarker(source, attributedEnv);
      const sourceOnly = generatedArtifactMarker(source, sourceOnlyEnv);
      assert(!text.includes(attributed), `${path} kept attributed marker`);
      assertEquals(
        text.split(/\r?\n/u).filter((line) => line === sourceOnly).length,
        1,
        `${path} should carry one source-only marker`,
      );
    }
  });
});

Deno.test("wireProviderMcp wires Cursor: type:stdio mcpServers.discern into .cursor/mcp.json only", async () => {
  await withTempDir(async (dir) => {
    const first = await wireProviderMcp(dir, ["cursor"]);
    assertEquals(first.written, [".cursor/mcp.json"]);
    assert(first.firstInstall, "a fresh Cursor wire must report firstInstall");

    const mcp = decodeWith(
      McpConfigSchema,
      await Deno.readTextFile(join(dir, ".cursor/mcp.json")),
    );
    // Cursor requires an explicit type: "stdio" (unlike Gemini, which infers it).
    assertEquals(mcp.mcpServers.discern, {
      type: "stdio",
      command: "discern",
      args: ["mcp", MCP_STRICT_TOOL_CALLS_FLAG],
    });
    // Cursor wires only its own file — never Claude's .mcp.json or settings.
    await assertAbsent(join(dir, ".mcp.json"));
    await assertAbsent(join(dir, ".claude/settings.json"));

    // Idempotent: a second wire writes nothing and is not a first install.
    const second = await wireProviderMcp(dir, ["cursor"]);
    assertEquals(second.written, []);
    assertEquals(second.firstInstall, false);
  });
});

Deno.test("wireProviderMcp Cursor MERGES into an existing .cursor/mcp.json, preserving servers + keys", async () => {
  await withTempDir(async (dir) => {
    await Deno.mkdir(join(dir, ".cursor"), { recursive: true });
    await Deno.writeTextFile(
      join(dir, ".cursor/mcp.json"),
      JSON.stringify(
        {
          mcpServers: { other: { type: "stdio", command: "other-tool" } },
          someTopLevelKey: true,
        },
        null,
        2,
      ),
    );
    const r = await wireProviderMcp(dir, ["cursor"]);
    assert(r.firstInstall, "discern was absent → firstInstall");
    const mcp = decodeWith(
      McpConfigSchema,
      await Deno.readTextFile(join(dir, ".cursor/mcp.json")),
    );
    assertEquals(mcp.mcpServers.other, {
      type: "stdio",
      command: "other-tool",
    }); // preserved
    assertEquals(mcp.someTopLevelKey, true); // preserved
    assertEquals(mcp.mcpServers.discern.command, "discern"); // added
  });
});

Deno.test("wireProviderMcp wires Copilot: into .mcp.json with NO enabledMcpjsonServers (folder-trust gated)", async () => {
  await withTempDir(async (dir) => {
    const first = await wireProviderMcp(dir, ["copilot"]);
    assertEquals(first.written, [".mcp.json"]);
    assert(first.firstInstall, "a fresh Copilot wire must report firstInstall");

    const mcp = decodeWith(
      McpConfigSchema,
      await Deno.readTextFile(join(dir, ".mcp.json")),
    );
    assertEquals(mcp.mcpServers.discern, {
      type: "stdio",
      command: "discern",
      args: ["mcp", MCP_LONG_TOOL_CALLS_FLAG],
      timeout: MCP_CONFIGURED_TOOL_TIMEOUT_SECONDS * 1000,
    });
    // Copilot gates via folder trust, NOT enabledMcpjsonServers — so it never writes
    // Claude's settings file (unlike registerClaudeCodeMcp).
    await assertAbsent(join(dir, ".claude/settings.json"));

    // Idempotent: a second wire writes nothing and is not a first install.
    const second = await wireProviderMcp(dir, ["copilot"]);
    assertEquals(second.written, []);
    assertEquals(second.firstInstall, false);
  });
});

Deno.test("Copilot co-owns Claude's .mcp.json: one byte-identical entry, order-independent, re-wire a no-op", async () => {
  // Both write the discern stdio entry into the SAME .mcp.json via the shared writer
  // (ADR 0074), so whichever runs second finds it already correct and writes nothing —
  // and the file carries exactly one entry regardless of order.
  for (
    const order of [
      ["claude_code", "copilot"],
      ["copilot", "claude_code"],
    ] as const
  ) {
    await withTempDir(async (dir) => {
      const r = await wireProviderMcp(dir, order);
      assert(r.firstInstall, "the server was newly added → firstInstall");

      const mcp = decodeWith(
        McpConfigSchema,
        await Deno.readTextFile(join(dir, ".mcp.json")),
      );
      // Exactly one discern entry, byte-identical to the shared shape.
      assertEquals(Object.keys(mcp.mcpServers), ["discern"]);
      assertEquals(mcp.mcpServers.discern, {
        type: "stdio",
        command: "discern",
        args: ["mcp", MCP_LONG_TOOL_CALLS_FLAG],
        timeout: MCP_CONFIGURED_TOOL_TIMEOUT_SECONDS * 1000,
      });
      // Claude (in either order) still pre-approves the server; Copilot adds no
      // second registration.
      const settings = decodeWith(
        ClaudeSettingsSchema,
        await Deno.readTextFile(join(dir, ".claude/settings.json")),
      );
      assertEquals(settings.enabledMcpjsonServers, ["discern"]);

      // A full re-wire of both providers is a clean no-op.
      const again = await wireProviderMcp(dir, order);
      assertEquals(again.written, []);
      assertEquals(again.firstInstall, false);
    });
  }
});

// ── the wired-writer invariant, swept from the registry ─────────────────────
// Every provider whose MCP status is `wired` promises the same two properties,
// whatever its config format: the writer is IDEMPOTENT (a re-wire writes
// nothing and leaves every written file byte-identical) and MERGE-PRESERVING
// (pre-existing user servers and keys survive the wire). The per-provider tests
// above prove each format's specifics; this sweep proves the shared invariant
// over AGENT_NAMES × PROVIDERS filtered to `wired`, so a NEW wired provider
// enrols the moment it joins the registry — it cannot ship with zero coverage
// of exactly this property.

/**
 * The minimal wired-writer surface the invariant checks. Structural on purpose:
 * the registry sweep builds probes from `wiredMcp`, and the future-sibling
 * fixtures below build broken ones under unrelated names — proving the detector
 * rejects the defect mechanism itself, not a list of known providers.
 */
interface WiredWriterProbe {
  readonly name: string;
  readonly configFile: string;
  register(root: string): Promise<McpWireResult>;
}

/** One probe per registry provider with `mcp.kind === "wired"`, wired with the
 * same defaults `wireProviderMcp` uses. */
function registryWiredProbes(): WiredWriterProbe[] {
  const probes: WiredWriterProbe[] = [];
  for (const agent of AGENT_NAMES) {
    const mcp = wiredMcp(PROVIDERS[agent]);
    if (mcp !== undefined) {
      probes.push({
        name: agent,
        configFile: mcp.configFile,
        register: (root) =>
          mcp.register(root, DISCERN_MCP_SERVER, parseConfigOrThrow(""), {
            agents: [agent],
            experimentalMcpPreload: false,
            env: fakeEnv(),
          }),
      });
    }
  }
  return probes;
}

/** Markers planted in the foreign seed; each must survive the wire verbatim. */
const FOREIGN_MARKERS = ["zz-pre-existing-tool", "zz-pre-existing-value"];

/**
 * Pre-existing user content for a provider's config file — a foreign server plus
 * a foreign top-level key, in the file's own format. The survival check is
 * format-agnostic (a raw-text substring per marker), so only the seed needs to
 * know the syntax. A provider adopting a NEW format fails loudly here rather
 * than silently skipping the merge invariant.
 */
function foreignSeed(configFile: string): string {
  if (configFile.endsWith(".json")) {
    return `${
      JSON.stringify(
        {
          mcpServers: {
            "zz-pre-existing": { command: "zz-pre-existing-tool" },
          },
          zzPreExistingUserKey: "zz-pre-existing-value",
        },
        null,
        2,
      )
    }\n`;
  }
  if (configFile.endsWith(".toml")) {
    return [
      'zz_pre_existing_user_key = "zz-pre-existing-value"',
      "",
      "[mcp_servers.zz-pre-existing]",
      'command = "zz-pre-existing-tool"',
      "",
    ].join("\n");
  }
  throw new Error(
    `no foreign seed for ${configFile}: teach foreignSeed this config format so the new provider's merge invariant is exercised`,
  );
}

/**
 * The detector: every violation of the wired-writer invariant for one probe
 * (empty means clean). Returned rather than asserted so the future-sibling
 * tests below can prove it REJECTS a broken writer, not just that the current
 * registry passes it.
 */
async function wiredWriterViolations(
  probe: WiredWriterProbe,
): Promise<string[]> {
  const violations: string[] = [];

  // Idempotence: wire twice into a fresh root. The re-wire must write nothing,
  // never re-report a first install, and leave every file the first wire wrote
  // byte-identical.
  await withTempDir(async (dir) => {
    const first = await probe.register(dir);
    if (!first.written.includes(probe.configFile)) {
      violations.push(
        `${probe.name}: a fresh wire must write ${probe.configFile} (wrote: ${
          first.written.join(", ") || "nothing"
        })`,
      );
      return;
    }
    if (!first.firstInstall) {
      violations.push(`${probe.name}: a fresh wire must report firstInstall`);
    }
    const before = new Map<string, string>();
    for (const rel of first.written) {
      before.set(rel, await Deno.readTextFile(join(dir, rel)));
    }
    const second = await probe.register(dir);
    if (second.written.length > 0) {
      violations.push(
        `${probe.name}: a re-wire must write nothing (wrote: ${
          second.written.join(", ")
        })`,
      );
    }
    if (second.firstInstall) {
      violations.push(`${probe.name}: a re-wire must not report firstInstall`);
    }
    for (const [rel, text] of before) {
      const after = await readTextIfExists(join(dir, rel));
      if (after !== text) {
        violations.push(
          `${probe.name}: re-wiring changed ${rel} — the writer must be byte-stable`,
        );
      }
    }
  });

  // Merge preservation: wire over a config file that already carries a foreign
  // server and a foreign user key. Both must survive verbatim, alongside the
  // newly added discern entry.
  await withTempDir(async (dir) => {
    const path = join(dir, probe.configFile);
    await Deno.mkdir(dirname(path), { recursive: true });
    await Deno.writeTextFile(path, foreignSeed(probe.configFile));
    const wired = await probe.register(dir);
    if (!wired.firstInstall) {
      violations.push(
        `${probe.name}: discern was absent from the seeded file, so wiring it must report firstInstall`,
      );
    }
    const text = await Deno.readTextFile(path);
    for (const marker of FOREIGN_MARKERS) {
      if (!text.includes(marker)) {
        violations.push(
          `${probe.name}: wiring dropped pre-existing user content ("${marker}") from ${probe.configFile}`,
        );
      }
    }
    if (!text.includes(DISCERN_MCP_SERVER.name)) {
      violations.push(
        `${probe.name}: wiring over a seeded file must still add the ${DISCERN_MCP_SERVER.name} server`,
      );
    }
  });

  return violations;
}

Deno.test("every wired provider's MCP writer is idempotent and merge-preserving (registry sweep)", async () => {
  const probes = registryWiredProbes();
  // Never a vacuous sweep: the registry currently wires every provider (the
  // typed-status test above pins the exact set).
  assert(
    probes.length > 0,
    "no wired providers — the sweep would prove nothing",
  );
  for (const probe of probes) {
    assertEquals(
      await wiredWriterViolations(probe),
      [],
      `wired-writer invariant violated for ${probe.name}`,
    );
  }
});

Deno.test("the wired-writer detector rejects a non-idempotent future provider (unrelated names)", async () => {
  // Adversarial future sibling: a writer under fresh names that appends a new
  // entry on every run, so it never converges. The detector must flag it with
  // no registry membership and no case-table edit.
  let runs = 0;
  const rel = ".zz-future/config.json";
  const probe: WiredWriterProbe = {
    name: "zz-future-agent",
    configFile: rel,
    register: async (root) => {
      runs++;
      const path = join(root, rel);
      await Deno.mkdir(dirname(path), { recursive: true });
      const existing = (await readTextIfExists(path)) ?? "{}";
      const doc = decodeWith(DynamicServerMapSchema, existing);
      doc[`discern-run-${runs}`] = { command: "discern" };
      await Deno.writeTextFile(path, JSON.stringify(doc, null, 2));
      return { written: [rel], firstInstall: runs === 1 };
    },
  };
  const violations = await wiredWriterViolations(probe);
  assert(
    violations.some((v) => v.includes("byte-stable")),
    `the detector must flag the non-idempotent writer; got:\n${
      violations.join("\n")
    }`,
  );
});

Deno.test("the wired-writer detector rejects a clobbering future provider (unrelated names)", async () => {
  // Adversarial future sibling: a writer that rewrites its file from scratch —
  // perfectly idempotent, but it drops pre-existing user content. Only the
  // merge-preservation check can catch it, proving the two checks discriminate.
  const rel = ".zz-future/config.json";
  const desired = `${
    JSON.stringify({ mcpServers: { discern: { command: "discern" } } }, null, 2)
  }\n`;
  const probe: WiredWriterProbe = {
    name: "zz-future-agent",
    configFile: rel,
    register: async (root) => {
      const path = join(root, rel);
      await Deno.mkdir(dirname(path), { recursive: true });
      const existing = await readTextIfExists(path);
      if (existing === desired) {
        return { written: [], firstInstall: false };
      }
      await Deno.writeTextFile(path, desired);
      return { written: [rel], firstInstall: existing === undefined };
    },
  };
  const violations = await wiredWriterViolations(probe);
  assert(
    violations.some((v) => v.includes("pre-existing user content")),
    `the detector must flag the clobbering writer; got:\n${
      violations.join("\n")
    }`,
  );
  assert(
    !violations.some((v) => v.includes("byte-stable")),
    `the clobbering writer is idempotent — only the merge check should fire; got:\n${
      violations.join("\n")
    }`,
  );
});

/** Assert a path does not exist on disk. */
async function assertAbsent(path: string): Promise<void> {
  let present = true;
  try {
    await Deno.stat(path);
  } catch {
    present = false;
  }
  assert(!present, `expected ${path} to be absent`);
}

/** Render the exact generated Codex sandbox rules that linked-worktree Git operations require. */
function expectedCodexDiscernRules(env: EnvReader = fakeEnv()): string {
  return `${
    generatedArtifactMarker(ARTIFACT_PROVENANCE_SOURCES.codexRules, env)
  }
# Put user-owned Codex rules in a separate .codex/rules/*.rules file.

prefix_rule(
    pattern = ["git", "add"],
    decision = "allow",
    justification = "Allow the git add command prefix in a trusted Codex session; this grant has no working-directory boundary.",
    match = [
        "git add -A",
        "git add src/example.ts",
    ],
    not_match = [
        "git status",
        "git push",
        "git reset --hard",
    ],
)

prefix_rule(
    pattern = ["git", "commit"],
    decision = "allow",
    justification = "Allow the git commit command prefix in a trusted Codex session; this grant has no working-directory boundary.",
    match = [
        "git commit -m Example",
        "git commit --amend --no-edit",
        "git commit --no-verify -m Example",
    ],
    not_match = [
        "git status",
        "git push",
        "git reset --hard",
    ],
)
`;
}
