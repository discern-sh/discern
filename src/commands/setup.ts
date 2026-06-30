/**
 * `discern setup` — the one-time, zero-config harness setup.
 *
 * Combines mechanical scaffolding and agent-driven authoring in a single command
 * (ADR 0036). The user installs the binary and
 * tells their coding agent to "run discern"; bare `discern` (pre-setup) and the
 * explicit `discern setup` both land here. There are no wizard prompts and no
 * decisions for the user to make at the CLI — setup is always non-interactive:
 *
 *   1. Scaffold the harness machinery (a fresh install, or a `--force` refresh):
 *      `discern.toml` with capabilities unset, the compiled agent files, the
 *      merged settings, the MCP wiring.
 *   2. Lay the doc skeletons — only when the project has none, so an existing
 *      `docs/` tree is never disturbed.
 *   3. Print the setup instructions for the agent in the loop to act on (it asks
 *      the user any clarifying questions in chat — the project never has to).
 *
 * `discern setup done` validates the result (no skeleton markers left) and records
 * `[meta].bootstrapped`, which retires the setup redirect and hides `setup` from
 * the command list.
 *
 * Every scaffolded file is a write-once seed EXCEPT the materialized skills under
 * `.claude/skills/**` — artifacts of the binary, always (re)written and gitignored
 * (bundled skills copied in, authored ones symlinked) by the engine's `refresh`
 * step.
 */

import { ensureDir, walk } from "@std/fs";
import { dirname, join, relative } from "@std/path";
import { type InitConfig, tokensFromConfig } from "../lib/config.ts";
import { Logger } from "../lib/log.ts";
import {
  resolveConfigPath,
  resolveSetupDir,
  resolveTemplatesDir,
} from "../lib/paths.ts";
import { type InitFlags, resolveInitConfig } from "../lib/prompts.ts";
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
import { planToJson, renderPlan } from "../lib/plan_view.ts";
import { compileGuidelines } from "../engine/guidelines.ts";
import { doctorResult } from "./doctor.ts";
import { finishResult } from "../engine/gate/finish.ts";
import {
  type HooksIntegration,
  providerFor,
  providersWithHooks,
  reactivationHandoff,
} from "../lib/providers.ts";
import { resolveDefaultAgents } from "../lib/detect_agents.ts";
import { type DiscernConfig, loadConfig } from "../shared/config_schema.ts";
import { CONFIG_REL, findRoot } from "../shared/env.ts";
import { emitResult } from "../shared/emit.ts";
import { findSkeletonMarkers } from "../shared/setup_state.ts";
import { worktreeState } from "../lib/git.ts";
import { runGit } from "../shared/subprocess.ts";
import { RawConfig } from "../shared/config_read.ts";

/** Options accepted by `discern setup` (global flags + declarative passthrough). */
export interface SetupOptions extends InitFlags {
  json: boolean;
  noColor: boolean;
  dryRun: boolean;
  force: boolean;
  /** Set up on the current branch even if it is dirty — skips the clean-tree check
   * AND the auto-created `discern-setup` branch (the user manages git themselves). */
  allowDirty: boolean;
  /** Path to a JSON answers file (or `-` for stdin) for a declarative scaffold. */
  config?: string | undefined;
  /** The agent's self-declared model id (`--model`), recorded as setup provenance. */
  model?: string | undefined;
}

/** Options for `discern setup done`. */
export interface SetupDoneOptions {
  json: boolean;
  force: boolean;
}

/**
 * The raw Cliffy options the scaffold entry points parse — the `setup` parent (the
 * back-compat/declarative alias) and the canonical `setup begin` sub-verb declare the
 * same set, and both map it through {@link beginOptsFrom}, so the two routes can't
 * drift. Every field is optional (and explicitly `| undefined` for
 * `exactOptionalPropertyTypes`), matching Cliffy's parsed shape structurally.
 */
export interface RawScaffoldCliOptions {
  name?: string | undefined;
  slug?: string | undefined;
  branchPrefix?: string | undefined;
  sourceGlobs?: string | undefined;
  brief?: string | undefined;
  agents?: string | undefined;
  config?: string | undefined;
  model?: string | undefined;
  dryRun?: boolean | undefined;
  force?: boolean | undefined;
  allowDirty?: boolean | undefined;
}

/** Build {@link SetupOptions} for {@link runSetupBegin} from parsed Cliffy options
 * plus the resolved global flags — the one mapping shared by both scaffold routes.
 * Takes `unknown` and narrows (mirroring `globalFlags`), so the shared option-applier
 * can feed it whatever concrete option type Cliffy infers for each command. */
export function beginOptsFrom(
  options: unknown,
  json: boolean,
  noColor: boolean,
): SetupOptions {
  const o = options as RawScaffoldCliOptions;
  return {
    json,
    noColor,
    dryRun: o.dryRun ?? false,
    force: o.force ?? false,
    allowDirty: o.allowDirty ?? false,
    name: o.name,
    slug: o.slug,
    branchPrefix: o.branchPrefix,
    sourceGlobs: o.sourceGlobs,
    brief: o.brief,
    agents: o.agents,
    config: o.config,
    model: o.model,
  };
}

/**
 * True when the user handed `setup` any scaffold or declarative input — so a bare
 * `discern setup` shows the read-only welcome, while `discern setup --config …` (CI,
 * presets), `--force`, `--dry-run`, or any explicit fill scaffolds straight through to
 * `begin` (ADR 0075). The bare-welcome path is exactly the no-input case.
 */
export function hasScaffoldIntent(options: unknown): boolean {
  const o = options as RawScaffoldCliOptions;
  return (
    o.config !== undefined ||
    o.force === true ||
    o.allowDirty === true ||
    o.dryRun === true ||
    o.name !== undefined ||
    o.slug !== undefined ||
    o.branchPrefix !== undefined ||
    o.sourceGlobs !== undefined ||
    o.brief !== undefined ||
    o.agents !== undefined ||
    o.model !== undefined
  );
}

const TEXT_DECODER = new TextDecoder();
const TEXT_ENCODER = new TextEncoder();

/** The config key recording that one-time setup is complete. */
const BOOTSTRAPPED_KEY = "meta.bootstrapped";

const NO_PROJECT =
  "not inside a discern project (no discern.toml in this directory or any parent).";

/**
 * Assemble the complete plan for a scaffold run: the seed templates walk plus the
 * brief op, with the schema version stamped into the generated config so a later
 * `upgrade` reads the right anchor. Re-running over an existing install simply
 * skips the seeds already present (they are the user's) and re-materializes the
 * bundled skills.
 */
export async function assembleInitPlan(params: {
  templatesDir: string;
  destDir: string;
  config: InitConfig;
  /** Declarative slots/scopes/side_gates/ratchets fills from `setup --config`. */
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
    // Only the configured agents get their per-agent seed files (hooks/settings);
    // an unconfigured agent leaves no inert dotfiles behind.
    configuredAgents: config.agents,
  });

  // The brief is the user's authored intent, captured at setup for the agent.
  // It is seeded only when non-empty so a default install's footprint is just
  // `discern.toml` (+ the generated agent files). An empty brief writes nothing.
  if (config.brief.trim().length > 0) {
    const briefOp = await planBrief(destDir, config.brief);
    plan.ops.push(briefOp);
    plan.ops.sort((a, b) => a.targetRel.localeCompare(b.targetRel));
  }

  // Stamp `[meta].schema_version` into the freshly-generated config, then apply
  // any declarative fills (from `setup --config`). Both edit the config op's
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
 * settings file. Used when the worktrees feature is disabled at setup, so a
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

/** What a scaffold pass produced (for the human summary and the JSON envelope). */
interface ScaffoldOutcome {
  config: InitConfig;
  written: string[];
  compiled: string[];
  mcpWired: string[];
  hints: string[];
}

/**
 * Phase 1 — scaffold the harness machinery into `destDir`. Resolves the config
 * non-interactively (flags + `--config` + defaults; never prompts), assembles and
 * applies the seed plan, then compiles guidance / materializes skills / wires MCP.
 * Returns the outcome, or `undefined` when an error was already emitted (caller
 * returns exit 1) or when `--dry-run` short-circuited (the plan was printed).
 */
async function scaffoldHarness(
  destDir: string,
  opts: SetupOptions,
  log: Logger,
  freshInstall: boolean,
): Promise<{ outcome?: ScaffoldOutcome; stop?: number }> {
  let templatesDir: string;
  try {
    templatesDir = await resolveTemplatesDir();
  } catch (error) {
    emitSetupError(log, opts, "templates_not_found", errMsg(error));
    return { stop: 1 };
  }

  // Load the --config document (declarative, non-interactive) if given.
  let fileAnswers: DiscernConfigDoc | undefined;
  if (opts.config !== undefined) {
    try {
      fileAnswers = await loadConfigDoc(opts.config);
    } catch (error) {
      emitSetupError(log, opts, "invalid_config_file", errMsg(error));
      return { stop: 1 };
    }
  }

  // Setup is always non-interactive: resolve from flags + the --config file +
  // defaults, never prompting. The user makes no decisions at the CLI.
  const effectiveFlags = mergeDocIntoFlags(opts, fileAnswers);
  effectiveFlags.yes = true;

  // Auto-detect the agent set for a FRESH install when the user named none (no
  // --agents, no --config agents): seed [guidance].agents from what is actually on
  // PATH, else DEFAULT_AGENTS. Detection runs once here and is persisted to config;
  // resolveConfiguredAgents stays a pure runtime reader (never re-detects). Gated on
  // freshInstall because the config is write-once — a --force re-run leaves an
  // existing [guidance].agents untouched, so re-detecting would be inert anyway.
  if (freshInstall && effectiveFlags.agents === undefined) {
    effectiveFlags.agents = (await resolveDefaultAgents()).join(",");
  }
  let config: InitConfig;
  try {
    config = await resolveInitConfig(effectiveFlags, log);
  } catch (error) {
    // A bad explicit choice (e.g. an invalid --slug) — a clean diagnostic, not
    // a stack trace.
    emitSetupError(log, opts, "invalid_option", errMsg(error));
    return { stop: 1 };
  }

  let plan: Plan;
  try {
    plan = await assembleInitPlan({
      templatesDir,
      destDir,
      config,
      fills: fileAnswers,
    });
  } catch (error) {
    emitSetupError(
      log,
      opts,
      "invalid_config_file",
      `invalid --config fills: ${errMsg(error)}`,
    );
    return { stop: 1 };
  }

  // Dry-run: print the plan, touch nothing.
  if (opts.dryRun) {
    if (opts.json) {
      log.result({
        ok: true,
        verb: "setup",
        dry_run: true,
        data: {
          project: { slug: config.slug, agents: config.agents },
          plan: planToJson(plan),
        },
      });
    } else {
      renderPlan(log, plan, "Dry run — setup would perform:");
      log.line();
      log.info("No files were written (--dry-run).");
    }
    return { stop: 0 };
  }

  const changed = await applyPlan(plan);

  // Record setup provenance into the freshly-scaffolded config — the discern version
  // that ran begin, and any agent-declared --model — for support triage (ADR 0075).
  // FRESH-INSTALL ONLY: a `--force` re-run over a user's pre-existing config seed must
  // leave it byte-for-byte untouched, so provenance is never stamped into a file
  // discern didn't write. After applyPlan, so the fresh config exists to edit.
  if (freshInstall) {
    await recordProvenance(destDir, opts.model);
  }

  // Seed guidance.md (the default [guidance].sources) BEFORE the first compile, and
  // migrate any pre-existing, hand-authored agent file into it so the compile that
  // follows can't destroy the user's instructions (ADR 0065).
  const seeded = await seedGuidance(destDir, config, freshInstall);

  // Compile guidance, materialize skills, and wire each agent's MCP server — all
  // via the one refresh core (compileGuidelines). Pass setup's logger so the
  // narration follows its stream discipline (suppressed in --json). Non-fatal: a
  // broken templates tree shouldn't fail the scaffold.
  let compiled: string[] = [];
  let mcpWired: string[] = [];
  let hints: string[] = [];
  try {
    const g = await compileGuidelines(destDir, log);
    compiled = g.agentsWritten;
    mcpWired = g.mcpWired;
    hints = g.hints;
    // A per-artifact refresh failure is isolated (ADR 0065) — surface it so the
    // user knows a skills dir / agent file / the MCP wiring didn't complete.
    if (g.errors.length > 0) {
      hints = [
        ...g.errors.map((e) =>
          `setup could not complete a refresh artifact: ${e}`
        ),
        ...hints,
      ];
    }
  } catch (error) {
    log.warn(`could not compile agent guidance: ${errMsg(error)}`);
  }
  if (seeded.migrated.length > 0) {
    hints = [
      `Preserved your existing ${
        seeded.migrated.join(", ")
      } by migrating it into guidance.md — fold it into the conventions and delete the import note.`,
      ...hints,
    ];
  }

  const written = changed.map((op) => op.targetRel);
  if (seeded.guidanceLaid) {
    written.push("guidance.md");
  }
  return {
    outcome: { config, written, compiled, mcpWired, hints },
  };
}

/**
 * Seed `guidance.md` (the default `[guidance].sources`) before the first compile,
 * and — critically — migrate any pre-existing, hand-authored agent file into it so
 * the compile that follows can't destroy the user's instructions (ADR 0065).
 *
 * On a FRESH install no discern-generated agent file can exist (discern writes them
 * only via a compile, which needs a config), so every `CLAUDE.md`/`AGENTS.md`/
 * `GEMINI.md` already on disk is the USER's — its body is folded into `guidance.md`
 * under a labelled heading, deduped by content so identical mirrors migrate once.
 * The stub is laid only when `guidance.md` is absent, so a re-run never clobbers the
 * agent's work; on a `--force` re-run the user's content is already in `guidance.md`
 * from the first run, so migration is skipped.
 */
async function seedGuidance(
  root: string,
  config: InitConfig,
  freshInstall: boolean,
): Promise<{ guidanceLaid: boolean; migrated: string[] }> {
  const guidancePath = join(root, "guidance.md");

  // Capture pre-existing user agent files (fresh install only — see above).
  const migrated: { file: string; body: string }[] = [];
  if (freshInstall) {
    const seen = new Set<string>();
    for (const agent of config.agents) {
      const rel = providerFor(agent)?.guidanceFile.path;
      if (rel === undefined) {
        continue;
      }
      let body: string;
      try {
        body = (await Deno.readTextFile(join(root, rel))).trim();
      } catch {
        continue; // absent — nothing to preserve
      }
      if (body.length === 0 || seen.has(body)) {
        continue; // empty, or an identical mirror already captured
      }
      seen.add(body);
      migrated.push({ file: rel, body });
    }
  }

  // Lay the stub when guidance.md is absent (write-once: a re-run keeps the agent's).
  let content: string;
  let guidanceLaid = false;
  try {
    content = await Deno.readTextFile(guidancePath);
  } catch {
    const stub = join(await resolveSetupDir(), "skeleton", "guidance.md");
    content = (await Deno.readTextFile(stub)).replaceAll(
      "{{project_name}}",
      config.projectName,
    );
    guidanceLaid = true;
  }

  // Append each migrated body under a labelled heading, skipping any already present
  // (idempotent if setup is re-run).
  let appended = "";
  for (const m of migrated) {
    const heading = `## Imported from ${m.file}`;
    if (content.includes(heading) || content.includes(m.body)) {
      continue;
    }
    appended += `\n${heading}\n\n` +
      `<!-- discern migrated your existing ${m.file} here during setup so it wouldn't ` +
      `be lost. Fold it into the conventions above, then delete this note. -->\n\n` +
      `${m.body}\n`;
  }

  if (guidanceLaid || appended.length > 0) {
    await Deno.writeTextFile(guidancePath, content + appended);
  }
  return { guidanceLaid, migrated: migrated.map((m) => m.file) };
}

/**
 * Record setup provenance into the freshly-scaffolded `discern.toml` (ADR 0075):
 * `[meta].setup_version` (the discern version that ran `begin`) and, when the agent
 * declared one via `--model`, `[meta].setup_model`. For the support triage `doctor`
 * surfaces; advisory only — discern can't verify a self-declared model. Comment-
 * preserving (mirrors how `setup done` records `bootstrapped`). The caller gates this
 * on `freshInstall`, so a pre-existing config seed is never edited; the per-key
 * `has()` guard is belt-and-suspenders, keeping it write-once even if that changes.
 */
async function recordProvenance(
  root: string,
  model: string | undefined,
): Promise<void> {
  const path = (await resolveConfigPath(root)) ?? join(root, CONFIG_REL);
  let raw: string;
  try {
    raw = await Deno.readTextFile(path);
  } catch {
    return; // no config to stamp (shouldn't happen post-scaffold)
  }
  const existing = new RawConfig(raw);
  const editor = new TomlEditor(raw);
  let changed = false;
  if (!existing.has("meta.setup_version")) {
    editor.setString("meta.setup_version", KIT_VERSION);
    changed = true;
  }
  const declared = model?.trim();
  // Ignore the literal placeholder (`--model "<your-model-id>"`) the verify funnel
  // shows: an agent that copies it verbatim instead of substituting must not record a
  // bogus `<your-model-id>` as the provenance.
  const isPlaceholder = declared !== undefined && declared.includes("<");
  if (
    declared !== undefined && declared.length > 0 && !isPlaceholder &&
    !existing.has("meta.setup_model")
  ) {
    editor.setString("meta.setup_model", declared);
    changed = true;
  }
  if (changed) {
    await Deno.writeTextFile(path, editor.toString());
  }
}

/**
 * Phase 2 — lay the doc skeletons under `root`, non-destructively. The docs tree
 * is all-or-nothing: skipped entirely when any `docs/` already exists, so an
 * existing tree is never mixed with the skeleton shape. `TODO.md` is an
 * independent single-file seed, laid only when absent.
 */
async function laySkeletons(
  root: string,
  name: string,
): Promise<{ laid: string[]; skipped: string[] }> {
  const skeletonDir = join(await resolveSetupDir(), "skeleton");
  const laid: string[] = [];
  const skipped: string[] = [];

  if (await pathExists(join(root, "docs"))) {
    skipped.push("docs/");
  } else if (await pathExists(join(skeletonDir, "docs"))) {
    await copyTreeSubstituting(
      join(skeletonDir, "docs"),
      join(root, "docs"),
      name,
    );
    laid.push("docs/");
  }

  const todoSkeleton = join(skeletonDir, "TODO.md");
  if (await pathExists(join(root, "TODO.md"))) {
    skipped.push("TODO.md");
  } else if (await pathExists(todoSkeleton)) {
    await copyTextSubstituting(todoSkeleton, join(root, "TODO.md"), name);
    laid.push("TODO.md");
  }

  return { laid, skipped };
}

/**
 * `discern setup begin` — the first mutating phase of the staged handshake (ADR 0075):
 * scaffold (when fresh, or `--force`), lay the doc skeletons, record setup provenance,
 * and print the setup brief for the agent in the loop. Reached by the explicit `begin`
 * sub-verb, by the declarative `--config`/flag path (CI/presets skip the welcome), and
 * idempotently again to reprint the brief while setup is in progress. Returns an exit
 * code.
 */
export async function runSetupBegin(opts: SetupOptions): Promise<number> {
  const log = new Logger(opts);
  const destDir = Deno.cwd();
  const existingConfig = await resolveConfigPath(destDir);
  const freshInstall = existingConfig === undefined;

  // Already set up → setup is a no-op unless --force re-seeds. An unparseable
  // config is treated as not-set-up so the agent can repair it.
  if (!freshInstall && !opts.force) {
    let bootstrapped = false;
    try {
      bootstrapped = (await loadConfig(destDir)).meta.bootstrapped;
    } catch {
      bootstrapped = false;
    }
    if (bootstrapped) {
      const message =
        "this project is already set up. Re-run with --force to seed it again.";
      if (opts.json) {
        log.result({
          ok: true,
          verb: "setup",
          data: { already_set_up: true, message },
        });
      } else {
        console.log(`discern: ${message}`);
      }
      return 0;
    }
  }

  // --- Pre-scaffold: isolate a fresh install on its own branch (ADR 0065) ---
  // A fresh setup makes several commits; keep them off the user's current branch and
  // trivially revertible. Require a clean tree (fail if dirty), then create + check
  // out `discern-setup`. Skipped on --dry-run (writes nothing), --allow-dirty (the
  // user manages git), a re-run/--force, or outside a git repo.
  let setupBranch: string | undefined;
  if (freshInstall && !opts.dryRun && !opts.allowDirty) {
    const { branch, stop } = await ensureSetupBranch(destDir, opts, log);
    if (stop !== undefined) {
      return stop; // dirty tree — error already emitted, nothing written
    }
    setupBranch = branch;
  }

  // --- Phase 1: scaffold the machinery (fresh install, or --force refresh) ---
  let scaffold: ScaffoldOutcome | undefined;
  if (freshInstall || opts.force) {
    const { outcome, stop } = await scaffoldHarness(
      destDir,
      opts,
      log,
      freshInstall,
    );
    if (stop !== undefined) {
      return stop; // error emitted, or --dry-run already printed the plan
    }
    scaffold = outcome;
  }

  // --- Phase 2: lay the doc skeletons (only where the project has none) ---
  // Read the config for the project name, but degrade gracefully: a `--force`
  // re-run over a half-written or minimal config (the resume-after-interruption
  // case) must still lay skeletons rather than throw.
  let cfg: DiscernConfig | undefined;
  try {
    cfg = await loadConfig(destDir);
  } catch {
    cfg = undefined;
  }
  // Prefer the fresh scaffold's project name — its casing is preserved from the
  // directory ("ListOfListsOfLists"). Reconstructing from the persisted slug loses
  // it (the slug is lowercase → "Listoflistsoflists"), so fall back to that only on
  // a resume where the fresh InitConfig isn't in hand (ADR 0065).
  const name = scaffold?.config.projectName ??
    (cfg ? displayNameFromSlug(cfg.project.slug) : "the project");
  const { laid, skipped } = await laySkeletons(destDir, name);

  // --- Phase 3: print the setup instructions for the agent to act on ---
  const instructions = await Deno.readTextFile(
    join(await resolveSetupDir(), "instructions.md"),
  );

  if (opts.json) {
    log.result({
      ok: true,
      verb: "setup",
      hints: scaffold?.hints ?? [],
      data: {
        // The scaffold succeeded, but SETUP is not done — the agent must now act
        // on `instructions`. Carry that explicitly so a JSON-consuming agent can't
        // read `ok: true` / exit 0 as "task complete" (the failure this guards).
        complete: false,
        bootstrapped: false,
        branch: setupBranch ?? null,
        next_action:
          "Work through `data.instructions`, then run `discern setup done` to finish.",
        project: {
          slug: cfg?.project.slug ?? scaffold?.config.slug ?? "",
          agents: cfg?.guidance.agents ?? [],
        },
        kit_version: KIT_VERSION,
        written: scaffold?.written ?? [],
        compiled: scaffold?.compiled ?? [],
        mcp_wired: scaffold?.mcpWired ?? [],
        skeletons: laid,
        skipped,
        instructions,
      },
    });
    return 0;
  }

  // Human/agent: everything on stdout (the channel the agent reads) so the frame
  // can't land on a stream it ignores. A loud handoff banner leads — the scaffold
  // succeeding is NOT the task succeeding, and exit 0 + a green check read as
  // "done" is exactly the failure this guards. Then the scaffold facts, the brief
  // verbatim, and a tail-survivable footer that survives context truncation: even
  // if the top is chopped, the last lines still say "not done", how to reprint the
  // brief, and how to finish.
  const heavyRule = "═".repeat(72);
  const thinRule = "─".repeat(72);
  console.log(heavyRule);
  console.log("  SETUP STARTED — NOT FINISHED.");
  console.log(
    "  The steps below are a task for you, the agent, to perform now — not a",
  );
  console.log("  result to summarise back to the user as already done.");
  console.log(heavyRule);
  console.log("");
  if (setupBranch !== undefined) {
    console.log(
      `On branch \`${setupBranch}\` — created from your clean tree so this setup is isolated and easy to roll back (or merge when you're happy).`,
    );
  }
  if (scaffold) {
    console.log(
      `Harness files written: ${scaffold.written.length} into ${destDir}.`,
    );
  }
  if (laid.length > 0) {
    console.log(
      `Project skeletons laid: ${
        laid.join(", ")
      } (filled with the project name; complete them below).`,
    );
  }
  if (skipped.length > 0) {
    console.log(
      `Left your existing ${
        skipped.join(", ")
      } untouched — work with what is there.`,
    );
  }
  console.log("");
  console.log(thinRule);
  console.log("");
  console.log(instructions);
  console.log("");
  console.log(heavyRule);
  console.log(
    "  You are NOT done. Work the steps above, then run `discern setup done` —",
  );
  console.log("  that gate is the only thing that completes setup.");
  console.log(
    "  • Brief truncated or scrolled off? Re-run `discern setup begin` to reprint",
  );
  console.log("    it in full — it is idempotent and won't touch your work.");
  console.log(
    "  • `discern status` will keep reporting setup as unfinished until",
  );
  console.log("    `discern setup done` passes.");
  console.log(heavyRule);
  return 0;
}

/** The branch `discern setup` creates so a fresh install never lands on — or commits
 * to — the user's current branch. */
const SETUP_BRANCH = "discern-setup";

/**
 * Before a FRESH scaffold writes anything, isolate the work on its own branch
 * (ADR 0065). `discern setup` makes several commits; landing them on the user's
 * current branch pollutes it before they're ready and complicates rollback. So:
 * require a clean working tree (fail on uncommitted *tracked* changes — untracked
 * scratch files are fine), then create and check out `discern-setup`. A no-op
 * outside a git repo (nothing to isolate). Returns the branch it put you on
 * (`undefined` when not in a repo, or the branch couldn't be created), or a `stop`
 * code when the tree is dirty (the error is already emitted). The caller gates this
 * on `freshInstall && !dryRun && !allowDirty`.
 */
async function ensureSetupBranch(
  destDir: string,
  opts: SetupOptions,
  log: Logger,
): Promise<{ branch?: string; stop?: number }> {
  const state = await worktreeState(destDir);
  if (state.kind === "not-a-repo") {
    return {}; // no git here → nothing to isolate; setup proceeds in place
  }
  if (state.kind === "dirty") {
    const message =
      "your working tree has uncommitted changes, and `discern setup` makes several " +
      "commits. Commit or stash your work first, or re-run with --allow-dirty to set " +
      "up on the current branch as-is.";
    if (opts.json) {
      log.result({
        ok: false,
        verb: "setup",
        error: "dirty_worktree",
        message,
        data: { changes: state.changes },
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
    return { stop: 1 };
  }
  // Clean tree: create or check out the dedicated setup branch.
  const current =
    (await runGit(["rev-parse", "--abbrev-ref", "HEAD"], { cwd: destDir }))
      .stdout.trim();
  if (current === SETUP_BRANCH) {
    return { branch: SETUP_BRANCH }; // already on it (a resume that stayed here)
  }
  const exists =
    (await runGit(["rev-parse", "--verify", "--quiet", SETUP_BRANCH], {
      cwd: destDir,
    })).success;
  const checkout = exists
    ? await runGit(["checkout", SETUP_BRANCH], { cwd: destDir })
    : await runGit(["checkout", "-b", SETUP_BRANCH], { cwd: destDir });
  if (!checkout.success) {
    // Non-fatal: if branching fails, don't block setup — proceed in place.
    log.warn(
      `could not create the \`${SETUP_BRANCH}\` branch; setting up on the current branch.`,
    );
    return {};
  }
  return { branch: SETUP_BRANCH };
}

/** Options for `discern setup step <n>` (just the global flags). */
export interface SetupStepOptions {
  json: boolean;
  noColor: boolean;
}

/**
 * `discern setup step <n>` — re-serve ONE numbered step of the setup brief, read-only
 * (ADR 0075). A convenience for an agent that lost the thread mid-setup; it tracks
 * nothing and records nothing — derived progress (`status`, the welcome) is the
 * progress signal, never a self-reported step marker.
 */
export async function runSetupStep(
  n: number,
  opts: SetupStepOptions,
): Promise<number> {
  const instructions = await Deno.readTextFile(
    join(await resolveSetupDir(), "instructions.md"),
  );
  const section = extractStep(instructions, n);
  if (section === undefined) {
    const message =
      `no Step ${n} in the setup brief. Run \`discern setup begin\` to reprint the whole brief.`;
    if (opts.json) {
      emitResult({
        ok: false,
        verb: "setup:step",
        error: "no_such_step",
        message,
      });
    } else {
      console.error(`discern: ${message}`);
    }
    return 1;
  }
  if (opts.json) {
    emitResult({
      ok: true,
      verb: "setup:step",
      data: { step: n, text: section },
    });
  } else {
    console.log(section);
  }
  return 0;
}

/** Slice the `## Step <n> — …` section out of the brief, up to the next `## ` heading
 * or a `---` rule. Returns undefined when there is no such step. */
function extractStep(brief: string, n: number): string | undefined {
  const lines = brief.split("\n");
  const startRe = new RegExp(`^## Step ${n}\\b`);
  let start = -1;
  for (let i = 0; i < lines.length; i++) {
    if (startRe.test(lines[i] ?? "")) {
      start = i;
      break;
    }
  }
  if (start === -1) {
    return undefined;
  }
  let end = lines.length;
  for (let i = start + 1; i < lines.length; i++) {
    const line = lines[i] ?? "";
    if (line.startsWith("## ") || line.trim() === "---") {
      end = i;
      break;
    }
  }
  return lines.slice(start, end).join("\n").trimEnd();
}

/**
 * `discern setup done` — validate that no skeleton markers remain AND prove the
 * gate green (ADR 0065), then record `[meta].bootstrapped = true` so the setup
 * redirect retires and the command hides itself. The proof — `refresh` → `doctor`
 * → `finish` — makes the brief's definition-of-done structural: completion can't be
 * recorded unless the install is healthy and the gate actually passes. Also the
 * escape hatch for a manual setup: `--force` records completion despite leftover
 * markers AND skips the proof.
 */
export async function runSetupDone(opts: SetupDoneOptions): Promise<number> {
  const root = await rootOrError(opts.json, "setup:done");
  if (root === undefined) {
    return 1;
  }

  // Validate: no scaffolded doc (or the guidance source) may still carry a marker.
  const leftover = await findSkeletonMarkers(root);

  if (leftover.length > 0 && !opts.force) {
    const message =
      `setup is not finished — ${leftover.length} file(s) still carry skeleton markers ` +
      "(a `<!-- setup fills this -->` sentinel or the EXAMPLE principle).";
    if (opts.json) {
      emitResult({
        ok: false,
        verb: "setup:done",
        error: "incomplete",
        message,
        data: { leftover },
      });
    } else {
      console.error(`discern: ${message}`);
      for (const f of leftover) {
        console.error(`         • ${f}`);
      }
      console.error(
        "       Fill them and re-run, or pass --force to mark complete anyway.",
      );
    }
    return 1;
  }

  // The structural completion proof (ADR 0065): refresh → doctor → finish must pass
  // before completion is recorded, so "the gate is real" can't be reported without
  // being true. `--force` is the escape hatch — it skips the proof entirely.
  if (!opts.force) {
    const failed = await proveGateGreen(root, opts.json);
    if (failed !== undefined) {
      return failed; // already emitted; [meta].bootstrapped is NOT recorded
    }
  }

  // Record the marker, comment-preserving (mirrors `discern config set --bool`).
  const path = (await resolveConfigPath(root)) ?? join(root, CONFIG_REL);
  const editor = new TomlEditor(await Deno.readTextFile(path));
  editor.setBool(BOOTSTRAPPED_KEY, true);
  await Deno.writeTextFile(path, editor.toString());

  const forced = leftover.length > 0;
  // The reactivation handoff (ADR 0075): the agent files, MCP servers, and session
  // hooks were wired at `begin`, but coding agents load MCP + hooks at SESSION START —
  // so this session can't see them. Tell the agent, per configured agent, to reactivate.
  const reactivation = reactivationHandoff(await loadConfig(root));
  if (opts.json) {
    emitResult({
      ok: true,
      verb: "setup:done",
      hints: [reactivation.summary],
      data: {
        bootstrapped: true,
        forced,
        gate_proven: !opts.force,
        leftover,
        reactivation,
      },
    });
    return 0;
  }
  console.log(
    opts.force
      ? "Setup complete — recorded [meta].bootstrapped = true in discern.toml (--force; gate not proven)."
      : "Setup complete — gate is green; recorded [meta].bootstrapped = true in discern.toml.",
  );
  console.log(
    "The one-time setup redirect is now retired and `discern setup` is hidden from the command list.",
  );
  if (forced) {
    console.log(
      `(Marked complete with --force despite ${leftover.length} file(s) still carrying skeleton markers.)`,
    );
  }
  console.log("");
  console.log(reactivation.summary);
  for (const a of reactivation.per_agent) {
    console.log(`  • ${a.label}: ${a.step}`);
  }
  return 0;
}

/**
 * Run the completion proof `discern setup done` requires before recording
 * `[meta].bootstrapped` (ADR 0065): `refresh` (so the generated agent files are
 * current), then `doctor` (the install is healthy), then `finish` (the gate is
 * green with whatever capabilities were just wired). The cores run BELOW the
 * router/MCP bootstrap gate, so they execute even though setup isn't recorded yet —
 * the "bootstrap bypass" is automatic. Returns `undefined` when the proof passed
 * (the caller records completion), or exit 1 (already emitted) when a step failed.
 */
async function proveGateGreen(
  root: string,
  json: boolean,
): Promise<number | undefined> {
  // 1. refresh — recompile the agent files + skills so finish's currency check sees
  //    a current tree (the agent likely edited guidance.md and the docs just now).
  try {
    await compileGuidelines(
      root,
      new Logger({ json, noColor: false, humanStream: "stdout" }),
    );
  } catch (error) {
    return emitDoneGateFailure(
      json,
      "refresh",
      `could not compile the agent guidance: ${errMsg(error)}`,
    );
  }

  // 2. doctor — the install must be healthy (capability commands resolvable, the
  //    configured agents known, the gotchas doc resolving, …).
  if (!(await doctorResult(root)).ok) {
    return emitDoneGateFailure(
      json,
      "doctor",
      "the install has problems; run `discern doctor` and fix what it flags",
    );
  }

  // 3. finish — the gate must be green with the capabilities the agent wired.
  if (!(await finishResult(root)).ok) {
    return emitDoneGateFailure(
      json,
      "finish",
      "the quality gate is not green; run `discern finish`, fix the failures, then re-run",
    );
  }

  return undefined;
}

/**
 * Emit a `setup done` completion-proof failure (naming the gate step that failed)
 * and return exit 1. `[meta].bootstrapped` is left unrecorded, so `status` keeps
 * reporting setup as unfinished until the proof passes (or `--force` overrides it).
 */
function emitDoneGateFailure(
  json: boolean,
  stage: "refresh" | "doctor" | "finish",
  detail: string,
): number {
  const message = `setup is not finished — ${detail}.`;
  if (json) {
    emitResult({
      ok: false,
      verb: "setup:done",
      error: "gate_failed",
      message,
      data: { stage },
    });
  } else {
    console.error(`discern: ${message}`);
    console.error(
      `       (\`discern setup done\` runs refresh → doctor → finish as its completion proof; the ${stage} step failed.)`,
    );
    console.error(
      "       Fix it and re-run, or pass --force to record completion without the proof.",
    );
  }
  return 1;
}

/** Emit a setup-phase error in both human and `--json` modes. */
function emitSetupError(
  log: Logger,
  opts: SetupOptions,
  error: string,
  message: string,
): void {
  if (opts.json) {
    log.result({ ok: false, verb: "setup", error, message });
  } else {
    log.error(message);
  }
}

/** Normalise an unknown thrown value into a message string. */
function errMsg(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/** Resolve the project root, or print the standard "no project" error and return undefined. */
async function rootOrError(
  json: boolean,
  verb: string,
): Promise<string | undefined> {
  const root = await findRoot();
  if (root === undefined) {
    if (json) {
      emitResult({ ok: false, verb, error: "no_project", message: NO_PROJECT });
    } else {
      console.error(`discern: ${NO_PROJECT}`);
      console.error("       Run `discern setup` to scaffold one.");
    }
  }
  return root;
}

/** Title-case a kebab/underscore slug into a display name ("my-app" → "My App"). */
function displayNameFromSlug(slug: string): string {
  const words = slug.split(/[-_\s]+/).filter(Boolean);
  if (words.length === 0) {
    return "the project";
  }
  return words.map((w) => w.charAt(0).toUpperCase() + w.slice(1)).join(" ");
}

/** True when a path exists (any type, symlinks not followed). */
async function pathExists(path: string): Promise<boolean> {
  try {
    await Deno.lstat(path);
    return true;
  } catch {
    return false;
  }
}

/** Copy one text file, substituting `{{project_name}}`, creating parent dirs. */
async function copyTextSubstituting(
  src: string,
  dest: string,
  name: string,
): Promise<void> {
  const text = (await Deno.readTextFile(src)).replaceAll(
    "{{project_name}}",
    name,
  );
  await ensureDir(dirname(dest));
  await Deno.writeTextFile(dest, text);
}

/** Recursively copy a skeleton subtree into the project, substituting tokens per file. */
async function copyTreeSubstituting(
  srcDir: string,
  destDir: string,
  name: string,
): Promise<void> {
  for await (const entry of walk(srcDir, { includeDirs: false })) {
    const rel = relative(srcDir, entry.path);
    await copyTextSubstituting(entry.path, join(destDir, rel), name);
  }
}
