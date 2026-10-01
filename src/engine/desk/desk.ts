/**
 * `desk` — the operator's interactive ingress and surface over the worktree fleet
 * (ADR 0119). Bare `discern`, post-setup on an interactive terminal, opens it;
 * `discern desk` is the named form the guards and docs see.
 *
 * The desk is a renderer and a dispatcher, never a source of truth: state comes
 * from `statusResult` (the fleet survey, whose rows carry their gate-proof and
 * landing-authority facts), and every mutation runs the same lifecycle core the
 * CLI verb runs — a core's refusal is rendered, never bypassed. One package
 * application session lasts the Desk's whole life: the inbox, its inspector,
 * and every review, menu, palette, form and reader are layers of it. An
 * effect that changes project state runs beside that screen, and only
 * terminal-owning children take the terminal. The effort-grant
 * action is deliberately desk-only: this TTY is the sole write boundary, while
 * agent CLI and MCP surfaces can only read the resulting grant.
 *
 * Deliberately CLI-only — no MCP tool — for `worktree drop`'s reason: the desk
 * wields human supervisory actions over OTHER efforts' worktrees, which the
 * fleet-ownership rule forbids an agent. Without a TTY (or under `--json`) it
 * refuses with a pointer at `status`.
 */

import {
  executeDeskOperation,
  runDeskEffectInSession,
  runDeskInteractiveChild,
  runDeskProjectScript,
} from "./execution.ts";
export {
  executeDeskOperation,
  runDeskEffectInSession,
  runDeskInteractiveChild,
  runDeskProjectScript,
} from "./execution.ts";
import { INTERRUPT_SIGNALS, reraiseInterrupt } from "../process_signals.ts";
import { readProofNoteAt } from "../gate/proof_notes.ts";
import {
  type DocsBrowserRequest,
  readDocsBrowser,
} from "../../commands/docs.ts";
import { DESK_MANUAL_EXIT, deskManual } from "./manual.ts";
import { SYSTEM_CLOCK, wallTimeIso } from "../../shared/clock.ts";
import { type Scheduler, SYSTEM_SCHEDULER } from "../../shared/scheduler.ts";
import { findRoot, NO_PROJECT_MESSAGE } from "../../shared/env.ts";
import { emitResult } from "../../shared/emit.ts";
import { interactiveHintTexts } from "../../shared/hints.ts";
import { type DiscernConfig, loadConfig } from "../../shared/config_schema.ts";
import type { CliModelProvider } from "../../shared/cli_reference_codegen.ts";
import type { DiscernResult, EnginePlan } from "../../shared/result.ts";
import type {
  AcceptData,
  GateData,
  StartData,
  StatusData,
  SubmissionRevision,
  TaskRenameData,
  UpdateData,
} from "../../shared/result_schemas.ts";
import {
  detectAgentBinariesOnPath,
  type DetectedAgentBinary,
} from "../../lib/detect_agents.ts";
import { type PagerResult, pageThrough } from "../../lib/pager.ts";
import {
  canInteract,
  isInteractionCancelled,
  requestCompactAcknowledgement,
  runTerminalApplication,
  type TerminalApplicationOptions,
} from "../../lib/terminal_interaction.ts";
import type { TerminalApplicationState } from "discern-design-system/cli/interactive";
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
  type LifecycleContext,
  lifecycleContext,
  type PreparedStart,
  type StartRequestOptions,
  taskRenameResult,
  update,
  updateResult,
  worktreeDrop,
  worktreeDropPlan,
  worktreePark,
  worktreeParkPlan,
  worktreeReclaimContained,
  worktreeReclaimContainedPlan,
  worktreeSetup,
  worktreeSetupPlan,
} from "../worktree/lifecycle.ts";
import { mainRepoPath } from "../worktree/git.ts";
import { commandExists, runGit } from "../../shared/subprocess.ts";
import { fileSha256Hex } from "../../shared/sha256.ts";
import { makeOut, type Out } from "../output.ts";
import { latestOperationRecord } from "../completion/operation_journal.ts";
import {
  type DeskProjectScript,
  type DeskProjectScriptInventory,
  inspectDeskProjectScriptsWithConfig,
} from "../project_scripts.ts";
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
import { terminalContext } from "../../lib/terminal.ts";
import { deskSessionEnv, inDeskSession } from "./session.ts";
import { simpleCommandArgv } from "./literal_argv.ts";
import { acceptLandingResult } from "../worktree/accept.ts";
import type { DropPlan, ParkPlan, ReclaimPlan } from "../worktree/plan.ts";
import type { DeskEditorCommand } from "./contracts.ts";
import type { DeskIntent, DeskLoad, DeskProductState } from "./desk_state.ts";
import { DESK_LIST_ID, rowRef } from "./desk_transitions.ts";
import { type DeskFlows, type DeskHandoff, liveDesk } from "./live.ts";
import { foldedGroups } from "./inbox_view.ts";
import { DESK_EVIDENCE_TIMEOUT_MS } from "./evidence.ts";
import type { DeskFlowContext } from "./flows/context.ts";
import { applyStep, reviewStep } from "./flows/registry.ts";
import type { DeskLandingPermission } from "./flows/landing.ts";
import { withCompletionPublication } from "../operation_lock.ts";
import {
  clearEffortGrant,
  clearEffortGrantPlan,
} from "../worktree/effort_grant_cleanup.ts";
import {
  effortGrantPlan,
  grantEffort,
} from "../worktree/effort_grant_writer.ts";
import {
  readBranchCommits,
  readCapabilities,
  readChanges,
  readLandedProof,
  scriptInventory,
} from "./flows/reading.ts";
import { runChild } from "./flows/children.ts";
import { startLaunches } from "./flows/start.ts";

/** Flags accepted by `desk`. */
export interface DeskOptions {
  /** Present for surface parity only — the desk has no JSON form; it refuses. */
  json?: boolean;
  /** Fully attached live command tree supplied by the binary entry point. */
  cliModel?: CliModelProvider;
}

type DeskMaybePromise<T> = T | Promise<T>;
type DeskScriptDiscovery =
  | DeskProjectScriptInventory
  | readonly DeskProjectScript[];

/**
 * The Desk's own termination: SIGTERM and SIGHUP, and SIGINT while the
 * screen is owned. Each ends the session, which stops every operation
 * running beside it through its signal, so each journal records where it
 * stopped exactly as a CLI interruption does; `release` says which ended it.
 */
export interface DeskTermination {
  readonly signal: AbortSignal;
  /** SIGINT reached the owned screen. */
  interrupt(): void;
  /** Stop listening, and say which signal ended the session, if one did. */
  release(): Deno.Signal | undefined;
}

/** The terminal and effect boundary behind the desk's interactive session.
 * Production keeps its runtime private; tests replace it with a scripted
 * runtime so every supervisory path is exercised without pretending a pipe is
 * a terminal or touching a real worktree. */
export interface DeskRuntime extends DeskLandingPermission {
  /** Read the manual the Desk opens in place of its inbox. */
  manual(): DeskMaybePromise<DocsBrowserRequest>;
  canInteract(): boolean;
  inDeskSession(): boolean;
  findRoot(): DeskMaybePromise<string | undefined>;
  loadConfig(root: string): DeskMaybePromise<DiscernConfig>;
  status(root: string): DeskMaybePromise<{
    ok: boolean;
    data?: StatusData | undefined;
    message?: string | undefined;
    hints?: readonly string[] | undefined;
  }>;
  mainRepoPath(root: string): DeskMaybePromise<string | undefined>;
  makeOut(): Out;
  error(message: string): void;
  application(
    options: TerminalApplicationOptions<DeskIntent>,
    termination: DeskTermination,
  ): Promise<TerminalApplicationState>;
  /** Listen for the Desk's own termination for one session. */
  terminations(): DeskTermination;
  /** End the process with the signal that terminated the Desk. */
  raise(signal: Deno.Signal): void;
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
  ): DeskMaybePromise<DiscernResult<AcceptData>>;
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
  ): DeskMaybePromise<EnginePlan & { subject?: ParkPlan }>;
  reclaim(ctx: LifecycleContext, target: string): DeskMaybePromise<void>;
  reclaimPlan(
    ctx: LifecycleContext,
    target: string,
  ): DeskMaybePromise<EnginePlan & { subject?: ReclaimPlan }>;
  git(
    args: string[],
    cwd: string,
    options?: { readonly timeoutMs?: number; readonly signal?: AbortSignal },
  ): DeskMaybePromise<{ success: boolean; stdout: string; stderr: string }>;
  proof(
    root: string,
  ): DeskMaybePromise<Awaited<ReturnType<typeof inspectGateProof>>>;
  landedProof(
    root: string,
    commit: string,
  ): DeskMaybePromise<Awaited<ReturnType<typeof readProofNoteAt>>>;
  /** The newest retained record of a verb's run on a branch, if any. */
  operationRecord(
    root: string,
    selector: { readonly branch: string; readonly verb: string },
  ): DeskMaybePromise<Awaited<ReturnType<typeof latestOperationRecord>>>;
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
  /** A file's content digest, binding a reviewed script to what runs. */
  fileDigest(path: string): DeskMaybePromise<string>;
  now(): number;
  /** Timers for the refresh cadence, the selection settle, and running clocks. */
  readonly scheduler: Scheduler;
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
}

/** The signals that end the Desk, besides SIGINT on its owned screen. */
const DESK_TERMINATION_SIGNALS = INTERRUPT_SIGNALS.filter((signal) =>
  signal !== "SIGINT"
);

/** Listen for the Desk's own termination, as production does. */
function deskTerminations(): DeskTermination {
  const controller = new AbortController();
  let received: Deno.Signal | undefined;
  const end = (signal: Deno.Signal): void => {
    received ??= signal;
    controller.abort();
  };
  const handlers = DESK_TERMINATION_SIGNALS.map((signal) => {
    const handler = (): void => end(signal);
    Deno.addSignalListener(signal, handler);
    return [signal, handler] as const;
  });
  return {
    signal: controller.signal,
    interrupt: () => end("SIGINT"),
    release: () => {
      for (const [signal, handler] of handlers) {
        Deno.removeSignalListener(signal, handler);
      }
      return received;
    },
  };
}

/** The narrating logger the lifecycle cores render human output through. */
function deskLogger(): Logger {
  return new Logger({ json: false, noColor: false, humanStream: "stdout" });
}

/** Resolve the host's conventional editor settings at one injectable edge. */
function configuredEditorCommand(
  visual: string | undefined = Deno.env.get("VISUAL")?.trim(),
  editor: string | undefined = Deno.env.get("EDITOR")?.trim(),
): string | undefined {
  return visual || editor;
}

/** The real terminal/git implementation. Keeping the boundary in one value
 * makes the whole interactive surface scriptable while the CLI still calls the
 * same functions with the same options. */
const DEFAULT_DESK_RUNTIME: DeskRuntime = {
  manual: () => readDocsBrowser("docs", { exitLabel: DESK_MANUAL_EXIT }),
  canInteract: () => canInteract(false),
  inDeskSession: () => inDeskSession(),
  findRoot: () => findRoot(),
  loadConfig: (root) => loadConfig(root),
  status: (root) => statusResult(root, { all: true }),
  mainRepoPath: (root) => mainRepoPath(root),
  // The only production writers of landing permission: this runtime is
  // private to the Desk's entry, which only the CLI's human surfaces open.
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
  application: (options, termination) =>
    runTerminalApplication(options, {
      abortSignal: termination.signal,
      onInterrupt: () => termination.interrupt(),
    }),
  terminations: () => deskTerminations(),
  raise: (signal) => reraiseInterrupt(signal),
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
  // The Desk's confirm is the owner's consent, so its preview reads the
  // authority a confirmed landing would use.
  acceptPlan: (ctx) =>
    acceptLandingResult(ctx, {
      target: ctx.cwd,
      dryRun: true,
      confirmed: true,
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
      {
        command: "accept",
        action: "queue",
        ...(options.dryRun ? { dryRun: true } : {}),
      },
      async (signal) =>
        acceptLandingResult(await lifecycleContext(path, deskLogger()), {
          ...options,
          queueOnly: true,
          dryRun: options.dryRun ?? false,
          confirmed: false,
          variance: [],
          approveStandard: [],
          met: [],
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
  git: (args, cwd, options = {}) =>
    runGit(args, {
      cwd,
      ...(options.timeoutMs === undefined
        ? {}
        : { timeoutMs: options.timeoutMs }),
      ...(options.signal === undefined ? {} : { signal: options.signal }),
    }),
  proof: (root) => inspectGateProof(root),
  landedProof: readProofNoteAt,
  operationRecord: (root, selector) => latestOperationRecord(root, selector),
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
  fileDigest: (path) => fileSha256Hex(path),
  now: SYSTEM_CLOCK.wallNow,
  scheduler: SYSTEM_SCHEDULER,
  readTipState: (root) => readTipSeenState(root, DISCERN_VERSION),
  writeTipState: (root, state) => writeTipSeenState(root, state),
  readPreferences: (root) => readDeskPreferences(root),
  writePreferences: (root, preferences) =>
    writeDeskPreferences(root, preferences),
  recordTipShown: (id) => observeShownTip(id),
};

/** Where a child or script runs, as the handoff line names it. */
function childPlace(
  state: DeskProductState,
  taskId: string | undefined,
): string {
  const ref = taskId === undefined ? undefined : rowRef(state, taskId);
  return ref?.kind === "task" ? ref.row.task.name : "the main checkout";
}

/** The line painted before an effect or child takes the terminal. */
function handoffLine(
  state: DeskProductState,
  effect: DeskHandoff,
): string {
  switch (effect.kind) {
    case "apply":
      return effect.review.confirm?.kind === "apply"
        ? effect.review.confirm.running
        : "Running";
    case "exit":
      return "Leaving the desk";
    case "child":
      break;
  }
  const child = effect.child;
  switch (child.kind) {
    case "agent": {
      const ref = rowRef(state, child.taskId);
      const launch = ref?.kind === "task"
        ? ref.row.agentLaunches.find((candidate) =>
          candidate.id === child.launch
        )
        : undefined;
      return `Opening ${launch?.providerLabel ?? "the agent"} in ${
        childPlace(state, child.taskId)
      } · exit it to come back`;
    }
    case "shell":
      return `Opening a shell in ${
        childPlace(state, child.taskId)
      } · exit it to come back`;
    case "editor":
      return `Opening your editor in ${
        childPlace(state, child.taskId)
      } · exit it to come back`;
    case "diff":
      return "Showing the changes in your pager · quit it to come back";
  }
}

/** One read, as the reader shows it: what it found, or why it couldn't. */
async function readLoad<T>(read: () => Promise<T>): Promise<DeskLoad<T>> {
  try {
    return { state: "ready", value: await read() };
  } catch (error) {
    return {
      state: "failed",
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

/** The flows a live session runs, over one project and runtime. */
function deskFlows(
  root: string,
  config: DiscernConfig,
  runtime: DeskRuntime,
  cliModel: CliModelProvider | undefined,
): DeskFlows {
  const context = (state: DeskProductState): DeskFlowContext => ({
    root,
    config,
    runtime,
    state,
    ...(cliModel === undefined ? {} : { cliModel }),
  });
  return {
    review: (state, step) => reviewStep(context(state), step),
    read: async (state, reader) => {
      switch (reader.kind) {
        case "changes":
          return {
            kind: "changes",
            load: await readLoad(async () => {
              const ref = rowRef(state, reader.taskId);
              if (ref?.kind !== "task") {
                throw new Error("The task is no longer listed.");
              }
              return await readChanges(context(state), ref.row);
            }),
          };
        case "branch":
          return {
            kind: "markdown",
            load: await readLoad(() =>
              readBranchCommits(context(state), reader.branch)
            ),
          };
        case "landed":
          return {
            kind: "markdown",
            load: await readLoad(() =>
              readLandedProof(context(state), reader.ref)
            ),
          };
        default:
          throw new TypeError(`${reader.kind} reads nothing`);
      }
    },
    scripts: (state, owner) => {
      const ref = owner.kind === "task"
        ? rowRef(state, owner.taskId)
        : undefined;
      return scriptInventory(
        context(state),
        ref?.kind === "task" ? ref.row.entry.path : root,
      );
    },
    capabilities: (state, row) => readCapabilities(context(state), row),
    handoff: (state, effect) => handoffLine(state, effect),
    operate: (state, operation, session) =>
      runDeskEffectInSession(
        session,
        () =>
          applyStep(context(state), operation.step, operation.review.expected, {
            out: runtime.makeOut(),
            ...(operation.challenge === undefined
              ? {}
              : { challenge: operation.challenge }),
          }),
      ),
    open: (state, step, review, signal) =>
      runDeskEffectInSession(
        { signal, output: () => {}, observe: () => {} },
        () =>
          applyStep(context(state), step, review.expected, {
            out: runtime.makeOut(),
          }),
      ),
    run: async (state, effect) => {
      const out = runtime.makeOut();
      switch (effect.kind) {
        case "apply":
          return await applyStep(
            context(state),
            effect.step,
            effect.review.expected,
            {
              out,
              ...(effect.challenge === undefined
                ? {}
                : { challenge: effect.challenge }),
              ...(effect.open === undefined ? {} : { open: effect.open }),
            },
          );
        case "child":
          return await runChild(context(state), out, effect.child);
        case "exit":
          throw new TypeError("Leaving the desk runs nothing.");
      }
    },
  };
}

/** Select, record, and render the session's tip. */
async function sessionTip(
  root: string,
  config: DiscernConfig,
  runtime: DeskRuntime,
  data: StatusData,
): Promise<string | undefined> {
  const state = await runtime.readTipState(root);
  const selected = selectTip(TIPS, { data, config }, state);
  if (selected === undefined) return undefined;
  await runtime.writeTipState(
    root,
    markTipShown(
      state,
      selected.tip.id,
      new Date(runtime.now()).toISOString(),
    ),
  );
  runtime.recordTipShown(selected.tip.id);
  return renderTipLine(selected);
}

/** Remember the groups the owner left folded, once they differ from the
 * folds the session started with. */
async function rememberFolds(
  root: string,
  runtime: DeskRuntime,
  out: Out,
  state: TerminalApplicationState,
): Promise<void> {
  const folds = state.lists[DESK_LIST_ID]?.folds;
  if (folds === undefined) return;
  const preferences = await runtime.readPreferences(root);
  const started = new Set(foldedGroups(preferences));
  if (
    folds.length === started.size && folds.every((group) => started.has(group))
  ) return;
  const saved = await runtime.writePreferences(root, {
    ...preferences,
    folded_groups: [...folds],
  });
  if (saved.status !== "saved") {
    out.warn(`Desk preferences were not saved: ${saved.reason}`);
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
  const termination = runtime.terminations();
  try {
    const session = liveDesk({
      trunk: config.repository.trunk,
      root,
      version: DISCERN_VERSION,
      preferences: await runtime.readPreferences(root),
      launches: () => startLaunches(config, runtime),
      now: runtime.now,
      scheduler: runtime.scheduler,
      observe: async () => {
        const result = await runtime.status(root);
        if (!result.ok || result.data === undefined) {
          throw new Error(result.message ?? "The status survey failed.");
        }
        // The owner reads these: agent-directed hints stay on the wire, as
        // on any interactive terminal.
        return { data: result.data, hints: interactiveHintTexts(result.hints) };
      },
      tip: (data) => sessionTip(root, config, runtime, data),
      manual: async () =>
        deskManual(
          await runtime.manual(),
          async (url) => await runtime.openBrowser(url),
        ),
      evidence: {
        git: async (args, cwd, signal) =>
          await runtime.git([...args], cwd, {
            timeoutMs: DESK_EVIDENCE_TIMEOUT_MS,
            signal,
          }),
        failures: async (branch, verb) => {
          const found = await runtime.operationRecord(root, { branch, verb });
          return found?.record.failures?.map((failure) => ({
            name: failure.name,
            message: failure.message,
            ...(failure.file === undefined ? {} : { file: failure.file }),
            ...(failure.line === undefined ? {} : { line: failure.line }),
          }));
        },
      },
      flows: deskFlows(root, config, runtime, opts.cliModel),
      persist: async (preferences) =>
        await runtime.writePreferences(root, preferences),
    });
    const final = await runtime.application(session, termination);
    // A toggle's write may still be landing; the folds must not overtake it.
    await session.saved();
    await rememberFolds(root, runtime, out, final);
  } catch (error) {
    if (!isInteractionCancelled(error)) {
      runtime.error(error instanceof Error ? error.message : String(error));
      return 1;
    }
  } finally {
    // The session has settled with every operation it ran; a termination
    // still ends the process with its conventional status.
    const received = termination.release();
    if (received !== undefined) runtime.raise(received);
  }
  return 0;
}
