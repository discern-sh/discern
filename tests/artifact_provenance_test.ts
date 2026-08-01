/**
 * Provenance boundary forcing functions. Registry classification drives both
 * sides: comment-capable output must carry the shared marker from its producer,
 * while whole-file agent context must not open with a generator comment.
 */

import { assert, assertEquals } from "@std/assert";
import { fromFileUrl, join } from "@std/path";
import { walk } from "@std/fs";
import {
  projectArtifactPaths,
  writtenArtifactClass,
} from "../src/lib/artifact_ownership.ts";
import { canonicalDiscernGitignoreBlock } from "../src/lib/agent_gitignore.ts";
import { renderConfigTemplateForConfig } from "../src/lib/config_reconcile.ts";
import {
  allSkillsDirs,
  DISCERN_MCP_SERVER,
  wireProviderMcp,
  wireProviderProjectRules,
  wireProviderWorktreeApp,
} from "../src/lib/providers.ts";
import { materializeSkills } from "../src/lib/skills.ts";
import {
  GENERATED_ARTIFACT_MARKER_PREFIX,
  generatedArtifactMarker,
} from "../src/shared/brand.ts";
import {
  type DiscernConfig,
  parseConfigOrThrow,
} from "../src/shared/config_schema.ts";
import { renderAgentFiles } from "../src/engine/guidance_render.ts";
import { writeEnvVar } from "../src/engine/worktree/env_file.ts";
import { withTempDir } from "./helpers.ts";

const REPO = fromFileUrl(new URL("../", import.meta.url));
const ALL_AGENT_CONFIG: DiscernConfig = parseConfigOrThrow(`
[project]
agents = ["claude_code", "codex", "gemini", "cursor", "copilot"]
`);

function assertNoOpeningGeneratorComment(
  text: string,
  path: string,
): void {
  const firstLine = text.split(/\r?\n/, 1)[0]?.trim() ?? "";
  assert(
    !firstLine.startsWith(GENERATED_ARTIFACT_MARKER_PREFIX),
    `${path} opens with the standard provenance marker`,
  );
  const opensWithComment = /^(?:#|<!--|\/\/|\/\*)/.test(firstLine);
  const namesGenerator = /(?:discern.*generated|generated.*discern)/i.test(
    firstLine,
  );
  assert(
    !(opensWithComment && namesGenerator),
    `${path} opens with a generator comment: ${firstLine}`,
  );
}

Deno.test("every comment-capable non-context artifact emits the standard marker", async () => {
  await withTempDir(async (root) => {
    const configTemplate = await Deno.readTextFile(
      join(REPO, "templates/discern.toml.tmpl"),
    );
    await Deno.writeTextFile(
      join(root, "discern.toml"),
      renderConfigTemplateForConfig(configTemplate, ALL_AGENT_CONFIG),
    );

    const gitignoreFragment = await Deno.readTextFile(
      join(REPO, "templates/.gitignore.fragment"),
    );
    await Deno.writeTextFile(
      join(root, ".gitignore"),
      canonicalDiscernGitignoreBlock(gitignoreFragment),
    );

    for (const file of ALL_AGENT_CONFIG.worktree.env_files) {
      assert(
        await writeEnvVar(
          root,
          "DISCERN_WORKTREE_ID",
          "provenance-test",
          [file],
          { create: true },
        ),
      );
    }

    await wireProviderMcp(
      root,
      ["codex"],
      DISCERN_MCP_SERVER,
      ALL_AGENT_CONFIG,
    );
    await wireProviderWorktreeApp(root, ["codex"]);
    await wireProviderProjectRules(root, ["codex"]);

    const entries = projectArtifactPaths(ALL_AGENT_CONFIG).filter((entry) =>
      writtenArtifactClass(entry) === "comment-capable-non-context"
    );
    assert(entries.length > 0, "expected comment-capable output to inspect");
    for (const entry of entries) {
      assertEquals(entry.pathKind, "file");
      const source = entry.writtenArtifact?.["comment-capable-non-context"];
      assert(
        typeof source === "string" && source.length > 0,
        `${entry.path} has no marker source`,
      );
      const text = await Deno.readTextFile(join(root, entry.path));
      assert(
        text.split(/\r?\n/).includes(generatedArtifactMarker(source)),
        `${entry.path} does not carry its registry-derived provenance marker`,
      );
    }
  });
});

Deno.test("context-loaded agent files and materialized skills open without generator comments", async () => {
  await withTempDir(async (root) => {
    const renderedAgentFiles = await renderAgentFiles(root, ALL_AGENT_CONFIG);
    await materializeSkills(
      root,
      ALL_AGENT_CONFIG,
      allSkillsDirs(),
    );

    const entries = projectArtifactPaths(ALL_AGENT_CONFIG).filter((entry) =>
      writtenArtifactClass(entry) === "context-loaded"
    );
    assert(entries.length > 0, "expected context-loaded output to inspect");
    for (const entry of entries) {
      if (entry.pathKind === "file") {
        const text = renderedAgentFiles.get(entry.path);
        assert(
          text !== undefined,
          `${entry.path} is classified as context-loaded but was not rendered`,
        );
        assertNoOpeningGeneratorComment(text, entry.path);
        continue;
      }
      for await (
        const file of walk(join(root, entry.path), { includeDirs: false })
      ) {
        assertNoOpeningGeneratorComment(
          await Deno.readTextFile(file.path),
          file.path,
        );
      }
    }
  });
});
