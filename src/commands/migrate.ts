/**
 * `discern migrate` — report the install's migration status (ADR 0014).
 *
 * Migrations are a versioned chain that `discern upgrade` runs automatically
 * (then re-materializes skills, recompiles guidelines, and stamps the new
 * schema). This command is the read-only inspection surface: it shows the
 * install's recorded schema version and any steps still pending, and points at
 * `upgrade` to apply them. It deliberately never writes — applying a migration
 * without the rest of the upgrade would leave a half-migrated install, so
 * applying is upgrade's job alone.
 *
 * The recorded schema lives in the config under `[meta].schema_version`; a
 * config predating the field reads as schema 1 (or a legacy manifest's recorded
 * version), and the chain carries it forward.
 */

import { Logger } from "../lib/log.ts";
import { resolveConfigPath } from "../lib/paths.ts";
import { parseDiscernToml } from "../lib/toml_render.ts";
import { resolveRecordedSchema } from "../lib/schema.ts";
import { SCHEMA_VERSION } from "../lib/version.ts";
import { type Migration, pendingMigrations } from "../lib/migrations.ts";

/** Options accepted by `migrate` (global flags folded in). */
export interface MigrateOptions {
  json: boolean;
  noColor: boolean;
  /** Exit non-zero when migrations are pending (a scripting / CI signal). */
  check: boolean;
  /**
   * The migration chain to inspect. Defaults to the production chain
   * (`MIGRATIONS`); overridable so tests can report against synthetic steps.
   */
  registry?: Migration[];
}

/** Run `discern migrate`. Returns a process exit code. */
export async function runMigrate(options: MigrateOptions): Promise<number> {
  const log = new Logger(options);
  const destDir = Deno.cwd();

  const configPath = await resolveConfigPath(destDir);
  if (configPath === undefined) {
    const message =
      "no discern install here — run `discern init` first, or cd into the project root.";
    if (options.json) {
      log.result({
        ok: false,
        verb: "migrate",
        error: "not_initialized",
        message,
      });
    } else {
      log.error(message);
    }
    return 1;
  }

  // The recorded schema anchors the chain. It is read from the config's
  // `[meta].schema_version` (falling back to a legacy manifest, else schema 1).
  let raw: Record<string, unknown> = {};
  try {
    raw = parseDiscernToml(await Deno.readTextFile(configPath)).raw;
  } catch {
    // An unparseable config still reports a status; treat it as having no
    // recorded schema, so the resolver falls back as it would for a fresh field.
  }
  const recorded = await resolveRecordedSchema(raw, destDir);
  const pending = pendingMigrations(recorded, SCHEMA_VERSION, options.registry);
  const code = options.check && pending.length > 0 ? 1 : 0;

  if (options.json) {
    log.result({
      ok: pending.length === 0,
      verb: "migrate",
      data: {
        schema: { recorded, current: SCHEMA_VERSION },
        pending_migrations: pending.map((m) => ({
          from: m.from,
          to: m.from + 1,
          describe: m.describe,
        })),
      },
    });
    return code;
  }

  if (pending.length === 0) {
    log.ok(`Up to date — install is at schema ${recorded} (current).`);
    return code;
  }

  log.info(
    `${pending.length} migration(s) pending (schema ${recorded} → ${SCHEMA_VERSION}):`,
  );
  for (const m of pending) {
    log.detail(`${m.from}→${m.from + 1}: ${m.describe}`);
  }
  log.line();
  log.info("Apply them: run `discern upgrade`.");
  return code;
}
