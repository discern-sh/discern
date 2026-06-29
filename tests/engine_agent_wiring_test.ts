/**
 * Phase B end-to-end wiring: the Gemini + Codex MCP / hooks / worktree-lifecycle
 * surfaces, exercised through the REAL scaffold + refresh path (the bytes a real
 * install ships), not unit calls. The unit-level idempotency/merge proofs live in
 * `providers_test.ts`; these prove the seam composes once routed through
 * `assembleInitPlan` (seeds) + `discern refresh` (MCP + worktree-app wiring).
 *
 * The decisive Gemini check: the SEED (hooks.enabled + SessionStart) and the
 * `register()` MCP entry (mcpServers.discern) land in the ONE `.gemini/settings.json`,
 * deep-merged — neither clobbers the other, and a user key survives both.
 */

import { assert, assertEquals } from "@std/assert";
import { join } from "@std/path";
import { parse as parseToml } from "@std/toml";
import { exists } from "@std/fs";
import { withTempDir } from "./helpers.ts";
import { runAgent, scaffoldEngine } from "./engine_helpers.ts";

/** Point a scaffolded `discern.toml` at the given agent set (comment-preserving enough
 * for the test — a single-line `agents = [...]` rewrite, matching the seed shape). */
async function setAgents(dir: string, agents: string[]): Promise<void> {
  const path = join(dir, "discern.toml");
  const cfg = await Deno.readTextFile(path);
  const list = agents.map((a) => `"${a}"`).join(", ");
  await Deno.writeTextFile(
    path,
    cfg.replace(/agents = \[[^\]]*\]/, `agents = [${list}]`),
  );
}

Deno.test("Gemini: the seed (hooks.enabled + SessionStart) and the MCP register() compose in one .gemini/settings.json", async () => {
  await withTempDir(async (dir) => {
    // The scaffold seeds .gemini/settings.json from the template (every install gets
    // the settings templates; buildPlan walks them all).
    await scaffoldEngine(dir);
    await setAgents(dir, ["claude_code", "gemini"]);

    // The seed landed: hooks.enabled + the SessionStart → worktree:ensure hook.
    const seeded = JSON.parse(
      await Deno.readTextFile(join(dir, ".gemini/settings.json")),
    );
    assertEquals(seeded.hooks.enabled, true);
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
    assertEquals(merged.hooks.enabled, true);
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
    await scaffoldEngine(dir);
    await setAgents(dir, ["claude_code", "codex"]);

    // The scaffold seeded the SessionStart hook into .codex/hooks.json.
    const hooks = JSON.parse(
      await Deno.readTextFile(join(dir, ".codex/hooks.json")),
    );
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

    // The MCP server table is present in the TOML config.
    const cfg = parseToml(
      await Deno.readTextFile(join(dir, ".codex/config.toml")),
    ) as { mcp_servers: { discern?: { command?: string } } };
    assertEquals(cfg.mcp_servers.discern?.command, "discern");

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

    // Idempotent: a second refresh re-wires neither the MCP nor the env file.
    const r2 = await runAgent(dir, ["refresh", "--json"]);
    const data2 = JSON.parse(r2.stdout).data;
    assertEquals(data2.mcp_wired.includes(".codex/config.toml"), false);
    assertEquals(data2.worktree_app_wired, []);
  });
});

Deno.test("Cursor + Copilot: scaffold seeds each SessionStart hook; refresh wires .cursor/mcp.json and the co-owned .mcp.json", async () => {
  await withTempDir(async (dir) => {
    await scaffoldEngine(dir);
    await setAgents(dir, ["cursor", "copilot"]);

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
    // .claude/settings.json is seeded by the scaffold, but neither Cursor nor Copilot
    // pre-approves via enabledMcpjsonServers — that key is Claude's, written only by
    // registerClaudeCodeMcp, and Claude is not a configured agent here. They gate on trust.
    const claudeSettings = JSON.parse(
      await Deno.readTextFile(join(dir, ".claude/settings.json")),
    );
    assertEquals(claudeSettings.enabledMcpjsonServers, undefined);

    // Idempotent: a second refresh re-wires neither file.
    const r2 = await runAgent(dir, ["refresh", "--json"]);
    const data2 = JSON.parse(r2.stdout).data;
    assertEquals(data2.mcp_wired.includes(".cursor/mcp.json"), false);
    assertEquals(data2.mcp_wired.includes(".mcp.json"), false);
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
