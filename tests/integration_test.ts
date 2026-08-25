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
 * binary's own artifacts, materialized separately (by `runSetup`/worktree setup).
 * This test drives `materializeSkills` itself after applying the plan so it can
 * assert the materialized `.claude/skills/` surface a real install ends up with.
 */

import { assert, assertEquals, assertStringIncludes } from "@std/assert";
import { z } from "@zod/zod";
import { join } from "@std/path";
import { assembleInitPlan } from "../src/commands/setup.ts";
import {
  defaultDocumentationScopePaths,
  defaultInstructionScopePaths,
  type SetupConfig,
} from "../src/lib/config.ts";
import { applyPlan } from "../src/lib/fs_plan.ts";
import { parseDiscernToml } from "../src/lib/toml_render.ts";
import { schemaFromRaw } from "../src/lib/schema.ts";
import { SCHEMA_VERSION } from "../src/lib/version.ts";
import { materializeSkills } from "../src/lib/skills.ts";
import { skillsDirsForAgents } from "../src/lib/providers.ts";
import { instructionAgents } from "../src/engine/instruction_render.ts";
import { loadConfig } from "../src/shared/config_schema.ts";
import { SOURCE_PATHS } from "../src/shared/paths_registry.ts";
import { ARTIFACT_PROVENANCE_SOURCES } from "../src/shared/file_ownership.ts";
import { generatedArtifactMarker } from "../src/shared/brand.ts";
import { DISCERN_NO_ATTRIBUTION } from "../src/shared/env.ts";
import { decodeWith } from "./decode_cli_result.ts";

const HookGroupSchema = z.object({
  hooks: z.array(z.object({
    type: z.string(),
    command: z.string(),
    timeout: z.number().optional(),
  })),
});
const ClaudeSettingsSchema = z.object({
  hooks: z.object({
    SessionStart: z.array(HookGroupSchema),
    WorktreeCreate: z.array(HookGroupSchema),
    WorktreeRemove: z.array(HookGroupSchema),
  }),
});
import { fakeEnv, REAL_TEMPLATES, withTempDir } from "./helpers.ts";

/** A resolved config for a non-interactive integration scaffold. */
function integrationConfig(): SetupConfig {
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
    const attributes = plan.ops.find((op) => op.targetRel === ".gitattributes");
    assert(attributes !== undefined);
    assertEquals(attributes.kind, "reconcile-gitattributes");
    assertEquals(attributes.disposition, "create");
    await applyPlan(plan);

    assertStringIncludes(
      await Deno.readTextFile(join(dir, ".gitattributes")),
      "discern/map/**/*.md diff=markdown",
    );

    // 1. discern.toml exists and parses, with our identity substituted.
    const tomlText = await Deno.readTextFile(join(dir, "discern.toml"));
    const toml = parseDiscernToml(tomlText);
    assertEquals(toml.project.slug, "integration-demo");
    assertEquals(toml.repository.branch_prefix, "agent/");
    // The agents list lives under [project] — agents operate at the project
    // level, so project identity owns which integrations are enabled.
    assertEquals(toml.project.agents, ["claude_code", "codex"]);
    // Every content token resolved. Runtime tokens use the @…@ delimiter now, so
    // NO {{…}} token should remain in the installed discern.toml at all.
    const leaked = [...tomlText.matchAll(/\{\{\s*([a-z0-9_]+)\s*\}\}/g)]
      .map((m) => m[1]);
    assertEquals(
      leaked,
      [],
      `unresolved content token(s) in discern.toml: ${leaked.join(", ")}`,
    );
    const scopes = toml.raw.scopes as Record<
      string,
      { paths?: unknown; neutral?: unknown }
    >;
    assertEquals(Object.keys(scopes), ["map", "instructions"]);
    assertEquals(scopes.map?.paths, defaultDocumentationScopePaths());
    assertEquals(scopes.map?.neutral, true);
    assertEquals(scopes.instructions?.paths, defaultInstructionScopePaths());
    assertEquals(scopes.instructions?.neutral, true);
    const acceptance = toml.raw.acceptance as
      | { pre_authorized?: unknown }
      | undefined;
    assertEquals(acceptance?.pre_authorized, []);
    assertStringIncludes(tomlText, 'pre_authorized = [] # e.g. ["map"]');

    // 2. The schema version is stamped into the config's [meta] block.
    assertEquals(schemaFromRaw(toml.raw), SCHEMA_VERSION);

    // 3. The bundled skills materialize (copied) into each configured agent's
    // skills dir. The plan lays down only seeds; skills are the binary's own
    // artifacts, materialized the way runSetup/worktree setup do — so drive that
    // step here (for the project's real agent set), then assert.
    const cfg = await loadConfig(dir);
    await materializeSkills(
      dir,
      cfg,
      skillsDirsForAgents(instructionAgents(cfg)),
    );
    const skillInfo = await Deno.stat(
      join(dir, ".claude/skills/discern-write-adr/SKILL.md"),
    );
    assert(
      skillInfo.isFile,
      "the discern-write-adr skill should be materialized",
    );

    // 4. The brief was written verbatim under a header (at the root brief.md).
    assertStringIncludes(
      await Deno.readTextFile(join(dir, "discern/brief.md")),
      "An end-to-end integration brief.",
    );

    // 5. The merged settings parse and wire the worktree hooks to the binary's
    // own dispatches (the create/remove hooks read their JSON payload natively —
    // no jq, no branch_prefix substitution; the branch prefix is asserted on the
    // rendered discern.toml above). See ADR 0039.
    const settings = decodeWith(
      ClaudeSettingsSchema,
      await Deno.readTextFile(join(dir, ".claude/settings.json")),
    );
    assert(typeof settings === "object" && settings !== null);
    assert(Array.isArray(settings.hooks.WorktreeCreate));
    assertStringIncludes(
      JSON.stringify(settings.hooks.WorktreeCreate),
      "worktree hook create",
    );
    assert(!/\bjq\b/.test(JSON.stringify(settings.hooks)));

    // 6. No committed shell engine is laid down — the engine lives in the binary.
    await assertAbsent(join(dir, "agent"));
    await assertAbsent(join(dir, ".discern/engine"));
    await assertAbsent(join(dir, ".discern/manifest.json"));

    // 7. The binary's OWN template subtrees are NEVER seeded into the project tree
    // — they are materialized/read from the binary on demand. A regression here
    // re-pollutes the user's tracked tree, exactly what ADR 0024 removed for the
    // bootstrap assets. The configured map is likewise lazy (laid by
    // `discern setup`).
    await assertAbsent(join(dir, "bootstrap"));
    await assertAbsent(join(dir, "skills"));
    await assertAbsent(join(dir, "instructions"));
    await assertAbsent(join(dir, SOURCE_PATHS.map.defaultPath));
  });
});

Deno.test("init plans the managed attributes block from generated fills", async () => {
  await withTempDir(async (dir) => {
    const plan = await assembleInitPlan({
      templatesDir: REAL_TEMPLATES,
      destDir: dir,
      config: integrationConfig(),
      fills: {
        generated: {
          bundle: {
            paths: ["generated/**"],
            run: "tool build-generated",
          },
        },
      },
    });
    const attributes = plan.ops.find((op) => op.targetRel === ".gitattributes");
    assert(attributes !== undefined);
    assertEquals(attributes.kind, "reconcile-gitattributes");
    assertEquals(attributes.disposition, "create");
    await applyPlan(plan);
    assertStringIncludes(
      await Deno.readTextFile(join(dir, ".gitattributes")),
      "generated/** merge=discern-generated",
    );
  });
});

Deno.test("init uses source-only markers when attribution is disabled", async () => {
  await withTempDir(async (dir) => {
    const env = fakeEnv({ [DISCERN_NO_ATTRIBUTION]: "1" });
    const plan = await assembleInitPlan({
      templatesDir: REAL_TEMPLATES,
      destDir: dir,
      config: integrationConfig(),
      fills: {
        generated: {
          bundle: {
            paths: ["generated/**"],
            run: "tool build-generated",
          },
        },
      },
      env,
    });
    await applyPlan(plan);

    for (
      const [path, source] of [
        ["discern.toml", ARTIFACT_PROVENANCE_SOURCES.config],
        [".gitignore", ARTIFACT_PROVENANCE_SOURCES.gitignore],
        [".gitattributes", ARTIFACT_PROVENANCE_SOURCES.gitattributes],
      ] as const
    ) {
      const text = await Deno.readTextFile(join(dir, path));
      assertStringIncludes(text, generatedArtifactMarker(source, env));
      assert(!text.includes("Generated automatically by discern via"), path);
    }
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
