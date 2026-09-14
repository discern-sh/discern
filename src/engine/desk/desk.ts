import {
  executeDeskOperation,
  runDeskInteractiveChild,
  runDeskProjectScript,
} from "./execution.ts";
export {
  executeDeskOperation,
  runDeskInteractiveChild,
  runDeskProjectScript,
} from "./execution.ts";
import { readProofNoteAt } from "../gate/proof_notes.ts";
/**
 * `desk` — the operator's interactive ingress and surface over the worktree fleet
 * (ADR 0119). Bare `discern`, post-setup on an interactive terminal, opens it;
 * `discern desk` is the named form the guards and docs see.
 *
 * The desk is a renderer and a dispatcher, never a source of truth: state comes
 * from `statusResult` (the fleet survey, whose rows carry their gate-proof and
 * landing-authority facts), and every mutation runs the same lifecycle core the
 * CLI verb runs — a core's refusal is rendered, never bypassed. Its only owned logic is the pure classification in
 * `model.ts`. Lifecycle actions echo their CLI command. The effort-grant action
 * is deliberately desk-only: this TTY is the sole write boundary, while agent
 * CLI and MCP surfaces can only read the resulting grant.
 *
 * Deliberately CLI-only — no MCP tool — for `worktree drop`'s reason: the desk
 * wields human supervisory actions over OTHER efforts' worktrees, which the
 * fleet-ownership rule forbids an agent. Without a TTY (or under `--json`) it
 * refuses with a pointer at `status`.
 */

import { basename } from "@std/path";
import { commandEvidence } from "../../shared/command_evidence.ts";
import { runDocs } from "../../commands/docs.ts";
import { deskLiteral, type DeskReading, readDeskScreen } from "./reading.ts";
import { SYSTEM_CLOCK, wallTimeIso } from "../../shared/clock.ts";
import { findRoot, NO_PROJECT_MESSAGE } from "../../shared/env.ts";
import { emitResult } from "../../shared/emit.ts";
import { type DiscernConfig, loadConfig } from "../../shared/config_schema.ts";
import { parsePorcelainZ, splitNulRecords } from "../../shared/git_paths.ts";
import type { CliModelProvider } from "../../shared/cli_reference_codegen.ts";
import type { DiscernResult, EnginePlan } from "../../shared/result.ts";
import type {
  AcceptData,
  GateData,
  StartData,
  StatusData,
  SubmissionRevision,
  SubmitData,
  TaskRenameData,
  UpdateData,
} from "../../shared/result_schemas.ts";
import { taskTextValidationError } from "../../shared/task_metadata.ts";
import {
  detectAgentBinariesOnPath,
  type DetectedAgentBinary,
} from "../../lib/detect_agents.ts";
import { resolveWorktreeRoot } from "../../lib/paths.ts";
import { type PagerResult, pageThrough } from "../../lib/pager.ts";
import {
  canInteract,
  type ConfirmationRequestOptions,
  groupedSelectionEntries,
  InteractionCancelled,
  isInteractionCancelled,
  requestCompactAcknowledgement,
  requestConfirmation,
  requestSelection,
  requestSequentialForm,
  requestText,
  runTerminalApplication,
  type SelectionGroup,
  type SelectionRequestOptions,
  type SequentialFormRequestOptions,
  type SequentialInteractionRequests,
  type TerminalApplicationOptions,
  type TextRequestOptions,
} from "../../lib/terminal_interaction.ts";
import { Logger } from "../../lib/log.ts";
import {
  type BrowserOpenResult,
  openInBrowser,
} from "../../lib/open_browser.ts";
import { statusResult } from "../status/status.ts";
import { finishResult } from "../gate/finish.ts";
import { inspectGateProof } from "../gate/proof.ts";
import {
  applyStartPlan,
  buildStartPlan,
  DropWouldDiscardWork,
  type LifecycleContext,
  lifecycleContext,
  type PreparedStart,
  type StartRequestOptions,
  taskRenameResult,
  update,
  updateResult,
  worktreeDrop,
  worktreeDropPlan,
  WorktreeGitError,
  worktreePark,
  worktreeParkPlan,
  worktreeReclaimContained,
  worktreeReclaimContainedPlan,
  worktreeSetup,
  worktreeSetupPlan,
} from "../worktree/lifecycle.ts";
import { mainRepoPath } from "../worktree/git.ts";
import { commandExists, runGit } from "../../shared/subprocess.ts";
import { makeOut, type Out } from "../output.ts";
import { withCompletionPublication } from "../operation_lock.ts";
import {
  type DeskProjectScript,
  type DeskProjectScriptInventory,
  inspectDeskProjectScriptsWithConfig,
} from "../project_scripts.ts";
import {
  agentLaunchArgs,
  buildAgentLaunches,
  buildDeskDecision,
  DESK_ACTION_REGISTRY,
  type DeskAction,
  type DeskActionOffer,
  type DeskAgentLaunch,
  type DeskRow,
} from "./model.ts";
import {
  type DeskPreferences,
  type DeskPreferencesWriteResult,
  readDeskPreferences,
  writeDeskPreferences,
} from "./preferences.ts";
import {
  markTipShown,
  renderTipLine,
  selectTip,
  type TipSeenState,
} from "./tips.ts";
import { readTipSeenState, writeTipSeenState } from "./tip_state.ts";
import { TIPS } from "../../shared/tips.ts";
import { observeShownTip } from "../../shared/result_capture.ts";
import { DISCERN_VERSION } from "../../lib/version.ts";
import { terminalSize } from "../../lib/text.ts";
import { terminalContext, type TerminalSize } from "../../lib/terminal.ts";
import { deskSessionEnv, inDeskSession } from "./session.ts";
import {
  parseProjectScriptArguments,
  simpleCommandArgv,
} from "./literal_argv.ts";
import {
  clearEffortGrant,
  clearEffortGrantPlan,
} from "../worktree/effort_grant_cleanup.ts";
import {
  effortGrantPlan,
  type EffortGrantWrite,
  grantEffort,
} from "../worktree/effort_grant_writer.ts";
import { acceptLandingResult } from "../worktree/accept.ts";
import { submitResult } from "../worktree/submit.ts";
import { userShell } from "../user_shell.ts";
import {
  DESK_FILTER_THRESHOLD,
  DESK_REVIEW_ROUTES,
  DESK_ROUTES,
  type DeskEditorCommand,
  type DeskReview,
  type DeskReviewFailure,
  type DeskReviewFile,
} from "./view.ts";
import { liveDesk } from "./live.ts";
import type { DeskChoice } from "./application_view.ts";
import { resultPresenterForVerb } from "../../shared/result_contracts.ts";
import { serializeResult } from "../../shared/result_serialization.ts";
import { renderResultMarkdown } from "../../shared/result_markdown.ts";
import type { DropPlan } from "../worktree/plan.ts";
import { startPlanToEngine } from "../worktree/plan.ts";
import { actOnMainCheckout, showRecentCompleted } from "./main_checkout.ts";
import { echoDeskCommand } from "./presentation.ts";
import {
  type NumstatMagnitude,
  parseNumstat,
  reviewGitRead,
} from "./review_evidence.ts";

const {
  back: BACK,
} = DESK_ROUTES;

/** Flags accepted by `desk`. */
export interface DeskOptions {
  /** Present for surface parity only — the desk has no JSON form; it refuses. */
  json?: boolean;
  /** Fully attached live command tree supplied by the binary entry point. */
  cliModel?: CliModelProvider;
}

type DeskSelectOptions = SelectionRequestOptions<string>;
type DeskMaybePromise<T> = T | Promise<T>;
type DeskScriptDiscovery =
  | DeskProjectScriptInventory
  | readonly DeskProjectScript[];

/** The terminal and effect boundary behind the desk's interactive session.
 * Production keeps its runtime private; tests replace it with a scripted
 * runtime so every supervisory path is exercised without pretending a pipe is
 * a terminal or touching a real worktree. */
export interface DeskRuntime {
  screen(request: DeskReading): DeskMaybePromise<string>;
  docs(): DeskMaybePromise<number>;
  canInteract(): boolean;
  inDeskSession(): boolean;
  findRoot(): DeskMaybePromise<string | undefined>;
  loadConfig(root: string): DeskMaybePromise<DiscernConfig>;
  status(root: string): DeskMaybePromise<{
    ok: boolean;
    data?: StatusData | undefined;
    message?: string | undefined;
  }>;
  mainRepoPath(root: string): DeskMaybePromise<string | undefined>;
  grantEffortPlan(
    path: string,
    branch: string,
  ): DeskMaybePromise<EnginePlan>;
  grantEffort(
    path: string,
    branch: string,
  ): DeskMaybePromise<EffortGrantWrite>;
  clearEffortGrantPlan(path: string): DeskMaybePromise<EnginePlan>;
  clearEffortGrant(path: string): DeskMaybePromise<boolean>;
  makeOut(): Out;
  error(message: string): void;
  application(
    options: TerminalApplicationOptions<DeskChoice>,
  ): Promise<unknown>;
  select(options: DeskSelectOptions): DeskMaybePromise<string>;
  confirm(
    message: string,
    options: ConfirmationRequestOptions,
  ): DeskMaybePromise<boolean>;
  input(options: TextRequestOptions): DeskMaybePromise<string>;
  sequence(
    options: SequentialFormRequestOptions,
  ): DeskMaybePromise<Record<string, unknown>>;
  pause(out: Out): DeskMaybePromise<void>;
  lifecycle(root: string): DeskMaybePromise<LifecycleContext>;
  done(
    root: string,
    cliModel: CliModelProvider,
  ): DeskMaybePromise<DiscernResult<GateData>>;
  donePlan(
    root: string,
    cliModel: CliModelProvider,
  ): DeskMaybePromise<DiscernResult<GateData>>;
  acceptPlan(
    ctx: LifecycleContext,
  ): DeskMaybePromise<DiscernResult<AcceptData>>;
  accept(
    ctx: LifecycleContext,
    opts: {
      dryRun?: boolean;
      confirmed?: boolean;
      cliModel?: CliModelProvider;
      expected?: SubmissionRevision;
    },
  ): DeskMaybePromise<DiscernResult<AcceptData> | void>;
  submit(
    path: string,
    options: { dryRun?: boolean; expected?: SubmissionRevision },
  ): DeskMaybePromise<DiscernResult<SubmitData>>;
  update(
    ctx: LifecycleContext,
    opts: { dryRun?: boolean },
  ): DeskMaybePromise<void>;
  updatePlan(
    ctx: LifecycleContext,
  ): DeskMaybePromise<DiscernResult<UpdateData>>;
  setup(ctx: LifecycleContext): DeskMaybePromise<void>;
  setupPlan(ctx: LifecycleContext): DeskMaybePromise<EnginePlan>;
  drop(
    ctx: LifecycleContext,
    target: string,
    opts: { dryRun?: boolean; force?: boolean; expected?: DropPlan },
  ): DeskMaybePromise<void>;
  dropPlan(
    ctx: LifecycleContext,
    target: string,
  ): DeskMaybePromise<EnginePlan & { subject?: DropPlan }>;
  park(
    ctx: LifecycleContext,
    target: string,
  ): DeskMaybePromise<void>;
  parkPlan(
    ctx: LifecycleContext,
    target: string,
  ): DeskMaybePromise<EnginePlan>;
  reclaim(ctx: LifecycleContext, target: string): DeskMaybePromise<void>;
  reclaimPlan(
    ctx: LifecycleContext,
    target: string,
  ): DeskMaybePromise<EnginePlan>;
  git(
    args: string[],
    cwd: string,
  ): DeskMaybePromise<{ success: boolean; stdout: string; stderr: string }>;
  proof(
    root: string,
  ): DeskMaybePromise<Awaited<ReturnType<typeof inspectGateProof>>>;
  landedProof(
    root: string,
    commit: string,
  ): DeskMaybePromise<Awaited<ReturnType<typeof readProofNoteAt>>>;
  pager(text: string): DeskMaybePromise<PagerResult>;
  editor(cwd: string): DeskMaybePromise<{
    editor?: DeskEditorCommand;
    reason?: string;
  }>;
  openEditor(
    editor: DeskEditorCommand,
    cwd: string,
  ): DeskMaybePromise<number>;
  interactive(
    command: string,
    args: readonly string[],
    cwd: string,
    env: Record<string, string>,
    action?: string,
  ): DeskMaybePromise<number>;
  detectAgents(): DeskMaybePromise<readonly DetectedAgentBinary[]>;
  startPlan(
    ctx: LifecycleContext,
    opts: StartRequestOptions,
  ): DeskMaybePromise<PreparedStart>;
  start(
    ctx: LifecycleContext,
    prepared: PreparedStart,
  ): DeskMaybePromise<StartData>;
  renamePlan(
    ctx: LifecycleContext,
    title: string,
  ): DeskMaybePromise<DiscernResult<TaskRenameData>>;
  rename(
    ctx: LifecycleContext,
    title: string,
  ): DeskMaybePromise<DiscernResult<TaskRenameData>>;
  /** Discover `root`'s executable Project Scripts under its ALREADY-loaded
   * config, so one board pass never reads the same config twice. */
  scripts(
    root: string,
    config: DiscernConfig,
  ): DeskMaybePromise<DeskScriptDiscovery>;
  runScript(
    root: string,
    name: string,
    args: readonly string[],
    env: Record<string, string>,
    expectedExecutable?: string,
  ): DeskMaybePromise<number>;
  openBrowser(url: string): DeskMaybePromise<BrowserOpenResult>;
  now(): number;
  /** Read the repository's tip seen-state; never throws (store contract). */
  readTipState(root: string): DeskMaybePromise<TipSeenState>;
  /** Persist the tip seen-state, best-effort; never throws (store contract). */
  writeTipState(root: string, state: TipSeenState): DeskMaybePromise<void>;
  readPreferences(root: string): DeskMaybePromise<DeskPreferences>;
  writePreferences(
    root: string,
    preferences: DeskPreferences,
  ): DeskMaybePromise<DeskPreferencesWriteResult>;
  /** Report a shown tip id for the session's logbook event. */
  recordTipShown(id: string): void;
  /** The live viewport sampled once for each complete Desk composition. */
  size(): TerminalSize;
}

const echoCommand = echoDeskCommand;

/** Keep a convenience-state failure visible without changing task outcomes. */
function reportPreferenceWrite(
  out: Out,
  result: DeskPreferencesWriteResult,
): void {
  if (result.status === "saved") return;
  out.warn(
    `Desk preferences were not saved: ${result.reason} ` +
      "The current task is unchanged; the next desk session may ask you to choose again.",
  );
}

/** Format recorded command words for the desk's compact activity view. */
function displayedCommand(command: string, args: readonly string[]): string {
  return commandEvidence([command, ...args]);
}

/** Resolve the model-owned offer the selected action came from. */
function selectedOffer(
  row: DeskRow,
  action: DeskAction,
): DeskActionOffer {
  const offer = row.decision.actions.find((candidate) =>
    candidate.action === action
  );
  if (offer === undefined) {
    throw new TypeError(`Desk decision is missing the ${action} action`);
  }
  return offer;
}

/** Resolve the host's conventional editor settings at one injectable edge. */
function configuredEditorCommand(
  visual: string | undefined = Deno.env.get("VISUAL")?.trim(),
  editor: string | undefined = Deno.env.get("EDITOR")?.trim(),
): string | undefined {
  return visual || editor;
}

/** Review the authoritative plan with a locally scrollable reading region. */
async function reviewAction(
  row: DeskRow,
  action: DeskAction,
  plan: EnginePlan | undefined,
  runtime: DeskRuntime,
  question: string,
  offerOverride?: DeskActionOffer,
): Promise<boolean> {
  const offer = offerOverride ?? selectedOffer(row, action);
  const source = [
    `**${deskLiteral(row.entry.branch)}**`,
    deskLiteral(row.entry.path),
    ...(plan === undefined ? [] : [
      deskLiteral(plan.title),
      ...plan.details.map(deskLiteral),
      plan.steps.map((step) =>
        `- ${
          deskLiteral(
            `${step.disposition}: ${step.label}${
              step.note ? ` — ${step.note}` : ""
            }`,
          )
        }`
      ).join("\n"),
    ]),
    ...Object.entries(offer.consequence).flatMap(([label, facts]) =>
      facts.length === 0 ? [] : [
        `**${label}:** ${facts.map(deskLiteral).join("; ")}`,
      ]
    ),
    `Command: ${deskLiteral(commandEvidence(offer.command.argv))}`,
  ].filter(Boolean).join("\n\n");
  const policy = offer.confirmation;
  return await runtime.screen({
    title: offer.label,
    source,
    ...(policy.kind === "none" ? {} : {
      confirmation: {
        question,
        options: {
          defaultTo: false,
          noLabel: policy.noLabel,
          yesLabel: policy.yesLabel,
        },
      },
    }),
  }) === "apply";
}

/** Refuse a composite preview through the lifecycle's authored result message. */
function resultPlan<T>(result: DiscernResult<T>): EnginePlan | undefined {
  if (!result.ok) {
    throw new WorktreeGitError(
      result.message ?? `${result.verb} could not produce a plan.`,
    );
  }
  return result.plan;
}

/** A confirmation that treats a cancelled interaction (Ctrl-C / Esc) as "no". */
async function confirmOrNo(
  message: string,
  options: ConfirmationRequestOptions,
): Promise<boolean> {
  try {
    return await requestConfirmation(message, options);
  } catch (error) {
    if (!isInteractionCancelled(error)) throw error;
    return false;
  }
}

/** The narrating logger the lifecycle cores render human output through. */
function deskLogger(): Logger {
  return new Logger({ json: false, noColor: false, humanStream: "stdout" });
}

/** Retain the latest short action result across the foreground return. */
async function collectDeskFeedback(
  base: Out,
  run: (out: Out) => Promise<string | void>,
): Promise<{ path?: string; message?: string }> {
  let message: string | undefined;
  const out: Out = {
    ...base,
    info: (text) => {
      message = text;
      base.info(text);
    },
    ok: (text) => {
      message = text;
      base.ok(text);
    },
    warn: (text) => {
      message = text;
      base.warn(text);
    },
  };
  const path = await run(out);
  return {
    ...(path === undefined ? {} : { path }),
    ...(message === undefined ? {} : { message }),
  };
}

/** The real terminal/git implementation. Keeping the boundary in one value
 * makes the whole interactive surface scriptable while the CLI still calls the
 * same functions with the same options. */
const DEFAULT_DESK_RUNTIME: DeskRuntime = {
  screen: readDeskScreen,
  docs: () =>
    runDocs({
      json: false,
      noColor: !terminalContext().color,
      raw: false,
      list: false,
      pager: false,
      returnLabel: "Return to Desk",
    }),
  canInteract: () => canInteract(false),
  inDeskSession: () => inDeskSession(),
  findRoot: () => findRoot(),
  loadConfig: (root) => loadConfig(root),
  status: (root) => statusResult(root, { all: true }),
  mainRepoPath: (root) => mainRepoPath(root),
  grantEffortPlan: (path, branch) => effortGrantPlan(path, branch),
  grantEffort: (path, branch) =>
    executeDeskOperation(
      path,
      { command: "desk grant" },
      () => grantEffort(path, branch, wallTimeIso(SYSTEM_CLOCK.wallNow())),
    ),
  clearEffortGrantPlan: (path) => clearEffortGrantPlan(path),
  clearEffortGrant: (path) =>
    executeDeskOperation(
      path,
      { command: "desk revoke" },
      () => withCompletionPublication(path, () => clearEffortGrant(path)),
    ),
  makeOut: () => {
    const terminal = terminalContext();
    return makeOut(terminal.color, { terminal });
  },
  error: (message) => deskLogger().error(message),
  application: (options) => runTerminalApplication(options),
  select: (options) =>
    requestSelection<string>({ ...options, presentation: "menu" }),
  confirm: (message, options) => confirmOrNo(message, options),
  input: (options) => requestText(options),
  sequence: (options) => requestSequentialForm(options),
  pause: () => requestCompactAcknowledgement(),
  lifecycle: (root) => lifecycleContext(root, deskLogger()),
  done: (root, cliModel) =>
    executeDeskOperation(
      root,
      { command: "done" },
      (signal) =>
        finishResult(root, {
          signal,
          surface: { kind: "human", plain: false },
          cliModel,
        }),
    ),
  donePlan: (root, cliModel) =>
    finishResult(root, {
      surface: { kind: "quiet" },
      cliModel,
      dryRun: true,
    }),
  acceptPlan: (ctx) =>
    acceptLandingResult(ctx, {
      target: ctx.cwd,
      dryRun: true,
      confirmed: false,
      variance: [],
      approveStandard: [],
      met: [],
    }),
  accept: (ctx, opts) =>
    executeDeskOperation(
      ctx.cwd,
      { command: "accept" },
      (signal) =>
        acceptLandingResult(ctx, {
          signal,
          target: ctx.cwd,
          ...(opts.expected === undefined ? {} : { expected: opts.expected }),
          dryRun: opts.dryRun ?? false,
          confirmed: opts.confirmed ?? false,
          variance: [],
          approveStandard: [],
          met: [],
          ...(opts.cliModel === undefined ? {} : { cliModel: opts.cliModel }),
        }),
    ),
  submit: (path, options) =>
    executeDeskOperation(
      path,
      { command: "submit", ...(options.dryRun ? { dryRun: true } : {}) },
      async (signal) =>
        submitResult(await lifecycleContext(path, deskLogger()), {
          ...options,
          signal,
        }),
    ),
  update: (ctx, opts) =>
    executeDeskOperation(
      ctx.cwd,
      { command: "update", ...(opts.dryRun ? { dryRun: true } : {}) },
      () => update(ctx, opts),
    ),
  updatePlan: (ctx) => updateResult(ctx, { dryRun: true }),
  setup: (ctx) =>
    executeDeskOperation(
      ctx.cwd,
      { command: "worktree setup" },
      () => worktreeSetup(ctx),
    ),
  setupPlan: (ctx) => worktreeSetupPlan(ctx),
  drop: (ctx, target, opts) =>
    executeDeskOperation(
      target,
      {
        command: "worktree drop",
        ...(opts.dryRun ? { dryRun: true } : {}),
      },
      () => worktreeDrop(ctx, target, opts),
    ),
  dropPlan: (ctx, target) => worktreeDropPlan(ctx, target),
  park: (ctx, target) =>
    executeDeskOperation(
      target,
      { command: "worktree park" },
      () => worktreePark(ctx, target),
    ),
  parkPlan: (ctx, target) => worktreeParkPlan(ctx, target),
  reclaim: async (ctx, target) => {
    await executeDeskOperation(
      target,
      { command: "worktree prune" },
      () => worktreeReclaimContained(ctx, target),
    );
  },
  reclaimPlan: (ctx, target) => worktreeReclaimContainedPlan(ctx, target),
  git: (args, cwd) => runGit(args, { cwd }),
  proof: (root) => inspectGateProof(root),
  landedProof: readProofNoteAt,
  pager: (text) => pageThrough(text),
  editor: async (cwd) => {
    const command = configuredEditorCommand();
    if (command === undefined || command === "") {
      return {
        reason:
          "No editor command is configured. Set $VISUAL or $EDITOR and refresh the desk.",
      };
    }
    const argv = simpleCommandArgv(command);
    if (argv === undefined) {
      return {
        reason: `Editor command ${
          JSON.stringify(command)
        } is not a simple executable command. Set $VISUAL or $EDITOR to an executable and optional arguments.`,
      };
    }
    const [program, ...editorArgs] = argv;
    if (program === undefined) {
      return { reason: "The configured editor command is empty." };
    }
    if (!(await commandExists(program, { cwd }))) {
      return {
        reason: `Editor command ${
          JSON.stringify(command)
        } is configured, but ${program} is not available. Install it or update $VISUAL or $EDITOR.`,
      };
    }
    return { editor: { command, program, args: editorArgs } };
  },
  openEditor: (editor, cwd) =>
    runDeskInteractiveChild(
      editor.program,
      [...editor.args, "."],
      cwd,
      deskSessionEnv(),
      "desk editor",
    ),
  interactive: (command, args, cwd, env, action) =>
    runDeskInteractiveChild(command, args, cwd, env, action),
  detectAgents: () => detectAgentBinariesOnPath(),
  startPlan: (ctx, opts) => buildStartPlan(ctx, opts),
  start: async (ctx, prepared) => {
    const result = await executeDeskOperation(
      ctx.cwd,
      { command: "start" },
      () => applyStartPlan(ctx, prepared),
    );
    if (result.data === undefined) {
      throw new Error(result.message ?? "discern start returned no worktree");
    }
    return result.data;
  },
  renamePlan: (ctx, title) => taskRenameResult(ctx, title, { dryRun: true }),
  rename: (ctx, title) =>
    executeDeskOperation(
      ctx.cwd,
      { command: "worktree rename" },
      () => taskRenameResult(ctx, title),
    ),
  scripts: async (root, config) => {
    try {
      return await inspectDeskProjectScriptsWithConfig(root, config);
    } catch (error) {
      // discern-best-effort: desk-project-scripts-fallback
      const detail = error instanceof Error ? error.message : String(error);
      return {
        directory: root,
        scripts: [],
        unavailableReason:
          `Project Scripts could not be inspected (${detail}). Repair the configured scripts directory and refresh the desk.`,
      };
    }
  },
  runScript: (root, name, args, env, expectedExecutable) =>
    runDeskProjectScript(root, name, args, env, expectedExecutable),
  openBrowser: (url) => openInBrowser(url),
  now: SYSTEM_CLOCK.wallNow,
  readTipState: (root) => readTipSeenState(root, DISCERN_VERSION),
  writeTipState: (root, state) => writeTipSeenState(root, state),
  readPreferences: (root) => readDeskPreferences(root),
  writePreferences: (root, preferences) =>
    writeDeskPreferences(root, preferences),
  recordTipShown: (id) => observeShownTip(id),
  size: () => terminalSize(),
};

/** Map a Git status token to the package FileChange vocabulary. */
function fileDisposition(token: string): DeskReviewFile["disposition"] {
  return token.includes("A") || token === "??"
    ? "added"
    : token.includes("D")
    ? "removed"
    : "updated";
}

/** Combine committed name-status and uncommitted porcelain into one path set. */
function reviewFiles(
  nameStatus: string,
  porcelain: string,
  numstat: Map<string, NumstatMagnitude>,
): DeskReviewFile[] {
  const files = new Map<string, DeskReviewFile>();
  const nameStatusFields = splitNulRecords(nameStatus);
  for (let index = 0; index + 1 < nameStatusFields.length; index += 2) {
    const token = nameStatusFields[index] ?? "M";
    const path = nameStatusFields[index + 1];
    if (path === undefined || path === "") continue;
    const magnitude = numstat.get(path);
    files.set(path, {
      path,
      disposition: fileDisposition(token),
      ...(magnitude?.added === undefined ? {} : { added: magnitude.added }),
      ...(magnitude?.removed === undefined
        ? {}
        : { removed: magnitude.removed }),
      uncommitted: false,
    });
  }
  for (const entry of parsePorcelainZ(porcelain)) {
    const token = entry.status;
    const path = entry.path;
    const previous = files.get(path);
    files.set(path, {
      path,
      disposition: fileDisposition(token),
      ...(previous?.added === undefined ? {} : { added: previous.added }),
      ...(previous?.removed === undefined ? {} : { removed: previous.removed }),
      uncommitted: true,
    });
  }
  return [...files.values()].sort((left, right) =>
    left.path.localeCompare(right.path)
  );
}

/** Gather a complete read-only review from the selected checkout. */
async function gatherDeskReview(
  row: DeskRow,
  trunk: string,
  runtime: DeskRuntime,
): Promise<DeskReview> {
  const cwd = row.entry.path;
  const [proof, editorResult, commits, numstat, names, porcelain] =
    await Promise.all([
      runtime.proof(cwd),
      runtime.editor(cwd),
      reviewGitRead(
        runtime,
        cwd,
        ["log", "--format=%h %s", "--no-decorate", `${trunk}..HEAD`],
        "Commit history could not be read",
      ),
      reviewGitRead(
        runtime,
        cwd,
        ["diff", "--numstat", "-z", "--no-renames", `${trunk}...HEAD`],
        "Diffstat could not be read",
      ),
      reviewGitRead(
        runtime,
        cwd,
        [
          "diff",
          "--name-status",
          "-z",
          "--no-renames",
          `${trunk}...HEAD`,
        ],
        "Changed paths could not be read",
      ),
      reviewGitRead(
        runtime,
        cwd,
        ["status", "--porcelain=v1", "-z"],
        "Uncommitted paths could not be read",
      ),
    ]);
  const magnitudes = parseNumstat(numstat.output);
  const summed = [...magnitudes.values()].reduce<
    { added: number; removed: number }
  >(
    (total, value) => ({
      added: total.added + (value.added ?? 0),
      removed: total.removed + (value.removed ?? 0),
    }),
    { added: 0, removed: 0 },
  );
  const proofData = proof.proof_data;
  return {
    trunk,
    proof,
    commits: commits.output,
    files: reviewFiles(names.output, porcelain.output, magnitudes),
    insertions: proofData?.insertions ?? summed.added,
    deletions: proofData?.deletions ?? summed.removed,
    failures: [commits, numstat, names, porcelain].flatMap((read) =>
      read.failure === undefined ? [] : [read.failure]
    ),
    diffCommand: displayedCommand("git", [
      "diff",
      "--no-ext-diff",
      "--color=always",
      `${trunk}...HEAD`,
    ]),
    ...(editorResult.editor === undefined
      ? {}
      : { editor: editorResult.editor }),
    ...(editorResult.reason === undefined
      ? {}
      : { editorUnavailableReason: editorResult.reason }),
  };
}

/** Append a review failure while keeping all successfully gathered evidence. */
function withReviewFailure(
  review: DeskReview,
  failure: DeskReviewFailure,
): DeskReview {
  return { ...review, failures: [...review.failures, failure] };
}

/** Run the Proof-first review and its pager/editor drill-downs. */
async function reviewTask(
  _out: Out,
  row: DeskRow,
  trunk: string,
  runtime: DeskRuntime,
): Promise<void> {
  let review = await gatherDeskReview(row, trunk, runtime);
  while (true) {
    const proof = review.proof;
    const source = [
      `Proof: ${deskLiteral(proof.status)}${
        proof.reason ? ` — ${deskLiteral(proof.reason)}` : ""
      }`,
      deskLiteral(
        proof.proof_line ?? proof.proof_data?.line ??
          "No complete Proof is available.",
      ),
      `Authority: ${deskLiteral(row.decision.authority.summary)}`,
      `${review.files.length} changed paths · +${review.insertions} −${review.deletions}`,
      ...review.failures.map((failure) =>
        `### ${deskLiteral(failure.title)}\n\n${
          deskLiteral(failure.detail)
        }\n\n${deskLiteral(failure.nextAction)}`
      ),
    ].join("\n\n");
    const route = await runtime.screen({
      title: `Review ${row.task.name}`,
      source,
      actions: [
        { id: DESK_REVIEW_ROUTES.back, label: "Back" },
        { id: "proof", label: "Complete Proof" },
        { id: "changes", label: "Changed files and commits" },
        { id: DESK_REVIEW_ROUTES.diff, label: "View actual diff" },
        ...(review.editor === undefined
          ? []
          : [{ id: DESK_REVIEW_ROUTES.editor, label: "Open in editor" }]),
      ],
    });
    if (route === "back" || route === DESK_REVIEW_ROUTES.back) return;
    if (route === "proof") {
      await runtime.screen({
        title: "Complete Proof",
        source: proof.proof ?? proof.proof_data?.markdown ??
          deskLiteral(
            proof.reason ??
              "No complete Proof is available. Run discern done in this task after committing its final changes.",
          ),
      });
      continue;
    }
    if (route === "changes") {
      await runtime.screen({
        title: "Changed files and commits",
        source: [
          ...review.files.map((file) =>
            `- ${deskLiteral(file.path)} (${file.disposition}${
              file.uncommitted ? ", uncommitted" : ""
            })`
          ),
          `### Commits not on ${deskLiteral(review.trunk)}`,
          deskLiteral(review.commits || "No commits."),
        ].join("\n\n"),
      });
      continue;
    }
    if (route === DESK_REVIEW_ROUTES.diff) {
      const args = [
        "diff",
        "--no-ext-diff",
        "--color=always",
        `${trunk}...HEAD`,
      ];
      const result = await runtime.git(args, row.entry.path);
      if (!result.success) {
        review = withReviewFailure(review, {
          title: "Actual diff could not be read",
          command: displayedCommand("git", args),
          detail: result.stderr.trimEnd() || "Git returned a non-zero status.",
          nextAction:
            "Resolve the reported Git failure, then choose View actual diff again.",
          safeToRetry: true,
        });
        continue;
      }
      const paged = await runtime.pager(
        result.stdout === "" ? "(no diff)" : result.stdout.trimEnd(),
      );
      if (!paged.shown) {
        review = withReviewFailure(review, {
          title: "External pager failed",
          command: paged.command ?? "external pager",
          detail: paged.error instanceof Error
            ? paged.error.message
            : String(paged.error ?? "The pager did not open."),
          nextAction:
            "Set $PAGER to a working command, then choose View actual diff again.",
          safeToRetry: true,
        });
      }
      continue;
    }
    if (route === DESK_REVIEW_ROUTES.editor && review.editor !== undefined) {
      const code = await runtime.openEditor(review.editor, row.entry.path);
      if (code !== 0) {
        review = withReviewFailure(review, {
          title: "Editor exited with a failure",
          command: review.editor.command,
          detail: `The editor exited with status ${code}.`,
          nextAction:
            "Repair the configured editor command, then choose Open in editor again.",
          safeToRetry: true,
        });
      }
    }
  }
}

interface WorktreeConfigLoad {
  readonly config?: DiscernConfig;
  readonly error?: string;
}

/** Normalize array-shaped script discovery into the complete discovery shape. */
function scriptInventory(
  root: string,
  discovery: DeskScriptDiscovery,
): DeskProjectScriptInventory {
  if (!("directory" in discovery)) {
    return {
      directory: root,
      scripts: discovery,
      ...(discovery.length === 0
        ? {
          unavailableReason: "No Project Scripts are available in this task.",
        }
        : {}),
    };
  }
  return discovery;
}

/** A branch-local config failure remains visible as capability evidence. */
async function loadWorktreeConfig(
  path: string,
  runtime: DeskRuntime,
): Promise<WorktreeConfigLoad> {
  try {
    return { config: await runtime.loadConfig(path) };
  } catch (error) {
    // discern-best-effort: desk-worktree-config-fallback
    const detail = error instanceof Error ? error.message : String(error);
    return {
      error:
        `Task configuration at ${path}/discern.toml could not be read (${detail}). Repair the file and refresh the desk.`,
    };
  }
}

/** Pick one configured agent entry point while retaining unavailable providers. */
async function pickAgentLaunch(
  row: DeskRow,
  runtime: DeskRuntime,
): Promise<DeskAgentLaunch | undefined> {
  const agentGroups: SelectionGroup<string>[] = [];
  for (const launch of row.agentLaunches) {
    if (
      agentGroups.some((candidate) => candidate.id === `agent-${launch.agent}`)
    ) {
      continue;
    }
    agentGroups.push({
      id: `agent-${launch.agent}`,
      label: launch.providerLabel,
      items: row.agentLaunches
        .filter((candidate) => candidate.agent === launch.agent)
        .map((candidate) => ({
          name: candidate.label,
          description: candidate.availability === "disabled"
            ? `${displayedCommand(candidate.binary, candidate.args)} · ${
              candidate.reason ?? "This configured command is unavailable."
            }`
            : displayedCommand(candidate.binary, candidate.args),
          ...(candidate.availability === "disabled" ? { disabled: true } : {}),
          value: candidate.id,
        })),
    });
  }
  const options = groupedSelectionEntries<string>([
    ...agentGroups,
    {
      id: "task-navigation",
      label: "Task",
      items: [{ name: "Back", value: BACK }],
    },
  ]);
  let id: string;
  try {
    id = await runtime.select({
      message: `Choose an agent for ${row.task.name}`,
      options,
      hint: "Use the arrow keys to move and Enter to choose.",
    });
  } catch (error) {
    if (!isInteractionCancelled(error)) throw error;
    return undefined;
  }
  if (id === BACK) return undefined;
  const launch = row.agentLaunches.find((candidate) => candidate.id === id);
  return launch?.availability === "disabled" ? undefined : launch;
}

/** Pick one Project Script from either the project root or a worktree. */
async function pickScript(
  scripts: readonly DeskProjectScript[],
  owner: string,
  navigationLabel: "Desk" | "Task",
  runtime: DeskRuntime,
  unavailableReason?: string,
): Promise<DeskProjectScript | undefined> {
  if (scripts.length === 0) {
    await runtime.screen({
      title: "Project Scripts",
      source: unavailableReason === undefined
        ? `No Project Scripts are available in ${deskLiteral(owner)}.`
        : deskLiteral(unavailableReason),
    });
    return undefined;
  }
  const options = groupedSelectionEntries<string>([
    {
      id: "project-scripts",
      label: "Project Scripts",
      items: scripts.map((script) => ({
        name: script.description === undefined
          ? script.name
          : `${script.name}  ·  ${script.description}`,
        value: script.name,
        ...(script.availability === "disabled"
          ? { disabled: true, description: script.reason }
          : {}),
      })),
    },
    {
      id: `${navigationLabel.toLowerCase()}-navigation`,
      label: navigationLabel,
      items: [{ name: "Back", value: BACK }],
    },
  ]);
  let name: string;
  try {
    const search = scripts.length > DESK_FILTER_THRESHOLD;
    name = await runtime.select({
      message: `Choose a Project Script for ${owner}`,
      options,
      search,
      ...(search ? { searchLabel: "filter" } : {}),
      hint: search
        ? "Type to filter. Use the arrow keys to move and Enter to choose."
        : "Use the arrow keys to move and Enter to choose.",
    });
  } catch (error) {
    if (!isInteractionCancelled(error)) throw error;
    return undefined;
  }
  return name === BACK
    ? undefined
    : scripts.find((script) => script.name === name);
}

/** Review, copy, or authorize one exact Project Script command. */
async function authorizeProjectScript(
  out: Out,
  script: DeskProjectScript,
  workingDirectory: string,
  runtime: DeskRuntime,
): Promise<readonly string[] | undefined> {
  let argumentLine: string;
  try {
    argumentLine = await runtime.input({
      message: `Arguments for Project Script ${script.name} (optional)`,
      hint: "Quote spaces; no shell expansion.",
      placeholder: "Press Enter to run without arguments",
      validate: (value) => {
        const parsed = parseProjectScriptArguments(value);
        return parsed.ok ? true : parsed.message;
      },
    });
  } catch (error) {
    if (!isInteractionCancelled(error)) throw error;
    return undefined;
  }
  const parsed = parseProjectScriptArguments(argumentLine);
  if (!parsed.ok) {
    out.warn(parsed.message);
    return undefined;
  }
  const args = parsed.args;
  const executable = script.path ?? script.name;
  const source = [
    script.description === undefined ? "" : deskLiteral(script.description),
    `Working directory: ${deskLiteral(workingDirectory)}`,
    `Executable: ${deskLiteral(executable)}`,
    `Arguments: ${deskLiteral(JSON.stringify(args))}`,
    "The script defines its effects. Destructive policy: undeclared. Explicit consent is required.",
  ].filter(Boolean).join("\n\n");
  while (true) {
    const route = await runtime.screen({
      title: `Project Script: ${script.name}`,
      source,
      actions: [{ id: "back", label: "Back" }, { id: "run", label: "Run" }, {
        id: "show-command",
        label: "Show command",
      }],
    });
    if (route === "show-command") {
      await runtime.screen({
        title: "Exact command",
        source: [
          `Working directory: ${deskLiteral(workingDirectory)}`,
          deskLiteral(displayedCommand(executable, args)),
          deskLiteral(
            commandEvidence(["discern", "scripts", script.name, ...args]),
          ),
        ].join("\n\n"),
      });
      continue;
    }
    if (route !== "run") return undefined;
    return await runtime.screen({
        title: `Run ${script.name}`,
        source,
        confirmation: {
          question: `Run in ${workingDirectory}?`,
          options: { defaultTo: false, noLabel: "Cancel", yesLabel: "Run" },
        },
      }) === "apply"
      ? args
      : undefined;
  }
}

/** Collect, review, and run one Project Script through the Desk's sole argv path. */
async function runAuthorizedProjectScript(
  out: Out,
  root: string,
  script: DeskProjectScript,
  workingDirectory: string,
  contextLabel: string,
  runtime: DeskRuntime,
  verify?: () => Promise<void>,
): Promise<boolean> {
  const args = await authorizeProjectScript(
    out,
    script,
    workingDirectory,
    runtime,
  );
  if (args === undefined) return false;
  await verify?.();
  echoCommand(
    out,
    `${
      commandEvidence(["discern", "scripts", script.name, ...args])
    }  (in ${contextLabel})`,
  );
  const code = await runtime.runScript(
    root,
    script.name,
    args,
    deskSessionEnv(),
    script.path,
  );
  if (code !== 0) {
    out.warn(`Project Script exited with status ${code}.`);
    await runtime.pause(out);
  } else out.ok(`Project Script ${script.name} completed.`);
  return true;
}

/** Run one Project Script from the main checkout, using the same picker,
 * process ownership, exit reporting, and pause as a worktree-local script. */
async function runRootProjectScript(
  out: Out,
  root: string,
  project: string,
  scripts: readonly DeskProjectScript[],
  runtime: DeskRuntime,
  unavailableReason?: string,
): Promise<void> {
  const script = await pickScript(
    scripts,
    `${project} — project root ${root}`,
    "Desk",
    runtime,
    unavailableReason,
  );
  if (script === undefined) {
    return;
  }
  await runAuthorizedProjectScript(
    out,
    root,
    script,
    root,
    "project root",
    runtime,
  );
}

/** The outer application releases stdin before the existing manual browser owns it. */
async function openDeskManual(out: Out, runtime: DeskRuntime): Promise<void> {
  if (await runtime.docs() !== 0) {
    out.warn(
      "The manual could not open. Run discern docs to read its diagnosis.",
    );
  }
}

/** Page the committed work held by one status-reported branch without a worktree. */
async function inspectUnlandedBranch(
  out: Out,
  root: string,
  trunk: string,
  branch: string,
  runtime: DeskRuntime,
): Promise<void> {
  const logArgs = ["log", "--oneline", "--decorate", `${trunk}..${branch}`];
  const diffArgs = ["diff", "--stat", `${trunk}...${branch}`];
  const [commits, diffstat] = await Promise.all([
    runtime.git(logArgs, root),
    runtime.git(diffArgs, root),
  ]);
  if (!commits.success || !diffstat.success) {
    const detail = [commits, diffstat]
      .filter((result) => !result.success)
      .map((result) => result.stderr.trim())
      .filter((value) => value !== "")
      .join("\n");
    out.warn(
      detail === ""
        ? `Git could not inspect ${branch}.`
        : `Git could not inspect ${branch}: ${detail}`,
    );
    await runtime.pause(out);
    return;
  }
  const page = [
    `# ${branch}`,
    "",
    `Compared with ${trunk}`,
    "",
    `Command: ${displayedCommand("git", logArgs)}`,
    "",
    "## Commits",
    "",
    commits.stdout.trim() || "No commits ahead of the trunk.",
    "",
    `Command: ${displayedCommand("git", diffArgs)}`,
    "",
    "## Changed files",
    "",
    diffstat.stdout.trim() || "No changed files.",
    "",
  ].join("\n");
  const paged = await runtime.pager(page);
  if (!paged.shown) {
    out.warn("The pager could not open the branch review.");
    await runtime.pause(out);
  }
}

type TaskTitleChoice =
  | { readonly kind: "title"; readonly title: string }
  | { readonly kind: "codename" };

type CreationAgentChoice =
  | { readonly kind: "launch"; readonly launch: DeskAgentLaunch }
  | { readonly kind: "none" };

type TaskTitleRoute = "describe" | "codename";
type CreationPath = "compact" | "expanded";

interface StartTaskOptions {
  readonly data: StatusData;
  readonly detectedAgents: readonly DetectedAgentBinary[];
  /** Exact status-reported branch ref for follow-up or orphan recovery. */
  readonly fixedFrom?: string;
  /** Park-retained wording offered as defaults while resuming its branch. */
  readonly resumeTask?: NonNullable<StatusData["parked_tasks"]>[number];
}

/** Ask whether human wording or the explicit generated fallback owns the title. */
async function pickTaskTitleRoute(
  requests: SequentialInteractionRequests,
  previous: unknown,
): Promise<TaskTitleRoute> {
  const route = await requests.select({
    message: "What are you changing?",
    options: groupedSelectionEntries([{
      id: "task-title",
      label: "Task title",
      items: [{
        name: "Describe the task",
        description: "Preserve your wording as the task's display title.",
        value: "describe",
      }, {
        name: "Use a generated codename",
        description:
          "discern generates both the display title and worktree id.",
        value: "codename",
      }],
    }, {
      id: "task-title-navigation",
      label: "Desk",
      items: [{ name: "Back", value: BACK }],
    }]),
    ...(previous === "describe" || previous === "codename"
      ? { default: previous }
      : {}),
    hint: "Use the arrow keys to move and Enter to choose.",
  });
  if (route === BACK) throw new InteractionCancelled();
  return route === "codename" ? "codename" : "describe";
}

/** Ask for the exact human display title retained by task metadata. */
async function requestTaskTitle(
  requests: SequentialInteractionRequests,
  previous: unknown,
): Promise<string> {
  return await requests.text({
    message: "Task title",
    placeholder: "Describe the change in one line",
    hint: "Ctrl+U returns to the previous question. Esc returns to the desk.",
    required: "Enter a task title or return to choose a generated codename.",
    validate: (value) => taskTextValidationError(value, "title") ?? true,
    ...(typeof previous === "string" ? { default: previous } : {}),
  });
}

/** Choose the compact trunk path or the complete set of creation controls. */
async function pickCreationPath(
  trunk: string,
  preferred: CreationPath,
  requests: SequentialInteractionRequests,
  previous: unknown,
): Promise<CreationPath> {
  const selected = await requests.select({
    message: "Choose the creation path",
    options: groupedSelectionEntries([{
      id: "creation-paths",
      label: "Creation",
      items: [{
        name: `Start from ${trunk}`,
        description:
          "Use the compact path and open the remembered agent when available.",
        value: "compact",
      }, {
        name: "More options",
        description: "Choose a base, brief, and agent action.",
        value: "expanded",
      }],
    }, {
      id: "creation-path-navigation",
      label: "Desk",
      items: [{ name: "Back", value: BACK }],
    }]),
    default: previous === "compact" || previous === "expanded"
      ? previous
      : preferred,
    hint: "Ctrl+U returns to the previous question. Esc returns to the desk.",
  });
  if (selected === BACK) throw new InteractionCancelled();
  return selected === "expanded" ? "expanded" : "compact";
}

/** Select one configured provider action, retaining unavailable evidence. */
async function pickCreationAgent(
  launches: readonly DeskAgentLaunch[],
  requests: SequentialInteractionRequests,
  previous: unknown,
): Promise<string> {
  const groups: SelectionGroup<string>[] = [];
  for (const launch of launches) {
    if (groups.some((group) => group.id === `creation-agent-${launch.agent}`)) {
      continue;
    }
    groups.push({
      id: `creation-agent-${launch.agent}`,
      label: launch.providerLabel,
      items: launches.filter((candidate) => candidate.agent === launch.agent)
        .map((candidate) => ({
          name: candidate.label,
          description: candidate.availability === "disabled"
            ? `${displayedCommand(candidate.binary, candidate.args)} · ${
              candidate.reason ?? "This configured command is unavailable."
            }`
            : displayedCommand(candidate.binary, candidate.args),
          ...(candidate.availability === "disabled" ? { disabled: true } : {}),
          value: candidate.id,
        })),
    });
  }
  groups.push({
    id: "creation-without-agent",
    label: "Desk",
    items: [{
      name: "Create without opening an agent",
      description: "Return to the created task's action menu.",
      value: "none",
    }, { name: "Back", value: BACK }],
  });
  const previousId = typeof previous === "string" &&
      (previous === "none" || launches.some((launch) => launch.id === previous))
    ? previous
    : undefined;
  const selected = await requests.select({
    message: "Choose an agent action",
    options: groupedSelectionEntries(groups),
    ...(previousId === undefined ? {} : { default: previousId }),
    hint: "Only configured agents available on PATH can open.",
  });
  if (selected === BACK) throw new InteractionCancelled();
  return selected;
}

/** Select trunk, a live task, or an exact unlanded branch as the creation base. */
async function pickCreationBase(
  data: StatusData,
  trunk: string,
  requests: SequentialInteractionRequests,
  previous: unknown,
): Promise<string> {
  const live = (data.fleet ?? []).filter((entry) =>
    !entry.is_main && entry.broken !== true && entry.git_unavailable !== true
  );
  const groups: SelectionGroup<string>[] = [{
    id: "creation-base-trunk",
    label: "Trunk",
    items: [{
      name: trunk,
      description: "Start from the current trunk tip.",
      value: trunk,
    }],
  }];
  if (live.length > 0) {
    groups.push({
      id: "creation-base-tasks",
      label: "Live tasks",
      items: live.map((entry) => ({
        name: entry.task?.title ?? entry.branch,
        description: `Start from the committed tip of ${entry.branch}.`,
        value: entry.branch,
      })),
    });
  }
  const unlanded = data.unlanded_branches ?? [];
  if (unlanded.length > 0) {
    groups.push({
      id: "creation-base-unlanded",
      label: "Branches without worktrees",
      items: unlanded.map((branch) => ({
        name: branch,
        description: "Start from this committed branch tip.",
        value: branch,
      })),
    });
  }
  groups.push({
    id: "creation-base-navigation",
    label: "Desk",
    items: [{ name: "Back", value: BACK }],
  });
  const selected = await requests.select({
    message: "Choose where this task starts",
    options: groupedSelectionEntries(groups),
    default: typeof previous === "string" ? previous : trunk,
    hint: "The preview records both the selected ref and its commit.",
  });
  if (selected === BACK) throw new InteractionCancelled();
  return selected;
}

/** Ask for an optional stored one-line brief. */
async function requestTaskBrief(
  requests: SequentialInteractionRequests,
  previous: unknown,
): Promise<string | undefined> {
  const value = await requests.text({
    message: "One-line task brief (optional)",
    placeholder: "What should the agent know before it starts?",
    hint:
      "Submit an empty value to omit the brief. Ctrl+U returns to the previous question.",
    validate: (brief) =>
      brief.trim() === ""
        ? true
        : taskTextValidationError(brief, "brief") ?? true,
    ...(typeof previous === "string" ? { default: previous } : {}),
  });
  return value.trim() === "" ? undefined : value;
}

/** Return one typed answer from the package-owned task creation form. */
function formAnswer<T extends string | boolean>(
  values: Readonly<Record<string, unknown>>,
  id: string,
  isValue: (value: unknown) => value is T,
): T {
  const value = values[id];
  if (!isValue(value)) {
    throw new Error(`The task creation form did not return ${id}.`);
  }
  return value;
}

/** Whether a form answer names one of the two supported creation paths. */
function isCreationPath(value: unknown): value is CreationPath {
  return value === "compact" || value === "expanded";
}

/** Whether a form answer names one of the two supported title routes. */
function isTaskTitleRoute(value: unknown): value is TaskTitleRoute {
  return value === "describe" || value === "codename";
}

/** Whether a form answer is a string. */
function isString(value: unknown): value is string {
  return typeof value === "string";
}

/** A provider without prompt support gets an explicit, locally scrollable copy handoff. */
async function reviewAgentBrief(
  out: Out,
  task: Pick<StartData["task"], "title" | "brief">,
  launch: DeskAgentLaunch,
  briefPassed: boolean,
  runtime: DeskRuntime,
): Promise<boolean> {
  if (task.brief === undefined) return true;
  if (briefPassed) {
    out.info(
      `The stored brief is passed through ${launch.providerLabel}'s documented prompt option.`,
    );
    return true;
  }
  return await runtime.screen({
    title: "Stored brief",
    source: `${
      deskLiteral(launch.providerLabel)
    }'s configured command does not declare a prompt option. Copy this brief into the session.\n\n${
      deskLiteral(task.brief)
    }`,
    actions: [{ id: "launch", label: `Open ${launch.providerLabel}` }, {
      id: "back",
      label: "Back",
    }],
  }) === "launch";
}

/** Launch the chosen provider from the created worktree, with documented brief handling. */
async function launchCreatedTask(
  out: Out,
  started: StartData,
  launch: DeskAgentLaunch,
  runtime: DeskRuntime,
): Promise<void> {
  const invocation = agentLaunchArgs(launch, started.task.brief);
  if (
    !await reviewAgentBrief(
      out,
      started.task,
      launch,
      invocation.briefPassed,
      runtime,
    )
  ) return;
  out.info(`${launch.providerLabel} opens in ${started.path}.`);
  out.info(`Exit ${launch.providerLabel} to return to the created task.`);
  try {
    const code = await runtime.interactive(
      launch.binary,
      invocation.args,
      started.path,
      deskSessionEnv(),
    );
    if (code !== 0) {
      out.warn(`${launch.label} exited with status ${code}.`);
      await runtime.pause(out);
    }
  } catch (error) {
    out.warn(
      `Could not launch ${launch.label}: ${
        error instanceof Error ? error.message : String(error)
      }`,
    );
    await runtime.pause(out);
  }
}

/**
 * Compose one concrete start plan, apply it after confirmation, then open
 * the selected configured agent. Source approval belongs to the created task.
 */
async function startTask(
  out: Out,
  root: string,
  config: DiscernConfig,
  runtime: DeskRuntime,
  options: StartTaskOptions,
): Promise<string | undefined> {
  const preferences = await runtime.readPreferences(root);
  const launches = buildAgentLaunches(config, options.detectedAgents);
  const preferred = preferences.last_agent === undefined
    ? undefined
    : launches.find((candidate) =>
      candidate.agent === preferences.last_agent &&
      candidate.kind === "open" &&
      candidate.availability !== "disabled"
    );
  let answers: Record<string, unknown>;
  try {
    answers = await runtime.sequence({
      message: "Create a task",
      hint: "Ctrl+U returns to the previous question. Esc returns to the desk.",
      steps: [{
        id: "title_route",
        label: "Task title",
        run: (_values, previous, requests) =>
          pickTaskTitleRoute(
            requests,
            previous ??
              (options.resumeTask === undefined ? undefined : "describe"),
          ),
        summarize: (value) =>
          value === "codename" ? "Generated codename" : "Describe the task",
      }, {
        id: "title",
        label: "Title",
        when: (values) => values.title_route === "describe",
        run: (_values, previous, requests) =>
          requestTaskTitle(
            requests,
            previous ?? options.resumeTask?.task.title,
          ),
        summarize: (value) => typeof value === "string" ? value : "",
      }, {
        id: "creation_path",
        label: "Creation path",
        when: () => options.fixedFrom === undefined,
        run: (_values, previous, requests) =>
          pickCreationPath(
            config.repository.trunk,
            preferences.creation_path ?? "compact",
            requests,
            previous,
          ),
        summarize: (value) =>
          value === "expanded"
            ? "More options"
            : `From ${config.repository.trunk}`,
      }, {
        id: "base",
        label: "Starting point",
        when: (values) =>
          options.fixedFrom === undefined &&
          values.creation_path === "expanded",
        run: (_values, previous, requests) =>
          pickCreationBase(
            options.data,
            config.repository.trunk,
            requests,
            previous,
          ),
        summarize: (value) => typeof value === "string" ? value : "",
      }, {
        id: "brief",
        label: "Task brief",
        when: (values) =>
          options.fixedFrom !== undefined ||
          values.creation_path === "expanded",
        run: (_values, previous, requests) =>
          requestTaskBrief(
            requests,
            previous ?? options.resumeTask?.task.brief,
          ),
      }, {
        id: "agent",
        label: "Agent action",
        when: (values) =>
          options.fixedFrom !== undefined ||
          values.creation_path === "expanded" ||
          preferred === undefined,
        run: (_values, previous, requests) =>
          pickCreationAgent(launches, requests, previous),
        summarize: (value) => {
          if (value === "none") return "Do not open an agent";
          return launches.find((candidate) => candidate.id === value)?.label ??
            "";
        },
      }],
    });
  } catch (error) {
    if (!isInteractionCancelled(error)) throw error;
    return undefined;
  }

  const titleRoute = formAnswer(answers, "title_route", isTaskTitleRoute);
  const titleChoice: TaskTitleChoice = titleRoute === "codename"
    ? { kind: "codename" }
    : { kind: "title", title: formAnswer(answers, "title", isString) };
  const creationPath = options.fixedFrom === undefined
    ? formAnswer(answers, "creation_path", isCreationPath)
    : "expanded";
  const from = options.fixedFrom ??
    (creationPath === "expanded"
      ? formAnswer(answers, "base", isString)
      : config.repository.trunk);
  const brief = creationPath === "expanded"
    ? answers.brief === undefined
      ? undefined
      : formAnswer(answers, "brief", isString)
    : undefined;
  const selectedAgent = answers.agent === undefined
    ? preferred?.id
    : formAnswer(answers, "agent", isString);
  const launchChoice: CreationAgentChoice = selectedAgent === "none" ||
      selectedAgent === undefined
    ? { kind: "none" }
    : {
      kind: "launch",
      launch: launches.find((candidate) => candidate.id === selectedAgent) ??
        (() => {
          throw new Error("The selected agent action is no longer available.");
        })(),
    };
  const launch = launchChoice.kind === "launch"
    ? launchChoice.launch
    : undefined;
  const ctx = await runtime.lifecycle(root);
  const request: StartRequestOptions = {
    worktreeRoot: resolveWorktreeRoot(root, config),
    ...(titleChoice.kind === "title" ? { title: titleChoice.title } : {}),
    ...(brief === undefined ? {} : { brief }),
    ...(from === config.repository.trunk ? {} : { from }),
  };
  const prepared = await runtime.startPlan(ctx, request);
  const command = [
    "discern",
    "start",
    ...(titleChoice.kind === "title" ? ["--title", titleChoice.title] : []),
    ...(brief === undefined ? [] : ["--brief", brief]),
    ...(from === config.repository.trunk ? [] : ["--from", from]),
  ];
  const plan = startPlanToEngine(prepared.plan);
  const source = [
    deskLiteral(plan.title),
    ...plan.details.map(deskLiteral),
    ...plan.steps.map((step) =>
      `- ${
        deskLiteral(
          `${step.disposition}: ${step.label}${
            step.note ? ` — ${step.note}` : ""
          }`,
        )
      }`
    ),
    `Command: ${deskLiteral(commandEvidence(command))}`,
    launch === undefined
      ? "No agent will launch."
      : `${deskLiteral(launch.label)}: ${
        deskLiteral(displayedCommand(launch.binary, launch.args))
      }. Runs in the created checkout.`,
    brief === undefined
      ? "No task brief."
      : `### Brief\n\n${
        deskLiteral(brief)
      }\n\nThe brief is saved with the task and shown for copying; no provider prompt option is added.`,
    "Landing permission is a separate decision after creation.",
  ].join("\n\n");
  const create = await runtime.screen({
    title: "Create task",
    source,
    confirmation: {
      question: launch === undefined
        ? `Create ${prepared.plan.title} from ${prepared.plan.from}?`
        : `Create ${prepared.plan.title} from ${prepared.plan.from} and open ${launch.label}?`,
      options: { defaultTo: false, noLabel: "Cancel", yesLabel: "Create" },
    },
  }) === "apply";
  if (!create) return undefined;
  echoCommand(out, commandEvidence(command));
  const started = await runtime.start(ctx, prepared);
  reportPreferenceWrite(
    out,
    await runtime.writePreferences(root, {
      ...preferences,
      ...(options.fixedFrom === undefined
        ? { creation_path: creationPath }
        : {}),
      ...(launch === undefined ? {} : { last_agent: launch.agent }),
    }),
  );
  out.ok(`Created ${started.task.title} at ${started.path}.`);
  if (launch !== undefined) {
    await launchCreatedTask(out, started, launch, runtime);
  }
  return started.path;
}

/** Action menu for one recoverable branch that currently has no worktree. */
async function actOnUnlandedBranch(
  out: Out,
  root: string,
  config: DiscernConfig,
  branch: string,
  runtime: DeskRuntime,
  startOptions: StartTaskOptions,
): Promise<string | undefined> {
  while (true) {
    const action = await runtime.screen({
      title: "Unlanded branch",
      source: `${
        deskLiteral(branch)
      } has no checkout. Resume creates a task from this branch; inspection changes nothing.`,
      actions: [{ id: "back", label: "Back" }, {
        id: "resume",
        label: "Resume in a worktree",
      }, { id: "inspect", label: "Inspect commits and changed files" }],
    });
    if (action === "back" || action === BACK) return undefined;
    if (action === "inspect") {
      await inspectUnlandedBranch(
        out,
        root,
        config.repository.trunk,
        branch,
        runtime,
      );
      continue;
    }
    const resumeTask = startOptions.data.parked_tasks?.find((task) =>
      task.branch === branch
    );
    return await startTask(out, root, config, runtime, {
      ...startOptions,
      fixedFrom: branch,
      ...(resumeTask === undefined ? {} : { resumeTask }),
    });
  }
}

/**
 * Run one action against a row. Returns true when the fleet state may have
 * changed (leave the action menu and re-survey), false to stay on the menu.
 * Lifecycle refusals (`WorktreeGitError`/`IdentityError`) are the caller's to
 * render — they carry the exact next step.
 */
async function dispatchAction(
  out: Out,
  root: string,
  config: DiscernConfig,
  row: DeskRow,
  action: DeskAction,
  runtime: DeskRuntime,
  startOptions: StartTaskOptions,
  cliModel?: CliModelProvider,
): Promise<boolean | string> {
  const path = row.entry.path;
  const branch = row.entry.branch;
  const trunk = config.repository.trunk;
  const verify = async (): Promise<void> => {
    const observed = await runtime.status(root);
    const current = observed.data?.fleet?.find((entry) => entry.path === path);
    if (
      !observed.ok || current === undefined || current.branch !== branch ||
      current.id !== row.entry.id
    ) {
      throw new WorktreeGitError(
        "The selected task changed. Return to the task list and review it again; no action ran.",
      );
    }
    if (
      current.running && !DESK_ACTION_REGISTRY[action].availableWhileRunning
    ) {
      throw new WorktreeGitError(
        `${current.running.verb} is running in this task. Wait for it to finish, then review the action again.`,
      );
    }
  };
  const review = async (
    plan: EnginePlan | undefined,
    question: string,
    offer?: DeskActionOffer,
  ): Promise<boolean> => {
    if (!await reviewAction(row, action, plan, runtime, question, offer)) {
      return false;
    }
    await verify();
    return true;
  };
  switch (action) {
    case "recovery": {
      const recovery = row.decision.recovery;
      await runtime.screen({
        title: "Recovery",
        source: recovery === undefined
          ? "This task has no degraded state to diagnose."
          : [
            recovery.failure,
            ...(recovery.failedCommand ? [recovery.failedCommand] : []),
            ...recovery.verified,
            ...recovery.unavailable,
            recovery.nextStep,
            recovery.repairCommand,
          ].map(deskLiteral).join("\n\n"),
      });
      return false;
    }
    case "retry_setup": {
      const ctx = await runtime.lifecycle(path);
      if (
        !await review(
          await runtime.setupPlan(ctx),
          `Retry setup for ${branch}?`,
        )
      ) return false;
      await runtime.setup(ctx);
      out.ok(`Setup completed for ${branch}.`);
      return true;
    }
    case "done": {
      if (cliModel === undefined) {
        throw new Error("Desk final checks require a live CLI model provider.");
      }
      const preview = await runtime.donePlan(path, cliModel);
      if (
        !await review(resultPlan(preview), `Run final checks for ${branch}?`)
      ) return false;
      const result = await runtime.done(path, cliModel);
      if (!result.ok) {
        await runtime.screen({
          title: "Final checks did not pass",
          source: renderResultMarkdown(
            serializeResult(result),
            resultPresenterForVerb(result.verb),
          ),
        });
        out.warn(
          result.message ??
            "Final checks did not pass. Read Proof and details.",
        );
      } else {out.ok(
          result.message ??
            `Final checks passed for ${branch}. Proof is current; choose Accept or Join the landing queue.`,
        );}
      return true;
    }
    case "accept": {
      const ctx = await runtime.lifecycle(path);
      const preview = await runtime.acceptPlan(ctx);
      if (
        !await review(
          resultPlan(preview),
          `Start accepting ${branch} onto ${trunk}?`,
        )
      ) return false;
      const result = await runtime.accept(ctx, {
        confirmed: true,
        ...(preview.data?.revision === undefined
          ? {}
          : { expected: preview.data.revision }),
        ...(cliModel === undefined ? {} : { cliModel }),
      });
      if (result !== undefined && !result.ok) {
        await runtime.screen({
          title: "Acceptance did not finish",
          source: renderResultMarkdown(
            serializeResult(result),
            resultPresenterForVerb(result.verb),
          ),
        });
        out.warn(
          result.message ??
            "Acceptance did not finish. Read the retained result before retrying.",
        );
        return false;
      }
      out.ok(
        `Acceptance finished for ${branch}. The refreshed task list shows what landed.`,
      );
      return true;
    }
    case "submit": {
      const preview = await runtime.submit(path, { dryRun: true });
      const plan = resultPlan(preview);
      if (preview.data === undefined) {
        throw new Error("The submission plan returned no revision.");
      }
      const needsAuthority = preview.data.authority.kind !== "authorized";
      const reviewedPlan = plan === undefined ? undefined : {
        ...plan,
        details: [
          ...plan.details,
          ...(needsAuthority
            ? [
              "This flow next asks for effort pre-authorization, then records the reviewed revision. Permission covers later green revisions of this effort until landing; separate exceptions still require their own decisions.",
            ]
            : []),
        ],
      };
      if (
        !await review(
          reviewedPlan,
          `Queue ${preview.data.head.slice(0, 12)} from ${branch}?`,
        )
      ) return false;
      if (needsAuthority) {
        const grantPlan = await runtime.grantEffortPlan(path, branch);
        if (
          !await reviewAction(
            row,
            "grant",
            grantPlan,
            runtime,
            `Allow ${branch} to land once green without a further conversation?`,
          )
        ) return false;
        await verify();
        const current = await runtime.submit(path, {
          dryRun: true,
          expected: preview.data,
        });
        resultPlan(current);
        await runtime.grantEffort(path, branch);
        out.info(
          `Pre-authorized ${branch}. Queueing the reviewed revision next.`,
        );
      }
      const result = await runtime.submit(path, { expected: preview.data });
      if (!result.ok) {
        throw new WorktreeGitError(
          result.message ?? "The revision was not queued.",
        );
      }
      out.ok(
        `${
          result.message ?? "Revision queued."
        } An acceptance walk can pick it up; Accept starts a walk.`,
      );
      return true;
    }
    case "grant": {
      const plan = await runtime.grantEffortPlan(path, branch);
      if (
        !await review(
          plan,
          `Allow ${branch} to land once green without a further conversation?`,
        )
      ) return false;
      await runtime.grantEffort(path, branch);
      const refreshed = (await runtime.status(root)).data;
      const queued = refreshed?.queue?.find((item) => item.branch === branch);
      out.ok(
        queued
          ? `Pre-authorized ${branch}. Queued revision: ${
            queued.head.slice(0, 12)
          }. Accept starts a landing walk.`
          : `Pre-authorized ${branch}. No revision is queued. When Proof is current, choose Accept or Join the landing queue.`,
      );
      if (
        refreshed?.fleet?.find((item) =>
          item.path === path && item.branch === branch
        )?.gate_proof?.status === "honored"
      ) {
        const next = await runtime.select({
          message: "Choose how this proven revision enters landing",
          options: [
            { name: "Back to task", value: BACK },
            {
              name: "Accept and land now",
              value: "accept",
              description:
                "Start acceptance; another landing may hold the turn and checks can refuse.",
            },
            {
              name: "Join the landing queue",
              value: "submit",
              description: "Record this revision without starting a walk.",
            },
          ],
        });
        if (next === "accept" || next === "submit") {
          return await dispatchAction(
            out,
            root,
            config,
            row,
            next,
            runtime,
            startOptions,
            cliModel,
          );
        }
      }
      return true;
    }
    case "revoke_grant": {
      if (
        !await review(
          await runtime.clearEffortGrantPlan(path),
          `Revoke pre-authorization for ${branch}?`,
        )
      ) return false;
      await runtime.clearEffortGrant(path);
      out.ok(
        `Revoked pre-authorization for ${branch}. Any queued revision remains awaiting authority.`,
      );
      return true;
    }
    case "update": {
      const ctx = await runtime.lifecycle(path);
      if (
        !await review(
          resultPlan(await runtime.updatePlan(ctx)),
          `Merge ${trunk} into ${branch}?`,
        )
      ) return false;
      await runtime.update(ctx, {});
      out.ok(`Updated ${branch} from ${trunk}.`);
      return true;
    }
    case "reclaim": {
      const ctx = await runtime.lifecycle(root);
      if (
        !await review(
          await runtime.reclaimPlan(ctx, path),
          `Reclaim this checkout and keep ${branch}?`,
        )
      ) return false;
      await runtime.reclaim(ctx, path);
      out.ok(`Reclaimed ${path}. Branch ${branch} remains.`);
      return true;
    }
    case "park": {
      const ctx = await runtime.lifecycle(root);
      if (
        !await review(
          await runtime.parkPlan(ctx, path),
          `Park this checkout and keep ${branch}?`,
        )
      ) return false;
      await runtime.park(ctx, path);
      out.ok(`Parked ${branch}. Resume it under Work without a worktree.`);
      return true;
    }
    case "drop": {
      const ctx = await runtime.lifecycle(root);
      const plan = await runtime.dropPlan(ctx, path);
      if (!await review(plan, `Drop ${branch}?`)) return false;
      const expected = plan.subject;
      try {
        await runtime.drop(ctx, path, {
          ...(expected === undefined ? {} : { expected }),
        });
      } catch (error) {
        if (!(error instanceof DropWouldDiscardWork)) throw error;
        await runtime.screen({
          title: "Drop would discard work",
          source: deskLiteral(error.message),
        });
        const typed = await runtime.input({
          message:
            `Type ${branch} to discard the reviewed work; anything else cancels`,
          transform: (value) => value.trim(),
        });
        if (typed.trim() !== branch) {
          out.info("Drop cancelled. The task remains.");
          return false;
        }
        await verify();
        await runtime.drop(ctx, path, {
          force: true,
          ...(expected === undefined ? {} : { expected }),
        });
      }
      out.ok(
        `Dropped ${branch}. Committed-tip recovery is bounded; uncommitted files have no automatic recovery.`,
      );
      return true;
    }
    case "scripts": {
      const script = await pickScript(
        row.scripts,
        row.task.name,
        "Task",
        runtime,
        row.scriptsUnavailableReason,
      );
      if (script === undefined) return false;
      return await runAuthorizedProjectScript(
        out,
        path,
        script,
        script.workingDirectory ?? path,
        row.task.name,
        runtime,
        verify,
      );
    }
    case "follow_up":
      return await startTask(out, root, config, runtime, {
        ...startOptions,
        fixedFrom: branch,
      }) ?? false;
    case "agent": {
      const launch = await pickAgentLaunch(row, runtime);
      if (launch === undefined) return false;
      await verify();
      const invocation = agentLaunchArgs(launch, row.entry.task?.brief);
      if (
        row.entry.task !== undefined &&
        !await reviewAgentBrief(
          out,
          row.entry.task,
          launch,
          invocation.briefPassed,
          runtime,
        )
      ) return false;
      await verify();
      out.info(`${launch.providerLabel} opens in ${path}.`);
      out.info(`Exit ${launch.providerLabel} to return to this task.`);
      const code = await runtime.interactive(
        launch.binary,
        invocation.args,
        path,
        deskSessionEnv(),
        "desk agent",
      );
      reportPreferenceWrite(
        out,
        await runtime.writePreferences(root, {
          ...await runtime.readPreferences(root),
          last_agent: launch.agent,
        }),
      );
      if (code !== 0) {
        out.warn(`${launch.label} exited with status ${code}.`);
        await runtime.pause(out);
      } else out.info(`Returned from ${launch.providerLabel}.`);
      return true;
    }
    case "rename": {
      const title = await runtime.input({
        message: "New task title",
        default: row.entry.task?.title ?? row.task.name,
        required: "Enter a task title.",
        validate: (value) => taskTextValidationError(value, "title") ?? true,
      });
      const ctx = await runtime.lifecycle(path);
      const preview = await runtime.renamePlan(ctx, title);
      if (
        !await review(
          resultPlan(preview),
          `Change the task title to ${JSON.stringify(title)}?`,
          {
            ...selectedOffer(row, action),
            command: {
              argv: ["discern", "worktree", "rename", title],
              workingDirectory: "task",
            },
          },
        )
      ) return false;
      const result = await runtime.rename(ctx, title);
      if (!result.ok) {
        throw new WorktreeGitError(result.message ?? "Title change refused.");
      }
      out.ok(result.message ?? `Changed the task title to ${title}.`);
      return true;
    }
    case "jump": {
      const shell = userShell();
      await verify();
      echoCommand(out, `${shell}  (cwd: ${path})`);
      out.info("Exit the shell to return to this task.");
      const code = await runtime.interactive(
        shell,
        [],
        path,
        deskSessionEnv(),
        "desk shell",
      );
      if (code !== 0) {
        out.warn(`Shell exited with status ${code}.`);
        await runtime.pause(out);
      } else out.info("Returned from the shell.");
      return true;
    }
    case "inspect":
      await reviewTask(out, row, trunk, runtime);
      return false;
  }
}

/**
 * Run the desk. Returns a process exit code: 0 for any session the operator
 * ended (including "nothing to do"), 1 for a refusal (no TTY, `--json`, no
 * project) or a failed survey.
 */
export async function runDesk(
  opts: DeskOptions = {},
  overrides: Partial<DeskRuntime> = {},
): Promise<number> {
  const runtime: DeskRuntime = { ...DEFAULT_DESK_RUNTIME, ...overrides };
  if (runtime.inDeskSession()) {
    const message =
      "discern desk is already active above this session — exit this shell, coding agent, or Project Script to return to it.";
    if (opts.json ?? false) {
      emitResult({
        ok: false,
        verb: "desk",
        error: "desk_already_active",
        message,
      });
    } else {
      runtime.error(message);
    }
    return 1;
  }
  if (opts.json ?? false) {
    emitResult({
      ok: false,
      verb: "desk",
      error: "invalid_arguments",
      message:
        "the desk is an interactive human surface with no JSON form — for the fleet survey use `discern status --json`.",
    });
    return 1;
  }
  if (!runtime.canInteract()) {
    runtime.error(
      "discern desk needs an interactive terminal (stdin and stdout TTYs) — in a pipe or script use `discern status`.",
    );
    return 1;
  }
  const root = await runtime.findRoot();
  if (root === undefined) {
    runtime.error(NO_PROJECT_MESSAGE);
    return 1;
  }
  const out = runtime.makeOut();
  const config = await runtime.loadConfig(root);

  const main = await runtime.mainRepoPath(root);
  if (main !== undefined && main !== root) {
    out.info(
      `The desk runs from the main checkout: cd ${main} — this is a worktree. For this worktree's own state: discern status.`,
    );
    return 0;
  }
  const capabilities = async (row: DeskRow): Promise<DeskRow> => {
    const loaded = await loadWorktreeConfig(row.entry.path, runtime);
    if (loaded.config === undefined) {
      return {
        ...row,
        capabilityError: loaded.error ?? "Task configuration unavailable",
        decision: {
          ...row.decision,
          actions: buildDeskDecision(row.entry, {
            trunk: config.repository.trunk,
            nowMs: runtime.now(),
            scripts: [],
            agentLaunches: [],
            capabilityError: loaded.error ?? "Task configuration unavailable",
          }).actions,
        },
      };
    }
    const detected = await runtime.detectAgents();
    const inventory = scriptInventory(
      row.entry.path,
      await runtime.scripts(row.entry.path, loaded.config),
    );
    const agentLaunches = buildAgentLaunches(loaded.config, detected);
    return {
      ...row,
      scripts: inventory.scripts,
      ...(inventory.unavailableReason === undefined
        ? {}
        : { scriptsUnavailableReason: inventory.unavailableReason }),
      agentLaunches,
      decision: {
        ...row.decision,
        actions: buildDeskDecision(row.entry, {
          trunk: config.repository.trunk,
          nowMs: runtime.now(),
          scripts: inventory.scripts,
          agentLaunches,
          ...(inventory.unavailableReason === undefined
            ? {}
            : { scriptsUnavailableReason: inventory.unavailableReason }),
        }).actions,
      },
    };
  };
  try {
    await runtime.application(liveDesk({
      trunk: config.repository.trunk,
      now: runtime.now,
      observe: async () => {
        const result = await runtime.status(root);
        if (!result.ok || result.data === undefined) {
          throw new Error(result.message ?? "The status survey failed.");
        }
        return result.data;
      },
      capabilities,
      tip: async (data) => {
        const state = await runtime.readTipState(root);
        const selected = selectTip(TIPS, { data, config }, state);
        if (selected === undefined) return undefined;
        const tipLine = renderTipLine(selected);
        await runtime.writeTipState(
          root,
          markTipShown(
            state,
            selected.tip.id,
            new Date(runtime.now()).toISOString(),
          ),
        );
        runtime.recordTipShown(selected.tip.id);
        return tipLine;
      },
      perform: async (choice, data, row) =>
        await collectDeskFeedback(out, async (out) => {
          const startOptions: StartTaskOptions = {
            data,
            detectedAgents: (choice.kind === "route" &&
                ["start", "unlanded"].includes(choice.route)) ||
                (choice.kind === "action" && choice.action === "follow_up")
              ? await runtime.detectAgents()
              : [],
          };
          if (choice.kind === "action" && row !== undefined) {
            const outcome = await dispatchAction(
              out,
              root,
              config,
              row,
              choice.action,
              runtime,
              startOptions,
              opts.cliModel,
            );
            return typeof outcome === "string" ? outcome : undefined;
          }
          if (choice.kind !== "route") return;
          switch (choice.route) {
            case "start":
              return await startTask(out, root, config, runtime, startOptions);
            case "unlanded":
              if (
                choice.branch !== undefined &&
                data.unlanded_branches?.includes(choice.branch)
              ) {
                return await actOnUnlandedBranch(
                  out,
                  root,
                  config,
                  choice.branch,
                  runtime,
                  startOptions,
                );
              }
              return;
            case "scripts": {
              const scripts = scriptInventory(
                root,
                await runtime.scripts(root, await runtime.loadConfig(root)),
              );
              await runRootProjectScript(
                out,
                root,
                data.project ?? basename(root),
                scripts.scripts,
                runtime,
              );
              return;
            }
            case "main":
              return await actOnMainCheckout(out, root, data, runtime);
            case "recent":
              return await showRecentCompleted(root, data, runtime);
            case "docs":
              return await openDeskManual(out, runtime);
          }
        }),
    }));
  } catch (error) {
    if (!isInteractionCancelled(error)) {
      runtime.error(error instanceof Error ? error.message : String(error));
      return 1;
    }
  }
  return 0;
}
