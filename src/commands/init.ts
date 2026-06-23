/**
 * `discern init` — scaffold the harness into the current directory.
 *
 * Flow: resolve config (flags + wizard) → build the seed plan from the templates
 * tree → append the brief op → stamp the schema version → review (or dry-run) →
 * confirm → apply → outro pointing at `discern bootstrap`. Refuses to run over an
 * existing install unless `--force` (which just re-runs without erroring).
 *
 * Every scaffolded file is a write-once seed EXCEPT the materialized skills under
 * `.claude/skills/**` — artifacts of the binary, always (re)written and gitignored
 * (bundled skills copied in, authored ones symlinked) by the engine's `refresh`
 * step.
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
  type DiscernConfigDoc,
  loadConfigDoc,
  mergeDocIntoFlags,
} from "../lib/config_doc.ts";
import { TomlEditor } from "../lib/toml_edit.ts";
import { stampSchemaVersion } from "../lib/schema.ts";
import { KIT_VERSION, SCHEMA_VERSION } from "../lib/version.ts";
import { applyPlan, buildPlan, type Plan, planBrief } from "../lib/fs_plan.ts";
import { planToJson, renderPlan, renderReview } from "../lib/plan_view.ts";
import { compileGuidelines } from "../engine/guidelines.ts";
import { type HooksIntegration, providersWithHooks } from "../lib/providers.ts";

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
  fills?: DiscernConfigDoc | undefined;
}): Promise<Plan> {
  const { templatesDir, destDir, config } = params;
  const tokens = tokensFromConfig(config);

  // `excludeNonSeed`: this scaffolds from the binary's own templates tree, whose
  // skills/ + guidance/ are materialized/read from the binary, never seeded.
  const plan = await buildPlan({
    templatesDir,
    destDir,
    tokens,
    excludeNonSeed: true,
  });

  // The brief is the user's authored intent, captured at init for `discern bootstrap`.
  // It is seeded only when non-empty so a default install's footprint is just
  // `discern.toml` (+ the generated agent files). An empty brief writes nothing.
  if (config.brief.trim().length > 0) {
    const briefOp = await planBrief(destDir, config.brief);
    plan.ops.push(briefOp);
    plan.ops.sort((a, b) => a.targetRel.localeCompare(b.targetRel));
  }

  // Stamp `[meta].schema_version` into the freshly-generated config, then apply
  // any declarative fills (from `init --config`). Both edit the config op's
  // bytes in place, so the plan's bytes are final — dry-run/json show them and
  // apply writes them. A `skip` config (an existing seed) is left untouched.
  stampSchemaIntoPlan(plan, SCHEMA_VERSION);
  if (params.fills) {
    applyFillsToPlan(plan, params.fills);
  }
  // A worktrees-off install (only reachable via `--config`) must not carry the
  // worktree lifecycle hooks — strip them from the settings op (§3.4).
  if (params.fills?.features?.worktrees === false) {
    stripWorktreeHooksFromPlan(plan);
  }
  return plan;
}

/** True when `v` is a non-array JSON object. */
function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

/**
 * Remove the worktree-lifecycle hooks from every hook-providing agent's planned
 * settings file. Used when the worktrees feature is disabled at init, so a
 * disabled feature leaves no inert hooks behind. Provider-driven (ADR 0031): the
 * settings file and the hook-event vocabulary come from each {@link Provider}'s
 * `hooks`, so a new agent's hooks are stripped the same way without editing here.
 */
function stripWorktreeHooksFromPlan(plan: Plan): void {
  for (const provider of providersWithHooks()) {
    if (provider.hooks !== undefined) {
      stripWorktreeHooksFromOp(plan, provider.hooks);
    }
  }
}

/** Strip one provider's worktree hooks (its create/remove event groups + any
 * SessionStart hook that drives the worktree flow) from its planned settings op.
 * A no-op when the op or its hooks are absent/malformed. */
function stripWorktreeHooksFromOp(plan: Plan, h: HooksIntegration): void {
  const op = plan.ops.find((o) => o.targetRel === h.settingsFile);
  if (op === undefined) {
    return;
  }
  let settings: Record<string, unknown>;
  try {
    const parsed: unknown = JSON.parse(TEXT_DECODER.decode(op.bytes));
    if (!isPlainObject(parsed)) {
      return;
    }
    settings = parsed;
  } catch {
    return;
  }
  if (!isPlainObject(settings.hooks)) {
    return;
  }
  const hooks = settings.hooks;
  for (const key of h.worktreeEventKeys) {
    delete hooks[key];
  }
  const sessionStart = hooks.SessionStart;
  if (Array.isArray(sessionStart)) {
    const kept = sessionStart.filter((group) => {
      const inner = (group as { hooks?: unknown }).hooks;
      if (!Array.isArray(inner)) {
        return true;
      }
      return !inner.some((entry) => {
        const cmd = (entry as { command?: unknown }).command;
        return typeof cmd === "string" && cmd.includes(h.sessionHookNeedle);
      });
    });
    if (kept.length === 0) {
      delete hooks.SessionStart;
    } else {
      hooks.SessionStart = kept;
    }
  }
  if (Object.keys(hooks).length === 0) {
    delete settings.hooks;
  }
  op.bytes = TEXT_ENCODER.encode(`${JSON.stringify(settings, null, 2)}\n`);
}

/** Find the `discern.toml` op that is about to be created, or undefined. */
function freshConfigOp(plan: Plan): Plan["ops"][number] | undefined {
  const op = plan.ops.find((o) => o.targetRel === "discern.toml");
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
 * `discern.toml` op via the comment-preserving editor. A no-op when the
 * config is a `skip` (an existing seed left as the user's — fills never clobber it).
 */
function applyFillsToPlan(plan: Plan, fills: DiscernConfigDoc): void {
  const op = freshConfigOp(plan);
  if (!op) {
    return;
  }
  const editor = new TomlEditor(TEXT_DECODER.decode(op.bytes));
  applyConfigDoc(editor, fills);
  op.bytes = TEXT_ENCODER.encode(editor.toString());
}

/** Run `discern init`. Returns a process exit code. */
export async function runInit(options: InitOptions): Promise<number> {
  const log = new Logger(options);
  const destDir = Deno.cwd();

  // Guard: refuse to scaffold over an existing install unless forced. Detect
  // either layout — the consolidated `discern.toml` or a legacy root
  // `discern.toml` left by a pre-migration install.
  if ((await resolveConfigPath(destDir)) !== undefined && !options.force) {
    const message =
      "a discern install already exists here. Re-run with --force to refresh, or use `discern upgrade` to bring it to this kit version.";
    if (options.json) {
      log.result({
        ok: false,
        verb: "init",
        error: "already_initialized",
        message,
      });
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
      log.result({
        ok: false,
        verb: "init",
        error: "templates_not_found",
        message,
      });
    } else {
      log.error(message);
    }
    return 1;
  }

  // Load the --config document (declarative, non-interactive) if given.
  let fileAnswers: DiscernConfigDoc | undefined;
  if (options.config !== undefined) {
    try {
      fileAnswers = await loadConfigDoc(options.config);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (options.json) {
        log.result({
          ok: false,
          verb: "init",
          error: "invalid_config_file",
          message,
        });
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
      log.result({
        ok: false,
        verb: "init",
        error: "invalid_config_file",
        message,
      });
    } else {
      log.error(message);
    }
    return 1;
  }

  // Dry-run: print the plan, touch nothing.
  if (options.dryRun) {
    if (options.json) {
      log.result({
        ok: true,
        verb: "init",
        dry_run: true,
        data: {
          project: { slug: config.slug, agents: config.agents },
          plan: planToJson(plan),
        },
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

  // Compile guidance, materialize skills, and wire each agent's MCP server — all
  // via the one refresh core (compileGuidelines), so init/upgrade/refresh stay
  // consistent (ADR 0031). Pass init's logger so the narration follows its stream
  // discipline (suppressed in --json). Non-fatal: a broken templates tree
  // shouldn't fail the scaffold.
  let agentsWritten: string[] = [];
  let mcpWired: string[] = [];
  let hints: string[] = [];
  try {
    const g = await compileGuidelines(destDir, log);
    agentsWritten = g.agentsWritten;
    mcpWired = g.mcpWired;
    hints = g.hints;
  } catch (error) {
    if (!options.json) {
      log.warn(
        `could not compile agent guidance: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
    }
  }

  if (options.json) {
    log.result({
      ok: true,
      verb: "init",
      hints,
      data: {
        project: { slug: config.slug, agents: config.agents },
        kit_version: KIT_VERSION,
        written: changed.map((op) => op.targetRel),
        compiled: agentsWritten,
        mcp_wired: mcpWired,
      },
    });
    return 0;
  }

  log.line();
  log.ok(`Scaffolded ${changed.length} files into ${destDir}.`);
  printOutro(log, config, mcpWired);
  return 0;
}

/** Print the closing summary: the created footprint and the next step. */
function printOutro(log: Logger, config: InitConfig, mcpWired: string[]): void {
  log.heading(
    `Done. ${log.bold(config.projectName)} now has a discern harness.`,
  );
  log.line();
  log.line(
    "  discern               the task runner — discern finish, discern doctor",
  );
  log.line(
    "  discern.toml          the whole footprint — edit by hand to teach the harness your stack",
  );
  log.line(
    "  AGENTS.md / CLAUDE.md compiled agent guidance (generated, gitignored — edit your sources)",
  );
  log.line(
    "  .claude/settings.json merged (your existing settings were preserved)",
  );
  if (mcpWired.includes(".mcp.json")) {
    log.line(
      "  .mcp.json             registered the discern MCP server (the verbs as tools)",
    );
  }
  log.line();
  log.line(
    `  Opt into more by adding your own files: ${log.bold("guidance.md")}, ${
      log.bold("skills/")
    }, ${log.bold("recipes/")}.`,
  );
  log.line();
  log.heading("Next steps");
  log.line(
    `  1. Ask your coding agent to run ${
      log.bold("discern bootstrap")
    } to finish setup (recommended).`,
  );
  log.line(
    "     It fills principles, guidance, and docs from your brief and proposes your",
  );
  log.line(
    `     capability fills — then records it with ${
      log.bold("discern bootstrap done")
    }.`,
  );
  log.line(
    `     Prefer to wire things by hand? Edit ${
      log.bold("discern.toml")
    } yourself — the harness ships`,
  );
  log.line(
    `     with no capabilities, so ${
      log.bold("discern finish")
    } passes until you fill them.`,
  );
  log.line(
    `  2. Run ${
      log.bold("discern doctor")
    } to verify the install (config, schema, capabilities, and more).`,
  );
}
