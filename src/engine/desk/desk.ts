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
import { DISCERN_DOCS_URL, DISCERN_WORDMARK } from "../../shared/brand.ts";
import { findRoot, NO_PROJECT_MESSAGE } from "../../shared/env.ts";
import { emitResult } from "../../shared/emit.ts";
import { type DiscernConfig, loadConfig } from "../../shared/config_schema.ts";
import { renderHumanOutputGroups } from "../../shared/result.ts";
import type { StartData, StatusData } from "../../shared/result_schemas.ts";
import {
  detectAgentBinariesOnPath,
  type DetectedAgentBinary,
} from "../../lib/detect_agents.ts";
import { resolveWorktreeRoot } from "../../lib/paths.ts";
import {
  canPrompt,
  confirmationPrompt,
  groupedSelectOptions,
  inputPrompt,
  isPromptCancellation,
  selectPrompt,
  type SelectPromptGroup,
  type SelectPromptOptions,
} from "../../lib/prompts.ts";
import { Logger } from "../../lib/log.ts";
import {
  browserOpenFailureMessage,
  type BrowserOpenResult,
  openInBrowser,
} from "../../lib/open_browser.ts";
import { statusResult } from "../status/status.ts";
import {
  accept,
  IdentityError,
  type LifecycleContext,
  lifecycleContext,
  startResult,
  update,
  worktreeDrop,
  WorktreeGitError,
  worktreeReclaimContained,
} from "../worktree/lifecycle.ts";
import { mainRepoPath } from "../worktree/git.ts";
import { runGit } from "../../shared/subprocess.ts";
import { colorEnabled, makeOut, type Out } from "../output.ts";
import { runOwnedChild } from "../owned_child.ts";
import {
  listProjectScriptsWithConfig,
  type ProjectScript,
  runProjectScriptAt,
} from "../project_scripts.ts";
import {
  bucketTitle,
  buildAgentLaunches,
  buildDeskRows,
  DESK_BUCKETS,
  type DeskAction,
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
import { displayWidth, terminalWidth, wrapText } from "../../lib/text.ts";
import { terminalLine } from "../../lib/terminal.ts";
import { deskSessionEnv, inDeskSession } from "./session.ts";
import { clearEffortGrant } from "../worktree/effort_grant_cleanup.ts";
import {
  type EffortGrantWrite,
  grantEffort,
} from "../worktree/effort_grant_writer.ts";

/** Sentinel Select values that are not fleet rows (NUL-prefixed: never a path). */
const REFRESH = "\x00refresh";
const QUIT = "\x00quit";
const BACK = "\x00back";
const START_TASK = "\x00start-task";
const RUN_PROJECT_SCRIPT = "\x00run-project-script";
const READ_DOCS = "\x00read-docs";
/** A short fleet is faster to scan directly; larger fleets gain type-to-filter. */
const FILTER_THRESHOLD = 8;

/** Flags accepted by `desk`. */
export interface DeskOptions {
  /** Present for surface parity only — the desk has no JSON form; it refuses. */
  json?: boolean;
}

type DeskSelectOptions = SelectPromptOptions<string>;
type DeskMaybePromise<T> = T | Promise<T>;

/** The terminal and effect boundary behind the desk's interactive session.
 * Production keeps its runtime private; tests replace it with a scripted
 * runtime so every supervisory path is exercised without pretending a pipe is
 * a terminal or touching a real worktree. */
export interface DeskRuntime {
  canPrompt(): boolean;
  inDeskSession(): boolean;
  findRoot(): DeskMaybePromise<string | undefined>;
  loadConfig(root: string): DeskMaybePromise<DiscernConfig>;
  status(root: string): DeskMaybePromise<{
    ok: boolean;
    data?: StatusData | undefined;
    message?: string | undefined;
  }>;
  mainRepoPath(root: string): DeskMaybePromise<string | undefined>;
  grantEffort(
    path: string,
    branch: string,
  ): DeskMaybePromise<EffortGrantWrite>;
  clearEffortGrant(path: string): DeskMaybePromise<boolean>;
  makeOut(): Out;
  error(message: string): void;
  select(options: DeskSelectOptions): DeskMaybePromise<string>;
  confirm(message: string, defaultTo: boolean): DeskMaybePromise<boolean>;
  input(message: string): DeskMaybePromise<string>;
  pause(out: Out): DeskMaybePromise<void>;
  lifecycle(root: string): DeskMaybePromise<LifecycleContext>;
  accept(
    ctx: LifecycleContext,
    opts: { dryRun?: boolean; confirmed?: boolean },
  ): DeskMaybePromise<void>;
  update(
    ctx: LifecycleContext,
    opts: { dryRun?: boolean },
  ): DeskMaybePromise<void>;
  drop(
    ctx: LifecycleContext,
    target: string,
    opts: { dryRun?: boolean; force?: boolean },
  ): DeskMaybePromise<void>;
  reclaim(ctx: LifecycleContext, target: string): DeskMaybePromise<void>;
  git(
    args: string[],
    cwd: string,
  ): DeskMaybePromise<{ success: boolean; stdout: string; stderr: string }>;
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
  ): DeskMaybePromise<readonly ProjectScript[]>;
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
  /** The terminal width the header wraps its tip line to. */
  width(): number;
}

/** Dim "→ <command>" line: the CLI equivalent of the action about to run. */
function echoCommand(out: Out, command: string): void {
  out.raw(
    `${out.terminal.role(terminalLine(`→ ${command}`), "muted")}\n`,
  );
}

/** Quote one argv word for display only. Execution never passes through a
 * shell; this makes the echoed CLI equivalent safe to copy and paste. */
function shellWord(word: string): string {
  return /^[A-Za-z0-9_./:@%+=,-]+$/.test(word)
    ? word
    : `'${word.replaceAll("'", `'\\''`)}'`;
}

/** Format recorded command words for the desk's compact activity view. */
function displayedCommand(command: string, args: readonly string[]): string {
  return [command, ...args].map(shellWord).join(" ");
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

/** A Confirm that treats a cancelled prompt (Ctrl-C / Esc) as "no". */
async function confirmOrNo(
  message: string,
  defaultTo: boolean,
): Promise<boolean> {
  try {
    return await confirmationPrompt(message, defaultTo);
  } catch (error) {
    if (!isPromptCancellation(error)) throw error;
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
  return await runProjectScriptAt(root, name, [], {
    cwd: root,
    env,
    resumeAfterInterrupt: true,
  });
}

/** The real terminal/git implementation. Keeping the boundary in one value
 * makes the whole interactive surface scriptable while the CLI still calls the
 * same functions with the same options. */
const DEFAULT_DESK_RUNTIME: DeskRuntime = {
  canPrompt: () => canPrompt(false),
  inDeskSession: () => inDeskSession(),
  findRoot: () => findRoot(),
  loadConfig: (root) => loadConfig(root),
  status: (root) => statusResult(root),
  mainRepoPath: (root) => mainRepoPath(root),
  grantEffort: (path, branch) => grantEffort(path, branch),
  clearEffortGrant: (path) => clearEffortGrant(path),
  makeOut: () => makeOut(colorEnabled()),
  error: (message) => console.error(message),
  select: (options) => selectPrompt<string>(options),
  confirm: (message, defaultTo) => confirmOrNo(message, defaultTo),
  input: (message) => inputPrompt({ message }),
  pause: (out) => awaitEnter(out),
  lifecycle: (root) => lifecycleContext(root, deskLogger()),
  accept: (ctx, opts) => accept(ctx, opts),
  update: (ctx, opts) => update(ctx, opts),
  drop: (ctx, target, opts) => worktreeDrop(ctx, target, opts),
  reclaim: async (ctx, target) => {
    await worktreeReclaimContained(ctx, target);
  },
  git: (args, cwd) => runGit(args, { cwd }),
  interactive: (command, args, cwd, env) =>
    runDeskInteractiveChild(command, args, cwd, env),
  detectAgents: () => detectAgentBinariesOnPath(),
  start: async (ctx, opts) => {
    const result = await startResult(ctx, {
      worktreeRoot: opts.worktreeRoot,
      ...(opts.name !== undefined ? { name: opts.name } : {}),
    });
    if (result.data === undefined) {
      throw new Error(result.message ?? "discern start returned no worktree");
    }
    return result.data;
  },
  scripts: async (root, config) => {
    try {
      return await listProjectScriptsWithConfig(root, config);
    } catch {
      // A branch-local scripts directory can be unreadable even while the main
      // checkout's fleet survey remains healthy. In that state no script is
      // safely available, so the conditional action stays hidden.
      return [];
    }
  },
  runScript: (root, name, env) => runDeskProjectScript(root, name, env),
  openBrowser: (url) => openInBrowser(url),
  now: () => Date.now(),
  readTipState: (root) => readTipSeenState(root, KIT_VERSION),
  writeTipState: (root, state) => writeTipSeenState(root, state),
  recordTipShown: (id) => observeShownTip(id),
  width: () => terminalWidth(),
};

/** Run a git read in `cwd` and print its output under a heading ("(none)" when
 * empty) — the desk's inspect view; failures print git's stderr, never throw. */
async function printGitRead(
  out: Out,
  cwd: string,
  args: string[],
  title: string,
  runtime: DeskRuntime,
): Promise<void> {
  const res = await runtime.git(args, cwd);
  const body = (res.success ? res.stdout : res.stderr).trimEnd();
  out.heading(terminalLine(title));
  out.raw(
    body === "" ? `${out.terminal.role("(none)", "muted")}\n` : `${body}\n`,
  );
}

/** A branch-local config can be malformed while the fleet row remains Git-
 * healthy. That makes provider launch availability unknowable, so hide the
 * action instead of falling back to the main checkout's agent set. */
async function loadWorktreeConfig(
  path: string,
  runtime: DeskRuntime,
): Promise<DiscernConfig | undefined> {
  try {
    return await runtime.loadConfig(path);
  } catch {
    return undefined;
  }
}

/** The human label for a row action in the menu. */
function actionLabel(
  action: DeskAction,
  trunk: string,
  containedIn?: string,
): string {
  switch (action) {
    case "accept":
      return `Accept and land on ${trunk}`;
    case "grant":
      return "Pre-authorize landing once green";
    case "revoke_grant":
      return "Revoke landing pre-authorization";
    case "update":
      return `Update branch from ${trunk}`;
    case "reclaim":
      return `Reclaim checkout, keep branch (work contained in ${
        containedIn ?? "a live branch"
      })`;
    case "scripts":
      return "Run a Project Script";
    case "agent":
      return "Open with an agent";
    case "jump":
      return "Open a shell";
    case "inspect":
      return "Inspect commits and changes";
    case "drop":
      return "Drop worktree and branch";
  }
}

type DeskActionGroupId = "landing" | "work" | "review" | "worktree";

/** Assign every row action to one stable visual group. The exhaustive switch
 * enrolls a future DeskAction in the hierarchy at compile time. */
function actionGroupId(action: DeskAction): DeskActionGroupId {
  switch (action) {
    case "accept":
    case "grant":
    case "revoke_grant":
    case "update":
      return "landing";
    case "scripts":
    case "agent":
    case "jump":
      return "work";
    case "inspect":
      return "review";
    case "reclaim":
    case "drop":
      return "worktree";
  }
}

/** Menu-order labels for the row action hierarchy. */
const DESK_ACTION_GROUPS: readonly {
  readonly id: DeskActionGroupId;
  readonly label: string;
}[] = [
  { id: "landing", label: "Landing" },
  { id: "work", label: "Work in this task" },
  { id: "review", label: "Review" },
  { id: "worktree", label: "Worktree" },
];

/** Build the populated action groups for one selected task. */
function actionGroups(
  row: DeskRow,
  config: DiscernConfig,
): SelectPromptGroup<string>[] {
  return DESK_ACTION_GROUPS.map((group) => ({
    id: `actions-${group.id}`,
    label: group.label,
    items: row.actions
      .filter((action) => actionGroupId(action) === group.id)
      .map((action) => ({
        name: actionLabel(
          action,
          config.repository.trunk,
          row.entry.contained_in,
        ),
        value: action as string,
      })),
  }));
}

/** Pick one of the configured, PATH-available agent entry points. */
async function pickAgentLaunch(
  row: DeskRow,
  runtime: DeskRuntime,
): Promise<DeskAgentLaunch | undefined> {
  const agentGroups: SelectPromptGroup<string>[] = [];
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
          value: candidate.id,
        })),
    });
  }
  const options = groupedSelectOptions<string>([
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
    if (!isPromptCancellation(error)) throw error;
    return undefined;
  }
  return id === BACK
    ? undefined
    : row.agentLaunches.find((launch) => launch.id === id);
}

/** Pick one Project Script from either the project root or a worktree. */
async function pickScript(
  scripts: readonly ProjectScript[],
  owner: string,
  navigationLabel: "Desk" | "Task",
  runtime: DeskRuntime,
): Promise<ProjectScript | undefined> {
  const options = groupedSelectOptions<string>([
    {
      id: "project-scripts",
      label: "Project Scripts",
      items: scripts.map((script) => ({
        name: script.description === undefined
          ? script.name
          : `${script.name}  ·  ${script.description}`,
        value: script.name,
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
    const search = scripts.length > FILTER_THRESHOLD;
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
    if (!isPromptCancellation(error)) throw error;
    return undefined;
  }
  return name === BACK
    ? undefined
    : scripts.find((script) => script.name === name);
}

/** The first-line label of the tip slot; continuation lines hang under it. */
const TIP_PREFIX = "  ✦ Tip  ";

/** The desk header: project identity, the main checkout's state, the
 * otherwise-invisible unlanded branches, and the session's one tip line. */
function renderHeader(
  out: Out,
  config: DiscernConfig,
  root: string,
  data: StatusData,
  rows: readonly DeskRow[],
  tip: string | undefined,
  width: number,
): void {
  const project = config.project.slug === ""
    ? basename(root)
    : config.project.slug;
  out.heading(terminalLine(`${DISCERN_WORDMARK} | ${project}`));
  const taskCount = rows.length === 0
    ? "No tasks"
    : `${rows.length} task${rows.length === 1 ? "" : "s"}`;
  const main = (data.fleet ?? []).find((e) => e.is_main);
  const summaryLines: string[] = [];
  if (main !== undefined) {
    const mainState = main.clean === true
      ? `${main.branch} clean`
      : main.clean === false
      ? `${main.branch} has ${main.changed_files ?? "?"} uncommitted change${
        main.changed_files === 1 ? "" : "s"
      }`
      : `${main.branch} state unknown`;
    const renderedMainState = main.clean === true
      ? out.terminal.tone(terminalLine(mainState), "success")
      : out.terminal.tone(terminalLine(mainState), "warning");
    summaryLines.push(
      `  ${
        out.terminal.role(`${taskCount}  ·`, "muted")
      }  ${renderedMainState}`,
    );
  } else {
    summaryLines.push(`  ${out.terminal.role(taskCount, "muted")}`);
  }
  const unlandedLines: string[] = [];
  const unlanded = data.unlanded_branches ?? [];
  if (unlanded.length > 0) {
    const branches = `${unlanded.length} branch${
      unlanded.length === 1 ? " has" : "es have"
    } no worktree`;
    unlandedLines.push(
      `  ${out.terminal.tone(branches, "warning")}: ${
        out.terminal.role(terminalLine(unlanded.join(", ")), "muted")
      }`,
    );
    unlandedLines.push(
      `  ${
        out.terminal.role(
          "Open one with `discern start --from <branch>`.",
          "muted",
        )
      }`,
    );
  }
  // Reclaimed-stage refs are a calm fact, not a warning: their commits ride
  // inside the named live branch, and the refs self-clean through the
  // ordinary prune once that work lands. One dim line, no action offered.
  const containedRefs = data.contained_refs ?? [];
  const containedLines: string[] = [];
  if (containedRefs.length > 0) {
    const first = containedRefs[0];
    const line = containedRefs.length === 1 && first !== undefined
      ? `${first.branch} rides inside ${first.contained_in} until it lands`
      : `${containedRefs.length} reclaimed stage refs ride inside live branches until they land`;
    containedLines.push(
      `  ${out.terminal.role(terminalLine(`${line}.`), "muted")}`,
    );
  }
  const reappearedLines: string[] = [];
  const reappeared = data.reappeared_worktree_paths ?? [];
  if (reappeared.length > 0) {
    reappearedLines.push(
      `  ${
        out.terminal.tone(
          `${reappeared.length} removed worktree path${
            reappeared.length === 1 ? " is" : "s are"
          } present again.`,
          "warning",
        )
      }`,
    );
    reappearedLines.push(
      `  ${
        out.terminal.role(
          "Review with `discern worktree prune --dry-run`.",
          "muted",
        )
      }`,
    );
  }
  // The session's tip (ADR 0234): one teaching line directly below the status,
  // wrapped with a hanging indent at the resolved width — never truncated,
  // because the narrow embedded terminals discern's users live in would clip
  // most tips mid-sentence.
  const tipLines: string[] = [];
  if (tip !== undefined) {
    const indent = " ".repeat(displayWidth(TIP_PREFIX));
    const lines = wrapText(tip, Math.max(1, width - indent.length));
    for (const [index, line] of lines.entries()) {
      tipLines.push(
        index === 0
          ? `${out.terminal.role("  ✦ ", "muted")}${
            out.terminal.tone("Tip", "warning")
          }${out.terminal.role(`  ${line}`, "muted")}`
          : out.terminal.role(`${indent}${line}`, "muted"),
      );
    }
  }
  const rendered = renderHumanOutputGroups([
    { id: "desk-summary", items: [...summaryLines, ...tipLines] },
    { id: "unlanded-branches", items: unlandedLines },
    { id: "contained-branches", items: containedLines },
    { id: "reappeared-worktree-paths", items: reappearedLines },
  ], { leadingBoundary: true });
  if (rendered !== "") out.raw(`${rendered}\n`);
}

/** Offer the fleet as a grouped picker; resolves to a row path or a sentinel. */
async function pickRow(
  rows: DeskRow[],
  rootScripts: readonly ProjectScript[],
  runtime: DeskRuntime,
): Promise<string> {
  const bucketHeading = (bucket: DeskRow["bucket"], count: number): string =>
    `${bucketTitle(bucket)} · ${count}`;
  const nameCounts = new Map<string, number>();
  for (const row of rows) {
    nameCounts.set(row.task.name, (nameCounts.get(row.task.name) ?? 0) + 1);
  }
  const labels = new Map<string, { plain: string; rendered: string }>();
  for (const row of rows) {
    const duplicate = (nameCounts.get(row.task.name) ?? 0) > 1;
    const disambiguator = duplicate
      ? row.task.disambiguator ?? row.entry.id ?? row.entry.branch
      : undefined;
    labels.set(
      row.entry.path,
      disambiguator === undefined
        ? { plain: row.task.name, rendered: row.task.name }
        : {
          plain: `${row.task.name}  ${disambiguator}`,
          rendered: `${row.task.name}  ${disambiguator}`,
        },
    );
  }
  const labelWidth = Math.max(
    0,
    ...[...labels.values()].map((v) => v.plain.length),
  );
  const groups: SelectPromptGroup<string>[] = [];
  for (const bucket of DESK_BUCKETS) {
    const members = rows.filter((r) => r.bucket === bucket);
    if (members.length === 0) {
      continue;
    }
    groups.push({
      id: `tasks-${bucket}`,
      label: bucketHeading(bucket, members.length),
      items: members.map((r) => {
        const label = labels.get(r.entry.path) ?? {
          plain: r.task.name,
          rendered: r.task.name,
        };
        return {
          name: `${label.rendered}${
            " ".repeat(labelWidth - label.plain.length)
          }  ${r.summary}`,
          value: r.entry.path,
        };
      }),
    });
  }
  groups.push({
    id: "desk-actions",
    label: "Desk",
    items: [
      {
        name: "Start a task",
        value: START_TASK,
      },
      ...(rootScripts.length === 0
        ? []
        : [{ name: "Run a Project Script", value: RUN_PROJECT_SCRIPT }]),
      { name: "Read discern's docs", value: READ_DOCS },
    ],
  });
  groups.push({
    id: "session-actions",
    label: "Session",
    items: [
      { name: "Refresh", value: REFRESH },
      { name: "Quit", value: QUIT },
    ],
  });
  const options = groupedSelectOptions(groups);
  const search = rows.length > FILTER_THRESHOLD;
  try {
    return await runtime.select({
      message: rows.length === 0
        ? "Choose a desk action"
        : "Choose a task or action",
      options,
      search,
      ...(search ? { searchLabel: "filter" } : {}),
      hint: search
        ? "Type to filter. Use the arrow keys to move and Enter to choose."
        : "Use the arrow keys to move and Enter to choose.",
      maxRows: 16,
    });
  } catch (error) {
    if (!isPromptCancellation(error)) throw error;
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
  scripts: readonly ProjectScript[],
  runtime: DeskRuntime,
): Promise<void> {
  const script = await pickScript(scripts, project, "Desk", runtime);
  if (script === undefined) {
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

/** Prompt for an optional task name and create it through the same core as
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
    answer = await runtime.input(
      "Task name (blank uses a codename)",
    );
  } catch (error) {
    if (!isPromptCancellation(error)) throw error;
    return undefined;
  }
  const name = answer.trim();
  echoCommand(
    out,
    name === "" ? "discern start" : `discern start --name=${shellWord(name)}`,
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
): Promise<boolean> {
  const trunk = config.repository.trunk;
  const target = basename(row.entry.path);
  switch (action) {
    case "accept": {
      echoCommand(out, `discern accept  (in ${target})`);
      const ctx = await runtime.lifecycle(row.entry.path);
      await runtime.accept(ctx, { dryRun: true });
      if (
        !(await runtime.confirm(`Land ${row.entry.branch} on ${trunk}?`, true))
      ) {
        return false;
      }
      // The human just accepted the landing at this interactive prompt, so pass
      // the consent attestation in — the desk's confirm IS the acceptance, and
      // accept must not double-refuse for a consent it already collected (ADR 0134).
      await runtime.accept(ctx, { confirmed: true });
      await runtime.pause(out);
      return true;
    }
    case "grant": {
      if (
        !(await runtime.confirm(
          `Allow ${row.entry.branch} to land once green without a further conversation?`,
          false,
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
      if (
        !(await runtime.confirm(
          `Revoke landing pre-authorization for ${row.entry.branch}?`,
          false,
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
      await runtime.update(ctx, { dryRun: true });
      if (
        !(await runtime.confirm(
          `Merge ${trunk} into ${row.entry.branch}?`,
          true,
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
      const containedIn = row.entry.contained_in ?? "a live branch";
      if (
        !(await runtime.confirm(
          `Reclaim ${target}? Branch ${row.entry.branch} is KEPT (its commits ` +
            `are contained in ${containedIn}); the checkout and its ` +
            `per-worktree state — gate proof included — are destroyed.`,
          false,
        ))
      ) {
        return false;
      }
      const ctx = await runtime.lifecycle(root);
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
      echoCommand(out, `discern worktree drop ${shellWord(dropTarget)}`);
      const ctx = await runtime.lifecycle(root);
      await runtime.drop(ctx, dropTarget, { dryRun: true });
      if (!(await runtime.confirm(`Drop ${target}?`, false))) {
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
          typed = await runtime.input(
            `Type the branch name (${row.entry.branch}) to discard it permanently — anything else cancels`,
          );
        } catch (error) {
          if (!isPromptCancellation(error)) throw error;
          typed = "";
        }
        if (typed.trim() !== row.entry.branch) {
          out.info("Left untouched.");
          return false;
        }
        echoCommand(
          out,
          `discern worktree drop ${shellWord(dropTarget)} --force`,
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
      const launch = await pickAgentLaunch(row, runtime);
      if (launch === undefined) {
        return false;
      }
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
      const shell = Deno.env.get("SHELL") ?? "/bin/sh";
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
      echoCommand(
        out,
        `git log ${trunk}..  ·  git status --short  ·  git diff --stat ${trunk}...  (in ${target})`,
      );
      const cwd = row.entry.path;
      await printGitRead(
        out,
        cwd,
        ["log", "--oneline", "--no-decorate", "-15", `${trunk}..HEAD`],
        `Commits not on ${trunk}`,
        runtime,
      );
      await printGitRead(
        out,
        cwd,
        ["status", "--short"],
        "Uncommitted changes",
        runtime,
      );
      await printGitRead(
        out,
        cwd,
        ["diff", "--stat", `${trunk}...HEAD`],
        `Diffstat vs ${trunk}`,
        runtime,
      );
      if (row.proofHonored) {
        out.ok("gate proof: this clean HEAD holds a recorded pass");
      }
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
): Promise<void> {
  clearBoard(out);
  out.heading(terminalLine(row.task.name));
  out.raw(
    `  ${out.terminal.role(terminalLine(row.summary), "muted")}\n`,
  );
  out.raw(
    `  ${
      out.terminal.role(
        terminalLine(`Branch ${row.entry.branch}`),
        "muted",
      )
    }\n`,
  );
  while (true) {
    const options = groupedSelectOptions<string>([
      ...actionGroups(row, config),
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
      });
    } catch (error) {
      if (!isPromptCancellation(error)) throw error;
      return;
    }
    if (action === BACK) {
      return;
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
        )
      ) {
        return;
      }
    } catch (e) {
      if (e instanceof WorktreeGitError || e instanceof IdentityError) {
        // A lifecycle refusal names its own next step — render it and stay.
        out.error(e.message);
        continue;
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
      runtime.error(`discern: ${message}`);
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
  if (!runtime.canPrompt()) {
    runtime.error(
      "discern desk needs an interactive terminal (stdin and stdout TTYs) — in a pipe or script use `discern status`.",
    );
    return 1;
  }
  const root = await runtime.findRoot();
  if (root === undefined) {
    runtime.error(`discern: ${NO_PROJECT_MESSAGE}`);
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

  // The session's tip (ADR 0234): chosen once from the first survey, held
  // stable across every redraw, and marked shown exactly once — the
  // seen-state write and the logbook id together, at selection, never per
  // redraw. Tip state must never cost a session, so any failure in the seams
  // degrades to a tipless header.
  let tipLine: string | undefined;
  try {
    const tipState = await runtime.readTipState(root);
    const selected = selectTip(TIPS, { data: first.data, config }, tipState);
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
  } catch {
    tipLine = undefined;
  }

  let data: StatusData = first.data;
  let focusPath: string | undefined;
  while (true) {
    clearBoard(out);
    const fleet = data.fleet ?? [];
    const [detectedAgents, rootScripts] = await Promise.all([
      runtime.detectAgents(),
      runtime.scripts(root, config),
    ]);
    // Per-row facts the survey cannot carry (each worktree's own scripts and
    // agent launches), gathered concurrently from ONE config read per row.
    // Proof and effort-grant state ride the fleet entries themselves.
    const gathered = await Promise.all(
      fleet
        .filter((entry) =>
          !entry.is_main && entry.broken !== true &&
          entry.git_unavailable !== true
        )
        .map(async (entry) => {
          const worktreeConfig = await loadWorktreeConfig(entry.path, runtime);
          return {
            path: entry.path,
            scripts: worktreeConfig === undefined
              ? []
              : await runtime.scripts(entry.path, worktreeConfig),
            agentLaunches: worktreeConfig === undefined
              ? []
              : buildAgentLaunches(worktreeConfig, detectedAgents),
          };
        }),
    );
    const scriptsByPath = new Map<string, readonly ProjectScript[]>(
      gathered.map((facts) => [facts.path, facts.scripts]),
    );
    const agentLaunchesByPath = new Map<string, readonly DeskAgentLaunch[]>(
      gathered.map((facts) => [facts.path, facts.agentLaunches]),
    );
    const rows = buildDeskRows(
      fleet,
      scriptsByPath,
      agentLaunchesByPath,
      runtime.now(),
    );
    renderHeader(out, config, root, data, rows, tipLine, runtime.width());

    const focused = focusPath === undefined
      ? undefined
      : rows.find((row) => row.entry.path === focusPath);
    focusPath = undefined;
    const choice = focused?.entry.path ??
      await pickRow(rows, rootScripts, runtime);
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
        config.project.slug === "" ? basename(root) : config.project.slug,
        rootScripts,
        runtime,
      );
    } else if (choice === READ_DOCS) {
      await openOnlineDocs(out, runtime);
    } else if (choice !== REFRESH) {
      const row = rows.find((r) => r.entry.path === choice);
      if (row !== undefined) {
        await actOn(out, root, config, row, runtime);
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
