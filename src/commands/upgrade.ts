/**
 * `icculus upgrade` — bring an install forward to the current kit.
 *
 * The managed-file/hash machinery is gone (there is no committed engine to keep
 * in sync — the engine lives in the binary). What remains is narrow and additive:
 *
 *   1. run any pending config-schema migrations (ADR 0014);
 *   2. re-materialize the bundled skills into `.icculus/skills/` (always
 *      overwritten — they are the binary's artifact, not the user's);
 *   3. recompile the guidelines (which also reconciles the `.claude/skills/`
 *      symlinks against the freshly materialized skills);
 *   4. stamp the new `[meta].schema_version` into the config.
 *
 * Seed files (`.icculus/config.toml`, guidelines, brief, …) are never touched.
 * The clean-tree git guard keeps the upgrade revertible.
 */

import { Logger } from "../lib/log.ts";
import { worktreeState } from "../lib/git.ts";
import { resolveConfigPath, resolveTemplatesDir } from "../lib/paths.ts";
import { parseIcculusToml } from "../lib/toml_render.ts";
import { DEFAULTS, type InitConfig, tokensFromConfig } from "../lib/config.ts";
import { KIT_VERSION, SCHEMA_VERSION } from "../lib/version.ts";
import { resolveRecordedSchema, stampSchemaVersion } from "../lib/schema.ts";
import { TomlEditor } from "../lib/toml_edit.ts";
import {
  applyPlan,
  buildPlan,
  isMaterialized,
  type Plan,
  type PlanOp,
} from "../lib/fs_plan.ts";
import {
  applyMigrations,
  type Migration,
  pendingMigrations,
} from "../lib/migrations.ts";
import { compileGuidelines } from "../engine/guidelines.ts";

/** Options accepted by the `upgrade` command. */
export interface UpgradeOptions {
  json: boolean;
  noColor: boolean;
  dryRun: boolean;
  /** Report whether config migrations are pending and exit; write nothing. */
  check: boolean;
  /** Upgrade even with uncommitted tracked changes (skip the clean-tree guard). */
  allowDirty: boolean;
  /**
   * The migration chain to run. Defaults to the production chain (`MIGRATIONS`);
   * overridable so tests can drive the fold with synthetic steps without a real
   * `SCHEMA_VERSION` bump.
   */
  registry?: Migration[] | undefined;
}

/** Read a text file, or undefined if absent. */
async function readTextIfExists(path: string): Promise<string | undefined> {
  try {
    return await Deno.readTextFile(path);
  } catch (error) {
    if (error instanceof Deno.errors.NotFound) {
      return undefined;
    }
    throw error;
  }
}

/**
 * Reconstruct the content tokens an upgrade needs from the project's existing
 * `.icculus/config.toml`. Materialized skills are token-free, so the only path
 * token that matters is the slug; content tokens are filled from config with
 * documented defaults so any stray token still resolves consistently.
 */
function tokensForUpgrade(
  toml: ReturnType<typeof parseIcculusToml>,
): InitConfig {
  return {
    projectName: toml.project.slug ?? "app",
    slug: toml.project.slug ?? "app",
    branchPrefix: toml.project.branch_prefix ?? DEFAULTS.branchPrefix,
    sourceGlobs: [...DEFAULTS.sourceGlobs],
    brief: "",
    agents:
      (toml.project.agents && toml.project.agents.length > 0
        ? toml.project.agents
        : [...DEFAULTS.agents]) as InitConfig["agents"],
  };
}

/**
 * Build the materialization plan: the full templates walk filtered to the
 * always-overwritten `.icculus/skills/**` artifacts. Seed files are deliberately
 * excluded — `upgrade` refreshes the binary's artifacts, it never re-scaffolds
 * the user's seeds.
 */
async function buildSkillsPlan(
  templatesDir: string,
  destDir: string,
  config: InitConfig,
): Promise<Plan> {
  const plan = await buildPlan({
    templatesDir,
    destDir,
    tokens: tokensFromConfig(config),
  });
  plan.ops = plan.ops.filter((op) => isMaterialized(op.targetRel));
  return plan;
}

/** Run `icculus upgrade`. Returns a process exit code. */
export async function runUpgrade(options: UpgradeOptions): Promise<number> {
  const log = new Logger(options);
  const destDir = Deno.cwd();

  // Must be inside an initialized project. Detect either layout so a
  // pre-migration install (legacy root `icculus.toml`) is recognised and
  // carried forward by the migration chain below.
  const configPath = await resolveConfigPath(destDir);
  const tomlText = configPath === undefined
    ? undefined
    : await readTextIfExists(configPath);
  if (tomlText === undefined) {
    const message =
      "no icculus install here — run `icculus init` first. `upgrade` refreshes an existing install.";
    if (options.json) {
      log.jsonResult({ ok: false, error: "not_initialized", message });
    } else {
      log.error(message);
    }
    return 1;
  }

  let toml: ReturnType<typeof parseIcculusToml>;
  try {
    toml = parseIcculusToml(tomlText);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (options.json) {
      log.jsonResult({ ok: false, error: "invalid_toml", message });
    } else {
      log.error(message);
    }
    return 1;
  }

  let templatesDir: string;
  try {
    templatesDir = await resolveTemplatesDir();
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (options.json) {
      log.jsonResult({ ok: false, error: "templates_not_found", message });
    } else {
      log.error(message);
    }
    return 1;
  }

  const config = tokensForUpgrade(toml);

  // The migration chain to run: every step from the install's recorded schema
  // (read from `[meta].schema_version`, falling back to a legacy manifest or
  // schema 1) up to this build's SCHEMA_VERSION.
  const migrateFrom = await resolveRecordedSchema(toml.raw, destDir);
  const pending = pendingMigrations(
    migrateFrom,
    SCHEMA_VERSION,
    options.registry,
  );
  const pendingJson = pending.map((m) => ({
    from: m.from,
    to: m.from + 1,
    describe: m.describe,
  }));

  // --check: report whether config migrations are pending. There is no managed
  // drift any more — an install is current iff its schema is current.
  if (options.check) {
    const ok = pending.length === 0;
    if (options.json) {
      log.jsonResult({
        ok,
        check: true,
        schema: { recorded: migrateFrom, current: SCHEMA_VERSION },
        pending_migrations: pendingJson,
      });
    } else if (ok) {
      log.ok(`Install is up to date (schema ${SCHEMA_VERSION}).`);
    } else {
      log.error(
        `Install schema is v${migrateFrom}, but this build expects v${SCHEMA_VERSION}.`,
      );
      for (const m of pending) {
        log.detail(`migration ${m.from}→${m.from + 1}: ${m.describe}`);
      }
      log.line();
      log.info("Apply it: run `icculus upgrade`.");
    }
    return ok ? 0 : 1;
  }

  if (options.dryRun) {
    const skillsPlan = await buildSkillsPlan(templatesDir, destDir, config);
    if (options.json) {
      log.jsonResult({
        ok: true,
        dry_run: true,
        pending_migrations: pendingJson,
        skills: skillsPlan.ops.map((op) => op.targetRel),
      });
    } else {
      if (pending.length > 0) {
        log.info(`Would run ${pending.length} migration(s):`);
        for (const m of pending) {
          log.detail(`${m.from}→${m.from + 1}: ${m.describe}`);
        }
        log.line();
      }
      log.info(
        `Would re-materialize ${skillsPlan.ops.length} skill file(s) and recompile guidelines.`,
      );
      log.line();
      log.info("No files were written (--dry-run).");
    }
    return 0;
  }

  // Clean-tree guard (ADR 0014): an upgrade must stay revertible with
  // `git checkout`, so refuse a tree carrying uncommitted *tracked* changes
  // unless --allow-dirty. Only the mutating path reaches here — `--check` and
  // `--dry-run` returned above, so neither is ever blocked. A non-repo cannot
  // offer the net, so it proceeds with a note rather than failing.
  if (!options.allowDirty) {
    const state = await worktreeState(destDir);
    if (state.kind === "dirty") {
      const message =
        "working tree has uncommitted changes; commit or stash them so the upgrade stays revertible, or re-run with --allow-dirty.";
      if (options.json) {
        log.jsonResult({
          ok: false,
          error: "dirty_worktree",
          message,
          changes: state.changes,
        });
      } else {
        log.error(message);
        for (const c of state.changes.slice(0, 10)) {
          log.detail(c);
        }
        if (state.changes.length > 10) {
          log.detail(`… and ${state.changes.length - 10} more`);
        }
      }
      return 1;
    }
    if (state.kind === "not-a-repo" && !options.json) {
      log.warn(
        "not a git repository — upgrading without a clean-tree safety net.",
      );
    }
  }

  // 1. Run the migration chain. Steps are idempotent; the final one prunes any
  // pre-existing on-disk shell engine.
  const applied = await applyMigrations({
    destDir,
    from: migrateFrom,
    to: SCHEMA_VERSION,
    registry: options.registry,
    onNote: (m) => log.detail(m),
  });

  // 2. Re-materialize the bundled skills (always overwritten).
  const skillsPlan = await buildSkillsPlan(templatesDir, destDir, config);
  const materialized = await applyPlan(skillsPlan);

  // 3. Recompile guidelines (also reconciles the .claude/skills/ symlinks). A
  // failure here is non-fatal to the upgrade — the schema is still stamped — but
  // it is reported.
  let guidelinesOk = true;
  try {
    // Pass upgrade's own logger so its narration follows upgrade's stream
    // discipline (suppressed in --json, stderr in human mode) — never polluting
    // the stdout JSON object.
    await compileGuidelines(destDir, log);
  } catch (error) {
    guidelinesOk = false;
    log.warn(
      `could not recompile guidelines: ${
        error instanceof Error ? error.message : String(error)
      }`,
    );
  }

  // 4. Stamp the new schema version into the config.
  await stampSchema(configPath!, SCHEMA_VERSION);

  if (options.json) {
    log.jsonResult({
      ok: true,
      kit_version: KIT_VERSION,
      // `from` is the pre-upgrade schema; the install now records `current`
      // (the stamp ran above), so reporting it as still "recorded" would mislead.
      schema: { from: migrateFrom, current: SCHEMA_VERSION },
      migrations_applied: applied.map((m) => ({
        from: m.from,
        to: m.from + 1,
        describe: m.describe,
      })),
      skills_materialized: materialized.map((op) => op.targetRel),
      guidelines_compiled: guidelinesOk,
    });
    return 0;
  }

  if (applied.length > 0) {
    log.ok(`migrations applied: ${applied.length}`);
    for (const m of applied) {
      log.detail(`${m.from}→${m.from + 1}: ${m.describe}`);
    }
  }
  renderUpgradeSummary(log, materialized, applied.length, guidelinesOk);
  return 0;
}

/**
 * Render the human upgrade summary: how many skills were re-materialized and
 * whether guidelines recompiled. The schema stamp is implicit (it always runs).
 */
function renderUpgradeSummary(
  log: Logger,
  materialized: PlanOp[],
  migrationCount: number,
  guidelinesOk: boolean,
): void {
  log.heading("Upgrade summary");
  if (migrationCount > 0) {
    log.info(`migrations applied: ${migrationCount}`);
  }
  log.ok(`skills re-materialized: ${materialized.length}`);
  if (guidelinesOk) {
    log.ok("guidelines recompiled");
  }
  log.ok(`install stamped at schema ${SCHEMA_VERSION}`);
  // R6: keep the two upgrade axes distinct — `icculus upgrade` refreshed THIS
  // project to match the installed binary; getting a NEWER binary is separate.
  log.line();
  log.info(
    "This refreshed your project to match the installed icculus. To get a newer icculus itself, re-run the installer (e.g. `brew upgrade icculus`).",
  );
}

/** Stamp `[meta].schema_version` into the config at `configPath`, in place. */
async function stampSchema(
  configPath: string,
  version: number,
): Promise<void> {
  const editor = new TomlEditor(await Deno.readTextFile(configPath));
  stampSchemaVersion(editor, version);
  await Deno.writeTextFile(configPath, editor.toString());
}
