/**
 * Edge-path coverage for `discern upgrade` (src/commands/upgrade.ts). The other
 * upgrade_*_test.ts files cover the happy paths — the --check primitive, the git
 * guard, the migration fold, and convergence. This file drives the failure and
 * reporting branches they leave uncovered:
 *
 *   - the pre-flight refusals: no discern.toml, unparseable toml; and the
 *     fatal path when the templates dir is missing (the config scaffold cannot
 *     be reconciled, so the schema is not stamped);
 *   - the human-mode (non-JSON) renderings of --check ok, --dry-run, the dirty
 *     guard, and the migrations-applied summary;
 *   - --dry-run's --json payload and its pending-migration preview;
 *   - the agents-default fallback when discern.toml carries no agents key.
 *
 * Human output goes to stderr; machine assertions read --json from stdout.
 */

import { assert, assertEquals, assertStringIncludes } from "@std/assert";
import { join } from "@std/path";
import { runUpgrade } from "../src/commands/upgrade.ts";
import type { Migration } from "../src/lib/migrations.ts";
import { SCHEMA_VERSION } from "../src/lib/version.ts";
import { readTarget, runCli, targetExists, withTempDir } from "./helpers.ts";

/** Fresh install in `dir` (the standard scaffold the other suites use). */
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

/** Run a git command in `dir`, throwing on failure. */
async function git(dir: string, ...args: string[]): Promise<void> {
  const r = await new Deno.Command("git", {
    args,
    cwd: dir,
    stdout: "null",
    stderr: "null",
  }).output();
  if (!r.success) throw new Error(`git ${args.join(" ")} failed`);
}

/** A fresh install committed into a new git repo — a clean starting tree. */
async function initCommittedRepo(dir: string): Promise<void> {
  await setup(dir);
  await git(dir, "init");
  await git(dir, "config", "user.email", "test@example.com");
  await git(dir, "config", "user.name", "Test");
  await git(dir, "add", "-A");
  await git(dir, "commit", "-m", "initial");
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

// ---- pre-flight refusals --------------------------------------------------

Deno.test("upgrade with no discern.toml fails as not_initialized (--json)", async () => {
  await withTempDir(async (dir) => {
    // A bare dir is not an install: there is no discern.toml to refresh.
    const r = await runCli(["upgrade", "--json"], dir);
    assertEquals(r.code, 1);
    const res = JSON.parse(r.stdout);
    assertEquals(res.ok, false);
    assertEquals(res.error, "not_initialized");
    assertStringIncludes(res.message, "discern setup");
  });
});

Deno.test("upgrade with no discern.toml fails as not_initialized (human)", async () => {
  await withTempDir(async (dir) => {
    const r = await runCli(["upgrade"], dir);
    assertEquals(r.code, 1);
    assertStringIncludes(r.stderr, "discern setup");
  });
});

Deno.test("upgrade with an unparseable discern.toml fails as invalid_toml (--json)", async () => {
  await withTempDir(async (dir) => {
    await setup(dir);
    // Corrupt the toml so parseDiscernToml throws.
    await Deno.writeTextFile(
      join(dir, "discern.toml"),
      "this = = broken\n[[[\n",
    );
    const r = await runCli(["upgrade", "--json"], dir);
    assertEquals(r.code, 1);
    const res = JSON.parse(r.stdout);
    assertEquals(res.ok, false);
    assertEquals(res.error, "invalid_toml");
    assert(typeof res.message === "string" && res.message.length > 0);
  });
});

Deno.test("upgrade with an unparseable discern.toml fails as invalid_toml (human)", async () => {
  await withTempDir(async (dir) => {
    await setup(dir);
    await Deno.writeTextFile(
      join(dir, "discern.toml"),
      "broken = = =\n[[[\n",
    );
    const r = await runCli(["upgrade"], dir);
    assertEquals(r.code, 1);
    // The parse error text lands on stderr (no JSON envelope).
    assert(r.stderr.length > 0);
  });
});

Deno.test("upgrade refuses a config from a newer schema (--json)", async () => {
  await withTempDir(async (dir) => {
    await setup(dir);
    await setSchema(dir, SCHEMA_VERSION + 1);
    const before = await readTarget(dir, "discern.toml");

    const r = await runCli(["upgrade", "--json"], dir);
    assertEquals(r.code, 1);
    const res = JSON.parse(r.stdout);
    assertEquals(res.ok, false);
    assertEquals(res.error, "schema_version_too_new");
    assertStringIncludes(res.message, "this project needs a newer discern");
    assertStringIncludes(res.message, "re-run the installer");
    assertEquals(await readTarget(dir, "discern.toml"), before);
  });
});

Deno.test("upgrade refuses an absent templates dir before stamping (--json)", async () => {
  await withTempDir(async (dir) => {
    await setup(dir);
    // Point resolution at a path that does not exist. Guideline refresh failures
    // are still isolated, but the config template is now required so upgrade can
    // prove and repair scaffold drift before stamping the schema.
    const r = await runCli(["upgrade", "--json"], dir, {
      DISCERN_TEMPLATES_DIR: join(dir, "no", "such", "templates"),
    });
    assertEquals(r.code, 1, r.stderr);
    const res = JSON.parse(r.stdout);
    assertEquals(res.ok, false);
    assertEquals(res.error, "config_template_unavailable");
    assertStringIncludes(res.message, "schema was not stamped");
    assertEquals(res.data.config_reconciled, []);
  });
});

Deno.test("upgrade refuses an absent templates dir before stamping (human)", async () => {
  await withTempDir(async (dir) => {
    await setup(dir);
    const r = await runCli(["upgrade"], dir, {
      DISCERN_TEMPLATES_DIR: join(dir, "no", "such", "templates"),
    });
    assertEquals(r.code, 1);
    assertStringIncludes(r.stderr, "config template");
    assertStringIncludes(r.stderr, "schema was not stamped");
  });
});

// ---- agents-default fallback ----------------------------------------------

Deno.test("upgrade fills agents from defaults when discern.toml carries no agents key", async () => {
  await withTempDir(async (dir) => {
    await setup(dir);
    // Strip the `agents = [...]` line so [guidance].agents is absent; the
    // guideline compile must fall back to the default agents to resolve content.
    const tomlPath = join(dir, "discern.toml");
    const stripped = (await Deno.readTextFile(tomlPath))
      .split("\n")
      .filter((l) => !/^\s*agents\s*=/.test(l))
      .join("\n");
    await Deno.writeTextFile(tomlPath, stripped);
    // The upgrade still succeeds and compiles the default agent files.
    const r = await runCli(["upgrade", "--json"], dir);
    assertEquals(r.code, 0, r.stderr);
    const res = JSON.parse(r.stdout);
    assertEquals(res.ok, true);
    assertEquals(res.data.guidelines_compiled, true);
    assertEquals(res.data.agents_written, ["CLAUDE.md", "AGENTS.md"]);
  });
});

Deno.test("upgrade --json reports a partial refresh as top-level not-ok while keeping the stamp", async () => {
  await withTempDir(async (dir) => {
    await setup(dir);
    const malformed = '{ "mcpServers": { "other": true, }, }\n';
    await Deno.writeTextFile(join(dir, ".mcp.json"), malformed);

    const r = await runCli(["upgrade", "--json"], dir);
    assertEquals(r.code, 0, r.stderr);
    const res = JSON.parse(r.stdout);
    assertEquals(res.ok, false);
    assertEquals(res.error, "partial_refresh");
    assertEquals(res.data.guidelines_compiled, false);
    assertStringIncludes(
      res.data.guidelines_errors.join("\n"),
      "malformed JSON",
    );
    assertEquals(await recordedSchema(dir), SCHEMA_VERSION);
    assertEquals(await Deno.readTextFile(join(dir, ".mcp.json")), malformed);
  });
});

// ---- --check, human mode --------------------------------------------------

Deno.test("upgrade --check (human) confirms an in-sync install and exits zero", async () => {
  await withTempDir(async (dir) => {
    await setup(dir);
    const r = await runCli(["upgrade", "--check"], dir);
    assertEquals(r.code, 0, r.stderr);
    // The ok line is the human rendering of `ok: true` (no JSON envelope).
    assertStringIncludes(r.stderr, "up to date");
  });
});

// ---- --dry-run ------------------------------------------------------------

Deno.test("upgrade --dry-run --json previews pending migrations and writes nothing", async () => {
  await withTempDir(async (dir) => {
    await setup(dir);
    const r = await runCli(["upgrade", "--dry-run", "--json"], dir);
    assertEquals(r.code, 0, r.stderr);
    const res = JSON.parse(r.stdout);
    assertEquals(res.ok, true);
    assertEquals(res.dry_run, true);
    // The dry-run payload no longer enumerates skills (the compiler does that on
    // a real run); it previews only the pending migration chain.
    assertEquals(res.data.pending_migrations, []); // current install → none pending
  });
});

Deno.test("upgrade --dry-run --json previews pending migrations without running them", async () => {
  await withTempDir(async (dir) => {
    await setup(dir);
    // Regress the recorded schema so the production 1→2 step is pending.
    await setSchema(dir, 1);
    const r = await runCli(["upgrade", "--dry-run", "--json"], dir);
    assertEquals(r.code, 0, r.stderr);
    const res = JSON.parse(r.stdout);
    assertEquals(res.dry_run, true);
    assertEquals(
      res.data.pending_migrations.map((m: { from: number }) => m.from),
      [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15],
    );
    // Still a dry run: the schema is untouched on disk.
    assertEquals(await recordedSchema(dir), 1);
  });
});

Deno.test("upgrade --dry-run (human) names pending migrations and writes nothing", async () => {
  await withTempDir(async (dir) => {
    await setup(dir);
    await setSchema(dir, 1);
    const r = await runCli(["upgrade", "--dry-run"], dir);
    assertEquals(r.code, 0, r.stderr);
    // The human preview announces the migration step it would run first…
    assertStringIncludes(r.stderr, "1→2"); // "1→2"
    // …and the closing reassurance that nothing was written.
    assertStringIncludes(r.stderr, "No files were written");
    assertEquals(await recordedSchema(dir), 1); // untouched
  });
});

// ---- dirty-tree guard, human + many-changes -------------------------------

Deno.test("upgrade (human) refuses a dirty tree and lists the changed paths", async () => {
  await withTempDir(async (dir) => {
    await initCommittedRepo(dir);
    await Deno.writeTextFile(
      join(dir, "discern.toml"),
      `${await Deno.readTextFile(join(dir, "discern.toml"))}\n# edit\n`,
    );
    const r = await runCli(["upgrade"], dir);
    assertEquals(r.code, 1);
    assertStringIncludes(r.stderr, "uncommitted changes");
    assertStringIncludes(r.stderr, "discern.toml"); // the dirty path is detailed
  });
});

Deno.test("upgrade truncates the dirty-change list past ten entries", async () => {
  await withTempDir(async (dir) => {
    await initCommittedRepo(dir);
    // Dirty more than ten tracked files so the "… and N more" tail renders.
    for (let i = 0; i < 14; i++) {
      const rel = `tracked-${i}.txt`;
      await Deno.writeTextFile(join(dir, rel), "v1\n");
      await git(dir, "add", rel);
    }
    await git(dir, "commit", "-m", "add tracked files");
    for (let i = 0; i < 14; i++) {
      await Deno.writeTextFile(join(dir, `tracked-${i}.txt`), "v2\n");
    }
    const r = await runCli(["upgrade", "--json"], dir);
    assertEquals(r.code, 1);
    const res = JSON.parse(r.stdout);
    assertEquals(res.error, "dirty_worktree");
    // The JSON payload carries the full change list…
    assert(
      res.data.changes.length >= 14,
      `expected >=14 changes, got ${res.data.changes.length}`,
    );
    // …while the human stderr caps the detail and appends a "more" tail.
    const human = await runCli(["upgrade"], dir);
    assertStringIncludes(human.stderr, "more");
  });
});

// ---- in-process: human migrations-applied summary -------------------------

/**
 * Run `runUpgrade` in-process against `dir` with a synthetic chain and human
 * (non-JSON) output, capturing what it writes to stderr. `dir` is passed as the
 * command's `cwd`, and we swap `console.error` to capture the human summary
 * lines. `--allow-dirty` skips the clean-tree guard for the throwaway install.
 */
async function upgradeHumanIn(
  dir: string,
  registry?: Migration[],
): Promise<{ code: number; err: string }> {
  const originalError = console.error;
  let err = "";
  console.error = (...args: unknown[]) => {
    err += args.map((a) => String(a)).join(" ") + "\n";
  };
  try {
    const code = await runUpgrade({
      json: false,
      noColor: true,
      dryRun: false,
      check: false,
      allowDirty: true,
      registry,
      cwd: dir,
    });
    return { code, err };
  } finally {
    console.error = originalError;
  }
}

Deno.test("upgrade (human) reports the migrations it applied", async () => {
  await withTempDir(async (dir) => {
    await setup(dir);
    await setSchema(dir, SCHEMA_VERSION - 1); // one behind → the synthetic step is pending
    const chain: Migration[] = [{
      from: SCHEMA_VERSION - 1,
      describe: "a synthetic smoke step",
      apply: async (ctx) => {
        await ctx.writeText("MIGRATED", "yes\n");
        // A step's note is streamed through upgrade's onNote → log.detail.
        ctx.note("wrote the MIGRATED marker");
      },
    }];
    const { code, err } = await upgradeHumanIn(dir, chain);
    assertEquals(code, 0, err);
    // The human summary announces the applied count and the step description.
    assertStringIncludes(err, "migrations applied");
    assertStringIncludes(err, "a synthetic smoke step");
    // The step's note was surfaced as a detail line.
    assertStringIncludes(err, "wrote the MIGRATED marker");
    assertEquals(await targetExists(dir, "MIGRATED"), true);
  });
});
