/**
 * The versioned migration chain (ADR 0014).
 *
 * A migration is one **idempotent** step that brings an install from schema
 * version `from` to `from + 1`. `upgrade` reads the install's recorded
 * `schema_version`, runs every pending step in order up to the kit's
 * `SCHEMA_VERSION`, then stamps the new version. The chain is contiguous: there
 * is exactly one step producing each version from 2 up to `SCHEMA_VERSION`.
 *
 * The chain's first step is the schema-1→2 `main_branch` backfill (the bespoke
 * 0.x→1.0 `migrate` ADR 0014 retired was not ported — the current shape was
 * declared schema 1 and the chain grows from there). Further steps, such as the
 * kit rename, append as later bumps.
 *
 * A step transforms an install through a {@link MigrationContext}: it can edit
 * the install config comment-preserving, move/remove/rewrite managed *and* seed
 * files, and deep-merge `.claude/settings.json`. The file moves are what make a
 * rename safe — content is carried to the new path, and the subsequent file
 * sync reconciles it against the new templates.
 */

import { ensureDir } from "@std/fs";
import { dirname, join } from "@std/path";
import { TomlEditor } from "./toml_edit.ts";
import { mergeSettings } from "./settings_merge.ts";
import { parseIcculusToml } from "./toml_render.ts";

/** True for a non-null, non-array object. */
function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** The operations a migration step performs against an install. */
export interface MigrationContext {
  /** Absolute destination root of the install being migrated. */
  readonly destDir: string;
  /** True if a target-relative path exists. */
  exists(rel: string): Promise<boolean>;
  /** Read a target file as text, or undefined if absent. */
  readText(rel: string): Promise<string | undefined>;
  /** Write a target file (creating parent dirs), replacing any existing. */
  writeText(rel: string, content: string): Promise<void>;
  /** Delete a target file; a no-op if already gone (idempotent). */
  remove(rel: string): Promise<void>;
  /**
   * Move `from` → `to`, content intact, creating `to`'s parent. Idempotent: if
   * `from` is already gone the move is treated as done and it is a no-op, so a
   * re-run never fails.
   */
  rename(from: string, to: string): Promise<void>;
  /** Read-transform-write a target file's text; a no-op if absent or unchanged. */
  rewrite(rel: string, fn: (text: string) => string): Promise<void>;
  /** Read the install config (`.icculus/config.toml`, or a legacy `icculus.toml`), or undefined. */
  readConfig(): Promise<string | undefined>;
  /** Edit the install config comment-preserving; a no-op if there is no config. */
  editToml(fn: (editor: TomlEditor) => void): Promise<void>;
  /** Deep-merge `incoming` into `.claude/settings.json` (created if absent). */
  mergeSettings(incoming: Record<string, unknown>): Promise<void>;
  /** Record a human-readable note about what this step changed. */
  note(message: string): void;
}

/** One step in the migration chain: schema `from` → `from + 1`. */
export interface Migration {
  /** The schema version this step upgrades FROM (it produces `from + 1`). */
  from: number;
  /** One-line description of the transformation (shown in logs / `--json`). */
  describe: string;
  /** Apply the transformation. MUST be idempotent. */
  apply(ctx: MigrationContext): Promise<void>;
}

/**
 * The ordered migration chain (ADR 0014). One step per schema bump, contiguous
 * from 1 up to `SCHEMA_VERSION`.
 *
 * `1 → 2` backfills `[project].main_branch`. It is the first real step — a
 * deliberately small, safe seed evolution that exercises the whole pipeline
 * end-to-end (the kit rename will come later, as a further step). `main_branch`
 * is a long-standing engine-read field; an install whose `icculus.toml` predates
 * it relied on the engine's implicit `"main"` default, so making it explicit is
 * a genuine improvement. Only-if-absent, so a custom integration branch is never
 * clobbered, and a no-op on any install that already has it.
 */
export const MIGRATIONS: Migration[] = [
  {
    from: 1,
    describe: 'backfill [project].main_branch = "main" when absent',
    apply: async (ctx) => {
      const text = await ctx.readConfig();
      if (text === undefined) {
        return; // no config to evolve.
      }
      let raw: Record<string, unknown>;
      try {
        raw = parseIcculusToml(text).raw;
      } catch {
        return; // unparseable — upgrade validates the config first; belt-and-braces.
      }
      const project = isRecord(raw.project) ? raw.project : {};
      if (
        typeof project.main_branch === "string" && project.main_branch !== ""
      ) {
        return; // already set (perhaps a custom branch) — never clobber.
      }
      await ctx.editToml((e) => e.setString("project.main_branch", "main"));
      ctx.note('backfilled [project].main_branch = "main"');
    },
  },
  {
    from: 2,
    describe:
      "consolidate the install surface under .icculus/ (move the config + guidance seeds; the sync handles agent + skills)",
    apply: async (ctx) => {
      // Carry the SEEDS into the `.icculus/` namespace. A seed is the user's: the
      // file sync never recreates one and orphan-prune never removes one, so a
      // rename here is the only thing that moves its content forward. `rename`
      // wraps Deno.rename (whole-directory moves) and is idempotent — a no-op once
      // the source is gone, so a re-run, or an install already in the new layout,
      // passes through cleanly.
      await ctx.rename("icculus.toml", ".icculus/config.toml");
      await ctx.rename(".ai/guidelines", ".icculus/guidelines");
      // The MANAGED files are deliberately NOT renamed here. The dispatcher
      // (bin/agent → agent) and the skills (.ai/skills → .icculus/skills) are
      // kit-owned, so the file sync that runs after migrations writes them at the
      // new paths and orphan-prune removes the old pristine copies. Renaming them
      // here would only defeat the sync's hash check — the manifest still records
      // the old path, so the moved copy reads as "edited" and is preserved as
      // `.new`. Leave them; the empty bin/ and .ai/ dirs git ignores.
      // Repoint the worktree hooks at the root dispatcher (settings.json is a
      // merged seed the sync leaves alone).
      await ctx.rewrite(
        ".claude/settings.json",
        (t) => t.replaceAll("./bin/agent", "./agent"),
      );
      // Best-effort: the default neutral-scope globs named `.ai/`; guidance now
      // lives under `.icculus/`. A customised list simply won't match — harmless.
      await ctx.rewrite(
        ".icculus/config.toml",
        (t) => t.replaceAll('".ai/"', '".icculus/"'),
      );
      ctx.note(
        "moved icculus.toml→.icculus/config.toml and .ai/guidelines→.icculus/guidelines",
      );
      ctx.note(
        "the root `agent` and .icculus/skills are written by the file sync; run `agent guidelines` after",
      );
    },
  },
];

/** Build the context a migration uses to transform the install at `destDir`. */
export function createMigrationContext(
  destDir: string,
  onNote: (message: string) => void = () => {},
): MigrationContext {
  const abs = (rel: string) => join(destDir, rel);

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

  async function rename(from: string, to: string): Promise<void> {
    if (!(await exists(from))) {
      return; // already moved (or never existed) — idempotent no-op.
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
      await Deno.writeTextFile(abs(rel), next);
    }
  }

  // Resolve the config's target-relative path for THIS install: the consolidated
  // `.icculus/config.toml` if present, else a legacy root `icculus.toml`. Resolved
  // per call so a step that renames the config is seen by any later step.
  async function configRel(): Promise<string> {
    return (await exists(".icculus/config.toml"))
      ? ".icculus/config.toml"
      : "icculus.toml";
  }

  async function readConfig(): Promise<string | undefined> {
    return await readText(await configRel());
  }

  async function editToml(fn: (editor: TomlEditor) => void): Promise<void> {
    const rel = await configRel();
    const text = await readText(rel);
    if (text === undefined) {
      return;
    }
    const editor = new TomlEditor(text);
    fn(editor);
    await Deno.writeTextFile(abs(rel), editor.toString());
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
    exists,
    readText,
    writeText,
    remove,
    rename,
    rewrite,
    readConfig,
    editToml,
    mergeSettings: mergeSettingsInto,
    note: onNote,
  };
}

/**
 * The steps that bring `recorded` up to `current`, in ascending order — every
 * migration whose `from` lies in `[recorded, current)`.
 */
export function pendingMigrations(
  recorded: number,
  current: number,
  registry: Migration[] = MIGRATIONS,
): Migration[] {
  return registry
    .filter((m) => m.from >= recorded && m.from < current)
    .sort((a, b) => a.from - b.from);
}

/**
 * Run every pending migration to bring an install from schema `from` to `to`,
 * in order. Throws if the chain cannot bridge the gap — the pending steps must
 * be exactly `from, from+1, …, to-1`, or a version in between has no step.
 * Returns the steps applied (empty when already current).
 */
export async function applyMigrations(params: {
  destDir: string;
  from: number;
  to: number;
  registry?: Migration[];
  onNote?: (message: string) => void;
}): Promise<Migration[]> {
  const { destDir, from, to } = params;
  const registry = params.registry ?? MIGRATIONS;
  const pending = pendingMigrations(from, to, registry);

  // The pending steps must form a contiguous run from `from` up to `to`.
  const expected: number[] = [];
  for (let v = from; v < to; v++) {
    expected.push(v);
  }
  const got = pending.map((m) => m.from);
  if (
    got.length !== expected.length || got.some((v, i) => v !== expected[i])
  ) {
    throw new Error(
      `broken migration chain: cannot migrate schema ${from} → ${to}; ` +
        `have steps for [${got.join(", ")}], need [${expected.join(", ")}].`,
    );
  }

  const ctx = createMigrationContext(destDir, params.onNote);
  for (const m of pending) {
    await m.apply(ctx);
  }
  return pending;
}

/**
 * True when `registry` is a well-formed chain for `current`: exactly one step
 * for each version in `[1, current)`, none duplicated or out of range. A guard
 * the build can assert against `SCHEMA_VERSION` so a malformed chain is caught
 * before it ever runs.
 */
export function isChainContiguous(
  registry: Migration[],
  current: number,
): boolean {
  const froms = registry.map((m) => m.from).sort((a, b) => a - b);
  if (froms.length !== current - 1) {
    return false;
  }
  return froms.every((v, i) => v === i + 1);
}
