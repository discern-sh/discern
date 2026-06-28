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
  wireProviderMcp,
  wiredMcp,
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

Deno.test("MCP status is typed and explicit: claude wired, codex/gemini pending with a named target", () => {
  // The old silent `mcp?` TODO is now an explicit, typed McpStatus (ADR 0051): every
  // provider accounts for its MCP wiring — wired, or pending with the committable
  // file discern will write into. No `undefined` gap.
  assertEquals(providerFor("claude_code")?.mcp.kind, "wired");
  assertEquals(wiredMcp(PROVIDERS.claude_code)?.configFile, ".mcp.json");

  const codexMcp = providerFor("codex")?.mcp;
  assertEquals(codexMcp?.kind, "pending");
  assertEquals(
    codexMcp?.kind === "pending" ? codexMcp.targetFile : undefined,
    ".codex/config.toml",
  );
  const geminiMcp = providerFor("gemini")?.mcp;
  assertEquals(geminiMcp?.kind, "pending");
  assertEquals(
    geminiMcp?.kind === "pending" ? geminiMcp.targetFile : undefined,
    ".gemini/settings.json",
  );
  // wiredMcp is the one place "is this provider's MCP wired?" is decided.
  assertEquals(wiredMcp(PROVIDERS.codex), undefined);
  assertEquals(wiredMcp(PROVIDERS.gemini), undefined);

  // hook-stripping iterates exactly the providers that declare a hook surface.
  assertEquals(providersWithHooks().map((p) => p.name), ["claude_code"]);
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

Deno.test("wireProviderMcp skips agents whose MCP is pending (committable, not yet wired)", async () => {
  await withTempDir(async (dir) => {
    const r = await wireProviderMcp(dir, ["codex", "gemini"]);
    assertEquals(r.written, []);
    assertEquals(r.firstInstall, false);
    let created = true;
    try {
      await Deno.stat(join(dir, ".mcp.json"));
    } catch {
      created = false;
    }
    assert(!created, ".mcp.json must not be created for non-MCP agents");
  });
});
