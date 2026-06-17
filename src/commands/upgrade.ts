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
import { resolveTemplatesDir } from "../lib/paths.ts";
import { parseIcculusToml } from "../lib/toml_render.ts";
import { DEFAULTS, type InitConfig, tokensFromConfig } from "../lib/config.ts";
import { KIT_VERSION, SCHEMA_VERSION } from "../lib/version.ts";
import {
  buildManifest,
  loadManagedSpec,
  type ManagedEntry,
  type Manifest,
  parseManifest,
  recordedHash as lookupRecordedHash,
  serializeManifest,
} from "../lib/manifest.ts";
import {
  applyPlan,
  buildPlan,
  managedEntriesFromPlan,
  newFilesFromPlan,
  type OrphanKept,
  type Plan,
  planOrphanRemovals,
} from "../lib/fs_plan.ts";
import {
  planToJson,
  renderPlan,
  renderUpgradeSummary,
} from "../lib/plan_view.ts";
import { needsMigration } from "./migrate.ts";

/** Options accepted by the `upgrade` command. */
export interface UpgradeOptions {
  json: boolean;
  noColor: boolean;
  dryRun: boolean;
  /** Report drift (managed files out of sync with templates/) and exit; write nothing. */
  check: boolean;
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
 * `icculus.toml` and manifest. Managed engine files are token-free, so the only
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

  // Must be inside an initialized project.
  const tomlText = await readTextIfExists(join(destDir, "icculus.toml"));
  if (tomlText === undefined) {
    const message =
      "no icculus.toml here — run `icculus init` first. `upgrade` refreshes an existing install.";
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

  // A pre-1.0 icculus.toml (e.g. a `coverage_min` that the 1.0 engine no longer
  // reads) is the silent half of the upgrade: the engine refreshes to 1.0 but
  // the config stays 0.x. Detect it now so we can nudge toward `icculus migrate`.
  const migrateSuggested = needsMigration(tomlText);

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
  const plan = await buildPlan({
    templatesDir,
    destDir,
    tokens,
    mode: "upgrade",
    recordedHash: (targetRel) =>
      manifest ? lookupRecordedHash(manifest, targetRel) : undefined,
    managedSpec: await loadManagedSpec(templatesDir),
  });

  // Reconcile orphans: managed files the manifest recorded that the new
  // templates no longer ship (ADR 0014). Pristine orphans become `remove` ops
  // in the plan — so they surface as drift in `--check`, in the dry-run listing,
  // and get deleted on apply; edited orphans are kept and reported, never
  // deleted. Needs the prior manifest to diff against; absent one, nothing.
  const orphans = manifest
    ? await planOrphanRemovals({
      destDir,
      recorded: manifest.managed,
      plan,
    })
    : { removals: [], kept: [] as OrphanKept[] };
  plan.ops.push(...orphans.removals);
  plan.ops.sort((a, b) => a.targetRel.localeCompare(b.targetRel));

  if (options.check) {
    // A managed file is in sync iff its disposition is "skip". An edited managed
    // file's op targets "<path>.new"; strip that so we report the canonical path.
    const drifted = plan.ops.filter(
      (op) => op.managed && op.disposition !== "skip",
    );
    const canonical = (rel: string) => rel.replace(/\.new$/, "");
    if (options.json) {
      log.jsonResult({
        ok: drifted.length === 0,
        check: true,
        drifted: drifted.map((op) => ({
          path: canonical(op.targetRel),
          action: op.disposition,
        })),
        orphans_kept: orphans.kept.map((o) => o.path),
        migrate_suggested: migrateSuggested,
      });
    } else {
      if (drifted.length === 0) {
        log.ok("Managed files are in sync with templates/.");
      } else {
        log.error(
          `Managed files have drifted from templates/ (${drifted.length}):`,
        );
        for (const op of drifted) {
          log.detail(`${canonical(op.targetRel)} (${op.disposition})`);
        }
        log.line();
        log.info(`Heal it: run \`${await selfCmd("sync")}\`.`);
      }
      warnKeptOrphans(log, orphans.kept);
    }
    return drifted.length === 0 ? 0 : 1;
  }

  if (options.dryRun) {
    if (options.json) {
      log.jsonResult({
        ok: true,
        dry_run: true,
        plan: planToJson(plan),
        migrate_suggested: migrateSuggested,
      });
    } else {
      renderPlan(log, plan, "Dry run — `upgrade` would perform:");
      log.line();
      log.info("No files were written (--dry-run).");
      if (migrateSuggested) {
        log.info(
          "Your icculus.toml looks pre-1.0 — also run `icculus migrate`.",
        );
      }
    }
    return 0;
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

  const updatedManifest = rebuildManifest({ config, plan, previous: manifest });
  await Deno.writeTextFile(manifestPath, serializeManifest(updatedManifest));

  if (options.json) {
    log.jsonResult({
      ok: true,
      kit_version: KIT_VERSION,
      refreshed: refreshed.map((op) => op.targetRel),
      preserved: preserved.map((op) => op.targetRel),
      new_files: newFiles.map((op) => op.targetRel),
      removed: removed.map((op) => op.targetRel),
      orphans_kept: orphans.kept.map((o) => o.path),
      migrate_suggested: migrateSuggested,
    });
    return 0;
  }

  renderUpgradeSummary(log, refreshed, preserved, newFiles, removed);
  warnKeptOrphans(log, orphans.kept);
  // The engine is now 1.0, but the config may not be. Nudge once, loudly enough
  // to catch the silent breakage (a vanished coverage ratchet) but not as a
  // failure — the upgrade itself succeeded.
  if (migrateSuggested) {
    log.line();
    log.warn(
      "Your icculus.toml looks like a pre-1.0 config (e.g. [ratchets].coverage_min).",
    );
    log.info(
      "Run `icculus migrate` to update it to the 1.0 shape (try --dry-run first).",
    );
  }
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
 * Produce the post-upgrade manifest. Start from the previous manifest, then
 * overlay a fresh hash for every managed file the kit wrote *to the canonical
 * path* this round (`managedEntriesFromPlan` yields exactly those — it omits the
 * `.new` siblings). So a file written as `<path>.new` keeps its *prior* recorded
 * hash: the canonical path still holds the user's edited version, and keeping the
 * old kit hash there means the next upgrade still sees it as edited and preserves
 * it again, rather than mistaking it for pristine and clobbering it.
 *
 * An orphan removed this round (a `remove` op in the plan) is dropped from the
 * manifest entirely: its prior recorded hash must not survive, or a re-created
 * same-named file would later look pristine.
 */
function rebuildManifest(params: {
  config: InitConfig;
  plan: Plan;
  previous?: Manifest;
}): Manifest {
  const { config, plan, previous } = params;
  const byPath = new Map<string, string>();
  for (const entry of previous?.managed ?? []) {
    byPath.set(entry.path, entry.sha256);
  }
  // managedEntriesFromPlan returns only create/overwrite/skip ops (never `.new`),
  // so this overlays fresh hashes for files actually refreshed in place and
  // leaves any `.new` path's prior recorded hash untouched.
  for (const entry of managedEntriesFromPlan(plan)) {
    byPath.set(entry.path, entry.sha256);
  }
  // Drop orphans removed this round: their `remove` op carries the canonical
  // path, and their prior recorded hash came from `previous` above.
  for (const op of plan.ops) {
    if (op.disposition === "remove") {
      byPath.delete(op.targetRel);
    }
  }
  const managed: ManagedEntry[] = [...byPath.entries()].map((
    [path, sha256],
  ) => ({
    path,
    sha256,
  }));
  return buildManifest({
    kitVersion: KIT_VERSION,
    schemaVersion: SCHEMA_VERSION,
    generatedAt: new Date().toISOString(),
    slug: config.slug,
    agents: config.agents,
    managed,
  });
}
