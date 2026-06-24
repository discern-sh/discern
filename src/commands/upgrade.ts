/**
 * `discern upgrade` — bring an install forward to the current kit.
 *
 * The managed-file/hash machinery is gone (there is no committed engine to keep
 * in sync — the engine lives in the binary). What remains is narrow and additive:
 *
 *   1. run any pending config-schema migrations (ADR 0014/0020);
 *   2. recompile the guidelines — which re-materializes the bundled skills into
 *      `.claude/skills/` and writes the per-provider agent files (each gated on
 *      its feature);
 *   3. stamp the new `[meta].schema_version` into the config.
 *
 * Your files (`discern.toml`, guidance sources, authored skills, recipes) are
 * never touched. The clean-tree git guard keeps the upgrade revertible.
 */

import { Logger } from "../lib/log.ts";
import { worktreeState } from "../lib/git.ts";
import { resolveConfigPath } from "../lib/paths.ts";
import { parseDiscernToml } from "../lib/toml_render.ts";
import { KIT_VERSION, SCHEMA_VERSION } from "../lib/version.ts";
import { resolveRecordedSchema, stampSchemaVersion } from "../lib/schema.ts";
import { TomlEditor } from "../lib/toml_edit.ts";
import {
  applyMigrations,
  type Migration,
  pendingMigrations,
} from "../lib/migrations.ts";
import {
  compileGuidelines,
  type GuidelinesResult,
} from "../engine/guidelines.ts";

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

/** Run `discern upgrade`. Returns a process exit code. */
export async function runUpgrade(options: UpgradeOptions): Promise<number> {
  const log = new Logger(options);
  const destDir = Deno.cwd();

  // Must be inside an initialized project. Detect either layout so a
  // pre-6 install (legacy `.discern/config.toml`) is recognised and carried
  // forward by the migration chain below.
  const configPath = await resolveConfigPath(destDir);
  const tomlText = configPath === undefined
    ? undefined
    : await readTextIfExists(configPath);
  if (tomlText === undefined) {
    const message =
      "no discern install here — run `discern setup` first. `upgrade` refreshes an existing install.";
    if (options.json) {
      log.result({
        ok: false,
        verb: "upgrade",
        error: "not_initialized",
        message,
      });
    } else {
      log.error(message);
    }
    return 1;
  }

  let toml: ReturnType<typeof parseDiscernToml>;
  try {
    toml = parseDiscernToml(tomlText);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (options.json) {
      log.result({
        ok: false,
        verb: "upgrade",
        error: "invalid_toml",
        message,
      });
    } else {
      log.error(message);
    }
    return 1;
  }

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
      log.result({
        ok,
        verb: "upgrade",
        data: {
          check: true,
          schema: { recorded: migrateFrom, current: SCHEMA_VERSION },
          pending_migrations: pendingJson,
        },
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
      log.info("Apply it: run `discern upgrade`.");
    }
    return ok ? 0 : 1;
  }

  if (options.dryRun) {
    if (options.json) {
      log.result({
        ok: true,
        verb: "upgrade",
        dry_run: true,
        data: { pending_migrations: pendingJson },
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
        "Would recompile the agent guidance and re-materialize the bundled skills.",
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
        log.result({
          ok: false,
          verb: "upgrade",
          error: "dirty_worktree",
          message,
          data: { changes: state.changes },
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

  // 1. Run the migration chain. Steps are idempotent; for a pre-6 install the
  // schema 5→6 step dissolves `.discern/` into the new single-file layout.
  const applied = await applyMigrations({
    destDir,
    from: migrateFrom,
    to: SCHEMA_VERSION,
    registry: options.registry,
    onNote: (m) => log.detail(m),
  });

  // 2. Recompile the guidelines (re-materializes skills + writes agent files,
  // each gated on its feature). A failure here is non-fatal to the upgrade — the
  // schema is still stamped — but it is reported.
  let guidelines: GuidelinesResult | undefined;
  try {
    // Pass upgrade's own logger so its narration follows upgrade's stream
    // discipline (suppressed in --json, stderr in human mode) — never polluting
    // the stdout JSON object.
    guidelines = await compileGuidelines(destDir, log);
  } catch (error) {
    log.warn(
      `could not recompile guidelines: ${
        error instanceof Error ? error.message : String(error)
      }`,
    );
  }

  // 3. Stamp the new schema version into the config (now at its migrated path).
  // Re-resolve in case the migration moved it, falling back to the original path.
  const newConfigPath = (await resolveConfigPath(destDir)) ?? configPath;
  if (newConfigPath === undefined) {
    throw new Error("config path could not be resolved after migration");
  }
  await stampSchema(newConfigPath, SCHEMA_VERSION);

  if (options.json) {
    log.result({
      ok: true,
      verb: "upgrade",
      hints: guidelines?.hints ?? [],
      data: {
        kit_version: KIT_VERSION,
        // `from` is the pre-upgrade schema; the install now records `current`
        // (the stamp ran above), so reporting it as still "recorded" would mislead.
        schema: { from: migrateFrom, current: SCHEMA_VERSION },
        migrations_applied: applied.map((m) => ({
          from: m.from,
          to: m.from + 1,
          describe: m.describe,
        })),
        skills: guidelines === undefined ? null : {
          copied: guidelines.skillsCopied,
          linked: guidelines.skillsLinked,
          pruned: guidelines.skillsPruned,
        },
        agents_written: guidelines?.agentsWritten ?? [],
        mcp_wired: guidelines?.mcpWired ?? [],
        mcp_removed: guidelines?.mcpRemoved ?? [],
        guidelines_compiled: guidelines !== undefined,
      },
    });
    return 0;
  }

  if (applied.length > 0) {
    log.ok(`migrations applied: ${applied.length}`);
    for (const m of applied) {
      log.detail(`${m.from}→${m.from + 1}: ${m.describe}`);
    }
  }
  renderUpgradeSummary(log, guidelines, applied.length);
  return 0;
}

/**
 * Render the human upgrade summary: how many skills were re-materialized and
 * whether guidelines recompiled. The schema stamp is implicit (it always runs).
 */
function renderUpgradeSummary(
  log: Logger,
  guidelines: GuidelinesResult | undefined,
  migrationCount: number,
): void {
  log.heading("Upgrade summary");
  if (migrationCount > 0) {
    log.info(`migrations applied: ${migrationCount}`);
  }
  if (guidelines !== undefined) {
    log.ok(
      `skills re-materialized: ${
        guidelines.skillsCopied + guidelines.skillsLinked
      } (${guidelines.skillsCopied} bundled, ${guidelines.skillsLinked} authored)`,
    );
    log.ok(
      guidelines.agentsWritten.length > 0
        ? `guidelines recompiled: ${guidelines.agentsWritten.join(", ")}`
        : "guidelines: nothing to compile",
    );
  }
  log.ok(`install stamped at schema ${SCHEMA_VERSION}`);
  // R6: keep the two upgrade axes distinct — `discern upgrade` refreshed THIS
  // project to match the installed binary; getting a NEWER binary is separate.
  log.line();
  log.info(
    "This refreshed your project to match the installed discern. To get a newer discern itself, re-run the installer (e.g. `brew upgrade discern`).",
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
