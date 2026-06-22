/**
 * End-to-end integration against the REAL committed templates tree.
 *
 * Unlike fs_plan_test (which uses a stable synthetic fixture), this asserts the
 * installer scaffolds the actual harness: a parseable root `discern.toml` with
 * the schema stamped, materialized skills, and the merged settings. The real
 * tree grows as other agents add files; auto-discovery means new files don't
 * break this — we assert the stable foundation only.
 *
 * `assembleInitPlan` + `applyPlan` lay down only the seeds; bundled skills are the
 * binary's own artifacts, materialized separately (by `runInit`/worktree setup).
 * This test drives `materializeSkills` itself after applying the plan so it can
 * assert the materialized `.claude/skills/` surface a real install ends up with.
 */

import { assert, assertEquals, assertStringIncludes } from "@std/assert";
import { join } from "@std/path";
import { assembleInitPlan } from "../src/commands/init.ts";
import type { InitConfig } from "../src/lib/config.ts";
import { applyPlan } from "../src/lib/fs_plan.ts";
import { parseDiscernToml } from "../src/lib/toml_render.ts";
import { schemaFromRaw } from "../src/lib/schema.ts";
import { SCHEMA_VERSION } from "../src/lib/version.ts";
import { materializeSkills } from "../src/lib/skills.ts";
import { loadConfig } from "../src/shared/config_schema.ts";
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

    // 1. discern.toml exists and parses, with our identity substituted.
    const tomlText = await Deno.readTextFile(join(dir, "discern.toml"));
    const toml = parseDiscernToml(tomlText);
    assertEquals(toml.project.slug, "integration-demo");
    assertEquals(toml.project.branch_prefix, "agent/");
    // The agents list now lives under [guidance] (the author-once → compile
    // pipeline owns it), not [project]; read it straight from the parsed doc.
    const guidance = toml.raw.guidance as { agents?: unknown } | undefined;
    assertEquals(guidance?.agents, ["claude_code", "codex"]);
    // Every content token resolved. Runtime tokens use the @…@ delimiter now, so
    // NO {{…}} token should remain in the installed discern.toml at all.
    const leaked = [...tomlText.matchAll(/\{\{\s*([a-z0-9_]+)\s*\}\}/g)]
      .map((m) => m[1]);
    assertEquals(
      leaked,
      [],
      `unresolved content token(s) in discern.toml: ${leaked.join(", ")}`,
    );

    // 2. The schema version is stamped into the config's [meta] block.
    assertEquals(schemaFromRaw(toml.raw), SCHEMA_VERSION);

    // 3. The bundled skills materialize (copied) into .claude/skills/. The plan
    // lays down only seeds; skills are the binary's own artifacts, materialized
    // the way runInit/worktree setup do — so drive that step here, then assert.
    await materializeSkills(dir, await loadConfig(dir));
    const skillInfo = await Deno.stat(
      join(dir, ".claude/skills/write-adr/SKILL.md"),
    );
    assert(skillInfo.isFile, "the write-adr skill should be materialized");

    // 4. The brief was written verbatim under a header (at the root brief.md).
    assertStringIncludes(
      await Deno.readTextFile(join(dir, "brief.md")),
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
    await assertAbsent(join(dir, ".discern/engine"));
    await assertAbsent(join(dir, ".discern/manifest.json"));

    // 7. The binary's OWN template subtrees are NEVER seeded into the project tree
    // — they are materialized/read from the binary on demand. A regression here
    // re-pollutes the user's tracked tree, exactly what ADR 0024 removed for the
    // bootstrap assets. `docs/` is likewise lazy (laid by `discern bootstrap`).
    await assertAbsent(join(dir, "bootstrap"));
    await assertAbsent(join(dir, "skills"));
    await assertAbsent(join(dir, "guidance"));
    await assertAbsent(join(dir, "docs"));
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
