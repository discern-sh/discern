/**
 * Sentinel-render leakage guard (ADR 0102): compile the built-in guidance and
 * materialize EVERY bundled skill against a config that points each registry
 * path at an obviously fake location, then assert no registry DEFAULT survives
 * in any rendered output. A hard-coded `discern/docs/`-style literal in a
 * bundled skill or guidance section — the layout an agent can see instead of
 * the layout the user configured — fails here, not in front of a reviewer.
 *
 * The banned list and the sentinel config are both DERIVED from the paths
 * registry (`SOURCE_PATHS`), never hand-copied, so a newly registered source
 * path auto-enrols in the guard (ADR 0051).
 */

import { assert, assertEquals } from "@std/assert";
import { join, relative } from "@std/path";
import { walk } from "@std/fs";
import { parseConfigOrThrow } from "../src/shared/config_schema.ts";
import {
  SOURCE_PATH_NAMES,
  SOURCE_PATHS,
  type SourcePathName,
} from "../src/shared/paths_registry.ts";
import { renderAgentFiles } from "../src/engine/guidance_render.ts";
import { materializeSkills } from "../src/lib/skills.ts";
import { skillsDirsForAgents } from "../src/lib/providers.ts";
import { withTempDir } from "./helpers.ts";

/** The sentinel value for one registry entry, shaped like its default (same
 * trailing slash / extension), so the config parses and resolves identically. */
function sentinelFor(name: SourcePathName): string {
  const def = SOURCE_PATHS[name].defaultPath;
  if (def.endsWith("/")) {
    return `zz-sentinel-${name}/`;
  }
  const dot = def.lastIndexOf(".");
  return dot === -1
    ? `zz-sentinel-${name}`
    : `zz-sentinel-${name}${def.slice(dot)}`;
}

/**
 * TOML pointing every KEYED registry path at its sentinel (a keyless entry —
 * the brief — has nothing to repoint). `guidance.sources` is the one
 * list-typed key and gets a list literal; a future list-typed entry fails the
 * config parse loudly, telling its author to teach this builder the shape.
 */
function sentinelToml(): string {
  const lines = ['guidance.agents = ["claude_code"]'];
  for (const name of SOURCE_PATH_NAMES) {
    const key = SOURCE_PATHS[name].key;
    if (key === null) {
      continue;
    }
    const value = sentinelFor(name);
    lines.push(
      key === "guidance.sources"
        ? `${key} = ["${value}"]`
        : `${key} = "${value}"`,
    );
  }
  return `${lines.join("\n")}\n`;
}

Deno.test("sentinel render: no registry default survives in compiled guidance or materialized skills", async () => {
  await withTempDir(async (root) => {
    const config = parseConfigOrThrow(sentinelToml());
    const defaults = SOURCE_PATH_NAMES.map((n) => SOURCE_PATHS[n].defaultPath);

    // Rendered surface 1: the compiled agent files (in memory — the writer and
    // the currency check share this exact content).
    const outputs: Array<[string, string]> = [];
    for (const [rel, body] of await renderAgentFiles(root, config)) {
      outputs.push([rel, body]);
    }
    assert(outputs.length > 0, "no agent file rendered — vacuous guard");

    // Rendered surface 2: every bundled skill, materialized for real.
    const dirs = skillsDirsForAgents(["claude_code"]);
    const materialized = await materializeSkills(root, config, dirs);
    assert(
      materialized.copied > 0,
      "no bundled skill materialized — vacuous guard",
    );
    assertEquals(materialized.errors, []);
    for (const rel of dirs) {
      for await (const e of walk(join(root, rel), { includeDirs: false })) {
        outputs.push([relative(root, e.path), await Deno.readTextFile(e.path)]);
      }
    }

    const leaks: string[] = [];
    for (const [rel, text] of outputs) {
      for (const def of defaults) {
        if (text.includes(def)) {
          leaks.push(`${rel} leaks the registry default "${def}"`);
        }
      }
    }
    assertEquals(
      leaks,
      [],
      `a registry default survived sentinel rendering — replace the literal with its {{var}} token:\n  ${
        leaks.join("\n  ")
      }`,
    );

    // Sanity: rendering really spoke the sentinel layout (guards against a
    // silently-empty render passing vacuously).
    const docsSentinel = sentinelFor("docs");
    assert(
      outputs.some(([, text]) => text.includes(docsSentinel)),
      `no rendered output names ${docsSentinel} — did rendering happen?`,
    );
  });
});
