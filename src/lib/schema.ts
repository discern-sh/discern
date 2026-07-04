/**
 * The install schema version, recorded in the config under `[meta].schema_version`.
 *
 * The schema version (ADR 0014) is the anchor the migration chain steps from: a
 * plain monotonic integer, distinct from the kit's display version, that bumps
 * only when an installed project needs a migration to stay correct. It lives in
 * the config the user already owns, recorded under `[meta].schema_version`.
 *
 * `setup` stamps the current value via {@link stampSchemaVersion}; `upgrade` reads
 * the recorded value with {@link resolveRecordedSchema}, runs the pending chain,
 * and re-stamps. `upgrade` reads it to report status.
 */

import { join } from "@std/path";
import type { TomlEditor } from "./toml_edit.ts";

/** The dotted config key the schema version is recorded under. */
export const SCHEMA_VERSION_KEY = "meta.schema_version";

/** True for a non-null, non-array object. */
function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * Read `[meta].schema_version` from a parsed config's `raw` tree, or undefined
 * when absent or not a positive integer.
 */
export function schemaFromRaw(
  raw: Record<string, unknown>,
): number | undefined {
  const meta = isRecord(raw.meta) ? raw.meta : undefined;
  const v = meta?.schema_version;
  return typeof v === "number" && Number.isInteger(v) && v >= 1 ? v : undefined;
}

/**
 * Resolve the install's recorded schema version — the anchor the migration
 * chain steps from. Resolution preserves the prior chain's intent:
 *
 *   1. `[meta].schema_version` in the config, if present. A fresh `setup` always
 *      stamps it, so every current install hits this.
 *   2. else a legacy `.discern/manifest.json`'s `schema_version`, if present —
 *      so an old hash-tracked install starts its migration from the right step
 *      (and its engine is pruned by the final step).
 *   3. else `1` — a config predating the field is, by definition, a schema-1
 *      install (that anchor was introduced as v1), to be migrated forward.
 *
 * @param raw     the parsed config's `raw` tree
 * @param destDir the install root, for the legacy-manifest fallback
 */
export async function resolveRecordedSchema(
  raw: Record<string, unknown>,
  destDir: string,
): Promise<number> {
  const fromConfig = schemaFromRaw(raw);
  if (fromConfig !== undefined) {
    return fromConfig;
  }
  const fromManifest = await schemaFromLegacyManifest(destDir);
  return fromManifest ?? 1;
}

/** True when the project was written by a newer binary than this one. */
export function isRecordedSchemaNewer(
  recorded: number,
  current: number,
): boolean {
  return recorded > current;
}

/** The refusal shown when this binary cannot safely read a newer config shape. */
export function newerSchemaRefusalMessage(
  recorded: number,
  current: number,
): string {
  return `this project needs a newer discern — re-run the installer (project schema v${recorded}, this discern supports v${current}).`;
}

/**
 * Read `schema_version` from a legacy `.discern/manifest.json`, or undefined
 * when the manifest is absent, unreadable, or carries no integer version. The
 * manifest is otherwise dead — only its recorded schema still anchors an
 * upgrading legacy install, after which the prune step deletes the file.
 */
async function schemaFromLegacyManifest(
  destDir: string,
): Promise<number | undefined> {
  let text: string;
  try {
    text = await Deno.readTextFile(join(destDir, ".discern/manifest.json"));
  } catch {
    return undefined;
  }
  try {
    const parsed: unknown = JSON.parse(text);
    if (!isRecord(parsed)) {
      return undefined;
    }
    const v = parsed.schema_version;
    return typeof v === "number" && Number.isInteger(v) && v >= 1
      ? v
      : undefined;
  } catch {
    return undefined;
  }
}

/** Stamp `[meta].schema_version = <version>` into a config editor, in place. */
export function stampSchemaVersion(editor: TomlEditor, version: number): void {
  editor.setNumber(SCHEMA_VERSION_KEY, version);
}
