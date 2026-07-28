/**
 * `desk` — the operator's interactive ingress and surface over the worktree fleet
 * (ADR 0119). Bare `discern`, post-setup on an interactive terminal, opens it;
 * `discern desk` is the named form the guards and docs see.
 *
 * The desk is a renderer and a dispatcher, never a source of truth: state comes
 * from `statusResult` (the fleet survey) plus the gate-receipt check, and every
 * mutation runs the same lifecycle core the CLI verb runs — a core's refusal is
 * rendered, never bypassed. Its only owned logic is the pure classification in
 * `model.ts`. Lifecycle actions echo their CLI command. The effort-grant action
 * is deliberately desk-only: this TTY is the sole write boundary, while agent
 * CLI and MCP surfaces can only read the resulting grant.
 *
 * Deliberately CLI-only — no MCP tool — for `worktree drop`'s reason: the desk
 * wields human supervisory actions over OTHER efforts' worktrees, which the
 * fleet-ownership rule forbids an agent. Without a TTY (or under `--json`) it
 * refuses with a pointer at `status`.
 */

import { Select } from "@cliffy/prompt";
import { basename } from "@std/path";
import { DISCERN_MARK } from "../../shared/brand.ts";
import { findRoot, NO_PROJECT_MESSAGE } from "../../shared/env.ts";
import { emitResult } from "../../shared/emit.ts";
import { type DiscernConfig, loadConfig } from "../../shared/config_schema.ts";
import type { StartData, StatusData } from "../../shared/result_schemas.ts";
import {
  detectAgentBinariesOnPath,
  type DetectedAgentBinary,
} from "../../lib/detect_agents.ts";
import { resolveWorktreeRoot } from "../../lib/paths.ts";
import {
  canPrompt,
  confirmationPrompt,
  inputPrompt,
  selectPrompt,
  type SelectPromptOptions,
} from "../../lib/prompts.ts";
import { Logger } from "../../lib/log.ts";
import { statusResult } from "../status/status.ts";
import { gateReceiptHonored } from "../gate/receipt.ts";
import {
  accept,
  IdentityError,
  type LifecycleContext,
  lifecycleContext,
  startResult,
  update,
  worktreeDrop,
  WorktreeGitError,
} from "../worktree/lifecycle.ts";
import { mainRepoPath } from "../worktree/git.ts";
import { runGit } from "../../shared/subprocess.ts";
import { colorEnabled, makeOut, type Out } from "../output.ts";
import { runOwnedChild } from "../owned_child.ts";
import {
  listProjectScripts,
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
import { deskSessionEnv, inDeskSession } from "./session.ts";
import {
  clearEffortGrant,
  type EffortGrantWrite,
  grantEffort,
} from "../worktree/effort_grant.ts";

/** Sentinel Select values that are not fleet rows (NUL-prefixed: never a path). */
const REFRESH = "\x00refresh";
const QUIT = "\x00quit";
const BACK = "\x00back";
const START_TASK = "\x00start-task";
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
 * Production uses {@link DEFAULT_DESK_RUNTIME}; tests replace it with a scripted
 * runtime so every supervisory path is exercised without pretending a pipe is a
 * terminal or touching a real worktree. */
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
  receiptHonored(path: string): DeskMaybePromise<boolean>;
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
  scripts(root: string): DeskMaybePromise<readonly ProjectScript[]>;
  runScript(
    root: string,
    name: string,
    env: Record<string, string>,
  ): DeskMaybePromise<number>;
  now(): number;
}

/** Dim "→ <command>" line: the CLI equivalent of the action about to run. */
function echoCommand(out: Out, command: string): void {
  out.raw(`${out.c.dim}→ ${command}${out.c.reset}\n`);
}

/** Quote one argv word for display only. Execution never passes through a
 * shell; this makes the echoed CLI equivalent safe to copy and paste. */
function shellWord(word: string): string {
  return /^[A-Za-z0-9_./:@%+=,-]+$/.test(word)
    ? word
    : `'${word.replaceAll("'", `'\\''`)}'`;
}

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

/** Hold the board until ↵, so output worth reading (an acceptance's receipt, a
 * drop's summary) isn't wiped by the next survey pass's clear. */
async function awaitEnter(out: Out): Promise<void> {
  out.raw(`\n${out.c.dim}press ↵ to return to the desk${out.c.reset} `);
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
  } catch {
    return false;
  }
}

/** The narrating logger the lifecycle cores render human output through. */
function deskLogger(): Logger {
  return new Logger({ json: false, noColor: false, humanStream: "stdout" });
}

/** The real terminal/git implementation. Keeping the boundary in one value
 * makes the whole interactive surface scriptable while the CLI still calls the
 * same functions with the same options. */
export const DEFAULT_DESK_RUNTIME: DeskRuntime = {
  canPrompt: () => canPrompt(false),
  inDeskSession: () => inDeskSession(),
  findRoot: () => findRoot(),
  loadConfig: (root) => loadConfig(root),
  status: (root) => statusResult(root),
  mainRepoPath: (root) => mainRepoPath(root),
  receiptHonored: (path) => gateReceiptHonored(path),
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
  git: (args, cwd) => runGit(args, { cwd }),
  interactive: async (command, args, cwd, env) => {
    const child = await runOwnedChild(command, {
      args: [...args],
      cwd,
      env,
      resumeAfterInterrupt: true,
    });
    return child.status.code;
  },
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
  scripts: async (root) => {
    try {
      return await listProjectScripts(root);
    } catch {
      // A branch-local config can be unreadable even while the main checkout's
      // fleet survey remains healthy. In that state no script is safely
      // available, so the conditional action stays hidden.
      return [];
    }
  },
  runScript: (root, name, env) =>
    runProjectScriptAt(root, name, [], {
      cwd: root,
      env,
      resumeAfterInterrupt: true,
    }),
  now: () => Date.now(),
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
  out.heading(title);
  out.raw(body === "" ? `${out.c.dim}(none)${out.c.reset}\n` : `${body}\n`);
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
function actionLabel(action: DeskAction, trunk: string): string {
  switch (action) {
    case "accept":
      return `Accept and land on ${trunk}`;
    case "grant":
      return "Pre-authorize landing once green";
    case "revoke_grant":
      return "Revoke landing pre-authorization";
    case "update":
      return `Update branch from ${trunk}`;
    case "script":
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

/** Pick one of the configured, PATH-available agent entry points. */
async function pickAgentLaunch(
  row: DeskRow,
  runtime: DeskRuntime,
): Promise<DeskAgentLaunch | undefined> {
  const options: Parameters<typeof Select.prompt<string>>[0]["options"] = [
    ...row.agentLaunches.map((launch) => ({
      name: launch.label,
      value: launch.id,
    })),
    Select.separator("─────"),
    { name: "Back", value: BACK },
  ];
  let id: string;
  try {
    id = await runtime.select({
      message: `Choose an agent for ${row.task.name}`,
      options,
      hint: "Use the arrow keys to move and Enter to choose.",
      info: false,
    });
  } catch {
    return undefined;
  }
  return id === BACK
    ? undefined
    : row.agentLaunches.find((launch) => launch.id === id);
}

/** Pick one of a row's worktree-local Project Scripts. */
async function pickScript(
  row: DeskRow,
  runtime: DeskRuntime,
): Promise<ProjectScript | undefined> {
  const options: Parameters<typeof Select.prompt<string>>[0]["options"] = [
    ...row.scripts.map((script) => ({
      name: script.description === undefined
        ? script.name
        : `${script.name}  ·  ${script.description}`,
      value: script.name,
    })),
    Select.separator("─────"),
    { name: "Back", value: BACK },
  ];
  let name: string;
  try {
    const search = row.scripts.length > FILTER_THRESHOLD;
    name = await runtime.select({
      message: `Choose a Project Script for ${row.task.name}`,
      options,
      search,
      ...(search ? { searchLabel: "filter" } : {}),
      hint: search
        ? "Type to filter. Use the arrow keys to move and Enter to choose."
        : "Use the arrow keys to move and Enter to choose.",
      info: false,
    });
  } catch {
    return undefined;
  }
  return name === BACK
    ? undefined
    : row.scripts.find((script) => script.name === name);
}

/** The desk header: project identity, the main checkout's state, and the
 * otherwise-invisible unlanded branches. */
function renderHeader(
  out: Out,
  config: DiscernConfig,
  root: string,
  data: StatusData,
  rows: readonly DeskRow[],
): void {
  const project = config.project.slug === ""
    ? basename(root)
    : config.project.slug;
  out.heading(`${DISCERN_MARK} ${project}`);
  const taskCount = rows.length === 0
    ? "No tasks"
    : `${rows.length} task${rows.length === 1 ? "" : "s"}`;
  const main = (data.fleet ?? []).find((e) => e.is_main);
  if (main !== undefined) {
    const mainState = main.clean === true
      ? `${main.branch} clean`
      : main.clean === false
      ? `${main.branch} has ${main.changed_files ?? "?"} uncommitted change${
        main.changed_files === 1 ? "" : "s"
      }`
      : `${main.branch} state unknown`;
    const stateColor = main.clean === true ? out.c.green : out.c.yellow;
    out.raw(
      `  ${out.c.dim}${taskCount}  ·${out.c.reset}  ${stateColor}${mainState}${out.c.reset}\n`,
    );
  } else {
    out.raw(`  ${out.c.dim}${taskCount}${out.c.reset}\n`);
  }
  const unlanded = data.unlanded_branches ?? [];
  if (unlanded.length > 0) {
    const branches = `${unlanded.length} branch${
      unlanded.length === 1 ? " has" : "es have"
    } no worktree`;
    out.raw(
      `  ${out.c.yellow}${branches}${out.c.reset}: ${out.c.dim}${
        unlanded.join(", ")
      }${out.c.reset}\n`,
    );
    out.raw(
      `  ${out.c.dim}Open one with \`discern start --from <branch>\`.${out.c.reset}\n`,
    );
  }
}

/** Offer the fleet as a grouped picker; resolves to a row path or a sentinel. */
async function pickRow(
  rows: DeskRow[],
  out: Out,
  runtime: DeskRuntime,
): Promise<string> {
  const dim = (s: string): string =>
    out.color ? `${out.c.dim}${s}${out.c.reset}` : s;
  const bucketHeading = (bucket: DeskRow["bucket"], count: number): string => {
    if (!out.color) {
      return `${bucketTitle(bucket)}  ${count}`;
    }
    const color = bucket === "ready"
      ? out.c.green
      : bucket === "attention"
      ? out.c.yellow
      : out.c.cyan;
    return `${out.c.bold}${color}${
      bucketTitle(bucket)
    }  ${count}${out.c.reset}`;
  };
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
          rendered: `${row.task.name}  ${dim(disambiguator)}`,
        },
    );
  }
  const labelWidth = Math.max(
    0,
    ...[...labels.values()].map((v) => v.plain.length),
  );
  const options: Parameters<typeof Select.prompt<string>>[0]["options"] = [];
  for (const bucket of DESK_BUCKETS) {
    const members = rows.filter((r) => r.bucket === bucket);
    if (members.length === 0) {
      continue;
    }
    options.push(Select.separator(bucketHeading(bucket, members.length)));
    for (const r of members) {
      const label = labels.get(r.entry.path) ?? {
        plain: r.task.name,
        rendered: r.task.name,
      };
      options.push({
        name: `${label.rendered}${
          " ".repeat(labelWidth - label.plain.length)
        }  ${dim(r.summary)}`,
        value: r.entry.path,
      });
    }
  }
  options.push(Select.separator(dim("─────")));
  options.push({
    name: out.color
      ? `${out.c.bold}${out.c.cyan}Start a task${out.c.reset}`
      : "Start a task",
    value: START_TASK,
  });
  options.push({ name: dim("Refresh"), value: REFRESH });
  options.push({ name: dim("Quit"), value: QUIT });
  const search = rows.length > FILTER_THRESHOLD;
  try {
    return await runtime.select({
      message: rows.length === 0 ? "No tasks yet" : "Choose a task",
      options,
      search,
      ...(search ? { searchLabel: dim("filter") } : {}),
      hint: search
        ? "Type to filter. Use the arrow keys to move and Enter to choose."
        : "Use the arrow keys to move and Enter to choose.",
      info: false,
      maxRows: 16,
    });
  } catch {
    // Cancelled (Ctrl-C / Esc) — a clean exit, not an error.
    return QUIT;
  }
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
  } catch {
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
    case "drop": {
      echoCommand(out, `discern worktree drop ${target}`);
      const ctx = await runtime.lifecycle(root);
      await runtime.drop(ctx, target, { dryRun: true });
      if (!(await runtime.confirm(`Drop ${target}?`, false))) {
        return false;
      }
      try {
        await runtime.drop(ctx, target, {});
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
        } catch {
          typed = "";
        }
        if (typed.trim() !== row.entry.branch) {
          out.info("Left untouched.");
          return false;
        }
        echoCommand(out, `discern worktree drop ${target} --force`);
        await runtime.drop(ctx, target, { force: true });
        await runtime.pause(out);
        return true;
      }
    }
    case "script": {
      const script = await pickScript(row, runtime);
      if (script === undefined) {
        return false;
      }
      echoCommand(
        out,
        `discern script ${script.name}  (in ${target})`,
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
      if (row.receiptHonored) {
        out.ok("gate receipt: this clean HEAD holds a recorded pass");
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
  out.heading(row.task.name);
  out.raw(`  ${out.c.dim}${row.summary}${out.c.reset}\n`);
  out.raw(`  ${out.c.dim}Branch ${row.entry.branch}${out.c.reset}\n`);
  while (true) {
    const options: Parameters<typeof Select.prompt<string>>[0]["options"] = [
      ...row.actions.map((a) => ({
        name: actionLabel(a, config.repository.trunk),
        value: a as string,
      })),
      Select.separator(
        out.color ? `${out.c.dim}─────${out.c.reset}` : "─────",
      ),
      { name: "Back", value: BACK },
    ];
    let action: string;
    try {
      action = await runtime.select({
        message: "Choose an action",
        options,
        hint: "Use the arrow keys to move and Enter to choose.",
        info: false,
      });
    } catch {
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
      error: "interactive_only",
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

  let data: StatusData = first.data;
  let focusPath: string | undefined;
  while (true) {
    clearBoard(out);
    const fleet = data.fleet ?? [];
    const receiptByPath = new Map<string, boolean>();
    const effortGrantByPath = new Map<string, boolean>();
    const scriptsByPath = new Map<string, readonly ProjectScript[]>();
    const agentLaunchesByPath = new Map<
      string,
      readonly DeskAgentLaunch[]
    >();
    const detectedAgents = await runtime.detectAgents();
    for (const entry of fleet) {
      if (
        !entry.is_main && entry.broken !== true &&
        entry.git_unavailable !== true
      ) {
        const [receiptHonored, scripts, worktreeConfig] = await Promise.all([
          runtime.receiptHonored(entry.path),
          runtime.scripts(entry.path),
          loadWorktreeConfig(entry.path, runtime),
        ]);
        receiptByPath.set(entry.path, receiptHonored);
        effortGrantByPath.set(
          entry.path,
          entry.landing_authority?.kind === "authorized" &&
            entry.landing_authority.source === "effort-grant",
        );
        scriptsByPath.set(entry.path, scripts);
        agentLaunchesByPath.set(
          entry.path,
          worktreeConfig === undefined
            ? []
            : buildAgentLaunches(worktreeConfig, detectedAgents),
        );
      }
    }
    const rows = buildDeskRows(
      fleet,
      receiptByPath,
      effortGrantByPath,
      scriptsByPath,
      agentLaunchesByPath,
      runtime.now(),
    );
    renderHeader(out, config, root, data, rows);

    const focused = focusPath === undefined
      ? undefined
      : rows.find((row) => row.entry.path === focusPath);
    focusPath = undefined;
    const choice = focused?.entry.path ?? await pickRow(rows, out, runtime);
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
