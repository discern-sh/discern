/**
 * `desk` — the operator's interactive surface over the worktree fleet
 * (ADR 0119). Bare `discern`, post-setup on an interactive terminal, opens it;
 * `discern desk` is the named form the guards and docs see.
 *
 * The desk is a renderer and a dispatcher, never a source of truth: state comes
 * from `statusResult` (the fleet survey) plus the gate-receipt check, and every
 * mutation runs the same lifecycle core the CLI verb runs — a core's refusal is
 * rendered, never bypassed. Its only owned logic is the pure classification in
 * `model.ts`. Every action echoes the CLI command it is about to run, so the
 * desk teaches the verb vocabulary rather than becoming a second dialect.
 *
 * Deliberately CLI-only — no MCP tool — for `worktree drop`'s reason: the desk
 * wields human supervisory actions over OTHER efforts' worktrees, which the
 * fleet-ownership rule forbids an agent. Without a TTY (or under `--json`) it
 * refuses with a pointer at `status`.
 */

import { Confirm, Input, Select } from "@cliffy/prompt";
import { basename } from "@std/path";
import { findRoot } from "../../shared/env.ts";
import { emitResult } from "../../shared/emit.ts";
import { type DiscernConfig, loadConfig } from "../../shared/config_schema.ts";
import type { StatusData } from "../../shared/result_schemas.ts";
import { canPrompt } from "../../lib/prompts.ts";
import { Logger } from "../../lib/log.ts";
import { statusResult } from "../status/status.ts";
import { gateReceiptHonored } from "../gate/receipt.ts";
import {
  accept,
  IdentityError,
  integrate,
  lifecycleContext,
  worktreeDrop,
  WorktreeGitError,
} from "../worktree/lifecycle.ts";
import { mainRepoPath } from "../worktree/git.ts";
import { runGit } from "../../shared/subprocess.ts";
import { colorEnabled, makeOut, type Out } from "../output.ts";
import {
  bucketTitle,
  buildDeskRows,
  DESK_BUCKETS,
  type DeskAction,
  type DeskRow,
} from "./model.ts";

const NO_PROJECT =
  "not inside a discern project (no discern.toml in this directory or any parent).";

/** Sentinel Select values that are not fleet rows (NUL-prefixed: never a path). */
const REFRESH = "\x00refresh";
const QUIT = "\x00quit";
const BACK = "\x00back";

/** Flags accepted by `desk`. */
export interface DeskOptions {
  /** Present for surface parity only — the desk has no JSON form; it refuses. */
  json?: boolean;
}

/** Dim "→ <command>" line: the CLI equivalent of the action about to run. */
function echoCommand(out: Out, command: string): void {
  out.raw(`${out.c.dim}→ ${command}${out.c.reset}\n`);
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
    return await Confirm.prompt({ message, default: defaultTo });
  } catch {
    return false;
  }
}

/** The narrating logger the lifecycle cores render human output through. */
function deskLogger(): Logger {
  return new Logger({ json: false, noColor: false, humanStream: "stdout" });
}

/** Run a git read in `cwd` and print its output under a heading ("(none)" when
 * empty) — the desk's inspect view; failures print git's stderr, never throw. */
async function printGitRead(
  out: Out,
  cwd: string,
  args: string[],
  title: string,
): Promise<void> {
  const res = await runGit(args, { cwd });
  const body = (res.success ? res.stdout : res.stderr).trimEnd();
  out.heading(title);
  out.raw(body === "" ? `${out.c.dim}(none)${out.c.reset}\n` : `${body}\n`);
}

/** The human label for a row action in the menu. */
function actionLabel(action: DeskAction, trunk: string): string {
  switch (action) {
    case "accept":
      return `Accept — land this branch on ${trunk}`;
    case "integrate":
      return `Integrate — bring ${trunk} into this branch`;
    case "jump":
      return "Jump in — open a shell inside the worktree";
    case "inspect":
      return `Inspect — commits, changes, diffstat vs ${trunk}`;
    case "drop":
      return "Drop — discard the worktree and its branch";
  }
}

/** The desk header: project identity, the main checkout's state, and the
 * otherwise-invisible unlanded branches. */
function renderHeader(
  out: Out,
  config: DiscernConfig,
  root: string,
  data: StatusData,
): void {
  const project = config.project.slug === ""
    ? basename(root)
    : config.project.slug;
  out.heading(`discern desk — ${project}`);
  const main = (data.fleet ?? []).find((e) => e.is_main);
  if (main !== undefined) {
    const state = main.clean === true
      ? "clean"
      : main.clean === false
      ? `${main.changed_files ?? "?"} uncommitted change${
        main.changed_files === 1 ? "" : "s"
      }`
      : "state unknown";
    out.raw(`${out.c.dim}  ${main.branch}: ${state}${out.c.reset}\n`);
  }
  const unlanded = data.unlanded_branches ?? [];
  if (unlanded.length > 0) {
    out.raw(
      `${out.c.dim}  unlanded work with no worktree: ${
        unlanded.join(", ")
      }  (pull in with \`discern start --from <branch>\`)${out.c.reset}\n`,
    );
  }
}

/** Offer the fleet as a grouped picker; resolves to a row path or a sentinel. */
async function pickRow(rows: DeskRow[], out: Out): Promise<string> {
  const paint = (s: string): string =>
    out.color ? `${out.c.bold}${out.c.cyan}${s}${out.c.reset}` : s;
  const dim = (s: string): string =>
    out.color ? `${out.c.dim}${s}${out.c.reset}` : s;
  const options: Parameters<typeof Select.prompt<string>>[0]["options"] = [];
  for (const bucket of DESK_BUCKETS) {
    const members = rows.filter((r) => r.bucket === bucket);
    if (members.length === 0) {
      continue;
    }
    options.push(Select.separator(paint(bucketTitle(bucket))));
    for (const r of members) {
      options.push({
        name: `${r.entry.branch}  ${dim(`· ${r.summary}`)}`,
        value: r.entry.path,
      });
    }
  }
  options.push(Select.separator(dim("─────")));
  options.push({ name: dim("Refresh"), value: REFRESH });
  options.push({ name: dim("Quit"), value: QUIT });
  try {
    return await Select.prompt({
      message: rows.length === 0
        ? "No efforts in flight — nothing needs a decision"
        : "Pick an effort  ·  type to filter",
      options,
      search: true,
      info: true,
      maxRows: 16,
    });
  } catch {
    // Cancelled (Ctrl-C / Esc) — a clean exit, not an error.
    return QUIT;
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
): Promise<boolean> {
  const trunk = config.project.main_branch;
  const target = basename(row.entry.path);
  switch (action) {
    case "accept": {
      echoCommand(out, `discern accept  (in ${target})`);
      const ctx = await lifecycleContext(row.entry.path, deskLogger());
      await accept(ctx, { dryRun: true });
      if (!(await confirmOrNo(`Land ${row.entry.branch} on ${trunk}?`, true))) {
        return false;
      }
      await accept(ctx, {});
      await awaitEnter(out);
      return true;
    }
    case "integrate": {
      echoCommand(out, `discern integrate  (in ${target})`);
      const ctx = await lifecycleContext(row.entry.path, deskLogger());
      await integrate(ctx, { dryRun: true });
      if (
        !(await confirmOrNo(`Merge ${trunk} into ${row.entry.branch}?`, true))
      ) {
        return false;
      }
      await integrate(ctx, {});
      await awaitEnter(out);
      return true;
    }
    case "drop": {
      echoCommand(out, `discern worktree drop ${target}`);
      const ctx = await lifecycleContext(root, deskLogger());
      await worktreeDrop(ctx, target, { dryRun: true });
      if (!(await confirmOrNo(`Drop ${target}?`, false))) {
        return false;
      }
      try {
        await worktreeDrop(ctx, target, {});
        await awaitEnter(out);
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
          typed = await Input.prompt({
            message:
              `Type the branch name (${row.entry.branch}) to discard it permanently — anything else cancels`,
          });
        } catch {
          typed = "";
        }
        if (typed.trim() !== row.entry.branch) {
          out.info("Left untouched.");
          return false;
        }
        echoCommand(out, `discern worktree drop ${target} --force`);
        await worktreeDrop(ctx, target, { force: true });
        await awaitEnter(out);
        return true;
      }
    }
    case "jump": {
      const shell = Deno.env.get("SHELL") ?? "/bin/sh";
      echoCommand(out, `${shell}  (cwd: ${row.entry.path})`);
      out.info("Exit the shell to return to the desk.");
      const child = new Deno.Command(shell, {
        cwd: row.entry.path,
        stdin: "inherit",
        stdout: "inherit",
        stderr: "inherit",
      }).spawn();
      await child.status;
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
      );
      await printGitRead(
        out,
        cwd,
        ["status", "--short"],
        "Uncommitted changes",
      );
      await printGitRead(
        out,
        cwd,
        ["diff", "--stat", `${trunk}...HEAD`],
        `Diffstat vs ${trunk}`,
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
): Promise<void> {
  while (true) {
    const options: Parameters<typeof Select.prompt<string>>[0]["options"] = [
      ...row.actions.map((a) => ({
        name: actionLabel(a, config.project.main_branch),
        value: a as string,
      })),
      Select.separator(
        out.color ? `${out.c.dim}─────${out.c.reset}` : "─────",
      ),
      { name: "Back", value: BACK },
    ];
    let action: string;
    try {
      action = await Select.prompt({
        message: `${row.entry.branch}  ·  ${row.summary}`,
        options,
      });
    } catch {
      return;
    }
    if (action === BACK) {
      return;
    }
    try {
      if (
        await dispatchAction(out, root, config, row, action as DeskAction)
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
export async function runDesk(opts: DeskOptions = {}): Promise<number> {
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
  if (!canPrompt(false)) {
    console.error(
      "discern desk needs an interactive terminal (stdin and stdout TTYs) — in a pipe or script use `discern status`.",
    );
    return 1;
  }
  const root = await findRoot();
  if (root === undefined) {
    console.error(`discern: ${NO_PROJECT}`);
    console.error("       Run `discern setup` to scaffold one.");
    return 1;
  }
  const out = makeOut(colorEnabled());
  const config = await loadConfig(root);

  const first = await statusResult(root);
  if (!first.ok || first.data === undefined) {
    out.error(first.message ?? "the status survey failed.");
    return 1;
  }
  if (first.data.location === "worktree") {
    // The desk supervises the fleet, and the fleet's actions (drop, accept)
    // operate from the main checkout — point home rather than half-work here.
    const mainRepo = await mainRepoPath(root);
    out.info(
      `The desk runs from the main checkout${
        mainRepo !== undefined ? `: cd ${mainRepo}` : ""
      } — this is a worktree. For this worktree's own state: discern status.`,
    );
    return 0;
  }

  let data: StatusData = first.data;
  while (true) {
    clearBoard(out);
    const fleet = data.fleet ?? [];
    const receiptByPath = new Map<string, boolean>();
    for (const entry of fleet) {
      if (
        !entry.is_main && entry.broken !== true &&
        entry.git_unavailable !== true
      ) {
        receiptByPath.set(entry.path, await gateReceiptHonored(entry.path));
      }
    }
    const rows = buildDeskRows(fleet, receiptByPath, Date.now());
    renderHeader(out, config, root, data);

    const choice = await pickRow(rows, out);
    if (choice === QUIT) {
      return 0;
    }
    if (choice !== REFRESH) {
      const row = rows.find((r) => r.entry.path === choice);
      if (row !== undefined) {
        await actOn(out, root, config, row);
      }
    }
    const next = await statusResult(root);
    if (!next.ok || next.data === undefined) {
      out.error(next.message ?? "the status survey failed.");
      return 1;
    }
    data = next.data;
  }
}
