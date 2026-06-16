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
import { resolveTemplatesDir } from "../lib/paths.ts";
import { parseIcculusToml } from "../lib/toml_render.ts";
import { DEFAULTS, type InitConfig, tokensFromConfig } from "../lib/config.ts";
import { KIT_VERSION } from "../lib/version.ts";
import {
  buildManifest,
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
  type Plan,
} from "../lib/fs_plan.ts";
import {
  planToJson,
  renderPlan,
  renderUpgradeSummary,
} from "../lib/plan_view.ts";

/** Options accepted by the `upgrade` command. */
export interface UpgradeOptions {
  json: boolean;
  noColor: boolean;
  dryRun: boolean;
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
  });

  if (options.dryRun) {
    if (options.json) {
      log.jsonResult({ ok: true, dry_run: true, plan: planToJson(plan) });
    } else {
      renderPlan(log, plan, "Dry run — `upgrade` would perform:");
      log.line();
      log.info("No files were written (--dry-run).");
    }
    return 0;
  }

  const changed = await applyPlan(plan);

  // Rebuild the manifest: keep prior entries for managed files we didn't touch
  // this round (still on disk), and record fresh hashes for everything written.
  const refreshed = changed.filter((op) =>
    op.disposition === "overwrite" || op.disposition === "create"
  );
  const newFiles = changed.filter((op) => op.disposition === "new");
  const preserved = plan.ops.filter((op) =>
    op.disposition === "skip" && op.managed
  );

  const updatedManifest = rebuildManifest({ config, plan, previous: manifest });
  await Deno.writeTextFile(manifestPath, serializeManifest(updatedManifest));

  if (options.json) {
    log.jsonResult({
      ok: true,
      kit_version: KIT_VERSION,
      refreshed: refreshed.map((op) => op.targetRel),
      preserved: preserved.map((op) => op.targetRel),
      new_files: newFiles.map((op) => op.targetRel),
    });
    return 0;
  }

  renderUpgradeSummary(log, refreshed, preserved, newFiles);
  return 0;
}

/**
 * Produce the post-upgrade manifest: every managed file the kit now owns gets
 * its fresh hash (from the plan's write ops, which carry the new bytes' hash);
 * files written as `.new` keep their prior recorded hash because the canonical
 * path on disk is still the user's edited version.
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
  for (const op of managedEntriesFromPlan(plan)) {
    // managedEntriesFromPlan strips the `.new` suffix; only adopt the new hash
    // for files actually refreshed in place (not the `.new` siblings).
    const wasNew = plan.ops.some(
      (p) => p.targetRel === `${op.path}.new` && p.disposition === "new",
    );
    if (!wasNew) {
      byPath.set(op.path, op.sha256);
    } else if (!byPath.has(op.path)) {
      // No prior record (untracked edit): keep the user's file unrecorded-safe by
      // recording nothing new — fall through leaves any prior value intact.
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
    generatedAt: new Date().toISOString(),
    slug: config.slug,
    agents: config.agents,
    managed,
  });
}
