/**
 * `icculus init` — scaffold the harness into the current directory.
 *
 * Flow: resolve config (flags + wizard) → build the seed plan from the templates
 * tree → append the brief op → stamp the schema version → review (or dry-run) →
 * confirm → apply → outro pointing at `/bootstrap`. Refuses to run over an
 * existing install unless `--force` (which just re-runs without erroring).
 *
 * Every scaffolded file is a write-once seed EXCEPT `.icculus/skills/**`, which
 * are materialized artifacts of the binary: always (re)written, gitignored, and
 * symlinked into `.claude/skills/` by the engine's `guidelines` step.
 */

import { type InitConfig, tokensFromConfig } from "../lib/config.ts";
import { Logger } from "../lib/log.ts";
import { resolveConfigPath, resolveTemplatesDir } from "../lib/paths.ts";
import {
  confirmProceed,
  type InitFlags,
  resolveInitConfig,
} from "../lib/prompts.ts";
import {
  applyConfigDoc,
  type IcculusConfigDoc,
  loadConfigDoc,
  mergeDocIntoFlags,
} from "../lib/config_doc.ts";
import { TomlEditor } from "../lib/toml_edit.ts";
import { stampSchemaVersion } from "../lib/schema.ts";
import { KIT_VERSION, SCHEMA_VERSION } from "../lib/version.ts";
import { applyPlan, buildPlan, type Plan, planBrief } from "../lib/fs_plan.ts";
import { planToJson, renderPlan, renderReview } from "../lib/plan_view.ts";

/** Options accepted by the `init` command (global flags folded in). */
export interface InitOptions extends InitFlags {
  json: boolean;
  noColor: boolean;
  dryRun: boolean;
  force: boolean;
  /** Path to a JSON answers file (or `-` for stdin); implies non-interactive. */
  config?: string | undefined;
}

const TEXT_DECODER = new TextDecoder();
const TEXT_ENCODER = new TextEncoder();

/**
 * Assemble the complete plan for an `init` run: the seed templates walk plus the
 * brief op, with the schema version stamped into the generated config so a later
 * `upgrade` reads the right anchor. Re-running over an existing install simply
 * skips the seeds already present (they are the user's) and re-materializes the
 * bundled skills.
 */
export async function assembleInitPlan(params: {
  templatesDir: string;
  destDir: string;
  config: InitConfig;
  /** Declarative slots/scopes/side_gates/ratchets fills from `init --config`. */
  fills?: IcculusConfigDoc | undefined;
}): Promise<Plan> {
  const { templatesDir, destDir, config } = params;
  const tokens = tokensFromConfig(config);

  const plan = await buildPlan({ templatesDir, destDir, tokens });

  const briefOp = await planBrief(destDir, config.brief);
  plan.ops.push(briefOp);
  plan.ops.sort((a, b) => a.targetRel.localeCompare(b.targetRel));

  // Stamp `[meta].schema_version` into the freshly-generated config, then apply
  // any declarative fills (from `init --config`). Both edit the config op's
  // bytes in place, so the plan's bytes are final — dry-run/json show them and
  // apply writes them. A `skip` config (an existing seed) is left untouched.
  stampSchemaIntoPlan(plan, SCHEMA_VERSION);
  if (params.fills) {
    applyFillsToPlan(plan, params.fills);
  }
  return plan;
}

/** Find the `.icculus/config.toml` op that is about to be created, or undefined. */
function freshConfigOp(plan: Plan): Plan["ops"][number] | undefined {
  const op = plan.ops.find((o) => o.targetRel === ".icculus/config.toml");
  if (!op || op.disposition === "skip") {
    return undefined; // absent, or an existing seed left as the user's.
  }
  return op;
}

/** Stamp `[meta].schema_version` into a freshly-generated config op, in place. */
function stampSchemaIntoPlan(plan: Plan, version: number): void {
  const op = freshConfigOp(plan);
  if (!op) {
    return;
  }
  const editor = new TomlEditor(TEXT_DECODER.decode(op.bytes));
  stampSchemaVersion(editor, version);
  op.bytes = TEXT_ENCODER.encode(editor.toString());
}

/**
 * Apply the answers file's slots/scopes/side_gates/ratchets to the generated
 * `.icculus/config.toml` op via the comment-preserving editor. A no-op when the
 * config is a `skip` (an existing seed left as the user's — fills never clobber it).
 */
function applyFillsToPlan(plan: Plan, fills: IcculusConfigDoc): void {
  const op = freshConfigOp(plan);
  if (!op) {
    return;
  }
  const editor = new TomlEditor(TEXT_DECODER.decode(op.bytes));
  applyConfigDoc(editor, fills);
  op.bytes = TEXT_ENCODER.encode(editor.toString());
}

/** Run `icculus init`. Returns a process exit code. */
export async function runInit(options: InitOptions): Promise<number> {
  const log = new Logger(options);
  const destDir = Deno.cwd();

  // Guard: refuse to scaffold over an existing install unless forced. Detect
  // either layout — the consolidated `.icculus/config.toml` or a legacy root
  // `icculus.toml` left by a pre-migration install.
  if ((await resolveConfigPath(destDir)) !== undefined && !options.force) {
    const message =
      "an icculus install already exists here. Re-run with --force to refresh, or use `icculus upgrade` to bring it to this kit version.";
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

  // Load the --config document (declarative, non-interactive) if given.
  let fileAnswers: IcculusConfigDoc | undefined;
  if (options.config !== undefined) {
    try {
      fileAnswers = await loadConfigDoc(options.config);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (options.json) {
        log.jsonResult({ ok: false, error: "invalid_config_file", message });
      } else {
        log.error(message);
      }
      return 1;
    }
  }

  // --config implies non-interactive; the file's base fields are a fallback layer
  // beneath any explicit flags.
  const effectiveFlags = mergeDocIntoFlags(options, fileAnswers);
  if (fileAnswers) {
    effectiveFlags.yes = true;
  }
  const config = await resolveInitConfig(effectiveFlags, log);

  let plan: Plan;
  try {
    plan = await assembleInitPlan({
      templatesDir,
      destDir,
      config,
      fills: fileAnswers,
    });
  } catch (error) {
    const message = `invalid --config fills: ${
      error instanceof Error ? error.message : String(error)
    }`;
    if (options.json) {
      log.jsonResult({ ok: false, error: "invalid_config_file", message });
    } else {
      log.error(message);
    }
    return 1;
  }

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
    "  icculus               the task runner — icculus finish, icculus doctor",
  );
  log.line(
    "  .icculus/config.toml  edit by hand — teaches the harness about your stack",
  );
  log.line(
    "  .icculus/             your guidance, brief, skills, and recipes",
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
    "     guidelines, and docs from your brief — and to propose capability fills.",
  );
  log.line(
    `  2. Wire your capabilities. The harness ships with none, so until you fill`,
  );
  log.line(
    `     them ${log.bold("icculus finish")} passes without checking anything.`,
  );
  log.line(
    `     Run ${log.bold("/bootstrap")} (or edit ${
      log.bold(".icculus/config.toml")
    }) to wire your`,
  );
  log.line("     format / lint / test commands.");
  log.line(
    `  3. Run ${
      log.bold("icculus doctor")
    } to verify the install (config, schema,`,
  );
  log.line("     capabilities, git worktree support).");
}
