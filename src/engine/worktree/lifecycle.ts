/**
 * The worktree lifecycle entry points — worktree setup, ensure, accept,
 * teardown, and prune. These compose the identity, resource, and git layers into
 * the operations the dispatcher exposes as `discern worktree setup`, `discern accept`,
 * and the `worktree` command group.
 *
 * Per-worktree external resources ([worktree.resources.<name>].create/destroy)
 * are project-supplied command strings run via `sh -c` after `@…@` token
 * expansion (see ./resources.ts). They are created once at setup (a `required`
 * create is fatal — a broken setup must be loud), destroyed once at teardown
 * (best-effort — a hiccup must never strand a worktree; a later prune is the
 * backstop), and reclaimed by prune when a worktree vanishes without a clean
 * teardown. [worktree.setup].steps run once at creation, stopping at the first
 * failure; [repository].ensure re-runs checkout-generic convergence on every
 * pass and after landing, while [worktree.setup].ensure re-runs only in linked
 * worktrees for identity-dependent convergence.
 */

import {
  basename,
  dirname,
  isAbsolute,
  join,
  relative,
  resolve,
} from "@std/path";
import { type Logger, loggerSink } from "../../lib/log.ts";
import { adrIndexState } from "../../lib/adr_index.ts";
import {
  canInteract,
  confirmDestructiveAction,
  plainModeEnabled,
} from "../../lib/terminal_interaction.ts";
import { type DiscernConfig, loadConfig } from "../../shared/config_schema.ts";
import { DISCERN_ENVIRONMENT_VARIABLES } from "../../shared/environment_variables.ts";
import {
  generatedGroupForPath,
  type ResolvedGeneratedGroup,
  resolveGeneratedGroups,
} from "../../shared/generated_artifacts.ts";
import {
  deriveIdentity,
  generateWorktreeId,
  IdentityError,
  type IdentitySettings,
  loadIdentitySettings,
  resolveWorktreeId,
  resourceForId,
  worktreeBase,
  type WorktreeField,
  type WorktreeIdentity,
} from "./identity.ts";
import {
  hasIgnoredFileChanges,
  inspectIgnoredFileChanges,
  recordIgnoredFileBaseline,
} from "./ignored.ts";
import { runShellRouted } from "./shell.ts";
import {
  type JobGroup,
  planStageJobs,
  serializeJobSteps,
} from "../gate/plan.ts";
import {
  gateRunContext,
  resolveGateRunPolicy,
  runJobGroups,
} from "../gate/execute.ts";
import { type GitResult, runGit } from "../../shared/subprocess.ts";
import { parsePorcelainZ } from "../../shared/git_paths.ts";
import {
  AWAITING_CONSENT_SLUG,
  type LandingConsent,
} from "../../shared/consent.ts";
import {
  AWAITING_DECLARATION_SLUG,
  AWAITING_VARIANCE_SLUG,
} from "../../shared/declarations.ts";
import { markdownCodeSpan } from "../../shared/markdown_code.ts";
import {
  type AcceptanceCheckpointState,
  inspectAcceptanceCheckpoints,
  resolveVarianceInterlock,
  type StandingUnmetConclusion,
  varianceBinding,
} from "./acceptance_checkpoints.ts";
import {
  classifyOrphans,
  createResources,
  destroyResources,
  ensureResources,
  entriesForWorktree,
  gcPlannedOrphanResources,
  type GcResult,
  type LedgerItem,
  listEntries,
  readResourceSpecs,
  recordResourceEnv,
} from "./resources.ts";
import {
  type AcceptPlan,
  acceptPlanToEngine,
  type DropPlan,
  dropPlanToEngine,
  FULL_REFRESH_STEP_NOTE,
  type PrunePlan,
  prunePlanIsEmpty,
  prunePlanToEngine,
  type SetupPlan,
  setupPlanToEngine,
  type SetupStepDesc,
  startPlanToEngine,
  type TeardownPlan,
  teardownPlanToEngine,
  type UpdatePlan,
  updatePlanToEngine,
} from "./plan.ts";
import {
  appliedResult,
  BUILT_IN_STEP_LABELS,
  type BuiltInStepLabel,
  type Diagnostic,
  dimBlock,
  type DiscernResult,
  type EnginePlan,
  previewResult,
  renderPlan,
  renderStepResults,
  type StepOutcome,
  type StepResult,
  verbatimStepLabel,
} from "../../shared/result.ts";
import {
  observeCheckpointActivity,
  observeResult,
} from "../../shared/result_capture.ts";
import {
  declarationIsCurrent,
  readOpenQuestions,
} from "../checkpoints/open_questions.ts";
import type {
  AcceptanceEvidenceData,
  AcceptData,
  AcceptLandingState,
  AcceptProofNoteData,
  AuthorizedVarianceData,
  GateData,
  Proof,
  StartData,
  UpdateData,
} from "../../shared/result_schemas.ts";
import { emitResult } from "../../shared/emit.ts";
import {
  fire,
  type FiredHint,
  hasRegisteredActionableHint,
  HINTS,
  hintTexts,
  interactiveHintTexts,
  mergeHintTexts,
} from "../../shared/hints.ts";
import {
  addWorktree,
  assertMainMerged,
  assertOpSide,
  branchIsMerged,
  commitUpdateRegeneration,
  ensureWorktreeBranch,
  hasAnyCommit,
  hasUncommittedTrackedChanges,
  inheritMainEnvVars,
  inLinkedWorktree,
  integrationBranch,
  integrationDelta,
  listWorktreeFleet,
  liveWorktreeGitKeys,
  liveWorktreePaths,
  localBranchExists,
  mainRepoPath,
  missingIntegrationBranchWarning,
  overlapPaths,
  pruneGitWorktrees,
  pruneStaleWorktreeMetadata,
  readySentinelPath,
  refMergedState,
  registeredWorktreeRecord,
  removeWorktreeSafely,
  repoToplevel,
  resolveCommitRef,
  resolveCommonGitDir,
  resolveIntegrationAnchors,
  scanGitWorktreesForPrune,
  scanOrphanWorktreesForSweep,
  sweepOrphanWorktrees,
  updateMain,
  WorktreeGitError,
  worktreeGitKey,
  worktreeSetupComplete,
  writeWorktreeEnvVar,
} from "./git.ts";
import {
  type ContainedWorktree,
  containmentIdleCheck,
  scanContainedWorktrees,
  treeProvablyClean,
} from "./containment.ts";
import { readFleetLogbookActivity } from "../logbook/read.ts";
import { configEpoch } from "../logbook/epoch.ts";
import {
  pruneReappearedWorktreePaths,
  type ReappearedWorktreePathPruneResult,
  scanReappearedWorktreePaths,
} from "./retired_paths.ts";
import {
  deleteDropBranchAtCommit,
  preserveDropRecoveryRef,
} from "./recovery_refs.ts";

// worktree setup recompiles the agent instructions as its final step — which also
// materializes skills into .claude/skills/ inside the freshly created worktree (a
// linked worktree does not inherit that gitignored directory from the main checkout).
import {
  compileInstructions,
  instructionRefreshErrors,
  type InstructionsResult,
  materializeLocalRefreshArtifacts,
} from "../instructions.ts";
import { agentFilePaths, renderAgentFiles } from "../instruction_render.ts";
import {
  planTrackedRefresh,
  type TrackedRefreshPlan,
} from "../tracked_refresh.ts";
import { resolveTemplatesDir } from "../../lib/paths.ts";
import {
  DISCERN_GENERATED_MERGE_DRIVER,
  planDiscernGitattributesBlock,
} from "../../lib/agent_gitattributes.ts";
// accept validates the exact tree it lands by running the full gate at the landing
// boundary (ADR 0067) — fast-pathed by a gate proof when nothing changed since
// the agent's own `done`, so a clean-merging but gate-breaking `update` (or any
// tree never run through `done`) cannot fast-forward onto the trunk unvalidated.
import { finishResult } from "../gate/finish.ts";
import { inspectGateProof, pinValidatedTree } from "../gate/proof.ts";
import { renderLandingProofLine } from "../gate/proof_render.ts";
import {
  proofNotesFetchSucceeded,
  reconcileProofNotesFetch,
  writeProofNote,
} from "../gate/proof_notes.ts";
// update classifies the merge's incoming files into the project's scopes for its
// "what landed beneath you" summary (ADR 0064), via the same matcher the gate uses.
import { scopesForPaths } from "../scopes/scopes.ts";
import {
  inspectLandingAuthority,
  landingAuthorityDetail,
  landingAuthorityExpiry,
  type LandingAuthorityResolution,
  prospectiveLandingAuthorityProjection,
  uncoveredLandingAuthorityDetails,
} from "./landing_authority.ts";
import { clearEffortGrant } from "./effort_grant_cleanup.ts";
import {
  inspectInterruptedAcceptance,
  performAcceptanceTransition,
  recoverInterruptedAcceptance,
  withAcceptanceTransactionLock,
} from "./acceptance_transaction.ts";

/**
 * Worktree lifecycle verbs that require discern's project root to be the Git
 * repository root. A linked worktree always checks out the whole repository,
 * so a nested project root cannot safely create or land one.
 */
export const WORKTREE_LIFECYCLE_REPO_ROOT_VERBS = [
  "start",
  "accept",
] as const;

type WorktreeLifecycleRepoRootVerb =
  (typeof WORKTREE_LIFECYCLE_REPO_ROOT_VERBS)[number];

/** Context shared by every lifecycle operation. */
export interface LifecycleContext {
  /** The project root (holds `discern.toml`). */
  root: string;
  /** The parsed project config. */
  config: DiscernConfig;
  /** The logger for human output. */
  log: Logger;
  /** The directory the operation runs from (default: the project root). */
  cwd: string;
}

/** Build a lifecycle context, loading config from `root`. `cwd` defaults to `root`. */
export async function lifecycleContext(
  root: string,
  log: Logger,
  cwd: string = root,
): Promise<LifecycleContext> {
  return { root, config: await loadConfig(root), log, cwd };
}

/** Flags shared by every effectful worktree verb: preview and quiet result output. */
export interface WorktreeOpOptions {
  /** Show the plan and touch nothing. */
  dryRun?: boolean;
  /** Emit one structured result on stdout. */
  json?: boolean;
  /** Render the human apply summary (internal protocol callers may reserve stdout). */
  humanApplySummary?: boolean;
}

/** `accept`'s flags: the worktree-verb set plus the landing consent attestation
 * (ADR 0134). `confirmed` asserts the owner accepted this landing in the current
 * conversation. Recorded standing and effort grants are checked directly.
 * It lives on accept alone — the other worktree verbs are not consent-gated.
 * `variance` names each declared-unmet checkpoint the owner authorizes landing
 * (repeatable); the set must equal the current declared-unmet set exactly. */
export interface AcceptOpOptions extends WorktreeOpOptions {
  confirmed?: boolean;
  variance?: string[];
}

/**
 * Emit a built plan as a `--dry-run` — human listing (through the shared renderer)
 * or, in `--json` mode, the plan JSON on stdout. Touches nothing. The single fork
 * every worktree verb funnels its dry-run through.
 */
function emitDryRun(
  ctx: LifecycleContext,
  verb: string,
  plan: EnginePlan,
  json: boolean,
): void {
  if (json) {
    emitResult(previewResult(verb, plan));
    return;
  }
  renderPlan(loggerSink(ctx.log), plan);
}

/** Choose the human result heading for each worktree lifecycle verb. */
function applyResultTitle(verb: string): string {
  switch (verb) {
    case "start":
      return "Start results";
    case "update":
      return "Update results";
    case "accept":
      return "Acceptance results";
    case "worktree setup":
      return "Worktree setup results";
    case "worktree teardown":
      return "Worktree teardown results";
    case "worktree prune":
      return "Worktree prune results";
    default:
      return `${verb} results`;
  }
}

interface WorktreeResultRenderHooks<TData> {
  afterPlan?: ((result: DiscernResult<TData>) => void) | undefined;
  afterApply?: ((result: DiscernResult<TData>) => void) | undefined;
}

/**
 * Render one result object on the requested surface. Dry-runs use the shared plan
 * renderer; applies use the shared StepResult renderer, so the human summary and
 * `--json` agree on the settled step list.
 */
function emitOrRenderWorktreeResult<TData>(
  ctx: LifecycleContext,
  result: DiscernResult<TData>,
  json: boolean,
  hooks: WorktreeResultRenderHooks<TData> = {},
): void {
  observeResult(result);
  if (json) {
    emitResult(result);
    return;
  }
  if (result.dry_run === true && result.plan !== undefined) {
    renderPlan(loggerSink(ctx.log), result.plan);
    hooks.afterPlan?.(result);
    return;
  }
  renderStepResults(loggerSink(ctx.log), {
    title: applyResultTitle(result.verb),
    steps: result.steps ?? [],
  });
  if (!result.ok) {
    const hints = interactiveHintTexts(result.hints);
    if (hints.length > 0) ctx.log.group("next");
    for (const hint of hints) ctx.log.info(hint);
  }
  hooks.afterApply?.(result);
}

/** Resolve this worktree's full identity (and the settings it derived from) from
 * the context's cwd. */
async function resolveContextIdentity(
  ctx: LifecycleContext,
): Promise<{ identity: WorktreeIdentity; settings: IdentitySettings }> {
  const settings = await loadIdentitySettings(ctx.root);
  const id = await resolveWorktreeId(settings, ctx.cwd);
  return { identity: deriveIdentity(id, settings), settings };
}

/**
 * Tear down this worktree's external resources — every ledger entry for this
 * worktree, destroyed in reverse creation order. Best-effort and non-fatal: a
 * teardown hiccup must never strand a worktree (a later `worktree prune` is the
 * backstop). A no-op when nothing was created. Run from inside the worktree (so
 * `@dir@`-bearing destroys still resolve).
 */
async function teardownResources(
  ctx: LifecycleContext,
): Promise<{ destroyed: string[]; failed: string[] }> {
  const { entries } = await buildTeardownPlan(ctx);
  return await destroyResources(ctx, entries);
}

/** Read this worktree's teardown plan — the ledger entries it would destroy, in
 * destruction order. Read-only; `[]` when the git identity can't be resolved. */
async function buildTeardownPlan(ctx: LifecycleContext): Promise<TeardownPlan> {
  const commonGitDir = await resolveCommonGitDir(ctx.cwd);
  const gitKey = await worktreeGitKey(ctx.cwd);
  if (commonGitDir === undefined || gitKey === undefined) {
    return { entries: [] };
  }
  return { entries: await entriesForWorktree(commonGitDir, gitKey) };
}

// The per-worktree ready sentinel (`discern/worktree-ready`) lives in the git
// layer now — `readySentinelPath` / `worktreeSetupComplete` — shared with
// status's broken-worktree flag, so "is this worktree configured?" has one read.

/** Record the deterministic port in this worktree's env files, or report it. */
async function recordPort(
  ctx: LifecycleContext,
  identity: WorktreeIdentity,
): Promise<void> {
  if (!ctx.config.worktree.port) {
    return;
  }
  const port = String(identity.port);
  const wrote = await writeWorktreeEnvVar(
    ctx.cwd,
    DISCERN_ENVIRONMENT_VARIABLES.worktreePort,
    port,
    ctx.config.worktree.env_files,
  );
  ctx.log.ok(
    wrote
      ? `Worktree dev-server port: ${port} (recorded in the worktree's env file).`
      : `Worktree dev-server port: ${port} (read it via: discern identity --port).`,
  );
}

/**
 * Build the worktree-setup plan: the steps setup would perform, derived from the
 * config and the resolved identity. Read-only — it resolves the branch name
 * without creating it, so a `--dry-run` preview touches nothing.
 */
async function buildSetupPlan(ctx: LifecycleContext): Promise<SetupPlan> {
  const settings = await loadIdentitySettings(ctx.root);
  const id = await resolveWorktreeId(settings, ctx.cwd);
  const identity = deriveIdentity(id, settings);
  const current = (await makeGitRunner(ctx)(["branch", "--show-current"]))
    .stdout.trim();
  const branch = current !== "" ? current : identity.branch;

  const steps: SetupStepDesc[] = [
    { kind: "git", label: BUILT_IN_STEP_LABELS.ensureBranch, note: branch },
  ];
  if (
    !(await worktreeSetupComplete(ctx.cwd)) &&
    await generatedMergeDriverNeeded(ctx)
  ) {
    steps.push({
      kind: "git",
      label: BUILT_IN_STEP_LABELS.configureGeneratedMergeDriver,
      note: `merge.${DISCERN_GENERATED_MERGE_DRIVER}.driver=true (worktree)`,
    });
  }
  if (ctx.config.worktree.inherit_env.length > 0) {
    steps.push({
      kind: "env",
      label: BUILT_IN_STEP_LABELS.inheritEnv,
      note: ctx.config.worktree.inherit_env.join(", "),
    });
  }
  for (const spec of readResourceSpecs(ctx.config)) {
    if (spec.create !== "" || spec.destroy !== "") {
      steps.push({
        kind: "resource-create",
        label: verbatimStepLabel(spec.name),
        note: resourceForId(settings.slug, id, spec.name),
      });
    }
  }
  if (ctx.config.worktree.port) {
    steps.push({
      kind: "env",
      label: BUILT_IN_STEP_LABELS.recordPort,
      note: String(identity.port),
    });
  }
  for (const step of ctx.config.worktree.setup.steps) {
    steps.push({ kind: "setup-step", label: verbatimStepLabel(step) });
  }
  for (const step of ctx.config.repository.ensure) {
    steps.push({ kind: "repository-ensure", label: verbatimStepLabel(step) });
  }
  for (const step of ctx.config.worktree.setup.ensure) {
    steps.push({ kind: "setup-ensure", label: verbatimStepLabel(step) });
  }
  steps.push({
    kind: "refresh",
    label: BUILT_IN_STEP_LABELS.completeRefresh,
  });
  return { branch, steps };
}

/** Report whether this worktree needs the generated-artifact merge driver. */
async function generatedMergeDriverNeeded(
  ctx: LifecycleContext,
): Promise<boolean> {
  const attributes = await planDiscernGitattributesBlock(
    ctx.root,
    ctx.config,
    agentFilePaths(ctx.config),
  );
  return attributes.patterns.length > 0;
}

/** Install the worktree-local driver that keeps current generated artifacts. */
async function installGeneratedMergeDriver(
  ctx: LifecycleContext,
): Promise<void> {
  const run = makeGitRunner(ctx);
  const commands: readonly string[][] = [
    ["config", "--local", "extensions.worktreeConfig", "true"],
    [
      "config",
      "--worktree",
      `merge.${DISCERN_GENERATED_MERGE_DRIVER}.driver`,
      "true",
    ],
  ];
  for (const args of commands) {
    const result = await run(args);
    if (result.success) {
      continue;
    }
    const detail = result.stderr.trim() || result.stdout.trim();
    throw new WorktreeGitError(
      `Discern could not configure the generated-artifact merge driver in this worktree${
        detail === "" ? "." : `: ${detail}`
      } Re-run \`discern worktree setup\` after correcting the Git configuration.`,
    );
  }
}

/**
 * Map the EXECUTED setup plan to `--json` results — recording what actually
 * happened, not a synthesized all-`ok`. A fatal step (a required resource, a
 * `setup.steps` non-zero exit, a fresh-creation `setup.ensure` failure) throws
 * before this is reached; the steps that warn-and-continue are reported honestly: a
 * non-required resource whose create failed, an agent-file refresh that threw, or a
 * re-entry `setup.ensure` command that exited non-zero, is `failed`, not `ok`. The
 * plan is the one built before execution (never re-derived), so the reported steps
 * can't drift from what the dry-run previewed.
 */
function setupResults(
  plan: SetupPlan,
  failedResources: string[],
  refreshOk: boolean,
  repositoryEnsureOutcomes: StepOutcome[],
  worktreeEnsureOutcomes: StepOutcome[],
): StepResult[] {
  let repositoryEnsureIndex = 0;
  let worktreeEnsureIndex = 0;
  return plan.steps.map((s) => {
    const repositoryEnsureOutcome = s.kind === "repository-ensure"
      ? repositoryEnsureOutcomes[repositoryEnsureIndex++]
      : undefined;
    const worktreeEnsureOutcome = s.kind === "setup-ensure"
      ? worktreeEnsureOutcomes[worktreeEnsureIndex++]
      : undefined;
    const failed = (s.kind === "resource-create" &&
      failedResources.includes(s.label)) ||
      repositoryEnsureOutcome === "failed" ||
      worktreeEnsureOutcome === "failed" ||
      (s.kind === "refresh" && !refreshOk);
    return {
      step: { kind: s.kind, label: s.label, disposition: "run", note: s.note },
      outcome: failed ? "failed" : "ok",
    };
  });
}

/** One convergence bucket's ordered outcomes and serialized recovery evidence. */
interface EnsureCommandRun {
  readonly outcomes: StepOutcome[];
  readonly diagnostics: Diagnostic[];
  readonly hints: string[];
}

/** The identity element for merging convergence buckets into one result. */
function emptyEnsureCommandRun(): EnsureCommandRun {
  return { outcomes: [], diagnostics: [], hints: hintTexts([]) };
}

/** Fire the registered recovery instruction exactly when diagnostics exist. */
function ensureRecoveryHints(diagnostics: readonly Diagnostic[]): string[] {
  return diagnostics.length === 0
    ? hintTexts([])
    : hintTexts([fire(HINTS["lifecycle-convergence-failed"])]);
}

/** Preserve one failed ensure command as executable recovery evidence. */
function ensureFailureDiagnostic(
  scope: "repository" | "worktree",
  command: string,
  cwd: string,
  failure: string,
): Diagnostic {
  return {
    tool: `${scope}-ensure`,
    severity: "error",
    message:
      `The ${scope} convergence command ${failure} in ${cwd}. Fix the command or its prerequisites, then run it again from that checkout.`,
    reproduce_cmd: command,
  };
}

/** Record every planned command as failed when the runner itself throws. */
function failedEnsureCommandRun(
  commands: readonly string[],
  opts: {
    cwd: string;
    scope: "repository" | "worktree";
    failure: string;
  },
): EnsureCommandRun {
  const diagnostics = commands.map((command) =>
    ensureFailureDiagnostic(opts.scope, command, opts.cwd, opts.failure)
  );
  return {
    outcomes: commands.map(() => "failed"),
    diagnostics,
    hints: ensureRecoveryHints(diagnostics),
  };
}

/**
 * Run one ordered bucket of convergent checkout commands. `[repository].ensure`
 * is safe in any checkout; `[worktree.setup].ensure` may depend on a linked
 * worktree's identity and never reaches the main checkout. `fatal` selects the
 * failure contract: fresh setup stops on a non-zero exit; later lifecycle passes
 * retain each failure as a diagnostic and continue without undoing prior effects.
 * Duplicate commands remain distinct results, and an empty bucket is a no-op.
 */
async function runEnsureCommands(
  ctx: LifecycleContext,
  commands: string[],
  opts: {
    fatal: boolean;
    cwd: string;
    scope: "repository" | "worktree";
  },
): Promise<EnsureCommandRun> {
  const outcomes: StepOutcome[] = [];
  const diagnostics: Diagnostic[] = [];
  for (const step of commands) {
    const label = opts.scope === "repository"
      ? "Repository ensure step"
      : "Worktree ensure step";
    ctx.log.info(`${label}: ${step}`);
    const code = await runShellRouted(step, { cwd: opts.cwd, log: ctx.log });
    if (code !== 0) {
      if (opts.fatal) {
        throw new WorktreeGitError(
          `The ${opts.scope} ensure step failed: ${step}. Fix that command or its ` +
            `prerequisites, then re-run \`discern worktree setup\`.`,
        );
      }
      ctx.log.warn(`${label} failed (continuing): ${step}`);
      outcomes.push("failed");
      diagnostics.push(
        ensureFailureDiagnostic(
          opts.scope,
          step,
          opts.cwd,
          `exited ${code}`,
        ),
      );
    } else {
      outcomes.push("ok");
    }
  }
  return {
    outcomes,
    diagnostics,
    hints: ensureRecoveryHints(diagnostics),
  };
}

/** Shared checkout convergence, safe in a linked worktree or the main checkout. */
async function runRepositoryEnsureSteps(
  ctx: LifecycleContext,
  opts: { fatal: boolean; cwd?: string },
): ReturnType<typeof runEnsureCommands> {
  return await runEnsureCommands(ctx, ctx.config.repository.ensure, {
    fatal: opts.fatal,
    cwd: opts.cwd ?? ctx.cwd,
    scope: "repository",
  });
}

/** Worktree-identity-dependent convergence; never called in the main checkout. */
async function runWorktreeEnsureSteps(
  ctx: LifecycleContext,
  opts: { fatal: boolean },
): ReturnType<typeof runEnsureCommands> {
  return await runEnsureCommands(ctx, ctx.config.worktree.setup.ensure, {
    fatal: opts.fatal,
    cwd: ctx.cwd,
    scope: "worktree",
  });
}

/**
 * Resolve the source entrypoint exported by a discern checkout. The
 * local-development wrapper uses the same `deno.json` project identity; an
 * unrelated Deno project with a source entrypoint must never be executed as
 * discern.
 */
async function discernSourceEntrypoint(
  root: string,
): Promise<string | undefined> {
  if (Deno.build.standalone) {
    return undefined;
  }
  try {
    const manifest: unknown = JSON.parse(
      await Deno.readTextFile(join(root, "deno.json")),
    );
    if (
      typeof manifest !== "object" ||
      manifest === null ||
      !("name" in manifest) ||
      manifest.name !== "discern" ||
      !("exports" in manifest) ||
      typeof manifest.exports !== "string" ||
      !manifest.exports.startsWith("./")
    ) {
      return undefined;
    }
    const entrypoint = resolve(root, manifest.exports);
    return relative(root, entrypoint).startsWith("..") ||
        !(await pathPresent(entrypoint))
      ? undefined
      : entrypoint;
  } catch {
    return undefined;
  }
}

interface LifecycleRefreshRun {
  readonly ok: boolean;
  readonly diagnostics: Diagnostic[];
  readonly hints: string[];
}

/** Turn isolated refresh errors into diagnostics plus the registered retry hint. */
function failedRefreshRun(
  errors: readonly string[],
  cwd: string,
  existingHints: readonly string[] = hintTexts([]),
): LifecycleRefreshRun {
  const diagnostics = errors.map((error) => ({
    tool: "refresh",
    severity: "error" as const,
    message:
      `Refresh convergence failed in ${cwd}: ${error}. Fix the reported refresh error, then run discern refresh again from that checkout.`,
    reproduce_cmd: "discern refresh",
  }));
  return {
    ok: false,
    diagnostics,
    hints: mergeHintTexts(
      existingHints,
      hintTexts(
        errors.map((message) =>
          fire(HINTS["refresh-artifact-failed"], { message })
        ),
      ),
    ),
  };
}

/** Project the refresh compiler's partial-success report onto lifecycle evidence. */
function instructionRefreshRun(
  result: InstructionsResult,
  cwd: string,
): LifecycleRefreshRun {
  const errors = instructionRefreshErrors(result);
  return errors.length === 0
    ? { ok: true, diagnostics: [], hints: result.hints }
    : failedRefreshRun(errors, cwd, result.hints);
}

/**
 * Refresh a freshly checked-out worktree with the engine that checkout owns.
 *
 * Installed projects have no versioned engine source, so the running binary is
 * their one compiler and compiles in process. discern itself is different: its
 * branches carry `src/**` and `templates/**`. A `start --from <ref>` launched
 * from another checkout must therefore re-enter the new worktree's source
 * engine for this final composition step; otherwise the launcher can overwrite
 * committed agent files with its own older compiler or bundled instructions.
 */
async function refreshWorktreeArtifacts(
  ctx: LifecycleContext,
): Promise<LifecycleRefreshRun> {
  const sourceEntrypoint = await discernSourceEntrypoint(ctx.root);
  if (sourceEntrypoint === undefined) {
    const refreshed = await compileInstructions(ctx.root, ctx.log);
    return instructionRefreshRun(refreshed, ctx.root);
  }

  const setupDeno = DISCERN_ENVIRONMENT_VARIABLES.setupDeno;
  const setupConfig = DISCERN_ENVIRONMENT_VARIABLES.setupConfig;
  const setupMain = DISCERN_ENVIRONMENT_VARIABLES.setupMain;
  const code = await runShellRouted(
    `exec "$${setupDeno}" run --no-check --config ` +
      `"$${setupConfig}" -A "$${setupMain}" refresh`,
    {
      cwd: ctx.root,
      log: ctx.log,
      env: {
        [setupDeno]: Deno.execPath(),
        [setupConfig]: join(ctx.root, "deno.json"),
        [setupMain]: sourceEntrypoint,
        // A launcher-side override would recreate the same version skew. An
        // empty value makes the target engine resolve its templates module-
        // relatively, exactly as the local-development wrapper does.
        [DISCERN_ENVIRONMENT_VARIABLES.templatesDirectory]: "",
      },
    },
  );
  return code === 0
    ? { ok: true, diagnostics: [], hints: hintTexts([]) }
    : failedRefreshRun(
      [`the checkout-owned refresh command exited ${code}`],
      ctx.root,
    );
}

/**
 * Set up a linked worktree — the `worktree setup` command. Asserts the worktree
 * precondition, ensures a named branch, provisions the per-worktree resources (a
 * `required` create is fatal), inherits env vars, records the port + resource
 * handles into `.env`, runs the one-shot `[worktree.setup].steps`, then
 * checkout-shared `[repository].ensure`, then linked-worktree-only
 * `[worktree.setup].ensure`. It refreshes the agent files and drops the ready
 * sentinel. Throws on a fatal step. `--dry-run` shows the plan and touches nothing.
 *
 * Idempotent: when the worktree is already configured (the sentinel is present),
 * the non-idempotent phases are not repeated — resources are re-readied via
 * `ensure` rather than re-created, and the one-shot `steps` are skipped. The
 * convergent repository and worktree ensure buckets run on EVERY pass so a
 * re-fired `worktree create` hook or a re-run `discern worktree setup` re-converges the
 * worktree on the current tree.
 */
export async function worktreeSetup(
  ctx: LifecycleContext,
  opts: WorktreeOpOptions = {},
): Promise<void> {
  // 1. must be inside a worktree
  await assertOpSide("worktree-setup", ctx.cwd);

  // Build the plan ONCE — the dry-run renders it and the apply records its
  // outcomes against it, so the preview and the `--json` report can't drift.
  const plan = await buildSetupPlan(ctx);
  if (opts.dryRun ?? false) {
    emitDryRun(
      ctx,
      "worktree setup",
      setupPlanToEngine(plan),
      opts.json ?? false,
    );
    return;
  }

  ctx.log.heading("Setting up this worktree…");

  // 2. ensure a named branch (resolve identity first for its branch base)
  const settings = await loadIdentitySettings(ctx.root);
  const id = await resolveWorktreeId(settings, ctx.cwd);
  const identity = deriveIdentity(id, settings);
  await ensureWorktreeBranch(identity.branch, ctx.cwd);

  // Has this worktree already completed setup? The ready sentinel is the proof. The
  // two non-ensure callers — a re-fired `worktree create` hook and an explicit
  // `discern worktree setup` — reach here on an already-configured worktree, where the
  // non-idempotent phases (resource `create`, `[worktree.setup].steps`) must not
  // re-run. (`worktreeEnsure` gates the session-start path the same way.)
  const configured = await worktreeSetupComplete(ctx.cwd);

  if (!configured && await generatedMergeDriverNeeded(ctx)) {
    await installGeneratedMergeDriver(ctx);
  }

  // 3. inherit env vars from main — FIRST among the env writers, because it is
  // the one allowed to CREATE the worktree's env file (a declared value must
  // arrive in a fresh worktree); the resource and port recorders below only ever
  // update files that exist.
  await inheritMainEnvVars({
    worktreeRoot: ctx.cwd,
    vars: ctx.config.worktree.inherit_env,
    files: ctx.config.worktree.env_files,
    log: ctx.log,
  });

  // 4. provision the per-worktree resources. On a FIRST setup, create them
  // (ledger-logged for GC; a required create failure aborts setup). On a re-entry,
  // re-ready them via `ensure` instead — never re-create. Needs the git identity.
  let createdFailed: string[] = [];
  const commonGitDir = await resolveCommonGitDir(ctx.cwd);
  const gitKey = await worktreeGitKey(ctx.cwd);
  if (commonGitDir !== undefined && gitKey !== undefined) {
    if (configured) {
      await ensureResources(ctx, identity, settings);
    } else {
      createdFailed =
        (await createResources(ctx, identity, settings, commonGitDir, gitKey))
          .failed;
    }
    await recordResourceEnv(ctx, identity, settings);
  } else if (readResourceSpecs(ctx.config).length > 0) {
    throw new WorktreeGitError(
      "Discern could not identify this worktree in Git, so it could not set up its " +
        "resources. Run `git worktree repair`, then re-run `discern worktree setup`.",
    );
  }

  // 5. record the deterministic port
  await recordPort(ctx, identity);

  // 6. one-shot `steps`, then the shared and worktree convergence buckets.
  // `steps` are scaffolding: they run
  // only on a FRESH worktree and are skipped once configured (a one-shot `createdb`
  // must not re-run). Repository ensure converges checkout-generic dependencies;
  // worktree ensure handles identity-dependent state. Both run on EVERY pass —
  // after `steps` at a fresh creation, alone on re-entry. A fresh failure is FATAL;
  // a re-entry failure is recorded and non-fatal.
  let repositoryEnsure = emptyEnsureCommandRun();
  let worktreeEnsure = emptyEnsureCommandRun();
  if (configured) {
    if (ctx.config.worktree.setup.steps.length > 0) {
      ctx.log.info("Worktree already configured — skipping setup steps.");
    }
    repositoryEnsure = await runRepositoryEnsureSteps(ctx, {
      fatal: false,
    });
    worktreeEnsure = await runWorktreeEnsureSteps(ctx, {
      fatal: false,
    });
  } else {
    for (const step of ctx.config.worktree.setup.steps) {
      ctx.log.info(`Setup step: ${step}`);
      const code = await runShellRouted(step, { cwd: ctx.cwd, log: ctx.log });
      if (code !== 0) {
        throw new WorktreeGitError(
          `The worktree setup step failed: ${step}. Fix that command or its ` +
            `prerequisites, then re-run \`discern worktree setup\`.`,
        );
      }
    }
    // One-shot scaffolding may have rewritten the env file wholesale (the
    // canonical `cp .env.example .env`) — re-assert the env writers so the
    // inherited values and the recorded port/resource handles land in the
    // FINAL file, not the pre-step one the scaffold replaced. All three are
    // idempotent upserts, and the pre-step pass stays so the steps themselves
    // can read the values.
    if (ctx.config.worktree.setup.steps.length > 0) {
      await inheritMainEnvVars({
        worktreeRoot: ctx.cwd,
        vars: ctx.config.worktree.inherit_env,
        files: ctx.config.worktree.env_files,
        log: ctx.log,
      });
      if (commonGitDir !== undefined && gitKey !== undefined) {
        await recordResourceEnv(ctx, identity, settings);
      }
      await recordPort(ctx, identity);
    }
    repositoryEnsure = await runRepositoryEnsureSteps(ctx, {
      fatal: true,
    });
    worktreeEnsure = await runWorktreeEnsureSteps(ctx, { fatal: true });
  }

  // 7. run the complete refresh reconciliation. This also materializes skills
  // into THIS worktree's .claude/skills/; a linked worktree does not inherit that
  // gitignored directory from the main checkout. Non-fatal — but its real outcome
  // is recorded, not reported as a blanket success.
  ctx.log.info("Refreshing artifacts…");
  let refresh: LifecycleRefreshRun;
  try {
    refresh = await refreshWorktreeArtifacts(ctx);
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    refresh = failedRefreshRun([reason], ctx.root);
    ctx.log.warn("Artifact refresh reported an error — continuing.");
  }

  await recordIgnoredFileBaseline(
    ctx.cwd,
    ctx.config.worktree.ignored_file_drift,
  );

  // mark this worktree configured
  const marker = await readySentinelPath(ctx.cwd);
  if (marker !== undefined) {
    try {
      await Deno.mkdir(dirname(marker), { recursive: true });
      await Deno.writeTextFile(marker, "");
    } catch {
      // best-effort sentinel — a failure here must not fail setup
    }
  }

  ctx.log.ok("Worktree setup complete.");

  const result = appliedResult(
    "worktree setup",
    setupResults(
      plan,
      createdFailed,
      refresh.ok,
      repositoryEnsure.outcomes,
      worktreeEnsure.outcomes,
    ),
    [
      ...refresh.diagnostics,
      ...repositoryEnsure.diagnostics,
      ...worktreeEnsure.diagnostics,
    ],
  );
  result.hints = mergeHintTexts(
    refresh.hints,
    repositoryEnsure.hints,
    worktreeEnsure.hints,
  );
  if ((opts.json ?? false) || (opts.humanApplySummary ?? true)) {
    emitOrRenderWorktreeResult(ctx, result, opts.json ?? false);
  }
}

/**
 * Create a linked worktree at `dir` on `branch` from the main checkout `mainRepo`,
 * then run its first-time setup — the shared "mint + ready a worktree at a resolved
 * location" core. Both `discern start` (which mints its own worktree from the main
 * checkout) and the Claude Code worktree-create hook call this, so the create-then-
 * setup sequence lives in exactly one place. It bakes in NO placement convention:
 * the caller resolves WHERE the worktree lands (`resolveWorktreeRoot`, the feature
 * layer) and passes the final `dir` — keeping this engine core agent-agnostic.
 * `startPoint` names the ref the new branch forks from (omitted → the main
 * checkout's HEAD — the caller decides). Idempotent end to end: `addWorktree`
 * no-ops on an existing worktree and `worktreeSetup` re-readies (never re-creates)
 * an already-configured one. Setup runs with the new worktree as both root and
 * cwd — a linked worktree is its own checkout, with its own discern.toml and
 * gitignored materialized skills to build.
 *
 * Fails CLOSED and CLEAN: an unborn repo (no first commit) is refused up front in
 * plain language, and any failure after the worktree was created here discards the
 * partial worktree (directory, registration, branch) before rethrowing — a failed
 * create must never leave debris that `status` then lists as a healthy worktree.
 */
export async function createAndSetupWorktree(
  mainRepo: string,
  dir: string,
  branch: string,
  log: Logger,
  startPoint?: string,
): Promise<void> {
  if (!(await hasAnyCommit(mainRepo))) {
    throw new WorktreeGitError(
      "This repository has no commits yet, so there is nothing to branch a " +
        "worktree from — make your first commit first, then re-run.",
    );
  }
  // Idempotence marker: when `dir` is already a worktree this call created nothing,
  // so a later failure must not discard someone else's live worktree.
  const preExisting = await pathPresent(join(dir, ".git"));
  // A fresh create always mints a fresh `-b` branch. When the branch already
  // exists — typically unlanded work left by an earlier worktree of the same
  // name — refuse up front in plain language: `git worktree add` would fail
  // anyway, and the branch (and its commits) was never this call's to touch.
  if (!preExisting && (await localBranchExists(mainRepo, branch))) {
    throw new WorktreeGitError(
      `A branch named '${branch}' already exists in this repository — it may ` +
        `hold unlanded work from an earlier worktree of the same name. Choose ` +
        `a different worktree name, or review that branch first ` +
        `(git log ${branch}) and land or delete it yourself, then re-run.`,
    );
  }
  // True once `git worktree add -b` has succeeded — the moment the branch (and
  // the checkout) became THIS call's creation, and so its to discard on failure.
  let createdWorktree = false;
  try {
    await addWorktree(mainRepo, dir, branch, startPoint);
    createdWorktree = true;
    let ctx: LifecycleContext;
    try {
      ctx = await lifecycleContext(dir, log, dir);
    } catch (e) {
      if (e instanceof Deno.errors.NotFound) {
        // The checked-out tree has no discern.toml — the ref it branched from
        // predates discern (or setup hasn't landed on it). Say so plainly instead
        // of surfacing a raw readfile crash.
        throw new WorktreeGitError(
          `The new worktree at ${dir} has no discern config — the ref it ` +
            `branched from doesn't carry discern.toml. Branch from a ref that ` +
            `contains it: land setup on the trunk first, or pass --from <ref>, then ` +
            `re-run.`,
        );
      }
      throw e;
    }
    await worktreeSetup(ctx, { humanApplySummary: false });
  } catch (e) {
    if (!preExisting) {
      // Delete the branch only when the add above created it: a failed add
      // (e.g. a branch-name collision racing past the pre-check) means the
      // branch — possibly holding unlanded commits — was never ours to remove.
      await discardWorktreeBestEffort(mainRepo, dir, branch, log, {
        deleteBranch: createdWorktree,
      });
    }
    throw e;
  }
}

/**
 * Discard a worktree unconditionally and best-effort: destroy its resources (from
 * inside it, so `@dir@` destroys resolve), remove the worktree directory and its
 * git registration, then delete its branch — but ONLY under `deleteBranch: true`,
 * the caller's explicit claim that this very flow created the branch; cleanup
 * must never destroy a branch (and its commits) that predates it. Every step
 * swallows its own failure. This cleans up a failed `start`/create (no debris
 * left for `status` to list) and retires the viability probe's throwaway
 * worktree; `worktree prune` is the backstop for anything it misses.
 */
async function discardWorktreeBestEffort(
  mainRepo: string,
  dir: string,
  branch: string,
  log: Logger,
  opts: { deleteBranch: boolean },
): Promise<void> {
  try {
    await teardownResources(await lifecycleContext(dir, log, dir));
  } catch { /* best-effort */ }
  try {
    await removeWorktreeSafely(dir, mainRepo);
  } catch { /* best-effort */ }
  if (opts.deleteBranch) {
    try {
      await runGit(["branch", "-D", branch], { cwd: mainRepo });
    } catch { /* best-effort */ }
  }
}

/** The outcome of the idempotent session-start ensure check. */
export type EnsureResult =
  /** Not in a linked worktree → silent no-op. */
  | { kind: "skipped" }
  /** Already configured (the sentinel is present) → no-op. */
  | { kind: "already" }
  /** Setup was not yet run; it has now been executed. */
  | { kind: "ran" };

/**
 * The idempotent session-start check — the `worktree ensure` command. Runs
 * `worktreeSetup` exactly once for a linked worktree that has not been set up.
 * Safe to run on every session start: the main checkout, a
 * non-git dir, or an already-configured worktree are all silent no-ops.
 */
export async function worktreeEnsure(
  ctx: LifecycleContext,
): Promise<EnsureResult> {
  // Skip when not inside a linked worktree (including the main checkout).
  if (!(await inLinkedWorktree(ctx.cwd))) {
    return { kind: "skipped" };
  }
  if (await worktreeSetupComplete(ctx.cwd)) {
    // Already set up — converge the worktree: reconcile any resource that declares an
    // `ensure` (re-ready one that died out-of-band, e.g. a host reboot) and re-run the
    // checkout-shared and worktree-only ensure commands. All are
    // best-effort here — a convergence hiccup must never break session start. Cheap
    // and silent when neither is declared.
    const { identity, settings } = await resolveContextIdentity(ctx);
    await ensureResources(ctx, identity, settings);
    await runRepositoryEnsureSteps(ctx, { fatal: false });
    await runWorktreeEnsureSteps(ctx, { fatal: false });
    return { kind: "already" };
  }
  ctx.log.warn(
    "[discern] Worktree not configured yet; running 'discern worktree setup'…",
  );
  await worktreeSetup(ctx, { humanApplySummary: false });
  return { kind: "ran" };
}

/**
 * Tear down this worktree's resources without accepting its
 * branch — the `worktree teardown` command, used when discarding a worktree.
 * Asserts the worktree precondition; destroys every resource the worktree created.
 */
export async function worktreeTeardown(
  ctx: LifecycleContext,
  opts: WorktreeOpOptions = {},
): Promise<void> {
  await assertOpSide("worktree-teardown", ctx.cwd);

  const plan = await buildTeardownPlan(ctx);
  if (opts.dryRun ?? false) {
    emitDryRun(
      ctx,
      "worktree teardown",
      teardownPlanToEngine(plan),
      opts.json ?? false,
    );
    return;
  }

  ctx.log.heading("Tearing down this worktree…");
  // Apply CONSUMES the plan: destroy exactly the entries the dry-run previewed,
  // not a fresh re-read that could have drifted.
  const { destroyed, failed } = await destroyResources(ctx, plan.entries);
  ctx.log.ok("Worktree teardown complete.");

  const results: StepResult[] = plan.entries.map((item) => ({
    step: {
      kind: "resource-destroy",
      label: verbatimStepLabel(item.entry.resource_name),
      disposition: "run",
      note: item.entry.resource_identity,
    },
    outcome: failed.includes(item.entry.resource_name)
      ? "failed"
      : destroyed.includes(item.entry.resource_name)
      ? "ok"
      : "skipped",
  }));
  emitOrRenderWorktreeResult(
    ctx,
    appliedResult("worktree teardown", results),
    opts.json ?? false,
  );
}

/** Options for {@link worktreeDrop}. */
export interface WorktreeDropOptions extends WorktreeOpOptions {
  /** Discard even when the worktree holds uncommitted changes or unmerged commits. */
  force?: boolean;
}

/**
 * The read-only diagnosis a `worktree drop` acts on: resolve `target` (a worktree
 * id or path) against git's own registry, snapshot what discarding it would lose,
 * and read its resource ledger. Refuses an unknown target (listing the known ids),
 * an ambiguous id/basename (listing the matching paths), and the main checkout.
 * A plan exists even when blocked — `--dry-run` shows what a `--force` WOULD
 * discard; the executor enforces the `--force` gate.
 */
async function buildDropPlan(
  ctx: LifecycleContext,
  target: string,
): Promise<DropPlan> {
  await assertOpSide("worktree-drop", ctx.cwd);
  if (target.trim() === "") {
    throw new WorktreeGitError(
      "discern worktree drop needs a target. Pass a worktree id or path, then re-run.",
    );
  }
  const trunk = integrationBranch(ctx.config.repository.trunk);
  const fleet = (await listWorktreeFleet(ctx.cwd, trunk)).filter((row) =>
    !row.isMain
  );
  if (fleet.length === 0) {
    throw new WorktreeGitError(
      "There are no worktrees to drop. Run `discern status` to review the current " +
        "worktrees; if none is listed, there is nothing to remove.",
    );
  }

  // Match by canonical path, by directory basename, or by resolved worktree id.
  // Anything with a path separator is a path — relative ones resolve against the
  // caller's cwd (an id never contains a slash); a bare name stays id/basename.
  const wanted = target.trim().replace(/\/+$/, "");
  const wantedAbs = isAbsolute(wanted) || wanted.includes("/")
    ? await Deno.realPath(resolve(wanted)).catch(() => resolve(wanted))
    : undefined;
  const settings = await loadIdentitySettings(ctx.root).catch(() => undefined);
  const matches: Array<(typeof fleet)[number]> = [];
  for (const row of fleet) {
    if (wantedAbs !== undefined) {
      if (row.path === wantedAbs) {
        matches.push(row);
      }
      continue;
    }
    if (basename(row.path) === wanted) {
      matches.push(row);
      continue;
    }
    if (settings !== undefined) {
      const id = await resolveWorktreeId(settings, row.path).catch(() =>
        undefined
      );
      if (id === wanted) {
        matches.push(row);
      }
    }
  }
  if (matches.length > 1) {
    const candidates = matches.map((row) => `- ${row.path}`).sort().join("\n");
    throw new WorktreeGitError(
      `\`discern worktree drop\` can't resolve '${target}': it matches more ` +
        `than one registered worktree:\n${candidates}\n` +
        "Pass one of these paths as the target, then re-run.",
    );
  }
  const match = matches[0];
  if (match === undefined) {
    const known = fleet.map((row) => basename(row.path)).join(", ");
    throw new WorktreeGitError(
      `No worktree matches '${target}'. Known worktrees: ${known}. ` +
        `Pass one of those worktree ids (the directory name) or its path, then re-run.`,
    );
  }

  // A `git worktree lock`ed worktree cannot be removed at all (git refuses, and
  // discern honors the lock — it protects checkouts and their ignored files on
  // removable/network media). A hard refusal, NOT a --force blocker: --force
  // consents to discarding work, not to defeating git's own protection.
  if (match.locked) {
    throw new WorktreeGitError(
      `Worktree '${basename(match.path)}' is locked (git worktree lock), so ` +
        `discern will not remove it — not even with --force. Unlock it first ` +
        `(git worktree unlock ${match.path}), then re-run.`,
    );
  }

  // What a drop would lose — the `--force` blockers.
  const blockers: string[] = [];
  const trunkExists = await localBranchExists(ctx.root, trunk);
  if (match.snapshot === undefined) {
    // Git could not run inside the worktree (missing directory, corrupted
    // gitlink, permission refusal) — its working-tree state is UNKNOWN, and an
    // unknown state fails SAFE: it blocks the drop rather than reading as
    // clean. The branch ref still lives in the main repo, so unlanded commits
    // stay checkable (and nameable) even when the checkout is unreadable.
    if (!trunkExists) {
      blockers.push(
        `cannot verify the work is merged (no local '${trunk}' branch)`,
      );
    } else if (
      match.branch !== "" && match.branch !== trunk &&
      !(await branchIsMerged(ctx.root, match.branch, trunk))
    ) {
      blockers.push(`branch '${match.branch}' has commits not on ${trunk}`);
    }
    blockers.push(
      "the worktree's git state could not be read (its checkout is missing " +
        "or damaged), so uncommitted work cannot be ruled out",
    );
  } else {
    if (match.snapshot.changedFiles > 0) {
      blockers.push(
        `${match.snapshot.changedFiles} uncommitted change${
          match.snapshot.changedFiles === 1 ? "" : "s"
        }`,
      );
    }
    if (trunkExists) {
      if (match.snapshot.ahead > 0) {
        blockers.push(
          `${match.snapshot.ahead} commit${
            match.snapshot.ahead === 1 ? "" : "s"
          } not on ${trunk}`,
        );
      }
    } else {
      blockers.push(
        `cannot verify the work is merged (no local '${trunk}' branch)`,
      );
    }
  }

  // The resource ledger for the target (destruction order), read via ITS git key.
  const commonGitDir = await resolveCommonGitDir(ctx.cwd);
  const gitKey = await worktreeGitKey(match.path);
  const entries = commonGitDir !== undefined && gitKey !== undefined
    ? await entriesForWorktree(commonGitDir, gitKey)
    : [];

  return {
    targetPath: match.path,
    id: basename(match.path),
    branch: match.branch,
    // Drop discards a LINE OF WORK; the trunk is never one. A worktree holding
    // the trunk (the legacy accept-to-branch layouts leave these behind) has
    // its checkout removed and its branch kept — deleting the trunk would leave
    // the repository with no landing target at all.
    deleteBranch: match.branch !== "" && match.branch !== trunk,
    blockers,
    entries,
  };
}

/**
 * Discard a worktree from the main checkout — the `discern worktree drop`
 * command, the sanctioned removal for abandoned work (`worktree prune` only ever
 * reclaims fully-merged, clean worktrees; before this verb the fallback was raw
 * `rm -rf`). Tears down the worktree's resources, removes the worktree directory
 * and registration, and deletes its branch. When the worktree holds uncommitted
 * changes or commits not on the trunk it refuses without `--force`, naming
 * exactly what a forced drop would discard. `--dry-run` shows the plan and
 * touches nothing. Deliberately CLI-only — no MCP tool: the MCP surface aims at
 * the caller's OWN worktree, every other worktree is another line of work an
 * agent must never remove (the fleet ownership rule), and discarding work is a
 * human supervisory action; `status` hints carry the command to the human.
 */
export async function worktreeDrop(
  ctx: LifecycleContext,
  target: string,
  opts: WorktreeDropOptions = {},
): Promise<void> {
  const plan = await buildDropPlan(ctx, target);
  if (opts.dryRun ?? false) {
    emitDryRun(
      ctx,
      "worktree drop",
      dropPlanToEngine(plan),
      opts.json ?? false,
    );
    return;
  }

  if (plan.blockers.length > 0 && !(opts.force ?? false)) {
    throw new WorktreeGitError(
      `Worktree '${plan.id}' has work a drop would discard: ${
        plan.blockers.join("; ")
      }. Resume a session there to finish or land it, or re-run with --force ` +
        `to discard it permanently.`,
    );
  }

  ctx.log.heading(`Dropping worktree '${plan.id}'…`);
  const steps: StepResult[] = [];
  let preservedCommit: string | undefined;

  // Preserve the branch's committed tip before any resource, filesystem, or
  // ref deletion. Branch deletion removes its branch reflog; this ordinary Git
  // ref keeps the commit reachable independently of reflog and object-prune
  // settings. A failed write stops the drop with every original object intact.
  if (plan.deleteBranch) {
    let recovery;
    try {
      recovery = await preserveDropRecoveryRef(
        ctx.root,
        plan.branch,
        plan.id,
      );
    } catch (error) {
      throw new WorktreeGitError(
        `The drop stopped before changing the worktree because discern could ` +
          `not preserve branch '${plan.branch}' under refs/discern/recovery/. ` +
          `Fix the Git error, then re-run \`discern worktree drop ${plan.id}\`. ` +
          `Git said: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
    preservedCommit = recovery.commit;
    ctx.log.ok(`Preserved branch tip at ${recovery.ref}.`);
    steps.push({
      step: {
        kind: "git",
        label: BUILT_IN_STEP_LABELS.preserveBranchTip,
        disposition: "run",
        note: recovery.ref,
      },
      outcome: "ok",
    });
  } else {
    steps.push({
      step: {
        kind: "git",
        label: BUILT_IN_STEP_LABELS.preserveBranchTip,
        disposition: "skip",
        note: plan.branch === ""
          ? "detached — no branch tip to preserve"
          : `${plan.branch} is the trunk — kept`,
      },
      outcome: "skipped",
    });
  }

  // 1. Tear down its resources, best-effort — from inside the target so
  // `@dir@`-bearing destroys resolve; a configless (broken) worktree falls back to
  // the main checkout's context (resource commands are authored cwd-independent).
  // A teardown hiccup never strands the drop; `worktree prune`'s GC is the backstop.
  let destroyed: string[] = [];
  let failed: string[] = [];
  if (plan.entries.length > 0) {
    const teardownCtx = await lifecycleContext(
      plan.targetPath,
      ctx.log,
      plan.targetPath,
    ).catch(() => ctx);
    ({ destroyed, failed } = await destroyResources(
      teardownCtx,
      plan.entries,
    ));
  }
  for (const item of plan.entries) {
    steps.push({
      step: {
        kind: "resource-destroy",
        label: verbatimStepLabel(item.entry.resource_name),
        disposition: "run",
        note: item.entry.resource_identity,
      },
      outcome: failed.includes(item.entry.resource_name)
        ? "failed"
        : destroyed.includes(item.entry.resource_name)
        ? "ok"
        : "skipped",
    });
  }

  // 2. Remove the worktree directory + registration.
  ctx.log.info(`Removing worktree: ${plan.targetPath}`);
  try {
    await removeWorktreeSafely(plan.targetPath, ctx.root);
  } catch (e) {
    throw new WorktreeGitError(
      `Worktree removal failed for ${plan.targetPath}: ${
        e instanceof Error ? e.message : String(e)
      }\nRun \`git worktree list\` to inspect its state, fix the problem it shows, ` +
        `then re-run \`discern worktree drop ${plan.id}\`.`,
    );
  }
  steps.push({
    step: {
      kind: "git",
      label: BUILT_IN_STEP_LABELS.removeWorktree,
      disposition: "run",
      note: plan.targetPath,
    },
    outcome: "ok",
  });

  // 3. Delete its branch (force — the --force gate above is the consent for an
  // unmerged branch; a merged one deletes the same way). Never the trunk: a
  // worktree holding it loses only its checkout (`plan.deleteBranch`).
  if (plan.deleteBranch) {
    const del = preservedCommit === undefined
      ? { deleted: false, reason: "the preserved commit id is unavailable" }
      : await deleteDropBranchAtCommit(
        ctx.root,
        plan.branch,
        preservedCommit,
      );
    if (!del.deleted) {
      throw new WorktreeGitError(
        `The worktree was removed, but Git could not delete its branch ` +
          `'${plan.branch}' at the preserved commit. The branch is still present; ` +
          `review whether it moved, then delete it with \`git branch -D ${plan.branch}\` ` +
          `only if its current tip is no longer needed.\nGit said: ${del.reason}`,
      );
    }
    ctx.log.ok(`Deleted branch ${plan.branch}.`);
    steps.push({
      step: {
        kind: "git",
        label: BUILT_IN_STEP_LABELS.deleteBranch,
        disposition: "run",
        note: plan.branch,
      },
      outcome: "ok",
    });
  } else if (plan.branch !== "") {
    ctx.log.ok(`Kept branch ${plan.branch} — the trunk is never deleted.`);
    steps.push({
      step: {
        kind: "git",
        label: BUILT_IN_STEP_LABELS.deleteBranch,
        disposition: "skip",
        note: `${plan.branch} is the trunk — kept`,
      },
      outcome: "skipped",
    });
  }

  ctx.log.ok(`Worktree '${plan.id}' dropped.`);
  emitOrRenderWorktreeResult(
    ctx,
    appliedResult("worktree drop", steps),
    opts.json ?? false,
  );
}

/** A bound git runner for the acceptance flow (defaults to the worktree cwd). */
type GitRunner = (args: string[], cwd?: string) => Promise<GitResult>;

/** The git runner acceptance uses — the shared runner bound to the worktree cwd. */
function makeGitRunner(ctx: LifecycleContext): GitRunner {
  return (args: string[], cwd: string = ctx.cwd) => runGit(args, { cwd });
}

/**
 * The read-only diagnosis an acceptance acts on — the plan-build half. Asserts the
 * preconditions (in a worktree, not the main repo, branch contains main, main is
 * clean AND sitting on the trunk — acceptance fast-forwards the trunk there and
 * never silently switches a parked checkout), throwing the same
 * `WorktreeGitError`s as before so a plan only exists for an acceptance that may
 * proceed. Resolves the branch name read-only for display; the authoritative
 * branch (created if the worktree is detached) is ensured by the executor, so
 * building a plan — and `--dry-run` — never mutates.
 */
async function buildAcceptPlan(
  ctx: LifecycleContext,
  run: GitRunner,
): Promise<AcceptPlan> {
  // diagnose
  if (!(await run(["rev-parse", "--is-inside-work-tree"])).success) {
    throw new WorktreeGitError(
      "discern accept needs a Git worktree, but this directory is outside a Git " +
        "repository. Move into the worktree that holds the finished branch, then re-run.",
    );
  }
  const gitDir = (await run(["rev-parse", "--absolute-git-dir"])).stdout.trim();
  const commonRaw = (await run(["rev-parse", "--git-common-dir"])).stdout
    .trim();
  const gitCommonDir = await realPathOrLifecycle(commonRaw, ctx.cwd);
  if (gitDir === gitCommonDir) {
    throw new WorktreeGitError(
      "discern accept runs inside a worktree — a separate checkout and branch for " +
        "one effort — but this is the main checkout. Move into the finished worktree " +
        "path shown by `discern status`, then re-run.",
    );
  }
  const worktreePath = (await run(["rev-parse", "--show-toplevel"])).stdout
    .trim();

  // resolve the branch name read-only (the executor ensures/creates it)
  const settings = await loadIdentitySettings(ctx.root);
  const id = await resolveWorktreeId(settings, ctx.cwd);
  const identity = deriveIdentity(id, settings);
  const current = (await run(["branch", "--show-current"])).stdout.trim();
  const worktreeBranch = current !== "" ? current : identity.branch;

  const mainRepo = await mainRepoPath(ctx.cwd);
  if (mainRepo === undefined) {
    throw new WorktreeGitError(
      "Discern could not find the main checkout from Git's worktree records. Run " +
        "`git worktree repair`, then re-run `discern accept`.",
    );
  }
  if (mainRepo === worktreePath) {
    throw new WorktreeGitError(
      "Git identifies this path as the main checkout, so there is no worktree branch " +
        "to accept. Move into the finished worktree shown by `discern status`, then " +
        "re-run `discern accept`.",
    );
  }

  // Acceptance ends by REMOVING this worktree, and a `git worktree lock`ed one
  // cannot be removed (git refuses; discern honors the lock). Refuse at plan
  // time — before the gate runs and long before the trunk fast-forwards — so a
  // locked worktree never strands a half-landed acceptance.
  if (
    (await registeredWorktreeRecord(worktreePath, mainRepo))?.locked === true
  ) {
    throw new WorktreeGitError(
      `This worktree is locked (git worktree lock), and acceptance removes ` +
        `the worktree after landing. Unlock it first ` +
        `(git worktree unlock ${worktreePath}), then re-run discern accept.`,
    );
  }

  // require the branch contains the latest integration branch
  const trunkBranch = integrationBranch(ctx.config.repository.trunk);
  ctx.log.info(`Checking the branch contains the latest ${trunkBranch}…`);
  const merged = await assertMainMerged(
    ctx.cwd,
    ctx.config.repository.trunk,
  );
  if (merged.kind === "behind") {
    throw new WorktreeGitError(
      `This branch is behind the trunk (${trunkBranch}). Run \`discern update\` to ` +
        `bring it in, then \`discern done\`, then re-run \`discern accept\`.`,
    );
  }
  if (merged.kind === "missing") {
    throw new WorktreeGitError(
      `${missingIntegrationBranchWarning(merged.branch)} ` +
        "Acceptance will not remove this worktree until the merge check can run.",
    );
  }
  ctx.log.ok(`Branch contains the latest ${trunkBranch}.`);

  // capture worktree state
  const worktreeDirty =
    (await run(["status", "--porcelain", "-z"])).stdout.trim() !== "";
  if (worktreeDirty) {
    throw new WorktreeGitError(
      "This worktree has uncommitted changes, so acceptance cannot land a stable " +
        "commit. Commit or stash them, then re-run `discern accept`; discern never " +
        "creates a work-in-progress commit for you.",
    );
  }
  const trackedRefresh = await planTrackedRefresh(ctx.cwd, ctx.config);
  if (trackedRefresh.changes.length > 0 || trackedRefresh.errors.length > 0) {
    throw new WorktreeGitError(trackedRefreshAcceptRefusal(trackedRefresh));
  }
  const ignoredFileChanges = await inspectIgnoredFileChanges(
    ctx.cwd,
    ctx.config.worktree.ignored_file_drift,
  );
  // Refuse to move the main checkout only for tracked changes. Untracked local
  // provider/session scratch does not participate in the fast-forward and is
  // left in place.
  const mainDirty = await hasUncommittedTrackedChanges(mainRepo) ?? false;
  const mainBranchRun = await run(["branch", "--show-current"], mainRepo);
  const mainBranch = mainBranchRun.stdout.trim() !== ""
    ? mainBranchRun.stdout.trim()
    : "(detached)";

  // gate: refuse to touch a dirty main checkout
  if (mainDirty) {
    throw new WorktreeGitError(
      `Main checkout at ${mainRepo} has uncommitted tracked changes on '${mainBranch}'. ` +
        `Commit or stash them, then re-run \`discern accept\`; acceptance will not move ` +
        `your main-checkout work for you. ` +
        `Your worktree branch '${worktreeBranch}' is untouched and still holds all its commits.`,
    );
  }

  // gate: acceptance fast-forwards the trunk IN the main checkout, so the main
  // checkout must be sitting on the trunk — never silently switch it off whatever
  // branch someone parked it on.
  if (mainBranch !== trunkBranch) {
    throw new WorktreeGitError(
      offTrunkAcceptRefusal(mainRepo, mainBranch, trunkBranch),
    );
  }

  return {
    worktreeBranch,
    worktreePath,
    mainRepo,
    trunk: ctx.config.repository.trunk,
    proofNotes: ctx.config.repository.proof_notes,
    repositoryEnsureSteps: ctx.config.repository.ensure,
    smokeSteps: planStageJobs(ctx.config, "test")
      .filter((job) =>
        job.kind === "known" && /^smoke(?:#\d+)?$/.test(job.label)
      )
      .map((job) => ({
        label: job.label,
        command: job.command,
        ...(job.timeoutS !== undefined ? { timeoutS: job.timeoutS } : {}),
      })),
    hasResources: readResourceSpecs(ctx.config).length > 0,
    ignoredFileChanges,
  };
}

/** The accept refusal when the main checkout is parked on a branch other than
 * the trunk (detached included). Acceptance lands by fast-forwarding the trunk in
 * the main checkout, so switching it back is the user's one clear next step —
 * never something accept does silently to a checkout someone parked
 * deliberately. */
function offTrunkAcceptRefusal(
  mainRepo: string,
  mainBranch: string,
  trunk: string,
): string {
  return `The main checkout at ${mainRepo} is on '${mainBranch}', not ` +
    `'${trunk}' (the trunk). Acceptance lands by fast-forwarding the trunk ` +
    `there, so return it first — \`git -C ${mainRepo} switch ${trunk}\` — ` +
    `then re-run \`discern accept\`. Your branch keeps all its commits.`;
}

/** The relay-and-recovery sentence the consent refusal serves on every surface
 * — the Error's message (the human render) and the envelope's `message`. It
 * re-serves the review moment (relay the proof, wait for the owner) and names
 * the recovery (re-run with the attestation). Mutation-free: it fires before any
 * git runs, so the worktree, its branch, and the trunk are genuinely untouched. */
const ACCEPT_AWAITING_CONSENT_BASE =
  "Landing is the owner's decision, so `discern accept` needs their explicit " +
  "acceptance before it lands. Relay the proof to your owner and wait for " +
  "their go-ahead, then re-run `discern accept --confirmed`. The flag attests " +
  "to that conversation; recorded grants in the trunk's `[acceptance]` section " +
  "or at the desk are checked automatically.";

/** Combine uncovered paths and authority warnings into a no-effects consent refusal. */
function acceptAwaitingConsentMessage(
  authority: LandingAuthorityResolution,
): string {
  const uncovered = uncoveredLandingAuthorityDetails(authority);
  const detail = uncovered.length > 0
    ? `Recorded standing grants do not cover ${uncovered.join(", ")}.`
    : undefined;
  const evidence = [
    ...(detail !== undefined ? [detail] : []),
    ...authority.warnings,
  ];
  return `${ACCEPT_AWAITING_CONSENT_BASE}${
    evidence.length > 0 ? ` ${evidence.join(" ")}` : ""
  } Nothing has been landed — the worktree, its branch, and the trunk are untouched.`;
}

/**
 * The read-only refusal `accept` serves when no recorded grant authorizes the
 * landing and its `--confirmed` conversation attestation is absent (ADR 0134,
 * amended by ADR 0194). Landing is the highest-stakes act, so structure — not a
 * instructions sentence — forces the relay moment into the transcript: an agent
 * under context pressure that runs `accept` without authority is handed the
 * review moment, not silently landed. Shares the
 * {@link AWAITING_CONSENT_SLUG} slug with `setup begin` so the consent-gated
 * class is one contract. Carries ≥1 actionable hint; the honored proof and
 * the raw-diff command it points at live once, on `discern status`.
 */
function acceptAwaitingConsentResult(
  authority: LandingAuthorityResolution,
): DiscernResult<AcceptData> {
  return {
    ok: false,
    verb: "accept",
    error: AWAITING_CONSENT_SLUG,
    message: acceptAwaitingConsentMessage(authority),
    hints: hintTexts([
      fire(HINTS["accept-awaiting-confirmation"]),
      fire(HINTS["accept-review-via-status"]),
    ]),
  };
}

/** The shared no-effects clause every pre-effect acceptance refusal ends with. */
const ACCEPT_NOTHING_LANDED =
  "Nothing has been landed — the worktree, its branch, and the trunk are untouched.";

/**
 * The precondition refusal when a governing stop checkpoint's conclusion is
 * missing or stale at acceptance: the declaration is recorded at
 * `done`, so the refusal routes back there. Shares the interlock's slug — the
 * thing awaited is the agent's own conclusion; the envelope's verb
 * disambiguates the act.
 */
function acceptDeclarationsStaleResult(
  ids: readonly string[],
): DiscernResult<AcceptData> {
  return {
    ok: false,
    verb: "accept",
    error: AWAITING_DECLARATION_SLUG,
    message:
      `Landing needs a current conclusion for every governing checkpoint, and ${
        ids.length === 1 ? "one is" : `${ids.length} are`
      } missing or no longer current: ${ids.join(", ")}. Run \`discern ` +
      "done` — it serves each question with its evidence and records your " +
      `conclusion — then re-run \`discern accept\`. ${ACCEPT_NOTHING_LANDED}`,
    hints: hintTexts([
      fire(HINTS["accept-declarations-stale"], { ids: [...ids] }),
    ]),
  };
}

/** One declared-unmet conclusion's serving text in the variance refusal.
 * This message renders verbatim on the --markdown surface — the owner's
 * consent moment — so the agent's opaque rationale and the working-tree
 * path names travel inside the code-span escaping boundary, never as live
 * Markdown. */
function serveUnmetConclusion(unmet: StandingUnmetConclusion): string {
  const shown = unmet.matched.slice(0, 6).map(markdownCodeSpan).join(", ");
  const more = unmet.matched.length > 6
    ? `, +${unmet.matched.length - 6} more`
    : "";
  const lines = [
    `${unmet.id} — declared unmet at ${unmet.declaredAt}`,
    `  Question: ${unmet.question.trim()}`,
    `  Changed: ${shown}${more}`,
    `  Rationale: ${markdownCodeSpan(unmet.why)}`,
  ];
  if (unmet.teach !== undefined && unmet.teach.trim() !== "") {
    lines.push(`  Teach: ${unmet.teach.trim()}`);
  }
  return lines.join("\n");
}

/**
 * The read-only refusal `accept` serves while a current declared-unmet
 * conclusion stands without the owner's complete decision: every such
 * checkpoint batched with its question, evidence, and the agent's rationale,
 * and ONE recovery — the owner accepts the landing and each named variance in
 * the current conversation (`--confirmed` plus one `--variance <id>` each).
 * Standing and effort grants never authorize a variance. Its own typed
 * contract, distinct from awaiting_consent: consent accepts the landing; a
 * variance additionally authorizes landing a question the agent judged
 * unmet.
 */
function acceptAwaitingVarianceResult(
  unmet: readonly StandingUnmetConclusion[],
  missing: readonly string[],
  confirmed: boolean,
): DiscernResult<AcceptData> {
  const ids = unmet.map((entry) => entry.id);
  const decision = confirmed
    ? `The landing decision must also cover every declared-unmet checkpoint; ` +
      `missing: ${missing.join(", ")}.`
    : `Landing is the owner's decision, and ${
      unmet.length === 1
        ? "one declared-unmet conclusion additionally requires"
        : `${unmet.length} declared-unmet conclusions additionally require`
    } the owner to authorize a variance.`;
  const command = `discern accept --confirmed ${
    ids.map((id) => `--variance ${id}`).join(" ")
  }`;
  return {
    ok: false,
    verb: "accept",
    error: AWAITING_VARIANCE_SLUG,
    message:
      `${decision}\n\n${
        unmet.map(serveUnmetConclusion).join("\n\n")
      }\n\nRelay each question and rationale to the owner. Once the owner ` +
      `accepts this landing AND each named variance in the current ` +
      `conversation, re-run \`${command}\`. Recorded standing and effort ` +
      `grants never authorize a variance. ${ACCEPT_NOTHING_LANDED}`,
    hints: hintTexts([
      fire(HINTS["accept-authorize-variance"], { ids }),
      fire(HINTS["accept-review-via-status"]),
    ]),
  };
}

/**
 * Enforce the checkpoint side of acceptance before any effect: verify every
 * required declaration is current (missing or stale routes back to `done`),
 * then resolve the variance interlock. Returns the exact authorized variance
 * set (possibly empty); throws the typed refusal or error otherwise.
 */
function enforceAcceptanceCheckpoints(
  state: AcceptanceCheckpointState,
  request: { confirmed: boolean; varianceIds: readonly string[] },
): AuthorizedVarianceData[] {
  const interlock = resolveVarianceInterlock(state, request);
  switch (interlock.kind) {
    case "declarations-stale": {
      const result = acceptDeclarationsStaleResult(interlock.ids);
      throw new WorktreeResultError(result.message ?? "", result);
    }
    case "invalid-variances":
      throw new WorktreeResultError(
        `${interlock.message} ${ACCEPT_NOTHING_LANDED}`,
        {
          ok: false,
          verb: "accept",
          error: "invalid_value",
          message: `${interlock.message} ${ACCEPT_NOTHING_LANDED}`,
        },
      );
    case "awaiting": {
      const result = acceptAwaitingVarianceResult(
        interlock.unmet,
        interlock.missing,
        interlock.confirmed,
      );
      throw new WorktreeResultError(result.message ?? "", result);
    }
    case "authorized":
      return interlock.variances;
  }
}

/** Resolve the consent this apply lands under, or throw the awaiting-consent
 * refusal. An unreadable committed policy already blocked every recorded
 * source upstream; the conversation attestation never rests on that record —
 * which can only widen authority, never restrict it — so it stays honorable
 * here and the record's defect travels as an authority warning instead of a
 * veto. Otherwise the branch carrying a config-schema migration could never
 * land itself, on any engine, since the trunk's committed config predates the
 * schema reading it. */
function landingConsentForApply(
  authority: LandingAuthorityResolution,
  confirmed: boolean,
): LandingConsent {
  if (authority.kind === "authorized") {
    return authority.consent;
  }
  if (!confirmed) {
    const result = acceptAwaitingConsentResult(authority);
    throw new WorktreeResultError(result.message ?? "", result);
  }
  return { source: "conversation" };
}

/** Prefer recorded authority and fall back to an explicit conversation attestation. */
function availableLandingConsent(
  authority: LandingAuthorityResolution,
  confirmed: boolean,
): LandingConsent | undefined {
  if (authority.kind === "authorized") {
    return authority.consent;
  }
  return confirmed ? { source: "conversation" } : undefined;
}

/** Initialize every durable acceptance effect as not yet performed. */
function freshAcceptLandingState(): AcceptLandingState {
  return {
    recovery_performed: false,
    trunk_landed: false,
    worktree_removed: false,
    branch_deleted: false,
  };
}

/** Snapshot acceptance effects before publishing them in a result envelope. */
function cloneLandingState(
  landing: AcceptLandingState,
): AcceptLandingState {
  return { ...landing };
}

/** Copy consent scopes before exposing them through acceptance result data. */
function cloneLandingConsent(consent: LandingConsent): AcceptData["consent"] {
  return {
    source: consent.source,
    ...(consent.scopes === undefined ? {} : { scopes: [...consent.scopes] }),
  };
}

/** Configured scope names matched by the landing's classified paths. Names
 * only: acceptance exposes no path or configuration value to the logbook. */
function changedLandingScopes(
  authority: LandingAuthorityResolution,
): string[] {
  if (authority.scopeNames !== undefined) {
    return [...authority.scopeNames];
  }
  const scopes = new Set<string>();
  for (const classification of authority.classifications) {
    for (const scope of classification.scopes) {
      scopes.add(scope);
    }
  }
  return [...scopes].sort();
}

interface AcceptExecutionProgress {
  readonly steps: StepResult[];
  readonly landing: AcceptLandingState;
  readonly scopesChanged: string[];
  gateValidation?: NonNullable<AcceptData["gate_validation"]>;
  proofMarkdown?: string;
  proofLine?: string;
  proofNote?: AcceptProofNoteData;
  readonly convergenceHints: string[];
  readonly diagnostics: Diagnostic[];
  readonly authorityWarnings: string[];
}

/** Initialize mutable acceptance progress with caller-supplied steps and scopes. */
function freshAcceptExecutionProgress(
  steps: StepResult[] = [],
  scopesChanged: string[] = [],
): AcceptExecutionProgress {
  return {
    steps,
    landing: freshAcceptLandingState(),
    scopesChanged,
    convergenceHints: [],
    diagnostics: [],
    authorityWarnings: [],
  };
}

/** Publish the exact durable effects and recovery evidence after an interrupted acceptance. */
function partialAcceptanceResult(
  root: string,
  consent: LandingConsent,
  progress: AcceptExecutionProgress,
  message: string,
): DiscernResult<AcceptData> {
  const result: DiscernResult<AcceptData> = {
    ok: false,
    verb: "accept",
    error: "partial_acceptance",
    message,
    ...(progress.steps.length === 0 ? {} : { steps: [...progress.steps] }),
    data: {
      root,
      consent: cloneLandingConsent(consent),
      ...(progress.scopesChanged.length === 0
        ? {}
        : { scopes_changed: [...progress.scopesChanged] }),
      landing: cloneLandingState(progress.landing),
      ...(progress.authorityWarnings.length === 0
        ? {}
        : { authority_warnings: [...progress.authorityWarnings] }),
      ...(progress.gateValidation === undefined
        ? {}
        : { gate_validation: progress.gateValidation }),
      ...(progress.proofMarkdown === undefined
        ? {}
        : { proof: progress.proofMarkdown }),
      ...(progress.proofLine === undefined
        ? {}
        : { proof_line: progress.proofLine }),
      ...(progress.proofNote === undefined
        ? {}
        : { proof_note: progress.proofNote }),
    },
    hints: mergeHintTexts(
      hintTexts([fire(HINTS["accept-reconcile-partial-effects"])]),
      progress.convergenceHints,
    ),
    ...(progress.diagnostics.length === 0
      ? {}
      : { diagnostics: [...progress.diagnostics] }),
  };
  return result;
}

/** Stop acceptance with a structured partial-effects result instead of losing recovery state. */
function throwPartialAcceptance(
  root: string,
  consent: LandingConsent,
  progress: AcceptExecutionProgress,
  message: string,
): never {
  const result = partialAcceptanceResult(root, consent, progress, message);
  throw new WorktreeResultError(message, result);
}

/** Represent journal reconciliation as an ordinary acceptance step result. */
function recoveryStep(outcome: StepOutcome): StepResult {
  return {
    step: {
      kind: "git",
      label: BUILT_IN_STEP_LABELS.recoverInterruptedAcceptance,
      disposition: "run",
      note: "reconcile the journal-bound transaction before any new landing",
    },
    outcome,
  };
}

// How many of the gate's diagnostics ride inline in an accept refusal before the agent
// is pointed at `discern done` for the rest — a cap so a gate that failed with many
// findings can't flood accept's refusal message.
const ACCEPT_DIAG_CAP = 10;

/**
 * The accept refusal when the branch does NOT pass `done` at the tree it would land
 * (ADR 0067). Leads with the gate's own failed-stage remedy from the envelope,
 * then a capped list of the surfaced diagnostics, then the recovery:
 * run `discern done` to see the full output and fix it. The branch keeps all its commits
 * and the worktree is intact (this precedes every teardown/removal).
 */
function acceptGateRefusal(
  branch: string,
  gate: DiscernResult<GateData>,
): string {
  const headline = gate.hints?.[0] ?? "The gate failed.";
  const diags = gate.diagnostics ?? [];
  const shown = diags
    .slice(0, ACCEPT_DIAG_CAP)
    .map((d) => `  • ${d.message} (reproduce: ${d.reproduce_cmd})`);
  if (diags.length > shown.length) {
    shown.push(`  … (+${diags.length - shown.length} more)`);
  }
  return `Branch '${branch}' does not pass \`discern done\`, so it cannot land. ` +
    `${headline} Run \`discern done\` to see the full output and fix it, then commit ` +
    `and re-run \`discern accept\` — your branch keeps all its commits.` +
    (shown.length > 0 ? `\n\nWhat failed:\n${shown.join("\n")}` : "");
}

/** The accept refusal when the branch tip has moved off the commit the gate
 * validated — a commit landed while acceptance was validating (or between the
 * validation and the fast-forward), so the tree that would land is not the tree
 * the gate tested. Nothing has been changed when this fires. */
function movedDuringAcceptanceRefusal(
  branch: string,
  worktreePath: string,
): string {
  return `Branch '${branch}' moved while this acceptance was validating it — ` +
    `a commit landed after the gate run began, so the tree that would land ` +
    `is not the tree the gate tested. Nothing was changed and the worktree ` +
    `is intact. Re-run \`discern done\` on the final commit from ` +
    `${worktreePath}, then \`discern accept\` again.`;
}

/** Refuse acceptance while refresh still has tracked work to commit. */
function trackedRefreshAcceptRefusal(plan: TrackedRefreshPlan): string {
  const paths = plan.changes.map((change) => change.path);
  const planned = paths.length > 0
    ? ` Running \`discern refresh\` would change: ${paths.join(", ")}.`
    : "";
  const errors = plan.errors.length > 0
    ? ` The read-only refresh plan also reported: ${plan.errors.join("; ")}.`
    : "";
  return "This branch's tracked refresh convergence is not proved." +
    planned + errors +
    " Nothing was landed and the worktree is intact. Run `discern refresh`, " +
    "review and commit the named files, run `discern done`, then re-run " +
    "`discern accept`.";
}

/** Refuse removal when the gated branch fell behind or lost its configured trunk. */
async function assertAcceptBranchStillCurrent(
  cwd: string,
  trunkBranch: string,
): Promise<void> {
  const merged = await assertMainMerged(cwd, trunkBranch);
  if (merged.kind === "behind") {
    throw new WorktreeGitError(
      `This branch fell behind the trunk (${trunkBranch}) while the gate ran. ` +
        `Run \`discern update\` from this worktree, then \`discern done\` and ` +
        `\`discern accept\` again. The worktree has not been removed.`,
    );
  }
  if (merged.kind === "missing") {
    throw new WorktreeGitError(
      `${missingIntegrationBranchWarning(merged.branch)} ` +
        "Acceptance will not remove this worktree until the merge check can run.",
    );
  }
}

/**
 * Run only the configured smoke job in the landing checkout. The full
 * gate already validated the commit in the worktree; this second, deliberately
 * narrow pass proves the main checkout's local runtime state is usable after its
 * repository convergence commands. It is non-fatal because the trunk has
 * already moved, but its real job steps and diagnostics are retained.
 */
async function runLandingSmoke(
  mainRepo: string,
  config: DiscernConfig,
  plan: AcceptPlan,
  log: Logger,
): Promise<{
  steps: StepResult[];
  diagnostics: Diagnostic[];
  hints: string[];
}> {
  if (plan.smokeSteps.length === 0) {
    return { steps: [], diagnostics: [], hints: [] };
  }
  const group: JobGroup = {
    stage: "test",
    mode: "parallel",
    heading: "Proving the landing checkout is ready...",
    display: "Smoke",
    jobs: plan.smokeSteps.map((job) => ({
      label: job.label,
      command: job.command,
      kind: "known",
      reportStage: "test",
      willRun: true,
      ...(job.timeoutS !== undefined ? { timeoutS: job.timeoutS } : {}),
    })),
  };
  log.info("Running the smoke job in the landing checkout...");
  // Always keep the gate runner quiet here: accept owns stdout (especially its
  // JSON envelope), while serializeJobSteps retains failure output as structured
  // diagnostics exactly as the normal gate does. The smoke group is a
  // test-stage run, so the fleet test-run cap counts it like any other.
  const policy = resolveGateRunPolicy(config.gate.stream, {
    kind: "quiet-result",
  });
  const { runOpts, out, slots } = gateRunContext(mainRepo, config, policy);
  const { results, failedStage } = await runJobGroups(
    [group],
    runOpts,
    out,
    slots,
  );
  const serialized = await serializeJobSteps([group], results);
  if (failedStage === null) {
    log.ok("Landing-checkout smoke passed.");
  } else {
    log.warn("Landing-checkout smoke failed — the landing is kept.");
  }
  return { ...serialized, hints: hintTexts(serialized.hints) };
}

/**
 * Apply an acceptance plan — the mutation dance. Ensures the named branch
 * (creating one if the worktree is detached), validates the exact tree against
 * the whole gate (ADR 0067, fast-pathed by a gate proof), fast-forwards the
 * trunk, then refreshes, converges, and smoke-tests the receiving checkout before
 * the cleanup tail tears down resources, removes the worktree, and deletes the
 * merged branch. Returns the per-step results for `--json`.
 */
async function executeAcceptPlan(
  ctx: LifecycleContext,
  run: GitRunner,
  plan: AcceptPlan,
  authority: LandingAuthorityResolution,
  consent: LandingConsent,
  progress: AcceptExecutionProgress,
  variances: readonly AuthorizedVarianceData[],
): Promise<{
  steps: StepResult[];
  gateValidation: NonNullable<AcceptData["gate_validation"]>;
  proofMarkdown: string | undefined;
  proofLine: string | undefined;
  proofNote: AcceptProofNoteData;
  convergenceHints: string[];
  diagnostics: Diagnostic[];
  authorityWarnings: string[];
}> {
  // ensure a named branch (the one mutating step the read-only diagnosis deferred)
  const settings = await loadIdentitySettings(ctx.root);
  const id = await resolveWorktreeId(settings, ctx.cwd);
  const identity = deriveIdentity(id, settings);
  const worktreeBranch = await ensureWorktreeBranch(identity.branch, ctx.cwd);
  if (worktreeBranch === "") {
    throw new WorktreeGitError(
      `This worktree is detached from a named branch, and discern could not create ` +
        `one. Run \`git switch -c ${identity.branch}\` here, then re-run ` +
        `\`discern accept\`.`,
    );
  }
  const { worktreePath, mainRepo, trunk } = plan;

  // Validation gate (ADR 0067) — the exact tree we are about to land must pass the WHOLE
  // gate, so a clean-merging but gate-breaking `update` (or any tree never run through
  // `done` — e.g. a docs edit gated only by a prose linter) cannot fast-forward onto the
  // trunk LOCALLY, where CI's checks never run. This precedes every teardown/removal below,
  // so a refusal leaves the branch and worktree intact.
  //   FAST PATH: a gate proof proves the current clean HEAD already passed `done`
  //   (the common case — nothing changed since the agent finished), so skip the re-run.
  //   SLOW PATH: run the full gate now and refuse to land on any failure. A merge `update`
  //   created, a new commit, or a dirty tree invalidates the proof, landing us here.
  const proof = await inspectGateProof(ctx.cwd);
  const gateValidation: NonNullable<AcceptData["gate_validation"]> =
    proof.status === "honored"
      ? { mode: "proof", proof: proof }
      : { mode: "rerun", proof: proof };
  progress.gateValidation = gateValidation;
  // The two proof renderings for the tree that lands: the honored marker
  // stored both on the fast path; the fresh gate run rendered both on the slow
  // path. `validatedSha` is the ONE commit this validation vouches for — the
  // honored proof's recorded sha, or the HEAD pinned before the gate re-run —
  // and it is the exact rev the fast-forward below lands: a commit made during
  // the (minutes-long) re-run must never ride along unvalidated.
  let proofMarkdown: string | undefined;
  let proofLine: string | undefined;
  let proofData: Proof | undefined;
  let validatedSha: string | undefined;
  if (gateValidation.mode === "proof") {
    ctx.log.ok(
      "Branch already passed the gate at this commit — skipping the re-run.",
    );
    proofMarkdown = proof.proof;
    proofLine = proof.proof_line;
    proofData = proof.proof_data;
    validatedSha = proof.head;
  } else {
    ctx.log.info("Validating the branch against the full gate before landing…");
    const pin = await pinValidatedTree(ctx.cwd);
    const gate = await finishResult(ctx.cwd, {
      surface: ctx.log.json
        ? { kind: "quiet" }
        : { kind: "human", plain: plainModeEnabled() },
    });
    if (!gate.ok) {
      throw new WorktreeGitError(acceptGateRefusal(worktreeBranch, gate));
    }
    const now = await pinValidatedTree(ctx.cwd);
    if (
      pin.head === undefined || now.head !== pin.head || !pin.clean ||
      !now.clean
    ) {
      throw new WorktreeGitError(
        movedDuringAcceptanceRefusal(worktreeBranch, worktreePath),
      );
    }
    ctx.log.ok("Gate passed against the tree to be landed.");
    proofMarkdown = gate.data?.proof?.markdown;
    proofLine = gate.data?.proof?.line;
    proofData = gate.data?.proof;
    validatedSha = pin.head;
  }
  if (validatedSha === undefined) {
    // Defensive: an honored proof always carries its head; refuse rather than
    // fall back to landing whatever the branch name resolves to at merge time.
    throw new WorktreeGitError(
      movedDuringAcceptanceRefusal(worktreeBranch, worktreePath),
    );
  }

  // A proof proves the gate implementation that issued it, not a newer
  // engine's added preconditions. Re-run the cheap current tracked-refresh plan
  // on BOTH paths so a legacy proof cannot bypass convergence, and do it before
  // the fast-forward so refusal is fully non-destructive.
  const trackedRefresh = await planTrackedRefresh(ctx.cwd, ctx.config);
  if (trackedRefresh.changes.length > 0 || trackedRefresh.errors.length > 0) {
    throw new WorktreeGitError(trackedRefreshAcceptRefusal(trackedRefresh));
  }

  // The variance authorization binds to the exact declarations it covered.
  // The gate validation above can change them (a fresh run reconciles
  // open questions), so re-verify the live declared-unmet set still equals the
  // authorized set — an owner's decision must never land onto different
  // evidence than the one it was given for.
  const checkpointsNow = await inspectAcceptanceCheckpoints(
    ctx.cwd,
    ctx.config,
  );
  const bindingKey = (v: AuthorizedVarianceData): string =>
    [v.checkpoint, v.definition_hash, v.subject, v.why].join("\u0000");
  const liveBindings = checkpointsNow.unmet
    .map((unmet) => bindingKey(varianceBinding(unmet)))
    .sort();
  const authorizedBindings = variances.map(bindingKey).sort();
  if (
    checkpointsNow.stale.length > 0 ||
    JSON.stringify(liveBindings) !== JSON.stringify(authorizedBindings)
  ) {
    throw new WorktreeGitError(
      "The checkpoint conclusions changed while this acceptance was " +
        "validating the branch, so the recorded authorization no longer " +
        "matches the declarations it covered. Nothing was landed and the " +
        "worktree is intact. Re-run `discern accept` so the decision is " +
        "made against the current conclusions.",
    );
  }
  // Observation, never a gate: which open questions will end this effort still
  // awaiting a conclusion. Every governing stop conclusion was verified
  // current just above, so anything still awaiting sits outside the governing
  // stop set — a checkpoint edited away or re-moded since its open question opened.
  // Read here while the worktree's store exists; recorded (with the
  // authorized variances) only once the landing transition completes below.
  const abandonedOpenQuestions = await (async (): Promise<{ id: string }[]> => {
    const read = await readOpenQuestions(ctx.cwd);
    if (read.status !== "ok") {
      return []; // fail open: unreadable state observes nothing
    }
    return Object.values(read.openQuestions)
      .filter((openQuestion) =>
        openQuestion.declaration === undefined ||
        !declarationIsCurrent(openQuestion)
      )
      .map((openQuestion) => ({ id: openQuestion.checkpoint }))
      .sort((a, b) => a.id.localeCompare(b.id));
  })();

  await assertAcceptBranchStillCurrent(ctx.cwd, trunk);
  const expired = await landingAuthorityExpiry(
    ctx.cwd,
    trunk,
    worktreeBranch,
    validatedSha,
    authority,
  );
  if (expired !== undefined) {
    throw new WorktreeGitError(
      `Landing authority changed while acceptance was validating the branch: ${expired}. ` +
        "Nothing was landed and the worktree is intact. Re-run `discern accept` so authority is checked against the final tree.",
    );
  }
  if (proofLine !== undefined) {
    proofLine = renderLandingProofLine(proofLine, consent, variances.length);
  }
  if (proofMarkdown !== undefined) {
    progress.proofMarkdown = proofMarkdown;
  }
  if (proofLine !== undefined) {
    progress.proofLine = proofLine;
  }

  const results = progress.steps;
  const authorityWarnings = progress.authorityWarnings;
  const done = (
    kind: StepResult["step"]["kind"],
    label: BuiltInStepLabel,
  ): void => {
    results.push({ step: { kind, label, disposition: "run" }, outcome: "ok" });
  };
  const doneRefresh = (
    outcome: StepResult["outcome"],
    note: string,
  ): void => {
    results.push({
      step: {
        kind: "refresh",
        label: BUILT_IN_STEP_LABELS.materializeLocalAgentArtifacts,
        disposition: "run",
        note,
      },
      outcome,
    });
  };

  ctx.log.heading("Acceptance plan");
  ctx.log.detail(`Branch:        ${worktreeBranch}`);
  ctx.log.detail(`From worktree: ${worktreePath}`);
  ctx.log.detail(
    `Into trunk:         ${mainRepo} (fast-forward ${trunk}, delete ${worktreeBranch})`,
  );
  ctx.log.detail(
    `Authority:          ${
      landingAuthorityDetail(authority, consent.source === "conversation")
    }`,
  );
  for (const warning of authority.warnings) {
    ctx.log.warn(warning);
  }
  const ignoredLine = ignoredFileChangeDetail(plan.ignoredFileChanges);
  if (ignoredLine !== undefined) {
    ctx.log.detail(ignoredLine);
  }
  const localTemplatesDir = await postLandingLocalTemplatesDir(
    worktreePath,
    mainRepo,
  );

  // Land on the trunk: fast-forward it to the branch tip. The acceptance gate
  // already proved the branch contains the trunk, so this is always a clean
  // fast-forward — never a merge commit, never a conflict. The landing runs
  // BEFORE resource teardown so an acceptance that loses a concurrent-landing
  // race is refused with its worktree fully intact — resources included — and
  // the prescribed update → finish → accept recovery actually works.
  await assertAcceptBranchStillCurrent(ctx.cwd, trunk);
  // Re-verify the main checkout is STILL on the trunk immediately before the
  // fast-forward (the plan checked it, but the gate re-run above takes real
  // time) — never compare-and-swap a branch someone switched away from
  // mid-acceptance.
  const mainNow = (await run(["branch", "--show-current"], mainRepo)).stdout
    .trim();
  if (mainNow !== trunk) {
    throw new WorktreeGitError(
      offTrunkAcceptRefusal(
        mainRepo,
        mainNow === "" ? "(detached)" : mainNow,
        trunk,
      ),
    );
  }
  // Land the VALIDATED sha, not the branch name: resolving a branch at the ref
  // transition would let a commit made after validation ride onto the trunk
  // untested. Re-check the tip still names the validated commit (so the branch
  // deletion below deletes a fully merged branch), then fast-forward to the sha.
  const tipNow = (await run(["rev-parse", "--verify", worktreeBranch], ctx.cwd))
    .stdout.trim();
  if (tipNow !== validatedSha) {
    throw new WorktreeGitError(
      movedDuringAcceptanceRefusal(worktreeBranch, worktreePath),
    );
  }
  const standingExpected = authority.kind === "authorized" &&
      authority.consent.source === "standing-grant"
    ? authority.trunkCommit
    : undefined;
  const currentTrunk = standingExpected === undefined
    ? await run(
      ["rev-parse", "--verify", `refs/heads/${trunk}^{commit}`],
      mainRepo,
    )
    : undefined;
  const expectedTrunk = standingExpected ??
    (currentTrunk?.success ? currentTrunk.stdout.trim() : "");
  if (expectedTrunk === "") {
    throw new WorktreeGitError(
      `Discern could not resolve the current ${trunk} commit at the landing boundary. ` +
        `Nothing was landed and the worktree is intact. Re-run \`discern accept\`.`,
    );
  }

  ctx.log.info(`Fast-forwarding ${trunk} to ${worktreeBranch}…`);
  const transition = await performAcceptanceTransition(ctx.cwd, {
    mainRepo,
    trunk,
    worktreeBranch,
    expectedTrunk,
    target: validatedSha,
    effortClaim: consent.source === "effort-grant",
    consent,
    variances,
  });
  if (transition.kind === "authority-changed") {
    const detail = transition.claim.status === "invalid" ||
        transition.claim.status === "unavailable"
      ? `: ${transition.claim.reason}`
      : "";
    throw new WorktreeGitError(
      `Landing authority changed at the fast-forward boundary: the effort ` +
        `grant could not be claimed${detail}. Nothing was landed and the ` +
        `worktree is intact. Re-authorize it from the desk, then re-run ` +
        `\`discern accept\`.`,
    );
  }
  const ff = transition.outcome;
  const effortSettlement = transition.effortSettlement;
  const effortSettlementWarning = effortSettlement?.settled === false
    ? effortSettlement.disposition === "consume"
      ? "Discern could not remove the spent effort-grant claim. It cannot authorize another landing; worktree cleanup will reap it."
      : "Discern could not restore the effort grant cleanly. Inspect the grant in the desk and re-authorize this worktree before retrying."
    : undefined;
  if (effortSettlementWarning !== undefined) {
    ctx.log.warn(effortSettlementWarning);
    authorityWarnings.push(effortSettlementWarning);
  }
  if (ff.kind !== "updated") {
    if (ff.kind === "checkout-failed" && !ff.rolledBack) {
      progress.landing.trunk_landed = true;
      throw new WorktreeGitError(
        `Discern atomically advanced ${trunk} to ${validatedSha}, but Git could not ` +
          `converge the checked-out files and could not restore the old ref. Stop ` +
          `and inspect ${mainRepo} before doing more work. Git said: ${ff.detail}` +
          (effortSettlementWarning === undefined
            ? ""
            : ` ${effortSettlementWarning}`),
      );
    }
    const checkoutDetail = ff.kind === "checkout-failed"
      ? " Git restored the old trunk ref after checkout convergence failed."
      : "";
    throw new WorktreeGitError(
      `The trunk (${trunk}) or its checkout changed while this acceptance was ` +
        `running, so discern's exact-commit compare-and-swap refused the landing.` +
        `${checkoutDetail} Your worktree is fully intact, resources included, ` +
        `and your commits are safe on ${worktreeBranch} at ${worktreePath}. ` +
        `From that worktree, run \`discern update\`, then \`discern done\`, then ` +
        `\`discern accept\` again. Git said: ${ff.detail}` +
        (effortSettlementWarning === undefined
          ? ""
          : ` ${effortSettlementWarning}`),
    );
  }
  progress.landing.trunk_landed = true;
  // The landing is now fact, so its checkpoint observations are too: each
  // owner-authorized variance (id and fingerprints only — the rationale is
  // Proof evidence, never Logbook metadata) and each open question this effort ends
  // while it still awaits a conclusion.
  observeCheckpointActivity({
    variances: variances.map((variance) => ({
      id: variance.checkpoint,
      definition: variance.definition_hash,
      subject: variance.subject,
    })),
    abandoned: abandonedOpenQuestions,
  });
  ctx.log.ok(`${trunk} fast-forwarded to ${worktreeBranch} at ${mainRepo}.`);
  done("git", BUILT_IN_STEP_LABELS.fastForwardTrunk);

  // Establish the tracked-checkout baseline immediately after the ref/checkout
  // transition, before any proof, local materialization, ensure, or smoke
  // effect can obscure its source. A validated landing should be clean here.
  let trackedDirtyAfterLanding: boolean | undefined;
  try {
    trackedDirtyAfterLanding = await hasUncommittedTrackedChanges(mainRepo) ??
      undefined;
  } catch {
    trackedDirtyAfterLanding = undefined;
  }

  // The trunk now names the validated commit. Proof-note recording and its
  // opt-in fetch transport are deliberately fail-open from this boundary:
  // neither may roll back a successful landing or turn acceptance red.
  let convergenceHints: string[] = hintTexts([]);
  const proofFetch = await reconcileProofNotesFetch(
    mainRepo,
    plan.proofNotes,
  );
  const proofFetchOk = proofNotesFetchSucceeded(proofFetch);
  results.push({
    step: {
      kind: "git",
      label: BUILT_IN_STEP_LABELS.reconcileProofNoteFetch,
      disposition: "run",
      note: proofFetchOk
        ? `proof-note transport is ${proofFetch.status}`
        : proofFetch.errors.join("; "),
    },
    outcome: proofFetchOk ? "ok" : "skipped",
  });
  if (!proofFetchOk) {
    ctx.log.warn(
      "Proof-note fetch transport could not converge — the landing is kept.",
    );
  }

  const acceptanceEvidence: AcceptanceEvidenceData = {
    consent: cloneLandingConsent(consent),
    variances: variances.map((variance) => ({ ...variance })),
  };
  const proofWrite = await writeProofNote(
    mainRepo,
    validatedSha,
    proofData,
    Deno.env,
    acceptanceEvidence,
  );
  const proofNote: AcceptProofNoteData = {
    fetch: proofFetch,
    write: proofWrite,
  };
  progress.proofNote = proofNote;
  const proofWritten = proofWrite.status === "recorded" ||
    proofWrite.status === "already_present";
  results.push({
    step: {
      kind: "git",
      label: BUILT_IN_STEP_LABELS.writeProofNote,
      disposition: "run",
      note: proofWrite.reason ??
        `${proofWrite.ref} at ${proofWrite.commit}`,
    },
    outcome: proofWritten ? "ok" : "skipped",
  });
  if (proofWritten) {
    ctx.log.ok(`Recorded the landing proof under ${proofWrite.ref}.`);
  } else {
    ctx.log.warn(
      `The landing proof note was not recorded — the landing is kept. ${
        proofWrite.reason ?? proofWrite.status
      }`,
    );
  }

  const publicationRemote = proofFetch.remotes.includes("origin")
    ? "origin"
    : proofFetch.remotes[0];
  if (
    plan.proofNotes === "fetch" && proofFetchOk &&
    proofWritten && publicationRemote !== undefined
  ) {
    convergenceHints = mergeHintTexts(
      convergenceHints,
      hintTexts([
        fire(HINTS["accept-publish-proof-note"], {
          remote: publicationRemote,
        }),
      ]),
    );
  }

  // Converge and prove the checkout accept leaves behind BEFORE cleanup. The
  // trunk has already moved, so every operation in this block is non-fatal and
  // recorded: no dependency-install or smoke failure may strand the linked
  // worktree/resources by preventing the cleanup tail from running.
  const diagnostics = progress.diagnostics;
  ctx.log.info("Materializing local agent skills in the landing checkout…");
  let refresh: LifecycleRefreshRun;
  try {
    const refreshed = await materializeLocalRefreshForLanding(
      mainRepo,
      ctx.log,
      localTemplatesDir,
    );
    refresh = instructionRefreshRun(refreshed, mainRepo);
    convergenceHints = mergeHintTexts(convergenceHints, refresh.hints);
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    refresh = failedRefreshRun([reason], mainRepo);
    convergenceHints = mergeHintTexts(convergenceHints, refresh.hints);
    ctx.log.warn(
      "Local Agent artifact materialization reported an error — continuing.",
    );
  }
  diagnostics.push(...refresh.diagnostics);
  doneRefresh(
    refresh.ok ? "ok" : "failed",
    "materialized only the trunk checkout's local/ignored agent artifacts",
  );
  if (!refresh.ok) {
    convergenceHints = mergeHintTexts(
      convergenceHints,
      hintTexts([fire(HINTS["accept-refresh-failed"], { trunk, mainRepo })]),
    );
  }

  let landingConfig = ctx.config;
  try {
    landingConfig = await loadConfig(mainRepo);
  } catch {
    // The gate validated this same tracked config in the worktree. Falling back
    // keeps cleanup moving if a machine-local read hiccup occurs after the FF.
    ctx.log.warn(
      "Could not reload the landed config in the main checkout — using the validated worktree config for convergence.",
    );
  }

  let repositoryEnsure: EnsureCommandRun;
  try {
    repositoryEnsure = await runEnsureCommands(
      ctx,
      plan.repositoryEnsureSteps,
      { fatal: false, cwd: mainRepo, scope: "repository" },
    );
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    repositoryEnsure = failedEnsureCommandRun(plan.repositoryEnsureSteps, {
      cwd: mainRepo,
      scope: "repository",
      failure: `could not run: ${reason}`,
    });
    ctx.log.warn(
      "Repository convergence reported an unexpected error — cleanup is continuing.",
    );
  }
  for (const [index, command] of plan.repositoryEnsureSteps.entries()) {
    results.push({
      step: {
        kind: "repository-ensure",
        label: verbatimStepLabel(command),
        disposition: "run",
        note: "converge the trunk checkout on the landed tree",
      },
      outcome: repositoryEnsure.outcomes[index] ?? "failed",
    });
  }
  diagnostics.push(...repositoryEnsure.diagnostics);
  convergenceHints = mergeHintTexts(
    convergenceHints,
    repositoryEnsure.hints,
  );

  try {
    const smoke = await runLandingSmoke(
      mainRepo,
      landingConfig,
      plan,
      ctx.log,
    );
    results.push(...smoke.steps);
    diagnostics.push(...smoke.diagnostics);
    convergenceHints.push(...smoke.hints);
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    for (const smoke of plan.smokeSteps) {
      results.push({
        step: {
          kind: "job",
          label: verbatimStepLabel(smoke.label),
          disposition: "run",
          note: smoke.command,
          group: "Smoke",
        },
        outcome: "failed",
      });
      diagnostics.push({
        tool: smoke.label,
        severity: "error",
        message:
          `Landing-checkout smoke could not run in ${mainRepo}: ${reason}. Fix the command or its prerequisites, then run it again from that checkout.`,
        reproduce_cmd: smoke.command,
      });
    }
    ctx.log.warn(
      "Landing-checkout smoke could not complete — cleanup is continuing.",
    );
  }

  let checkoutClean: boolean | undefined;
  if (trackedDirtyAfterLanding === true) {
    checkoutClean = false;
  } else if (trackedDirtyAfterLanding === false) {
    try {
      checkoutClean = !(await hasUncommittedTrackedChanges(mainRepo) ?? true);
    } catch {
      checkoutClean = false;
    }
  }
  results.push({
    step: {
      kind: "checkout-clean-check",
      label: BUILT_IN_STEP_LABELS.checkTrunkCheckout,
      disposition: "run",
      note: checkoutClean === undefined
        ? "the immediate post-fast-forward tracked baseline was unavailable"
        : trackedDirtyAfterLanding === true
        ? "tracked changes existed immediately after the fast-forward checkout"
        : "report tracked files changed by post-landing convergence",
    },
    outcome: checkoutClean === undefined
      ? "skipped"
      : checkoutClean
      ? "ok"
      : "failed",
  });
  if (checkoutClean === false) {
    convergenceHints = mergeHintTexts(
      convergenceHints,
      hintTexts([
        fire(HINTS["accept-convergence-changed-tracked"], {
          trunk,
          mainRepo,
        }),
      ]),
    );
    ctx.log.warn(
      "Post-landing convergence changed tracked files in the trunk checkout — review git status after cleanup.",
    );
  }
  if (
    diagnostics.length > 0 &&
    !hasRegisteredActionableHint(convergenceHints)
  ) {
    convergenceHints = mergeHintTexts(
      convergenceHints,
      hintTexts([fire(HINTS["lifecycle-convergence-failed"])]),
    );
  }
  progress.convergenceHints.push(...convergenceHints);

  // tear down external resources (non-fatal, while still in the worktree so
  // @dir@-bearing destroys resolve, and before removal so no orphan is left)
  ctx.log.info("Tearing down the worktree's resources…");
  await teardownResources(ctx);
  done("resource-destroy", BUILT_IN_STEP_LABELS.teardownResources);

  // remove the worktree (from the main repo)
  try {
    await clearEffortGrant(ctx.cwd);
  } catch (error) {
    ctx.log.warn(
      `Could not clear the consumed effort grant before worktree removal: ${
        error instanceof Error ? error.message : String(error)
      }`,
    );
  }
  ctx.log.info(`Removing worktree: ${worktreePath}`);
  try {
    await removeWorktreeSafely(worktreePath, mainRepo);
  } catch {
    throw new WorktreeGitError(
      `The branch landed, but removing the worktree at ${worktreePath} failed. ` +
        `Your commits remain on ${worktreeBranch}. Run \`git worktree list\` to ` +
        `inspect its state, then run \`discern worktree prune\` from the main checkout.`,
    );
  }
  ctx.log.ok("Worktree directory removed.");
  done("git", BUILT_IN_STEP_LABELS.removeWorktree);
  progress.landing.worktree_removed = true;

  // Delete the now-merged branch.
  const del = await run(["branch", "-d", worktreeBranch], mainRepo);
  if (!del.success) {
    throw new WorktreeGitError(
      `The branch landed on the trunk (${trunk}), but Git could not delete the merged ` +
        `branch ${worktreeBranch}. Review the error below, then delete it with ` +
        `\`git branch -d ${worktreeBranch}\`.\nGit said: ${del.stderr.trim()}`,
    );
  }
  ctx.log.ok(`Deleted merged branch ${worktreeBranch}.`);
  done("git", BUILT_IN_STEP_LABELS.deleteBranch);
  progress.landing.branch_deleted = true;

  ctx.log.heading("Acceptance complete.");
  ctx.log.line(`  You are on ${trunk} in ${mainRepo}.`);
  if (proofLine !== undefined) {
    ctx.log.line(proofLine);
  }
  // The landing record: the proof for the tree that just landed, pasteable
  // into a PR body. Printed unindented so it relays as clean markdown; dimmed
  // so the quoted page stays visually secondary (dim is display-only — a
  // terminal copies the plain text).
  if (proofMarkdown !== undefined) {
    ctx.log.group("proof");
    for (
      const line of dimBlock(proofMarkdown, loggerSink(ctx.log).dim)
        .split("\n")
    ) {
      ctx.log.line(line);
    }
  }
  return {
    steps: results,
    gateValidation,
    proofMarkdown,
    proofLine,
    proofNote,
    convergenceHints,
    diagnostics,
    authorityWarnings,
  };
}

/**
 * Accept this worktree's branch onto the trunk — the `discern accept`
 * command, the single PUSH target of the landing model (composition happens on
 * the pull axis: `start --from` / `update --from`). Requires the latest main
 * is present beneath this branch, fast-forwards the trunk to the branch tip,
 * refreshes and converges the receiving checkout, tears down the worktree's
 * external resources, removes the clean worktree directory, and deletes the
 * now-merged branch.
 * Refuses without either a verified recorded grant or the `--confirmed`
 * conversation attestation (ADR 0134, amended by ADR 0194), then dirty
 * worktrees, dirty main checkouts, and a main checkout parked on a branch other
 * than the trunk. `--dry-run` shows the plan (after the read-only preconditions
 * pass) and touches nothing — and needs no authority, since it never lands.
 * Throws `WorktreeGitError` on any unrecoverable error (the branch keeps its
 * commits).
 */
export async function accept(
  ctx: LifecycleContext,
  opts: AcceptOpOptions = {},
): Promise<void> {
  const result = await acceptResult(ctx, {
    dryRun: opts.dryRun ?? false,
    confirmed: opts.confirmed ?? false,
    variance: opts.variance ?? [],
  });
  emitOrRenderWorktreeResult(ctx, result, opts.json ?? false);
}

/**
 * Perform the acceptance and return its {@link DiscernResult} — the plan (dry-run)
 * or the executed steps — without emitting or exiting. The single source the CLI's
 * `--json` ({@link accept}) and the MCP server both render. NOT pure: on an apply
 * it runs the real git mutations + resource teardown (narrating through `ctx.log`,
 * which the MCP server silences with a quiet logger). The read-only preconditions
 * (in a worktree, main updated, clean main checkout sitting on the trunk) still
 * throw `WorktreeGitError` when they refuse — the caller maps that to an error
 * envelope via {@link worktreeErrorResult}.
 */
export async function acceptResult(
  ctx: LifecycleContext,
  opts: { dryRun?: boolean; confirmed?: boolean; variance?: string[] } = {},
): Promise<DiscernResult<AcceptData>> {
  const dryRun = opts.dryRun ?? false;
  const confirmed = opts.confirmed ?? false;
  const variance = opts.variance ?? [];
  if (!dryRun) {
    return await withAcceptanceTransactionLock(
      ctx.cwd,
      () => executeAcceptResult(ctx, false, confirmed, variance),
    );
  }
  return await executeAcceptResult(ctx, true, confirmed, variance);
}

/**
 * Build or apply acceptance after the apply path has acquired its worktree lock.
 * Dry-runs enter directly because they neither recover nor mutate transaction
 * state.
 */
async function executeAcceptResult(
  ctx: LifecycleContext,
  dryRun: boolean,
  confirmed: boolean,
  varianceIds: readonly string[] = [],
): Promise<DiscernResult<AcceptData>> {
  await assertProjectRootIsRepoToplevel(ctx, "accept");
  // Resolve authority before the ordinary preconditions so an uncovered
  // flagless call still receives the consent refusal as its outermost contract.
  // Every read is mutation-free. A dry-run reports authority but needs none.
  let authority = await inspectLandingAuthority(
    ctx.cwd,
    ctx.config.repository.trunk,
  );
  const recoverySteps: StepResult[] = [];
  let authorizedVariances: AuthorizedVarianceData[] = [];
  let effectRoot: string | undefined;
  let effectConsent: LandingConsent | undefined;
  let effectProgress: AcceptExecutionProgress | undefined;
  try {
    if (!dryRun) {
      const interrupted = await inspectInterruptedAcceptance(
        ctx.cwd,
        ctx.config.repository.trunk,
      );
      if (interrupted.kind === "recorded") {
        // No recovery effect runs until journal-bound consent, currently
        // verified standing/effort authority, or this call's explicit
        // conversation attestation authorizes the recorded transition.
        const recoveryConsent = interrupted.consent ??
          availableLandingConsent(authority, confirmed) ??
          landingConsentForApply(authority, confirmed);
        const recovered = await recoverInterruptedAcceptance(
          ctx.cwd,
          interrupted,
        );
        const recoveryProgress = freshAcceptExecutionProgress([
          recoveryStep(
            recovered.kind === "ready" || recovered.recoveryPerformed
              ? "ok"
              : "failed",
          ),
        ]);
        recoveryProgress.landing.recovery_performed =
          recovered.recoveryPerformed;
        if (recovered.kind === "stopped") {
          recoveryProgress.landing.trunk_landed = recovered.trunkLanded;
        }
        if (
          recovered.recoveryPerformed ||
          (recovered.kind === "stopped" && recovered.trunkLanded)
        ) {
          effectRoot = interrupted.transaction.main_repo;
          effectConsent = recoveryConsent;
          effectProgress = recoveryProgress;
        }
        if (recovered.kind === "stopped") {
          if (
            recovered.recoveryPerformed || recovered.trunkLanded
          ) {
            throwPartialAcceptance(
              interrupted.transaction.main_repo,
              recoveryConsent,
              recoveryProgress,
              recovered.message,
            );
          }
          throw new WorktreeGitError(recovered.message);
        }

        recoverySteps.push(...recoveryProgress.steps);
        // A journal-only decision authorizes completion of THAT transaction, not
        // a fresh transition. Re-read after pre-CAS cleanup: a restored effort
        // claim or current standing grant can authorize the new attempt; otherwise
        // stop after the visible recovery effect and ask for current consent.
        authority = await inspectLandingAuthority(
          ctx.cwd,
          ctx.config.repository.trunk,
        );
        if (availableLandingConsent(authority, confirmed) === undefined) {
          const message =
            "Discern reconciled the interrupted acceptance before its trunk " +
            "transition. Its journal-bound consent covered only that interrupted " +
            "transaction and was not replayed into a new landing. Re-run " +
            "`discern accept --confirmed`, or record a standing or effort grant, " +
            "to authorize the intact branch's new transition.";
          throwPartialAcceptance(
            interrupted.transaction.main_repo,
            recoveryConsent,
            recoveryProgress,
            message,
          );
        }
      }
      // The checkpoint contract precedes ordinary consent: a missing or
      // stale declaration routes back to `done`, and a current declared-unmet
      // conclusion serves the owner's ONE complete decision (landing plus
      // each named variance) instead of a bare consent refusal.
      const checkpointState = await inspectAcceptanceCheckpoints(
        ctx.cwd,
        ctx.config,
      );
      for (const advisory of checkpointState.advisories) {
        ctx.log.warn(advisory);
      }
      authorizedVariances = enforceAcceptanceCheckpoints(checkpointState, {
        confirmed,
        varianceIds,
      });
      if (authorizedVariances.length === 0) {
        landingConsentForApply(authority, confirmed);
      }
    }
    const run = makeGitRunner(ctx);
    const plan = await buildAcceptPlan(ctx, run);
    // The plan proved the worktree clean. Re-read now so the authority used by
    // apply is over committed paths only, then bind it through validation to the
    // fast-forward boundary.
    authority = await inspectLandingAuthority(
      ctx.cwd,
      ctx.config.repository.trunk,
      { includeScopeEvidence: true },
    );
    if (dryRun) {
      const enginePlan = acceptPlanToEngine(plan);
      const checkpointState = await inspectAcceptanceCheckpoints(
        ctx.cwd,
        ctx.config,
      );
      enginePlan.details.push(
        `Authority:     ${landingAuthorityDetail(authority, confirmed)}`,
        ...authority.warnings.map((warning) => `Authority warning: ${warning}`),
        ...(checkpointState.stale.length > 0
          ? [
            `Checkpoints:   conclusions missing or stale (route to done): ${
              checkpointState.stale.join(", ")
            }`,
          ]
          : []),
        ...checkpointState.unmet.map((unmet) =>
          `Checkpoints:   '${unmet.id}' declared unmet — owner variance required to land`
        ),
        ...checkpointState.advisories.map((advisory) =>
          `Checkpoint advisory: ${advisory}`
        ),
      );
      return previewResult("accept", enginePlan);
    }
    // A variance forces current-conversation consent — the interlock above
    // verified the complete decision — so recorded grants are never consulted
    // when one stands.
    const consent: LandingConsent = authorizedVariances.length > 0
      ? { source: "conversation" }
      : landingConsentForApply(authority, confirmed);
    const progress = freshAcceptExecutionProgress(
      recoverySteps,
      changedLandingScopes(authority),
    );
    if (recoverySteps.length > 0) {
      progress.landing.recovery_performed = true;
    }
    effectRoot = plan.mainRepo;
    effectConsent = consent;
    effectProgress = progress;
    const executed = await executeAcceptPlan(
      ctx,
      run,
      plan,
      authority,
      consent,
      progress,
      authorizedVariances,
    );
    const result: DiscernResult<AcceptData> = appliedResult(
      "accept",
      executed.steps,
    );
    // The branch landed in the main checkout; report it so the MCP server can
    // re-aim its working root there now the worktree it operated on is gone
    // (ADR 0062). The plan resolved `mainRepo` before the removal.
    result.data = {
      root: plan.mainRepo,
      consent: cloneLandingConsent(consent),
      ...(authorizedVariances.length === 0
        ? {}
        : { variances: authorizedVariances.map((v) => ({ ...v })) }),
      ...(progress.scopesChanged.length === 0
        ? {}
        : { scopes_changed: [...progress.scopesChanged] }),
      landing: cloneLandingState(progress.landing),
      ...(authority.warnings.length + executed.authorityWarnings.length > 0
        ? {
          authority_warnings: [
            ...authority.warnings,
            ...executed.authorityWarnings,
          ],
        }
        : {}),
      gate_validation: executed.gateValidation,
      ...(executed.proofMarkdown !== undefined
        ? { proof: executed.proofMarkdown }
        : {}),
      ...(executed.proofLine !== undefined
        ? { proof_line: executed.proofLine }
        : {}),
      proof_note: executed.proofNote,
      ...(hasIgnoredFileChanges(plan.ignoredFileChanges)
        ? { ignored_file_changes: plan.ignoredFileChanges }
        : {}),
    };
    result.hints = executed.proofLine !== undefined
      ? mergeHintTexts(
        hintTexts([fire(HINTS["accept-relay-landing-proof"])]),
        executed.convergenceHints,
      )
      : executed.convergenceHints;
    if (executed.diagnostics.length > 0) {
      result.diagnostics = executed.diagnostics;
    }
    return result;
  } catch (error) {
    if (
      error instanceof WorktreeResultError &&
      error.result.error === "partial_acceptance"
    ) {
      throw error;
    }
    if (
      effectRoot !== undefined &&
      effectConsent !== undefined &&
      effectProgress !== undefined &&
      (effectProgress.landing.recovery_performed ||
        effectProgress.landing.trunk_landed ||
        effectProgress.landing.worktree_removed ||
        effectProgress.landing.branch_deleted)
    ) {
      throwPartialAcceptance(
        effectRoot,
        effectConsent,
        effectProgress,
        error instanceof Error ? error.message : String(error),
      );
    }
    if (error instanceof WorktreeResultError) {
      throw error;
    }
    throw error;
  }
}

/** Render bounded ignored-file drift evidence only when acceptance should surface it. */
function ignoredFileChangeDetail(
  summary: AcceptPlan["ignoredFileChanges"],
): string | undefined {
  if (!hasIgnoredFileChanges(summary)) {
    return undefined;
  }
  const more = summary.truncated
    ? `, +${summary.changed_total - summary.changed_roots.length} more`
    : "";
  return `Ignored files changed since setup: ${
    summary.changed_roots.join(", ")
  }${more}`;
}

/** If local-artifact templates live inside the worktree that accept is about to
 * remove, point materialization at the matching path in the main
 * checkout after landing. This is a no-op for installed binaries and external
 * projects, whose templates are outside the accepting worktree. */
export function remapWorktreeLocalTemplatesDir(
  templatesDir: string,
  worktreePath: string,
  mainRepo: string,
): string | undefined {
  const rel = relative(worktreePath, templatesDir);
  if (rel === "" || (!rel.startsWith("..") && !isAbsolute(rel))) {
    return join(mainRepo, rel);
  }
  return undefined;
}

/** Treat missing, unreadable, and nondirectory paths as unavailable template roots. */
async function directoryExists(path: string): Promise<boolean> {
  try {
    return (await Deno.stat(path)).isDirectory;
  } catch {
    return false;
  }
}

/** Remap worktree-local templates into the landed checkout when that directory exists. */
async function postLandingLocalTemplatesDir(
  worktreePath: string,
  mainRepo: string,
): Promise<string | undefined> {
  let templatesDir: string;
  try {
    templatesDir = await resolveTemplatesDir();
  } catch {
    return undefined;
  }
  const remapped = remapWorktreeLocalTemplatesDir(
    templatesDir,
    worktreePath,
    mainRepo,
  );
  return remapped !== undefined && await directoryExists(remapped)
    ? remapped
    : undefined;
}

/** Temporarily bind remapped templates while materializing the landed checkout. */
async function materializeLocalRefreshForLanding(
  root: string,
  logger: Logger,
  templatesDir: string | undefined,
): Promise<Awaited<ReturnType<typeof materializeLocalRefreshArtifacts>>> {
  if (templatesDir === undefined) {
    return await materializeLocalRefreshArtifacts(root, logger);
  }

  const variable = DISCERN_ENVIRONMENT_VARIABLES.templatesDirectory;
  const previous = Deno.env.get(variable);
  Deno.env.set(variable, templatesDir);
  try {
    return await materializeLocalRefreshArtifacts(root, logger);
  } finally {
    if (previous === undefined) {
      Deno.env.delete(variable);
    } else {
      Deno.env.set(variable, previous);
    }
  }
}

// How much integration detail rides inline before an agent is pointed at git for
// the rest (ADR 0064). Caps protect the agent's context; the `range` anchors + the
// escape-hatch hint make the overflow a single deliberate `git` call, not a dead end.
// `overlap` — the priority signal — is capped loosely; it is already a narrow set.
const UPDATE_COMMIT_CAP = 10;
const UPDATE_FILE_CAP = 20;
const UPDATE_OVERLAP_CAP = 50;

/** Stable `UpdateData.regenerated` name for refresh-compiled agent/ADR files. */
export const UPDATE_BUILTIN_GENERATED_GROUP = "discern:refresh";

/** Build the {@link UpdateData} `range` from the anchors, carrying `after` only
 * when it exists (an apply; a `--dry-run` preview has no merged HEAD). */
function buildRange(
  anchors: { base: string; before: string; main: string; after?: string },
): UpdateData["range"] {
  const range: UpdateData["range"] = {
    base: anchors.base,
    before: anchors.before,
    main: anchors.main,
  };
  if (anchors.after !== undefined) {
    range.after = anchors.after;
  }
  return range;
}

/**
 * Summarize what an integration brought in BENEATH the branch (ADR 0064) — the core
 * DX of the verb. From the merge's SHA anchors it computes the commits + files landed
 * (capped), the OVERLAP with the branch's own changes (the hot zone — files git merged
 * cleanly that may still conflict semantically), and the fire-scopes the incoming change
 * touches; then it builds the structured {@link UpdateData} and the agent-facing
 * hints. `predicted` distinguishes a `--dry-run` (no `after`; the file delta is the
 * three-dot `before...main` prediction) from an apply (the real `before..after` tree
 * change). Fails open: any error — or a missing load-bearing anchor — yields
 * `{ data: undefined, hints: [<plain fallback>] }` and never throws, so on an apply a
 * summary hiccup can never undo or fail the landed merge.
 */
async function summarizeIntegration(
  ctx: LifecycleContext,
  anchors: { base: string; before: string; main: string; after?: string },
  opts: { predicted: boolean; source: string },
): Promise<{ data: UpdateData | undefined; hints: FiredHint[] }> {
  const { source, predicted } = opts;
  const fallback = [
    fire(HINTS["update-summary-fallback"], { source, predicted }),
  ];
  // Nothing to diff against without the two load-bearing anchors.
  if (anchors.before === "" || anchors.main === "") {
    return { data: undefined, hints: fallback };
  }
  try {
    const delta = await integrationDelta(ctx.cwd, anchors, {
      predicted,
      commitCap: UPDATE_COMMIT_CAP,
      fileCap: UPDATE_FILE_CAP,
    });

    // Overlap = the branch's own files ∩ the files that changed beneath it — the hot
    // zone a clean merge can't vet. Shared with status's behind report via overlapPaths.
    const { overlap, total: overlapTotal } = overlapPaths(
      delta.ownPaths,
      delta.theirsPaths,
      UPDATE_OVERLAP_CAP,
    );

    const data: UpdateData = {
      // A pure fast-forward iff the branch tip was already an ancestor of main
      // (base === before) — derivable in both the apply and the predicted paths.
      behind: delta.commitsTotal,
      fast_forward: anchors.base !== "" && anchors.base === anchors.before,
      commits: delta.commits,
      commits_total: delta.commitsTotal,
      commits_truncated: delta.commitsTruncated,
      files: delta.files,
      files_total: delta.filesTotal,
      files_truncated: delta.filesTruncated,
      overlap,
      overlap_total: overlapTotal,
      scopes_incoming: scopesForPaths(delta.theirsPaths, ctx.config),
      range: buildRange(anchors),
    };
    return {
      data,
      hints: updateHints(data, source, predicted),
    };
  } catch {
    return { data: undefined, hints: fallback };
  }
}

/**
 * The agent-facing hints for an integration — overlap-first. The headline either
 * flags the files the branch and the incoming source BOTH changed (re-read these;
 * a clean merge can't catch a semantic conflict) or reports that none overlap.
 * When a data list is capped, its exact full-list command joins that same summary
 * hint rather than creating another pagination line.
 */
function updateHints(
  data: UpdateData,
  source: string,
  predicted: boolean,
): FiredHint[] {
  const { before, main, after } = data.range;
  const diffRange = after === undefined
    ? `${before}...${main}`
    : `${before}..${after}`;
  const filesRange = data.files_truncated ? diffRange : undefined;
  const commitsRange = data.commits_truncated ? { before, main } : undefined;

  if (data.overlap.length > 0) {
    return [
      fire(HINTS["update-overlap"], {
        source,
        overlap: data.overlap,
        overlapTotal: data.overlap_total,
        predicted,
        filesRange,
        commitsRange,
      }),
    ];
  }
  return [
    fire(HINTS["update-no-overlap"], {
      source,
      predicted,
      filesRange,
      commitsRange,
    }),
  ];
}

/**
 * Narrate an integration's summary for a human (apply or `--dry-run`), through
 * `ctx.log` — silenced behind the MCP server's quiet logger, printed on the CLI. The
 * human echo of the {@link UpdateData} the `--json`/tool result carries: the
 * commits + files landed, then the overlap hot zone (or the all-clear).
 */
function narrateIntegration(
  ctx: LifecycleContext,
  data: UpdateData,
  predicted: boolean,
): void {
  ctx.log.info(
    `${
      predicted ? "Would bring in" : "Brought in"
    } ${data.behind} commit(s), ` +
      `${data.files_total} file(s) changed beneath your work.`,
  );
  for (const c of data.commits) {
    ctx.log.detail(`  ${c.sha}  ${c.subject}`);
  }
  if (data.commits_truncated) {
    ctx.log.detail(`  … (+${data.commits_total - data.commits.length} more)`);
  }
  if (data.overlap.length > 0) {
    ctx.log.warn(
      `${data.overlap_total} file(s) you've changed were also changed — re-check ` +
        `for semantic conflicts:`,
    );
    for (const p of data.overlap) {
      ctx.log.detail(`  ${p}`);
    }
    if (data.overlap_total > data.overlap.length) {
      ctx.log.detail(`  … (+${data.overlap_total - data.overlap.length} more)`);
    }
  } else {
    ctx.log.ok("None of the files you've changed were touched by the merge.");
  }
}

/**
 * The read-only diagnosis an integration acts on — the worktree precondition plus
 * how far behind the source the branch is. Asserts it is run from inside a linked
 * worktree (throwing the same `WorktreeGitError` accept does, so a plan only
 * exists for an integration that may proceed) and resolves the branch name + gap
 * read-only, so building a plan — and `--dry-run` — never mutates. The source is
 * the trunk by default; `from` pulls any ref instead (resolved through the same
 * {@link resolveCommitRef} as `start --from`, refusing an unknown or ambiguous
 * name in plain language).
 */
async function buildUpdatePlan(
  ctx: LifecycleContext,
  from?: string,
): Promise<UpdatePlan> {
  await assertOpSide("update", ctx.cwd);
  const run = makeGitRunner(ctx);
  const current = (await run(["branch", "--show-current"])).stdout.trim();
  const worktreeBranch = current !== "" ? current : "(detached)";
  const repositoryEnsureSteps = ctx.config.repository.ensure;
  const worktreeEnsureSteps = ctx.config.worktree.setup.ensure;
  const generatedGroups = resolveGeneratedGroups(ctx.config);
  const refreshCompiledPaths = await updateRefreshCompiledPaths(ctx);

  if (from !== undefined && from.trim() !== "") {
    const source = from.trim();
    await resolveCommitRef(ctx.cwd, source); // refuses unknown/ambiguous
    const state = await refMergedState(ctx.cwd, source);
    return {
      source,
      fromOverride: true,
      worktreeBranch,
      behind: state.behind,
      alreadyUpdated: state.already,
      generatedGroups,
      refreshCompiledPaths,
      repositoryEnsureSteps,
      worktreeEnsureSteps,
    };
  }

  const merged = await assertMainMerged(
    ctx.cwd,
    ctx.config.repository.trunk,
  );
  return {
    source: integrationBranch(ctx.config.repository.trunk),
    fromOverride: false,
    worktreeBranch,
    behind: merged.kind === "behind" ? Number(merged.behind) || 0 : 0,
    alreadyUpdated: merged.kind !== "behind",
    generatedGroups,
    refreshCompiledPaths,
    repositoryEnsureSteps,
    worktreeEnsureSteps,
  };
}

/**
 * Exact paths the built-in refresh compile owns. The agent-file targets come
 * from the renderer's output map, and the ADR target comes from the same state
 * computation the refresh writer consumes. A read failure narrows the safe set;
 * it never guesses a filename and resolves too much.
 */
async function updateRefreshCompiledPaths(
  ctx: LifecycleContext,
): Promise<string[]> {
  const paths: string[] = [];
  try {
    paths.push(...(await renderAgentFiles(ctx.root, ctx.config)).keys());
  } catch {
    // The later refresh step reports the compiler failure. Conflict policy
    // fails closed meanwhile: an unknown target is not safe to auto-resolve.
  }
  try {
    const index = await adrIndexState(ctx.root, ctx.config.map.dir);
    if (index.kind !== "absent") {
      paths.push(index.path);
    }
  } catch {
    // Same fail-closed rule as the agent renderer above.
  }
  return [...new Set(paths)];
}

/** Which declared/built-in generator owns `path`, if any. */
function updateGeneratedOwner(
  plan: UpdatePlan,
  path: string,
): string | undefined {
  const declared = generatedGroupForPath(plan.generatedGroups, path);
  if (declared !== undefined) {
    return declared.name;
  }
  return plan.refreshCompiledPaths.includes(path)
    ? UPDATE_BUILTIN_GENERATED_GROUP
    : undefined;
}

/** The refusal shown when updating `source` conflicts — names the conflicted
 * files (the merge is already aborted, the tree is clean) and the recovery that
 * CONVERGES: resolve the merge by hand, then re-run `discern update` — the
 * no-op re-run restores the agent-file refresh and the `[worktree.setup].ensure`
 * convergence the aborted merge skipped. */
function updateConflictMessage(
  plan: UpdatePlan,
  files: string[],
  resolvable: string[],
  aborted: boolean,
  resolutionFailure?: string,
): string {
  if (resolvable.length > 0 && resolvable.length < files.length) {
    const resolvableSet = new Set(resolvable);
    const judgment = files.filter((path) => !resolvableSet.has(path));
    const rerun = plan.fromOverride
      ? `discern update --from ${plan.source}`
      : "discern update";
    const split = ` These paths need your judgment: ${judgment.join(", ")}. ` +
      `These generated paths would have self-resolved: ${
        resolvable.join(", ")
      }.`;
    if (!aborted) {
      return `Updating ${plan.source} conflicts.${split} Stepping aside ` +
        `failed too, so the merge is still in progress in your tree. Either ` +
        `resolve the conflicts and commit the merge, or run ` +
        `\`git merge --abort\` to discard it; then re-run \`${rerun}\`.`;
    }
    return `Updating ${plan.source} conflicts.${split} The merge was aborted — ` +
      `your tree is untouched. Merge it yourself (\`git merge ${plan.source}\`), ` +
      `resolve the conflicts, commit the result, then re-run \`${rerun}\` — the ` +
      `no-op re-run re-materializes the agent files and re-runs the setup ` +
      `convergence the aborted merge skipped.`;
  }
  const where = files.length > 0 ? ` in: ${files.join(", ")}` : "";
  const rerun = plan.fromOverride
    ? `discern update --from ${plan.source}`
    : "discern update";
  if (resolutionFailure !== undefined) {
    const failure = resolutionFailure.trim() === ""
      ? "Git did not complete the generated-only resolution"
      : resolutionFailure.trim();
    if (!aborted) {
      return `Updating ${plan.source} conflicts${where}. Discern took the ` +
        `incoming side of every generated path, but could not complete the ` +
        `merge: ${failure}. The merge is still in progress. Resolve it and ` +
        `commit, or run \`git merge --abort\`; then re-run \`${rerun}\`.`;
    }
    return `Updating ${plan.source} conflicts${where}. Discern took the ` +
      `incoming side of every generated path, but could not complete the ` +
      `merge: ${failure}. The merge was aborted — your tree is untouched. ` +
      `Fix the reported Git failure, then re-run \`${rerun}\`.`;
  }
  if (!aborted) {
    return `Updating ${plan.source} conflicts${where} — and stepping aside ` +
      `failed too, so the merge is still in progress in your tree. Either ` +
      `resolve the conflicts and commit the merge, or run ` +
      `\`git merge --abort\` to discard it; then re-run \`${rerun}\`.`;
  }
  return `Updating ${plan.source} conflicts${where}. The merge was aborted — ` +
    `your tree is untouched. Merge it yourself (\`git merge ${plan.source}\`), ` +
    `resolve the conflicts, commit the result, then re-run \`${rerun}\` — the ` +
    `no-op re-run re-materializes the agent files and re-runs the setup ` +
    `convergence the aborted merge skipped.`;
}

/** One planned job per configured generated-artifact group. */
function updateGeneratedJobGroup(
  groups: readonly ResolvedGeneratedGroup[],
): JobGroup | undefined {
  if (groups.length === 0) {
    return undefined;
  }
  return {
    stage: "build",
    mode: "parallel",
    heading: "Regenerating declared artifacts...",
    display: "Generated artifacts",
    jobs: groups.map((group) => ({
      label: `generated:${group.name}`,
      command: group.run,
      kind: "custom",
      reportStage: "build",
      willRun: true,
      ...(group.timeout === undefined ? {} : { timeoutS: group.timeout }),
    })),
  };
}

interface UpdateGeneratedRun {
  steps: StepResult[];
  diagnostics: Diagnostic[];
  hints: string[];
  executed: string[];
  successful: Set<string>;
}

/** Run every configured generator through the gate's bounded job runner. */
async function runUpdateGeneratedGroups(
  ctx: LifecycleContext,
  groups: readonly ResolvedGeneratedGroup[],
): Promise<UpdateGeneratedRun> {
  const group = updateGeneratedJobGroup(groups);
  if (group === undefined) {
    return {
      steps: [],
      diagnostics: [],
      hints: [],
      executed: [],
      successful: new Set(),
    };
  }
  ctx.log.info("Regenerating declared artifacts...");
  try {
    const policy = resolveGateRunPolicy(ctx.config.gate.stream, {
      kind: "quiet-result",
    });
    const context = gateRunContext(ctx.root, ctx.config, policy);
    const run = await runJobGroups(
      [group],
      { ...context.runOpts, failFast: false },
      context.out,
      context.slots,
    );
    const serialized = await serializeJobSteps([group], run.results);
    const executed: string[] = [];
    const successful = new Set<string>();
    for (const configured of groups) {
      const result = run.results.get(`generated:${configured.name}`);
      if (result === undefined) {
        continue;
      }
      executed.push(configured.name);
      if (result.code === 0) {
        successful.add(configured.name);
      }
    }
    if (successful.size === groups.length) {
      ctx.log.ok("Declared artifacts regenerated.");
    } else {
      ctx.log.warn("A declared generator failed — the merge is kept.");
    }
    return {
      steps: serialized.steps,
      diagnostics: serialized.diagnostics,
      hints: hintTexts(serialized.hints),
      executed,
      successful,
    };
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    ctx.log.warn(
      "Declared artifact regeneration reported an error — continuing.",
    );
    return {
      steps: groups.map((configured) => ({
        step: {
          kind: "job",
          label: verbatimStepLabel(`generated:${configured.name}`),
          disposition: "run",
          note: configured.run,
          group: "Generated artifacts",
        },
        outcome: "failed",
      })),
      diagnostics: [{
        tool: "generated-artifacts",
        severity: "error",
        message: `Could not run the declared generators: ${reason}`,
        reproduce_cmd: groups[0]?.run ?? "discern update",
      }],
      hints: [],
      executed: groups.map((configured) => configured.name),
      successful: new Set(),
    };
  }
}

/** Whether `path` was re-derived by a generator that completed successfully. */
function successfullyConvergedPath(
  plan: UpdatePlan,
  successful: ReadonlySet<string>,
  refreshedSharedPaths: ReadonlySet<string>,
  path: string,
): boolean {
  const declared = generatedGroupForPath(plan.generatedGroups, path);
  if (declared !== undefined && successful.has(declared.name)) {
    return true;
  }
  return successful.has(UPDATE_BUILTIN_GENERATED_GROUP) &&
    (plan.refreshCompiledPaths.includes(path) ||
      refreshedSharedPaths.has(path));
}

/** Commit only successfully re-derived paths, leaving unrelated changes alone. */
async function commitUpdateRegeneratedArtifacts(
  ctx: LifecycleContext,
  plan: UpdatePlan,
  successful: ReadonlySet<string>,
  refreshedSharedPaths: ReadonlySet<string>,
  enabled: boolean,
): Promise<{ step: StepResult; diagnostic?: Diagnostic }> {
  const skipped = (note: string): { step: StepResult } => ({
    step: {
      step: {
        kind: "git",
        label: BUILT_IN_STEP_LABELS.commitRegeneratedArtifacts,
        disposition: "skip",
        note,
      },
      outcome: "skipped",
    },
  });
  const status = await makeGitRunner(ctx)([
    "status",
    "--porcelain",
    "-z",
    "--untracked-files=normal",
  ]);
  if (!status.success) {
    return {
      step: {
        step: {
          kind: "git",
          label: BUILT_IN_STEP_LABELS.commitRegeneratedArtifacts,
          disposition: "run",
          note: "commit regenerated outputs when their bytes changed",
        },
        outcome: "failed",
      },
      diagnostic: {
        tool: "update-regeneration",
        severity: "error",
        message: "Could not inspect regenerated paths after the merge.",
        reproduce_cmd: "git status --short",
      },
    };
  }
  const paths = new Set<string>();
  for (const entry of parsePorcelainZ(status.stdout)) {
    if (
      successfullyConvergedPath(
        plan,
        successful,
        refreshedSharedPaths,
        entry.path,
      )
    ) {
      paths.add(entry.path);
    }
    if (
      entry.origPath !== undefined &&
      successfullyConvergedPath(
        plan,
        successful,
        refreshedSharedPaths,
        entry.origPath,
      )
    ) {
      paths.add(entry.origPath);
    }
  }
  const committedPaths = [...paths].sort();
  if (committedPaths.length === 0) {
    return skipped(
      enabled
        ? "regeneration changed no declared artifact bytes"
        : "no merge; refresh changed no tracked artifact bytes",
    );
  }
  if (!enabled) {
    ctx.log.warn(
      `Refresh changed tracked artifacts without a merge: ${
        committedPaths.join(", ")
      }. Review and commit them before continuing.`,
    );
    return {
      step: {
        step: {
          kind: "git",
          label: BUILT_IN_STEP_LABELS.commitRegeneratedArtifacts,
          disposition: "run",
          note: `no merge; review and commit ${committedPaths.join(", ")}`,
        },
        outcome: "failed",
      },
      diagnostic: {
        tool: "update-regeneration",
        severity: "error",
        message: `Refresh changed tracked artifacts without a merge: ${
          committedPaths.join(", ")
        }. Review and commit them.`,
        reproduce_cmd: "git status --short",
      },
    };
  }
  const committed = await commitUpdateRegeneration(ctx.cwd, committedPaths);
  if (committed.success) {
    ctx.log.ok(`Committed regenerated artifacts: ${committedPaths.join(", ")}`);
    return {
      step: {
        step: {
          kind: "git",
          label: BUILT_IN_STEP_LABELS.commitRegeneratedArtifacts,
          disposition: "run",
          note: committedPaths.join(", "),
        },
        outcome: "ok",
      },
    };
  }
  const reason = committed.stderr.trim() || "Git did not create the commit";
  ctx.log.warn("Could not commit regenerated artifacts — the merge is kept.");
  return {
    step: {
      step: {
        kind: "git",
        label: BUILT_IN_STEP_LABELS.commitRegeneratedArtifacts,
        disposition: "run",
        note: committedPaths.join(", "),
      },
      outcome: "failed",
    },
    diagnostic: {
      tool: "update-regeneration",
      severity: "error",
      message: `Could not commit regenerated artifacts: ${reason}`,
      reproduce_cmd: "git status --short",
    },
  };
}

/**
 * Run the complete refresh reconciliation, then re-run the convergent
 * `[worktree.setup].ensure` commands — the convergence tail every integration pass
 * shares, merge or no-op. Non-fatal throughout: a refresh or convergence hiccup is
 * recorded as a failed step, never undoing a landed merge or failing the pass (the
 * gate is the backstop). Returns the step results plus any refresh hints.
 */
async function runUpdateConvergence(
  ctx: LifecycleContext,
  plan: UpdatePlan,
  opts: { commitRegenerated: boolean },
): Promise<{
  steps: StepResult[];
  refreshHints: string[];
  diagnostics: Diagnostic[];
  regenerated: string[];
}> {
  const generated = await runUpdateGeneratedGroups(ctx, plan.generatedGroups);
  ctx.log.info("Refreshing artifacts…");
  let refresh: LifecycleRefreshRun;
  const refreshedSharedPaths = new Set<string>();
  try {
    const refreshed = await compileInstructions(ctx.root, ctx.log);
    refresh = instructionRefreshRun(refreshed, ctx.root);
    for (const path of refreshed.trackedArtifactsChanged) {
      refreshedSharedPaths.add(path);
    }
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    refresh = failedRefreshRun([reason], ctx.root);
    ctx.log.warn("Artifact refresh reported an error — continuing.");
  }
  const steps: StepResult[] = [...generated.steps, {
    step: {
      kind: "refresh",
      label: BUILT_IN_STEP_LABELS.completeRefresh,
      disposition: "run",
      note: FULL_REFRESH_STEP_NOTE,
    },
    outcome: refresh.ok ? "ok" : "failed",
  }];
  const successful = new Set(generated.successful);
  if (refresh.ok) {
    successful.add(UPDATE_BUILTIN_GENERATED_GROUP);
  }
  const committed = await commitUpdateRegeneratedArtifacts(
    ctx,
    plan,
    successful,
    refreshedSharedPaths,
    opts.commitRegenerated,
  );
  steps.push(committed.step);
  const repositoryEnsure = await runRepositoryEnsureSteps(ctx, {
    fatal: false,
  });
  for (const [index, step] of plan.repositoryEnsureSteps.entries()) {
    steps.push({
      step: {
        kind: "repository-ensure",
        label: verbatimStepLabel(step),
        disposition: "run",
        note: "converge the checkout on the current tree",
      },
      outcome: repositoryEnsure.outcomes[index] ?? "failed",
    });
  }
  const worktreeEnsure = await runWorktreeEnsureSteps(ctx, {
    fatal: false,
  });
  for (const [index, step] of plan.worktreeEnsureSteps.entries()) {
    steps.push({
      step: {
        kind: "setup-ensure",
        label: verbatimStepLabel(step),
        disposition: "run",
        note: "converge the worktree on the current tree",
      },
      outcome: worktreeEnsure.outcomes[index] ?? "failed",
    });
  }
  const diagnostics = [
    ...generated.diagnostics,
    ...(committed.diagnostic === undefined ? [] : [committed.diagnostic]),
    ...refresh.diagnostics,
    ...repositoryEnsure.diagnostics,
    ...worktreeEnsure.diagnostics,
  ];
  let convergenceHints = mergeHintTexts(
    generated.hints,
    refresh.hints,
    repositoryEnsure.hints,
    worktreeEnsure.hints,
  );
  if (
    diagnostics.length > 0 &&
    !hasRegisteredActionableHint(convergenceHints)
  ) {
    convergenceHints = mergeHintTexts(
      convergenceHints,
      hintTexts([fire(HINTS["lifecycle-convergence-failed"])]),
    );
  }
  return {
    steps,
    refreshHints: convergenceHints,
    diagnostics,
    regenerated: [
      ...generated.executed,
      UPDATE_BUILTIN_GENERATED_GROUP,
    ],
  };
}

/**
 * Apply an integration: merge the source (the trunk, or the `--from` ref) in,
 * run the complete refresh reconciliation, then run checkout-shared
 * `[repository].ensure` and linked-worktree `[worktree.setup].ensure` on the
 * merged tree. When the branch already contains the source nothing is merged, but
 * the refresh + ensure convergence STILL runs (like session start) — that is what
 * makes "re-run `discern update`" the recovery after a manually resolved
 * conflict, restoring everything the aborted merge skipped. A dirty tree or a
 * merge conflict throws `WorktreeGitError` (the conflict steps aside via
 * `git merge --abort` first, so the tree is left clean). The post-merge `ensure`
 * is non-fatal: a convergence hiccup is recorded as a failed step, never undoing
 * the landed merge. Narrates through `ctx.log`; returns the per-step results for
 * `--json`.
 */
async function executeUpdatePlan(
  ctx: LifecycleContext,
  plan: UpdatePlan,
): Promise<DiscernResult<UpdateData>> {
  const { source } = plan;
  const outcome = await updateMain(
    ctx.cwd,
    ctx.config.repository.trunk,
    {
      ...(plan.fromOverride ? { from: source } : {}),
      autoResolvable: (path) => updateGeneratedOwner(plan, path) !== undefined,
    },
  );
  switch (outcome.kind) {
    case "skipped":
    case "already": {
      ctx.log.ok(
        `Already up to date with ${source} — nothing to merge; converging the worktree.`,
      );
      const steps: StepResult[] = [
        {
          step: {
            kind: "git",
            label: BUILT_IN_STEP_LABELS.merge,
            disposition: "skip",
            note: `already up to date with ${source}`,
          },
          outcome: "skipped",
        },
        {
          step: {
            kind: "git",
            label: BUILT_IN_STEP_LABELS.autoResolveGeneratedConflicts,
            disposition: "skip",
            note: "no merge conflicts to classify",
          },
          outcome: "skipped",
        },
      ];
      const convergence = await runUpdateConvergence(ctx, plan, {
        commitRegenerated: false,
      });
      steps.push(...convergence.steps);
      const result: DiscernResult<UpdateData> = appliedResult(
        "update",
        steps,
      );
      result.hints = convergence.refreshHints;
      if (convergence.diagnostics.length > 0) {
        result.diagnostics = convergence.diagnostics;
      }
      return result;
    }
    case "dirty":
      throw new WorktreeGitError(
        "This worktree has uncommitted tracked changes, and update merges only into a " +
          "clean tree. Commit or stash them, then re-run `discern update`.",
      );
    case "conflict":
      throw new WorktreeGitError(
        updateConflictMessage(
          plan,
          outcome.files,
          outcome.resolvable,
          outcome.aborted,
          outcome.resolutionFailure,
        ),
      );
    case "merge_failed":
      // Git refused before any merge began — unrelated histories, an untracked
      // file in the way. The tree is untouched; the cause is git's to name.
      throw new WorktreeGitError(
        `Updating ${plan.source} failed before any merge began — your ` +
          `tree is untouched. Git refused:\n    ${outcome.reason}\n` +
          `Fix the cause git names, then re-run \`${
            plan.fromOverride
              ? `discern update --from ${plan.source}`
              : "discern update"
          }\`.`,
      );
    case "updated": {
      ctx.log.heading(`Updating ${source}…`);
      ctx.log.ok(
        outcome.fastForward
          ? `Fast-forwarded to ${source} (+${outcome.behind} commit(s)).`
          : `Merged ${source} (was behind by ${outcome.behind} commit(s)).`,
      );
      const steps: StepResult[] = [
        {
          step: {
            kind: "git",
            label: BUILT_IN_STEP_LABELS.merge,
            disposition: "run",
            note: outcome.fastForward
              ? `fast-forwarded ${source}`
              : `merged ${source}`,
          },
          outcome: "ok",
        },
        {
          step: {
            kind: "git",
            label: BUILT_IN_STEP_LABELS.autoResolveGeneratedConflicts,
            disposition: outcome.autoResolved.length > 0 ? "run" : "skip",
            note: outcome.autoResolved.length > 0
              ? outcome.autoResolved.join(", ")
              : "the merge had no generated-only conflict",
          },
          outcome: outcome.autoResolved.length > 0 ? "ok" : "skipped",
        },
      ];
      // Refresh + converge — the shared tail; a merge can bring in another line
      // of work's instructions/skill edits, generated metadata, or a changed lockfile.
      const convergence = await runUpdateConvergence(ctx, plan, {
        commitRegenerated: true,
      });
      steps.push(...convergence.steps);
      // Keep the ADR-0064 range anchored to the merge itself. A regeneration
      // follow-up commit is update's derived-state bookkeeping, not an incoming
      // file or commit, and the additive fields below report that work directly.
      const summary = await summarizeIntegration(ctx, outcome, {
        predicted: false,
        source,
      });
      if (summary.data !== undefined) {
        if (outcome.autoResolved.length > 0) {
          summary.data.auto_resolved = [...outcome.autoResolved];
        }
        summary.data.regenerated = [...convergence.regenerated];
        narrateIntegration(ctx, summary.data, false);
      }
      if (outcome.autoResolved.length > 0) {
        ctx.log.ok(
          `Resolved ${outcome.autoResolved.length} generated conflict(s); ` +
            `regenerated ${convergence.regenerated.join(", ")}.`,
        );
      }
      ctx.log.ok("Update complete.");
      const result: DiscernResult<UpdateData> = appliedResult(
        "update",
        steps,
      );
      result.data = summary.data;
      result.hints = mergeHintTexts(
        hintTexts(summary.hints),
        convergence.refreshHints,
      );
      if (convergence.diagnostics.length > 0) {
        result.diagnostics = convergence.diagnostics;
      }
      return result;
    }
  }
}

/**
 * Bring an integration source into this worktree's branch and run the complete
 * refresh reconciliation — the `discern update` command, the deterministic
 * inverse of `accept` and the action that resolves `done`'s fail-fast merge
 * check. The source is the trunk by default; `--from <ref>` pulls any ref instead
 * (the landing model's pull axis — how work composes below the trunk). Runs from
 * inside a linked worktree only; merges into a clean tree only. When the branch
 * already contains the source nothing merges, but the refresh + ensure
 * convergence still runs; on a conflict it aborts the merge and refuses, leaving
 * a clean tree. `--dry-run` shows the plan (after the worktree precondition
 * passes) and touches nothing. Throws `WorktreeGitError` on a refusal (the caller
 * maps it to an error envelope).
 */
export async function update(
  ctx: LifecycleContext,
  opts: WorktreeOpOptions & { from?: string } = {},
): Promise<void> {
  const result = await updateResult(ctx, {
    dryRun: opts.dryRun ?? false,
    ...(opts.from !== undefined ? { from: opts.from } : {}),
  });
  emitOrRenderWorktreeResult(ctx, result, opts.json ?? false, {
    afterPlan: (r) => {
      if (r.data !== undefined) {
        narrateIntegration(ctx, r.data, true);
      }
    },
  });
}

/**
 * Perform the integration and return its {@link DiscernResult} — the plan (dry-run)
 * or the executed steps — without emitting or exiting. The single source the CLI's
 * `--json` ({@link update}) and the MCP server both render. NOT pure on an apply:
 * it runs the real `git merge` + re-materialize (narrating through `ctx.log`, which
 * the MCP server silences with a quiet logger). The worktree precondition throws
 * `WorktreeGitError`, as does a refusal on a dirty tree, a conflict, or an
 * unknown/ambiguous `from` ref — the caller maps that to an error envelope via
 * {@link worktreeErrorResult}.
 */
export async function updateResult(
  ctx: LifecycleContext,
  opts: { dryRun?: boolean; from?: string } = {},
): Promise<DiscernResult<UpdateData>> {
  const plan = await buildUpdatePlan(ctx, opts.from);
  if (opts.dryRun ?? false) {
    const preview: DiscernResult<UpdateData> = previewResult(
      "update",
      updatePlanToEngine(plan),
    );
    // Predict what the merge WOULD bring in (ADR 0064) — the same summary as an
    // apply, computed read-only from the fork point (no `after`; the file delta is
    // the three-dot `before...<source>`). Skipped on a no-op (nothing to update).
    if (!plan.alreadyUpdated) {
      const anchors = await resolveIntegrationAnchors(ctx.cwd, plan.source);
      const summary = await summarizeIntegration(ctx, anchors, {
        predicted: true,
        source: plan.source,
      });
      if (summary.data !== undefined) {
        summary.data.regenerated = [
          ...plan.generatedGroups.map((group) => group.name),
          UPDATE_BUILTIN_GENERATED_GROUP,
        ];
      }
      preview.data = summary.data;
      preview.hints = hintTexts(summary.hints);
    }
    return preview;
  }
  return await executeUpdatePlan(ctx, plan);
}

// ── start (create a fresh worktree to inhabit, from the main checkout) ──────────

/** Whether a path exists on disk (any type) — the collision check `discern start`
 * uses so a minted id never lands on an existing directory. */
async function pathPresent(p: string): Promise<boolean> {
  try {
    await Deno.lstat(p);
    return true;
  } catch {
    return false;
  }
}

/**
 * The deterministic dev-server ports currently claimed by LIVE worktrees — each
 * derived from the worktree's own resolved id, so no registry or env file is
 * needed. Used at mint time to re-roll an id whose port would collide with a
 * live sibling's (two worktrees hashing to the same port would otherwise fight
 * over it, unexplained). Empty when `[worktree].port` is off. Fails open per row.
 */
export async function livePortsInUse(
  ctx: LifecycleContext,
  settings: IdentitySettings,
): Promise<Set<number>> {
  const ports = new Set<number>();
  if (!ctx.config.worktree.port) {
    return ports;
  }
  const fleet = await listWorktreeFleet(
    ctx.cwd,
    ctx.config.repository.trunk,
  );
  for (const row of fleet) {
    if (row.isMain) {
      continue;
    }
    const id = await resolveWorktreeId(settings, row.path).catch(() =>
      undefined
    );
    if (id !== undefined) {
      ports.add(deriveIdentity(id, settings).port);
    }
  }
  return ports;
}

/**
 * Mint a fresh worktree id whose `<branch_prefix><id>` branch AND `<root>/<id>`
 * directory are both free — so `discern start` always *creates* a new worktree
 * and never adopts an existing one — and whose derived PORT doesn't collide with
 * a live worktree's (`opts.usedPorts`). The random hex tail in
 * {@link generateWorktreeId} makes an id collision astronomically unlikely and a
 * port collision merely unlikely (a 2000-wide band), so both are verified and
 * re-rolled a bounded number of times. Port uniqueness is BEST-EFFORT: when the
 * attempts exhaust (a band that crowded means dozens of live worktrees), a
 * colliding port is accepted rather than failing the start. `opts.generate` is a
 * test seam — the id generator, defaulting to the real {@link generateWorktreeId}.
 * Exported for the port-collision class-guard test.
 */
export async function mintFreeWorktree(
  ctx: LifecycleContext,
  settings: IdentitySettings,
  worktreeRoot: string,
  name?: string,
  opts: {
    usedPorts?: Set<number>;
    generate?: (name?: string) => ReturnType<typeof generateWorktreeId>;
  } = {},
): Promise<{
  id: string;
  branch: string;
  dir: string;
  note?: string;
  nameHint?: FiredHint;
}> {
  const run = makeGitRunner(ctx);
  const usedPorts = opts.usedPorts ?? new Set<number>();
  const generate = opts.generate ?? generateWorktreeId;
  // Two passes: the first insists on a free port; the second (fallback) accepts a
  // port collision so a crowded band can never make `start` fail outright.
  for (const requireFreePort of [true, false]) {
    for (let attempt = 0; attempt < 50; attempt++) {
      const minted = generate(name);
      const identity = deriveIdentity(minted.id, settings);
      const dir = join(worktreeRoot, minted.id);
      if (requireFreePort && usedPorts.has(identity.port)) {
        continue;
      }
      const branchTaken = (await run(
        ["show-ref", "--verify", "--quiet", `refs/heads/${identity.branch}`],
      )).success;
      if (!branchTaken && !(await pathPresent(dir))) {
        // The note (if any) is deterministic from the name, so returning the winning
        // attempt's carries the same transparency the caller surfaces upward.
        return minted.note !== undefined
          ? {
            id: minted.id,
            branch: identity.branch,
            dir,
            note: minted.note,
            ...(minted.nameHint !== undefined
              ? { nameHint: minted.nameHint }
              : {}),
          }
          : { id: minted.id, branch: identity.branch, dir };
      }
    }
  }
  throw new WorktreeGitError(
    "discern start could not find an unused worktree name after many attempts. " +
      "Choose a more specific `--name`, inspect existing worktrees with `discern " +
      "status`, then re-run.",
  );
}

/**
 * Resolve the ref a `discern start` forks from — the pull-side entry point of the
 * landing model. `from` (when given) may be any branch, tag, or commit, verified
 * through the shared {@link resolveCommitRef}; absent, the TRUNK is used
 * explicitly — never the main checkout's HEAD, so a main checkout parked on some
 * other branch can't poison a new worktree with that branch's commits. Refuses an
 * unborn repo ("make your first commit first") and a missing trunk in plain
 * language.
 */
async function resolveStartPoint(
  ctx: LifecycleContext,
  from: string | undefined,
): Promise<string> {
  if (from !== undefined && from.trim() !== "") {
    const ref = from.trim();
    await resolveCommitRef(ctx.root, ref); // refuses unknown/ambiguous
    return ref;
  }
  // The trunk is all a default start needs — the main checkout's HEAD may be
  // parked anywhere, detached, or even unborn (an orphan branch): the worktree
  // forks from the trunk ref, never from HEAD.
  const trunk = integrationBranch(ctx.config.repository.trunk);
  if (await localBranchExists(ctx.root, trunk)) {
    return trunk;
  }
  if (!(await hasAnyCommit(ctx.root))) {
    throw new WorktreeGitError(
      "This repository has no commits yet, so there is nothing to branch a " +
        "worktree from — make your first commit first, then re-run `discern start`.",
    );
  }
  throw new WorktreeGitError(
    `New worktrees branch from the trunk, but the local branch '${trunk}' ` +
      `doesn't exist. Set [repository].trunk to the branch this project ` +
      `uses, or pass \`--from <ref>\` to branch from a specific ref, then re-run.`,
  );
}

/**
 * Refuse a `discern start` when the project root is not the git repository's
 * top level — a `discern.toml` in a subdirectory would place the new worktree (a
 * FULL-repo checkout) nested inside the repo, the exact anti-pattern the config
 * template warns against, and its `discern.toml` would not be where the setup
 * expects. Named paths, plain language; `doctor` carries the matching check.
 */
async function assertProjectRootIsRepoToplevel(
  ctx: LifecycleContext,
  verb: WorktreeLifecycleRepoRootVerb,
): Promise<void> {
  const toplevel = await repoToplevel(ctx.root);
  if (toplevel === undefined) {
    throw new WorktreeGitError(
      `discern ${verb} needs a Git repository, but this project is outside one. Run ` +
        `\`git init\` and make a first commit, then re-run.`,
    );
  }
  const root = await Deno.realPath(ctx.root).catch(() => ctx.root);
  if (root !== toplevel) {
    throw new WorktreeGitError(
      `discern.toml lives at ${root}, but the git repository's root is ` +
        `${toplevel}. Worktrees are whole-repository checkouts, so discern must ` +
        `be installed at the repository root — move discern.toml (and its ` +
        `authored files) to ${toplevel}, or make ${root} its own repository, then ` +
        `re-run \`discern ${verb}\`.`,
    );
  }
}

/**
 * Perform `discern start` and return its {@link DiscernResult} — the plan (dry-run)
 * or the created worktree — without emitting or exiting. The single source the CLI's
 * `--json` ({@link start}) and the MCP server both render. Runs from the MAIN
 * checkout only ({@link assertOpSide}); an agent already inside a worktree
 * must not spin up a pointless sibling, so it refuses there (mapped to
 * `precondition_failed` by {@link worktreeErrorResult}). It MINTS a fresh, unique id
 * (collision-checked against existing branches/dirs), creates the linked worktree at
 * `<worktreeRoot>/<id>` on `<branch_prefix><id>` — branched from the TRUNK (or
 * `opts.from`, any ref: the landing model composes freely on the pull axis), never
 * from whatever branch the main checkout happens to be parked on — and runs its
 * first-time setup via the shared {@link createAndSetupWorktree} (which discards
 * the partial worktree on any failure). `worktreeRoot` is supplied by the caller
 * (the dispatcher / MCP server resolve it via `resolveWorktreeRoot`), keeping this
 * engine core free of the placement convention. The result carries the new worktree's
 * `data.path` and a hint to re-root: nothing relocates the caller's session for it.
 */
export async function startResult(
  ctx: LifecycleContext,
  opts: {
    dryRun?: boolean;
    worktreeRoot: string;
    name?: string;
    from?: string;
  },
): Promise<DiscernResult<StartData>> {
  await assertOpSide("start", ctx.cwd);
  await assertProjectRootIsRepoToplevel(ctx, "start");
  const startPoint = await resolveStartPoint(ctx, opts.from);

  const settings = await loadIdentitySettings(ctx.root);
  const { id, branch, dir, note, nameHint } = await mintFreeWorktree(
    ctx,
    settings,
    opts.worktreeRoot,
    opts.name,
    { usedPorts: await livePortsInUse(ctx, settings) },
  );

  if (opts.dryRun ?? false) {
    return previewResult(
      "start",
      startPlanToEngine(
        note !== undefined
          ? { id, branch, worktreePath: dir, from: startPoint, note }
          : { id, branch, worktreePath: dir, from: startPoint },
      ),
    );
  }

  // Advisory, not a gate: uncommitted work in the main checkout never follows a
  // new worktree (it branches from a committed ref), so say where it stays.
  const mainChanges = parsePorcelainZ(
    (await makeGitRunner(ctx)(
      ["status", "--porcelain", "-z", "--untracked-files=normal"],
      ctx.root,
    )).stdout,
  ).length;
  const dirtyNote = mainChanges > 0
    ? fire(HINTS["start-main-changes-stay"], {
      changes: mainChanges,
      startPoint,
    })
    : undefined;
  if (dirtyNote !== undefined) {
    ctx.log.info(dirtyNote.text);
  }

  ctx.log.heading(`Starting a new worktree (${id})…`);
  await createAndSetupWorktree(ctx.root, dir, branch, ctx.log, startPoint);
  ctx.log.ok(`Worktree '${id}' is ready at ${dir} (from ${startPoint}).`);

  // `git worktree add` checks out `.gitmodules` but leaves every submodule
  // directory empty; when no configured command populates them, the gate is
  // about to run against missing trees — disclose at the moment they appear.
  const submoduleNote =
    (await hasGitmodules(dir)) && !submoduleCommandWired(ctx.config)
      ? fire(HINTS["start-submodules-empty"])
      : undefined;

  const landingAuthority = await inspectLandingAuthority(
    dir,
    ctx.config.repository.trunk,
  );
  const authorityProjection = prospectiveLandingAuthorityProjection(
    landingAuthority,
  );
  const data: StartData = {
    id,
    branch,
    path: dir,
    from: startPoint,
    ...(note !== undefined ? { name_note: note } : {}),
    ...(authorityProjection !== undefined
      ? { landing_authority: authorityProjection }
      : {}),
  };
  const result: DiscernResult<StartData> = appliedResult("start", [
    {
      step: {
        kind: "git",
        label: BUILT_IN_STEP_LABELS.addWorktree,
        disposition: "run",
        note: `${dir} on ${branch} (from ${startPoint})`,
      },
      outcome: "ok",
    },
    {
      step: {
        kind: "setup-step",
        label: BUILT_IN_STEP_LABELS.setup,
        disposition: "run",
        note: "readied the new worktree",
      },
      outcome: "ok",
    },
  ]);
  result.message = `Created worktree '${id}' at ${dir} (branch ${branch}).`;
  result.data = data;
  const reRoot = fire(HINTS["start-re-root"], { dir });
  // A normalisation/fallback note leads the hints, so the caller — and the human
  // reading over its shoulder — see what the worktree was actually named.
  result.hints = hintTexts([
    ...(nameHint !== undefined ? [nameHint] : []),
    reRoot,
    ...(authorityProjection !== undefined
      ? [
        fire(HINTS["start-landing-authority"], {
          source: authorityProjection.source,
          standingScopes: authorityProjection.standing_scopes ?? [],
          warnings: authorityProjection.warnings ?? [],
        }),
      ]
      : []),
    ...(submoduleNote !== undefined ? [submoduleNote] : []),
    ...(dirtyNote !== undefined ? [dirtyNote] : []),
  ]);
  return result;
}

/** True when the checkout at `dir` carries a tracked `.gitmodules`. */
async function hasGitmodules(dir: string): Promise<boolean> {
  try {
    return (await Deno.stat(join(dir, ".gitmodules"))).isFile;
  } catch {
    return false;
  }
}

/**
 * True when any configured lifecycle command mentions submodules — the signal
 * that the project already populates them ([repository].ensure is the
 * recommended home). Scans every command surface the worktree lifecycle runs:
 * repository convergence, one-shot setup steps, worktree-only convergence, and
 * each declared resource's create/ensure/destroy.
 */
export function submoduleCommandWired(config: DiscernConfig): boolean {
  const commands = [
    ...config.repository.ensure,
    ...config.worktree.setup.steps,
    ...config.worktree.setup.ensure,
    ...Object.values(config.worktree.resources).flatMap((
      resource,
    ) => [resource.create, resource.ensure, resource.destroy]),
  ];
  return commands.some((command) => command.includes("submodule"));
}

/**
 * Create a fresh isolated worktree from the main checkout and re-root into it — the
 * `discern start` command, the first-class way an agent on the trunk gets its own
 * workspace instead of squatting in another line of work's worktree. Mints a unique
 * id, creates the worktree on its own `<branch_prefix><id>` branch — forked from the
 * trunk, or `--from <ref>` — at the configured sibling location, sets it up, and
 * prints the new path plus how to enter it. `--dry-run` shows the plan (after the
 * preconditions pass) and touches nothing. Throws `WorktreeGitError` when run from
 * inside a worktree, from an unborn repo, or from a project root that is not the
 * repository root (the caller maps it to an error envelope).
 */
export async function start(
  ctx: LifecycleContext,
  opts: {
    dryRun?: boolean;
    json?: boolean;
    worktreeRoot: string;
    name?: string;
    from?: string;
  },
): Promise<void> {
  const result = await startResult(ctx, {
    dryRun: opts.dryRun ?? false,
    worktreeRoot: opts.worktreeRoot,
    name: opts.name ?? "",
    ...(opts.from !== undefined ? { from: opts.from } : {}),
  });
  emitOrRenderWorktreeResult(ctx, result, opts.json ?? false, {
    afterApply: (r) => {
      // Human apply: the new worktree's path is the deliverable — say how to enter it.
      const data = r.data;
      if (data !== undefined) {
        ctx.log.info(`cd into it to continue: cd ${data.path}`);
      }
    },
  });
}

/**
 * The outcome of a worktree-viability probe (ADR 0090) — one throwaway worktree
 * created, exercised, and destroyed to prove the project actually functions where
 * every future task lives.
 */
export type WorktreeProbeOutcome =
  /** The probe could not be created — an unborn branch (no commit yet), not the main
   * checkout, or a git failure. Not the app's fault, so the caller reports the project
   * un-proven-in-a-worktree but does NOT block on it. */
  | { kind: "uncreatable"; reason: string }
  /** The worktree was created but readying it (resources, one-shot `steps`, the
   * fresh-creation `ensure`) FAILED — the project cannot set itself up in a copy. A
   * genuine red the caller blocks on. */
  | { kind: "setup_failed"; reason: string }
  /** The probe ran inside the readied worktree; `ok` is the caller's verdict, `detail`
   * its note. */
  | { kind: "probed"; ok: boolean; detail?: string };

/**
 * Prove the project is viable inside a linked worktree — the copy every future task
 * runs in — by creating a THROWAWAY one exactly as `discern start` would, running a
 * caller-supplied `probe` inside it, and tearing it down unconditionally (win or
 * lose). The worktree branches from the main checkout's CURRENT HEAD, never from
 * `main`: a project still on its unlanded `discern-setup` branch is probed with its
 * own just-authored config, not a repo without discern at all (ADR 0090). It reuses
 * the same create (`addWorktree` + `worktreeSetup`) and removal (`removeWorktreeSafely`)
 * cores the rest of the lifecycle uses, so the probe exercises precisely what a real
 * worktree does — its `[worktree.setup]` steps/ensure, its resources, its env
 * inheritance — the anchoring an env-anchored app silently breaks. Gate-agnostic: the
 * caller decides what "viable" means via `probe` (setup passes it the finish core).
 * Runs from the main checkout; never throws — a teardown hiccup is swallowed (a later
 * `worktree prune` reclaims the remains).
 */
export async function probeWorktreeViability(
  ctx: LifecycleContext,
  worktreeRoot: string,
  probe: (probeDir: string) => Promise<{ ok: boolean; detail?: string }>,
): Promise<WorktreeProbeOutcome> {
  const asMsg = (e: unknown): string =>
    e instanceof Error ? e.message : String(e);

  // The probe branches from the main checkout's HEAD; anywhere else is a skip, not a
  // red (nothing to fault the app for).
  try {
    await assertOpSide("worktree-probe", ctx.cwd);
  } catch (e) {
    return { kind: "uncreatable", reason: asMsg(e) };
  }

  const settings = await loadIdentitySettings(ctx.root);
  let branch: string;
  let dir: string;
  try {
    const minted = await mintFreeWorktree(ctx, settings, worktreeRoot);
    branch = minted.branch;
    dir = minted.dir;
    // `git worktree add` from HEAD — fails on an unborn branch (no commit yet), which
    // is a legitimate skip, not the app failing.
    await addWorktree(ctx.root, dir, branch);
  } catch (e) {
    return { kind: "uncreatable", reason: asMsg(e) };
  }

  try {
    // Ready the worktree exactly as a real one: resources, env inheritance, one-shot
    // `steps`, fresh-creation `ensure`, agent-file refresh, sentinel. A throw here is
    // the app failing to set itself up in a copy — the core failure the probe catches.
    try {
      await worktreeSetup(await lifecycleContext(dir, ctx.log, dir));
    } catch (e) {
      return { kind: "setup_failed", reason: asMsg(e) };
    }
    const verdict = await probe(dir);
    return verdict.detail !== undefined
      ? { kind: "probed", ok: verdict.ok, detail: verdict.detail }
      : { kind: "probed", ok: verdict.ok };
  } finally {
    // A probe teardown must never fail the caller (`setup done`) — the discard is
    // best-effort throughout and `worktree prune` is the backstop. The branch is
    // the probe's own freshly-minted throwaway (mintFreeWorktree guarantees it
    // was free), so deleting it discards nothing that predates the probe.
    await discardWorktreeBestEffort(ctx.root, dir, branch, ctx.log, {
      deleteBranch: true,
    });
  }
}

/**
 * Map a thrown worktree precondition / identity error to its {@link DiscernResult}
 * error fields, or undefined when `e` is neither. The single source of the failure
 * slugs (`precondition_failed`, `identity_error`) shared by the CLI runner
 * (`runWorktreeOp`) and the MCP server, so the two surfaces never diverge. The
 * caller rethrows when this returns undefined (a genuinely unexpected error).
 */
export function worktreeErrorResult(
  verb: string,
  e: unknown,
): DiscernResult | undefined {
  if (e instanceof WorktreeResultError) {
    return e.result;
  }
  if (e instanceof WorktreeGitError || e instanceof IdentityError) {
    return {
      ok: false,
      verb,
      error: e instanceof IdentityError
        ? "identity_error"
        : "precondition_failed",
      message: e.message,
    };
  }
  return undefined;
}

class WorktreeResultError extends WorktreeGitError {
  readonly result: DiscernResult;

  constructor(message: string, result: DiscernResult) {
    super(message);
    this.name = "WorktreeResultError";
    this.result = result;
  }
}

/** Resolve a possibly-relative git-common-dir against `cwd` and canonicalize it. */
async function realPathOrLifecycle(raw: string, cwd: string): Promise<string> {
  if (raw === "") {
    return raw;
  }
  const abs = raw.startsWith("/") ? raw : join(cwd, raw);
  try {
    return await Deno.realPath(abs);
  } catch {
    return abs;
  }
}

/** Options for {@link worktreePrune}. */
export interface WorktreePruneOptions {
  /** Proceed without requesting confirmation for the destructive prune candidates. */
  assumeYes?: boolean;
  /** Report what would be removed/reclaimed without acting. */
  dryRun?: boolean;
  /** Emit one structured result on stdout. */
  json?: boolean;
  /** The explicit opt-in to reclaim CONTAINED worktrees — checkouts whose
   * committed work is fully contained in another live branch. Off, the group
   * is only reported. The branch ref is never deleted on this path. */
  contained?: boolean;
  /**
   * Extra directories the orphan sweep should scan beyond the git-derived
   * parents of registered worktrees — the configured worktree root, so a
   * FULLY-orphaned root (no registered worktree left to derive its parent from)
   * is still reclaimed. The engine knows no placement convention; the dispatch
   * layer resolves `[worktree].root` and passes it (ADR 0052).
   */
  extraScanDirs?: string[];
}

/**
 * The read-only prune SCAN — what `worktree prune` would remove and reclaim,
 * gathered without acting. The git-worktree and orphan-dir scans are carried in
 * the plan so apply consumes the same candidate set instead of re-reading live
 * state; resource reclaims come from the pure {@link classifyOrphans} decision
 * over the ledger. The deliverable a `--dry-run` renders and the apply path
 * reports.
 */
async function buildPrunePlan(
  ctx: LifecycleContext,
  extraScanDirs?: string[],
  reclaimContained = false,
): Promise<PrunePlan> {
  const gitScan = await scanGitWorktreesForPrune({
    includeDetached: true,
    mainBranch: ctx.config.repository.trunk,
  });
  const orphanScan = await scanOrphanWorktreesForSweep({
    mainBranch: ctx.config.repository.trunk,
    ...(extraScanDirs !== undefined ? { extraDirs: extraScanDirs } : {}),
  });
  const reappearedPathScan = await scanReappearedWorktreePaths(ctx.root);
  const resources = await planResourceReclaims(ctx);
  return {
    gitScan,
    orphanScan,
    reappearedPathScan,
    resourceReclaims: resources.reclaimable,
    resourceReclaimsKept: resources.kept,
    contained: await pruneContainedScan(ctx),
    reclaimContained,
  };
}

/**
 * The contained-worktree half of the prune scan: read the fleet, derive the
 * idle check (the logbook's begin/finish pairing when it is on; the
 * git-derived quiet period when it is off), and return the facts. Read-only —
 * the offer's evidence, never an act.
 */
async function pruneContainedScan(
  ctx: LifecycleContext,
): Promise<ContainedWorktree[]> {
  const nowMs = Date.now();
  const commonGitDir = await resolveCommonGitDir(ctx.cwd);
  const activity = ctx.config.project.logbook && commonGitDir !== undefined
    ? await readFleetLogbookActivity(
      commonGitDir,
      configEpoch(ctx.config).fingerprint,
      nowMs,
    )
    : undefined;
  const currentPath = await Deno.realPath(ctx.root).catch(() => ctx.root);
  return await scanContainedWorktrees(ctx.root, {
    mainBranch: ctx.config.repository.trunk,
    currentPath,
    idle: containmentIdleCheck(activity, nowMs),
  });
}

/**
 * The orphaned-resource handles GC would reclaim — the read-only half of the
 * resource GC, built from the pure {@link classifyOrphans} decision over the
 * ledger and the live-worktree snapshot. No destroy, no ledger writes. A no-op
 * outside a git repo.
 */
async function planResourceReclaims(
  ctx: LifecycleContext,
): Promise<{ reclaimable: LedgerItem[]; kept: number }> {
  const commonGitDir = await resolveCommonGitDir(ctx.cwd);
  if (commonGitDir === undefined) {
    return { reclaimable: [], kept: 0 };
  }
  const livePaths = await liveWorktreePaths(ctx.cwd);
  const { reclaimable, kept } = classifyOrphans(
    await listEntries(commonGitDir),
    {
      gitKeys: await liveWorktreeGitKeys(commonGitDir),
      paths: livePaths,
      identities: await liveResourceIdentitySet(ctx, livePaths),
    },
  );
  return { reclaimable, kept };
}

/**
 * Housekeeping for the worktree pool — the `worktree prune` command. Removes stale
 * worktrees and fully-merged branches, reclaims gitlinked orphan directories, then
 * reclaims orphaned per-worktree RESOURCES (the GC safety net: a resource whose
 * worktree vanished without a clean teardown). Refuses to run from inside a linked
 * worktree (pool housekeeping belongs to the main checkout). `--dry-run` renders
 * the prune plan and touches nothing. Throws on a setup or removal failure.
 */
export async function worktreePrune(
  ctx: LifecycleContext,
  opts: WorktreePruneOptions = {},
): Promise<void> {
  await assertOpSide("worktree-prune", ctx.cwd);
  const json = opts.json ?? false;
  const plan = await buildPrunePlan(
    ctx,
    opts.extraScanDirs,
    opts.contained ?? false,
  );
  const enginePlan = prunePlanToEngine(plan);

  // Dry-run: scan read-only and render the plan; touch nothing.
  if (opts.dryRun ?? false) {
    emitDryRun(
      ctx,
      "worktree prune",
      enginePlan,
      json,
    );
    return;
  }

  if (!prunePlanIsEmpty(plan) && !(opts.assumeYes ?? false)) {
    const message =
      "Confirmation required for `discern worktree prune`; review the candidates and re-run with `--yes`.";
    if (!canInteract(false)) {
      if (!json) {
        renderPlan(loggerSink(ctx.log), enginePlan);
      }
      throw new WorktreeResultError(message, {
        ok: false,
        verb: "worktree prune",
        error: "confirmation_required",
        message,
        plan: enginePlan,
      });
    }
    renderPlan(loggerSink(ctx.log), enginePlan);
    const runCount = enginePlan.steps.filter((step) =>
      step.disposition === "run"
    ).length;
    if (
      !(await confirmDestructiveAction(
        {
          label: "Remove prune candidates",
          scope: `${runCount} candidate${
            runCount === 1 ? "" : "s"
          } in ${ctx.root}`,
          impact:
            "Candidates marked run in the reviewed plan will be removed; skipped entries stay.",
          recovery:
            "Git-tracked work can be recovered from Git; untracked files and external resources may have no automatic recovery.",
          authority: "Repository owner after reviewing the candidate plan",
          continuation: "Remove the prune candidates above?",
          labels: { noLabel: "Keep", yesLabel: "Remove" },
        },
        {
          yes: false,
          json,
          terminal: ctx.log.terminal,
          present: (frame: string): void => ctx.log.humanLine(frame),
        },
      ))
    ) {
      throw new WorktreeGitError(
        "Pruning was cancelled, so nothing was removed. Re-run when you are ready, " +
          "or pass `--yes` after reviewing the plan.",
      );
    }
  }

  // Apply: run the real removals, narrating exactly as before.
  ctx.log.heading("Pruning worktrees and fully-merged branches…");
  let prune = await pruneGitWorktrees(plan.gitScan, ctx.log);

  ctx.log.heading("Reclaiming orphaned worktree directories…");
  const sweep = await sweepOrphanWorktrees(plan.orphanScan, ctx.log);

  ctx.log.heading("Reclaiming reappeared worktree paths…");
  const reappeared = await pruneReappearedWorktreePaths(
    plan.reappearedPathScan,
    ctx.log,
  );

  ctx.log.heading("Reclaiming orphaned worktree resources…");
  const gc = await gcWorktreeResources(
    ctx,
    plan.resourceReclaims,
    plan.resourceReclaimsKept,
  );

  // The contained group: reclaim only under the explicit opt-in; otherwise the
  // offer stays visible — named candidates, evidence, and the way to act.
  let reclaim: ContainedReclaimResult = {
    reclaimed: [],
    skipped: [],
    failed: false,
  };
  if (plan.reclaimContained && plan.contained.length > 0) {
    ctx.log.heading("Reclaiming contained worktrees (branch refs kept)…");
    reclaim = await reclaimContainedWorktrees(ctx, plan.contained);
  } else if (plan.contained.length > 0) {
    ctx.log.heading("Contained worktrees (kept)…");
    for (const c of plan.contained) {
      ctx.log.line(
        `KEEP   ${c.path} (branch ${c.branch} is contained in ${c.containingBranch}, ` +
          `+${c.containerAhead} ahead)`,
      );
    }
    ctx.log.info(
      "These checkouts' committed work travels inside a live branch. Reclaim " +
        "them with `discern worktree prune --contained` — the branch refs are " +
        "kept; each checkout and its per-worktree state are destroyed.",
    );
  }

  if (
    plan.gitScan.staleMetadata.length > 0 && plan.orphanScan.kept.length === 0
  ) {
    ctx.log.heading("Pruning stale worktree metadata…");
    const metadata = await pruneStaleWorktreeMetadata(plan.gitScan, ctx.log);
    prune = {
      ...prune,
      staleMetadata: metadata.pruned,
      failed: prune.failed || metadata.failed,
    };
  } else if (plan.gitScan.staleMetadata.length > 0) {
    ctx.log.warn(
      "Skipped stale worktree metadata pruning because an orphaned worktree directory was kept.",
    );
  }
  if (
    prune.failed || sweep.failed || reappeared.failed || gc.failed ||
    reclaim.failed
  ) {
    throw new WorktreeGitError(
      "One or more worktree cleanups failed. Review the failed steps above, fix " +
        "their reported causes, then re-run `discern worktree prune`.",
    );
  }
  ctx.log.ok("Prune complete.");

  emitOrRenderWorktreeResult(
    ctx,
    appliedResult(
      "worktree prune",
      pruneResults(prune, sweep, reappeared, gc, plan, reclaim),
    ),
    json,
  );
}

/** The outcome of the contained-worktree reclaim pass. */
interface ContainedReclaimResult {
  /** Checkouts reclaimed — each branch ref kept, resources torn down. */
  reclaimed: ContainedWorktree[];
  /** Planned candidates skipped because live state changed since the plan. */
  skipped: { fact: ContainedWorktree; reason: string }[];
  /** Whether any reclaim failed (as opposed to being safely skipped). */
  failed: boolean;
}

/**
 * Reclaim the planned contained worktrees: tear down each checkout's external
 * resources through the same lifecycle path acceptance uses (never a raw
 * removal), then remove the checkout and its registration. The branch ref is
 * NEVER deleted here — it stays as the recovery guarantee, and self-cleans
 * through the ordinary landed-branch prune once the train finally lands.
 *
 * Apply re-validates EACH candidate against live state immediately before
 * acting on it (the same per-candidate discipline as the stale-worktree
 * removal's re-check): the plan waited at a confirmation interaction, and every
 * earlier candidate's resource teardown buys time for an agent to re-enter a
 * later one. A candidate that fails the predicate by its turn — new commits,
 * a dirty tree, fresh activity, a different containing branch than the one
 * confirmed — is skipped, never force-reclaimed. A failed resource teardown
 * stops that candidate's reclaim outright: the checkout keeps owning its
 * resources, because the prune GC has already run this invocation and a
 * guarded (`gc = false`) resource would otherwise be stranded forever.
 */
async function reclaimContainedWorktrees(
  ctx: LifecycleContext,
  planned: ContainedWorktree[],
): Promise<ContainedReclaimResult> {
  const result: ContainedReclaimResult = {
    reclaimed: [],
    skipped: [],
    failed: false,
  };
  if (planned.length === 0) {
    return result;
  }
  const commonGitDir = await resolveCommonGitDir(ctx.cwd);
  for (const fact of planned) {
    const live = (await pruneContainedScan(ctx)).find(
      (f) => f.path === fact.path,
    );
    const reason = live === undefined
      ? "it stopped qualifying as contained, clean, and idle"
      : live.branch !== fact.branch
      ? `now on branch ${live.branch}, planned as ${fact.branch}`
      : live.tip !== fact.tip
      ? "the branch tip moved since the plan was built"
      : live.containingBranch !== fact.containingBranch
      ? `the containing branch is now ${live.containingBranch}, planned as ${fact.containingBranch}`
      : undefined;
    if (reason !== undefined) {
      ctx.log.warn(
        `Skipped ${fact.path}: candidate changed since the plan was built (${reason}).`,
      );
      result.skipped.push({ fact, reason });
      continue;
    }
    ctx.log.line(
      `Reclaiming ${fact.path} (branch ${fact.branch} kept; contained in ${fact.containingBranch})...`,
    );
    try {
      // Resources first, from inside the target so `@dir@` destroys resolve; a
      // configless checkout falls back to the main context. A failed destroy
      // REFUSES this candidate's reclaim: the checkout stays, still owning its
      // resources, and the failure names the retry.
      const gitKey = await worktreeGitKey(fact.path);
      const entries = commonGitDir !== undefined && gitKey !== undefined
        ? await entriesForWorktree(commonGitDir, gitKey)
        : [];
      if (entries.length > 0) {
        const teardownCtx = await lifecycleContext(
          fact.path,
          ctx.log,
          fact.path,
        ).catch(() => ctx);
        const { failed } = await destroyResources(teardownCtx, entries);
        if (failed.length > 0) {
          ctx.log.error(
            `Reclaim of ${fact.path} stopped: resource${
              failed.length === 1 ? "" : "s"
            } ${failed.join(", ")} could not be destroyed. The checkout is ` +
              `kept; fix the destroy failure above, then re-run ` +
              `\`discern worktree prune --contained\`.`,
          );
          result.failed = true;
          continue;
        }
        // The teardown ran arbitrary commands and took real time, and the
        // removal below is forced — prove the tree is STILL clean first.
        if (!(await treeProvablyClean(fact.path))) {
          ctx.log.warn(
            `Skipped ${fact.path}: its tree changed during resource teardown, ` +
              `so the checkout is kept. Its external resources were already ` +
              `destroyed; re-run \`discern worktree setup\` there to ` +
              `re-create them.`,
          );
          result.skipped.push({
            fact,
            reason: "the tree changed during resource teardown",
          });
          continue;
        }
      }
      await removeWorktreeSafely(fact.path, ctx.root);
      result.reclaimed.push(fact);
    } catch (e) {
      ctx.log.error(
        `Reclaim failed for ${fact.path}: ${
          e instanceof Error ? e.message : String(e)
        }`,
      );
      result.failed = true;
    }
  }
  return result;
}

/**
 * Reclaim ONE contained worktree by id (directory basename) or path — the
 * desk's per-worktree action. Runs the same containment scan the prune offer
 * uses and refuses a target that does not qualify right now, so the desk can
 * never reclaim past the predicate. The caller collects the explicit human
 * confirmation FIRST — this core is the act, never the offer — and the branch
 * ref is never deleted.
 */
export async function worktreeReclaimContained(
  ctx: LifecycleContext,
  target: string,
): Promise<ContainedWorktree> {
  await assertOpSide("worktree-prune", ctx.cwd);
  const wanted = target.trim().replace(/\/+$/, "");
  if (wanted === "") {
    throw new WorktreeGitError(
      "Reclaiming needs a target. Pass a worktree id or path, then re-run.",
    );
  }
  const wantedAbs = isAbsolute(wanted) || wanted.includes("/")
    ? await Deno.realPath(resolve(wanted)).catch(() => resolve(wanted))
    : undefined;
  const facts = await pruneContainedScan(ctx);
  const match = facts.find((f) =>
    f.path === wantedAbs || basename(f.path) === wanted
  );
  if (match === undefined) {
    throw new WorktreeGitError(
      `Worktree '${target}' is not a contained candidate right now. A candidate ` +
        `is clean, idle, and its branch tip is strictly contained in another ` +
        `live branch. Review the fleet with \`discern worktree prune --dry-run\`, ` +
        `then re-run.`,
    );
  }
  const result = await reclaimContainedWorktrees(ctx, [match]);
  if (result.reclaimed.length !== 1) {
    const skippedReason = result.skipped[0]?.reason;
    throw new WorktreeGitError(
      skippedReason !== undefined
        ? `Reclaim skipped ${match.path}: ${skippedReason}. Nothing was removed.`
        : `Reclaim failed for ${match.path}. Review the error above, fix its ` +
          `cause, then re-run.`,
    );
  }
  return match;
}

/** Map the real prune/sweep/GC/reclaim outcomes to `--json` step results. */
function pruneResults(
  prune: {
    removed: string[];
    branchesDeleted: string[];
    staleMetadata: string[];
  },
  sweep: { removed: string[] },
  reappeared: ReappearedWorktreePathPruneResult,
  gc: GcResult,
  plan: PrunePlan,
  reclaim: ContainedReclaimResult,
): StepResult[] {
  const step = (
    kind: StepResult["step"]["kind"],
    label: string,
    note: string,
    group: string,
  ): StepResult => ({
    step: {
      kind,
      label: verbatimStepLabel(label),
      disposition: "run",
      note,
      group,
    },
    outcome: "ok",
  });
  // The contained group is always REPORTED: reclaimed rows under the opt-in,
  // and every kept row as an explicit skip — the offer stays visible in the
  // structured result exactly as it does in the terminal presentation.
  const contained: StepResult[] = plan.reclaimContained
    ? [
      ...reclaim.reclaimed.map((c) =>
        step(
          "git",
          c.path,
          `reclaimed contained checkout; kept branch ${c.branch}`,
          "Contained worktrees",
        )
      ),
      ...reclaim.skipped.map(({ fact, reason }): StepResult => ({
        step: {
          kind: "git",
          label: verbatimStepLabel(fact.path),
          disposition: "skip",
          note: reason,
          group: "Contained worktrees",
        },
        outcome: "skipped",
      })),
    ]
    : plan.contained.map((c): StepResult => ({
      step: {
        kind: "git",
        label: verbatimStepLabel(c.path),
        disposition: "skip",
        note: `contained in ${c.containingBranch} — reclaim with --contained ` +
          `(branch ref kept)`,
        group: "Contained worktrees",
      },
      outcome: "skipped",
    }));
  return [
    ...prune.removed.map((w) =>
      step("git", w, "removed stale worktree", "Worktrees")
    ),
    ...prune.branchesDeleted.map((b) =>
      step("git", b, "deleted fully-merged branch", "Branches")
    ),
    ...sweep.removed.map((d) =>
      step("git", d, "reclaimed orphan directory", "Orphan directories")
    ),
    ...reappeared.removed.map((path) =>
      step(
        "git",
        path,
        "removed files written after worktree removal",
        "Reappeared worktree paths",
      )
    ),
    ...reappeared.skipped.map(({ fact, reason }): StepResult => ({
      step: {
        kind: "git",
        label: verbatimStepLabel(fact.path),
        disposition: "skip",
        note: reason,
        group: "Kept reappeared worktree paths",
      },
      outcome: "skipped",
    })),
    ...prune.staleMetadata.map((d) =>
      step("git", d, "pruned stale metadata", "Stale metadata")
    ),
    ...gc.reclaimed.map((r) =>
      step("resource-destroy", r, "reclaimed orphaned resource", "Resources")
    ),
    ...contained,
  ];
}

/**
 * The resource-GC pass of `worktree prune`: reclaim any ledgered resource whose
 * worktree is gone. Conservative — it only acts on the planned entries this
 * project's ledger held, and still rechecks that no live worktree owns one before
 * destroy (by key, path, or resource handle). A no-op outside a git repo.
 */
async function gcWorktreeResources(
  ctx: LifecycleContext,
  reclaimable: LedgerItem[],
  kept: number,
): Promise<GcResult> {
  const empty: GcResult = { reclaimed: [], kept: 0, failed: false };
  const commonGitDir = await resolveCommonGitDir(ctx.cwd);
  if (commonGitDir === undefined) {
    return empty;
  }
  const gc = await gcPlannedOrphanResources({
    commonGitDir,
    cwd: ctx.cwd,
    reclaimable,
    kept,
    // Re-evaluate handle ownership against CURRENT disk state before each destroy:
    // a worktree created mid-loop can own this handle under a fresh git_key that
    // the snapshot — and the `gitKeyIsLive` re-check — both miss (M1).
    recheckIdentityLive: async (identity: string): Promise<boolean> => {
      const paths = await liveWorktreePaths(ctx.cwd);
      return (await liveResourceIdentitySet(ctx, paths)).has(identity);
    },
    log: ctx.log,
  });
  const n = gc.reclaimed.length;
  if (n === 0) {
    ctx.log.line("No orphaned worktree resources found.");
  } else {
    ctx.log.ok(
      `Reclaimed ${n} orphaned worktree resource${n === 1 ? "" : "s"}.`,
    );
  }
  return gc;
}

/**
 * The set of resource handles currently owned by LIVE worktrees — the recycling
 * guard, so GC never reclaims an orphan whose handle a live worktree now holds
 * (e.g. a reused container name). Empty when no resources are declared.
 */
async function liveResourceIdentitySet(
  ctx: LifecycleContext,
  livePaths: Set<string>,
): Promise<Set<string>> {
  const set = new Set<string>();
  const specs = readResourceSpecs(ctx.config);
  if (specs.length === 0) {
    return set;
  }
  let settings: IdentitySettings;
  try {
    settings = await loadIdentitySettings(ctx.root);
  } catch {
    // This handle guard is ONE of three independent GC liveness checks (git_key,
    // path, identity) — and the git_key + path guards are re-validated against disk
    // before each destroy. So returning an empty set here only narrows this third
    // line of defense; it must never become the sole guard a destroy relies on.
    return set;
  }
  for (const path of livePaths) {
    try {
      const id = await resolveWorktreeId(settings, path);
      for (const spec of specs) {
        set.add(resourceForId(settings.slug, id, spec.name));
      }
    } catch {
      // a worktree whose id can't be resolved — skip (it just isn't a guard)
    }
  }
  return set;
}

/**
 * Resolve a single identity field for the `identity` command surface. Kept
 * here so the dispatcher can map `discern identity --<field>` to one call
 * without reaching into the identity internals. Throws `IdentityError` (carrying
 * an exit code) on a resolution failure.
 */
export async function identityField(
  root: string,
  field: WorktreeField,
  target: string = Deno.cwd(),
): Promise<string> {
  const settings = await loadIdentitySettings(root);
  const id = await resolveWorktreeId(settings, target);
  const identity = deriveIdentity(id, settings);
  // No `default`: the switch is total over WorktreeField, so a field added to
  // WORKTREE_FIELDS makes this fail `deno check` ("not all code paths return") until
  // it is handled here — the compile-time tie back to the SSOT.
  switch (field) {
    case "id":
      return identity.id;
    case "site":
      return identity.site;
    case "branch":
      return identity.branch;
    case "port":
      return String(identity.port);
    case "db":
      return identity.db;
    case "worktree":
      return worktreeBase(settings.slug, identity.id);
  }
}

/**
 * Resolve a named resource's handle for `identity --resource <name>` — the
 * runtime-discovery query that equals what the resource's `create` used and what
 * `DISCERN_RESOURCE_<NAME>` carries in the worktree's `.env`.
 */
export async function identityResourceHandle(
  root: string,
  name: string,
  target: string = Deno.cwd(),
): Promise<string> {
  const settings = await loadIdentitySettings(root);
  const id = await resolveWorktreeId(settings, target);
  return resourceForId(settings.slug, id, name);
}

/**
 * Resolve every declared resource's stable handle by name. The dispatcher
 * projects this one structured fact to JSON or shell-friendly `name=handle`
 * lines.
 */
export async function identityResources(
  root: string,
  target: string = Deno.cwd(),
): Promise<Record<string, string>> {
  const settings = await loadIdentitySettings(root);
  const id = await resolveWorktreeId(settings, target);
  const config = await loadConfig(root);
  return Object.fromEntries(
    readResourceSpecs(config).map((spec) => [
      spec.name,
      resourceForId(settings.slug, id, spec.name),
    ]),
  );
}

export { IdentityError, WorktreeGitError };
