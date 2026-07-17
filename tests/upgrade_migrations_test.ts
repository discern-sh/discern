/**
 * The migration fold (ADR 0014): `upgrade` runs pending chain migrations before
 * the file sync, rebuilds the plan if a step moved files, then stamps the new
 * schema. The production chain is empty at schema 1, so the CLI path is a
 * migration no-op (asserted here). An injected synthetic chain drives the fold
 * end-to-end in-process — exercising the run → rebuild → stamp that Phase 2's
 * rename will rely on, without a real SCHEMA_VERSION bump.
 */

import { assert, assertEquals, assertStringIncludes } from "@std/assert";
import { join } from "@std/path";
import { runUpgrade } from "../src/commands/upgrade.ts";
import type { Migration } from "../src/lib/migrations.ts";
import { SCHEMA_VERSION } from "../src/lib/version.ts";
import { readTarget, runCli, targetExists, withTempDir } from "./helpers.ts";

async function setup(dir: string): Promise<void> {
  assertEquals(
    (await runCli([
      "setup",
      "--confirmed",
      "--yes",
      "--slug",
      "demo",
      "--name",
      "Demo",
    ], dir))
      .code,
    0,
  );
}

/** Overwrite the install's recorded `[meta].schema_version` (to model one behind). */
async function setSchema(dir: string, version: number): Promise<void> {
  const p = join(dir, "discern.toml");
  const text = await Deno.readTextFile(p);
  await Deno.writeTextFile(
    p,
    text.replace(/schema_version\s*=\s*\d+/, `schema_version = ${version}`),
  );
}

/** The recorded `[meta].schema_version` of an install's config. */
async function recordedSchema(dir: string): Promise<number> {
  const m = (await readTarget(dir, "discern.toml")).match(
    /schema_version\s*=\s*(\d+)/,
  );
  return m ? Number(m[1]) : NaN;
}

/**
 * Run `runUpgrade` in-process against `dir`, passed as the command's `cwd` so the
 * call needs no process chdir. `json` keeps output to one line; `--allow-dirty`
 * skips the clean-tree guard for the throwaway install.
 */
async function upgradeIn(dir: string, registry?: Migration[]): Promise<number> {
  return (await upgradeJsonIn(dir, registry)).code;
}

async function upgradeJsonIn(
  dir: string,
  registry?: Migration[],
): Promise<{ code: number; stdout: string }> {
  const originalLog = console.log;
  let stdout = "";
  console.log = (...args: unknown[]) => {
    stdout += args.map((a) => String(a)).join(" ") + "\n";
  };
  try {
    const code = await runUpgrade({
      json: true,
      noColor: true,
      dryRun: false,
      check: false,
      allowDirty: true,
      registry,
      cwd: dir,
    });
    return { code, stdout };
  } finally {
    console.log = originalLog;
  }
}

async function upgradeCheckJsonIn(dir: string): Promise<{
  code: number;
  stdout: string;
}> {
  const originalLog = console.log;
  let stdout = "";
  console.log = (...args: unknown[]) => {
    stdout += args.map((a) => String(a)).join(" ") + "\n";
  };
  try {
    const code = await runUpgrade({
      json: true,
      noColor: true,
      dryRun: false,
      check: true,
      allowDirty: true,
      cwd: dir,
    });
    return { code, stdout };
  } finally {
    console.log = originalLog;
  }
}

Deno.test("upgrade converges discern-owned banners through every top-level section rename", async () => {
  const cases = [
    {
      name: "schema 17 ratchets to standards",
      schema: 17,
      oldBanner: "# [ratchets] —",
      currentBanner: "# [standards] —",
      makeOld: (current: string): string =>
        current.replace("# [standards] —", "# [ratchets] —") +
        '\n[ratchets.sample]\ndirection = "up"\nlimit = 1\nrun = "measure"\n',
    },
    {
      name: "schema 18 docs to map",
      schema: 18,
      oldBanner: "# [docs] —",
      currentBanner: "# [map] —",
      makeOld: (current: string): string =>
        current
          .replace("# [map] —", "# [docs] —")
          .replace("\n[map]\n", "\n[docs]\n"),
    },
    {
      name: "schema 19 recipes to scripts",
      schema: 19,
      oldBanner: "# [recipes] —",
      currentBanner: "# [scripts] —",
      makeOld: (current: string): string =>
        current
          .replace("# [scripts] —", "# [recipes] —")
          .replace("\n[scripts]\n", "\n[recipes]\n")
          .replace('dir = "discern/scripts"', 'dir = "discern/recipes"'),
    },
  ];

  for (const testCase of cases) {
    await withTempDir(async (dir) => {
      await setup(dir);
      await setSchema(dir, testCase.schema);
      const configPath = join(dir, "discern.toml");
      const current = await Deno.readTextFile(configPath);
      await Deno.writeTextFile(configPath, testCase.makeOld(current));

      assertEquals(await upgradeIn(dir), 0, testCase.name);
      const upgraded = await Deno.readTextFile(configPath);
      assert(
        !upgraded.includes(testCase.oldBanner),
        `${testCase.name}: stale banner remains`,
      );
      assertStringIncludes(upgraded, testCase.currentBanner, testCase.name);

      assertEquals(await upgradeIn(dir), 0, `${testCase.name}: second upgrade`);
      assertEquals(
        await Deno.readTextFile(configPath),
        upgraded,
        `${testCase.name}: second upgrade must be byte-stable`,
      );
    });
  }
});

Deno.test("upgrade check detects and upgrade restores a missing fixed banner without touching key comments", async () => {
  await withTempDir(async (dir) => {
    await setup(dir);
    const configPath = join(dir, "discern.toml");
    const current = await Deno.readTextFile(configPath);
    const identity = current.indexOf("# [scripts] —");
    const start = current.lastIndexOf("# ─", identity);
    const close = current.indexOf("# ─", identity + 1);
    const end = current.indexOf("\n", close);
    assert(start >= 0 && close >= 0, "scripts banner should be present");
    const afterBanner = end === -1 ? current.length : end + 1;
    const projectComment = "# Project annotation attached to scripts.dir.";
    const drifted = (current.slice(0, start) + current.slice(afterBanner))
      .replace(
        "[scripts]\n",
        `[scripts]\n${projectComment}\n`,
      );
    await Deno.writeTextFile(configPath, drifted);

    const check = await upgradeCheckJsonIn(dir);
    assertEquals(check.code, 1);
    assertEquals(JSON.parse(check.stdout).data.pending_reconciliation, [
      { kind: "banner", path: "scripts" },
    ]);

    assertEquals(await upgradeIn(dir), 0);
    const upgraded = await Deno.readTextFile(configPath);
    assertStringIncludes(upgraded, "# [scripts] —");
    assertStringIncludes(upgraded, projectComment);

    assertEquals(await upgradeIn(dir), 0);
    assertEquals(await Deno.readTextFile(configPath), upgraded);
  });
});

Deno.test("upgrade refuses a config from a newer schema and does not stamp down", async () => {
  await withTempDir(async (dir) => {
    await setup(dir);
    await setSchema(dir, SCHEMA_VERSION + 1);
    const before = await readTarget(dir, "discern.toml");

    const run = await upgradeJsonIn(dir);
    assertEquals(run.code, 1);
    const res = JSON.parse(run.stdout);
    assertEquals(res.error, "schema_version_too_new");
    assertStringIncludes(res.message, "this project needs a newer discern");
    assertStringIncludes(res.message, "re-run the installer");
    assertEquals(await readTarget(dir, "discern.toml"), before);

    const check = await upgradeCheckJsonIn(dir);
    assertEquals(check.code, 1);
    assertEquals(JSON.parse(check.stdout).error, "schema_version_too_new");
  });
});

Deno.test("upgrade refuses to stamp when a migration leaves invalid TOML", async () => {
  await withTempDir(async (dir) => {
    await setup(dir);
    await setSchema(dir, SCHEMA_VERSION - 1);
    const chain: Migration[] = [{
      from: SCHEMA_VERSION - 1,
      describe: "write invalid TOML",
      apply: (ctx) =>
        ctx.rewrite("discern.toml", (text) => `${text}\nbad = "\\q"\n`),
    }];

    const run = await upgradeJsonIn(dir, chain);
    assertEquals(run.code, 1);
    const res = JSON.parse(run.stdout);
    assertEquals(res.error, "invalid_migrated_config");
    assertStringIncludes(res.message, "schema was not stamped");
    assertStringIncludes(await readTarget(dir, "discern.toml"), 'bad = "\\q"');
    assertEquals(await recordedSchema(dir), SCHEMA_VERSION - 1);
  });
});

Deno.test("a current install has nothing pending and applies no migrations", async () => {
  await withTempDir(async (dir) => {
    await setup(dir); // a fresh install is stamped at the current schema
    const r = await runCli(["upgrade", "--json"], dir);
    assertEquals(r.code, 0, r.stderr);
    assertEquals(JSON.parse(r.stdout).data.migrations_applied, []);
    const c = await runCli(["upgrade", "--check", "--json"], dir);
    assertEquals(JSON.parse(c.stdout).data.pending_migrations, []);
  });
});

Deno.test("upgrade (json) carries the restart-your-agents hint on the applied result", async () => {
  await withTempDir(async (dir) => {
    await setup(dir); // a fresh install: nothing to migrate, but the apply still runs
    const run = await upgradeJsonIn(dir);
    assertEquals(run.code, 0, run.stdout);
    const hints = JSON.parse(run.stdout).hints as string[];
    assert(
      Array.isArray(hints) &&
        hints.some((h) => h.includes("restart it so its discern MCP server")),
      `applied upgrade JSON must carry the restart hint: ${
        JSON.stringify(hints)
      }`,
    );
  });
});

Deno.test("upgrade runs a pending migration before the sync, then stamps the schema", async () => {
  await withTempDir(async (dir) => {
    await setup(dir);
    await setSchema(dir, SCHEMA_VERSION - 1); // model an install one schema behind

    const ran: string[] = [];
    // A synthetic 1→2 step (overrides the production chain via the registry seam).
    const chain: Migration[] = [{
      from: SCHEMA_VERSION - 1,
      describe: "write a marker and set a config key",
      apply: async (ctx) => {
        ran.push("applied");
        await ctx.writeText("MIGRATED", "yes\n");
        await ctx.editToml((e) =>
          e.setString("repository.branch_prefix", "wt/")
        );
      },
    }];

    assertEquals(await upgradeIn(dir, chain), 0);
    assertEquals(ran, ["applied"]); // the step ran exactly once
    // Its effects landed: the marker file and the config edit.
    assertEquals(await targetExists(dir, "MIGRATED"), true);
    assert(
      (await readTarget(dir, "discern.toml")).includes(
        'branch_prefix = "wt/"',
      ),
    );
    // And the config was stamped to the current schema.
    assertEquals(await recordedSchema(dir), SCHEMA_VERSION);
  });
});

Deno.test("upgrade re-running an applied migration is a no-op (idempotent fold)", async () => {
  await withTempDir(async (dir) => {
    await setup(dir);
    await setSchema(dir, SCHEMA_VERSION - 1);
    const chain: Migration[] = [{
      from: SCHEMA_VERSION - 1,
      describe: "create a marker",
      apply: (ctx) => ctx.writeText("MIGRATED", "yes\n"),
    }];
    assertEquals(await upgradeIn(dir, chain), 0); // schema 1 → 2, runs
    // Now at the current schema: re-running finds nothing pending, still succeeds.
    assertEquals(await upgradeIn(dir, chain), 0);
    assertEquals(await recordedSchema(dir), SCHEMA_VERSION);
  });
});
