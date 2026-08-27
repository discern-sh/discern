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
import { bestEffort } from "../../shared/best_effort.ts";
import {
  commandEvidence,
  quoteCommandWord,
} from "../../shared/command_evidence.ts";
import { DISCERN_DOCS_URL } from "../../shared/brand.ts";
import { SYSTEM_CLOCK, wallTimeIso } from "../../shared/clock.ts";
import { findRoot, NO_PROJECT_MESSAGE } from "../../shared/env.ts";
import { emitResult } from "../../shared/emit.ts";
import { type DiscernConfig, loadConfig } from "../../shared/config_schema.ts";
import type { CliModelProvider } from "../../shared/cli_reference_codegen.ts";
import type { DiscernResult, EnginePlan } from "../../shared/result.ts";
import type {
  AcceptData,
  GateData,
  StartData,
  StatusData,
  UpdateData,
} from "../../shared/result_schemas.ts";
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
  isInteractionCancelled,
  requestConfirmation,
  requestSelection,
  requestText,
  type SelectionGroup,
  type SelectionRequestOptions,
  type TextRequestOptions,
} from "../../lib/terminal_interaction.ts";
import { Logger } from "../../lib/log.ts";
import {
  browserOpenFailureMessage,
  type BrowserOpenResult,
  openInBrowser,
} from "../../lib/open_browser.ts";
import { statusResult } from "../status/status.ts";
import { finishResult } from "../gate/finish.ts";
import { inspectGateProof } from "../gate/proof.ts";
import {
  accept,
  acceptResult,
  IdentityError,
  type LifecycleContext,
  lifecycleContext,
  startResult,
  update,
  updateResult,
  worktreeDrop,
  worktreeDropPlan,
  WorktreeGitError,
  worktreeReclaimContained,
  worktreeReclaimContainedPlan,
} from "../worktree/lifecycle.ts";
import { mainRepoPath } from "../worktree/git.ts";
import { commandExists, runGit } from "../../shared/subprocess.ts";
import { makeOut, type Out } from "../output.ts";
import { runOwnedChild } from "../owned_child.ts";
import { withOperationLock } from "../operation_lock.ts";
import {
  type DeskProjectScript,
  type DeskProjectScriptInventory,
  inspectDeskProjectScriptsWithConfig,
  runProjectScriptAt,
} from "../project_scripts.ts";
import {
  buildAgentLaunches,
  buildDeskBoardDecision,
  buildDeskRows,
  type DeskAction,
  type DeskActionOffer,
  type DeskAgentLaunch,
  type DeskRow,
} from "./model.ts";
import {
  markTipShown,
  renderTipLine,
  selectTip,
  type TipSeenState,
} from "./tips.ts";
import { readTipSeenState, writeTipSeenState } from "./tip_state.ts";
import { TIPS } from "../../shared/tips.ts";
import { observeShownTip } from "../../shared/result_capture.ts";
import { KIT_VERSION } from "../../lib/version.ts";
import { terminalSize } from "../../lib/text.ts";
import {
  terminalContext,
  terminalContextAtSize,
  terminalLine,
  type TerminalSize,
} from "../../lib/terminal.ts";
import { deskSessionEnv, inDeskSession } from "./session.ts";
import {
  clearEffortGrant,
  clearEffortGrantPlan,
} from "../worktree/effort_grant_cleanup.ts";
import {
  effortGrantPlan,
  type EffortGrantWrite,
  grantEffort,
} from "../worktree/effort_grant_writer.ts";
import { userShell } from "../user_shell.ts";
import {
  DESK_FILTER_THRESHOLD,
  DESK_REVIEW_ROUTES,
  DESK_ROUTES,
  deskActionGroups,
  deskCompositionReserveRows,
  type DeskEditorCommand,
  type DeskReview,
  type DeskReviewFailure,
  type DeskReviewFile,
  deskReviewGroups,
  deskRootPrompt,
  deskRootSelectionGroups,
  deskRootUsesSearch,
  renderDeskActionFailure,
  renderDeskActionPlan,
  renderDeskBoard,
  renderDeskProjectScriptPlan,
  renderDeskReview,
  renderDeskTaskDetail,
} from "./view.ts";

const {
  back: BACK,
  quit: QUIT,
  readDocs: READ_DOCS,
  refresh: REFRESH,
  runProjectScript: RUN_PROJECT_SCRIPT,
  startTask: START_TASK,
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
  grantEffortPlan(path: string, branch: string): DeskMaybePromise<EnginePlan>;
  grantEffort(
    path: string,
    branch: string,
  ): DeskMaybePromise<EffortGrantWrite>;
  clearEffortGrantPlan(path: string): DeskMaybePromise<EnginePlan>;
  clearEffortGrant(path: string): DeskMaybePromise<boolean>;
  makeOut(): Out;
  error(message: string): void;
  select(options: DeskSelectOptions): DeskMaybePromise<string>;
  confirm(
    message: string,
    options: ConfirmationRequestOptions,
  ): DeskMaybePromise<boolean>;
  input(options: TextRequestOptions): DeskMaybePromise<string>;
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
    cliModel: CliModelProvider,
  ): DeskMaybePromise<DiscernResult<AcceptData>>;
  accept(
    ctx: LifecycleContext,
    opts: {
      dryRun?: boolean;
      confirmed?: boolean;
      cliModel?: CliModelProvider;
    },
  ): DeskMaybePromise<void>;
  update(
    ctx: LifecycleContext,
    opts: { dryRun?: boolean },
  ): DeskMaybePromise<void>;
  updatePlan(
    ctx: LifecycleContext,
  ): DeskMaybePromise<DiscernResult<UpdateData>>;
  drop(
    ctx: LifecycleContext,
    target: string,
    opts: { dryRun?: boolean; force?: boolean },
  ): DeskMaybePromise<void>;
  dropPlan(
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
  ): DeskMaybePromise<number>;
  detectAgents(): DeskMaybePromise<readonly DetectedAgentBinary[]>;
  start(
    ctx: LifecycleContext,
    opts: { worktreeRoot: string; name?: string },
  ): DeskMaybePromise<StartData>;
  /** Discover `root`'s executable Project Scripts under its ALREADY-loaded
   * config, so one board pass never reads the same config twice. */
  scripts(
    root: string,
    config: DiscernConfig,
  ): DeskMaybePromise<DeskScriptDiscovery>;
  runScript(
    root: string,
    name: string,
    env: Record<string, string>,
  ): DeskMaybePromise<number>;
  openBrowser(url: string): DeskMaybePromise<BrowserOpenResult>;
  now(): number;
  /** Read the repository's tip seen-state; never throws (store contract). */
  readTipState(root: string): DeskMaybePromise<TipSeenState>;
  /** Persist the tip seen-state, best-effort; never throws (store contract). */
  writeTipState(root: string, state: TipSeenState): DeskMaybePromise<void>;
  /** Report a shown tip id for the session's logbook event. */
  recordTipShown(id: string): void;
  /** The live viewport sampled once for each complete Desk composition. */
  size(): TerminalSize;
}

/** Dim "→ <command>" line: the CLI equivalent of the action about to run. */
function echoCommand(out: Out, command: string): void {
  out.raw(
    `${out.terminal.role(terminalLine(`→ ${command}`), "muted")}\n`,
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

/** Render one action's real core plan before any confirmation or effect. */
function showActionPlan(
  out: Out,
  row: DeskRow,
  action: DeskAction,
  plan: EnginePlan | undefined,
  runtime: DeskRuntime,
  offerOverride?: ReturnType<typeof selectedOffer>,
): void {
  const viewport = runtime.size();
  const terminal = terminalContextAtSize(out.terminal, viewport);
  const frame = renderDeskActionPlan(
    row,
    offerOverride ?? selectedOffer(row, action),
    plan,
    viewport,
    terminal,
  );
  out.raw(`${frame.text}\n`);
}

/** Render one Project Script's resolved executable evidence before selection. */
function showProjectScriptPlan(
  out: Out,
  script: DeskProjectScript,
  workingDirectory: string,
  runtime: DeskRuntime,
): void {
  const viewport = runtime.size();
  const terminal = terminalContextAtSize(out.terminal, viewport);
  const frame = renderDeskProjectScriptPlan(
    script,
    workingDirectory,
    viewport,
    terminal,
  );
  out.raw(`${frame.text}\n`);
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

/** Ask through the registry's exact No-default confirmation policy. */
async function confirmAction(
  row: DeskRow,
  action: DeskAction,
  message: string,
  runtime: DeskRuntime,
): Promise<boolean> {
  const policy = selectedOffer(row, action).confirmation;
  if (policy.kind === "none") return true;
  return await runtime.confirm(message, {
    defaultTo: policy.defaultTo,
    noLabel: policy.noLabel,
    yesLabel: policy.yesLabel,
  });
}

/** Clear the screen and home the cursor: the desk redraws its whole board on
 * every survey pass, so stale headers never stack up the scrollback. Cursor
 * control, not colour — NO_COLOR does not disable it (the desk only ever runs
 * on a TTY). */
function clearBoard(out: Out): void {
  out.raw("\x1b[2J\x1b[H");
}

/** Hold the board until ↵, so output worth reading (an acceptance's proof, a
 * drop's summary) isn't wiped by the next survey pass's clear. */
async function awaitEnter(out: Out): Promise<void> {
  out.group("return-to-desk");
  out.raw(`${out.terminal.role("press ↵ to return to the desk", "muted")} `);
  const buf = new Uint8Array(64);
  await Deno.stdin.read(buf);
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

/** Launch one desk-owned interactive child with the desk's interrupt contract. */
export async function runDeskInteractiveChild(
  command: string,
  args: readonly string[],
  cwd: string,
  env: Record<string, string>,
): Promise<number> {
  const child = await runOwnedChild(command, {
    args: [...args],
    cwd,
    env,
    resumeAfterInterrupt: true,
  });
  return child.status.code;
}

/** Run one desk-owned Project Script with the desk's interrupt contract. */
export async function runDeskProjectScript(
  root: string,
  name: string,
  env: Record<string, string>,
): Promise<number> {
  return await withOperationLock(
    root,
    { command: "scripts", hasOperands: true },
    () =>
      runProjectScriptAt(root, name, [], {
        cwd: root,
        env,
        resumeAfterInterrupt: true,
      }),
  );
}

/**
 * Parse a simple editor command into argv without invoking a shell.
 *
 * Single and double quotes group literal text; backslash escapes one following
 * character. Shell operators, expansions, globs, and unterminated quotes are
 * refused because the Desk must be able to show the exact argv it will run.
 */
function simpleCommandArgv(command: string): string[] | undefined {
  const args: string[] = [];
  let word = "";
  let started = false;
  let quote: "single" | "double" | undefined;
  const shellSyntax = new Set([..."`$(){};&|<>*?[]#!~\n\r"]);
  const push = (): void => {
    if (!started) return;
    args.push(word);
    word = "";
    started = false;
  };
  for (let index = 0; index < command.length; index++) {
    const char = command[index] ?? "";
    if (quote === "single") {
      if (char === "'") quote = undefined;
      else word += char;
      started = true;
      continue;
    }
    if (quote === "double") {
      if (char === '"') {
        quote = undefined;
      } else if (char === "\\") {
        const next = command[index + 1];
        if (next === undefined) return undefined;
        word += next;
        index++;
      } else if (char === "$" || char === "`") {
        return undefined;
      } else {
        word += char;
      }
      started = true;
      continue;
    }
    if (/\s/u.test(char)) {
      push();
      continue;
    }
    if (char === "'") {
      quote = "single";
      started = true;
      continue;
    }
    if (char === '"') {
      quote = "double";
      started = true;
      continue;
    }
    if (char === "\\") {
      const next = command[index + 1];
      if (next === undefined) return undefined;
      word += next;
      started = true;
      index++;
      continue;
    }
    if (shellSyntax.has(char)) return undefined;
    word += char;
    started = true;
  }
  if (quote !== undefined) return undefined;
  push();
  return args.length === 0 ? undefined : args;
}

/** The real terminal/git implementation. Keeping the boundary in one value
 * makes the whole interactive surface scriptable while the CLI still calls the
 * same functions with the same options. */
const DEFAULT_DESK_RUNTIME: DeskRuntime = {
  canInteract: () => canInteract(false),
  inDeskSession: () => inDeskSession(),
  findRoot: () => findRoot(),
  loadConfig: (root) => loadConfig(root),
  status: (root) => statusResult(root),
  mainRepoPath: (root) => mainRepoPath(root),
  grantEffortPlan: (path, branch) => effortGrantPlan(path, branch),
  grantEffort: (path, branch) =>
    grantEffort(path, branch, wallTimeIso(SYSTEM_CLOCK.wallNow())),
  clearEffortGrantPlan: (path) => clearEffortGrantPlan(path),
  clearEffortGrant: (path) => clearEffortGrant(path),
  makeOut: () => {
    const terminal = terminalContext();
    return makeOut(terminal.color, { terminal });
  },
  error: (message) => deskLogger().error(message),
  select: (options) => requestSelection<string>(options),
  confirm: (message, options) => confirmOrNo(message, options),
  input: (options) => requestText(options),
  pause: (out) => awaitEnter(out),
  lifecycle: (root) => lifecycleContext(root, deskLogger()),
  done: (root, cliModel) =>
    finishResult(root, {
      surface: { kind: "human", plain: false },
      cliModel,
    }),
  donePlan: (root, cliModel) =>
    finishResult(root, {
      surface: { kind: "quiet" },
      cliModel,
      dryRun: true,
    }),
  acceptPlan: (ctx, cliModel) => acceptResult(ctx, { dryRun: true, cliModel }),
  accept: (ctx, opts) => {
    if (opts.cliModel === undefined) {
      throw new Error("desk acceptance requires a live CLI model provider");
    }
    return accept(ctx, { ...opts, cliModel: opts.cliModel });
  },
  update: (ctx, opts) =>
    withOperationLock(
      ctx.cwd,
      { command: "update", ...(opts.dryRun ? { dryRun: true } : {}) },
      () => update(ctx, opts),
    ),
  updatePlan: (ctx) => updateResult(ctx, { dryRun: true }),
  drop: (ctx, target, opts) =>
    withOperationLock(
      ctx.cwd,
      {
        command: "worktree drop",
        ...(opts.dryRun ? { dryRun: true } : {}),
      },
      () => worktreeDrop(ctx, target, opts),
    ),
  dropPlan: (ctx, target) => worktreeDropPlan(ctx, target),
  reclaim: async (ctx, target) => {
    await withOperationLock(
      ctx.cwd,
      { command: "worktree prune" },
      () => worktreeReclaimContained(ctx, target),
    );
  },
  reclaimPlan: (ctx, target) => worktreeReclaimContainedPlan(ctx, target),
  git: (args, cwd) => runGit(args, { cwd }),
  proof: (root) => inspectGateProof(root),
  pager: (text) => pageThrough(text),
  editor: async (cwd) => {
    const command = configuredEditorCommand();
    if (command === undefined || command === "") {
      return {
        reason:
          "No editor command is configured. Set $VISUAL or $EDITOR and refresh the Desk.",
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
    ),
  interactive: (command, args, cwd, env) =>
    runDeskInteractiveChild(command, args, cwd, env),
  detectAgents: () => detectAgentBinariesOnPath(),
  start: async (ctx, opts) => {
    const result = await withOperationLock(
      ctx.cwd,
      { command: "start" },
      () =>
        startResult(ctx, {
          worktreeRoot: opts.worktreeRoot,
          ...(opts.name !== undefined ? { name: opts.name } : {}),
        }),
    );
    if (result.data === undefined) {
      throw new Error(result.message ?? "discern start returned no worktree");
    }
    return result.data;
  },
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
          `Project Scripts could not be inspected (${detail}). Repair the configured scripts directory and refresh the Desk.`,
      };
    }
  },
  runScript: (root, name, env) => runDeskProjectScript(root, name, env),
  openBrowser: (url) => openInBrowser(url),
  now: SYSTEM_CLOCK.wallNow,
  readTipState: (root) => readTipSeenState(root, KIT_VERSION),
  writeTipState: (root, state) => writeTipSeenState(root, state),
  recordTipShown: (id) => observeShownTip(id),
  size: () => terminalSize(),
};

interface ReviewGitRead {
  readonly output: string;
  readonly failure?: DeskReviewFailure;
}

/** Read one review fact without turning a Git failure into an empty section. */
async function reviewGitRead(
  runtime: DeskRuntime,
  cwd: string,
  args: string[],
  title: string,
): Promise<ReviewGitRead> {
  const command = displayedCommand("git", args);
  const result = await runtime.git(args, cwd);
  if (result.success) return { output: result.stdout.trimEnd() };
  return {
    output: "",
    failure: {
      title,
      command,
      detail: result.stderr.trimEnd() || "Git returned a non-zero status.",
      nextAction:
        `Run ${command} in ${cwd}, resolve the reported Git failure, then review the task again.`,
      safeToRetry: true,
    },
  };
}

interface NumstatMagnitude {
  readonly added?: number;
  readonly removed?: number;
}

/** Parse Git's tab-delimited numstat without inventing counts for binary files. */
function parseNumstat(output: string): Map<string, NumstatMagnitude> {
  const magnitudes = new Map<string, NumstatMagnitude>();
  for (const line of output.split("\n")) {
    if (line === "") continue;
    const fields = line.split("\t");
    const addedRaw = fields[0];
    const removedRaw = fields[1];
    const path = fields.slice(2).at(-1);
    if (path === undefined || path === "") continue;
    const added = addedRaw === undefined || addedRaw === "-"
      ? undefined
      : Number.parseInt(addedRaw, 10);
    const removed = removedRaw === undefined || removedRaw === "-"
      ? undefined
      : Number.parseInt(removedRaw, 10);
    magnitudes.set(path, {
      ...(added === undefined || !Number.isSafeInteger(added) ? {} : { added }),
      ...(removed === undefined || !Number.isSafeInteger(removed)
        ? {}
        : { removed }),
    });
  }
  return magnitudes;
}

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
  for (const line of nameStatus.split("\n")) {
    if (line === "") continue;
    const fields = line.split("\t");
    const token = fields[0] ?? "M";
    const path = fields.at(-1);
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
  for (const line of porcelain.split("\n")) {
    if (line.length < 4) continue;
    const token = line.slice(0, 2);
    const path = line.slice(3).split(" -> ").at(-1)?.trim();
    if (path === undefined || path === "") continue;
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
        ["diff", "--numstat", `${trunk}...HEAD`],
        "Diffstat could not be read",
      ),
      reviewGitRead(
        runtime,
        cwd,
        ["diff", "--name-status", `${trunk}...HEAD`],
        "Changed paths could not be read",
      ),
      reviewGitRead(
        runtime,
        cwd,
        ["status", "--porcelain=v1"],
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
  out: Out,
  row: DeskRow,
  trunk: string,
  runtime: DeskRuntime,
): Promise<void> {
  let review = await gatherDeskReview(row, trunk, runtime);
  while (true) {
    clearBoard(out);
    const viewport = runtime.size();
    const terminal = terminalContextAtSize(out.terminal, viewport);
    const frame = renderDeskReview(row, review, viewport, terminal);
    out.raw(`${frame.text}\n`);
    let route: string;
    try {
      route = await runtime.select({
        message: `Review ${row.task.name}`,
        options: groupedSelectionEntries(deskReviewGroups(review)),
        reservedRows: deskCompositionReserveRows(frame.rows, viewport.rows),
      });
    } catch (error) {
      if (!isInteractionCancelled(error)) throw error;
      return;
    }
    if (route === DESK_REVIEW_ROUTES.back) return;
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

interface GatheredDeskCapabilities {
  readonly path: string;
  readonly scripts: readonly DeskProjectScript[];
  readonly scriptsUnavailableReason?: string;
  readonly agentLaunches: readonly DeskAgentLaunch[];
  readonly capabilityError?: string;
}

/** Normalize legacy scripted-runtime arrays into the complete discovery shape. */
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
        `Task configuration at ${path}/discern.toml could not be read (${detail}). Repair the file and refresh the Desk.`,
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
): Promise<DeskProjectScript | undefined> {
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
): Promise<boolean> {
  showProjectScriptPlan(out, script, workingDirectory, runtime);
  let route: string;
  try {
    route = await runtime.select({
      message: `Review Project Script ${script.name}`,
      options: groupedSelectionEntries([{
        id: "script-actions",
        label: "Project Script",
        items: [{ name: "Run", value: "run" }, {
          name: "Show command",
          description: "Print the exact executable and CLI spelling.",
          value: "show-command",
        }],
      }, {
        id: "script-navigation",
        label: "Task",
        items: [{ name: "Back", value: BACK }],
      }]),
    });
  } catch (error) {
    if (!isInteractionCancelled(error)) throw error;
    return false;
  }
  const executable = script.path ?? script.name;
  if (route === "show-command") {
    echoCommand(out, displayedCommand(executable, []));
    echoCommand(out, `discern scripts ${quoteCommandWord(script.name)}`);
    await runtime.pause(out);
    return false;
  }
  if (route === BACK) return false;
  return await runtime.confirm(
    `Run Project Script ${script.name} in ${workingDirectory}?`,
    { defaultTo: false, noLabel: "Cancel", yesLabel: "Run" },
  );
}

/** Offer the fleet as a grouped picker; resolves to a row path or a sentinel.
 * `boardRows` is what the board composition above this menu occupies, reserved out
 * of the menu's viewport-derived row budget so the board stays visible. */
async function pickRow(
  rows: readonly DeskRow[],
  rootScripts: readonly DeskProjectScript[],
  boardRows: number,
  viewport: TerminalSize,
  terminal: Out["terminal"],
  runtime: DeskRuntime,
): Promise<string> {
  const options = groupedSelectionEntries(deskRootSelectionGroups({
    rows,
    hasProjectScripts: rootScripts.some((script) =>
      script.availability !== "disabled"
    ),
    viewport,
    terminal,
  }));
  const search = deskRootUsesSearch(rows.length);
  try {
    return await runtime.select({
      message: deskRootPrompt(rows.length),
      options,
      search,
      ...(search ? { searchLabel: "filter" } : {}),
      hint: search
        ? "Type to filter. Use the arrow keys to move and Enter to choose."
        : "Use the arrow keys to move and Enter to choose.",
      reservedRows: deskCompositionReserveRows(boardRows, viewport.rows),
    });
  } catch (error) {
    if (!isInteractionCancelled(error)) throw error;
    // Ctrl-C or end-of-input closes the Desk.
    return QUIT;
  }
}

/** Run one Project Script from the main checkout, using the same picker,
 * process ownership, exit reporting, and pause as a worktree-local script. */
async function runRootProjectScript(
  out: Out,
  root: string,
  project: string,
  scripts: readonly DeskProjectScript[],
  runtime: DeskRuntime,
): Promise<void> {
  const script = await pickScript(scripts, project, "Desk", runtime);
  if (script === undefined) {
    return;
  }
  if (!(await authorizeProjectScript(out, script, root, runtime))) {
    return;
  }
  echoCommand(out, `discern scripts ${script.name}  (in project root)`);
  const code = await runtime.runScript(
    root,
    script.name,
    deskSessionEnv(),
  );
  if (code !== 0) {
    out.warn(`Project Script exited with status ${code}.`);
  }
  await runtime.pause(out);
}

/** Hand the online manual to the user's browser and keep a copyable fallback
 * visible when the operating-system launcher is unavailable. */
async function openOnlineDocs(
  out: Out,
  runtime: DeskRuntime,
): Promise<void> {
  const result = await runtime.openBrowser(DISCERN_DOCS_URL);
  if (result.status === "opened") {
    out.info(`Opened ${DISCERN_DOCS_URL}.`);
  } else {
    out.warn(browserOpenFailureMessage("the docs", DISCERN_DOCS_URL, result));
  }
  await runtime.pause(out);
}

/** Request an optional task name and create it through the same core as
 * `discern start`. Returns the new path so the next board pass can open its
 * action menu immediately. */
async function startTask(
  out: Out,
  root: string,
  config: DiscernConfig,
  runtime: DeskRuntime,
): Promise<string | undefined> {
  let answer: string;
  try {
    answer = await runtime.input({
      message: "Task name (blank uses a codename)",
      transform: (value) => value.trim(),
    });
  } catch (error) {
    if (!isInteractionCancelled(error)) throw error;
    return undefined;
  }
  const name = answer.trim();
  echoCommand(
    out,
    name === ""
      ? "discern start"
      : `discern start --name=${quoteCommandWord(name)}`,
  );
  const ctx = await runtime.lifecycle(root);
  const started = await runtime.start(ctx, {
    worktreeRoot: resolveWorktreeRoot(root, config),
    ...(name !== "" ? { name } : {}),
  });
  return started.path;
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
  cliModel?: CliModelProvider,
): Promise<boolean> {
  const trunk = config.repository.trunk;
  const target = basename(row.entry.path);
  switch (action) {
    case "done": {
      if (cliModel === undefined) {
        throw new Error("Desk final checks require a live CLI model provider.");
      }
      const preview = await runtime.donePlan(row.entry.path, cliModel);
      showActionPlan(out, row, action, resultPlan(preview), runtime);
      if (
        !(await confirmAction(
          row,
          action,
          `Run final checks for ${row.entry.branch}?`,
          runtime,
        ))
      ) {
        return false;
      }
      echoCommand(out, `discern done  (in ${target})`);
      const result = await runtime.done(row.entry.path, cliModel);
      if (result.ok) {
        out.ok(
          result.message ?? "Final checks passed and Proof was refreshed.",
        );
      } else {
        const viewport = runtime.size();
        const terminal = terminalContextAtSize(out.terminal, viewport);
        const failure = renderDeskActionFailure(
          row,
          selectedOffer(row, action),
          result.message ?? "Final checks failed.",
          viewport,
          terminal,
        );
        out.raw(`${failure.text}\n`);
      }
      await runtime.pause(out);
      return true;
    }
    case "accept": {
      echoCommand(out, `discern accept  (in ${target})`);
      const ctx = await runtime.lifecycle(row.entry.path);
      if (cliModel === undefined) {
        throw new Error("Desk acceptance requires a live CLI model provider.");
      }
      const preview = await runtime.acceptPlan(ctx, cliModel);
      showActionPlan(out, row, action, resultPlan(preview), runtime);
      if (
        !(await confirmAction(
          row,
          action,
          `Land ${row.entry.branch} on ${trunk}?`,
          runtime,
        ))
      ) {
        return false;
      }
      // The human just accepted the landing in this interaction, so pass
      // the consent attestation in — the desk's confirm IS the acceptance, and
      // accept must not double-refuse for a consent it already collected (ADR 0134).
      await runtime.accept(ctx, {
        confirmed: true,
        ...(cliModel === undefined ? {} : { cliModel }),
      });
      await runtime.pause(out);
      return true;
    }
    case "grant": {
      showActionPlan(
        out,
        row,
        action,
        await runtime.grantEffortPlan(row.entry.path, row.entry.branch),
        runtime,
      );
      if (
        !(await confirmAction(
          row,
          action,
          `Allow ${row.entry.branch} to land once green without a further conversation?`,
          runtime,
        ))
      ) {
        return false;
      }
      const result = await runtime.grantEffort(
        row.entry.path,
        row.entry.branch,
      );
      if (result.status === "already_granted") {
        out.info(
          `${row.entry.branch} was already pre-authorized to land once green.`,
        );
      } else {
        out.ok(
          `${row.entry.branch} may land once green without a further conversation.`,
        );
      }
      await runtime.pause(out);
      return true;
    }
    case "revoke_grant": {
      showActionPlan(
        out,
        row,
        action,
        await runtime.clearEffortGrantPlan(row.entry.path),
        runtime,
      );
      if (
        !(await confirmAction(
          row,
          action,
          `Revoke landing pre-authorization for ${row.entry.branch}?`,
          runtime,
        ))
      ) {
        return false;
      }
      if (await runtime.clearEffortGrant(row.entry.path)) {
        out.ok(`Landing pre-authorization revoked for ${row.entry.branch}.`);
      } else {
        out.info(`${row.entry.branch} had no landing pre-authorization.`);
      }
      await runtime.pause(out);
      return true;
    }
    case "update": {
      echoCommand(out, `discern update  (in ${target})`);
      const ctx = await runtime.lifecycle(row.entry.path);
      const preview = await runtime.updatePlan(ctx);
      showActionPlan(out, row, action, resultPlan(preview), runtime);
      if (
        !(await confirmAction(
          row,
          action,
          `Merge ${trunk} into ${row.entry.branch}?`,
          runtime,
        ))
      ) {
        return false;
      }
      await runtime.update(ctx, {});
      await runtime.pause(out);
      return true;
    }
    case "reclaim": {
      // The reclaim confirmation is the whole consent: it names the specific
      // worktree, what is kept (the branch ref — the work travels inside its
      // containing branch), and what is destroyed (the checkout and its
      // per-worktree state, gate proof included, so a sibling's
      // `await --green` on this branch refuses afterwards).
      echoCommand(
        out,
        `discern worktree prune --contained  (reclaims ${target})`,
      );
      const ctx = await runtime.lifecycle(root);
      showActionPlan(
        out,
        row,
        action,
        await runtime.reclaimPlan(ctx, row.entry.path),
        runtime,
      );
      const containedIn = row.entry.contained_in ?? "a live branch";
      if (
        !(await confirmAction(
          row,
          action,
          `Reclaim ${target}? Branch ${row.entry.branch} is KEPT (its commits ` +
            `are contained in ${containedIn}); the checkout and its ` +
            `per-worktree state — gate proof included — are destroyed.`,
          runtime,
        ))
      ) {
        return false;
      }
      // The ABSOLUTE selected path, never the basename: two roots can hold
      // same-named worktree directories, and the reclaim must hit exactly the
      // row the confirmation named.
      await runtime.reclaim(ctx, row.entry.path);
      out.ok(
        `Reclaimed ${target}. Branch ${row.entry.branch} kept — it lands with ${containedIn} and self-cleans on the next prune.`,
      );
      await runtime.pause(out);
      return true;
    }
    case "drop": {
      const dropTarget = row.entry.path;
      echoCommand(
        out,
        commandEvidence(["discern", "worktree", "drop", dropTarget]),
      );
      const ctx = await runtime.lifecycle(root);
      showActionPlan(
        out,
        row,
        action,
        await runtime.dropPlan(ctx, dropTarget),
        runtime,
      );
      if (
        !(await confirmAction(
          row,
          action,
          `Drop ${target}?`,
          runtime,
        ))
      ) {
        return false;
      }
      try {
        await runtime.drop(ctx, dropTarget, {});
        await runtime.pause(out);
        return true;
      } catch (e) {
        if (!(e instanceof WorktreeGitError)) {
          throw e;
        }
        // The core refused: it holds work a drop would discard. Destructive
        // weight (ADR 0119): discarding needs the branch name typed back.
        out.warn(e.message);
        let typed: string;
        try {
          typed = await runtime.input({
            message:
              `Type the branch name (${row.entry.branch}) to discard it permanently — anything else cancels`,
            transform: (value) => value.trim(),
          });
        } catch (error) {
          if (!isInteractionCancelled(error)) throw error;
          typed = "";
        }
        // A mismatch is the documented cancellation choice, not invalid input
        // that should trap the operator in a validation retry.
        if (typed.trim() !== row.entry.branch) {
          out.info("Left untouched.");
          return false;
        }
        echoCommand(
          out,
          commandEvidence([
            "discern",
            "worktree",
            "drop",
            dropTarget,
            "--force",
          ]),
        );
        await runtime.drop(ctx, dropTarget, { force: true });
        await runtime.pause(out);
        return true;
      }
    }
    case "scripts": {
      const script = await pickScript(
        row.scripts,
        row.task.name,
        "Task",
        runtime,
      );
      if (script === undefined) {
        return false;
      }
      if (
        !(await authorizeProjectScript(
          out,
          script,
          script.workingDirectory ?? row.entry.path,
          runtime,
        ))
      ) {
        return false;
      }
      echoCommand(
        out,
        `discern scripts ${script.name}  (in ${target})`,
      );
      const code = await runtime.runScript(
        row.entry.path,
        script.name,
        deskSessionEnv(),
      );
      if (code !== 0) {
        out.warn(`Project Script exited with status ${code}.`);
      }
      await runtime.pause(out);
      // A Project Script can change project or Git state, so always re-survey.
      return true;
    }
    case "agent": {
      const available = row.agentLaunches.filter((candidate) =>
        candidate.availability !== "disabled"
      );
      const launch = available.length === 1
        ? available[0]
        : await pickAgentLaunch(row, runtime);
      if (launch === undefined) {
        return false;
      }
      const agentOffer = selectedOffer(row, action);
      showActionPlan(out, row, action, undefined, runtime, {
        ...agentOffer,
        label: launch.label,
        command: {
          argv: [launch.binary, ...launch.args],
          workingDirectory: "task",
        },
      });
      echoCommand(
        out,
        `${
          displayedCommand(launch.binary, launch.args)
        }  (cwd: ${row.entry.path})`,
      );
      out.info(`Exit ${launch.providerLabel} to return to the desk.`);
      let code: number;
      try {
        code = await runtime.interactive(
          launch.binary,
          launch.args,
          row.entry.path,
          deskSessionEnv(),
        );
      } catch (error) {
        out.warn(
          `Could not launch ${launch.label}: ${
            error instanceof Error ? error.message : String(error)
          }`,
        );
        await runtime.pause(out);
        return true;
      }
      if (code !== 0) {
        out.warn(`${launch.label} exited with status ${code}.`);
        await runtime.pause(out);
      }
      return true;
    }
    case "jump": {
      const shell = userShell();
      const shellOffer = selectedOffer(row, action);
      showActionPlan(out, row, action, undefined, runtime, {
        ...shellOffer,
        command: { argv: [shell], workingDirectory: "task" },
      });
      echoCommand(out, `${shell}  (cwd: ${row.entry.path})`);
      out.info("Exit the shell to return to the desk.");
      const code = await runtime.interactive(
        shell,
        [],
        row.entry.path,
        deskSessionEnv(),
      );
      if (code !== 0) {
        out.warn(`Shell exited with status ${code}.`);
        await runtime.pause(out);
      }
      return true;
    }
    case "inspect": {
      await reviewTask(out, row, trunk, runtime);
      return false;
    }
  }
}

/** The per-row action menu; loops until the row is left or the state changed. */
async function actOn(
  out: Out,
  root: string,
  config: DiscernConfig,
  row: DeskRow,
  runtime: DeskRuntime,
  cliModel?: CliModelProvider,
): Promise<boolean> {
  clearBoard(out);
  const viewport = runtime.size();
  const terminal = terminalContextAtSize(out.terminal, viewport);
  const detail = renderDeskTaskDetail(row, viewport, terminal);
  out.raw(`${detail.text}\n`);
  while (true) {
    const options = groupedSelectionEntries<string>([
      ...deskActionGroups(row),
      {
        id: "task-navigation",
        label: "Task",
        items: [{ name: "Back", value: BACK }],
      },
    ]);
    let action: string;
    try {
      action = await runtime.select({
        message: "Choose an action",
        options,
        hint: "Use the arrow keys to move and Enter to choose.",
        reservedRows: deskCompositionReserveRows(detail.rows, viewport.rows),
      });
    } catch (error) {
      if (!isInteractionCancelled(error)) throw error;
      return false;
    }
    if (action === BACK) {
      return false;
    }
    try {
      if (
        await dispatchAction(
          out,
          root,
          config,
          row,
          action as DeskAction,
          runtime,
          cliModel,
        )
      ) {
        return true;
      }
    } catch (e) {
      if (e instanceof WorktreeGitError || e instanceof IdentityError) {
        const viewport = runtime.size();
        const terminal = terminalContextAtSize(out.terminal, viewport);
        const failure = renderDeskActionFailure(
          row,
          selectedOffer(row, action as DeskAction),
          e.message,
          viewport,
          terminal,
        );
        out.raw(`${failure.text}\n`);
        await runtime.pause(out);
        // A refusal can reflect stale survey state. Re-survey and return to this
        // task when it still exists.
        return true;
      }
      throw e;
    }
  }
}

/**
 * Run the desk. Returns a process exit code: 0 for any session the operator
 * ended (including "nothing to do"), 1 for a refusal (no TTY, `--json`, no
 * project) or a failed survey.
 */
export async function runDesk(
  opts: DeskOptions = {},
  runtime: DeskRuntime = DEFAULT_DESK_RUNTIME,
): Promise<number> {
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

  const first = await runtime.status(root);
  if (!first.ok || first.data === undefined) {
    out.error(first.message ?? "the status survey failed.");
    return 1;
  }
  if (first.data.location === "worktree") {
    // The desk supervises the fleet, and the fleet's actions (drop, accept)
    // operate from the main checkout — point home rather than half-work here.
    const mainRepo = await runtime.mainRepoPath(root);
    out.info(
      `The desk runs from the main checkout${
        mainRepo !== undefined ? `: cd ${mainRepo}` : ""
      } — this is a worktree. For this worktree's own state: discern status.`,
    );
    return 0;
  }
  const initialData = first.data;

  // The session's tip (ADR 0234): chosen once from the first survey, held
  // stable across every redraw, and marked shown exactly once — the
  // seen-state write and the logbook id together, at selection, never per
  // redraw. Tip state must never cost a session, so any failure in the seams
  // degrades to a tipless header.
  let tipLine: string | undefined;
  await bestEffort("desk-tip-presentation", async () => {
    const tipState = await runtime.readTipState(root);
    const selected = selectTip(TIPS, { data: initialData, config }, tipState);
    if (selected !== undefined) {
      tipLine = renderTipLine(selected);
      await runtime.writeTipState(
        root,
        markTipShown(
          tipState,
          selected.tip.id,
          new Date(runtime.now()).toISOString(),
        ),
      );
      runtime.recordTipShown(selected.tip.id);
    }
  });

  let data: StatusData = initialData;
  let focusPath: string | undefined;
  while (true) {
    clearBoard(out);
    const fleet = data.fleet ?? [];
    const [detectedAgents, rootScriptDiscovery] = await Promise.all([
      runtime.detectAgents(),
      runtime.scripts(root, config),
    ]);
    const rootScriptInventory = scriptInventory(root, rootScriptDiscovery);
    const rootScripts = rootScriptInventory.scripts;
    // Per-row facts the survey cannot carry (each worktree's own scripts and
    // agent launches), gathered concurrently from ONE config read per row.
    // Proof and effort-grant state ride the fleet entries themselves.
    const gathered = await Promise.all(
      fleet
        .filter((entry) =>
          !entry.is_main && entry.broken !== true &&
          entry.git_unavailable !== true
        )
        .map(async (entry): Promise<GatheredDeskCapabilities> => {
          const loaded = await loadWorktreeConfig(entry.path, runtime);
          if (loaded.config === undefined) {
            return {
              path: entry.path,
              scripts: [] as readonly DeskProjectScript[],
              scriptsUnavailableReason: loaded.error ??
                "Task configuration is unavailable.",
              agentLaunches: [] as readonly DeskAgentLaunch[],
              ...(loaded.error === undefined
                ? {}
                : { capabilityError: loaded.error }),
            };
          }
          const inventory = scriptInventory(
            entry.path,
            await runtime.scripts(entry.path, loaded.config),
          );
          return {
            path: entry.path,
            scripts: inventory.scripts,
            ...(inventory.unavailableReason === undefined
              ? {}
              : { scriptsUnavailableReason: inventory.unavailableReason }),
            agentLaunches: buildAgentLaunches(loaded.config, detectedAgents),
          };
        }),
    );
    const scriptsByPath = new Map<string, readonly DeskProjectScript[]>(
      gathered.map((facts) => [facts.path, facts.scripts]),
    );
    const agentLaunchesByPath = new Map<string, readonly DeskAgentLaunch[]>(
      gathered.map((facts) => [facts.path, facts.agentLaunches]),
    );
    const scriptsUnavailableReasons = new Map<string, string>(
      gathered.flatMap((facts) =>
        facts.scriptsUnavailableReason === undefined
          ? []
          : [[facts.path, facts.scriptsUnavailableReason] as const]
      ),
    );
    const capabilityErrors = new Map<string, string>(
      gathered.flatMap((facts) =>
        facts.capabilityError === undefined
          ? []
          : [[facts.path, facts.capabilityError] as const]
      ),
    );
    const rows = buildDeskRows(
      fleet,
      scriptsByPath,
      agentLaunchesByPath,
      {
        trunk: config.repository.trunk,
        nowMs: runtime.now(),
        ...(data.fleet_collisions === undefined
          ? {}
          : { fleetCollisions: data.fleet_collisions }),
        ...(data.adr_collisions === undefined
          ? {}
          : { adrCollisions: data.adr_collisions }),
        scriptsUnavailableReasons,
        capabilityErrors,
      },
    );
    const viewport = runtime.size();
    const terminal = terminalContextAtSize(out.terminal, viewport);
    const board = renderDeskBoard({
      board: buildDeskBoardDecision(data, rows),
      ...(tipLine === undefined ? {} : { tip: tipLine }),
      viewport,
      terminal,
    });
    out.raw(`${board.text}\n`);

    const focused = focusPath === undefined
      ? undefined
      : rows.find((row) => row.entry.path === focusPath);
    focusPath = undefined;
    const choice = focused?.entry.path ??
      await pickRow(
        rows,
        rootScripts,
        board.rows,
        viewport,
        terminal,
        runtime,
      );
    if (choice === QUIT) {
      return 0;
    }
    if (choice === START_TASK) {
      try {
        focusPath = await startTask(out, root, config, runtime);
      } catch (e) {
        if (e instanceof WorktreeGitError || e instanceof IdentityError) {
          out.error(e.message);
          await runtime.pause(out);
        } else {
          throw e;
        }
      }
    } else if (choice === RUN_PROJECT_SCRIPT) {
      await runRootProjectScript(
        out,
        root,
        data.project ?? basename(root),
        rootScripts,
        runtime,
      );
    } else if (choice === READ_DOCS) {
      await openOnlineDocs(out, runtime);
    } else if (choice !== REFRESH) {
      const row = rows.find((r) => r.entry.path === choice);
      if (row !== undefined) {
        if (await actOn(out, root, config, row, runtime, opts.cliModel)) {
          focusPath = row.entry.path;
        }
      }
    }
    const next = await runtime.status(root);
    if (!next.ok || next.data === undefined) {
      out.error(next.message ?? "the status survey failed.");
      return 1;
    }
    data = next.data;
  }
}
