/**
 * Edge-path coverage for `icculus upgrade` (src/commands/upgrade.ts). The other
 * upgrade_*_test.ts files cover the happy paths — orphan reconciliation, the
 * --check primitive, the git guard, the migration fold, grouped output, and
 * convergence. This file drives the failure and reporting branches they leave
 * uncovered:
 *
 *   - the pre-flight refusals: no .icculus/config.toml, unparseable toml, missing
 *     templates dir;
 *   - the manifest-absent / manifest-unparseable warnings (and the empty-orphan
 *     path they imply);
 *   - the human-mode (non-JSON) renderings of --check ok, --dry-run, the dirty
 *     guard, the migrations-applied summary, and the kept-orphan warning;
 *   - --dry-run's --json payload and its pending-migration preview;
 *   - the agents-default fallback when .icculus/config.toml carries no agents key.
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
async function init(dir: string): Promise<void> {
  assertEquals(
    (await runCli(["init", "--yes", "--slug", "demo", "--name", "Demo"], dir))
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
  await init(dir);
  await git(dir, "init");
  await git(dir, "config", "user.email", "test@example.com");
  await git(dir, "config", "user.name", "Test");
  await git(dir, "add", "-A");
  await git(dir, "commit", "-m", "initial");
}

/** Overwrite the install's recorded schema_version (to model one behind). */
async function setSchema(dir: string, version: number): Promise<void> {
  const mp = join(dir, ".icculus/manifest.json");
  const m = JSON.parse(await Deno.readTextFile(mp));
  m.schema_version = version;
  await Deno.writeTextFile(mp, `${JSON.stringify(m, null, 2)}\n`);
}

// ---- pre-flight refusals --------------------------------------------------

Deno.test("upgrade with no .icculus/config.toml fails as not_initialized (--json)", async () => {
  await withTempDir(async (dir) => {
    // A bare dir is not an install: there is no .icculus/config.toml to refresh.
    const r = await runCli(["upgrade", "--json"], dir);
    assertEquals(r.code, 1);
    const res = JSON.parse(r.stdout);
    assertEquals(res.ok, false);
    assertEquals(res.error, "not_initialized");
    assertStringIncludes(res.message, "icculus init");
  });
});

Deno.test("upgrade with no .icculus/config.toml fails as not_initialized (human)", async () => {
  await withTempDir(async (dir) => {
    const r = await runCli(["upgrade"], dir);
    assertEquals(r.code, 1);
    assertStringIncludes(r.stderr, "icculus init");
  });
});

Deno.test("upgrade with an unparseable .icculus/config.toml fails as invalid_toml (--json)", async () => {
  await withTempDir(async (dir) => {
    await init(dir);
    // Corrupt the toml so parseIcculusToml throws.
    await Deno.writeTextFile(
      join(dir, ".icculus/config.toml"),
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

Deno.test("upgrade with an unparseable .icculus/config.toml fails as invalid_toml (human)", async () => {
  await withTempDir(async (dir) => {
    await init(dir);
    await Deno.writeTextFile(
      join(dir, ".icculus/config.toml"),
      "broken = = =\n[[[\n",
    );
    const r = await runCli(["upgrade"], dir);
    assertEquals(r.code, 1);
    // The parse error text lands on stderr (no JSON envelope).
    assert(r.stderr.length > 0);
  });
});

Deno.test("upgrade fails as templates_not_found when the templates dir is absent (--json)", async () => {
  await withTempDir(async (dir) => {
    await init(dir);
    // Point resolution at a path that does not exist; resolveTemplatesDir throws.
    const r = await runCli(["upgrade", "--json"], dir, {
      ICCULUS_TEMPLATES_DIR: join(dir, "no", "such", "templates"),
    });
    assertEquals(r.code, 1);
    const res = JSON.parse(r.stdout);
    assertEquals(res.ok, false);
    assertEquals(res.error, "templates_not_found");
  });
});

Deno.test("upgrade fails as templates_not_found when the templates dir is absent (human)", async () => {
  await withTempDir(async (dir) => {
    await init(dir);
    const r = await runCli(["upgrade"], dir, {
      ICCULUS_TEMPLATES_DIR: join(dir, "no", "such", "templates"),
    });
    assertEquals(r.code, 1);
    assert(r.stderr.length > 0);
  });
});

// ---- manifest-absent / manifest-unparseable -------------------------------

Deno.test("upgrade (human) with no manifest warns and treats edited files as .new", async () => {
  await withTempDir(async (dir) => {
    await init(dir);
    // With no manifest there are no recorded hashes, so upgrade cannot tell a
    // pristine file from an edited one: a managed file whose bytes differ from
    // the template is assumed edited and preserved as `.new`. Run in human mode
    // so the warning renders (it is suppressed under --json).
    const agent = join(dir, "agent");
    await Deno.writeTextFile(
      agent,
      `${await Deno.readTextFile(agent)}\n# local edit\n`,
    );
    await Deno.remove(join(dir, ".icculus/manifest.json"));
    const r = await runCli(["upgrade"], dir); // non-git temp dir → proceeds
    assertEquals(r.code, 0, r.stderr);
    assertStringIncludes(r.stderr, "manifest"); // the warn rides stderr
    // The edited-but-unrecorded file is preserved as a `.new` sibling.
    assertEquals(await targetExists(dir, "agent.new"), true);
    // The upgrade rebuilds a manifest from disk, so one exists again.
    assertEquals(await targetExists(dir, ".icculus/manifest.json"), true);
  });
});

Deno.test("upgrade --json with an unparseable manifest warns and proceeds", async () => {
  await withTempDir(async (dir) => {
    await init(dir);
    // Corrupt the manifest JSON: parseManifest throws, upgrade warns and treats
    // every managed file as edited (no recorded hashes to trust). In --json mode
    // the warn is suppressed, so we assert the report shape and the disk instead.
    await Deno.writeTextFile(
      join(dir, ".icculus/manifest.json"),
      "{ not valid json",
    );
    const r = await runCli(["upgrade", "--json"], dir);
    assertEquals(r.code, 0, r.stderr);
    const res = JSON.parse(r.stdout);
    assertEquals(res.ok, true);
    // No trustworthy recorded hashes → no orphan reconciliation.
    assertEquals(res.orphans_kept, []);
    assertEquals(res.removed, []);
    // The untrusted manifest is replaced by a freshly rebuilt one.
    assertEquals(await targetExists(dir, ".icculus/manifest.json"), true);
  });
});

// ---- agents-default fallback ----------------------------------------------

Deno.test("upgrade fills agents from defaults when .icculus/config.toml carries no agents key", async () => {
  await withTempDir(async (dir) => {
    await init(dir);
    // Strip the `agents = [...]` line so toml.project.agents is absent; the
    // upgrade must fall back to DEFAULTS.agents to resolve content tokens.
    const tomlPath = join(dir, ".icculus/config.toml");
    const stripped = (await Deno.readTextFile(tomlPath))
      .split("\n")
      .filter((l) => !/^\s*agents\s*=/.test(l))
      .join("\n");
    await Deno.writeTextFile(tomlPath, stripped);
    // The upgrade still succeeds; the engine files are agent-token-free, so the
    // fallback only has to resolve cleanly — which it does.
    const r = await runCli(["upgrade", "--json"], dir);
    assertEquals(r.code, 0, r.stderr);
    assertEquals(JSON.parse(r.stdout).ok, true);
  });
});

// ---- --check, human mode --------------------------------------------------

Deno.test("upgrade --check (human) confirms an in-sync install and exits zero", async () => {
  await withTempDir(async (dir) => {
    await init(dir);
    const r = await runCli(["upgrade", "--check"], dir);
    assertEquals(r.code, 0, r.stderr);
    // The ok line is the human rendering of `ok: true` (no JSON envelope).
    assertStringIncludes(r.stderr, "in sync");
  });
});

// ---- --dry-run ------------------------------------------------------------

Deno.test("upgrade --dry-run --json returns a plan and writes nothing", async () => {
  await withTempDir(async (dir) => {
    await init(dir);
    // Drop a managed file so the plan has a concrete entry to report.
    await Deno.remove(join(dir, ".icculus/engine/doctor"));
    const r = await runCli(["upgrade", "--dry-run", "--json"], dir);
    assertEquals(r.code, 0, r.stderr);
    const res = JSON.parse(r.stdout);
    assertEquals(res.ok, true);
    assertEquals(res.dry_run, true);
    assert(Array.isArray(res.plan), "the dry-run payload carries a plan array");
    assertEquals(res.pending_migrations, []); // current install → none pending
    // A dry run must not perform the write it previewed.
    assertEquals(await targetExists(dir, ".icculus/engine/doctor"), false);
  });
});

Deno.test("upgrade --dry-run --json previews pending migrations without running them", async () => {
  await withTempDir(async (dir) => {
    await init(dir);
    // Regress the recorded schema so the production 1→2 step is pending.
    await setSchema(dir, 1);
    const r = await runCli(["upgrade", "--dry-run", "--json"], dir);
    assertEquals(r.code, 0, r.stderr);
    const res = JSON.parse(r.stdout);
    assertEquals(res.dry_run, true);
    assertEquals(
      res.pending_migrations.map((m: { from: number }) => m.from),
      [1, 2],
    );
    // Still a dry run: the schema is untouched on disk.
    const m = JSON.parse(await readTarget(dir, ".icculus/manifest.json"));
    assertEquals(m.schema_version, 1);
  });
});

Deno.test("upgrade --dry-run (human) names pending migrations and writes nothing", async () => {
  await withTempDir(async (dir) => {
    await init(dir);
    await setSchema(dir, 1);
    const r = await runCli(["upgrade", "--dry-run"], dir);
    assertEquals(r.code, 0, r.stderr);
    // The human preview announces the migration step it would run first…
    assertStringIncludes(r.stderr, "1→2"); // "1→2"
    // …and the closing reassurance that nothing was written.
    assertStringIncludes(r.stderr, "No files were written");
    const m = JSON.parse(await readTarget(dir, ".icculus/manifest.json"));
    assertEquals(m.schema_version, 1); // untouched
  });
});

// ---- dirty-tree guard, human + many-changes -------------------------------

Deno.test("upgrade (human) refuses a dirty tree and lists the changed paths", async () => {
  await withTempDir(async (dir) => {
    await initCommittedRepo(dir);
    await Deno.writeTextFile(
      join(dir, ".icculus/config.toml"),
      `${await Deno.readTextFile(join(dir, ".icculus/config.toml"))}\n# edit\n`,
    );
    const r = await runCli(["upgrade"], dir);
    assertEquals(r.code, 1);
    assertStringIncludes(r.stderr, "uncommitted changes");
    assertStringIncludes(r.stderr, ".icculus/config.toml"); // the dirty path is detailed
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
      res.changes.length >= 14,
      `expected >=14 changes, got ${res.changes.length}`,
    );
    // …while the human stderr caps the detail and appends a "more" tail.
    const human = await runCli(["upgrade"], dir);
    assertStringIncludes(human.stderr, "more");
  });
});

// ---- in-process: human migrations-applied summary -------------------------

/**
 * Run `runUpgrade` in-process against `dir` with a synthetic chain and human
 * (non-JSON) output, capturing what it writes to stderr. The command resolves
 * the project from `Deno.cwd()`, so we chdir for the call and restore after
 * (the suite runs sequentially, so the global cwd is safe to borrow), and we
 * swap `console.error` to capture the human summary lines. `--allow-dirty`
 * skips the clean-tree guard for the throwaway install.
 */
async function upgradeHumanIn(
  dir: string,
  registry?: Migration[],
): Promise<{ code: number; err: string }> {
  const cwd = Deno.cwd();
  const originalError = console.error;
  let err = "";
  console.error = (...args: unknown[]) => {
    err += args.map((a) => String(a)).join(" ") + "\n";
  };
  try {
    Deno.chdir(dir);
    const code = await runUpgrade({
      json: false,
      noColor: true,
      dryRun: false,
      check: false,
      allowDirty: true,
      registry,
    });
    return { code, err };
  } finally {
    console.error = originalError;
    Deno.chdir(cwd);
  }
}

Deno.test("upgrade (human) reports the migrations it applied", async () => {
  await withTempDir(async (dir) => {
    await init(dir);
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

// ---- kept-orphan warning, human mode --------------------------------------

/**
 * Record a managed file the templates no longer ship, with a recorded hash that
 * differs from the on-disk bytes so it reads as user-edited (a kept orphan).
 */
async function injectEditedOrphan(
  dir: string,
  rel: string,
): Promise<void> {
  await Deno.writeTextFile(join(dir, rel), "mine\n");
  const mp = join(dir, ".icculus/manifest.json");
  const m = JSON.parse(await Deno.readTextFile(mp));
  m.managed.push({ path: rel, sha256: "0".repeat(64) }); // hash mismatch → edited
  await Deno.writeTextFile(mp, `${JSON.stringify(m, null, 2)}\n`);
}

Deno.test("upgrade (human) warns about a single kept orphan with its reason", async () => {
  await withTempDir(async (dir) => {
    await init(dir);
    await injectEditedOrphan(dir, ".icculus/engine/edited-one");
    const r = await runCli(["upgrade"], dir); // non-git temp dir → proceeds
    assertEquals(r.code, 0, r.stderr);
    // Singular phrasing ("1 managed file … no longer shipped but kept") plus the
    // path-and-reason detail line.
    assertStringIncludes(r.stderr, "no longer shipped but kept");
    assertStringIncludes(r.stderr, ".icculus/engine/edited-one");
    // The file is reported, never deleted.
    assertEquals(await targetExists(dir, ".icculus/engine/edited-one"), true);
  });
});

Deno.test("upgrade (human) warns about multiple kept orphans (plural phrasing)", async () => {
  await withTempDir(async (dir) => {
    await init(dir);
    await injectEditedOrphan(dir, ".icculus/engine/edited-a");
    await injectEditedOrphan(dir, ".icculus/engine/edited-b");
    const r = await runCli(["upgrade"], dir);
    assertEquals(r.code, 0, r.stderr);
    // Plural phrasing ("2 managed files …").
    assertStringIncludes(r.stderr, "2 managed files");
    assertStringIncludes(r.stderr, ".icculus/engine/edited-a");
    assertStringIncludes(r.stderr, ".icculus/engine/edited-b");
  });
});
