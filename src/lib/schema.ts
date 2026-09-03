/**
 * The install schema version, recorded in the config under `[meta].schema_version`.
 *
 * The schema version (ADR 0014) is the anchor the migration chain steps from: a
 * plain monotonic integer, distinct from the kit's display version, that bumps
 * only when an installed project needs a migration to stay correct. It lives in
 * the config the user already owns, recorded under `[meta].schema_version`.
 *
 * `setup` stamps the current value via {@link stampSchemaVersion}; `upgrade`
 * inspects the explicit recorded value, runs the pending chain, and re-stamps.
 */

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
 * Inspect the install's recorded schema version. A fresh setup stamps the key;
 * absence or an invalid value is never inferred as schema 1 because that would
 * run migrations against an unknown source contract.
 */
export function inspectRecordedSchema(
  raw: Record<string, unknown>,
):
  | { status: "valid"; value: number }
  | { status: "missing" }
  | { status: "invalid"; value: unknown } {
  const meta = isRecord(raw.meta) ? raw.meta : undefined;
  if (meta === undefined || !Object.hasOwn(meta, "schema_version")) {
    return { status: "missing" };
  }
  const value = meta.schema_version;
  return typeof value === "number" && Number.isInteger(value) && value >= 1
    ? { status: "valid", value }
    : { status: "invalid", value };
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

/** Stamp `[meta].schema_version = <version>` into a config editor, in place. */
export function stampSchemaVersion(editor: TomlEditor, version: number): void {
  editor.setNumber(SCHEMA_VERSION_KEY, version);
}
