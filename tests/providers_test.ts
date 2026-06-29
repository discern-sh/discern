/**
 * The typed provider registry (ADR 0031) — the single source of truth for
 * everything agent-specific. These guard that the registry stays total and that
 * the Claude Code MCP wiring is correct and idempotent.
 */

import { assert, assertEquals, assertStringIncludes } from "@std/assert";
import { join } from "@std/path";
import { withTempDir } from "./helpers.ts";
import { AGENT_NAMES } from "../src/shared/config_schema.ts";
import {
  DISCERN_MCP_SERVER,
  MCP_RESTART_HINT,
  providerFor,
  PROVIDERS,
  providersWithHooks,
  skillsDirsForAgents,
  wiredMcp,
  wireProviderMcp,
  wireProviderWorktreeApp,
} from "../src/lib/providers.ts";
import { parse as parseToml } from "@std/toml";

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

Deno.test("every known agent declares a skills directory (all SKILL.md-format)", () => {
  for (const name of AGENT_NAMES) {
    const dir = providerFor(name)?.skillsDir;
    assert(dir !== undefined && dir.length > 0, `${name}: no skills dir`);
  }
  // Claude keeps its own; Codex + Gemini share the cross-tool standard.
  assertEquals(providerFor("claude_code")?.skillsDir, ".claude/skills");
  assertEquals(providerFor("codex")?.skillsDir, ".agents/skills");
  assertEquals(providerFor("gemini")?.skillsDir, ".agents/skills");
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

Deno.test("every agent renders a distinct `<label> (<file>)` choice — the init prompt's display", () => {
  // The `init` agent-files Checkbox derives each option's display from the
  // registry: `${label} (${guidanceFile.path})`. The label and path must be
  // 1:1 with the agent, or two agents render identically and one is silently
  // mislabelled (the "two Codexs" bug, when a hardcoded fallback labelled both
  // codex and gemini "Codex (AGENTS.md)").
  const display = (name: typeof AGENT_NAMES[number]) =>
    `${PROVIDERS[name].label} (${PROVIDERS[name].guidanceFile.path})`;
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

Deno.test("the guidance-file mapping is the documented one (AGENTS.md the one canonical file)", () => {
  // Claude Code's mirror points at the canonical file rather than duplicating it,
  // so its guidanceFile carries a `pointer` that emits an `@<path>` import — and it
  // is not itself canonical. (canonical is decoupled from git-tracking: ADR 0034
  // makes every compiled file gitignored.)
  const claude = providerFor("claude_code")?.guidanceFile;
  assertEquals(claude?.path, "CLAUDE.md");
  assertEquals(claude?.canonical, false);
  assertEquals(typeof claude?.pointer, "function");
  assertEquals(claude?.pointer?.("AGENTS.md"), "@AGENTS.md\n");

  // The canonical file holds the full compiled body — no pointer.
  const codex = providerFor("codex")?.guidanceFile;
  assertEquals(codex?.path, "AGENTS.md");
  assertEquals(codex?.canonical, true);
  assertEquals(codex?.pointer, undefined);

  // Gemini's mirror points at the canonical AGENTS.md via its `@path` Memory Import
  // (vendor-verified, `.md`-only), exactly like Claude — not a duplicated body.
  const gemini = providerFor("gemini")?.guidanceFile;
  assertEquals(gemini?.path, "GEMINI.md");
  assertEquals(gemini?.canonical, false);
  assertEquals(gemini?.pointer?.("AGENTS.md"), "@AGENTS.md\n");
  // Exactly one canonical file, and it is AGENTS.md.
  const canonical = Object.values(PROVIDERS)
    .filter((p) => p.guidanceFile.canonical)
    .map((p) => p.guidanceFile.path);
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

Deno.test("MCP status is typed and explicit: all three agents wired to their own config file", () => {
  // The typed McpStatus (ADR 0051) tightens as plans flip pending → wired: Phase B
  // wired Codex (.codex/config.toml, TOML) and Gemini (.gemini/settings.json, JSON)
  // alongside Claude (.mcp.json). Every provider now carries a live integration naming
  // the committable file it writes into — no `pending`/`undefined` gap left.
  assertEquals(providerFor("claude_code")?.mcp.kind, "wired");
  assertEquals(wiredMcp(PROVIDERS.claude_code)?.configFile, ".mcp.json");
  assertEquals(providerFor("codex")?.mcp.kind, "wired");
  assertEquals(wiredMcp(PROVIDERS.codex)?.configFile, ".codex/config.toml");
  assertEquals(providerFor("gemini")?.mcp.kind, "wired");
  assertEquals(wiredMcp(PROVIDERS.gemini)?.configFile, ".gemini/settings.json");

  // hook-stripping / the settings seam iterate exactly the providers that declare a
  // hook surface — now all three (Codex + Gemini gained a SessionStart hook), in
  // registry order.
  assertEquals(providersWithHooks().map((p) => p.name), [
    "claude_code",
    "codex",
    "gemini",
  ]);

  // Only Codex co-manages an app-managed worktree-lifecycle file (environment.toml);
  // the others declare no worktreeApp (skipped, never guessed).
  assertEquals(
    providerFor("codex")?.worktreeApp?.configFile,
    ".codex/environments/environment.toml",
  );
  assertEquals(providerFor("claude_code")?.worktreeApp, undefined);
  assertEquals(providerFor("gemini")?.worktreeApp, undefined);
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

    // Idempotent: a second wiring writes nothing AND is not a first install (so
    // no restart hint fires on a re-apply).
    const second = await wireProviderMcp(dir, ["claude_code"]);
    assertEquals(second.written, []);
    assertEquals(second.firstInstall, false);
  });
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
    const mcp = JSON.parse(await Deno.readTextFile(join(dir, ".mcp.json")));
    assertEquals(mcp.mcpServers.other, {
      type: "stdio",
      command: "other-tool",
    }); // preserved
    assertEquals(mcp.mcpServers.discern.command, "discern"); // added
  });
});

Deno.test("the MCP restart hint names a restart and persists thereafter", () => {
  assertStringIncludes(MCP_RESTART_HINT.toLowerCase(), "restart");
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

Deno.test("wireProviderMcp wires Gemini: mcpServers.discern into .gemini/settings.json (no type, no .mcp.json)", async () => {
  await withTempDir(async (dir) => {
    const first = await wireProviderMcp(dir, ["gemini"]);
    assertEquals(first.written, [".gemini/settings.json"]);
    assert(first.firstInstall, "a fresh Gemini wire must report firstInstall");

    const settings = JSON.parse(
      await Deno.readTextFile(join(dir, ".gemini/settings.json")),
    );
    // Gemini infers stdio from `command` — no `type` field (unlike Claude's .mcp.json).
    assertEquals(settings.mcpServers.discern, {
      command: "discern",
      args: ["mcp"],
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
    // hook (hooks.enabled) AND a server the user added — both must survive.
    await Deno.mkdir(join(dir, ".gemini"), { recursive: true });
    await Deno.writeTextFile(
      join(dir, ".gemini/settings.json"),
      JSON.stringify({
        hooks: {
          enabled: true,
          SessionStart: [{
            matcher: "startup",
            hooks: [{ type: "command", command: "discern worktree:ensure" }],
          }],
        },
        mcpServers: { other: { command: "other-tool" } },
      }),
    );
    const r = await wireProviderMcp(dir, ["gemini"]);
    assert(r.firstInstall, "discern was absent → firstInstall");
    const settings = JSON.parse(
      await Deno.readTextFile(join(dir, ".gemini/settings.json")),
    );
    assertEquals(settings.hooks.enabled, true); // seeded hook preserved
    assertEquals(settings.hooks.SessionStart.length, 1);
    assertEquals(settings.mcpServers.other, { command: "other-tool" }); // preserved
    assertEquals(settings.mcpServers.discern.command, "discern"); // added
  });
});

Deno.test("wireProviderMcp wires Codex: [mcp_servers.discern] into .codex/config.toml via TOML, preserving comments + other servers", async () => {
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
      mcp_servers: {
        other?: { command?: string };
        discern?: { command?: string; args?: string[] };
      };
    };
    assertEquals(parsed.mcp_servers.other?.command, "other-tool"); // preserved
    assertEquals(parsed.mcp_servers.discern?.command, "discern"); // added
    assertEquals(parsed.mcp_servers.discern?.args, ["mcp"]);

    // Idempotent: a second wire is a clean no-op (byte-identical TOML).
    const second = await wireProviderMcp(dir, ["codex"]);
    assertEquals(second.written, []);
    assertEquals(second.firstInstall, false);
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
    assertEquals(parsed.setup.script, "discern worktree:ensure");
    assertEquals(parsed.cleanup.script, "discern worktree:teardown");

    // Idempotent: a second pass writes nothing.
    assertEquals(await wireProviderWorktreeApp(dir, ["codex"]), []);
  });
});

Deno.test("wireProviderWorktreeApp creates a SCHEMA-VALID environment.toml when absent (version + name), and skips agents without one", async () => {
  await withTempDir(async (dir) => {
    // Absent file → created with discern's setup/cleanup AND the top-level keys
    // Codex's schema REQUIRES (version: number, name: string). Without these, Codex
    // rejects the file ("expected string, received undefined" at `name`), so seeding
    // them is the guard against that regression — a from-scratch file must validate.
    const wrote = await wireProviderWorktreeApp(dir, ["codex"]);
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
    assertEquals(parsed.name, "Discern");
    assertEquals(parsed.setup.script, "discern worktree:ensure");
    assertEquals(parsed.cleanup.script, "discern worktree:teardown");

    // Claude/Gemini declare no worktreeApp → nothing written, no file created.
    assertEquals(
      await wireProviderWorktreeApp(dir, ["claude_code", "gemini"]),
      [],
    );
  });
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
