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

import { assert, assertEquals, assertStringIncludes } from "@std/assert";
import { basename, join } from "@std/path";
import { parse as parseToml } from "@std/toml";
import { exists } from "@std/fs";
import { REAL_TEMPLATES, withTempDir } from "./helpers.ts";
import { runAgent, scaffoldEngine } from "./engine_helpers.ts";
import { assembleInitPlan } from "../src/commands/setup.ts";
import { providersWithHooks } from "../src/lib/providers.ts";
import type { AgentName } from "../src/lib/config.ts";

Deno.test("Gemini: the seed (hooksConfig.enabled + SessionStart) and the MCP register() compose in one .gemini/settings.json", async () => {
  await withTempDir(async (dir) => {
    // Gemini is configured, so its per-agent seed (.gemini/settings.json) is laid.
    await scaffoldEngine(dir, { agents: ["claude_code", "gemini"] });

    // The seed landed: hooksConfig.enabled (the hooks system's canonical toggle —
    // a SEPARATE section from the per-event arrays; Gemini rejects a boolean under
    // `hooks`) + the SessionStart → worktree:ensure hook.
    const seeded = JSON.parse(
      await Deno.readTextFile(join(dir, ".gemini/settings.json")),
    );
    assertEquals(seeded.hooksConfig.enabled, true);
    assertEquals(seeded.hooks.enabled, undefined); // never a boolean under hooks
    assertEquals(
      seeded.hooks.SessionStart[0].hooks[0].command,
      "discern worktree:ensure",
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
    const data = JSON.parse(r.stdout).data;
    assert(
      data.mcp_wired.includes(".gemini/settings.json"),
      `expected .gemini/settings.json in mcp_wired: ${r.stdout}`,
    );

    const merged = JSON.parse(
      await Deno.readTextFile(join(dir, ".gemini/settings.json")),
    );
    // All three coexist: the seeded hooks, the MCP server, and the user key.
    assertEquals(merged.hooksConfig.enabled, true);
    assertEquals(
      merged.hooks.SessionStart[0].hooks[0].command,
      "discern worktree:ensure",
    );
    assertEquals(merged.mcpServers.discern, {
      command: "discern",
      args: ["mcp"],
    });
    assertEquals(merged.telemetry, { enabled: false }); // user key preserved

    // Idempotent: a second refresh re-wires nothing for Gemini.
    const r2 = await runAgent(dir, ["refresh", "--json"]);
    assertEquals(
      JSON.parse(r2.stdout).data.mcp_wired.includes(".gemini/settings.json"),
      false,
    );
  });
});

Deno.test("Codex: refresh wires .codex/config.toml (MCP) and co-manages environment.toml ([setup]/[cleanup]), idempotently", async () => {
  await withTempDir(async (dir) => {
    await scaffoldEngine(dir, { agents: ["claude_code", "codex"] });

    // The scaffold seeded the SessionStart hook into .codex/hooks.json.
    const hooks = JSON.parse(
      await Deno.readTextFile(join(dir, ".codex/hooks.json")),
    );
    assertEquals(hooks.hooks.SessionStart[0].matcher, "startup|resume");
    assertEquals(
      hooks.hooks.SessionStart[0].hooks[0].command,
      "discern worktree:ensure",
    );

    // refresh wires the MCP server (TOML) and the app worktree-lifecycle file.
    const r = await runAgent(dir, ["refresh", "--json"]);
    assertEquals(r.code, 0, r.output);
    const data = JSON.parse(r.stdout).data;
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
    assertEquals(cfg.mcp_servers.discern?.args, ["mcp"]);
    assertEquals("cwd" in (cfg.mcp_servers.discern ?? {}), false);
    assertEquals(cfg.mcp_servers.discern?.startup_timeout_sec, 30);
    assertEquals(cfg.mcp_servers.discern?.tool_timeout_sec, 3600);

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
    assertEquals(env.name, "Discern");
    assertEquals(env.setup.script, "discern worktree:ensure");
    assertEquals(env.cleanup.script, "discern worktree:teardown");

    const rules = await Deno.readTextFile(
      join(dir, ".codex/rules/discern.rules"),
    );
    assertStringIncludes(rules, 'pattern = ["git", "add"]');
    assertStringIncludes(rules, 'pattern = ["git", "commit"]');
    assertStringIncludes(rules, "trusted discern linked worktrees");
    assertStringIncludes(rules, ".git/worktrees");
    assertEquals((rules.match(/decision = "allow"/g) ?? []).length, 2);

    // Idempotent: a second refresh re-wires neither the MCP nor the env file.
    const r2 = await runAgent(dir, ["refresh", "--json"]);
    const data2 = JSON.parse(r2.stdout).data;
    assertEquals(data2.mcp_wired.includes(".codex/config.toml"), false);
    assertEquals(data2.worktree_app_wired, []);
    assertEquals(data2.project_rules_wired, []);
  });
});

Deno.test("Cursor + Copilot: scaffold seeds each SessionStart hook; refresh wires .cursor/mcp.json and the co-owned .mcp.json", async () => {
  await withTempDir(async (dir) => {
    await scaffoldEngine(dir, { agents: ["cursor", "copilot"] });

    // The scaffold seeded each vendor's SessionStart hook in its own shape — Cursor's
    // flat `{ command }`, Copilot's `{ type, bash }` — both running worktree:ensure.
    const cursorHooks = JSON.parse(
      await Deno.readTextFile(join(dir, ".cursor/hooks.json")),
    );
    assertEquals(
      cursorHooks.hooks.sessionStart[0].command,
      "discern worktree:ensure",
    );
    const copilotHooks = JSON.parse(
      await Deno.readTextFile(join(dir, ".github/hooks/discern.json")),
    );
    assertEquals(
      copilotHooks.hooks.sessionStart[0].bash,
      "discern worktree:ensure",
    );

    // refresh wires Cursor's own .cursor/mcp.json and Copilot's co-owned .mcp.json.
    const r = await runAgent(dir, ["refresh", "--json"]);
    assertEquals(r.code, 0, r.output);
    const data = JSON.parse(r.stdout).data;
    assert(
      data.mcp_wired.includes(".cursor/mcp.json"),
      `expected .cursor/mcp.json in mcp_wired: ${r.stdout}`,
    );
    assert(
      data.mcp_wired.includes(".mcp.json"),
      `expected .mcp.json in mcp_wired: ${r.stdout}`,
    );

    // Both carry the byte-identical stdio entry (Cursor requires the explicit type).
    const cursorMcp = JSON.parse(
      await Deno.readTextFile(join(dir, ".cursor/mcp.json")),
    );
    assertEquals(cursorMcp.mcpServers.discern, {
      type: "stdio",
      command: "discern",
      args: ["mcp"],
    });
    const sharedMcp = JSON.parse(
      await Deno.readTextFile(join(dir, ".mcp.json")),
    );
    assertEquals(sharedMcp.mcpServers.discern, {
      type: "stdio",
      command: "discern",
      args: ["mcp"],
    });
    // Claude is not a configured agent here, so no Claude file is seeded at all — an
    // unconfigured agent leaves no inert dotfiles behind (the per-agent seed filter).
    assert(
      !(await exists(join(dir, ".claude/settings.json"))),
      "an unconfigured agent (claude) must not get a seeded settings file",
    );

    // Idempotent: a second refresh re-wires neither file.
    const r2 = await runAgent(dir, ["refresh", "--json"]);
    const data2 = JSON.parse(r2.stdout).data;
    assertEquals(data2.mcp_wired.includes(".cursor/mcp.json"), false);
    assertEquals(data2.mcp_wired.includes(".mcp.json"), false);
  });
});

Deno.test("Cursor-only refresh emits AGENTS.md with the compiled guidance body", async () => {
  await withTempDir(async (dir) => {
    await scaffoldEngine(dir, { agents: ["cursor"] });

    const r = await runAgent(dir, ["refresh", "--json"]);
    assertEquals(r.code, 0, r.output);
    const data = JSON.parse(r.stdout).data;
    assertEquals(data.agents_written, ["AGENTS.md"]);

    const agents = await Deno.readTextFile(join(dir, "AGENTS.md"));
    assertStringIncludes(agents, "# Working with the discern harness");
    assertStringIncludes(agents, "discern_status");
  });
});

Deno.test("Cursor + Claude refresh emits AGENTS.md and points CLAUDE.md at it", async () => {
  await withTempDir(async (dir) => {
    await scaffoldEngine(dir, { agents: ["cursor", "claude_code"] });

    const r = await runAgent(dir, ["refresh", "--json"]);
    assertEquals(r.code, 0, r.output);
    const data = JSON.parse(r.stdout).data;
    assertEquals(data.agents_written, ["AGENTS.md", "CLAUDE.md"]);

    const agents = await Deno.readTextFile(join(dir, "AGENTS.md"));
    assertStringIncludes(agents, "# Working with the discern harness");
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
    assertEquals(JSON.parse(r.stdout).data.worktree_app_wired, []);
    assert(
      !(await exists(join(dir, ".codex/environments/environment.toml"))),
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
        sourceGlobs: ["src/**"],
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
