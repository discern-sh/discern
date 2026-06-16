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
  applyPlan,
  buildPlan,
  managedEntriesFromPlan,
  type Plan,
  planBrief,
  planManifest,
} from "../lib/fs_plan.ts";
import { planToJson, renderPlan, renderReview } from "../lib/plan_view.ts";

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
 */
export async function assembleInitPlan(params: {
  templatesDir: string;
  destDir: string;
  config: InitConfig;
}): Promise<Plan> {
  const { templatesDir, destDir, config } = params;
  const tokens = tokensFromConfig(config);
  const plan = await buildPlan({ templatesDir, destDir, tokens, mode: "init" });

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

  if (options.json) {
    log.jsonResult({
      ok: true,
      project: { slug: config.slug, agents: config.agents },
      kit_version: KIT_VERSION,
      written: changed.map((op) => op.targetRel),
    });
    return 0;
  }

  log.line();
  log.ok(`Scaffolded ${changed.length} files into ${destDir}.`);
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
  log.heading("Next step");
  log.line(
    `  Run ${
      log.bold("/bootstrap")
    } in your coding agent to fill in principles,`,
  );
  log.line(
    "  guidelines, and docs from your brief — and to propose slot fills.",
  );
}
