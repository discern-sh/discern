/**
 * Engine coverage for `discern refresh` — the verb that compiles the agent
 * instruction files (job 1: built-in instructions + the project's `[instructions].sources`)
 * AND materializes skills into `.claude/skills/` (job 2): bundled built-ins are
 * copied in, authored skills (under `[skills].dir`) are symlinked. The two jobs
 * are independent, each gated on its feature, so a project with no authored
 * instructions still gets discoverable skills. These tests pin both jobs under the
 * real dispatcher.
 *
 * Guards: claim:one-instruction-source, claim:switch-without-reteaching
 */

import {
  assert,
  assertEquals,
  assertRejects,
  assertStringIncludes,
} from "@std/assert";
import { z } from "@zod/zod";
import { join } from "@std/path";
import { ensureDir } from "@std/fs";
import { targetExists } from "../src/shared/fs_presence.ts";
import { HINTS } from "../src/shared/hints.ts";
import { agentFilePaths } from "../src/engine/instruction_render.ts";
import { AGENT_NAMES, loadConfig } from "../src/shared/config_schema.ts";
import { canonicalDiscernGitattributesBlock } from "../src/lib/agent_gitattributes.ts";
import { resolveGeneratedGroups } from "../src/shared/generated_artifacts.ts";
import { generatedArtifactMarker } from "../src/shared/brand.ts";
import { ARTIFACT_PROVENANCE_SOURCES } from "../src/shared/file_ownership.ts";
import { DISCERN_NO_ATTRIBUTION } from "../src/shared/env.ts";
import { planTrackedRefresh } from "../src/engine/tracked_refresh.ts";
import { compileInstructions } from "../src/engine/instructions.ts";
import { Logger } from "../src/lib/log.ts";
import { assertTerminalTextIncludes, fakeEnv, withTempDir } from "./helpers.ts";
import { assertHasHint, assertLacksHint } from "./hint_asserts.ts";
import {
  gitInit,
  runAgent,
  scaffoldEngine,
  writeExecutable,
} from "./engine_helpers.ts";
import {
  assertResultDataKey,
  decodeCliResult,
  decodeWith,
} from "./decode_cli_result.ts";

const McpConfigSchema = z.object({
  mcpServers: z.object({
    discern: z.object({ command: z.string() }),
  }),
});

Deno.test("engine refresh: read-only plan and live apply share one tracked effect set", async () => {
  await withTempDir(async (dir) => {
    await scaffoldEngine(dir, { agents: ["codex"] });
    const initial = await runAgent(dir, ["refresh", "--json"]);
    assertEquals(initial.code, 0, initial.output);
    await gitInit(dir);

    const configPath = join(dir, ".codex/config.toml");
    const config = await Deno.readTextFile(configPath);
    assertStringIncludes(config, 'command = "discern"');
    await Deno.writeTextFile(
      configPath,
      config.replace('command = "discern"', 'command = "wrong-discern"'),
    );
    await Deno.chmod(join(dir, "AGENTS.md"), 0o755);

    const planned = await planTrackedRefresh(dir);
    assertEquals(planned.errors, []);
    const applied = await compileInstructions(
      dir,
      new Logger({ json: true, noColor: true }),
    );

    assertEquals(
      [...applied.trackedArtifactsChanged].sort(),
      planned.changes.map((change) => change.path).sort(),
      "plan and apply must remain two modes of the same refresh transformations",
    );
    assertEquals((await planTrackedRefresh(dir)).changes, []);
  });
});

Deno.test("engine refresh: a new provider cannot hide established MCP drift", async () => {
  await withTempDir(async (dir) => {
    await scaffoldEngine(dir, { agents: ["claude_code"] });
    const initial = await runAgent(dir, ["refresh", "--json"]);
    assertEquals(initial.code, 0, initial.output);
    await gitInit(dir);

    const mcpPath = join(dir, ".mcp.json");
    const mcp = await Deno.readTextFile(mcpPath);
    await Deno.writeTextFile(
      mcpPath,
      mcp.replace('"command": "discern"', '"command": "wrong-discern"'),
    );

    const configPath = join(dir, "discern.toml");
    const config = await Deno.readTextFile(configPath);
    assertStringIncludes(config, 'agents = ["claude_code"]');
    await Deno.writeTextFile(
      configPath,
      config.replace(
        'agents = ["claude_code"]',
        'agents = ["claude_code", "cursor"]',
      ),
    );

    const planned = await planTrackedRefresh(dir);
    assertEquals(planned.errors, []);
    assert(
      planned.changes.some((change) => change.path === ".mcp.json"),
      "Cursor's first install must not suppress Claude's established MCP repair",
    );
    assert(
      !planned.changes.some((change) => change.path === ".cursor/mcp.json"),
      "Cursor's untracked first materialization remains advisory",
    );
  });
});

Deno.test("engine refresh: deleting an adopted MCP file is drift, not a first install", async () => {
  await withTempDir(async (dir) => {
    await scaffoldEngine(dir, { agents: ["claude_code"] });
    const initial = await runAgent(dir, ["refresh", "--json"]);
    assertEquals(initial.code, 0, initial.output);
    await gitInit(dir);

    await Deno.remove(join(dir, ".mcp.json"));
    const planned = await planTrackedRefresh(dir);
    assertEquals(planned.errors, []);
    assert(
      planned.changes.some((change) => change.path === ".mcp.json"),
      "a registration present at HEAD remains adopted when its file is deleted",
    );
  });
});

Deno.test("engine refresh: first registration in a tracked shared MCP file stays advisory", async () => {
  await withTempDir(async (dir) => {
    await scaffoldEngine(dir, { agents: ["claude_code"] });
    await Deno.writeTextFile(
      join(dir, ".mcp.json"),
      `${
        JSON.stringify(
          { mcpServers: { existing: { command: "existing" } } },
          null,
          2,
        )
      }\n`,
    );
    await gitInit(dir);

    const planned = await planTrackedRefresh(dir);
    assertEquals(planned.errors, []);
    assert(
      !planned.changes.some((change) => change.path === ".mcp.json"),
      "the first discern registration remains setup work even in a tracked container",
    );
  });
});

Deno.test("engine refresh: one pass enrolls every compiled Agent file before Git tracking", async () => {
  await withTempDir(async (dir) => {
    await scaffoldEngine(dir, { agents: [...AGENT_NAMES] });

    const refreshed = await runAgent(dir, ["refresh", "--json"]);
    assertEquals(refreshed.code, 0, refreshed.output);

    const config = await loadConfig(dir);
    assertEquals(
      await Deno.readTextFile(join(dir, ".gitattributes")),
      canonicalDiscernGitattributesBlock(
        resolveGeneratedGroups(config),
        agentFilePaths(config),
        [],
        fakeEnv(),
      ).text,
      "a new provider output must join the managed block in the same refresh that compiles it",
    );
  });
});

Deno.test("engine refresh: DISCERN_NO_ATTRIBUTION switches every refreshed marker without duplicates", async () => {
  await withTempDir(async (dir) => {
    await scaffoldEngine(dir, { agents: ["codex"] });
    const first = await runAgent(dir, ["refresh", "--json"]);
    assertEquals(first.code, 0, first.output);

    const sourceOnly = await runAgent(dir, ["refresh", "--json"], {
      env: { [DISCERN_NO_ATTRIBUTION]: "1" },
    });
    assertEquals(sourceOnly.code, 0, sourceOnly.output);

    const artifacts = [
      [".gitattributes", ARTIFACT_PROVENANCE_SOURCES.gitattributes],
      [".codex/config.toml", ARTIFACT_PROVENANCE_SOURCES.codexConfig],
      [
        ".codex/environments/environment.toml",
        ARTIFACT_PROVENANCE_SOURCES.codexEnvironment,
      ],
      [".codex/rules/discern.rules", ARTIFACT_PROVENANCE_SOURCES.codexRules],
    ] as const;
    for (const [path, source] of artifacts) {
      const text = await Deno.readTextFile(join(dir, path));
      const marker = `# Generated automatically via ${source}`;
      assertEquals(
        text.split(/\r?\n/u).filter((line) => line === marker).length,
        1,
        `${path} should carry one source-only marker`,
      );
    }

    const restored = await runAgent(dir, ["refresh", "--json"]);
    assertEquals(restored.code, 0, restored.output);
    for (const [path, source] of artifacts) {
      const text = await Deno.readTextFile(join(dir, path));
      const marker = generatedArtifactMarker(source, fakeEnv());
      assertEquals(
        text.split(/\r?\n/u).filter((line) => line === marker).length,
        1,
        `${path} should restore one attributed marker`,
      );
      assert(!text.includes("# Generated automatically via "), path);
    }
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
    const res = decodeCliResult(r.stdout, "refresh");
    assertResultDataKey(res, "errors");
    assertEquals(res.ok, false);
    assertEquals(res.error, "partial_refresh");
    assert(res.data.errors.length > 0, r.output);

    // ...but the OTHER jobs still completed — a skills failure no longer aborts the
    // agent-file compile or the MCP wiring (the bug Codex reported).
    assert(res.data.agents_written.includes("CLAUDE.md"), r.output);
    assert(res.data.mcp_wired.length > 0, r.output);
    assert(
      await targetExists(join(dir, "CLAUDE.md")),
      "CLAUDE.md must still be written",
    );
    assert(
      await targetExists(join(dir, ".mcp.json")),
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
    // holds the full body and opens with the instructions itself — no banner (ADR 0034).
    assert(
      await targetExists(join(dir, "CLAUDE.md")),
      `CLAUDE.md missing\n${r.output}`,
    );
    const claude = await Deno.readTextFile(join(dir, "CLAUDE.md"));
    assert(
      claude.startsWith("# Working in Engine Test"),
      `expected instructions at the top, no banner\n${claude.slice(0, 80)}`,
    );

    // Job 2: a bundled built-in is COPIED into .claude/skills/ (a real SKILL.md,
    // not a dangling link) — exactly what the agent reads to discover a skill.
    assert(
      await targetExists(
        join(dir, ".claude/skills/discern-write-adr/SKILL.md"),
      ),
      `.claude/skills/discern-write-adr must hold a SKILL.md\n${r.output}`,
    );
    assertTerminalTextIncludes(
      r.stdout,
      "skills materialized into .claude/skills/",
    );
  });
});

Deno.test("engine refresh: backfills the discern MCP server for an install that lacks it (idempotent)", async () => {
  await withTempDir(async (dir) => {
    await scaffoldEngine(dir);
    // A plan-scaffolded install has no .mcp.json yet (it is wired by the refresh
    // core, not seeded) — exactly the pre-feature / not-yet-wired state a real
    // `discern upgrade`/`refresh` must heal without a force-init.
    assert(
      !(await targetExists(join(dir, ".mcp.json"))),
      "precondition: no .mcp.json",
    );

    // First refresh backfills it and reports it under --json.
    const r = await runAgent(dir, ["refresh", "--json"]);
    assertEquals(r.code, 0, r.output);
    const refreshed = decodeCliResult(r.stdout, "refresh");
    assertResultDataKey(refreshed, "mcp_wired");
    const data = refreshed.data;
    assert(data.mcp_wired.includes(".mcp.json"), r.stdout);
    const mcp = decodeWith(
      McpConfigSchema,
      await Deno.readTextFile(join(dir, ".mcp.json")),
    );
    assertEquals(mcp.mcpServers.discern.command, "discern");

    // Second refresh is a clean no-op for MCP (already present).
    const r2 = await runAgent(dir, ["refresh", "--json"]);
    const unchanged = decodeCliResult(r2.stdout, "refresh");
    assertResultDataKey(unchanged, "mcp_wired");
    assertEquals(unchanged.data.mcp_wired, []);
  });
});

Deno.test("engine refresh refuses malformed co-owned MCP JSON without clobbering it", async () => {
  await withTempDir(async (dir) => {
    await scaffoldEngine(dir);
    const malformed = '{ "mcpServers": { "other": true, }, }\n';
    await Deno.writeTextFile(join(dir, ".mcp.json"), malformed);

    const r = await runAgent(dir, ["refresh", "--json"]);
    assertEquals(r.code, 1, r.output);
    const res = decodeCliResult(r.stdout, "refresh");
    assertResultDataKey(res, "errors");
    assertEquals(res.ok, false);
    assertEquals(res.error, "partial_refresh");
    assertStringIncludes(res.data.errors.join("\n"), ".mcp.json");
    assertStringIncludes(res.data.errors.join("\n"), "malformed JSON");
    const firstError = res.data.errors[0];
    assert(typeof firstError === "string", r.stdout);
    assertHasHint(res, HINTS["refresh-artifact-failed"], {
      message: firstError,
    });
    assertEquals(await Deno.readTextFile(join(dir, ".mcp.json")), malformed);
  });
});

Deno.test("engine refresh: the FIRST MCP install surfaces a restart hint; a re-apply does not", async () => {
  await withTempDir(async (dir) => {
    await scaffoldEngine(dir);

    const first = await runAgent(dir, ["refresh", "--json"]);
    assertEquals(first.code, 0, first.output);
    assertHasHint(
      decodeCliResult(first.stdout, "refresh"),
      HINTS["refresh-mcp-first-install"],
    );

    // Re-applying over the existing install must NOT repeat the restart hint.
    const second = await runAgent(dir, ["refresh", "--json"]);
    assertLacksHint(
      decodeCliResult(second.stdout, "refresh"),
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
      decodeCliResult(first.stdout, "refresh"),
      HINTS["refresh-commit-tracked-artifacts"],
    );

    // A byte-identical re-apply still reports the Agent file as written in data,
    // but it changed no tracked artifact and must not repeat the commit advice.
    const unchanged = await runAgent(dir, ["refresh", "--json"]);
    assertEquals(unchanged.code, 0, unchanged.output);
    assertLacksHint(
      decodeCliResult(unchanged.stdout, "refresh"),
      HINTS["refresh-commit-tracked-artifacts"],
    );

    // A later source edit changes the compiled Agent file without reinstalling
    // MCP. The commit advice is driven by that tracked change, not by first setup.
    await ensureDir(join(dir, "discern"));
    await Deno.writeTextFile(
      join(dir, "discern/instructions.md"),
      "# Project instructions\nKeep the refreshed copy with this source.\n",
    );
    const changed = await runAgent(dir, ["refresh", "--json"]);
    assertEquals(changed.code, 0, changed.output);
    const envelope = decodeCliResult(changed.stdout, "refresh");
    assertHasHint(envelope, HINTS["refresh-commit-tracked-artifacts"]);
    assertLacksHint(envelope, HINTS["refresh-mcp-first-install"]);
  });
});

Deno.test("engine refresh: materializes skills even with no instruction sources (jobs are independent)", async () => {
  await withTempDir(async (dir) => {
    await scaffoldEngine(dir);
    // A fresh scaffold has no `instructions.md` source at all: job 1 compiles only
    // the built-in instructions, but job 2 (skills) must still run.
    assert(
      !(await targetExists(join(dir, "instructions.md"))),
      "precondition: no source",
    );

    const r = await runAgent(dir, ["refresh"]);
    assertEquals(r.code, 0, r.output);
    assert(
      await targetExists(
        join(dir, ".claude/skills/discern-write-adr/SKILL.md"),
      ),
      `skills must materialize independently of instruction compilation\n${r.output}`,
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
      await targetExists(join(dir, ".claude/skills/temp/SKILL.md")),
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
      await targetExists(
        join(dir, ".claude/skills/discern-write-adr/SKILL.md"),
      ),
      `bundled skills must stay materialized\n${r.output}`,
    );
    assertTerminalTextIncludes(r.stdout, "pruned 1 stale");
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
