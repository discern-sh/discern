/**
 * Shared JSON layout. Every Shared JSON file the artifact registry declares is
 * seeded in a co-writer's layout, then passed through discern's real writers:
 * MCP wiring, hook wiring, and the uninstall strip. Each must keep that layout
 * while discern's entry comes and goes, so a new Shared JSON artifact enrolls
 * here and must be written through the one serializer.
 */

import { assert, assertEquals, assertNotEquals } from "@std/assert";
import { join } from "@std/path";
import { z } from "@zod/zod";
import {
  projectArtifactPaths,
  writtenArtifactClass,
} from "../src/lib/artifact_ownership.ts";
import { wireProviderHooks } from "../src/lib/provider_hooks.ts";
import {
  DISCERN_MCP_SERVER,
  PROVIDERS,
  renderProviderHookSeed,
  wireProviderMcp,
} from "../src/lib/providers.ts";
import { stripDiscernFromJsonSettings } from "../src/lib/settings_strip.ts";
import {
  DEFAULT_JSON_TEXT_STYLE,
  type JsonTextStyle,
  jsonTextStyle,
  renderJsonText,
  serializeSharedJson,
} from "../src/lib/shared_json.ts";
import {
  AGENT_NAMES,
  type DiscernConfig,
  parseConfigOrThrow,
  resolveConfiguredAgents,
} from "../src/shared/config_schema.ts";
import { declaredFileOwnership } from "../src/shared/file_ownership.ts";
import { decodeWith } from "./decode_cli_result.ts";
import { fakeEnv, withTempDir } from "./helpers.ts";

const ALL_AGENT_CONFIG: DiscernConfig = parseConfigOrThrow(`
[project]
agents = ${JSON.stringify([...AGENT_NAMES])}
`);

/** Another tool's content, which every writer must leave in place. */
const FOREIGN = { foreign: { keep: [1, 2], nested: { flag: true } } };

/** A written Shared JSON file: discern's entries beside the foreign content. */
const WrittenSchema = z.object({ foreign: z.unknown() }).passthrough();

const LAYOUTS: readonly { label: string; style: JsonTextStyle }[] = [
  { label: "two spaces", style: DEFAULT_JSON_TEXT_STYLE },
  {
    label: "four spaces",
    style: { ...DEFAULT_JSON_TEXT_STYLE, indent: "    " },
  },
  { label: "tabs", style: { ...DEFAULT_JSON_TEXT_STYLE, indent: "\t" } },
  {
    label: "CRLF without a final newline",
    style: { indent: "  ", eol: "\r\n", finalNewline: false },
  },
  { label: "a single line", style: { ...DEFAULT_JSON_TEXT_STYLE, indent: "" } },
];

/** Every Shared JSON file the registry declares for a project with every agent. */
function sharedJsonPaths(): string[] {
  return projectArtifactPaths(ALL_AGENT_CONFIG).filter((entry) =>
    declaredFileOwnership(entry) === "shared" &&
    writtenArtifactClass(entry) === "comment-incapable"
  ).map((entry) => {
    assertEquals(entry.pathKind, "file", entry.path);
    assert(entry.path.endsWith(".json"), `${entry.path} is not JSON`);
    return entry.path;
  });
}

/** The hook seed a provider merges into this path, if it is a hooks target. */
function hookTemplateFor(path: string): string | undefined {
  for (const name of AGENT_NAMES) {
    const hooks = PROVIDERS[name].hooks;
    if (hooks?.settingsFile === path) return renderProviderHookSeed(hooks);
  }
  return undefined;
}

Deno.test("jsonTextStyle reads indentation, line endings, and the final newline", () => {
  const value = { a: { b: [1] } };
  for (const { label, style } of LAYOUTS) {
    assertEquals(
      jsonTextStyle(renderJsonText(value, style)),
      style,
      label,
    );
  }
  assertEquals(jsonTextStyle(undefined), DEFAULT_JSON_TEXT_STYLE);
  assertEquals(jsonTextStyle(" \n"), DEFAULT_JSON_TEXT_STYLE);
  assertEquals(jsonTextStyle("{}\n"), DEFAULT_JSON_TEXT_STYLE);
  assertEquals(jsonTextStyle("{}"), {
    ...DEFAULT_JSON_TEXT_STYLE,
    finalNewline: false,
  });
  assertEquals(
    serializeSharedJson(value, undefined),
    `${JSON.stringify(value, null, 2)}\n`,
  );
});

for (const { label, style } of LAYOUTS) {
  Deno.test(`every Shared JSON file keeps a layout of ${label} through discern's writers`, async () => {
    await withTempDir(async (root) => {
      const paths = sharedJsonPaths();
      assert(paths.length > 0, "expected Shared JSON files to inspect");
      const seeded = renderJsonText(FOREIGN, style);
      for (const path of paths) {
        await Deno.mkdir(join(root, path, ".."), { recursive: true });
        await Deno.writeTextFile(join(root, path), seeded);
      }

      await wireProviderMcp(
        root,
        resolveConfiguredAgents(ALL_AGENT_CONFIG),
        DISCERN_MCP_SERVER,
        ALL_AGENT_CONFIG,
        fakeEnv(),
      );
      const hooks = await wireProviderHooks(root, ALL_AGENT_CONFIG);
      assertEquals(hooks.errors, []);

      for (const path of paths) {
        const written = await Deno.readTextFile(join(root, path));
        assertNotEquals(written, seeded, `discern wrote no entry into ${path}`);
        const value = decodeWith(WrittenSchema, written);
        assertEquals(value.foreign, FOREIGN.foreign, path);
        assertEquals(
          written,
          renderJsonText(value, style),
          `${path} lost its layout`,
        );

        const stripped = stripDiscernFromJsonSettings(written, {
          hasMcp: true,
          hooksTemplateText: hookTemplateFor(path),
        });
        assertEquals(stripped, seeded, `uninstall changed ${path}'s layout`);
      }
    });
  });
}
