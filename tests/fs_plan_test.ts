/**
 * The seed-only scaffolding engine against the synthetic fixture tree. These
 * tests own the behaviours the spec calls out: content + path token
 * substitution, `.tmpl` stripping, exec-bit preservation, settings deep-merge
 * into an existing file, `.gitignore` append idempotency, write-once seed
 * skipping, the always-overwrite materialization of `.icculus/skills/**`, and
 * dry-run-writes-nothing.
 *
 * They use the fixture (not the real templates) so they stay stable while other
 * agents fill the real tree.
 */

import { assert, assertEquals, assertStringIncludes } from "@std/assert";
import { join } from "@std/path";
import {
  applyPlan,
  buildPlan,
  isMaterialized,
  type Plan,
  planBrief,
} from "../src/lib/fs_plan.ts";
import {
  FIXTURE_TEMPLATES,
  modeOf,
  readTarget,
  targetExists,
  testTokens,
  withTempDir,
} from "./helpers.ts";

/** Build and apply an init plan over the fixture tree into `dir`. */
async function scaffold(dir: string): Promise<Plan> {
  const plan = await buildPlan({
    templatesDir: FIXTURE_TEMPLATES,
    destDir: dir,
    tokens: testTokens(),
  });
  await applyPlan(plan);
  return plan;
}

Deno.test("isMaterialized matches only the .icculus/skills/ prefix", () => {
  assert(isMaterialized(".icculus/skills/foo/SKILL.md"));
  assert(!isMaterialized(".icculus/guidelines/foo.md"));
  assert(!isMaterialized(".icculus/config.toml"));
  assert(!isMaterialized("docs/skills/x.md"));
});

Deno.test("init substitutes content tokens in *.tmpl files", async () => {
  await withTempDir(async (dir) => {
    await scaffold(dir);
    const toml = await readTarget(dir, ".icculus/config.toml");
    assertStringIncludes(toml, 'slug = "demo-app"');
    assertStringIncludes(toml, 'branch_prefix = "agent/"');
    assertStringIncludes(toml, 'agents = ["claude_code", "codex"]');
    // The @db@ runtime token (different delimiter) is preserved verbatim.
    assertStringIncludes(toml, 'clone = "createdb @db@"');
  });
});

Deno.test("init resolves the {{project_slug}} path token and strips .tmpl", async () => {
  await withTempDir(async (dir) => {
    await scaffold(dir);
    // Name carried the slug token; both the name token and .tmpl resolve.
    assert(await targetExists(dir, ".icculus/guidelines/demo-app.md"));
    assert(
      !(await targetExists(dir, ".icculus/guidelines/{{project_slug}}.md")),
    );
    const body = await readTarget(dir, ".icculus/guidelines/demo-app.md");
    assertStringIncludes(body, "# Demo App guidelines");
  });
});

Deno.test("init strips .tmpl from the config file name", async () => {
  await withTempDir(async (dir) => {
    await scaffold(dir);
    assert(await targetExists(dir, ".icculus/config.toml"));
    assert(!(await targetExists(dir, ".icculus/config.toml.tmpl")));
  });
});

Deno.test("init preserves the source exec bit (0755 recipe, 0644 lib)", async () => {
  await withTempDir(async (dir) => {
    await scaffold(dir);
    assertEquals(await modeOf(dir, "agent"), 0o755);
    assertEquals(await modeOf(dir, ".icculus/engine/recipe"), 0o755);
    assertEquals(await modeOf(dir, ".icculus/engine/lib/helper.sh"), 0o644);
  });
});

Deno.test("init forces agent and recipes executable even from a non-exec source", async () => {
  // Regression: the `deno compile` embedded filesystem reports every bundled
  // file as read-only (0444), which would strip the exec bit the contract files
  // need. The contract must restore it. We emulate that environment by building
  // a source tree whose dispatcher/recipe are deliberately 0644.
  await withTempDir(async (src) => {
    await Deno.mkdir(join(src, "bin"), { recursive: true });
    await Deno.mkdir(join(src, ".icculus/engine/lib"), { recursive: true });
    await Deno.writeTextFile(join(src, "agent"), "#!/bin/sh\necho hi\n");
    await Deno.writeTextFile(
      join(src, ".icculus/engine/recipe"),
      "#!/bin/sh\n",
    );
    await Deno.writeTextFile(
      join(src, ".icculus/engine/lib/helper.sh"),
      "x() { :; }\n",
    );
    await Deno.chmod(join(src, "agent"), 0o644);
    await Deno.chmod(join(src, ".icculus/engine/recipe"), 0o644);
    await Deno.chmod(join(src, ".icculus/engine/lib/helper.sh"), 0o644);

    await withTempDir(async (dir) => {
      const plan = await buildPlan({
        templatesDir: src,
        destDir: dir,
        tokens: testTokens(),
      });
      await applyPlan(plan);
      // Contract files restored to executable; the lib helper stays non-exec.
      assertEquals(await modeOf(dir, "agent"), 0o755);
      assertEquals(await modeOf(dir, ".icculus/engine/recipe"), 0o755);
      assertEquals(await modeOf(dir, ".icculus/engine/lib/helper.sh"), 0o644);
    });
  });
});

Deno.test("init copies a token-free file verbatim", async () => {
  await withTempDir(async (dir) => {
    await scaffold(dir);
    const recipe = await readTarget(dir, ".icculus/engine/recipe");
    assertStringIncludes(recipe, "fixture recipe v1");
    // No token machinery touched a verbatim file.
    assert(!recipe.includes("{{"));
  });
});

Deno.test("init creates .claude/settings.json from the template when absent", async () => {
  await withTempDir(async (dir) => {
    await scaffold(dir);
    const settings = JSON.parse(await readTarget(dir, ".claude/settings.json"));
    assertEquals(settings.permissions.deny, ["Read(./.env)"]);
    // The branch_prefix token was substituted inside the hook command.
    assertStringIncludes(
      settings.hooks.WorktreeCreate[0].hooks[0].command,
      "git worktree add -b agent/$name",
    );
  });
});

Deno.test("init deep-merges settings into an existing file without clobbering", async () => {
  await withTempDir(async (dir) => {
    // Pre-seed a user settings file with their own keys.
    await Deno.mkdir(join(dir, ".claude"), { recursive: true });
    await Deno.writeTextFile(
      join(dir, ".claude/settings.json"),
      JSON.stringify({
        model: "opus",
        permissions: { deny: ["Read(./secret)"] },
        hooks: {
          SessionStart: [{ hooks: [{ type: "command", command: "mine" }] }],
        },
      }),
    );
    await scaffold(dir);
    const settings = JSON.parse(await readTarget(dir, ".claude/settings.json"));
    // User scalar preserved.
    assertEquals(settings.model, "opus");
    // deny unioned: user's first, ours appended.
    assertEquals(settings.permissions.deny, ["Read(./secret)", "Read(./.env)"]);
    // SessionStart has both the user's hook and ours.
    assertEquals(settings.hooks.SessionStart.length, 2);
  });
});

Deno.test("settings merge is idempotent across a re-run (no dup hooks)", async () => {
  await withTempDir(async (dir) => {
    await scaffold(dir);
    await scaffold(dir);
    const settings = JSON.parse(await readTarget(dir, ".claude/settings.json"));
    assertEquals(settings.hooks.SessionStart.length, 1);
    assertEquals(settings.permissions.deny, ["Read(./.env)"]);
  });
});

Deno.test("gitignore append is idempotent via the marker line", async () => {
  await withTempDir(async (dir) => {
    await scaffold(dir);
    const first = await readTarget(dir, ".gitignore");
    assertStringIncludes(first, "# --- icculus harness ---");
    await scaffold(dir);
    const second = await readTarget(dir, ".gitignore");
    // Re-running does not append the fragment twice.
    assertEquals(second, first);
    assertEquals(second.match(/# --- icculus harness ---/g)?.length, 1);
  });
});

Deno.test("gitignore append preserves pre-existing content", async () => {
  await withTempDir(async (dir) => {
    await Deno.writeTextFile(join(dir, ".gitignore"), "node_modules/\n");
    await scaffold(dir);
    const gitignore = await readTarget(dir, ".gitignore");
    assertStringIncludes(gitignore, "node_modules/");
    assertStringIncludes(gitignore, "# --- icculus harness ---");
    // The user's line comes first, the fragment is appended after.
    assert(
      gitignore.indexOf("node_modules/") < gitignore.indexOf("# --- icculus"),
    );
  });
});

Deno.test("a seed file already present is skipped, never overwritten", async () => {
  await withTempDir(async (dir) => {
    await scaffold(dir);
    // Edit a seed (the verbatim recipe is a plain seed now).
    const recipeAbs = join(dir, ".icculus/engine/recipe");
    await Deno.writeTextFile(recipeAbs, "my own recipe\n");

    const plan = await buildPlan({
      templatesDir: FIXTURE_TEMPLATES,
      destDir: dir,
      tokens: testTokens(),
    });
    const op = plan.ops.find((o) => o.targetRel === ".icculus/engine/recipe");
    assert(op);
    assertEquals(op.disposition, "skip");
    await applyPlan(plan);
    // The user's edit survived: a present seed is left as-is.
    assertEquals(
      await readTarget(dir, ".icculus/engine/recipe"),
      "my own recipe\n",
    );
  });
});

Deno.test("a .icculus/skills/ file is materialized: always (re)written, overwriting an edit", async () => {
  await withTempDir(async (dir) => {
    // A minimal templates tree carrying one skill file.
    const templates = join(dir, "templates");
    const dest = join(dir, "dest");
    await Deno.mkdir(join(templates, ".icculus/skills/demo"), {
      recursive: true,
    });
    await Deno.mkdir(dest, { recursive: true });
    await Deno.writeTextFile(
      join(templates, ".icculus/skills/demo/SKILL.md"),
      "kit skill v2\n",
    );

    // The plan marks the skill `create` (materialized, always written).
    const first = await buildPlan({
      templatesDir: templates,
      destDir: dest,
      tokens: testTokens(),
    });
    const op = first.ops.find((o) =>
      o.targetRel === ".icculus/skills/demo/SKILL.md"
    );
    assert(op);
    assertEquals(op.disposition, "create");
    await applyPlan(first);

    // The user edits it; a re-plan still overwrites (it is the binary's).
    await Deno.writeTextFile(
      join(dest, ".icculus/skills/demo/SKILL.md"),
      "user tampered\n",
    );
    const second = await buildPlan({
      templatesDir: templates,
      destDir: dest,
      tokens: testTokens(),
    });
    const op2 = second.ops.find((o) =>
      o.targetRel === ".icculus/skills/demo/SKILL.md"
    );
    assert(op2);
    // Materialized → not a `skip`; applying restores the kit's bytes.
    assertEquals(op2.disposition, "create");
    await applyPlan(second);
    assertEquals(
      await readTarget(dest, ".icculus/skills/demo/SKILL.md"),
      "kit skill v2\n",
    );
  });
});

Deno.test("dry-run plan writes nothing to disk", async () => {
  await withTempDir(async (dir) => {
    // Build a plan but do NOT apply it.
    await buildPlan({
      templatesDir: FIXTURE_TEMPLATES,
      destDir: dir,
      tokens: testTokens(),
    });
    // The directory remains empty.
    const entries = [...Deno.readDirSync(dir)];
    assertEquals(entries.length, 0);
  });
});

Deno.test("brief is a write-once seed: not overwritten on re-run", async () => {
  await withTempDir(async (dir) => {
    const op1 = await planBrief(dir, "first brief");
    await Deno.mkdir(join(dir, ".icculus"), { recursive: true });
    await Deno.writeFile(op1.targetAbs, op1.bytes);
    assertStringIncludes(
      await readTarget(dir, ".icculus/brief.md"),
      "first brief",
    );

    // A second plan sees the existing brief and marks it skip.
    const op2 = await planBrief(dir, "second brief");
    assertEquals(op2.disposition, "skip");
  });
});
