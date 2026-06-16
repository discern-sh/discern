/**
 * `icculus init` — scaffold the harness into the current directory.
 *
 * Flow: resolve config (flags + wizard) → build the plan from the templates
 * tree → append the brief + manifest ops → review (or dry-run) → confirm →
 * apply → outro pointing at `/bootstrap`. Refuses to run over an existing
 * `icculus.toml` unless `--force`.
 */

import { join } from "@std/path";
import { type InitConfig, tokensFromConfig } from "../lib/config.ts";
import { Logger } from "../lib/log.ts";
import { resolveTemplatesDir } from "../lib/paths.ts";
import {
  confirmProceed,
  type InitFlags,
  resolveInitConfig,
} from "../lib/prompts.ts";
import { KIT_VERSION } from "../lib/version.ts";
import {
  loadManifest,
  recordedHash as lookupRecordedHash,
} from "../lib/manifest.ts";
import {
  applyPlan,
  buildPlan,
  managedEntriesFromPlan,
  newFilesFromPlan,
  type Plan,
  planBrief,
  planManifest,
} from "../lib/fs_plan.ts";
import {
  planToJson,
  renderNewFilesSummary,
  renderPlan,
  renderReview,
} from "../lib/plan_view.ts";

/** Options accepted by the `init` command (global flags folded in). */
export interface InitOptions extends InitFlags {
  json: boolean;
  noColor: boolean;
  dryRun: boolean;
  force: boolean;
}

/** True when `path` exists (file or dir). */
async function pathExists(path: string): Promise<boolean> {
  try {
    await Deno.stat(path);
    return true;
  } catch {
    return false;
  }
}

/**
 * Assemble the complete plan for a run: the template walk plus the brief and
 * manifest ops. The manifest's managed hashes are derived from the template
 * walk, so it is appended last.
 *
 * `init` is non-destructive for managed files: a same-named managed file already
 * on disk is only overwritten when it is *provably the kit's* — its sha256 still
 * matches the recorded hash in the existing manifest. So the plan is built with
 * the existing manifest's recorded hashes (the very same mechanism `upgrade`
 * uses), and a user-edited or foreign managed file is preserved with its kit
 * version written alongside as `<path>.new`. When there is no manifest (a first
 * install over a repo that happens to share a path, or an unreadable one), every
 * present managed file is treated as not-ours and preserved.
 *
 * Unlike `upgrade`, a missing manifest is *normal* for `init` (most installs are
 * fresh), so it is not surfaced as a warning here — the review screen and the
 * post-init summary report any preserved `.new` files instead.
 */
export async function assembleInitPlan(params: {
  templatesDir: string;
  destDir: string;
  config: InitConfig;
}): Promise<Plan> {
  const { templatesDir, destDir, config } = params;
  const tokens = tokensFromConfig(config);

  // Re-running `init --force` over an existing install: read its manifest so a
  // pristine managed file refreshes cleanly and only genuine user edits get a
  // `.new` sibling. A fresh dir simply has no manifest, and everything creates.
  const { manifest } = await loadManifest(destDir);

  const plan = await buildPlan({
    templatesDir,
    destDir,
    tokens,
    mode: "init",
    recordedHash: (targetRel) =>
      manifest ? lookupRecordedHash(manifest, targetRel) : undefined,
  });

  const briefOp = await planBrief(destDir, config.brief);
  const managed = managedEntriesFromPlan(plan);
  const manifestOp = await planManifest({
    destDir,
    kitVersion: KIT_VERSION,
    slug: config.slug,
    agents: config.agents,
    managed,
  });

  plan.ops.push(briefOp, manifestOp);
  plan.ops.sort((a, b) => a.targetRel.localeCompare(b.targetRel));
  return plan;
}

/** Run `icculus init`. Returns a process exit code. */
export async function runInit(options: InitOptions): Promise<number> {
  const log = new Logger(options);
  const destDir = Deno.cwd();

  // Guard: refuse to scaffold over an existing install unless forced.
  const tomlPath = join(destDir, "icculus.toml");
  if (await pathExists(tomlPath) && !options.force) {
    const message =
      "icculus.toml already exists here. Re-run with --force to refresh, or use `icculus upgrade` to refresh managed files only.";
    if (options.json) {
      log.jsonResult({ ok: false, error: "already_initialized", message });
    } else {
      log.error(message);
    }
    return 1;
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

  const config = await resolveInitConfig(options, log);
  const plan = await assembleInitPlan({ templatesDir, destDir, config });

  // Dry-run: print the plan, touch nothing.
  if (options.dryRun) {
    if (options.json) {
      log.jsonResult({
        ok: true,
        dry_run: true,
        project: { slug: config.slug, agents: config.agents },
        plan: planToJson(plan),
      });
    } else {
      renderPlan(log, plan, "Dry run — these operations would be performed:");
      log.line();
      log.info("No files were written (--dry-run).");
    }
    return 0;
  }

  // Review-and-confirm before touching disk.
  if (!options.json) {
    renderReview(log, plan, destDir);
    log.line();
  }
  const proceed = await confirmProceed(
    "Scaffold these files now?",
    options.yes ?? false,
  );
  if (!proceed) {
    log.info("Aborted; nothing was written.");
    return 0;
  }

  // Scaffold.
  const changed = await applyPlan(plan);
  // Managed files we did not replace (the on-disk copy was the user's): the
  // kit's version was written as `<path>.new`. Reported in both surfaces.
  const newFiles = newFilesFromPlan(plan);

  if (options.json) {
    log.jsonResult({
      ok: true,
      project: { slug: config.slug, agents: config.agents },
      kit_version: KIT_VERSION,
      written: changed.map((op) => op.targetRel),
      new_files: newFiles.map((op) => op.targetRel),
    });
    return 0;
  }

  log.line();
  log.ok(`Scaffolded ${changed.length} files into ${destDir}.`);
  renderNewFilesSummary(log, newFiles);
  printOutro(log, config);
  return 0;
}

/** Print the closing summary: the created tree and the next step. */
function printOutro(log: Logger, config: InitConfig): void {
  log.heading(
    `Done. ${log.bold(config.projectName)} now has an icculus harness.`,
  );
  log.line();
  log.line(
    "  icculus.toml          edit by hand — teaches the harness about your stack",
  );
  log.line(
    "  ./bin/agent           the task runner — ./bin/agent finish, ./bin/agent doctor",
  );
  log.line(
    "  .icculus/             the generic engine, your brief, and the manifest",
  );
  log.line(
    "  .claude/settings.json merged (your existing settings were preserved)",
  );
  log.line();
  log.heading("Next steps");
  log.line(
    `  1. Run ${
      log.bold("/bootstrap")
    } in your coding agent to fill in principles,`,
  );
  log.line(
    "     guidelines, and docs from your brief — and to propose slot fills.",
  );
  log.line(
    `  2. Wire your tools. The harness ships with empty tool slots, so until`,
  );
  log.line(
    `     you fill them ${
      log.bold("./bin/agent finish")
    } passes without checking anything.`,
  );
  log.line(
    `     Run ${log.bold("/bootstrap")} (or edit ${
      log.bold("icculus.toml")
    }) to wire your`,
  );
  log.line("     format / lint / test commands.");
  log.line(
    `  3. Run ${
      log.bold("./bin/agent doctor")
    } to verify the install (dispatcher, hooks,`,
  );
  log.line("     slot commands, git worktree support).");
}
