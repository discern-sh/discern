/**
 * `icculus migrate` — report the install's migration status (ADR 0014).
 *
 * Migrations are a versioned chain that `icculus upgrade` runs automatically
 * (then syncs files and stamps the new schema). This command is the read-only
 * inspection surface: it shows the install's recorded schema version and any
 * steps still pending, and points at `upgrade` to apply them. It deliberately
 * never writes — applying a migration without the file sync would leave a
 * half-migrated install, so applying is upgrade's job alone.
 *
 * The bespoke 0.x→1.0 transform this command once performed was retired with the
 * versioned schema model (ADR 0014): the current shape is schema 1 and the chain
 * starts clean, so a pre-1.0 config is no longer auto-rewritten.
 */

import { Logger } from "../lib/log.ts";
import { resolveConfigPath } from "../lib/paths.ts";
import { selfCmd } from "../lib/invocation.ts";
import { loadManifest } from "../lib/manifest.ts";
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

/** Run `icculus migrate`. Returns a process exit code. */
export async function runMigrate(options: MigrateOptions): Promise<number> {
  const log = new Logger(options);
  const destDir = Deno.cwd();

  if ((await resolveConfigPath(destDir)) === undefined) {
    const message =
      "no icculus install here — run `icculus init` first, or cd into the project root.";
    if (options.json) {
      log.jsonResult({ ok: false, error: "not_initialized", message });
    } else {
      log.error(message);
    }
    return 1;
  }

  // The recorded schema anchors the chain. Absent a manifest we can't know it,
  // so assume current (nothing pending) — `doctor` flags a missing manifest.
  const { manifest } = await loadManifest(destDir);
  const recorded = manifest?.schema_version ?? SCHEMA_VERSION;
  const pending = pendingMigrations(recorded, SCHEMA_VERSION, options.registry);
  const code = options.check && pending.length > 0 ? 1 : 0;

  if (options.json) {
    log.jsonResult({
      ok: pending.length === 0,
      schema: { recorded, current: SCHEMA_VERSION },
      pending_migrations: pending.map((m) => ({
        from: m.from,
        to: m.from + 1,
        describe: m.describe,
      })),
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
  log.info(`Apply them: run \`${await selfCmd("sync")}\`.`);
  return code;
}
