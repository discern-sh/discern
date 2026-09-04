/**
 * The seed-only scaffolding engine against the synthetic fixture tree. These
 * tests own the behaviours the spec calls out: content + path token
 * substitution, `.tmpl` stripping, exec-bit preservation, settings deep-merge
 * into an existing file, `.gitignore` block idempotency, write-once seed
 * skipping, the `excludeNonSeed` skip of the binary's `skills/`/`instructions/`
 * subtrees, host-metadata exclusion, and dry-run-writes-nothing.
 *
 * They use the fixture (not the real templates) so they stay stable while other
 * agents fill the real tree.
 */

import {
  assert,
  assertEquals,
  assertExists,
  assertRejects,
  assertStringIncludes,
} from "@std/assert";
import { dirname, join } from "@std/path";
import { SOURCE_PATHS } from "../src/shared/paths_registry.ts";
import {
  applyPlan,
  buildPlan,
  type Plan,
  planBrief,
  planGitattributesReconcile,
  type PlanOp,
} from "../src/lib/fs_plan.ts";
import {
  FIXTURE_TEMPLATES,
  modeOf,
  readTarget,
  REAL_TEMPLATES,
  testTokens,
  withTempDir,
} from "./helpers.ts";
import { settingsSeeds } from "../src/lib/providers.ts";
import { parseConfigOrThrow } from "../src/shared/config_schema.ts";
import { targetExists } from "../src/shared/fs_presence.ts";
import { z } from "@zod/zod";
import { decodeWith } from "./decode_cli_result.ts";

const SettingsHookSchema = z.object({
  hooks: z.array(
    z.object({
      type: z.string(),
      command: z.string(),
    }).passthrough(),
  ),
}).passthrough();

const ClaudeSettingsSchema = z.object({
  model: z.string().optional(),
  permissions: z.object({ deny: z.array(z.string()) }).passthrough().optional(),
  hooks: z.object({
    WorktreeCreate: z.array(SettingsHookSchema),
    SessionStart: z.array(SettingsHookSchema),
  }).passthrough(),
}).passthrough();

/** Build and apply an init-style plan over the fixture tree into `dir` (the
 * binary's skills/ + instructions/ subtrees excluded, exactly as `setup` does). */
async function scaffold(dir: string): Promise<Plan> {
  const plan = await buildPlan({
    templatesDir: FIXTURE_TEMPLATES,
    destDir: dir,
    tokens: testTokens(),
    excludeNonSeed: true,
  });
  await applyPlan(plan);
  return plan;
}

Deno.test("init substitutes content tokens in *.tmpl files", async () => {
  await withTempDir(async (dir) => {
    await scaffold(dir);
    const toml = await readTarget(dir, "discern.toml");
    assertStringIncludes(toml, 'slug = "demo-app"');
    assertStringIncludes(toml, 'branch_prefix = "agent/"');
    assertStringIncludes(toml, 'agents = ["claude_code", "codex"]');
    // The @db@ runtime token (different delimiter) is preserved verbatim.
    assertStringIncludes(toml, 'create = "createdb @db@"');
    // An unknown {{token}} is left verbatim (drift probe).
    assertStringIncludes(toml, 'custom = "{{unknown_token}}"');
  });
});

Deno.test("init resolves the {{project_slug}} path token and strips .tmpl", async () => {
  await withTempDir(async (dir) => {
    await scaffold(dir);
    // Name carried the slug token; both the name token and .tmpl resolve.
    assert(await targetExists(join(dir, "docs/demo-app-guide.md")));
    assert(!(await targetExists(join(dir, "docs/{{project_slug}}-guide.md"))));
    const body = await readTarget(dir, "docs/demo-app-guide.md");
    assertStringIncludes(body, "# Demo App guide");
    assertStringIncludes(body, "Slug: demo-app");
  });
});

Deno.test("init strips .tmpl from the config file name", async () => {
  await withTempDir(async (dir) => {
    await scaffold(dir);
    assert(await targetExists(join(dir, "discern.toml")));
    assert(!(await targetExists(join(dir, "discern.toml.tmpl"))));
  });
});

Deno.test("init preserves the source exec bit (0755 hook, 0644 doc)", async () => {
  await withTempDir(async (dir) => {
    await scaffold(dir);
    assertEquals(await modeOf(dir, "bin/hook"), 0o755);
    assertEquals(await modeOf(dir, "docs/00-orientation/concepts.md"), 0o644);
  });
});

Deno.test("init normalizes a read-only source seed to owner-writable", async () => {
  // The `deno compile` embedded filesystem reports every bundled template as
  // read-only (0o444). A scaffolded seed is the user's to edit (and `config
  // set`/`discern setup` rewrite discern.toml), so the plan must restore owner
  // write. Emulate that environment with a deliberately 0o444 source.
  await withTempDir(async (src) => {
    await Deno.writeTextFile(join(src, "discern.toml.tmpl"), "[project]\n");
    await Deno.chmod(join(src, "discern.toml.tmpl"), 0o444);
    await withTempDir(async (dir) => {
      const plan = await buildPlan({
        templatesDir: src,
        destDir: dir,
        tokens: testTokens(),
      });
      await applyPlan(plan);
      const mode = await modeOf(dir, "discern.toml");
      assertEquals(
        mode & 0o600,
        0o600,
        `expected owner rw; got ${mode.toString(8)}`,
      );
    });
  });
});

Deno.test("init copies a token-free file verbatim", async () => {
  await withTempDir(async (dir) => {
    await scaffold(dir);
    const doc = await readTarget(dir, "docs/00-orientation/concepts.md");
    assertStringIncludes(doc, "verbatim SEED");
    // No token machinery touched a verbatim file.
    assert(!doc.includes("{{"));
  });
});

Deno.test("template plans exclude host metadata without excluding authored hidden seeds", async () => {
  await withTempDir(async (src) => {
    const hostMetadata = [
      ".DS_Store",
      "nested/Thumbs.db",
      "nested/._seed.md",
      "nested/.Spotlight-V100/index",
    ];
    for (const rel of hostMetadata) {
      await Deno.mkdir(dirname(join(src, rel)), { recursive: true });
      await Deno.writeTextFile(join(src, rel), "host-created\n");
    }
    await Deno.writeTextFile(
      join(src, ".authored-hidden-seed"),
      "project-owned\n",
    );

    await withTempDir(async (dir) => {
      const plan = await buildPlan({
        templatesDir: src,
        destDir: dir,
        tokens: testTokens(),
      });
      assertEquals(
        plan.ops.map((op) => op.targetRel),
        [".authored-hidden-seed"],
      );

      await applyPlan(plan);
      assert(await targetExists(join(dir, ".authored-hidden-seed")));
      for (const rel of hostMetadata) {
        assert(!(await targetExists(join(dir, rel))), rel);
      }
    });
  });
});

Deno.test("excludeNonSeed skips the binary's skills/ and instructions/ subtrees", async () => {
  await withTempDir(async (dir) => {
    // init-style: skills/ + instructions/ are the binary's, materialized/read from
    // the binary, never seeded.
    const excluded = await buildPlan({
      templatesDir: FIXTURE_TEMPLATES,
      destDir: dir,
      tokens: testTokens(),
      excludeNonSeed: true,
    });
    assert(!excluded.ops.some((o) => o.targetRel.startsWith("skills/")));
    assert(!excluded.ops.some((o) => o.targetRel.startsWith("instructions/")));

    // overlay-style (default): a supplied skills/ tree IS an intended overlay.
    const included = await buildPlan({
      templatesDir: FIXTURE_TEMPLATES,
      destDir: dir,
      tokens: testTokens(),
    });
    assert(included.ops.some((o) => o.targetRel === "skills/demo/SKILL.md"));
    assert(included.ops.some((o) => o.targetRel === "instructions/base.md"));
  });
});

Deno.test("init creates .claude/settings.json from the template when absent", async () => {
  await withTempDir(async (dir) => {
    await scaffold(dir);
    const settings = decodeWith(
      ClaudeSettingsSchema,
      await readTarget(dir, ".claude/settings.json"),
    );
    assertEquals(settings.permissions, undefined);
    const worktreeCreate = settings.hooks.WorktreeCreate[0];
    assertExists(worktreeCreate);
    const commandHook = worktreeCreate.hooks[0];
    assertExists(commandHook);
    assertStringIncludes(
      commandHook.command,
      "discern worktree hook create",
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
    const settings = decodeWith(
      ClaudeSettingsSchema,
      await readTarget(dir, ".claude/settings.json"),
    );
    // User scalar preserved.
    assertEquals(settings.model, "opus");
    // Existing Shared permission rules are preserved; discern adds none.
    assertEquals(settings.permissions?.deny, ["Read(./secret)"]);
    // SessionStart has both the user's hook and ours.
    assertEquals(settings.hooks.SessionStart.length, 2);
  });
});

Deno.test("init refuses malformed existing JSON settings for every JSON settings seed", async () => {
  for (
    const seed of settingsSeeds().filter((s) => s.targetRel.endsWith(".json"))
  ) {
    await withTempDir(async (dir) => {
      const target = join(dir, seed.targetRel);
      await Deno.mkdir(dirname(target), { recursive: true });
      const malformed = '{ "user": true, }\n';
      await Deno.writeTextFile(target, malformed);

      const error = await assertRejects(
        () =>
          buildPlan({
            templatesDir: REAL_TEMPLATES,
            destDir: dir,
            tokens: testTokens(),
            excludeNonSeed: true,
          }),
        Error,
        seed.targetRel,
      );
      assertStringIncludes(error.message, "malformed JSON");
      assertEquals(await Deno.readTextFile(target), malformed);
    });
  }
});

Deno.test("settings merge is idempotent across a re-run (no dup hooks)", async () => {
  await withTempDir(async (dir) => {
    await scaffold(dir);
    await scaffold(dir);
    const settings = decodeWith(
      ClaudeSettingsSchema,
      await readTarget(dir, ".claude/settings.json"),
    );
    assertEquals(settings.hooks.SessionStart.length, 1);
    assertEquals(settings.permissions, undefined);
  });
});

Deno.test("gitignore block reconciliation is idempotent via the markers", async () => {
  await withTempDir(async (dir) => {
    await scaffold(dir);
    const first = await readTarget(dir, ".gitignore");
    assertStringIncludes(first, "# --- discern ---");
    await scaffold(dir);
    const second = await readTarget(dir, ".gitignore");
    // Re-running does not append the fragment twice.
    assertEquals(second, first);
    assertEquals(second.match(/# --- discern ---/g)?.length, 1);
  });
});

Deno.test("gitignore block reconciliation preserves pre-existing content", async () => {
  await withTempDir(async (dir) => {
    await Deno.writeTextFile(join(dir, ".gitignore"), "node_modules/\n");
    await scaffold(dir);
    const gitignore = await readTarget(dir, ".gitignore");
    assertStringIncludes(gitignore, "node_modules/");
    assertStringIncludes(gitignore, "# --- discern ---");
    // The user's line comes first, the fragment is appended after.
    assert(
      gitignore.indexOf("node_modules/") < gitignore.indexOf("# --- discern"),
    );
  });
});

Deno.test("the gitignore leaves .mcp.json trackable (project-scoped MCP is shared)", async () => {
  await withTempDir(async (dir) => {
    await scaffold(dir);
    const gitignore = await readTarget(dir, ".gitignore");
    // .mcp.json is shared, co-owned config discern MERGES into (like
    // .claude/settings.json), NOT a wholesale-regenerated derivative like
    // CLAUDE.md — it must stay trackable so the team gets the server.
    assert(
      !/^\s*\/?\.mcp\.json\s*$/m.test(gitignore),
      `.mcp.json must not be gitignored:\n${gitignore}`,
    );
  });
});

Deno.test("the gitignore keeps machine-local provider settings ignored", async () => {
  await withTempDir(async (dir) => {
    await scaffold(dir);
    const gitignore = await readTarget(dir, ".gitignore");
    assertStringIncludes(gitignore, "/.claude/*");
    assertStringIncludes(gitignore, "!/.claude/settings.json");
    assert(
      !/^\s*!\/?\.claude\/settings\.local\.json\s*$/m.test(gitignore),
      `.claude/settings.local.json is a machine-local override and must stay ignored:\n${gitignore}`,
    );
  });
});

Deno.test("gitattributes reconciliation plans registered Markdown and generated paths", async () => {
  await withTempDir(async (dir) => {
    await Deno.mkdir(join(dir, "discern", "map"), { recursive: true });
    await Deno.writeTextFile(
      join(dir, "discern", "map", "orientation.md"),
      "# Orientation\n",
    );
    const defaultConfig = parseConfigOrThrow("");
    const create = await planGitattributesReconcile(dir, defaultConfig);
    assert(create !== undefined);
    assertEquals(create.kind, "reconcile-gitattributes");
    assertEquals(create.disposition, "create");
    assertStringIncludes(create.note ?? "", "managed .gitattributes fragment");
    assertStringIncludes(create.note ?? "", "doctor verifies effective");
    await applyPlan({ ops: [create], unknownTokens: new Map() });
    assertStringIncludes(
      await readTarget(dir, ".gitattributes"),
      "discern/map/**/*.md diff=markdown",
    );

    const generatedConfig = parseConfigOrThrow(`
[generated.bundle]
paths = ["generated/**"]
run = "true"
`);
    const update = await planGitattributesReconcile(dir, generatedConfig);
    assert(update !== undefined);
    assertEquals(update.disposition, "append");
    assertStringIncludes(update.note ?? "", "managed .gitattributes fragment");
    assertStringIncludes(update.note ?? "", "doctor verifies effective");
    await applyPlan({ ops: [update], unknownTokens: new Map() });
    assertStringIncludes(
      await readTarget(dir, ".gitattributes"),
      "generated/** merge=discern-generated",
    );

    const current = await planGitattributesReconcile(dir, generatedConfig);
    assert(current !== undefined);
    assertEquals(current.disposition, "skip");
    assertStringIncludes(current.note ?? "", "fragment current");
    assertStringIncludes(current.note ?? "", "doctor verifies effective");
  });
});

Deno.test("a seed file already present is skipped, never overwritten", async () => {
  await withTempDir(async (dir) => {
    await scaffold(dir);
    // Edit a seed (the verbatim doc is a plain seed).
    const seedAbs = join(dir, "docs/00-orientation/concepts.md");
    await Deno.writeTextFile(seedAbs, "my own notes\n");

    const plan = await buildPlan({
      templatesDir: FIXTURE_TEMPLATES,
      destDir: dir,
      tokens: testTokens(),
      excludeNonSeed: true,
    });
    const op = plan.ops.find((o) =>
      o.targetRel === "docs/00-orientation/concepts.md"
    );
    assert(op);
    assertEquals(op.disposition, "skip");
    await applyPlan(plan);
    // The user's edit survived: a present seed is left as-is.
    assertEquals(
      await readTarget(dir, "docs/00-orientation/concepts.md"),
      "my own notes\n",
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
      excludeNonSeed: true,
    });
    // The directory remains empty.
    const entries = await Array.fromAsync(Deno.readDir(dir));
    assertEquals(entries.length, 0);
  });
});

/** Build a deterministic create-file operation for partial-plan recovery cases. */
function writeOp(targetAbs: string, targetRel: string): PlanOp {
  return {
    kind: "write",
    targetRel,
    targetAbs,
    disposition: "create",
    bytes: new TextEncoder().encode(`${targetRel}\n`),
    mode: 0o644,
  };
}

Deno.test("applyPlan names the failed op and a fixed partial state reapplies cleanly", async () => {
  for (const failFirst of [true, false]) {
    await withTempDir(async (dir) => {
      const blocker = join(dir, "blocked");
      await Deno.writeTextFile(blocker, "not a directory\n");
      const blocked = writeOp(join(blocker, "file.txt"), "blocked/file.txt");
      const ok = writeOp(join(dir, "ok.txt"), "ok.txt");
      const plan = {
        ops: failFirst ? [blocked, ok] : [ok, blocked],
        unknownTokens: new Map<string, string[]>(),
      };

      const error = await assertRejects(
        () => applyPlan(plan),
        Error,
        "blocked/file.txt",
      );
      assertStringIncludes(error.message, "write");

      await Deno.remove(blocker);
      const changed = await applyPlan(plan);
      assertEquals(
        changed.map((op) => op.targetRel),
        failFirst
          ? ["blocked/file.txt", "ok.txt"]
          : ["ok.txt", "blocked/file.txt"],
      );
      assertEquals(await Deno.readTextFile(join(dir, "ok.txt")), "ok.txt\n");
      assertEquals(
        await Deno.readTextFile(join(dir, "blocked/file.txt")),
        "blocked/file.txt\n",
      );
    });
  }
});

Deno.test("brief is a write-once seed at its registry path", async () => {
  await withTempDir(async (dir) => {
    const op1 = await planBrief(dir, "first brief");
    assertEquals(op1.targetRel, SOURCE_PATHS.brief.defaultPath);
    await Deno.mkdir(dirname(op1.targetAbs), { recursive: true });
    await Deno.writeFile(op1.targetAbs, op1.bytes);
    assertStringIncludes(
      await readTarget(dir, SOURCE_PATHS.brief.defaultPath),
      "first brief",
    );

    // A second plan sees the existing brief and marks it skip.
    const op2 = await planBrief(dir, "second brief");
    assertEquals(op2.disposition, "skip");
  });
});
