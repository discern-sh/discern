/**
 * The migration framework (ADR 0014): chain selection, execution, recovery,
 * and every operation exposed through MigrationContext. The production chain
 * is empty at the public schema-1 baseline, so synthetic steps exercise the
 * machinery the first public migration will use.
 */

import { assert, assertEquals, assertExists, assertRejects } from "@std/assert";
import { join } from "@std/path";
import { SCHEMA_VERSION } from "../src/lib/version.ts";
import {
  applyMigrations,
  createMigrationContext,
  isChainContiguous,
  type Migration,
  MIGRATIONS,
  pendingMigrations,
} from "../src/lib/migrations.ts";
import { fakeEnv, targetExists, withTempDir } from "./helpers.ts";

/** A synthetic step that records its source version when applied. */
function recordingStep(from: number, log: number[]): Migration {
  return {
    from,
    describe: `step ${from}→${from + 1}`,
    apply: () => {
      log.push(from);
      return Promise.resolve();
    },
  };
}

Deno.test("the first public schema is 1 with an empty contiguous chain", () => {
  assertEquals(SCHEMA_VERSION, 1);
  assertEquals(MIGRATIONS, []);
  assert(isChainContiguous(MIGRATIONS, SCHEMA_VERSION));
});

Deno.test("isChainContiguous rejects gaps, duplicates, and wrong lengths", () => {
  const step = (from: number): Migration => recordingStep(from, []);
  assert(isChainContiguous([step(1), step(2)], 3));
  assert(isChainContiguous([], 1));
  assert(!isChainContiguous([step(1)], 3));
  assert(!isChainContiguous([step(1), step(3)], 4));
  assert(!isChainContiguous([step(1), step(1)], 3));
});

Deno.test("pendingMigrations selects the requested interval in order", () => {
  const registry = [
    recordingStep(3, []),
    recordingStep(1, []),
    recordingStep(2, []),
  ];
  assertEquals(
    pendingMigrations(1, 4, registry).map((migration) => migration.from),
    [1, 2, 3],
  );
  assertEquals(
    pendingMigrations(2, 4, registry).map((migration) => migration.from),
    [2, 3],
  );
  assertEquals(pendingMigrations(4, 4, registry), []);
  assertEquals(pendingMigrations(1, 1, registry), []);
});

Deno.test("applyMigrations runs and returns every pending step in order", async () => {
  await withTempDir(async (dir) => {
    const log: number[] = [];
    const registry = [recordingStep(1, log), recordingStep(2, log)];
    const applied = await applyMigrations({
      destDir: dir,
      from: 1,
      to: 3,
      registry,
    });
    assertEquals(log, [1, 2]);
    assertEquals(applied.map((migration) => migration.from), [1, 2]);
  });
});

Deno.test("applyMigrations composes across partial runs", async () => {
  await withTempDir(async (dir) => {
    const direct: number[] = [];
    await applyMigrations({
      destDir: dir,
      from: 1,
      to: 3,
      registry: [recordingStep(1, direct), recordingStep(2, direct)],
    });

    const stepwise: number[] = [];
    const registry = [
      recordingStep(1, stepwise),
      recordingStep(2, stepwise),
    ];
    await applyMigrations({ destDir: dir, from: 1, to: 2, registry });
    await applyMigrations({ destDir: dir, from: 2, to: 3, registry });
    assertEquals(direct, stepwise);
  });
});

Deno.test("applyMigrations rejects a chain that cannot bridge the interval", async () => {
  await withTempDir(async (dir) => {
    await assertRejects(
      () =>
        applyMigrations({
          destDir: dir,
          from: 1,
          to: 3,
          registry: [recordingStep(1, [])],
        }),
      Error,
      "broken migration chain",
    );
  });
});

Deno.test("a failed chain aborts later steps and converges on retry", async () => {
  await withTempDir(async (dir) => {
    const calls = { first: 0, second: 0, third: 0 };
    const writeOnce = async (
      ctx: {
        exists(rel: string): Promise<boolean>;
        writeText(rel: string, content: string): Promise<void>;
      },
      marker: string,
    ): Promise<void> => {
      if (!(await ctx.exists(marker))) {
        await ctx.writeText(marker, "applied\n");
      }
    };
    const registry: Migration[] = [
      {
        from: 1,
        describe: "first",
        apply: (ctx) => {
          calls.first++;
          return writeOnce(ctx, "first.marker");
        },
      },
      {
        from: 2,
        describe: "fails once",
        apply: async (ctx) => {
          calls.second++;
          if (calls.second === 1) {
            throw new Error("transient failure");
          }
          await writeOnce(ctx, "second.marker");
        },
      },
      {
        from: 3,
        describe: "third",
        apply: (ctx) => {
          calls.third++;
          return writeOnce(ctx, "third.marker");
        },
      },
    ];

    await assertRejects(
      () => applyMigrations({ destDir: dir, from: 1, to: 4, registry }),
      Error,
      "transient failure",
    );
    assertEquals(await targetExists(dir, "first.marker"), true);
    assertEquals(await targetExists(dir, "second.marker"), false);
    assertEquals(await targetExists(dir, "third.marker"), false);
    assertEquals(calls, { first: 1, second: 1, third: 0 });

    const applied = await applyMigrations({
      destDir: dir,
      from: 1,
      to: 4,
      registry,
    });
    assertEquals(applied.map((migration) => migration.from), [1, 2, 3]);
    assertEquals(await targetExists(dir, "first.marker"), true);
    assertEquals(await targetExists(dir, "second.marker"), true);
    assertEquals(await targetExists(dir, "third.marker"), true);
    assertEquals(calls, { first: 2, second: 2, third: 1 });
  });
});

Deno.test("context reads, writes, checks, and removes files idempotently", async () => {
  await withTempDir(async (dir) => {
    const ctx = createMigrationContext(dir);
    assertEquals(await ctx.exists("nested/file.txt"), false);
    await ctx.writeText("nested/file.txt", "hello");
    assertEquals(await ctx.exists("nested/file.txt"), true);
    assertEquals(await ctx.readText("nested/file.txt"), "hello");
    assertEquals(await ctx.readText("missing.txt"), undefined);
    await ctx.remove("nested/file.txt");
    await ctx.remove("nested/file.txt");
    assertEquals(await ctx.exists("nested/file.txt"), false);
  });
});

Deno.test("context removes files and subtrees recursively and idempotently", async () => {
  await withTempDir(async (dir) => {
    const ctx = createMigrationContext(dir);
    await ctx.writeText("tree/sub/leaf.txt", "leaf");
    await ctx.removeAll("tree");
    await ctx.removeAll("tree");
    assertEquals(await ctx.exists("tree"), false);

    await ctx.writeText("file.txt", "file");
    await ctx.removeAll("file.txt");
    assertEquals(await ctx.exists("file.txt"), false);
  });
});

Deno.test("context renames content and treats a missing source as complete", async () => {
  await withTempDir(async (dir) => {
    const ctx = createMigrationContext(dir);
    await ctx.writeText("old/name.txt", "carry me");
    await ctx.rename("old/name.txt", "new/name.txt");
    await ctx.rename("old/name.txt", "new/name.txt");
    assertEquals(await ctx.exists("old/name.txt"), false);
    assertEquals(await ctx.readText("new/name.txt"), "carry me");
  });
});

Deno.test("context rewrites changed text and ignores absent files", async () => {
  await withTempDir(async (dir) => {
    const ctx = createMigrationContext(dir);
    await ctx.writeText("file.txt", "old old");
    await ctx.rewrite("file.txt", (text) => text.replaceAll("old", "new"));
    await ctx.rewrite("missing.txt", (text) => text.toUpperCase());
    assertEquals(await ctx.readText("file.txt"), "new new");
    assertEquals(await ctx.exists("missing.txt"), false);
  });
});

Deno.test("context reads and edits root discern.toml with comments intact", async () => {
  await withTempDir(async (dir) => {
    const ctx = createMigrationContext(dir);
    assertEquals(await ctx.readConfig(), undefined);
    await ctx.editToml((editor) => editor.setString("project.slug", "ignored"));
    assertEquals(await ctx.exists("discern.toml"), false);

    await ctx.writeText(
      "discern.toml",
      '# project note\n[project]\nslug = "demo"\n',
    );
    await ctx.editToml((editor) =>
      editor.setString("repository.branch_prefix", "agent/")
    );
    const config = await ctx.readConfig();
    assertExists(config);
    assert(config.includes("# project note"));
    assert(config.includes('branch_prefix = "agent/"'));
  });
});

Deno.test("context deep-merges .claude/settings.json", async () => {
  await withTempDir(async (dir) => {
    const ctx = createMigrationContext(dir);
    await ctx.writeText(
      ".claude/settings.json",
      '{"theme":"dark","permissions":{"allow":["Read"]}}\n',
    );
    await ctx.mergeSettings({ model: "opus" });
    await ctx.mergeSettings({ permissions: { deny: ["Read(./.env)"] } });
    const text = await ctx.readText(".claude/settings.json");
    assertExists(text);
    const settings = JSON.parse(text) as {
      model?: string;
      theme?: string;
      permissions?: { deny?: string[] };
    };
    assertEquals(settings.model, "opus");
    assertEquals(settings.theme, "dark");
    assertEquals(settings.permissions?.deny, ["Read(./.env)"]);
  });
});

Deno.test("context rejects a non-object .claude/settings.json root", async () => {
  await withTempDir(async (dir) => {
    const ctx = createMigrationContext(dir);
    await ctx.writeText(".claude/settings.json", "[]\n");
    await assertRejects(
      () => ctx.mergeSettings({ model: "opus" }),
      TypeError,
      "must contain a JSON object at the root",
    );
    assertEquals(await ctx.readText(".claude/settings.json"), "[]\n");
  });
});

Deno.test("context exposes the injected env and forwards notes", () => {
  const notes: string[] = [];
  const env = fakeEnv({ DISCERN_TEMPLATES_DIR: "/example/templates" });
  const ctx = createMigrationContext(
    "/unused",
    (message) => notes.push(message),
    env,
  );
  ctx.note("moved a file");
  assertEquals(notes, ["moved a file"]);
  assertEquals(ctx.env.get("DISCERN_TEMPLATES_DIR"), "/example/templates");
});

Deno.test("a rename migration is idempotent through the runner", async () => {
  await withTempDir(async (dir) => {
    const migration: Migration = {
      from: 1,
      describe: "rename a to b",
      apply: (ctx) => ctx.rename("a", "b"),
    };
    await Deno.writeTextFile(join(dir, "a"), "data");
    await applyMigrations({
      destDir: dir,
      from: 1,
      to: 2,
      registry: [migration],
    });
    await applyMigrations({
      destDir: dir,
      from: 1,
      to: 2,
      registry: [migration],
    });
    assertEquals(await targetExists(dir, "a"), false);
    assertEquals(await targetExists(dir, "b"), true);
  });
});
