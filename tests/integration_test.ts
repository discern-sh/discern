/**
 * End-to-end integration against the REAL committed templates tree.
 *
 * Unlike fs_plan_test (which uses a stable synthetic fixture), this asserts the
 * installer scaffolds the actual harness: a parseable `.icculus/config.toml` with
 * the schema stamped, materialized skills, and the merged settings. The real
 * tree grows as other agents add files; auto-discovery means new files don't
 * break this — we assert the stable foundation only.
 */

import { assert, assertEquals, assertStringIncludes } from "@std/assert";
import { join } from "@std/path";
import { assembleInitPlan } from "../src/commands/init.ts";
import type { InitConfig } from "../src/lib/config.ts";
import { applyPlan } from "../src/lib/fs_plan.ts";
import { parseIcculusToml } from "../src/lib/toml_render.ts";
import { schemaFromRaw } from "../src/lib/schema.ts";
import { SCHEMA_VERSION } from "../src/lib/version.ts";
import { REAL_TEMPLATES, withTempDir } from "./helpers.ts";

/** A resolved config for a non-interactive integration scaffold. */
function integrationConfig(): InitConfig {
  return {
    projectName: "Integration Demo",
    slug: "integration-demo",
    branchPrefix: "agent/",
    sourceGlobs: ["src/**", "app/**"],
    brief: "An end-to-end integration brief.",
    agents: ["claude_code", "codex"] as ("claude_code" | "codex")[],
  };
}

Deno.test("init scaffolds the real templates into a working harness", async () => {
  await withTempDir(async (dir) => {
    const plan = await assembleInitPlan({
      templatesDir: REAL_TEMPLATES,
      destDir: dir,
      config: integrationConfig(),
    });
    await applyPlan(plan);

    // 1. .icculus/config.toml exists and parses, with our identity substituted.
    const tomlText = await Deno.readTextFile(join(dir, ".icculus/config.toml"));
    const toml = parseIcculusToml(tomlText);
    assertEquals(toml.project.slug, "integration-demo");
    assertEquals(toml.project.branch_prefix, "agent/");
    assertEquals(toml.project.agents, ["claude_code", "codex"]);
    // Every content token resolved. Runtime tokens use the @…@ delimiter now, so
    // NO {{…}} token should remain in the installed .icculus/config.toml at all.
    const leaked = [...tomlText.matchAll(/\{\{\s*([a-z0-9_]+)\s*\}\}/g)]
      .map((m) => m[1]);
    assertEquals(
      leaked,
      [],
      `unresolved content token(s) in .icculus/config.toml: ${
        leaked.join(", ")
      }`,
    );

    // 2. The schema version is stamped into the config's [meta] block.
    assertEquals(schemaFromRaw(toml.raw), SCHEMA_VERSION);

    // 3. The bundled skills are materialized under .icculus/skills/.
    const skillInfo = await Deno.stat(
      join(dir, ".icculus/skills/bootstrap/SKILL.md"),
    );
    assert(skillInfo.isFile, "the bootstrap skill should be materialized");

    // 4. The brief was written verbatim under a header.
    assertStringIncludes(
      await Deno.readTextFile(join(dir, ".icculus/brief.md")),
      "An end-to-end integration brief.",
    );

    // 5. The merged settings parse and carry the branch_prefix substitution.
    const settings = JSON.parse(
      await Deno.readTextFile(join(dir, ".claude/settings.json")),
    );
    assert(typeof settings === "object" && settings !== null);
    assert(Array.isArray(settings.hooks?.WorktreeCreate));
    assertStringIncludes(
      JSON.stringify(settings.hooks.WorktreeCreate),
      "agent/",
    );

    // 6. No committed shell engine is laid down — the engine lives in the binary.
    await assertAbsent(join(dir, "agent"));
    await assertAbsent(join(dir, ".icculus/engine"));
    await assertAbsent(join(dir, ".icculus/manifest.json"));
  });
});

/** Assert a path does NOT exist. */
async function assertAbsent(path: string): Promise<void> {
  let exists = true;
  try {
    await Deno.stat(path);
  } catch {
    exists = false;
  }
  assert(!exists, `expected ${path} not to be scaffolded`);
}
