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
import { canonicalDiscernGitattributesBlock } from "../src/lib/agent_gitattributes.ts";
import { renderConfigTemplateForConfig } from "../src/lib/config_reconcile.ts";
import {
  agentArtifactPosture,
  allSkillsDirs,
  DISCERN_MCP_SERVER,
  wireProviderMcp,
  wireProviderProjectRules,
  wireProviderWorktreeApp,
} from "../src/lib/providers.ts";
import { materializeSkills } from "../src/lib/skills.ts";
import {
  DISCERN_NAME,
  DISCERN_URL,
  GENERATED_ARTIFACT_MARKER_PREFIX,
  generatedArtifactMarker,
  generatedArtifactMarkerBody,
  managedValuesMarker,
  stripGeneratedArtifactMarker,
} from "../src/shared/brand.ts";
import {
  type DiscernConfig,
  parseConfigOrThrow,
} from "../src/shared/config_schema.ts";
import { renderAgentFiles } from "../src/engine/instruction_render.ts";
import {
  WORKTREE_ENVIRONMENT_MARKER_SUBJECT,
  writeEnvVar,
} from "../src/engine/worktree/env_file.ts";
import { resolveGeneratedGroups } from "../src/shared/generated_artifacts.ts";
import { ARTIFACT_PROVENANCE_SOURCES } from "../src/shared/file_ownership.ts";
import { DISCERN_NO_ATTRIBUTION } from "../src/shared/env.ts";
import { fakeEnv, withTempDir } from "./helpers.ts";

const REPO = fromFileUrl(new URL("../", import.meta.url));
const ALL_AGENT_CONFIG: DiscernConfig = parseConfigOrThrow(`
[project]
agents = ["claude_code", "codex", "gemini", "cursor", "copilot"]

[generated.provenance]
paths = ["generated/**"]
run = "sh -c true"
`);

/** Reject opening comments that falsely present a human-authored artifact as generated. */
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

const ATTRIBUTION_CASES = [
  { label: "with attribution", env: fakeEnv() },
  {
    label: `with ${DISCERN_NO_ATTRIBUTION}`,
    env: fakeEnv({ [DISCERN_NO_ATTRIBUTION]: "1" }),
  },
] as const;

Deno.test("the generated-artifact marker has attributed and source-only forms", () => {
  const source = "the source registry";
  assertEquals(
    generatedArtifactMarkerBody(source, fakeEnv()),
    `Generated automatically by ${DISCERN_NAME} via ${source} | ${DISCERN_URL}`,
  );
  assertEquals(
    generatedArtifactMarkerBody(
      source,
      fakeEnv({ [DISCERN_NO_ATTRIBUTION]: "1" }),
    ),
    `Generated automatically via ${source}`,
  );
  assertEquals(
    generatedArtifactMarkerBody(
      source,
      fakeEnv({ [DISCERN_NO_ATTRIBUTION]: "" }),
    ),
    `Generated automatically by ${DISCERN_NAME} via ${source} | ${DISCERN_URL}`,
  );
});

Deno.test("marker removal recognizes exactly the two current forms", () => {
  const source = "the source registry";
  const legacy = `# ${DISCERN_NAME} | generated from ${source} | ` +
    `hand edits to this discern-owned content are overwritten | ${DISCERN_URL}`;
  const alternate =
    `# Generated automatically by ${DISCERN_NAME}. See: ${source} | ${DISCERN_URL}`;
  const attributed = generatedArtifactMarker(source, fakeEnv());
  const sourceOnly = generatedArtifactMarker(
    source,
    fakeEnv({ [DISCERN_NO_ATTRIBUTION]: "1" }),
  );
  assertEquals(
    stripGeneratedArtifactMarker(
      `${legacy}\r\n${alternate}\r\n${attributed}\r\n${sourceOnly}\r\npayload\r\n`,
      source,
    ),
    `${legacy}\r\n${alternate}\r\npayload\r\n`,
  );
});

for (const attributionCase of ATTRIBUTION_CASES) {
  Deno.test(`every comment-capable non-context artifact emits its registered marker ${attributionCase.label}`, async () => {
    await withTempDir(async (root) => {
      const configTemplate = await Deno.readTextFile(
        join(REPO, "templates/discern.toml.tmpl"),
      );
      await Deno.writeTextFile(
        join(root, "discern.toml"),
        renderConfigTemplateForConfig(
          configTemplate,
          ALL_AGENT_CONFIG,
          attributionCase.env,
        ),
      );

      const gitignoreFragment = await Deno.readTextFile(
        join(REPO, "templates/.gitignore.fragment"),
      );
      await Deno.writeTextFile(
        join(root, ".gitignore"),
        canonicalDiscernGitignoreBlock(
          gitignoreFragment,
          agentArtifactPosture(),
          attributionCase.env,
        ),
      );
      await Deno.writeTextFile(
        join(root, ".gitattributes"),
        canonicalDiscernGitattributesBlock(
          resolveGeneratedGroups(ALL_AGENT_CONFIG),
          [],
          [],
          attributionCase.env,
        ).text,
      );

      for (const file of ALL_AGENT_CONFIG.worktree.env_files) {
        assert(
          await writeEnvVar(
            root,
            "DISCERN_WORKTREE_ID",
            "provenance-test",
            [file],
            { create: true, env: attributionCase.env },
          ),
        );
      }

      await wireProviderMcp(
        root,
        ["codex"],
        DISCERN_MCP_SERVER,
        ALL_AGENT_CONFIG,
        attributionCase.env,
      );
      await wireProviderWorktreeApp(
        root,
        ["codex"],
        ALL_AGENT_CONFIG,
        attributionCase.env,
      );
      await wireProviderProjectRules(root, ["codex"], attributionCase.env);

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
        const marker = source ===
            ARTIFACT_PROVENANCE_SOURCES.worktreeEnvironment
          ? managedValuesMarker(
            WORKTREE_ENVIRONMENT_MARKER_SUBJECT,
            source,
            attributionCase.env,
          )
          : generatedArtifactMarker(source, attributionCase.env);
        assert(
          text.split(/\r?\n/).includes(marker),
          `${entry.path} does not carry its registry-derived provenance marker`,
        );
      }
    });
  });
}

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
