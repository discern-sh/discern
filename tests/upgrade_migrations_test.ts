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
import { HINTS } from "../src/shared/hints.ts";
import { readTarget, runCli, withTempDir } from "./helpers.ts";
import { assertHasHint } from "./hint_asserts.ts";
import { targetExists } from "../src/shared/fs_presence.ts";
import { assertResultDataKey, decodeCliResult } from "./decode_cli_result.ts";
import { git, gitInit } from "./engine_helpers.ts";

const SYNTHETIC_CURRENT_SCHEMA = SCHEMA_VERSION + 1;

/** Create a current named installation that migration cases can deliberately age. */
async function setup(dir: string): Promise<void> {
  await Deno.writeTextFile(join(dir, "README.md"), "# Fixture\n");
  await gitInit(dir);
  assertEquals(
    (await runCli([
      "setup",
      "begin",
      "--confirmed",
      "--slug",
      "demo",
      "--name",
      "Demo",
    ], dir))
      .code,
    0,
  );
  await git(dir, "add", "-A");
  await git(dir, "commit", "-m", "install discern");
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

/** Remove or replace the install's schema anchor without changing other bytes. */
async function corruptSchema(
  dir: string,
  replacement: string | undefined,
): Promise<void> {
  const path = join(dir, "discern.toml");
  const text = await Deno.readTextFile(path);
  await Deno.writeTextFile(
    path,
    text.replace(
      /^\s*schema_version\s*=\s*\d+\s*$/m,
      replacement === undefined ? "" : `  schema_version = ${replacement}`,
    ),
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

/** Capture one applying upgrade's JSON envelope without leaking its console output. */
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
      currentSchema: registry === undefined
        ? undefined
        : SYNTHETIC_CURRENT_SCHEMA,
      cwd: dir,
    });
    return { code, stdout };
  } finally {
    console.log = originalLog;
  }
}

/** Capture a read-only migration check's JSON envelope without applying the plan. */
async function upgradeCheckJsonIn(
  dir: string,
  registry?: Migration[],
): Promise<{
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
      registry,
      currentSchema: registry === undefined
        ? undefined
        : SYNTHETIC_CURRENT_SCHEMA,
      cwd: dir,
    });
    return { code, stdout };
  } finally {
    console.log = originalLog;
  }
}

/** Capture a synthetic migration preview's JSON envelope while preserving the filesystem. */
async function upgradeDryRunJsonIn(
  dir: string,
  registry: Migration[],
): Promise<{ code: number; stdout: string }> {
  const originalLog = console.log;
  let stdout = "";
  console.log = (...args: unknown[]) => {
    stdout += args.map((arg) => String(arg)).join(" ") + "\n";
  };
  try {
    const code = await runUpgrade({
      json: true,
      noColor: true,
      dryRun: true,
      check: false,
      allowDirty: true,
      registry,
      currentSchema: SYNTHETIC_CURRENT_SCHEMA,
      cwd: dir,
    });
    return { code, stdout };
  } finally {
    console.log = originalLog;
  }
}

Deno.test("upgrade and upgrade --check refuse absent or invalid schema metadata without writing", async () => {
  for (
    const variant of [
      { name: "missing", replacement: undefined },
      { name: "invalid", replacement: '"one"' },
    ] as const
  ) {
    await withTempDir(async (dir) => {
      await setup(dir);
      await corruptSchema(dir, variant.replacement);
      const before = await readTarget(dir, "discern.toml");
      for (const invoke of [upgradeJsonIn, upgradeCheckJsonIn]) {
        const run = await invoke(dir);
        assertEquals(run.code, 1, `${variant.name}: ${run.stdout}`);
        const result = decodeCliResult(run.stdout, "upgrade");
        assertEquals(result.ok, false);
        assertEquals(result.error, "invalid_config");
        assertResultDataKey(result, "issues");
        assertEquals(result.data.issues, [{
          path: "meta.schema_version",
          message: variant.name === "missing"
            ? "is missing"
            : 'must be a positive integer (found "one")',
        }]);
        assertStringIncludes(result.message ?? "", "discern setup begin");
        assertStringIncludes(result.message ?? "", "version control");
        assertEquals(await readTarget(dir, "discern.toml"), before);
      }
    });
  }
});

Deno.test("setup begin stamps missing or invalid schema metadata only while setup is incomplete", async () => {
  for (const replacement of [undefined, '"one"'] as const) {
    await withTempDir(async (dir) => {
      await setup(dir);
      await corruptSchema(dir, replacement);
      const resumed = await runCli([
        "setup",
        "begin",
        "--confirmed",
        "--slug",
        "demo",
        "--name",
        "Demo",
      ], dir);
      assertEquals(resumed.code, 0, resumed.stderr);
      assertEquals(await recordedSchema(dir), SCHEMA_VERSION);
    });
  }
});

Deno.test("upgrade check detects and upgrade restores a missing fixed banner without touching key comments", async () => {
  await withTempDir(async (dir) => {
    await setup(dir);
    const configPath = join(dir, "discern.toml");
    const current = await Deno.readTextFile(configPath);
    const identity = current.indexOf("# [scripts]\n");
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
    const checkResult = decodeCliResult(check.stdout, "upgrade");
    assertResultDataKey(checkResult, "pending_reconciliation");
    assertEquals(
      checkResult.data.pending_reconciliation,
      [
        { kind: "banner", path: "scripts" },
      ],
    );

    assertEquals(await upgradeIn(dir), 0);
    const upgraded = await Deno.readTextFile(configPath);
    assertStringIncludes(upgraded, "# [scripts]\n");
    assertStringIncludes(upgraded, projectComment);

    assertEquals(await upgradeIn(dir), 0);
    assertEquals(await Deno.readTextFile(configPath), upgraded);
  });
});

Deno.test("upgrade check reports an injected next-schema migration without writing", async () => {
  await withTempDir(async (dir) => {
    await setup(dir);
    const before = await readTarget(dir, "discern.toml");
    const chain: Migration[] = [{
      from: SCHEMA_VERSION,
      describe: "synthetic next-schema step",
      apply: () => Promise.resolve(),
    }];

    const check = await upgradeCheckJsonIn(dir, chain);
    assertEquals(check.code, 1);
    const result = decodeCliResult(check.stdout, "upgrade");
    assertResultDataKey(result, "schema");
    assertEquals(result.data.schema, {
      recorded: SCHEMA_VERSION,
      current: SYNTHETIC_CURRENT_SCHEMA,
    });
    assertEquals(result.data.pending_migrations, [{
      from: SCHEMA_VERSION,
      to: SYNTHETIC_CURRENT_SCHEMA,
      describe: "synthetic next-schema step",
    }]);
    assertHasHint(result, HINTS["upgrade-check-pending"]);
    assertEquals(await readTarget(dir, "discern.toml"), before);
  });
});

Deno.test("upgrade refuses a config from a newer schema and does not stamp down", async () => {
  await withTempDir(async (dir) => {
    await setup(dir);
    await setSchema(dir, SCHEMA_VERSION + 1);
    const before = await readTarget(dir, "discern.toml");

    const run = await upgradeJsonIn(dir);
    assertEquals(run.code, 1);
    const res = decodeCliResult(run.stdout, "upgrade");
    assertEquals(res.error, "schema_version_too_new");
    assert(res.message !== undefined);
    assertStringIncludes(res.message, "this project needs a newer discern");
    assertStringIncludes(res.message, "re-run the installer");
    assertEquals(await readTarget(dir, "discern.toml"), before);

    const check = await upgradeCheckJsonIn(dir);
    assertEquals(check.code, 1);
    assertEquals(
      decodeCliResult(check.stdout, "upgrade").error,
      "schema_version_too_new",
    );
  });
});

Deno.test("upgrade refuses to stamp when a migration leaves invalid TOML", async () => {
  await withTempDir(async (dir) => {
    await setup(dir);
    await setSchema(dir, SCHEMA_VERSION);
    const chain: Migration[] = [{
      from: SCHEMA_VERSION,
      describe: "write invalid TOML",
      apply: (ctx) =>
        ctx.rewrite("discern.toml", (text) => `${text}\nbad = "\\q"\n`),
    }];
    const before = await readTarget(dir, "discern.toml");

    const run = await upgradeJsonIn(dir, chain);
    assertEquals(run.code, 1);
    const res = decodeCliResult(run.stdout, "upgrade");
    assertEquals(res.error, "invalid_migrated_config");
    assert(res.message !== undefined);
    assertStringIncludes(res.message, "schema was not stamped");
    assertEquals(await readTarget(dir, "discern.toml"), before);
    assertEquals(await recordedSchema(dir), SCHEMA_VERSION);
  });
});

Deno.test("a current install has nothing pending and applies no migrations", async () => {
  await withTempDir(async (dir) => {
    await setup(dir); // a fresh install is stamped at the current schema
    const r = await runCli(["upgrade", "--json"], dir);
    assertEquals(r.code, 0, r.stderr);
    const upgraded = decodeCliResult(r.stdout, "upgrade");
    assertResultDataKey(upgraded, "migrations_applied");
    assertEquals(upgraded.data.migrations_applied, []);
    const c = await runCli(["upgrade", "--check", "--json"], dir);
    const checked = decodeCliResult(c.stdout, "upgrade");
    assertResultDataKey(checked, "pending_migrations");
    assertEquals(checked.data.pending_migrations, []);
  });
});

Deno.test("upgrade dry-run previews an injected migration without applying it", async () => {
  await withTempDir(async (dir) => {
    await setup(dir);
    const chain: Migration[] = [{
      from: SCHEMA_VERSION,
      describe: "write a marker",
      apply: (ctx) => ctx.writeText("MIGRATED", "yes\n"),
    }];

    const run = await upgradeDryRunJsonIn(dir, chain);
    assertEquals(run.code, 0);
    const result = decodeCliResult(run.stdout, "upgrade");
    assertResultDataKey(result, "pending_migrations");
    assertEquals(result.dry_run, true);
    assertEquals(result.data.pending_migrations, [{
      from: SCHEMA_VERSION,
      to: SYNTHETIC_CURRENT_SCHEMA,
      describe: "write a marker",
    }]);
    assertEquals(await targetExists(join(dir, "MIGRATED")), false);
    assertEquals(await recordedSchema(dir), SCHEMA_VERSION);
  });
});

Deno.test("upgrade (json) carries the restart-your-agents hint on the applied result", async () => {
  await withTempDir(async (dir) => {
    await setup(dir); // a fresh install: nothing to migrate, but the apply still runs
    const run = await upgradeJsonIn(dir);
    assertEquals(run.code, 0, run.stdout);
    assertHasHint(
      decodeCliResult(run.stdout, "upgrade"),
      HINTS["upgrade-restart-session"],
    );
  });
});

Deno.test("upgrade runs a pending migration before the sync, then stamps the schema", async () => {
  await withTempDir(async (dir) => {
    await setup(dir);
    await setSchema(dir, SCHEMA_VERSION);

    const ran: string[] = [];
    // A synthetic 1→2 step targets the next schema through the test seam.
    const chain: Migration[] = [{
      from: SCHEMA_VERSION,
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
    assertEquals(await targetExists(join(dir, "MIGRATED")), true);
    assert(
      (await readTarget(dir, "discern.toml")).includes(
        'branch_prefix = "wt/"',
      ),
    );
    // And the config was stamped to the current schema.
    assertEquals(await recordedSchema(dir), SYNTHETIC_CURRENT_SCHEMA);
  });
});

Deno.test("upgrade re-running an applied migration is a no-op (idempotent fold)", async () => {
  await withTempDir(async (dir) => {
    await setup(dir);
    await setSchema(dir, SCHEMA_VERSION);
    const chain: Migration[] = [{
      from: SCHEMA_VERSION,
      describe: "create a marker",
      apply: (ctx) => ctx.writeText("MIGRATED", "yes\n"),
    }];
    assertEquals(await upgradeIn(dir, chain), 0); // schema 1 → 2, runs
    // Now at the current schema: re-running finds nothing pending, still succeeds.
    assertEquals(await upgradeIn(dir, chain), 0);
    assertEquals(await recordedSchema(dir), SYNTHETIC_CURRENT_SCHEMA);
  });
});
