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
import { type SetupConfig, tokensFromConfig } from "../lib/config.ts";
import { Logger } from "../lib/log.ts";
import {
  resolveConfigPath,
  resolveSetupDir,
  resolveTemplatesDir,
  resolveWorktreeRoot,
} from "../lib/paths.ts";
import { type InitFlags, resolveSetupConfig } from "../lib/prompts.ts";
import {
  applyConfigDoc,
  type DiscernConfigDoc,
  loadConfigDoc,
  mergeDocIntoFlags,
} from "../lib/config_doc.ts";
import { TomlEditor } from "../lib/toml_edit.ts";
import { stampSchemaVersion } from "../lib/schema.ts";
import { KIT_VERSION, SCHEMA_VERSION } from "../lib/version.ts";
import {
  applyPlan,
  buildPlan,
  type Plan,
  PlanApplyError,
  planBrief,
  SettingsMergePlanError,
} from "../lib/fs_plan.ts";
import { planToJson, renderPlan } from "../lib/plan_view.ts";
import {
  compileGuidelines,
  guidanceRefreshErrors,
  guidanceRefreshSucceeded,
} from "../engine/guidelines.ts";
import { renderAgentFiles } from "../engine/guidance_render.ts";
import { doctorResult } from "./doctor.ts";
import { finishResult } from "../engine/gate/finish.ts";
import {
  lifecycleContext,
  probeWorktreeViability,
} from "../engine/worktree/lifecycle.ts";
import { providerFor, reactivationHandoff } from "../lib/providers.ts";
import { resolveDefaultAgents } from "../lib/detect_agents.ts";
import { type DiscernConfig, loadConfig } from "../shared/config_schema.ts";
import { CONFIG_REL, findRoot } from "../shared/env.ts";
import { emitResult } from "../shared/emit.ts";
import { findSkeletonMarkers, SETUP_BRANCH } from "../shared/setup_state.ts";
import {
  getSetupPage,
  renderSetupBegin,
  renderSetupPage,
  type SetupPage,
} from "../shared/setup_pages.ts";
import {
  evaluateSetupCompletion,
  type SetupCheckResult,
} from "../shared/setup_checks.ts";
import { worktreeState } from "../lib/git.ts";
import { runGit } from "../shared/subprocess.ts";
import { RawConfig } from "../shared/config_read.ts";
import {
  assessSetupAssurance,
  type SetupAssurance,
} from "../shared/setup_assurance.ts";
import {
  completionMessage,
  confirmedBeginCommand,
  consentMessage,
  deriveConsentContext,
} from "../shared/setup_messages.ts";
import type { SetupDoneData } from "../shared/result_schemas.ts";
import {
  LAND_COMMAND,
  type LandingSummary,
  landingSummary,
} from "./setup_land.ts";
import { KNOWN_ENGINE_VERBS } from "../engine/dispatch.ts";
import { normalizeDocsDir } from "../shared/docs_path.ts";
import { guidanceSeedRel, SOURCE_PATHS } from "../shared/paths_registry.ts";

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
  /** The consent attestation (`--confirmed`): the agent affirms it held the setup
   * consent conversation `verify` served. Required for a fresh, non-declarative
   * `begin`; its absence re-serves the consent message (ADR 0086). */
  confirmed: boolean;
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
  docs?: string | undefined;
  config?: string | undefined;
  model?: string | undefined;
  dryRun?: boolean | undefined;
  force?: boolean | undefined;
  allowDirty?: boolean | undefined;
  confirmed?: boolean | undefined;
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
    confirmed: o.confirmed ?? false,
    name: o.name,
    slug: o.slug,
    branchPrefix: o.branchPrefix,
    sourceGlobs: o.sourceGlobs,
    brief: o.brief,
    agents: o.agents,
    docs: o.docs,
    config: o.config,
    model: o.model,
  };
}

/**
 * True when the user handed `setup` any scaffold or declarative input — so a bare
 * `discern setup` shows the read-only welcome, while `discern setup --config …` (CI,
 * presets), `--force`, `--dry-run`, `--confirmed`, or any explicit fill scaffolds
 * straight through to `begin` (ADR 0075). The bare-welcome path is exactly the no-input
 * case; `--confirmed` counts as intent so an agent that already held the consent
 * conversation can go straight to `begin` via `discern setup --confirmed` (ADR 0086).
 */
export function hasScaffoldIntent(options: unknown): boolean {
  const o = options as RawScaffoldCliOptions;
  return (
    o.config !== undefined ||
    o.force === true ||
    o.allowDirty === true ||
    o.dryRun === true ||
    o.confirmed === true ||
    o.name !== undefined ||
    o.slug !== undefined ||
    o.branchPrefix !== undefined ||
    o.sourceGlobs !== undefined ||
    o.brief !== undefined ||
    o.agents !== undefined ||
    o.docs !== undefined ||
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
  config: SetupConfig;
  /** Declarative slots/scopes/side_gates/ratchets fills from `setup --config`. */
  fills?: DiscernConfigDoc | undefined;
  /** The repo's detected integration branch, stamped into the fresh config's
   * `[project].main_branch` (before the fills, so an explicit fill still wins). */
  mainBranch?: string | undefined;
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

  // Stamp `[meta].schema_version` and the detected integration branch into the
  // freshly-generated config, then apply any declarative fills (from
  // `setup --config`). All edit the config op's bytes in place, so the plan's
  // bytes are final — dry-run/json show them and apply writes them. A `skip`
  // config (an existing seed) is left untouched. Order matters: the fills come
  // last, so an explicitly declared main_branch beats the detected one.
  stampSchemaIntoPlan(plan, SCHEMA_VERSION);
  if (params.mainBranch !== undefined) {
    stampMainBranchIntoPlan(plan, params.mainBranch);
  }
  if (params.fills) {
    applyFillsToPlan(plan, params.fills);
  }
  return plan;
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
 * Stamp the detected `[project].main_branch` into a freshly-generated config op,
 * in place (comment-preserving). Without this, a repo whose default branch is not
 * `main` scaffolds a config pointing the gate's merge check at a branch that does
 * not exist locally — a check that then silently self-skips forever, and a
 * `setup land` that dead-ends.
 */
function stampMainBranchIntoPlan(plan: Plan, branch: string): void {
  const op = freshConfigOp(plan);
  if (!op) {
    return;
  }
  const editor = new TomlEditor(TEXT_DECODER.decode(op.bytes));
  editor.setString("project.main_branch", branch);
  op.bytes = TEXT_ENCODER.encode(editor.toString());
}

/**
 * Detect the repository's real integration branch for the scaffold to stamp: the
 * remote's declared default (`origin/HEAD`) wins, then the branch checked out
 * when setup started — so this must run BEFORE the `discern-setup` checkout —
 * then the user's configured `init.defaultBranch` (a tiebreaker for a detached
 * HEAD only: vendor builds bake a default into it — Apple's git ships
 * `init.defaultBranch = main` in an unmaskable baked-in config — so consulting
 * it ahead of the checked-out branch would stamp `main` on every macOS `master`
 * repo, the exact bug this detection exists to fix). Undefined outside a git
 * repo, when every probe comes back empty, or when the current branch is already
 * `discern-setup` (a resume — never an integration branch).
 */
async function detectIntegrationBranch(
  destDir: string,
): Promise<string | undefined> {
  const inRepo = await runGit(["rev-parse", "--is-inside-work-tree"], {
    cwd: destDir,
  });
  if (!inRepo.success) {
    return undefined;
  }
  const originHead = await runGit(
    ["symbolic-ref", "--quiet", "refs/remotes/origin/HEAD"],
    { cwd: destDir },
  );
  const originPrefix = "refs/remotes/origin/";
  const originRef = originHead.stdout.trim();
  if (originHead.success && originRef.startsWith(originPrefix)) {
    const branch = originRef.slice(originPrefix.length);
    if (branch !== "") {
      return branch;
    }
  }
  // `git branch --show-current` (not `rev-parse --abbrev-ref HEAD`) so an unborn
  // branch — a brand-new `git init` with no commits yet — still names itself.
  const current =
    (await runGit(["branch", "--show-current"], { cwd: destDir })).stdout
      .trim();
  if (current !== "" && current !== SETUP_BRANCH) {
    return current;
  }
  const configured =
    (await runGit(["config", "init.defaultBranch"], { cwd: destDir })).stdout
      .trim();
  if (configured !== "") {
    return configured;
  }
  return undefined;
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
  config: SetupConfig;
  /** Where the starter guidance was (or would be) seeded — the resolved
   * `[guidance].sources` seed location. */
  guidanceRel: string;
  written: string[];
  compiled: string[];
  mcpWired: string[];
  hooksWired: string[];
  /** Project files written co-managing an agent app's worktree-lifecycle config
   * (Codex's `environment.toml`) — `compileGuidelines`'s `worktreeAppWired`
   * passed through. Folded into {@link commitScaffoldedMachinery}'s commit
   * alongside `mcpWired`: it is the same kind of discern-owned wiring a coding
   * agent's safety classifier won't commit, just a different per-agent file. */
  worktreeAppWired: string[];
  /** Project-local provider policy/rules files written by `compileGuidelines`. */
  projectRulesWired: string[];
  /** Whether every refresh artifact completed without non-blank errors. */
  guidelinesCompiled: boolean;
  /** Non-blank refresh artifact errors, trimmed for the JSON result. */
  guidelinesErrors: string[];
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
  detectedMainBranch: string | undefined,
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
  let config: SetupConfig;
  try {
    config = await resolveSetupConfig(effectiveFlags, log);
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
      mainBranch: detectedMainBranch,
    });
  } catch (error) {
    if (error instanceof SettingsMergePlanError) {
      emitSetupError(log, opts, "invalid_settings_file", errMsg(error));
    } else if (opts.config !== undefined) {
      emitSetupError(
        log,
        opts,
        "invalid_config_file",
        `invalid --config fills: ${errMsg(error)}`,
      );
    } else {
      emitSetupError(
        log,
        opts,
        "setup_plan_failed",
        `could not prepare setup plan: ${errMsg(error)}`,
      );
    }
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

  let changed: Awaited<ReturnType<typeof applyPlan>>;
  try {
    changed = await applyPlan(plan);
  } catch (error) {
    const message = error instanceof PlanApplyError
      ? error.message
      : `could not apply setup plan: ${errMsg(error)}`;
    emitSetupError(log, opts, "apply_failed", message);
    return { stop: 1 };
  }

  // Record setup provenance into the freshly-scaffolded config — the discern version
  // that ran begin, and any agent-declared --model — for support triage (ADR 0075).
  // FRESH-INSTALL ONLY: a `--force` re-run over a user's pre-existing config seed must
  // leave it byte-for-byte untouched, so provenance is never stamped into a file
  // discern didn't write. After applyPlan, so the fresh config exists to edit.
  if (freshInstall) {
    await recordProvenance(destDir, opts.model);
  }

  // Seed the guidance source (the configured [guidance].sources, else the registry
  // default) BEFORE the first compile, and migrate any pre-existing, hand-authored
  // agent file into it so the compile that follows can't destroy the user's
  // instructions (ADR 0065). The freshly-applied plan wrote the config, so the
  // seed location resolves from it; a broken config falls back to the default.
  let guidanceRel = SOURCE_PATHS.guidance.defaultPath;
  try {
    guidanceRel = guidanceSeedRel(
      (await loadConfig(destDir)).guidance.sources,
    );
  } catch {
    // Unreadable config — seed at the registry default; doctor diagnoses the rest.
  }
  const seeded = await seedGuidance(destDir, guidanceRel, config, freshInstall);

  // Compile guidance, materialize skills, and wire each agent's MCP server — all
  // via the one refresh core (compileGuidelines). Pass setup's logger so the
  // narration follows its stream discipline (suppressed in --json). Non-fatal: a
  // broken templates tree shouldn't fail the scaffold.
  let compiled: string[] = [];
  let mcpWired: string[] = [];
  let hooksWired: string[] = [];
  let worktreeAppWired: string[] = [];
  let projectRulesWired: string[] = [];
  let guidelinesCompiled = true;
  let guidelinesErrors: string[] = [];
  let hints: string[] = [];
  try {
    const g = await compileGuidelines(destDir, log);
    compiled = g.agentsWritten;
    mcpWired = g.mcpWired;
    hooksWired = g.hooksWired;
    worktreeAppWired = g.worktreeAppWired;
    projectRulesWired = g.projectRulesWired;
    hints = g.hints;
    guidelinesErrors = guidanceRefreshErrors(g);
    guidelinesCompiled = guidanceRefreshSucceeded(g);
    // A per-artifact refresh failure is isolated (ADR 0065) — surface it so the
    // user knows a skills dir / agent file / the MCP wiring didn't complete.
    if (guidelinesErrors.length > 0) {
      hints = [
        ...guidelinesErrors.map((e) =>
          `setup could not complete a refresh artifact: ${e}`
        ),
        ...hints,
      ];
    }
  } catch (error) {
    const message = `could not compile agent guidance: ${errMsg(error)}`;
    guidelinesCompiled = false;
    guidelinesErrors = [message];
    hints = [`setup could not complete a refresh artifact: ${message}`];
    log.warn(message);
  }
  if (seeded.migrated.length > 0) {
    hints = [
      `Preserved your existing ${
        seeded.migrated.join(", ")
      } by migrating it into ${guidanceRel} — fold it into the conventions and delete the import note.`,
      ...hints,
    ];
  }
  if (seeded.skippedOwnRender.length > 0) {
    hints = [
      `Skipped importing ${
        seeded.skippedOwnRender.join(", ")
      } into ${guidanceRel} — it matches discern's own compiled output (a leftover of an earlier setup), not your authoring.`,
      ...hints,
    ];
  }

  const written = changed.map((op) => op.targetRel);
  if (seeded.guidanceLaid) {
    written.push(guidanceRel);
  }
  return {
    outcome: {
      config,
      guidanceRel,
      written,
      compiled,
      mcpWired,
      hooksWired,
      worktreeAppWired,
      projectRulesWired,
      guidelinesCompiled,
      guidelinesErrors,
      hints,
    },
  };
}

/**
 * Seed the guidance source at `guidanceRel` (the resolved `[guidance].sources`
 * seed location) before the first compile, and — critically — migrate any
 * pre-existing, hand-authored agent file into it so the compile that follows
 * can't destroy the user's instructions (ADR 0065).
 *
 * On a FRESH install no discern-generated agent file SHOULD exist (discern writes
 * them only via a compile, which needs a config) — but one can survive an
 * abandoned earlier setup, because the compiled files are gitignored and outlive
 * a branch switch or a deleted `discern-setup` branch. So a candidate is treated
 * as the USER's — its body folded into the source under a labelled heading,
 * deduped by content so identical mirrors migrate once — only when it does NOT
 * match discern's own render for that path ({@link renderAgentFiles} is
 * deterministic from config + sources, so the comparison is exact and cheap);
 * a match is skipped and reported, never re-imported as if it were authoring.
 * The stub is laid only when the source is absent, so a re-run never clobbers the
 * agent's work; on a `--force` re-run the user's content is already in the source
 * from the first run, so migration is skipped.
 */
async function seedGuidance(
  root: string,
  guidanceRel: string,
  config: SetupConfig,
  freshInstall: boolean,
): Promise<{
  guidanceLaid: boolean;
  migrated: string[];
  skippedOwnRender: string[];
}> {
  const guidancePath = join(root, guidanceRel);

  // Capture pre-existing user agent files (fresh install only — see above).
  const migrated: { file: string; body: string }[] = [];
  const skippedOwnRender: string[] = [];
  if (freshInstall) {
    // Discern's own compiled content for each agent-file path, rendered from the
    // just-scaffolded config + the on-disk sources — the exact bytes a refresh
    // would write. Unavailable (undefined) when the config can't load; the
    // migration then proceeds as before rather than blocking the scaffold.
    let ownRender: Map<string, string> | undefined;
    try {
      ownRender = await renderAgentFiles(root);
    } catch {
      ownRender = undefined;
    }
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
      if (ownRender?.get(rel)?.trim() === body) {
        // A survivor of an abandoned setup, not the user's authoring — importing
        // it would fold discern's own compiled guidance back into the source.
        skippedOwnRender.push(rel);
        continue;
      }
      seen.add(body);
      migrated.push({ file: rel, body });
    }
  }

  // Lay the stub when the source is absent (write-once: a re-run keeps the agent's).
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
      `<!-- discern imported your existing ${m.file} here during setup so it wouldn't ` +
      `be lost. Fold it into the conventions above, then delete this note. -->\n\n` +
      `${m.body}\n`;
  }

  if (guidanceLaid || appended.length > 0) {
    await ensureDir(dirname(guidancePath));
    await Deno.writeTextFile(guidancePath, content + appended);
  }
  return {
    guidanceLaid,
    migrated: migrated.map((m) => m.file),
    skippedOwnRender,
  };
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
 * is all-or-nothing: skipped entirely when the configured docs dir already
 * exists, so an existing tree is never mixed with the skeleton shape. The
 * deferred-work ledger (`[project].todo`) is an independent single-file seed,
 * laid only when absent.
 */
async function laySkeletons(
  root: string,
  name: string,
  docsDir: string,
  todoRel: string,
): Promise<{ laid: string[]; skipped: string[] }> {
  const skeletonDir = join(await resolveSetupDir(), "skeleton");
  const laid: string[] = [];
  const skipped: string[] = [];
  const docsRel = normalizeDocsDir(docsDir);
  const docsAbs = join(root, docsRel);
  const tokens: SkeletonTokens = {
    "{{project_name}}": name,
    "{{docs_dir}}": docsRel,
    "{{todo_path}}": todoRel,
  };

  if (await pathExists(docsAbs)) {
    skipped.push(docsRel);
  } else if (await pathExists(join(skeletonDir, "docs"))) {
    await copyTreeSubstituting(
      join(skeletonDir, "docs"),
      docsAbs,
      tokens,
    );
    laid.push(docsRel);
  }

  const todoSkeleton = join(skeletonDir, "TODO.md");
  if (await pathExists(join(root, todoRel))) {
    skipped.push(todoRel);
  } else if (await pathExists(todoSkeleton)) {
    await copyTextSubstituting(todoSkeleton, join(root, todoRel), tokens);
    laid.push(todoRel);
  }

  return { laid, skipped };
}

/** The path context setup's agent-facing brief renders against. */
interface SetupPathContext {
  docsDir: string;
  todoRel: string;
  guidanceRel: string;
}

/** Render the configured source paths into setup's agent-facing path references.
 * The brief has no config key (ADR 0102), so its token renders the registry
 * default directly rather than riding {@link SetupPathContext}. */
function renderSetupPaths(
  instructions: string,
  paths: SetupPathContext,
): string {
  return instructions
    .replaceAll("{{docs_dir}}", normalizeDocsDir(paths.docsDir))
    .replaceAll("{{todo_path}}", paths.todoRel)
    .replaceAll("{{guidance_path}}", paths.guidanceRel)
    .replaceAll("{{brief_path}}", SOURCE_PATHS.brief.defaultPath);
}

async function gitTopLevel(start: string): Promise<string | undefined> {
  const root = await runGit(["rev-parse", "--show-toplevel"], { cwd: start });
  if (!root.success) {
    return undefined;
  }
  const path = root.stdout.trim();
  return path.length === 0 ? undefined : path;
}

/**
 * Resolve where setup should operate from the caller's cwd. Existing installs use
 * the same marker walk as status/done/step; fresh setup in a Git subdirectory uses
 * the repository top-level so the scaffold and the setup branch describe one tree.
 * Outside Git, there is no broader project root to infer, so setup stays in cwd.
 */
async function resolveSetupRoot(start: string): Promise<string> {
  return (await findRoot(start)) ?? (await gitTopLevel(start)) ?? start;
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

  // The verbatim-copy guard for `--docs`, mirroring the `--model` placeholder
  // guard in recordProvenance: an angle-bracket value is the consent framing's
  // own example copied unsubstituted, and accepting it would scaffold a literal
  // `<placeholder>/` tree. --model degrades silently (provenance is advisory);
  // --docs REFUSES, because it decides where real files land.
  if (opts.docs !== undefined && /[<>]/.test(opts.docs)) {
    emitSetupError(
      log,
      opts,
      "invalid_option",
      `--docs received a literal placeholder (${opts.docs}) — substitute the real project-relative path to the docs folder (e.g. --docs docs/), or omit the flag to keep discern's map at its default home.`,
    );
    return 1;
  }

  const destDir = await resolveSetupRoot(Deno.cwd());
  const existingConfig = await resolveConfigPath(destDir);
  let freshInstall = existingConfig === undefined;

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

  // --- Consent attestation (ADR 0086) ---
  // A fresh, non-declarative scaffold requires an explicit `--confirmed`: the agent
  // attests it held the consent conversation `verify` served. Absent it, refuse BEFORE
  // touching anything and RE-SERVE the identical consent message — an agent that skipped
  // `verify` is handed the conversation to hold, not silently proceeded past it (the
  // error path is the teaching path). The declarative paths (`--config`, `--allow-dirty`,
  // the CI/automation surfaces) are consent-exempt; a `--force` re-run over an existing
  // install is not `freshInstall`, so it is exempt too — but `--force` on a truly fresh
  // tree still requires consent. Stateless: the attestation rides the invocation, so
  // ADR 0075's no-sidecar-marker invariant holds.
  if (
    freshInstall && opts.config === undefined && !opts.allowDirty &&
    !opts.confirmed
  ) {
    return emitAwaitingConsent(log, opts, destDir);
  }

  // Detect the repo's real integration branch BEFORE the `discern-setup` checkout
  // below (the last detection probe reads the currently checked-out branch), so the
  // scaffold stamps `[project].main_branch` with the truth rather than assuming
  // `main` — on a `master` repo that assumption silently disarms the gate's merge
  // check and dead-ends `setup land`.
  const detectedMainBranch = freshInstall
    ? await detectIntegrationBranch(destDir)
    : undefined;

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
    // The checkout may have been a RESUME: an abandoned setup's config lives in
    // commits on the pre-existing `discern-setup` branch, so checking it out just
    // materialized a half-finished install that looked fresh from the branch we
    // started on. Recompute, so the paths below reprint the brief instead of
    // re-scaffolding over (and re-importing) the earlier run's work.
    if (branch !== undefined) {
      freshInstall = (await resolveConfigPath(destDir)) === undefined;
    }
  }

  // --- Phase 1: scaffold the machinery (fresh install, or --force refresh) ---
  let scaffold: ScaffoldOutcome | undefined;
  if (freshInstall || opts.force) {
    const { outcome, stop } = await scaffoldHarness(
      destDir,
      opts,
      log,
      freshInstall,
      detectedMainBranch,
    );
    if (stop !== undefined) {
      return stop; // error emitted, or --dry-run already printed the plan
    }
    scaffold = outcome;
  }

  // --- Commit the scaffolded machinery (discern owns its own wiring) ---
  // When `begin` created the isolated `discern-setup` branch (the fresh-install path:
  // a clean git repo, not --dry-run / --allow-dirty), commit the harness machinery it
  // just wrote — the config, the `.gitignore` fragment, and the per-agent MCP + hooks
  // files — as one commit, so a coding agent never has to commit discern's own
  // permission-widening wiring (a pre-approved MCP server), which its safety classifier
  // is rightly trained to refuse. Best-effort and fail-open (a commit failure falls back
  // to the agent committing by hand); skipped when setup proceeds in place with no branch.
  let machineryCommit: AutoCommitOutcome | undefined;
  if (setupBranch !== undefined && scaffold !== undefined) {
    machineryCommit = await commitScaffoldedMachinery(destDir, scaffold);
  }
  const machineryCommitted = machineryCommit?.state === "committed";

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
  // a resume where the fresh SetupConfig isn't in hand (ADR 0065).
  const name = scaffold?.config.projectName ??
    (cfg ? displayNameFromSlug(cfg.project.slug) : "the project");
  const docsDir = cfg?.docs.dir ?? scaffold?.config.docsDir ??
    SOURCE_PATHS.docs.defaultPath;
  const todoRel = cfg?.project.todo ?? SOURCE_PATHS.todo.defaultPath;
  const { laid, skipped } = await laySkeletons(destDir, name, docsDir, todoRel);

  // --- Phase 3: print the operating principles + the FIRST page (ADR 0078) ---
  // `begin` emits the principles and page 0 only (A10); the agent pulls each
  // subsequent page with `discern setup step <n>`. Fall back to the raw brief only
  // if it can't be parsed into pages (a malformed spine — a discern bug the test
  // suite catches, never a user's input).
  const rawInstructions = await Deno.readTextFile(
    join(await resolveSetupDir(), "instructions.md"),
  );
  let instructions = renderSetupPaths(rawInstructions, {
    docsDir,
    todoRel,
    guidanceRel: scaffold?.guidanceRel ??
      (cfg !== undefined
        ? guidanceSeedRel(cfg.guidance.sources)
        : SOURCE_PATHS.guidance.defaultPath),
  });
  let firstPage: SetupPage | undefined;
  try {
    const rendered = renderSetupBegin(instructions);
    instructions = rendered.text;
    firstPage = rendered.firstPage;
  } catch {
    // Keep `instructions` as the rendered brief — the agent still gets the full text.
  }

  if (opts.json) {
    const setupOk = scaffold?.guidelinesCompiled ?? true;
    const guidelinesErrors = scaffold?.guidelinesErrors ?? [];
    log.result({
      ok: setupOk,
      verb: "setup",
      ...(setupOk ? {} : {
        error: "partial_refresh",
        message:
          `${guidelinesErrors.length} artifact(s) failed to refresh; see data.guidelines_errors.`,
      }),
      hints: scaffold?.hints ?? [],
      data: {
        // The scaffold succeeded, but SETUP is not done — the agent must now act
        // on `instructions`. Carry that explicitly so a JSON-consuming agent can't
        // read `ok: true` / exit 0 as "task complete" (the failure this guards).
        complete: false,
        bootstrapped: false,
        branch: setupBranch ?? null,
        machinery_committed: machineryCommitted,
        ...(machineryCommit?.state === "failed"
          ? { machinery_commit_error: machineryCommit.detail }
          : {}),
        next_action:
          "Work through `data.instructions` (the principles + page 0), pull each next page with `discern setup step <n>`, then run `discern setup done` to finish.",
        project: {
          slug: cfg?.project.slug ?? scaffold?.config.slug ?? "",
          agents: cfg?.guidance.agents ?? [],
        },
        kit_version: KIT_VERSION,
        written: scaffold?.written ?? [],
        compiled: scaffold?.compiled ?? [],
        mcp_wired: scaffold?.mcpWired ?? [],
        hooks_wired: scaffold?.hooksWired ?? [],
        worktree_app_wired: scaffold?.worktreeAppWired ?? [],
        project_rules_wired: scaffold?.projectRulesWired ?? [],
        guidelines_compiled: setupOk,
        guidelines_errors: guidelinesErrors,
        skeletons: laid,
        skipped,
        instructions,
        // The structured first page (ADR 0078); the rest are pulled via `setup step`.
        page: firstPage ?? null,
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
    "  What follows is a task for you, the agent, to perform now — not a",
  );
  console.log("  result to summarise back to the user as already done.");
  console.log(heavyRule);
  console.log("");
  // The started moment — the third human touchpoint of the served-message handshake
  // (ADR 0086): a one-line relay so the human hears setup has begun and what's next,
  // even from an agent that only couriers discern's words.
  console.log(
    setupBranch !== undefined
      ? `Tell your human: setup has started on the \`${setupBranch}\` branch — next I'll study the repo and come back with a few questions.`
      : "Tell your human: setup has started — next I'll study the repo and come back with a few questions.",
  );
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
  if (machineryCommitted) {
    console.log(
      "Committed discern's harness wiring (config, .gitignore, MCP + hooks) for you — the docs, guidance, and TODO below are yours to fill and commit.",
    );
  } else if (machineryCommit?.state === "failed") {
    console.log(
      `Could not auto-commit discern's harness wiring — commit the scaffolded files yourself once it's fixed. Git said: ${machineryCommit.detail}`,
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
    "  You are NOT done. Above are the operating principles and the first page",
  );
  console.log(
    "  (Step 0). Pull each following page with `discern setup step <n>` — every",
  );
  console.log(
    '  page\'s "Next" line chains you onward — do the work it asks, then run',
  );
  console.log(
    "  `discern setup done`: that gate is the only thing that completes setup.",
  );
  console.log(
    "  • Lost the principles or this page? Re-run `discern setup begin` to reprint",
  );
  console.log("    them — it is idempotent and won't touch your work.");
  console.log(
    "  • `discern status` will keep reporting setup as unfinished until",
  );
  console.log("    `discern setup done` passes.");
  console.log(heavyRule);
  return 0;
}

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
      "commits. Commit or stash your work first. (Advanced: --allow-dirty sets up on " +
      "the current branch as-is, skipping the isolated discern-setup branch — for CI " +
      "or automated setups.)";
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

/**
 * Authored-content seeds the coding agent fills and commits itself — NEVER swept into
 * the machinery commit. Both are scaffolded into {@link ScaffoldOutcome.written}:
 * the guidance stub (at the resolved seed location) and the brief (the captured
 * intent, present only when a brief was supplied — at its fixed registry path).
 * The other authored seeds — the docs skeletons and the deferred-work ledger —
 * are laid AFTER the commit (by {@link laySkeletons}), so they never reach it.
 */
function authoredContentSeeds(guidanceRel: string): ReadonlySet<string> {
  return new Set([guidanceRel, SOURCE_PATHS.brief.defaultPath]);
}

/**
 * Commit the harness machinery `setup begin` just scaffolded — discern's OWN wiring: the
 * config, the `.gitignore` fragment, the per-agent MCP + hooks files, any app-managed
 * worktree-lifecycle config, and any provider-owned project rules an agent declares
 * (derived from {@link ScaffoldOutcome.written} ∪ `.mcpWired` ∪ `.hooksWired`
 * ∪ `.worktreeAppWired` ∪ `.projectRulesWired`, minus the
 * {@link authoredContentSeeds} the agent fills) —
 * as one `discern: scaffold harness` commit on the `discern-setup` branch. discern
 * OWNS this commit because the files are exactly the ones a coding agent's safety classifier
 * refuses to commit (pre-approving an MCP server widens permissions), which otherwise strands
 * discern's essential wiring on a dirty tree. Extends the {@link commitCompletionMarker}
 * precedent — the engine commits its own output — and mirrors its shape: best-effort and
 * fail-open, so a commit failure (e.g. commit signing) never fails `begin`; the agent can
 * still commit by hand. Commits ONLY the derived machinery paths (never `git add -A`), so the
 * authored-content seeds (the guidance stub, the docs skeletons, the ledger) stay uncommitted
 * for the agent. The caller gates this on being on the `discern-setup` branch (a fresh install
 * in a git repo), so it never runs when setup proceeds in place.
 *
 * The committed set is the union of every {@link ScaffoldOutcome} array discern itself wrote
 * — never a hand-copied per-agent file list — so a new wiring category (the way
 * `hooksWired`, `worktreeAppWired`, and `projectRulesWired` joined `mcpWired`
 * here) only has to flow into `ScaffoldOutcome` once to be committed for every
 * provider that declares it; `tests/agent_parity_test.ts`-style
 * coverage holds the registry and this set in sync.
 */
async function commitScaffoldedMachinery(
  root: string,
  scaffold: ScaffoldOutcome,
): Promise<AutoCommitOutcome> {
  const paths = [
    ...new Set([
      ...scaffold.written,
      ...scaffold.mcpWired,
      ...scaffold.hooksWired,
      ...scaffold.worktreeAppWired,
      ...scaffold.projectRulesWired,
    ]),
  ]
    .filter((p) => !authoredContentSeeds(scaffold.guidanceRel).has(p))
    .sort();
  if (paths.length === 0) {
    // Nothing scaffolded to commit (e.g. a fully-idempotent re-run).
    return { state: "skipped" };
  }
  const add = await runGit(["add", "--", ...paths], { cwd: root });
  if (!add.success) {
    return { state: "failed", detail: gitFailureLine(add.stderr) };
  }
  const commit = await runGit(
    ["commit", "-m", "discern: scaffold harness"],
    { cwd: root },
  );
  return commit.success
    ? { state: "committed" }
    : { state: "failed", detail: gitFailureLine(commit.stderr) };
}

/**
 * A best-effort git auto-commit's outcome. Fail-open stands — a failure never
 * fails the verb — but the CAUSE is carried, not discarded: `failed` keeps the
 * git stderr line (a missing identity, commit signing, a hook) so both surfaces
 * can explain what to fix instead of misattributing the skip. `skipped` is the
 * deliberate no-op (nothing to commit / could not prove the diff is safe).
 */
type AutoCommitOutcome =
  | { state: "committed" }
  | { state: "skipped" }
  | { state: "failed"; detail: string };

/** The completion-marker commit's outcome — {@link AutoCommitOutcome} plus the
 * outside-git case, which is not a failure at all. */
type MarkerCommitOutcome = AutoCommitOutcome | { state: "no-git" };

/**
 * The one git stderr line worth relaying from a failed auto-commit: the last
 * `fatal:`/`error:` line when present (git states the specific cause there —
 * "unable to auto-detect email address", a signing failure), else the first
 * non-empty line, else a generic fallback.
 */
function gitFailureLine(stderr: string): string {
  const lines = stderr.split("\n").map((l) => l.trim()).filter((l) =>
    l !== ""
  );
  const fatal = lines.findLast((l) =>
    l.startsWith("fatal:") || l.startsWith("error:")
  );
  return fatal ?? lines[0] ?? "git did not report a cause";
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
  const rawInstructions = await Deno.readTextFile(
    join(await resolveSetupDir(), "instructions.md"),
  );
  let docsDir = SOURCE_PATHS.docs.defaultPath;
  let todoRel = SOURCE_PATHS.todo.defaultPath;
  let guidanceRel = SOURCE_PATHS.guidance.defaultPath;
  const root = await findRoot();
  if (root !== undefined) {
    try {
      const cfg = await loadConfig(root);
      docsDir = cfg.docs.dir;
      todoRel = cfg.project.todo;
      guidanceRel = guidanceSeedRel(cfg.guidance.sources);
    } catch {
      // A broken config is diagnosed by strict verbs; keep the default paths here.
    }
  }
  const instructions = renderSetupPaths(rawInstructions, {
    docsDir,
    todoRel,
    guidanceRel,
  });
  let page: SetupPage | undefined;
  try {
    page = getSetupPage(instructions, n);
  } catch (error) {
    // A malformed spine in the shipped brief — surface it rather than serve half a
    // page. The test suite parses the real brief, so this can't reach a user.
    const message = `the setup brief could not be parsed: ${errMsg(error)}`;
    if (opts.json) {
      emitResult({
        ok: false,
        verb: "setup step",
        error: "brief_unparseable",
        message,
      });
    } else {
      console.error(`discern: ${message}`);
    }
    return 1;
  }
  if (page === undefined) {
    const message =
      `no Step ${n} in the setup brief. Run \`discern setup begin\` to reprint the operating principles and the first page.`;
    if (opts.json) {
      emitResult({
        ok: false,
        verb: "setup step",
        error: "no_such_step",
        message,
      });
    } else {
      console.error(`discern: ${message}`);
    }
    return 1;
  }
  if (opts.json) {
    // Both lanes: the machine `spine` AND the prose `guidance` (ADR 0078).
    emitResult({ ok: true, verb: "setup step", data: page });
  } else {
    // Human: the prose leads; the spine's rails bracket it (renderSetupPage).
    console.log(renderSetupPage(page));
  }
  return 0;
}

/**
 * Commit the `[meta].bootstrapped` marker `setup done` just wrote. The safety
 * invariant is path-local: stage and commit ONLY `discern.toml`, and only when its
 * HEAD diff is exactly the one marker line. Unrelated tracked, staged, or untracked
 * work is left for the agent's own tidy commit. A no-op outside a git repo.
 * Best-effort throughout — a git failure never fails `done`, since completion is
 * already recorded by the time this runs.
 */
async function commitCompletionMarker(
  root: string,
  configPath: string,
): Promise<MarkerCommitOutcome> {
  if ((await worktreeState(root)).kind === "not-a-repo") {
    return { state: "no-git" };
  }
  const configRel = relative(root, configPath);
  // The config change must be EXACTLY the marker line we just wrote, nothing else
  // (e.g. capabilities the agent left uncommitted). Diff against HEAD so staged
  // config edits are included in the check instead of sneaking into the commit.
  // "Anything else is unexpected", so fail open.
  const diff = await runGit(["diff", "HEAD", "--", configRel], { cwd: root });
  if (!diff.success) {
    return { state: "failed", detail: gitFailureLine(diff.stderr) };
  }
  const body = diff.stdout.split("\n");
  const added = body.filter((l) => l.startsWith("+") && !l.startsWith("+++"));
  const removed = body.filter((l) => l.startsWith("-") && !l.startsWith("---"));
  const markerKey = BOOTSTRAPPED_KEY.split(".").pop();
  const onlyMarker = removed.length === 0 && added.length === 1 &&
    added[0]?.slice(1).trim() === `${markerKey} = true`;
  if (!onlyMarker) {
    // More than the marker line changed → leave it for the agent, deliberately.
    return { state: "skipped" };
  }
  const add = await runGit(["add", "--", configRel], { cwd: root });
  if (!add.success) {
    return { state: "failed", detail: gitFailureLine(add.stderr) };
  }
  const commit = await runGit(
    ["commit", "-m", "Mark discern setup complete", "--", configRel],
    { cwd: root },
  );
  return commit.success
    ? { state: "committed" }
    : { state: "failed", detail: gitFailureLine(commit.stderr) };
}

/**
 * Evaluate the derived per-step completion checks (ADR 0078), returning only the
 * UNMET ones. A config that won't load yields none — the gate proof (doctor /
 * finish) surfaces a broken config instead, so a parse error never masquerades as
 * an incomplete step.
 */
async function unmetSetupChecks(root: string): Promise<SetupCheckResult[]> {
  let config: DiscernConfig;
  try {
    config = await loadConfig(root);
  } catch {
    return [];
  }
  const results = await evaluateSetupCompletion({ root, config });
  return results.filter((r) => !r.passed);
}

/**
 * Emit the combined "setup is not finished" failure — the leftover skeleton markers
 * AND the unmet per-step checks, each named — in both human and `--json` modes.
 * `[meta].bootstrapped` stays unrecorded, so `status` keeps reporting setup as
 * unfinished until every one passes (or `--force` overrides it).
 */
function emitSetupIncomplete(
  json: boolean,
  leftover: string[],
  unmet: SetupCheckResult[],
): void {
  const parts: string[] = [];
  if (leftover.length > 0) {
    parts.push(`${leftover.length} file(s) still carry skeleton markers`);
  }
  if (unmet.length > 0) {
    parts.push(`${unmet.length} step check(s) are not satisfied`);
  }
  const message = `setup is not finished — ${parts.join(" and ")}.`;
  if (json) {
    emitResult({
      ok: false,
      verb: "setup done",
      error: "incomplete",
      message,
      data: { leftover, unmet },
    });
    return;
  }
  console.error(`discern: ${message}`);
  for (const f of leftover) {
    console.error(`         • ${f} (skeleton marker remains)`);
  }
  for (const u of unmet) {
    console.error(`         • Step ${u.step} — ${u.describe}`);
  }
  console.error(
    "       Fill them and re-run, or pass --force to mark complete anyway.",
  );
}

/** The view `printDoneSuccess` renders — the celebrate/assure/land/onboard pieces of a
 * completed `setup done`, computed once and shared with the `--json` envelope. */
interface DoneSuccessView {
  opts: SetupDoneOptions;
  forced: boolean;
  leftover: string[];
  markerCommit: MarkerCommitOutcome;
  assurance: SetupAssurance;
  landing: LandingSummary;
  reactivation: ReturnType<typeof reactivationHandoff>;
  coachVerb: string;
  /** The ready-to-relay completion message — carried verbatim, identical to the
   * `--json` `guidance` field (ADR 0086). */
  guidance: string;
  /** Whether the worktree probe actually proved the project viable in a copy (ADR
   * 0090) — false when the probe was skipped (worktrees off, uncreatable, or forced),
   * so the render never claims coverage it didn't earn. */
  worktreeProven: boolean;
  /** The configured deferred-work ledger path (`[project].todo`). */
  todoRel: string;
}

/** The ordered next-action hints `setup done --json` carries for an agent (A11): land
 * the work, reactivate the tools, then deepen the setup with the coach. */
function doneHints(
  landing: LandingSummary,
  reactivation: ReturnType<typeof reactivationHandoff>,
  coachVerb: string,
  todoRel: string,
): string[] {
  const hints: string[] = [];
  if (landing.inRepo && !landing.onTarget && landing.branch !== "") {
    hints.push(
      `Your setup is on branch \`${landing.branch}\`, not yet on \`${landing.target}\` — land it with \`${LAND_COMMAND}\` (or leave it for review).`,
    );
  }
  hints.push(reactivation.summary);
  hints.push(
    `Deepen your setup: run \`discern ${coachVerb} --json\` (the project coach), review the findings with your human, do the quick wins now, and record larger ones in ${todoRel}.`,
  );
  return hints;
}

/** The one-line coverage verdict (A12), distinguishing "setup complete" from "the full
 * recommended gate is active". */
function verdictSentence(a: SetupAssurance): string {
  switch (a.verdict) {
    case "full":
      return "Quality coverage: full — every standard check is enforced, so `discern finish` runs the complete recommended gate.";
    case "minimal":
      return "Quality coverage: minimal — setup is complete, but no standard checks are enforced yet, so `discern finish` can't catch regressions on its own. Wiring tests is the highest-leverage next step.";
    case "partial":
      return `Quality coverage: partial — ${a.enforced} of ${a.total} standard checks enforced. Setup is complete, but not every recommended protection is active yet.`;
  }
}

/** The aligned per-capability assurance lines (A12) — each capability and its honest
 * state (enforced / deferred [+reason] / absent). */
function assuranceLines(a: SetupAssurance): string[] {
  const width = Math.max(...a.capabilities.map((c) => c.name.length));
  return a.capabilities.map((c) => {
    const name = c.name.padEnd(width);
    const mark = c.state === "enforced"
      ? "✓"
      : c.state === "deferred"
      ? "•"
      : "·";
    const label = c.state === "enforced"
      ? "enforced — runs on every `discern finish`"
      : c.state === "deferred"
      ? (c.reason !== undefined
        ? `deferred — ${c.reason}`
        : "deferred — present but set to a no-op")
      : "absent — no command configured";
    return `  ${mark} ${name}  ${label}`;
  });
}

/** The "land your setup" follow-up (A11), as a numbered step `n` plus continuation
 * lines — naming where the work lives and the exact command, adapted to the git state. */
function landStep(landing: LandingSummary, n: number): string[] {
  if (!landing.inRepo) {
    return [
      `  ${n}. Land your setup — this project isn't a git repository, so there's nothing to land; your setup is in place as-is.`,
    ];
  }
  if (landing.onTarget) {
    return [
      `  ${n}. Land your setup — it already lives on \`${landing.target}\`, so there's nothing to land.`,
    ];
  }
  if (landing.branch === "") {
    return [
      `  ${n}. Land your setup onto \`${landing.target}\` — you're on a detached HEAD; check out your setup branch, then run \`${LAND_COMMAND}\`.`,
    ];
  }
  return [
    `  ${n}. Land your setup onto \`${landing.target}\`. Your work is on branch \`${landing.branch}\`,`,
    `     not yet on \`${landing.target}\` — switching to \`${landing.target}\` now would look like`,
    `     discern vanished. Land it:  ${LAND_COMMAND}`,
    `     Prefer to review first? Leave \`${landing.branch}\` as-is and land it when ready —`,
    "     doing nothing is safe; the branch keeps every commit.",
  ];
}

/** Render the warm, honest completion output (A11/A12): celebrate the achievement,
 * report what coverage is actually active, and lay out the ordered follow-ups (land →
 * reactivate → deepen). The `--json` envelope is rendered from the SAME computed
 * pieces, so the two surfaces can't drift (ADR 0028). */
function printDoneSuccess(view: DoneSuccessView): void {
  const {
    opts,
    forced,
    leftover,
    markerCommit,
    assurance,
    landing,
    reactivation,
    coachVerb,
    guidance,
    worktreeProven,
    todoRel,
  } = view;

  console.log(
    opts.force
      ? "Setup complete — discern is set up here (recorded with --force; the gate was not proven)."
      : "Setup complete — nice work! discern is now wired into this project and your quality gate is green.",
  );
  console.log(
    "The one-time setup is finished, so `discern setup` retires and hides itself from here on.",
  );
  if (forced) {
    console.log(
      `(Marked complete with --force despite ${leftover.length} file(s) still carrying skeleton markers.)`,
    );
  }
  if (markerCommit.state === "committed") {
    console.log("Committed the completion marker (discern.toml).");
  } else if (markerCommit.state === "skipped") {
    console.log(
      "Commit the updated discern.toml — it carries the completion marker, but discern could not prove that was the only discern.toml change to auto-commit.",
    );
  } else if (markerCommit.state === "failed") {
    console.log(
      `Commit the updated discern.toml yourself — it carries the completion marker, but discern's auto-commit failed. Git said: ${markerCommit.detail}`,
    );
  }

  // The honest coverage summary (A12) — so "gate proven" can't read as "every
  // protection runs".
  console.log("");
  console.log(verdictSentence(assurance));
  for (const line of assuranceLines(assurance)) {
    console.log(line);
  }
  if (assurance.verdict !== "full") {
    console.log(
      '  (absent = no such command wired; deferred = deliberately off. Wire one with `discern config set-capability <name> "<command>"`.)',
    );
  }

  // The worktree-viability proof (ADR 0090) — shown only when it actually ran green, so
  // a worktrees-off or skipped run never claims coverage it didn't earn.
  if (worktreeProven) {
    console.log("");
    console.log(
      "Proved your project runs inside a worktree — the isolated copy every future task uses.",
    );
  }

  // The ordered follow-ups (A11): land → reactivate → deepen.
  console.log("");
  console.log("What's next:");
  for (const line of landStep(landing, 1)) {
    console.log(line);
  }
  console.log(`  2. Reactivate discern's tools — ${reactivation.summary}`);
  for (const a of reactivation.per_agent) {
    console.log(`       • ${a.label}: ${a.step}`);
  }
  console.log(
    `  3. Deepen your setup: run \`discern ${coachVerb} --json\` (the project coach),`,
  );
  console.log(
    "     review the findings with your human, do the quick wins now, and defer larger",
  );
  console.log(`     initiatives to ${todoRel}.`);

  // The ready-to-relay completion message, carried verbatim (identical to the `--json`
  // `guidance` field) so a courier agent can hand the human a warm close (ADR 0086).
  console.log("");
  console.log(guidance);
}

/**
 * `discern setup done` — validate structural completeness AND prove the gate green
 * (ADR 0065/0078), then record `[meta].bootstrapped = true` so the setup redirect
 * retires and the command hides itself. Completeness is two layers: no skeleton
 * marker may remain, AND every derived per-step completion check must pass (ADR
 * 0078) — the latter catches a skeleton whose marker was deleted without the file
 * being meaningfully filled (the shallow-compliance failure). The proof — `refresh`
 * → `doctor` → `finish` — then makes the gate's definition-of-done structural:
 * completion can't be recorded unless the install is healthy and the gate actually
 * passes. `--force` is the manual-setup escape hatch: it skips the completeness
 * checks AND the proof.
 */
export async function runSetupDone(opts: SetupDoneOptions): Promise<number> {
  const root = await rootOrError(opts.json, "setup done");
  if (root === undefined) {
    return 1;
  }

  // Structural completeness: no scaffolded doc (or the guidance source) may still
  // carry a marker, AND every derived per-step check must pass (ADR 0078). The
  // checks SUPPLEMENT the marker walk — they catch a skeleton whose marker was
  // cleared without the file being filled. `--force` skips both.
  const leftover = await findSkeletonMarkers(root);
  const unmet = opts.force ? [] : await unmetSetupChecks(root);

  if (!opts.force && (leftover.length > 0 || unmet.length > 0)) {
    emitSetupIncomplete(opts.json, leftover, unmet);
    return 1;
  }

  // The structural completion proof (ADR 0065/0090): refresh → doctor → finish must
  // pass, THEN the project must prove viable in a linked worktree, before completion is
  // recorded — so "the gate is real" can't be reported without being true, and "my app
  // broke in the copy" can't arrive weeks later. `--force` is the escape hatch — it skips
  // the whole proof, the probe included. `worktreeProven` stays false when the probe was
  // skipped (worktrees off, uncreatable, or forced), so the report never over-claims.
  let worktreeProven = false;
  if (!opts.force) {
    const proof = await proveGateGreen(root, opts.json);
    if (!proof.ok) {
      return proof.exitCode; // already emitted; [meta].bootstrapped is NOT recorded
    }
    worktreeProven = proof.worktreeProven;
  }

  // Record the marker, comment-preserving (mirrors `discern config set --bool`).
  const path = (await resolveConfigPath(root)) ?? join(root, CONFIG_REL);
  const editor = new TomlEditor(await Deno.readTextFile(path));
  editor.setBool(BOOTSTRAPPED_KEY, true);
  await Deno.writeTextFile(path, editor.toString());

  // Commit the marker on the agent's behalf when discern.toml's HEAD diff is exactly
  // that marker, so setup doesn't end with the completion marker left uncommitted
  // (fail open otherwise — see commitCompletionMarker).
  const markerCommit = await commitCompletionMarker(root, path);

  const forced = leftover.length > 0;

  // Celebrate, assure, and steer (A11/A12). The agent files, MCP servers, and session
  // hooks were wired at `begin` but coding agents load them at SESSION START, so this
  // session can't see them yet — hence the reactivation handoff (ADR 0075). Alongside
  // it: an honest per-capability coverage summary (so "gate proven" can't read as "every
  // protection runs"), where the just-finished work lives + how to land it on the
  // integration branch, and a steer into ongoing use via the project coach.
  const cfg = await loadConfig(root);
  const rawToml = await Deno.readTextFile(path);
  const assurance = assessSetupAssurance(cfg, rawToml);
  const landing = await landingSummary(root, cfg);
  const reactivation = reactivationHandoff(cfg);
  // Resolve the coach verb from the live engine-verb SSOT (improve, or audit before the
  // rename) rather than hardcoding, so the steer survives the audit→improve rename.
  const coachVerb = KNOWN_ENGINE_VERBS.has("improve") ? "improve" : "audit";
  // The closing relay block — the ready-to-relay "message to your human" a courier agent
  // hands over, composed from the same pieces the structured surface carries (ADR 0086),
  // and rendered identically on both surfaces.
  const guidance = completionMessage({ assurance, landing, reactivation });

  if (opts.json) {
    const data: SetupDoneData = {
      bootstrapped: true,
      forced,
      gate_proven: !opts.force,
      worktree_proven: worktreeProven,
      marker_committed: markerCommit.state === "committed",
      ...(markerCommit.state === "failed"
        ? { marker_commit_error: markerCommit.detail }
        : {}),
      leftover,
      assurance,
      landing: {
        in_repo: landing.inRepo,
        branch: landing.branch,
        target: landing.target,
        on_target: landing.onTarget,
        command: LAND_COMMAND,
      },
      reactivation,
      coach: { verb: coachVerb, command: `discern ${coachVerb} --json` },
      guidance,
    };
    emitResult({
      ok: true,
      verb: "setup done",
      hints: doneHints(landing, reactivation, coachVerb, cfg.project.todo),
      data,
    });
    return 0;
  }

  printDoneSuccess({
    opts,
    forced,
    leftover,
    markerCommit,
    assurance,
    landing,
    reactivation,
    coachVerb,
    guidance,
    worktreeProven,
    todoRel: cfg.project.todo,
  });
  return 0;
}

/** The outcome of the completion proof: a failure (already emitted) with its exit code,
 * or success carrying whether the worktree probe actually proved viability — the honest
 * signal the completion report renders (ADR 0090). */
type GateProof =
  | { ok: false; exitCode: number }
  | { ok: true; worktreeProven: boolean };

/**
 * Run the completion proof `discern setup done` requires before recording
 * `[meta].bootstrapped` (ADR 0065/0090): `refresh` (so the generated agent files are
 * current), then `doctor` (the install is healthy), then `finish` (the gate is green
 * with whatever capabilities were just wired) — all in the main checkout — then a
 * WORKTREE PROBE proving the project is also viable in a linked worktree, the copy
 * every future task runs in (the main checkout being the one place agents are told
 * never to work). The cores run BELOW the router/MCP setup gate, so they execute
 * even though setup isn't recorded yet — the "setup bypass" is automatic. Returns a
 * failure (already emitted) with its exit code, or success carrying whether the probe
 * actually proved viability.
 */
async function proveGateGreen(
  root: string,
  json: boolean,
): Promise<GateProof> {
  // 1. refresh — recompile the agent files + skills so finish's currency check sees
  //    a current tree (the agent likely edited guidance.md and the docs just now).
  try {
    const refreshed = await compileGuidelines(
      root,
      new Logger({ json, noColor: false, humanStream: "stdout" }),
    );
    const errors = guidanceRefreshErrors(refreshed);
    if (errors.length > 0) {
      return {
        ok: false,
        exitCode: emitDoneGateFailure(
          json,
          "refresh",
          `guidance refresh did not fully complete: ${errors.join("; ")}`,
        ),
      };
    }
  } catch (error) {
    return {
      ok: false,
      exitCode: emitDoneGateFailure(
        json,
        "refresh",
        `could not compile the agent guidance: ${errMsg(error)}`,
      ),
    };
  }

  // 2. doctor — the install must be healthy (capability commands resolvable, the
  //    configured agents known, the gotchas doc resolving, …).
  if (!(await doctorResult(root)).ok) {
    return {
      ok: false,
      exitCode: emitDoneGateFailure(
        json,
        "doctor",
        "the install has problems; run `discern doctor` and fix what it flags",
      ),
    };
  }

  // 3. finish — the gate must be green with the capabilities the agent wired.
  if (!(await finishResult(root)).ok) {
    return {
      ok: false,
      exitCode: emitDoneGateFailure(
        json,
        "finish",
        "the quality gate is not green; run `discern finish`, fix the failures, then re-run",
      ),
    };
  }

  // 4. worktree probe — the gate is green HERE, but here is the main checkout. Prove it
  //    is green in a worktree too (ADR 0090), so an env-anchored app can't pass setup
  //    and then break on the first real task.
  return await proveWorktreeViable(root, json);
}

/**
 * The final leg of the completion proof (ADR 0090): the gate passed in the main
 * checkout, but that is the one place agents never work. Prove the project is ALSO
 * viable inside a linked worktree — the copy every future task runs in — by creating a
 * throwaway probe worktree exactly as `discern start` would (branching from the current
 * unlanded `discern-setup` HEAD, not `main`), running the finish core inside it, and
 * tearing it down win or lose. A red probe blocks `done` with the `worktree_probe`
 * stage: either the worktree could not ready itself (broken `[worktree].steps`/`ensure`/
 * resources), or the gate failed only in the copy (something the app needs — an
 * untracked env file, an uninstalled dependency dir — didn't travel). An
 * uncreatable probe (e.g. an unborn branch) is an honest
 * skip, not a failure. Returns whether viability was actually proven, for the report.
 */
async function proveWorktreeViable(
  root: string,
  json: boolean,
): Promise<GateProof> {
  const cfg = await loadConfig(root);
  const log = new Logger({ json, noColor: false, humanStream: "stdout" });
  log.info("Proving your project runs inside a worktree (a throwaway copy)…");
  const outcome = await probeWorktreeViability(
    await lifecycleContext(root, log),
    resolveWorktreeRoot(root, cfg),
    async (probeDir) => {
      const r = await finishResult(probeDir);
      if (r.ok) {
        return { ok: true };
      }
      const detail = r.diagnostics?.[0]?.message ??
        "the quality gate was red in the copy";
      return { ok: false, detail };
    },
  );

  switch (outcome.kind) {
    case "probed":
      if (outcome.ok) {
        return { ok: true, worktreeProven: true };
      }
      return {
        ok: false,
        exitCode: emitDoneGateFailure(
          json,
          "worktree_probe",
          `the gate is not green inside a fresh worktree — ${
            outcome.detail ?? "the copy is not viable"
          }. Something the app needs doesn't survive into a copy (an untracked env file, an uninstalled dependency dir); wire [worktree].steps / ensure / resources so a worktree is viable, then re-run`,
        ),
      };
    case "setup_failed":
      return {
        ok: false,
        exitCode: emitDoneGateFailure(
          json,
          "worktree_probe",
          `the project could not set itself up in a fresh worktree — ${outcome.reason}. Fix its [worktree].steps / ensure / resources so a copy readies cleanly, then re-run`,
        ),
      };
    case "uncreatable":
      // Couldn't create a probe (e.g. an unborn branch) — not the app's fault. Report it
      // un-proven rather than blocking; the first real `discern finish` in a worktree
      // will prove it.
      log.info(
        `Skipped the worktree probe (${outcome.reason}); your first \`discern finish\` in a worktree will prove it.`,
      );
      return { ok: true, worktreeProven: false };
  }
}

/**
 * Emit a `setup done` completion-proof failure (naming the gate step that failed)
 * and return exit 1. `[meta].bootstrapped` is left unrecorded, so `status` keeps
 * reporting setup as unfinished until the proof passes (or `--force` overrides it).
 */
function emitDoneGateFailure(
  json: boolean,
  stage: "refresh" | "doctor" | "finish" | "worktree_probe",
  detail: string,
): number {
  const message = `setup is not finished — ${detail}.`;
  if (json) {
    emitResult({
      ok: false,
      verb: "setup done",
      error: "gate_failed",
      message,
      data: { stage },
    });
  } else {
    console.error(`discern: ${message}`);
    console.error(
      `       (\`discern setup done\`'s completion proof is refresh → doctor → finish, then a worktree probe; the ${stage} step failed.)`,
    );
    console.error(
      "       Fix it and re-run, or pass --force to record completion without the proof.",
    );
  }
  return 1;
}

/**
 * Refuse a fresh, non-declarative `begin` that arrived without `--confirmed`, re-serving
 * the SAME consent message `verify` serves (single-sourced via {@link consentMessage})
 * plus the exact command to run once the human has answered. The refusal is the teaching
 * path (ADR 0086): rather than scaffold silently, discern hands an agent that skipped the
 * handshake the conversation to hold. Exit 1; nothing is written. Both surfaces carry the
 * identical `guidance` prose, so a courier agent gets the message to relay whichever it
 * reads.
 */
async function emitAwaitingConsent(
  log: Logger,
  opts: SetupOptions,
  destDir: string,
): Promise<number> {
  const guidance = consentMessage(await deriveConsentContext(destDir));
  const command = confirmedBeginCommand();
  const message =
    "Setup needs your human's consent before it writes anything. Relay the message below, wait for their answers, then re-run `begin` with --confirmed.";
  if (opts.json) {
    log.result({
      ok: false,
      verb: "setup",
      error: "awaiting_consent",
      message,
      data: { guidance, command },
    });
  } else {
    // Everything on stdout — the channel the agent reads — so the served message it
    // relays and the command it runs after both land where it is looking.
    console.log(message);
    console.log("");
    console.log(guidance);
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

/** The `{{token}}` → value map the skeleton copies render against — the project
 * name plus the configured source paths, so skeleton prose that names its own
 * home (or its siblings) always names the CONFIGURED location, never a literal. */
type SkeletonTokens = Readonly<Record<string, string>>;

/** Copy one text file, substituting each skeleton token, creating parent dirs. */
async function copyTextSubstituting(
  src: string,
  dest: string,
  tokens: SkeletonTokens,
): Promise<void> {
  let text = await Deno.readTextFile(src);
  for (const [token, value] of Object.entries(tokens)) {
    text = text.replaceAll(token, value);
  }
  await ensureDir(dirname(dest));
  await Deno.writeTextFile(dest, text);
}

/** Recursively copy a skeleton subtree into the project, substituting tokens per file. */
async function copyTreeSubstituting(
  srcDir: string,
  destDir: string,
  tokens: SkeletonTokens,
): Promise<void> {
  for await (const entry of walk(srcDir, { includeDirs: false })) {
    const rel = relative(srcDir, entry.path);
    await copyTextSubstituting(entry.path, join(destDir, rel), tokens);
  }
}
