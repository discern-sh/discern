/**
 * Config-load recovery across delivery surfaces. Root unknowns are ambiguous:
 * they may be typos, or they may be valid config introduced after a long-lived
 * process started. Strict loading still refuses them; the result preserves the
 * named section and routes both recovery choices without rewriting the file.
 */

import { assert, assertEquals, assertStringIncludes } from "@std/assert";
import { join } from "@std/path";
import { parse as parseToml } from "@std/toml";
import { z } from "@zod/zod";
import { runTool, TOOLS, WorkingRoot } from "../src/engine/mcp/server.ts";
import { KIT_VERSION } from "../src/lib/version.ts";
import {
  configSchema,
  configSchemaIssues,
  ConfigValidationError,
  parseConfig,
} from "../src/shared/config_schema.ts";
import { HINTS } from "../src/shared/hints.ts";
import { assertTerminalTextIncludes, withTempDir } from "./helpers.ts";
import {
  gitInit,
  runAgent,
  scaffoldEngine,
  writeConfig,
} from "./engine_helpers.ts";
import { assertHasHint, assertLacksHint } from "./hint_asserts.ts";
import { assertHasMcpHint, assertLacksMcpHint } from "./mcp_hint_asserts.ts";

const TYPO_SECTION = "projcet";

/** Read the shared config-issue payload from a serialized result. */
function configIssues(
  result: Record<string, unknown>,
): Record<string, unknown>[] {
  const data = result.data as
    | { issues?: Record<string, unknown>[] }
    | undefined;
  return data?.issues ?? [];
}

/** Assert the complete root-ambiguity recovery account on one text surface. */
function assertUnknownRootRecovery(
  text: string,
  section = TYPO_SECTION,
): void {
  const lower = text.toLowerCase();
  assertStringIncludes(text, "running discern process");
  assertStringIncludes(text, `[${section}]`);
  assertStringIncludes(lower, "restart");
  assertStringIncludes(lower, "reload");
  assertStringIncludes(lower, "binary");
  assertStringIncludes(lower, "section typo");
  assertStringIncludes(text, "config-reference");
  assertStringIncludes(text, "doctor");
}

Deno.test("unknown root section keeps strict CLI failure and recovery on human, JSON, Markdown, and update Markdown", async () => {
  await withTempDir(async (dir) => {
    await scaffoldEngine(dir, { bootstrapped: true });
    await gitInit(dir);
    const configPath = join(dir, "discern.toml");

    const known = await Deno.readTextFile(configPath);
    const healthy = await runAgent(dir, ["status", "--json"]);
    assertEquals(healthy.code, 0, healthy.output);
    const healthyEnvelope = JSON.parse(healthy.stdout);
    assertEquals(healthyEnvelope.error, undefined);
    assertLacksHint(
      healthyEnvelope,
      HINTS["config-unknown-root-sections"],
      { sections: [TYPO_SECTION] },
    );
    assertEquals(await Deno.readTextFile(configPath), known);

    const broken = `${known}\n[${TYPO_SECTION}]\nvalue = true\n`;
    await Deno.writeTextFile(configPath, broken);

    const json = await runAgent(dir, ["status", "--json"]);
    assertEquals(json.code, 1, json.output);
    const envelope = JSON.parse(json.stdout) as Record<string, unknown>;
    assertEquals(json.stderr, "", "machine recovery emits no human narration");
    assertEquals(
      json.stdout.trim(),
      JSON.stringify(envelope),
      "machine recovery remains one compact result envelope",
    );
    assertEquals(envelope.error, "invalid_config");
    assertEquals(configIssues(envelope), [{
      kind: "unknown_root_section",
      path: TYPO_SECTION,
      message:
        `the running discern process does not recognize the root section [${TYPO_SECTION}].`,
    }]);
    const expectedRecovery = assertHasHint(
      envelope,
      HINTS["config-unknown-root-sections"],
      { sections: [TYPO_SECTION] },
    );
    assertEquals(
      HINTS["config-unknown-root-sections"].family,
      "restart-session",
    );
    assertUnknownRootRecovery(expectedRecovery);

    const human = await runAgent(dir, ["status"]);
    assertEquals(human.code, 1, human.output);
    assertStringIncludes(human.stderr, expectedRecovery);
    assertUnknownRootRecovery(human.stderr);

    const markdown = await runAgent(dir, ["status", "--markdown"]);
    assertEquals(markdown.code, 1, markdown.output);
    assertTerminalTextIncludes(markdown.stdout, "# `discern status`");
    assertTerminalTextIncludes(markdown.stdout, "## Current state");
    assertTerminalTextIncludes(markdown.stdout, "Config issue");
    assertStringIncludes(markdown.stdout, expectedRecovery);
    assertUnknownRootRecovery(markdown.stdout);

    // Regression-only coverage for the settled update Markdown path: a config
    // refusal remains authored Markdown and never falls back to JSON.
    const updateMarkdown = await runAgent(dir, ["update", "--markdown"]);
    assertEquals(updateMarkdown.code, 1, updateMarkdown.output);
    assertTerminalTextIncludes(updateMarkdown.stdout, "# `discern update`");
    assert(!updateMarkdown.stdout.trimStart().startsWith("{"));
    assertUnknownRootRecovery(updateMarkdown.stdout);

    assertEquals(
      await Deno.readTextFile(configPath),
      broken,
      "no refusing surface may rewrite config it cannot understand",
    );
  });
});

Deno.test("nested unknown key remains a precise typo control without restart recovery", async () => {
  await withTempDir(async (dir) => {
    await scaffoldEngine(dir, { bootstrapped: true });
    await writeConfig(
      dir,
      '[meta]\nbootstrapped = true\n\n[project]\nslgu = "demo"\n',
    );
    await gitInit(dir);
    const configPath = join(dir, "discern.toml");
    const before = await Deno.readTextFile(configPath);

    const run = await runAgent(dir, ["status", "--json"]);
    assertEquals(run.code, 1, run.output);
    const result = JSON.parse(run.stdout) as Record<string, unknown>;
    assertEquals(result.error, "invalid_config");
    assertEquals(configIssues(result), [{
      path: "project.slgu",
      message: "unknown key(s) in [project]: slgu",
    }]);
    assertHasHint(result, HINTS["config-correct-validation"]);
    assertLacksHint(
      result,
      HINTS["config-unknown-root-sections"],
      { sections: ["project"] },
    );
    assertEquals(await Deno.readTextFile(configPath), before);
  });
});

Deno.test("long-lived MCP maps an unknown root to config recovery and leads with proven restart", async () => {
  await withTempDir(async (dir) => {
    await scaffoldEngine(dir, { bootstrapped: true });
    await writeConfig(dir, "[meta]\nbootstrapped = true\n");
    await gitInit(dir);
    const configPath = join(dir, "discern.toml");
    const before = await Deno.readTextFile(configPath);

    const status = TOOLS.find((tool) => tool.name === "discern_status");
    assert(status !== undefined, "discern_status must exist");
    const canonical = Object.entries(configSchema.shape);
    // [meta] is the one deliberate MCP-fixture exclusion: the baseline needs its
    // bootstrapped flag to reach the tool. The schema-level guard above still
    // covers it. Every other current and future root section runs this full
    // long-lived-process simulation without joining a hand-maintained list.
    const simulated = canonical.filter(([name]) => name !== "meta");
    assert(
      simulated.length > 0,
      "the canonical config needs a non-meta section",
    );
    for (const [introducedSection] of simulated) {
      const staleSchema = z.strictObject(Object.fromEntries(
        canonical.filter(([name]) => name !== introducedSection),
      ));
      const staleStatus = {
        ...status,
        run: async (...args: Parameters<typeof status.run>) => {
          const root = args[0];
          const parsed = parseToml(
            await Deno.readTextFile(join(root, "discern.toml")),
          );
          const issues = configSchemaIssues(parsed, staleSchema);
          if (issues.length > 0) {
            throw new ConfigValidationError(issues);
          }
          return await status.run(...args);
        },
      };

      // The same long-lived process first reads config from before the newer root
      // section existed. It succeeds and leaves the known bytes untouched.
      let installedVersion = KIT_VERSION;
      const working = new WorkingRoot(dir);
      const resolveInstalledVersion = (): Promise<string | undefined> =>
        Promise.resolve(installedVersion);
      const healthy = await runTool(
        staleStatus,
        working,
        {},
        undefined,
        resolveInstalledVersion,
      );
      assertEquals(healthy.isError, false);
      assertLacksMcpHint(
        healthy.structuredContent,
        HINTS["config-unknown-root-sections"],
        { sections: [introducedSection] },
      );
      assertLacksMcpHint(
        healthy.structuredContent,
        HINTS["mcp-version-mismatch"],
        { serverVersion: KIT_VERSION, installedVersion: KIT_VERSION },
      );
      assertEquals(await Deno.readTextFile(configPath), before);

      // A newer build adds any canonical root section omitted by the stale schema.
      // The current schema accepts it; the still-running old schema refuses it.
      const broken = `${before}\n[${introducedSection}]\n`;
      assert(parseConfig(broken).config !== undefined);
      await Deno.writeTextFile(configPath, broken);
      installedVersion = `${KIT_VERSION}-newer`;
      const result = await runTool(
        staleStatus,
        working,
        {},
        undefined,
        resolveInstalledVersion,
      );

      assertEquals(result.isError, true);
      assertEquals(result.structuredContent.error, "invalid_config");
      assertEquals(configIssues(result.structuredContent), [{
        kind: "unknown_root_section",
        path: introducedSection,
        message:
          `the running discern process does not recognize the root section [${introducedSection}].`,
      }]);
      const hints = result.structuredContent.hints as string[];
      const expectedRestart = assertHasMcpHint(
        result.structuredContent,
        HINTS["mcp-version-mismatch"],
        { serverVersion: KIT_VERSION, installedVersion },
      );
      const expectedConfig = assertHasMcpHint(
        result.structuredContent,
        HINTS["config-unknown-root-sections"],
        { sections: [introducedSection] },
      );
      assertEquals(hints[0], expectedRestart);
      assertUnknownRootRecovery(hints.join("\n"), introducedSection);
      const content = result.content[0];
      assert(content?.type === "text");
      assertStringIncludes(content.text, "# `discern status`");
      assertStringIncludes(content.text, expectedRestart);
      assertStringIncludes(content.text, expectedConfig);
      assertUnknownRootRecovery(content.text, introducedSection);
      assertEquals(await Deno.readTextFile(configPath), broken);
      await Deno.writeTextFile(configPath, before);
    }
  });
});
