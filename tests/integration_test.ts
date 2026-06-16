/**
 * End-to-end integration against the REAL committed templates tree.
 *
 * Unlike fs_plan_test (which uses a stable synthetic fixture), this asserts the
 * installer scaffolds the actual harness: a parseable `icculus.toml` and a
 * working (executable) `bin/agent`. The real tree grows as other agents add
 * files; auto-discovery means new files don't break this — we assert the stable
 * foundation only.
 */

import { assert, assertEquals, assertStringIncludes } from "@std/assert";
import { join } from "@std/path";
import { assembleInitPlan } from "../src/commands/init.ts";
import { applyPlan } from "../src/lib/fs_plan.ts";
import { parseIcculusToml } from "../src/lib/toml_render.ts";
import { parseManifest } from "../src/lib/manifest.ts";
import { REAL_TEMPLATES, withTempDir } from "./helpers.ts";

/** A resolved config for a non-interactive integration scaffold. */
function integrationConfig() {
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

    // 1. icculus.toml exists and parses, with our identity substituted.
    const tomlText = await Deno.readTextFile(join(dir, "icculus.toml"));
    const toml = parseIcculusToml(tomlText);
    assertEquals(toml.project.slug, "integration-demo");
    assertEquals(toml.project.branch_prefix, "agent/");
    assertEquals(toml.project.agents, ["claude_code", "codex"]);
    // Every content token resolved. The only token that may legitimately remain
    // is {{db}} — the runtime token the worktree engine expands per-worktree,
    // which appears in the [worktree.db] example comments.
    const leaked = [...tomlText.matchAll(/\{\{\s*([a-z0-9_]+)\s*\}\}/g)]
      .map((m) => m[1])
      .filter((name) => name !== "db");
    assertEquals(
      leaked,
      [],
      `unresolved content token(s) in icculus.toml: ${leaked.join(", ")}`,
    );

    // 2. bin/agent exists and is executable.
    const agentInfo = await Deno.stat(join(dir, "bin/agent"));
    assert(agentInfo.isFile);
    assertEquals((agentInfo.mode ?? 0) & 0o111 ? "exec" : "noexec", "exec");

    // 3. The manifest is present, parses, and records managed engine files.
    const manifest = parseManifest(
      await Deno.readTextFile(join(dir, ".icculus/manifest.json")),
    );
    assertEquals(manifest.project.slug, "integration-demo");
    assert(
      manifest.managed.some((e) => e.path === "bin/agent"),
      "manifest should track bin/agent as managed",
    );
    assert(
      manifest.managed.every((e) => /^[0-9a-f]{64}$/.test(e.sha256)),
      "every managed entry should carry a 64-hex sha256",
    );

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
  });
});

Deno.test("init then upgrade over the real tree leaves managed files up to date", async () => {
  await withTempDir(async (dir) => {
    const plan = await assembleInitPlan({
      templatesDir: REAL_TEMPLATES,
      destDir: dir,
      config: integrationConfig(),
    });
    await applyPlan(plan);

    const manifest = parseManifest(
      await Deno.readTextFile(join(dir, ".icculus/manifest.json")),
    );
    const { buildPlan } = await import("../src/lib/fs_plan.ts");
    const { recordedHash } = await import("../src/lib/manifest.ts");

    const up = await buildPlan({
      templatesDir: REAL_TEMPLATES,
      destDir: dir,
      tokens: {
        project_name: "Integration Demo",
        project_slug: "integration-demo",
        branch_prefix: "agent/",
        agents_array: '"claude_code", "codex"',
        gotchas_doc: "docs/80-development/finish-gate-gotchas.md",
        scopes_neutral: '"docs/", ".ai/", ".claude/"',
        scopes_web: '"src/**", "app/**"',
        scopes_previewable: '"public/**"',
        kit_version: manifest.kit_version,
      },
      mode: "upgrade",
      recordedHash: (rel) => recordedHash(manifest, rel),
    });

    // Right after init, every managed file matches its recorded hash: all skip.
    const nonSkip = up.ops.filter((o) => o.disposition !== "skip");
    assertEquals(
      nonSkip.map((o) => o.targetRel),
      [],
      "a freshly-initialized tree should have nothing to upgrade",
    );
  });
});
