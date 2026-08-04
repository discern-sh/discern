/**
 * Engine coverage for `discern refresh` — the verb that compiles the agent
 * instruction files (job 1: built-in guidance + the project's `[guidance].sources`)
 * AND materializes skills into `.claude/skills/` (job 2): bundled built-ins are
 * copied in, authored skills (under `[skills].dir`) are symlinked. The two jobs
 * are independent, each gated on its feature, so a project with no authored
 * guidance still gets discoverable skills. These tests pin both jobs under the
 * real dispatcher.
 */

import {
  assert,
  assertEquals,
  assertRejects,
  assertStringIncludes,
} from "@std/assert";
import { join } from "@std/path";
import { ensureDir, exists } from "@std/fs";
import { HINTS } from "../src/shared/hints.ts";
import { agentFilePaths } from "../src/engine/guidance_render.ts";
import { AGENT_NAMES, loadConfig } from "../src/shared/config_schema.ts";
import { canonicalDiscernGitattributesBlockForConfig } from "../src/lib/agent_gitattributes.ts";
import { withTempDir } from "./helpers.ts";
import { assertHasHint, assertLacksHint } from "./hint_asserts.ts";
import { runAgent, scaffoldEngine, writeExecutable } from "./engine_helpers.ts";

Deno.test("engine refresh: one pass enrolls every compiled Agent file before Git tracking", async () => {
  await withTempDir(async (dir) => {
    await scaffoldEngine(dir, { agents: [...AGENT_NAMES] });

    const refreshed = await runAgent(dir, ["refresh", "--json"]);
    assertEquals(refreshed.code, 0, refreshed.output);

    const config = await loadConfig(dir);
    assertEquals(
      await Deno.readTextFile(join(dir, ".gitattributes")),
      canonicalDiscernGitattributesBlockForConfig(
        config,
        agentFilePaths(config),
      ).text,
      "a new provider output must join the managed block in the same refresh that compiles it",
    );
  });
});

Deno.test("engine refresh: a skills-dir failure is isolated — agent files and MCP still refresh (ADR 0065)", async () => {
  await withTempDir(async (dir) => {
    await scaffoldEngine(dir);
    // Force skills materialization to fail: put a FILE where the skills dir must be
    // a directory, so writing into .claude/skills/ throws (a stand-in for the sandbox
    // denial Codex hit writing .agents/skills).
    await ensureDir(join(dir, ".claude"));
    await Deno.writeTextFile(join(dir, ".claude/skills"), "not a directory\n");

    const r = await runAgent(dir, ["refresh", "--json"]);
    // Partial success: a non-zero exit and a structured partial_refresh result...
    assertEquals(r.code, 1, r.output);
    const res = JSON.parse(r.stdout);
    assertEquals(res.ok, false);
    assertEquals(res.error, "partial_refresh");
    assert(res.data.errors.length > 0, r.output);

    // ...but the OTHER jobs still completed — a skills failure no longer aborts the
    // agent-file compile or the MCP wiring (the bug Codex reported).
    assert(res.data.agents_written.includes("CLAUDE.md"), r.output);
    assert(res.data.mcp_wired.length > 0, r.output);
    assert(
      await exists(join(dir, "CLAUDE.md")),
      "CLAUDE.md must still be written",
    );
    assert(
      await exists(join(dir, ".mcp.json")),
      ".mcp.json must still be wired",
    );
  });
});

Deno.test("engine refresh: compiles agent files and materializes bundled skills", async () => {
  await withTempDir(async (dir) => {
    await scaffoldEngine(dir);

    const r = await runAgent(dir, ["refresh"]);
    assertEquals(r.code, 0, r.output);

    // Job 1: the configured agent file (claude_code → CLAUDE.md) was compiled.
    // With no canonical AGENTS.md emitted (claude_code is the only agent), CLAUDE.md
    // holds the full body and opens with the guidance itself — no banner (ADR 0034).
    assert(
      await exists(join(dir, "CLAUDE.md")),
      `CLAUDE.md missing\n${r.output}`,
    );
    const claude = await Deno.readTextFile(join(dir, "CLAUDE.md"));
    assert(
      claude.startsWith("# Working in Engine Test"),
      `expected guidance at the top, no banner\n${claude.slice(0, 80)}`,
    );

    // Job 2: a bundled built-in is COPIED into .claude/skills/ (a real SKILL.md,
    // not a dangling link) — exactly what the agent reads to discover a skill.
    assert(
      await exists(join(dir, ".claude/skills/discern-write-adr/SKILL.md")),
      `.claude/skills/discern-write-adr must hold a SKILL.md\n${r.output}`,
    );
    assertStringIncludes(r.stdout, "skills materialized into .claude/skills/");
  });
});

Deno.test("engine refresh: backfills the discern MCP server for an install that lacks it (idempotent)", async () => {
  await withTempDir(async (dir) => {
    await scaffoldEngine(dir);
    // A plan-scaffolded install has no .mcp.json yet (it is wired by the refresh
    // core, not seeded) — exactly the pre-feature / not-yet-wired state a real
    // `discern upgrade`/`refresh` must heal without a force-init.
    assert(
      !(await exists(join(dir, ".mcp.json"))),
      "precondition: no .mcp.json",
    );

    // First refresh backfills it and reports it under --json.
    const r = await runAgent(dir, ["refresh", "--json"]);
    assertEquals(r.code, 0, r.output);
    const data = JSON.parse(r.stdout.trim()).data;
    assert(data.mcp_wired.includes(".mcp.json"), r.stdout);
    const mcp = JSON.parse(await Deno.readTextFile(join(dir, ".mcp.json")));
    assertEquals(mcp.mcpServers.discern.command, "discern");

    // Second refresh is a clean no-op for MCP (already present).
    const r2 = await runAgent(dir, ["refresh", "--json"]);
    assertEquals(JSON.parse(r2.stdout.trim()).data.mcp_wired, []);
  });
});

Deno.test("engine refresh refuses malformed co-owned MCP JSON without clobbering it", async () => {
  await withTempDir(async (dir) => {
    await scaffoldEngine(dir);
    const malformed = '{ "mcpServers": { "other": true, }, }\n';
    await Deno.writeTextFile(join(dir, ".mcp.json"), malformed);

    const r = await runAgent(dir, ["refresh", "--json"]);
    assertEquals(r.code, 1, r.output);
    const res = JSON.parse(r.stdout);
    assertEquals(res.ok, false);
    assertEquals(res.error, "partial_refresh");
    assertStringIncludes(res.data.errors.join("\n"), ".mcp.json");
    assertStringIncludes(res.data.errors.join("\n"), "malformed JSON");
    assertEquals(await Deno.readTextFile(join(dir, ".mcp.json")), malformed);
  });
});

Deno.test("engine refresh: the FIRST MCP install surfaces a restart hint; a re-apply does not", async () => {
  await withTempDir(async (dir) => {
    await scaffoldEngine(dir);

    const first = await runAgent(dir, ["refresh", "--json"]);
    assertEquals(first.code, 0, first.output);
    assertHasHint(
      JSON.parse(first.stdout.trim()),
      HINTS["refresh-mcp-first-install"],
    );

    // Re-applying over the existing install must NOT repeat the restart hint.
    const second = await runAgent(dir, ["refresh", "--json"]);
    assertLacksHint(
      JSON.parse(second.stdout.trim()),
      HINTS["refresh-mcp-first-install"],
    );
  });
});

Deno.test("engine refresh: changed tracked artifacts advise committing the refreshed copies", async () => {
  await withTempDir(async (dir) => {
    await scaffoldEngine(dir);

    const first = await runAgent(dir, ["refresh", "--json"]);
    assertEquals(first.code, 0, first.output);
    assertHasHint(
      JSON.parse(first.stdout.trim()),
      HINTS["refresh-commit-tracked-artifacts"],
    );

    // A byte-identical re-apply still reports the Agent file as written in data,
    // but it changed no tracked artifact and must not repeat the commit advice.
    const unchanged = await runAgent(dir, ["refresh", "--json"]);
    assertEquals(unchanged.code, 0, unchanged.output);
    assertLacksHint(
      JSON.parse(unchanged.stdout.trim()),
      HINTS["refresh-commit-tracked-artifacts"],
    );

    // A later source edit changes the compiled Agent file without reinstalling
    // MCP. The commit advice is driven by that tracked change, not by first setup.
    await ensureDir(join(dir, "discern"));
    await Deno.writeTextFile(
      join(dir, "discern/guidance.md"),
      "# Project guidance\nKeep the refreshed copy with this source.\n",
    );
    const changed = await runAgent(dir, ["refresh", "--json"]);
    assertEquals(changed.code, 0, changed.output);
    const envelope = JSON.parse(changed.stdout.trim());
    assertHasHint(envelope, HINTS["refresh-commit-tracked-artifacts"]);
    assertLacksHint(envelope, HINTS["refresh-mcp-first-install"]);
  });
});

Deno.test("engine refresh: materializes skills even with no guideline sources (jobs are independent)", async () => {
  await withTempDir(async (dir) => {
    await scaffoldEngine(dir);
    // A fresh scaffold has no `guidance.md` source at all: job 1 compiles only
    // the built-in guidance, but job 2 (skills) must still run.
    assert(
      !(await exists(join(dir, "guidance.md"))),
      "precondition: no source",
    );

    const r = await runAgent(dir, ["refresh"]);
    assertEquals(r.code, 0, r.output);
    assert(
      await exists(join(dir, ".claude/skills/discern-write-adr/SKILL.md")),
      `skills must materialize independently of guideline compilation\n${r.output}`,
    );
  });
});

Deno.test("engine refresh: agent files are world-readable (0644)", async () => {
  await withTempDir(async (dir) => {
    await scaffoldEngine(dir);

    const r = await runAgent(dir, ["refresh"]);
    assertEquals(r.code, 0, r.output);

    const mode = (await Deno.stat(join(dir, "CLAUDE.md"))).mode ?? 0;
    assertEquals(
      mode & 0o044,
      0o044,
      `CLAUDE.md must be group/other-readable; got mode ${
        (mode & 0o777).toString(8)
      }`,
    );
  });
});

Deno.test("engine refresh: prunes the link of an authored skill removed from the source tree", async () => {
  await withTempDir(async (dir) => {
    await scaffoldEngine(dir);
    // An authored skill under the default skills dir is symlinked into .claude/skills/.
    await writeExecutable(
      join(dir, "discern/skills/temp/SKILL.md"),
      "temp skill",
    );

    let r = await runAgent(dir, ["refresh"]);
    assertEquals(r.code, 0, r.output);
    assert(
      await exists(join(dir, ".claude/skills/temp/SKILL.md")),
      `precondition: temp must be linked\n${r.output}`,
    );

    // Remove the authored skill; re-running must prune the now-dangling link.
    await Deno.remove(join(dir, "discern/skills/temp"), { recursive: true });
    r = await runAgent(dir, ["refresh"]);
    assertEquals(r.code, 0, r.output);

    await assertRejects(
      () => Deno.lstat(join(dir, ".claude/skills/temp")),
      Deno.errors.NotFound,
      undefined,
      `stale link must be pruned, not left dangling\n${r.output}`,
    );
    // A bundled built-in keeps its materialized copy.
    assert(
      await exists(join(dir, ".claude/skills/discern-write-adr/SKILL.md")),
      `bundled skills must stay materialized\n${r.output}`,
    );
    assertStringIncludes(r.stdout, "pruned 1 stale");
  });
});

Deno.test("engine refresh: reconcile leaves a foreign entry it did not create alone", async () => {
  await withTempDir(async (dir) => {
    await scaffoldEngine(dir);
    await ensureDir(join(dir, ".claude/skills"));

    // A user's own symlink pointing OUTSIDE the managed set, with a real target.
    await ensureDir(join(dir, "external/shared"));
    await Deno.writeTextFile(
      join(dir, "external/shared/SKILL.md"),
      "shared skill",
    );
    await Deno.symlink(
      "../../external/shared",
      join(dir, ".claude/skills/shared"),
    );

    const r = await runAgent(dir, ["refresh"]);
    assertEquals(r.code, 0, r.output);

    // It is not a managed name and not dangling, so reconcile must leave it.
    const st = await Deno.lstat(join(dir, ".claude/skills/shared"));
    assert(
      st.isSymlink,
      `a user's symlink with a live target must survive reconcile\n${r.output}`,
    );
  });
});
