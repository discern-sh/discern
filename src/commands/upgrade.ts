/**
 * `icculus upgrade` — refresh only the managed files, hash-aware.
 *
 * For each managed file in the new templates tree:
 *   missing               → write it.
 *   present and pristine  → overwrite (current hash matches the manifest).
 *   present but edited    → write `<path>.new`, preserve the original, warn.
 * New managed files are written. SEED files are never touched. The manifest's
 * kit version and managed hashes are bumped to reflect the new state.
 */

import { join } from "@std/path";
import { Logger } from "../lib/log.ts";
import { selfCmd } from "../lib/invocation.ts";
import { worktreeState } from "../lib/git.ts";
import { resolveConfigPath, resolveTemplatesDir } from "../lib/paths.ts";
import { parseIcculusToml } from "../lib/toml_render.ts";
import { DEFAULTS, type InitConfig, tokensFromConfig } from "../lib/config.ts";
import { KIT_VERSION, SCHEMA_VERSION } from "../lib/version.ts";
import {
  buildManifest,
  loadManagedSpec,
  type Manifest,
  parseManifest,
  recordedHash as lookupRecordedHash,
  serializeManifest,
} from "../lib/manifest.ts";
import {
  applyPlan,
  buildPlan,
  newFilesFromPlan,
  type OrphanKept,
  type Plan,
  type PlanOp,
  planOrphanRemovals,
  reconcileManagedEntries,
} from "../lib/fs_plan.ts";
import {
  applyMigrations,
  type Migration,
  pendingMigrations,
} from "../lib/migrations.ts";
import { planToJson, renderUpgradeSummary } from "../lib/plan_view.ts";

/** Options accepted by the `upgrade` command. */
export interface UpgradeOptions {
  json: boolean;
  noColor: boolean;
  dryRun: boolean;
  /** Report drift (managed files out of sync with templates/) and exit; write nothing. */
  check: boolean;
  /** Upgrade even with uncommitted tracked changes (skip the clean-tree guard). */
  allowDirty: boolean;
  /**
   * The migration chain to run. Defaults to the production chain (`MIGRATIONS`);
   * overridable so tests can drive the fold with synthetic steps without a real
   * `SCHEMA_VERSION` bump.
   */
  registry?: Migration[];
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
 * `.icculus/config.toml` and manifest. Managed engine files are token-free, so the only
 * path token that matters is the slug; content tokens are filled from config
 * with documented defaults so any stray token still resolves consistently.
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

  // Load the existing manifest (for the recorded hashes that decide overwrite vs .new).
  const manifestPath = join(destDir, ".icculus/manifest.json");
  const manifestText = await readTextIfExists(manifestPath);
  let manifest: Manifest | undefined;
  if (manifestText !== undefined) {
    try {
      manifest = parseManifest(manifestText);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      log.warn(
        `could not parse existing manifest (${message}); treating all managed files as edited.`,
      );
    }
  } else {
    log.warn(
      "no .icculus/manifest.json found; treating all managed files as edited.",
    );
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
  const tokens = tokensFromConfig(config);
  const managedSpec = await loadManagedSpec(templatesDir);

  // The migration chain to run before the file sync (ADR 0014): every step from
  // the install's recorded schema up to this build's SCHEMA_VERSION. Absent a
  // manifest we cannot know the version, so we run none — the file sync still
  // heals managed files. The chain is empty at schema 1, so `pending` is [] for
  // every current install today; Phase 2's rename is the first real step.
  const migrateFrom = manifest?.schema_version ?? SCHEMA_VERSION;
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

  // Build the file-sync plan and its orphan reconciliation against the *current*
  // disk. Called once up front (for --check / --dry-run and the initial apply),
  // then again after migrations run, since a step may have moved or rewritten
  // files the plan must re-examine.
  const buildUpgradePlan = async (): Promise<{
    plan: Plan;
    orphans: { removals: PlanOp[]; kept: OrphanKept[] };
  }> => {
    const p = await buildPlan({
      templatesDir,
      destDir,
      tokens,
      mode: "upgrade",
      recordedHash: (targetRel) =>
        manifest ? lookupRecordedHash(manifest, targetRel) : undefined,
      managedSpec,
    });
    const o = manifest
      ? await planOrphanRemovals({
        destDir,
        recorded: manifest.managed,
        plan: p,
      })
      : { removals: [] as PlanOp[], kept: [] as OrphanKept[] };
    p.ops.push(...o.removals);
    p.ops.sort((a, b) => a.targetRel.localeCompare(b.targetRel));
    return { plan: p, orphans: o };
  };

  let { plan, orphans } = await buildUpgradePlan();

  if (options.check) {
    // A managed file is in sync iff its disposition is "skip". An edited managed
    // file's op targets "<path>.new"; strip that so we report the canonical path.
    const drifted = plan.ops.filter(
      (op) => op.managed && op.disposition !== "skip",
    );
    const canonical = (rel: string) => rel.replace(/\.new$/, "");
    // Schema currency is drift too (ADR 0014, the self-host canary): an install
    // recorded at an older schema than this build needs an upgrade to migrate.
    // An absent manifest is already reported above as all-files-drift, so it is
    // not double-counted here.
    const recordedSchema = manifest?.schema_version;
    const schemaOk = recordedSchema === undefined ||
      recordedSchema === SCHEMA_VERSION;
    const ok = drifted.length === 0 && schemaOk;
    if (options.json) {
      log.jsonResult({
        ok,
        check: true,
        drifted: drifted.map((op) => ({
          path: canonical(op.targetRel),
          action: op.disposition,
        })),
        schema: { recorded: recordedSchema ?? null, current: SCHEMA_VERSION },
        pending_migrations: pendingJson,
        orphans_kept: orphans.kept.map((o) => o.path),
      });
    } else {
      if (ok) {
        log.ok("Managed files are in sync with templates/.");
      } else {
        if (drifted.length > 0) {
          log.error(
            `Managed files have drifted from templates/ (${drifted.length}):`,
          );
          for (const op of drifted) {
            log.detail(`${canonical(op.targetRel)} (${op.disposition})`);
          }
        }
        if (!schemaOk) {
          log.error(
            `Install schema is v${recordedSchema}, but this build expects v${SCHEMA_VERSION}.`,
          );
          for (const m of pending) {
            log.detail(`migration ${m.from}→${m.from + 1}: ${m.describe}`);
          }
        }
        log.line();
        log.info(`Heal it: run \`${await selfCmd("sync")}\`.`);
      }
      warnKeptOrphans(log, orphans.kept);
    }
    return ok ? 0 : 1;
  }

  if (options.dryRun) {
    if (options.json) {
      log.jsonResult({
        ok: true,
        dry_run: true,
        pending_migrations: pendingJson,
        plan: planToJson(plan),
      });
    } else {
      if (pending.length > 0) {
        log.info(`Would run ${pending.length} migration(s) first:`);
        for (const m of pending) {
          log.detail(`${m.from}→${m.from + 1}: ${m.describe}`);
        }
        log.line();
      }
      // Group the plan exactly as the post-apply summary does, so a dry run
      // reads the same way (not a flat, intermingled list).
      const wouldRefresh = plan.ops.filter((op) =>
        op.managed &&
        (op.disposition === "overwrite" || op.disposition === "create")
      );
      const upToDate = plan.ops.filter((op) =>
        op.managed && op.disposition === "skip"
      );
      const toRemove = plan.ops.filter((op) => op.disposition === "remove");
      renderUpgradeSummary(
        log,
        wouldRefresh,
        upToDate,
        newFilesFromPlan(plan),
        toRemove,
        { dryRun: true },
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

  // Run the migration chain before the file sync (ADR 0014). A step may move or
  // rewrite files, so if any ran, rebuild the plan against the post-migration
  // disk before applying. The chain is empty at schema 1, so this is a no-op for
  // every current install today.
  const applied = await applyMigrations({
    destDir,
    from: migrateFrom,
    to: SCHEMA_VERSION,
    registry: options.registry,
    onNote: (m) => log.detail(m),
  });
  if (applied.length > 0) {
    ({ plan, orphans } = await buildUpgradePlan());
  }

  const changed = await applyPlan(plan);

  // Rebuild the manifest: keep prior entries for managed files we didn't touch
  // this round (still on disk), and record fresh hashes for everything written.
  const refreshed = changed.filter((op) =>
    op.disposition === "overwrite" || op.disposition === "create"
  );
  const newFiles = newFilesFromPlan(plan);
  const preserved = plan.ops.filter((op) =>
    op.disposition === "skip" && op.managed
  );
  const removed = changed.filter((op) => op.disposition === "remove");

  const updatedManifest = await rebuildManifest({
    config,
    plan,
    previous: manifest,
    destDir,
  });
  await Deno.writeTextFile(manifestPath, serializeManifest(updatedManifest));

  if (options.json) {
    log.jsonResult({
      ok: true,
      kit_version: KIT_VERSION,
      migrations_applied: applied.map((m) => ({
        from: m.from,
        to: m.from + 1,
        describe: m.describe,
      })),
      refreshed: refreshed.map((op) => op.targetRel),
      preserved: preserved.map((op) => op.targetRel),
      new_files: newFiles.map((op) => op.targetRel),
      removed: removed.map((op) => op.targetRel),
      orphans_kept: orphans.kept.map((o) => o.path),
    });
    return 0;
  }

  if (applied.length > 0) {
    log.ok(`migrations applied: ${applied.length}`);
    for (const m of applied) {
      log.detail(`${m.from}→${m.from + 1}: ${m.describe}`);
    }
  }
  renderUpgradeSummary(log, refreshed, preserved, newFiles, removed);
  warnKeptOrphans(log, orphans.kept);
  return 0;
}

/**
 * Warn about managed orphans left in place: files the new templates no longer
 * ship but whose on-disk copy is not the kit's (edited, or a foreign same-named
 * file). They are reported, never deleted — a safe rename that must carry edits
 * forward is an explicit migration step, not an automatic prune. No-op when the
 * list is empty.
 */
function warnKeptOrphans(log: Logger, kept: OrphanKept[]): void {
  if (kept.length === 0) {
    return;
  }
  log.line();
  log.warn(
    `${kept.length} managed file${
      kept.length === 1 ? "" : "s"
    } no longer shipped but kept (your copy differs from the kit's):`,
  );
  for (const o of kept) {
    log.detail(`${o.path} — ${o.reason}`);
  }
}

/**
 * Produce the post-upgrade manifest. Its managed entries are reconciled against
 * what is on disk *now* — after migrations and `applyPlan` (see
 * `reconcileManagedEntries`): every managed file the kit wrote this round, plus
 * any prior entry whose file still exists (an edited orphan, or the canonical
 * path of a `.new`). Removed orphans and migration-renamed-away paths are gone
 * from disk, so they drop out — no `remove`-op bookkeeping needed.
 */
async function rebuildManifest(params: {
  config: InitConfig;
  plan: Plan;
  previous?: Manifest;
  destDir: string;
}): Promise<Manifest> {
  const { config, plan, previous, destDir } = params;
  const managed = await reconcileManagedEntries({
    destDir,
    previous: previous?.managed ?? [],
    plan,
  });
  return buildManifest({
    kitVersion: KIT_VERSION,
    schemaVersion: SCHEMA_VERSION,
    generatedAt: new Date().toISOString(),
    slug: config.slug,
    agents: config.agents,
    managed,
  });
}
