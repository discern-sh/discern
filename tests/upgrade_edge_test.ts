/**
 * Edge-path coverage for `discern upgrade` (src/commands/upgrade.ts). The other
 * upgrade_*_test.ts files cover the happy paths — the --check primitive, the git
 * guard, the migration fold, and convergence. This file drives the failure and
 * reporting branches they leave uncovered:
 *
 *   - the pre-flight refusals: no discern.toml, unparseable toml; and the
 *     fatal path when the templates dir is missing (the config scaffold cannot
 *     be reconciled, so the schema is not stamped);
 *   - the human-mode (non-JSON) renderings of --check ok, the dirty guard, and
 *     the migrations-applied summary;
 *   - --dry-run's --json payload;
 *   - the agents-default fallback when discern.toml carries no agents key.
 *
 * Human output goes to stderr; machine assertions read --json from stdout.
 */

import {
  assert,
  assertEquals,
  assertExists,
  assertStringIncludes,
} from "@std/assert";
import { join } from "@std/path";
import { runUpgrade } from "../src/commands/upgrade.ts";
import type { Migration } from "../src/lib/migrations.ts";
import { SCHEMA_VERSION } from "../src/lib/version.ts";
import {
  assertTerminalTextIncludes,
  readTarget,
  runCli,
  withTempDir,
} from "./helpers.ts";
import { targetExists } from "../src/shared/fs_presence.ts";
import { assertResultDataKey, decodeCliResult } from "./decode_cli_result.ts";
import { gitInit } from "./engine_helpers.ts";

const SYNTHETIC_CURRENT_SCHEMA = SCHEMA_VERSION + 1;

Deno.test("upgrade --check help enumerates every exit-affecting reconciliation family", async () => {
  await withTempDir(async (dir) => {
    const help = await runCli(["upgrade", "--help"], dir);
    assertEquals(help.code, 0, help.stderr);
    for (
      const condition of [
        "config migrations",
        "fixed config scaffold",
        "managed-banner drift",
        ".gitignore",
        ".gitattributes",
        "exit non-zero",
        "write nothing",
        "no network",
      ]
    ) {
      assertTerminalTextIncludes(help.stdout, condition);
    }
  });
});

/** Fresh install in `dir` (the standard scaffold the other suites use). */
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
    const res = decodeCliResult(r.stdout, "upgrade");
    assertEquals(res.ok, false);
    assertEquals(res.error, "not_initialized");
    assertExists(res.message);
    assertStringIncludes(res.message, "discern setup");
  });
});

Deno.test("upgrade with no discern.toml fails as not_initialized (human)", async () => {
  await withTempDir(async (dir) => {
    const r = await runCli(["upgrade"], dir);
    assertEquals(r.code, 1);
    assertTerminalTextIncludes(r.stderr, "discern setup");
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
    const res = decodeCliResult(r.stdout, "upgrade");
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
    const res = decodeCliResult(r.stdout, "upgrade");
    assertEquals(res.ok, false);
    assertEquals(res.error, "schema_version_too_new");
    assertExists(res.message);
    assertStringIncludes(res.message, "this project needs a newer discern");
    assertStringIncludes(res.message, "re-run the installer");
    assertEquals(await readTarget(dir, "discern.toml"), before);
  });
});

Deno.test("upgrade refuses an absent templates dir before stamping (--json)", async () => {
  await withTempDir(async (dir) => {
    await setup(dir);
    // Point resolution at a path that does not exist. Instruction refresh failures
    // are still isolated, but the config template is now required so upgrade can
    // prove and repair scaffold drift before stamping the schema.
    const r = await runCli(["upgrade", "--json"], dir, {
      DISCERN_TEMPLATES_DIR: join(dir, "no", "such", "templates"),
    });
    assertEquals(r.code, 1, r.stderr);
    const res = decodeCliResult(r.stdout, "upgrade");
    assertEquals(res.ok, false);
    assertEquals(res.error, "config_template_unavailable");
    assertExists(res.message);
    assertResultDataKey(res, "config_reconciled");
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
    assertTerminalTextIncludes(r.stderr, "config template");
    assertTerminalTextIncludes(r.stderr, "schema was not stamped");
  });
});

// ---- agents-default fallback ----------------------------------------------

Deno.test("upgrade fills agents from defaults when discern.toml carries no agents key", async () => {
  await withTempDir(async (dir) => {
    await setup(dir);
    // Strip the `agents = [...]` line so [project].agents is absent; the
    // instruction compile must fall back to the default agents to resolve content.
    const tomlPath = join(dir, "discern.toml");
    const stripped = (await Deno.readTextFile(tomlPath))
      .split("\n")
      .filter((l) => !/^\s*agents\s*=/.test(l))
      .join("\n");
    await Deno.writeTextFile(tomlPath, stripped);
    await git(dir, "add", "discern.toml");
    await git(dir, "commit", "-m", "model install without agent selection");
    // The upgrade still succeeds and compiles the default agent files.
    const r = await runCli(["upgrade", "--json"], dir);
    assertEquals(r.code, 0, r.stderr);
    const res = decodeCliResult(r.stdout, "upgrade");
    assertEquals(res.ok, true);
    assertResultDataKey(res, "instruction_refresh");
    const refresh = res.data.instruction_refresh;
    assertExists(refresh);
    assertEquals(refresh.status, "complete");
    assertEquals(refresh.compiled, [
      "CLAUDE.md",
      "AGENTS.md",
    ]);
  });
});

Deno.test("upgrade --json reports a partial refresh as top-level not-ok while keeping the stamp", async () => {
  await withTempDir(async (dir) => {
    await setup(dir);
    const malformed = '{ "mcpServers": { "other": true, }, }\n';
    await Deno.writeTextFile(join(dir, ".mcp.json"), malformed);
    await git(dir, "add", ".mcp.json");
    await git(dir, "commit", "-m", "model malformed provider settings");

    const r = await runCli(["upgrade", "--json"], dir);
    assertEquals(r.code, 1, r.stderr);
    const res = decodeCliResult(r.stdout, "upgrade");
    assertEquals(res.ok, false);
    assertEquals(res.error, "partial_refresh");
    assertResultDataKey(res, "instruction_refresh");
    const refresh = res.data.instruction_refresh;
    assertExists(refresh);
    assertEquals(refresh.status, "partial");
    if (refresh.status !== "partial") return;
    assertStringIncludes(
      refresh.failures.map((failure) => failure.evidence).join("\n"),
      "malformed JSON",
    );
    assertEquals(refresh.effects_preserved, true);
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
    assertTerminalTextIncludes(r.stderr, "up to date");
  });
});

// ---- --dry-run ------------------------------------------------------------

Deno.test("upgrade --dry-run --json previews pending migrations and writes nothing", async () => {
  await withTempDir(async (dir) => {
    await setup(dir);
    const r = await runCli(["upgrade", "--dry-run", "--json"], dir);
    assertEquals(r.code, 0, r.stderr);
    const res = decodeCliResult(r.stdout, "upgrade");
    assertEquals(res.ok, true);
    assertEquals(res.dry_run, true);
    assertResultDataKey(res, "pending_migrations");
    // The dry-run payload no longer enumerates skills (the compiler does that on
    // a real run); it previews only the pending migration chain.
    assertEquals(res.data.pending_migrations, []); // current install → none pending
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
    assertTerminalTextIncludes(r.stderr, "uncommitted changes");
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
    const res = decodeCliResult(r.stdout, "upgrade");
    assertEquals(res.error, "dirty_worktree");
    assertResultDataKey(res, "changes");
    assertExists(res.data.changes);
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
      currentSchema: registry === undefined
        ? undefined
        : SYNTHETIC_CURRENT_SCHEMA,
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
    await setSchema(dir, SCHEMA_VERSION);
    const chain: Migration[] = [{
      from: SCHEMA_VERSION,
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
    assertEquals(await targetExists(join(dir, "MIGRATED")), true);
  });
});

Deno.test("upgrade (human) closes with the restart-your-agents hint, even with nothing to migrate", async () => {
  await withTempDir(async (dir) => {
    await setup(dir);
    // A plain apply with no pending migrations still recompiles and re-stamps, and
    // still just replaced the binary from the user's point of view — so the restart
    // hint is unconditional, not gated on a migration having run.
    const { code, err } = await upgradeHumanIn(dir);
    assertEquals(code, 0, err);
    assertStringIncludes(err, "restart it so its discern MCP server reloads");
  });
});
