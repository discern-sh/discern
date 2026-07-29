/**
 * The versioned migration framework (ADR 0014).
 *
 * A migration is one idempotent step that brings an install from schema
 * version `from` to `from + 1`. `upgrade` reads the install's recorded
 * `schema_version`, runs every pending step in order up to the build's
 * `SCHEMA_VERSION`, validates the result, then stamps the new version.
 *
 * The first public release starts at schema 1, so the production registry is
 * empty. The runner and context remain in place for the first public schema
 * change.
 */

import { ensureDir } from "@std/fs";
import { dirname, join } from "@std/path";
import type { EnvReader } from "../shared/env.ts";
import { CONFIG_REL } from "../shared/env.ts";
import { mergeSettings } from "./settings_merge.ts";
import { writeDiscernToml } from "./tidy_format.ts";
import { TomlEditor } from "./toml_edit.ts";

/** The operations a migration step performs against an install. */
export interface MigrationContext {
  /** Absolute destination root of the install being migrated. */
  readonly destDir: string;
  /**
   * Env reader for any env-sourced override a step consults. Injectable so a
   * migration test never mutates process-global environment state.
   */
  readonly env: EnvReader;
  /** True if a target-relative path exists. */
  exists(rel: string): Promise<boolean>;
  /** Read a target file as text, or undefined if absent. */
  readText(rel: string): Promise<string | undefined>;
  /** Write a target file, creating parent directories. */
  writeText(rel: string, content: string): Promise<void>;
  /** Delete a target file; a no-op if it is already gone. */
  remove(rel: string): Promise<void>;
  /** Recursively delete a target; a no-op if it is already gone. */
  removeAll(rel: string): Promise<void>;
  /**
   * Move `from` to `to`, preserving content and creating the destination's
   * parent. A missing source is an idempotent no-op.
   */
  rename(from: string, to: string): Promise<void>;
  /** Transform a target file's text; a no-op if absent or unchanged. */
  rewrite(rel: string, fn: (text: string) => string): Promise<void>;
  /** Read the install's root `discern.toml`, or undefined if absent. */
  readConfig(): Promise<string | undefined>;
  /** Edit `discern.toml` while preserving comments; a no-op if absent. */
  editToml(fn: (editor: TomlEditor) => void): Promise<void>;
  /** Deep-merge `incoming` into `.claude/settings.json`. */
  mergeSettings(incoming: Record<string, unknown>): Promise<void>;
  /** Record a human-readable note about what this step changed. */
  note(message: string): void;
}

/** One step in the migration chain: schema `from` to `from + 1`. */
export interface Migration {
  /** The schema version this step upgrades from. */
  from: number;
  /** One-line description shown in human and JSON output. */
  describe: string;
  /** Apply the idempotent transformation. */
  apply(ctx: MigrationContext): Promise<void>;
}

/**
 * The ordered production migration chain. The first public release is schema
 * 1, so no public transition exists yet.
 */
export const MIGRATIONS: Migration[] = [];

/** Build the context a migration uses to transform the install at `destDir`. */
export function createMigrationContext(
  destDir: string,
  onNote: (message: string) => void = () => {},
  env: EnvReader = Deno.env,
): MigrationContext {
  const abs = (rel: string): string => join(destDir, rel);

  async function exists(rel: string): Promise<boolean> {
    try {
      await Deno.stat(abs(rel));
      return true;
    } catch {
      return false;
    }
  }

  async function readText(rel: string): Promise<string | undefined> {
    try {
      return await Deno.readTextFile(abs(rel));
    } catch (error) {
      if (error instanceof Deno.errors.NotFound) {
        return undefined;
      }
      throw error;
    }
  }

  async function writeText(rel: string, content: string): Promise<void> {
    await ensureDir(dirname(abs(rel)));
    if (rel === CONFIG_REL) {
      await writeDiscernToml(abs(rel), content);
      return;
    }
    await Deno.writeTextFile(abs(rel), content);
  }

  async function remove(rel: string): Promise<void> {
    try {
      await Deno.remove(abs(rel));
    } catch (error) {
      if (!(error instanceof Deno.errors.NotFound)) {
        throw error;
      }
    }
  }

  async function removeAll(rel: string): Promise<void> {
    try {
      await Deno.remove(abs(rel), { recursive: true });
    } catch (error) {
      if (!(error instanceof Deno.errors.NotFound)) {
        throw error;
      }
    }
  }

  async function rename(from: string, to: string): Promise<void> {
    if (!(await exists(from))) {
      return;
    }
    await ensureDir(dirname(abs(to)));
    await Deno.rename(abs(from), abs(to));
  }

  async function rewrite(
    rel: string,
    fn: (text: string) => string,
  ): Promise<void> {
    const text = await readText(rel);
    if (text === undefined) {
      return;
    }
    const next = fn(text);
    if (next !== text) {
      await writeText(rel, next);
    }
  }

  async function readConfig(): Promise<string | undefined> {
    return await readText(CONFIG_REL);
  }

  async function editToml(fn: (editor: TomlEditor) => void): Promise<void> {
    const text = await readConfig();
    if (text === undefined) {
      return;
    }
    const editor = new TomlEditor(text);
    fn(editor);
    await writeDiscernToml(abs(CONFIG_REL), editor.toString());
  }

  async function mergeSettingsInto(
    incoming: Record<string, unknown>,
  ): Promise<void> {
    const rel = ".claude/settings.json";
    const existing = await readText(rel);
    const base: unknown = existing === undefined ? {} : JSON.parse(existing);
    const merged = mergeSettings(base, incoming);
    await ensureDir(dirname(abs(rel)));
    await Deno.writeTextFile(abs(rel), `${JSON.stringify(merged, null, 2)}\n`);
  }

  return {
    destDir,
    env,
    exists,
    readText,
    writeText,
    remove,
    removeAll,
    rename,
    rewrite,
    readConfig,
    editToml,
    mergeSettings: mergeSettingsInto,
    note: onNote,
  };
}

/**
 * Select the steps that bring `recorded` up to `current`, in ascending order.
 */
export function pendingMigrations(
  recorded: number,
  current: number,
  registry: Migration[] = MIGRATIONS,
): Migration[] {
  return registry
    .filter((migration) =>
      migration.from >= recorded && migration.from < current
    )
    .sort((left, right) => left.from - right.from);
}

/**
 * Run every pending migration in order. The selected steps must bridge the
 * entire interval from `from` to `to`.
 */
export async function applyMigrations(params: {
  destDir: string;
  from: number;
  to: number;
  registry?: Migration[] | undefined;
  onNote?: ((message: string) => void) | undefined;
  env?: EnvReader | undefined;
}): Promise<Migration[]> {
  const { destDir, from, to } = params;
  const registry = params.registry ?? MIGRATIONS;
  const pending = pendingMigrations(from, to, registry);

  const expected: number[] = [];
  for (let version = from; version < to; version++) {
    expected.push(version);
  }
  const actual = pending.map((migration) => migration.from);
  if (
    actual.length !== expected.length ||
    actual.some((version, index) => version !== expected[index])
  ) {
    throw new Error(
      `broken migration chain: cannot migrate schema ${from} → ${to}; ` +
        `have steps for [${actual.join(", ")}], need [${expected.join(", ")}].`,
    );
  }

  const context = createMigrationContext(destDir, params.onNote, params.env);
  for (const migration of pending) {
    await migration.apply(context);
  }
  return pending;
}

/**
 * True when `registry` contains one step for every version in `[1, current)`,
 * with no gaps, duplicates, or out-of-range steps.
 */
export function isChainContiguous(
  registry: Migration[],
  current: number,
): boolean {
  const versions = registry
    .map((migration) => migration.from)
    .sort((left, right) => left - right);
  if (versions.length !== current - 1) {
    return false;
  }
  return versions.every((version, index) => version === index + 1);
}
