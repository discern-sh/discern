/**
 * The typed provider registry (ADR 0031) — the single source of truth for
 * everything agent-specific. These guard that the registry stays total and that
 * the Claude Code MCP wiring is correct and idempotent.
 */

import { assert, assertEquals } from "@std/assert";
import { join } from "@std/path";
import { withTempDir } from "./helpers.ts";
import { AGENT_NAMES } from "../src/shared/config_schema.ts";
import {
  DISCERN_MCP_SERVER,
  providerFor,
  PROVIDERS,
  providersWithHooks,
  wireProviderMcp,
} from "../src/lib/providers.ts";

Deno.test("the registry is total: every known agent has a complete provider", () => {
  for (const name of AGENT_NAMES) {
    const p = providerFor(name);
    assert(p, `no provider for ${name}`);
    assertEquals(p.name, name);
    assert(p.label.length > 0, `${name}: empty label`);
    assert(p.guidanceFile.path.endsWith(".md"), `${name}: odd guidance file`);
  }
  assertEquals(Object.keys(PROVIDERS).length, AGENT_NAMES.length);
});

Deno.test("the guidance-file mapping is the documented one (AGENTS.md the only tracked file)", () => {
  assertEquals(providerFor("claude_code")?.guidanceFile, {
    path: "CLAUDE.md",
    tracked: false,
  });
  assertEquals(providerFor("codex")?.guidanceFile, {
    path: "AGENTS.md",
    tracked: true,
  });
  assertEquals(providerFor("gemini")?.guidanceFile, {
    path: "GEMINI.md",
    tracked: false,
  });
  const tracked = Object.values(PROVIDERS)
    .filter((p) => p.guidanceFile.tracked)
    .map((p) => p.guidanceFile.path);
  assertEquals(tracked, ["AGENTS.md"]);
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

Deno.test("today only Claude Code wires MCP + hooks; the others are typed TODOs", () => {
  assert(providerFor("claude_code")?.mcp, "claude_code should wire MCP");
  assert(providerFor("claude_code")?.hooks, "claude_code should declare hooks");
  assertEquals(providerFor("codex")?.mcp, undefined);
  assertEquals(providerFor("gemini")?.mcp, undefined);
  // hook-stripping iterates exactly the providers that declare a hook surface.
  assertEquals(providersWithHooks().map((p) => p.name), ["claude_code"]);
});

Deno.test("wireProviderMcp writes .mcp.json + approval for Claude Code, idempotently", async () => {
  await withTempDir(async (dir) => {
    const first = await wireProviderMcp(dir, ["claude_code"]);
    assert(first.includes(".mcp.json"), first.join(","));
    assert(first.includes(".claude/settings.json"), first.join(","));

    const mcp = JSON.parse(await Deno.readTextFile(join(dir, ".mcp.json")));
    assertEquals(mcp.mcpServers.discern, {
      type: "stdio",
      command: "discern",
      args: ["mcp"],
    });
    const settings = JSON.parse(
      await Deno.readTextFile(join(dir, ".claude/settings.json")),
    );
    assertEquals(settings.enabledMcpjsonServers, ["discern"]);

    // Idempotent: a second wiring, with both already in place, writes nothing.
    assertEquals(await wireProviderMcp(dir, ["claude_code"]), []);
  });
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
    const settings = JSON.parse(
      await Deno.readTextFile(join(dir, ".claude/settings.json")),
    );
    assertEquals(settings.permissions.deny, ["Read(./.env)"]); // preserved
    assertEquals(settings.enabledMcpjsonServers, ["other", "discern"]); // unioned
  });
});

Deno.test("wireProviderMcp skips agents without an MCP integration (a typed TODO)", async () => {
  await withTempDir(async (dir) => {
    assertEquals(await wireProviderMcp(dir, ["codex", "gemini"]), []);
    let created = true;
    try {
      await Deno.stat(join(dir, ".mcp.json"));
    } catch {
      created = false;
    }
    assert(!created, ".mcp.json must not be created for non-MCP agents");
  });
});
