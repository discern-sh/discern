/**
 * Phase B end-to-end wiring: the Gemini + Codex MCP / hooks / worktree-lifecycle
 * surfaces, exercised through the REAL scaffold + refresh path (the bytes a real
 * install ships), not unit calls. The unit-level idempotency/merge proofs live in
 * `providers_test.ts`; these prove the seam composes once routed through
 * `assembleInitPlan` (seeds) + `discern refresh` (MCP + worktree-app wiring).
 *
 * The decisive Gemini check: the SEED (hooksConfig.enabled + SessionStart) and the
 * `register()` MCP entry (mcpServers.discern) land in the ONE `.gemini/settings.json`,
 * deep-merged — neither clobbers the other, and a user key survives both.
 */

import {
  assert,
  assertEquals,
  assertExists,
  assertStringIncludes,
} from "@std/assert";
import { z } from "@zod/zod";
import { basename, join } from "@std/path";
import { parse as parseToml } from "@std/toml";
import { targetExists } from "../src/shared/fs_presence.ts";
import { REAL_TEMPLATES, withTempDir } from "./helpers.ts";
import { runAgent, scaffoldEngine } from "./engine_helpers.ts";
import { assembleInitPlan } from "../src/commands/setup.ts";
import {
  providerSessionHookCommand,
  providersWithHooks,
} from "../src/lib/providers.ts";
import type { AgentName } from "../src/lib/config.ts";
import {
  MCP_CONFIGURED_TOOL_TIMEOUT_SECONDS,
  MCP_LONG_TOOL_CALLS_FLAG,
  MCP_STRICT_TOOL_CALLS_FLAG,
} from "../src/shared/mcp_timeout_policy.ts";
import { EXPERIMENTAL_ENVIRONMENT_VARIABLES } from "../src/shared/experimental.ts";
import {
  assertResultDataKey,
  decodeCliResult,
  decodeWith,
} from "./decode_cli_result.ts";

const CommandHookSchema = z.object({ command: z.string() });
const GeminiSettingsSchema = z.object({
  hooksConfig: z.object({ enabled: z.boolean() }).optional(),
  hooks: z.object({
    enabled: z.boolean().optional(),
    SessionStart: z.array(z.object({
      matcher: z.string(),
      hooks: z.array(CommandHookSchema).nonempty(),
    })).nonempty(),
  }),
  mcpServers: z.object({
    discern: z.object({
      command: z.string(),
      args: z.array(z.string()),
      timeout: z.number(),
    }),
  }).optional(),
  telemetry: z.object({ enabled: z.boolean() }).optional(),
});
const CodexHooksSchema = z.object({
  hooks: z.object({
    SessionStart: z.array(z.object({
      matcher: z.string(),
      hooks: z.array(CommandHookSchema).nonempty(),
    })).nonempty(),
  }),
});
const ProviderSettingsSchema = z.object({
  hooks: z.record(
    z.string(),
    z.array(z.union([
      z.object({
        matcher: z.string().optional(),
        hooks: z.array(z.object({
          type: z.string().optional(),
          command: z.string().optional(),
          bash: z.string().optional(),
          timeout: z.number().optional(),
          timeoutSec: z.number().optional(),
        })),
      }),
      z.object({ command: z.string() }),
      z.object({
        type: z.string(),
        bash: z.string(),
        timeoutSec: z.number().optional(),
      }),
    ])),
  ).optional(),
  userPreserved: z.string().optional(),
}).passthrough();
const CursorHooksSchema = z.object({
  hooks: z.object({
    sessionStart: z.array(CommandHookSchema).nonempty(),
  }),
});
const CopilotHooksSchema = z.object({
  hooks: z.object({
    sessionStart: z.array(z.object({ bash: z.string() })).nonempty(),
  }),
});
const McpSettingsSchema = z.object({
  mcpServers: z.object({
    discern: z.object({
      type: z.string().optional(),
      command: z.string(),
      args: z.array(z.string()),
      timeout: z.number().optional(),
      alwaysLoad: z.boolean().optional(),
      deferTools: z.string().optional(),
    }),
  }),
});

Deno.test("Gemini: the registry-rendered SessionStart seed and MCP registration compose in one settings file", async () => {
  await withTempDir(async (dir) => {
    // Gemini is configured, so its per-agent seed (.gemini/settings.json) is laid.
    await scaffoldEngine(dir, { agents: ["claude_code", "gemini"] });

    // Current Gemini enables hooks by default. The seed therefore needs only the
    // startup/resume SessionStart command and no parallel enablement setting.
    const seeded = decodeWith(
      GeminiSettingsSchema,
      await Deno.readTextFile(join(dir, ".gemini/settings.json")),
    );
    assertEquals(seeded.hooksConfig, undefined);
    assertEquals(seeded.hooks.enabled, undefined); // never a boolean under hooks
    assertEquals(
      seeded.hooks.SessionStart.map((group) => group.matcher),
      ["startup", "resume"],
    );
    const seededSessionStart = seeded.hooks.SessionStart[0];
    assertExists(seededSessionStart);
    const seededHook = seededSessionStart.hooks[0];
    assertExists(seededHook);
    assertEquals(
      seededHook.command,
      "discern worktree ensure",
    );
    assertEquals(seeded.mcpServers, undefined); // register() adds this, not the seed

    // A user key the team added by hand — must survive the MCP merge.
    seeded.telemetry = { enabled: false };
    await Deno.writeTextFile(
      join(dir, ".gemini/settings.json"),
      JSON.stringify(seeded, null, 2),
    );

    // refresh wires the MCP server INTO the same file (deep-merge, no clobber).
    const r = await runAgent(dir, ["refresh", "--json"]);
    assertEquals(r.code, 0, r.output);
    const refreshed = decodeCliResult(r.stdout, "refresh");
    assertResultDataKey(refreshed, "mcp_wired");
    const data = refreshed.data;
    assert(
      data.mcp_wired.includes(".gemini/settings.json"),
      `expected .gemini/settings.json in mcp_wired: ${r.stdout}`,
    );

    const merged = decodeWith(
      GeminiSettingsSchema,
      await Deno.readTextFile(join(dir, ".gemini/settings.json")),
    );
    assert(merged.mcpServers !== undefined);
    // All three coexist: the seeded hooks, the MCP server, and the user key.
    assertEquals(merged.hooksConfig, undefined);
    assertEquals(
      merged.hooks.SessionStart.map((group) => group.matcher),
      ["startup", "resume"],
    );
    const mergedSessionStart = merged.hooks.SessionStart[0];
    assertExists(mergedSessionStart);
    const mergedHook = mergedSessionStart.hooks[0];
    assertExists(mergedHook);
    assertEquals(
      mergedHook.command,
      "discern worktree ensure",
    );
    assertEquals(merged.mcpServers.discern, {
      command: "discern",
      args: ["mcp", MCP_LONG_TOOL_CALLS_FLAG],
      timeout: MCP_CONFIGURED_TOOL_TIMEOUT_SECONDS * 1000,
    });
    assertEquals(merged.telemetry, { enabled: false }); // user key preserved

    // Idempotent: a second refresh re-wires nothing for Gemini.
    const r2 = await runAgent(dir, ["refresh", "--json"]);
    const unchanged = decodeCliResult(r2.stdout, "refresh");
    assertResultDataKey(unchanged, "mcp_wired");
    assertEquals(
      unchanged.data.mcp_wired.includes(".gemini/settings.json"),
      false,
    );
  });
});

Deno.test("Codex: refresh wires .codex/config.toml (MCP) and co-manages environment.toml ([setup]/[cleanup]), idempotently", async () => {
  await withTempDir(async (dir) => {
    await scaffoldEngine(dir, { agents: ["claude_code", "codex"] });

    // The scaffold seeded the SessionStart hook into .codex/hooks.json.
    const hooks = decodeWith(
      CodexHooksSchema,
      await Deno.readTextFile(join(dir, ".codex/hooks.json")),
    );
    const sessionStart = hooks.hooks.SessionStart[0];
    assertExists(sessionStart);
    const sessionHook = sessionStart.hooks[0];
    assertExists(sessionHook);
    assertEquals(sessionStart.matcher, "startup|resume");
    assertEquals(
      sessionHook.command,
      "discern worktree ensure",
    );

    // refresh wires the MCP server (TOML) and the app worktree-lifecycle file.
    const r = await runAgent(dir, ["refresh", "--json"]);
    assertEquals(r.code, 0, r.output);
    const refreshed = decodeCliResult(r.stdout, "refresh");
    assertResultDataKey(refreshed, "mcp_wired");
    const data = refreshed.data;
    assert(
      data.mcp_wired.includes(".codex/config.toml"),
      `expected .codex/config.toml in mcp_wired: ${r.stdout}`,
    );
    assertEquals(data.worktree_app_wired, [
      ".codex/environments/environment.toml",
    ]);
    assertEquals(data.project_rules_wired, [".codex/rules/discern.rules"]);

    // The Codex project config carries discern's MCP server, instruction headroom,
    // and the writable root for the sibling worktree directory.
    const cfg = parseToml(
      await Deno.readTextFile(join(dir, ".codex/config.toml")),
    ) as {
      project_doc_max_bytes?: number;
      sandbox_workspace_write?: { writable_roots?: string[] };
      mcp_servers: {
        discern?: {
          command?: string;
          args?: string[];
          startup_timeout_sec?: number;
          tool_timeout_sec?: number;
        };
      };
    };
    assertEquals(cfg.project_doc_max_bytes, 65536);
    assertEquals(cfg.sandbox_workspace_write?.writable_roots, [
      `../../${basename(dir)}.worktrees`,
    ]);
    assertEquals(cfg.mcp_servers.discern?.command, "discern");
    assertEquals(cfg.mcp_servers.discern?.args, [
      "mcp",
      MCP_LONG_TOOL_CALLS_FLAG,
    ]);
    assertEquals("cwd" in (cfg.mcp_servers.discern ?? {}), false);
    assertEquals(cfg.mcp_servers.discern?.startup_timeout_sec, 30);
    assertEquals(
      cfg.mcp_servers.discern?.tool_timeout_sec,
      MCP_CONFIGURED_TOOL_TIMEOUT_SECONDS,
    );

    // The app's environment.toml carries discern's setup + cleanup scripts AND the
    // top-level version/name Codex's schema requires (so a from-scratch file validates).
    const env = parseToml(
      await Deno.readTextFile(
        join(dir, ".codex/environments/environment.toml"),
      ),
    ) as {
      version: number;
      name: string;
      setup: { script: string };
      cleanup: { script: string };
    };
    assertEquals(env.version, 1);
    assertEquals(env.name, "Engine Test");
    assertEquals(env.setup.script, "discern worktree ensure");
    assertEquals(env.cleanup.script, "discern worktree teardown");

    const rules = await Deno.readTextFile(
      join(dir, ".codex/rules/discern.rules"),
    );
    assertStringIncludes(rules, 'pattern = ["git", "add"]');
    assertStringIncludes(rules, 'pattern = ["git", "commit"]');
    assertStringIncludes(rules, "trusted Codex session");
    assertStringIncludes(rules, "no working-directory boundary");
    assertStringIncludes(rules, '"git push"');
    assertEquals((rules.match(/decision = "allow"/g) ?? []).length, 2);

    // Idempotent: a second refresh re-wires neither the MCP nor the env file.
    const r2 = await runAgent(dir, ["refresh", "--json"]);
    const unchanged = decodeCliResult(r2.stdout, "refresh");
    assertResultDataKey(unchanged, "mcp_wired");
    const data2 = unchanged.data;
    assertEquals(data2.mcp_wired.includes(".codex/config.toml"), false);
    assertEquals(data2.worktree_app_wired, []);
    assertEquals(data2.project_rules_wired, []);
  });
});

Deno.test("refresh re-seeds missing provider hook files for every configured hooks provider", async () => {
  await withTempDir(async (dir) => {
    const hookProviders = providersWithHooks();
    const agents = hookProviders.map((p) => p.name as AgentName);
    await scaffoldEngine(dir, { agents });
    const hookFiles = [
      ...new Set(
        hookProviders.flatMap((p) =>
          p.hooks === undefined ? [] : [p.hooks.settingsFile]
        ),
      ),
    ].sort();

    for (const file of hookFiles) {
      await Deno.remove(join(dir, file));
    }

    const r = await runAgent(dir, ["refresh", "--json"]);
    assertEquals(r.code, 0, r.output);
    const refreshed = decodeCliResult(r.stdout, "refresh");
    assertResultDataKey(refreshed, "hooks_wired");
    const data = refreshed.data;
    assertEquals([...data.hooks_wired].sort(), hookFiles);

    for (const provider of hookProviders) {
      const hooks = provider.hooks;
      assert(hooks !== undefined);
      const body = await Deno.readTextFile(join(dir, hooks.settingsFile));
      assertStringIncludes(body, providerSessionHookCommand(hooks));
    }

    const second = await runAgent(dir, ["refresh", "--json"]);
    assertEquals(second.code, 0, second.output);
    const unchanged = decodeCliResult(second.stdout, "refresh");
    assertResultDataKey(unchanged, "hooks_wired");
    assertEquals(unchanged.data.hooks_wired, []);
  });
});

Deno.test("refresh re-seeds provider hooks without clobbering user settings", async () => {
  await withTempDir(async (dir) => {
    const hookProviders = providersWithHooks();
    const agents = hookProviders.map((p) => p.name as AgentName);
    await scaffoldEngine(dir, { agents });
    const hookFiles = [
      ...new Set(
        hookProviders.flatMap((p) =>
          p.hooks === undefined ? [] : [p.hooks.settingsFile]
        ),
      ),
    ].sort();

    for (const provider of hookProviders) {
      const hooks = provider.hooks;
      assert(hooks !== undefined);
      const path = join(dir, hooks.settingsFile);
      const settings = decodeWith(
        ProviderSettingsSchema,
        await Deno.readTextFile(path),
      );
      delete settings.hooks;
      settings.userPreserved = provider.name;
      await Deno.writeTextFile(path, `${JSON.stringify(settings, null, 2)}\n`);
    }

    const r = await runAgent(dir, ["refresh", "--json"]);
    assertEquals(r.code, 0, r.output);
    const refreshed = decodeCliResult(r.stdout, "refresh");
    assertResultDataKey(refreshed, "hooks_wired");
    const data = refreshed.data;
    assertEquals([...data.hooks_wired].sort(), hookFiles);

    for (const provider of hookProviders) {
      const hooks = provider.hooks;
      assert(hooks !== undefined);
      const body = await Deno.readTextFile(join(dir, hooks.settingsFile));
      const settings = decodeWith(ProviderSettingsSchema, body);
      assertEquals(settings.userPreserved, provider.name);
      assertStringIncludes(body, providerSessionHookCommand(hooks));
    }
  });
});

Deno.test("Cursor + Copilot: scaffold seeds each SessionStart hook; refresh wires .cursor/mcp.json and the co-owned .mcp.json", async () => {
  await withTempDir(async (dir) => {
    await scaffoldEngine(dir, { agents: ["cursor", "copilot"] });

    // The scaffold seeded each vendor's SessionStart hook in its own shape — Cursor's
    // flat `{ command }`, Copilot's `{ type, bash }` — both running worktree ensure.
    const cursorHooks = decodeWith(
      CursorHooksSchema,
      await Deno.readTextFile(join(dir, ".cursor/hooks.json")),
    );
    const cursorSessionStart = cursorHooks.hooks.sessionStart[0];
    assertExists(cursorSessionStart);
    assertEquals(
      cursorSessionStart.command,
      "discern worktree ensure",
    );
    const copilotHooks = decodeWith(
      CopilotHooksSchema,
      await Deno.readTextFile(join(dir, ".github/hooks/discern.json")),
    );
    const copilotSessionStart = copilotHooks.hooks.sessionStart[0];
    assertExists(copilotSessionStart);
    assertEquals(
      copilotSessionStart.bash,
      "discern worktree ensure",
    );

    // refresh wires Cursor's own .cursor/mcp.json and Copilot's co-owned .mcp.json.
    const r = await runAgent(dir, ["refresh", "--json"]);
    assertEquals(r.code, 0, r.output);
    const refreshed = decodeCliResult(r.stdout, "refresh");
    assertResultDataKey(refreshed, "mcp_wired");
    const data = refreshed.data;
    assert(
      data.mcp_wired.includes(".cursor/mcp.json"),
      `expected .cursor/mcp.json in mcp_wired: ${r.stdout}`,
    );
    assert(
      data.mcp_wired.includes(".mcp.json"),
      `expected .mcp.json in mcp_wired: ${r.stdout}`,
    );

    // Both carry the byte-identical stdio entry (Cursor requires the explicit type).
    const cursorMcp = decodeWith(
      McpSettingsSchema,
      await Deno.readTextFile(join(dir, ".cursor/mcp.json")),
    );
    assertEquals(cursorMcp.mcpServers.discern, {
      type: "stdio",
      command: "discern",
      args: ["mcp", MCP_STRICT_TOOL_CALLS_FLAG],
    });
    const sharedMcp = decodeWith(
      McpSettingsSchema,
      await Deno.readTextFile(join(dir, ".mcp.json")),
    );
    assertEquals(sharedMcp.mcpServers.discern, {
      type: "stdio",
      command: "discern",
      args: ["mcp", MCP_LONG_TOOL_CALLS_FLAG],
      timeout: MCP_CONFIGURED_TOOL_TIMEOUT_SECONDS * 1000,
    });
    // Claude is not a configured agent here, so no Claude file is seeded at all — an
    // unconfigured agent leaves no inert dotfiles behind (the per-agent seed filter).
    assert(
      !(await targetExists(join(dir, ".claude/settings.json"))),
      "an unconfigured agent (claude) must not get a seeded settings file",
    );

    // Idempotent: a second refresh re-wires neither file.
    const r2 = await runAgent(dir, ["refresh", "--json"]);
    const unchanged = decodeCliResult(r2.stdout, "refresh");
    assertResultDataKey(unchanged, "mcp_wired");
    const data2 = unchanged.data;
    assertEquals(data2.mcp_wired.includes(".cursor/mcp.json"), false);
    assertEquals(data2.mcp_wired.includes(".mcp.json"), false);
  });
});

Deno.test("Cursor-only refresh emits AGENTS.md with the compiled instruction body", async () => {
  await withTempDir(async (dir) => {
    await scaffoldEngine(dir, { agents: ["cursor"] });

    const r = await runAgent(dir, ["refresh", "--json"]);
    assertEquals(r.code, 0, r.output);
    const refreshed = decodeCliResult(r.stdout, "refresh");
    assertResultDataKey(refreshed, "agents_written");
    const data = refreshed.data;
    assertEquals(data.agents_written, ["AGENTS.md"]);

    const agents = await Deno.readTextFile(join(dir, "AGENTS.md"));
    assertStringIncludes(agents, "# Working in Engine Test");
    assertStringIncludes(agents, "discern_status");
  });
});

Deno.test("refresh projects the environment-only MCP preload experiment and removes it when disabled", async () => {
  await withTempDir(async (dir) => {
    await scaffoldEngine(dir, { agents: ["claude_code", "copilot"] });
    const variable = EXPERIMENTAL_ENVIRONMENT_VARIABLES.experimentalMcpPreload;
    const enabled = await runAgent(dir, ["refresh", "--json"], {
      env: { [variable]: "1" },
    });
    assertEquals(enabled.code, 0, enabled.output);
    let mcp = decodeWith(
      McpSettingsSchema,
      await Deno.readTextFile(join(dir, ".mcp.json")),
    );
    assertEquals(mcp.mcpServers.discern.alwaysLoad, true);
    assertEquals(mcp.mcpServers.discern.deferTools, "never");

    const disabled = await runAgent(dir, ["refresh", "--json"], {
      env: { [variable]: "" },
    });
    assertEquals(disabled.code, 0, disabled.output);
    mcp = decodeWith(
      McpSettingsSchema,
      await Deno.readTextFile(join(dir, ".mcp.json")),
    );
    assertEquals(mcp.mcpServers.discern.alwaysLoad, undefined);
    assertEquals(mcp.mcpServers.discern.deferTools, undefined);
  });
});

Deno.test("Cursor + Claude refresh emits AGENTS.md and points CLAUDE.md at it", async () => {
  await withTempDir(async (dir) => {
    await scaffoldEngine(dir, { agents: ["cursor", "claude_code"] });

    const r = await runAgent(dir, ["refresh", "--json"]);
    assertEquals(r.code, 0, r.output);
    const refreshed = decodeCliResult(r.stdout, "refresh");
    assertResultDataKey(refreshed, "agents_written");
    const data = refreshed.data;
    assertEquals(data.agents_written, ["AGENTS.md", "CLAUDE.md"]);

    const agents = await Deno.readTextFile(join(dir, "AGENTS.md"));
    assertStringIncludes(agents, "# Working in Engine Test");
    assertStringIncludes(agents, "discern_status");
    assertEquals(
      await Deno.readTextFile(join(dir, "CLAUDE.md")),
      "@AGENTS.md\n",
    );
  });
});

Deno.test("a default (Claude-only) refresh declares no worktree-app file — the seam is registry-driven, skipped when unused", async () => {
  await withTempDir(async (dir) => {
    await scaffoldEngine(dir); // agents = ["claude_code"]
    const r = await runAgent(dir, ["refresh", "--json"]);
    assertEquals(r.code, 0, r.output);
    const refreshed = decodeCliResult(r.stdout, "refresh");
    assertResultDataKey(refreshed, "worktree_app_wired");
    assertEquals(refreshed.data.worktree_app_wired, []);
    assert(
      !(await targetExists(join(dir, ".codex/environments/environment.toml"))),
      "no codex agent configured → no environment.toml co-managed",
    );
  });
});

Deno.test("setup seeds per-agent hook files ONLY for configured agents (no inert dotfiles)", async () => {
  // The leak a cold run hit: a claude+codex project still got committed .cursor/,
  // .gemini/, and .github/ hook files for agents it doesn't use. assembleInitPlan must
  // seed a hooks provider's settings file only when that agent is configured. Driven
  // off the provider registry, so a new hooks provider auto-enrols in this guard.
  await withTempDir(async (dir) => {
    const configured: AgentName[] = ["claude_code", "codex"];
    const plan = await assembleInitPlan({
      templatesDir: REAL_TEMPLATES,
      destDir: dir,
      config: {
        projectName: "Seed Filter",
        slug: "seed-filter",
        branchPrefix: "agent/",
        brief: "",
        agents: configured,
      },
    });
    const targets = new Set(plan.ops.map((o) => o.targetRel));
    for (const p of providersWithHooks()) {
      if (p.hooks === undefined) continue;
      const seeded = targets.has(p.hooks.settingsFile);
      if (configured.includes(p.name)) {
        assert(
          seeded,
          `configured ${p.name} should seed ${p.hooks.settingsFile}`,
        );
      } else {
        assert(
          !seeded,
          `unconfigured ${p.name} must NOT seed ${p.hooks.settingsFile} (inert dotfile leak)`,
        );
      }
    }
  });
});
