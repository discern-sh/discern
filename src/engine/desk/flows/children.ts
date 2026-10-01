/**
 * Terminal owners the Desk hands the screen to: a coding agent, a shell, an
 * editor, the pager, and Project Scripts, plus the release page
 * the browser opens after its disclosure. Each revalidates its task first,
 * runs with the terminal, and reports what came back. A Project Script and
 * the release page are reviewed first; an agent without a prompt option
 * shows the stored brief before it opens.
 */

import { basename } from "@std/path";
import { commandEvidence } from "../../../shared/command_evidence.ts";
import { releasesResult } from "../../../commands/releases.ts";
import { DISCERN_VERSION } from "../../../lib/version.ts";
import { WorktreeGitError } from "../../worktree/lifecycle.ts";
import { userShell } from "../../user_shell.ts";
import type { Out } from "../../output.ts";
import { agentLaunchArgs, type DeskRow, deskRowId } from "../model.ts";
import { executeDeskOperation } from "../execution.ts";
import { deskSessionEnv } from "../session.ts";
import { echoDeskCommand } from "../presentation.ts";
import { parseProjectScriptArguments } from "../literal_argv.ts";
import { rowRef } from "../desk_transitions.ts";
import type { DeskScriptOwner } from "../desk_state.ts";
import {
  type DeskChild,
  type DeskFlowStep,
  type DeskOutcome,
  untilChosen,
} from "../flow_types.ts";
import { failureSheet, reviewFor } from "../review.ts";
import { DESK_COMMAND_REGISTRY } from "../commands.ts";
import {
  actionTarget,
  type DeskFlow,
  type DeskFlowContext,
  offerFor,
  rebound,
  stepRow,
} from "./context.ts";
import { scriptInventory } from "./reading.ts";

/** The button that hands the release page to the browser. */
const OPEN = "Open";

/** The button that runs a Project Script. */
const RUN = "Run";

/** The task a child concerns, revalidated, or none for the main checkout. */
async function childTask(
  context: DeskFlowContext,
  taskId: string | undefined,
  action: "agent" | "jump" | "inspect",
): Promise<DeskRow | undefined> {
  if (taskId === undefined) return undefined;
  const ref = rowRef(context.state, taskId);
  if (ref?.kind !== "task") {
    throw new WorktreeGitError(
      "The selected task is no longer listed. Nothing opened.",
    );
  }
  const refused = await rebound(
    context,
    { kind: "action", action, taskId, stage: "review" },
    {
      facts: {
        "worktree-identity": deskRowId(ref.row),
        path: ref.row.entry.path,
      },
    },
    action,
  );
  if (refused !== undefined) {
    throw new WorktreeGitError(
      refused.message?.text ?? "The task changed; nothing opened.",
    );
  }
  return ref.row;
}
/** Wait on a failed child so its last words stay readable. */
async function reportExit(
  context: DeskFlowContext,
  out: Out,
  label: string,
  code: number,
): Promise<void> {
  if (code === 0) return;
  out.warn(`${label} exited with status ${code}.`);
  await context.runtime.pause(out);
}

/** Open one agent launch in a task's checkout. */
async function runAgent(
  context: DeskFlowContext,
  out: Out,
  taskId: string,
  launchId: string,
): Promise<DeskOutcome> {
  const row = await childTask(context, taskId, "agent");
  const launch = row?.agentLaunches.find((candidate) =>
    candidate.id === launchId
  );
  if (
    row === undefined || launch === undefined ||
    launch.availability === "disabled"
  ) {
    throw new WorktreeGitError(launch?.reason ?? "That agent can't open here.");
  }
  const invocation = agentLaunchArgs(launch, row.entry.task?.brief);
  if (invocation.briefPassed) {
    out.info(
      `The task's brief goes to ${launch.providerLabel} through its documented prompt option.`,
    );
  }
  out.info(
    `${launch.providerLabel} opens in ${row.entry.path}. Exit it to come back here.`,
  );
  const code = await context.runtime.interactive(
    launch.binary,
    invocation.args,
    row.entry.path,
    deskSessionEnv(),
    "desk agent",
  );
  const saved = await context.runtime.writePreferences(context.root, {
    ...await context.runtime.readPreferences(context.root),
    last_agent: launch.agent,
  });
  if (saved.status !== "saved") {
    out.warn(`Desk preferences were not saved: ${saved.reason}`);
  }
  await reportExit(context, out, launch.label, code);
  return {
    command: commandEvidence([launch.binary, ...invocation.args]),
    ok: code === 0,
    back: {
      label: launch.providerLabel,
      taskId,
      ...(row.entry.changed_files === undefined
        ? {}
        : { changedBefore: row.entry.changed_files }),
    },
  };
}

/**
 * What a child that borrowed the terminal left: its exit, read if it
 * failed, and the return the next survey compares against.
 */
async function returned(
  context: DeskFlowContext,
  out: Out,
  child: {
    readonly label: string;
    readonly command: string;
    readonly code: number;
    readonly taskId: string | undefined;
    readonly row: DeskRow | undefined;
  },
): Promise<DeskOutcome> {
  await reportExit(
    context,
    out,
    child.label.replace(/^the /u, "The "),
    child.code,
  );
  const changed = child.row?.entry.changed_files;
  return {
    command: child.command,
    ok: child.code === 0,
    back: {
      label: child.label,
      ...(child.taskId === undefined ? {} : { taskId: child.taskId }),
      ...(changed === undefined ? {} : { changedBefore: changed }),
    },
  };
}

/** Open the user's shell in a task's checkout or the main checkout. */
async function runShell(
  context: DeskFlowContext,
  out: Out,
  taskId: string | undefined,
): Promise<DeskOutcome> {
  const row = await childTask(context, taskId, "jump");
  const path = row?.entry.path ?? context.root;
  const shell = userShell();
  echoDeskCommand(out, `${shell}  (cwd: ${path})`);
  out.info("Exit the shell to come back here.");
  const code = await context.runtime.interactive(
    shell,
    [],
    path,
    deskSessionEnv(),
    "desk shell",
  );
  return await returned(context, out, {
    label: "the shell",
    command: shell,
    code,
    taskId,
    row,
  });
}

/** Open the configured editor in a task's checkout or the main checkout. */
async function runEditor(
  context: DeskFlowContext,
  out: Out,
  taskId: string | undefined,
): Promise<DeskOutcome> {
  const row = await childTask(context, taskId, "inspect");
  const path = row?.entry.path ?? context.root;
  const configured = await context.runtime.editor(path);
  if (configured.editor === undefined) {
    return {
      command: "$VISUAL",
      ok: false,
      message: {
        tone: "warning",
        text: configured.reason ?? "No editor is available.",
      },
    };
  }
  echoDeskCommand(out, `${configured.editor.command} .  (cwd: ${path})`);
  return await returned(context, out, {
    label: "the editor",
    command: configured.editor.command,
    code: await context.runtime.openEditor(configured.editor, path),
    taskId,
    row,
  });
}

/** Page a task's full diff, or the main checkout's status and diff. */
async function runDiff(
  context: DeskFlowContext,
  taskId: string | undefined,
): Promise<DeskOutcome> {
  const row = await childTask(context, taskId, "inspect");
  const trunk = context.config.repository.trunk;
  const reads = row === undefined
    ? [["status", "--short", "--branch"], ["diff", "--stat", "HEAD"]]
    : [["diff", "--no-ext-diff", "--color=always", `${trunk}...HEAD`]];
  const cwd = row?.entry.path ?? context.root;
  const results = await Promise.all(
    reads.map((args) => context.runtime.git(args, cwd)),
  );
  const failed = results.findIndex((result) => !result.success);
  const command = commandEvidence(["git", ...(reads[0] ?? [])]);
  if (failed >= 0) {
    return {
      command,
      ok: false,
      message: {
        tone: "warning",
        text: `${commandEvidence(["git", ...(reads[failed] ?? [])])} failed: ${
          results[failed]?.stderr.trim() || "Git returned no diagnostic."
        }`,
      },
    };
  }
  const quiet = row === undefined
    ? ["No local changes.", "No tracked diff."]
    : [`No changes against ${trunk}.`];
  const page = results.map((result, index) =>
    result.stdout.trimEnd() || (quiet[index] ?? "")
  ).join("\n\n");
  const paged = await context.runtime.pager(page);
  return paged.shown
    ? {
      command,
      ok: true,
      back: { label: "the pager", ...(taskId === undefined ? {} : { taskId }) },
    }
    : {
      command,
      ok: false,
      message: {
        tone: "warning",
        text: "The pager could not open. Set $PAGER to a working command.",
      },
    };
}

/** Run one child to completion with the terminal. */
export async function runChild(
  context: DeskFlowContext,
  out: Out,
  child: DeskChild,
): Promise<DeskOutcome> {
  switch (child.kind) {
    case "agent":
      return await runAgent(context, out, child.taskId, child.launch);
    case "shell":
      return await runShell(context, out, child.taskId);
    case "editor":
      return await runEditor(context, out, child.taskId);
    case "diff":
      return await runDiff(context, child.taskId);
  }
}

/** The agent launch a stored brief must be copied into, reviewed first. */
const BRIEF_FLOW: DeskFlow = {
  review: (context, step) => {
    const row = stepRow(context, step);
    const launchId = step.values?.launch ?? "";
    const launch = row.agentLaunches.find((candidate) =>
      candidate.id === launchId
    );
    const provider = launch?.providerLabel ?? "The agent";
    const open = `Open ${provider}`;
    return Promise.resolve(
      reviewFor(actionTarget(context, row, offerFor(row, "agent")), {
        question: `${open} in ${row.task.name}?`,
        lead: [{
          mark: "warning",
          text:
            `${provider}'s configured command takes no prompt, so copy this brief into the session:`,
          detail: (row.entry.task?.brief ?? "").split("\n"),
          source: { kind: "status", field: "task" },
        }],
        core: { kind: "brief", launch: launchId },
        argv: launch === undefined ? ["<agent>"] : [
          launch.binary,
          ...launch.args,
        ],
        safeLabel: "Back",
        confirmLabel: open,
        footnote: untilChosen("opens", open),
        running:
          `Opening ${provider} in ${row.task.name} · exit it to come back`,
      }),
    );
  },
  apply: (context, step, expected, { out }) => {
    const launch = expected.core?.kind === "brief" ? expected.core.launch : "";
    return runAgent(
      context,
      out,
      step.kind === "action" ? step.taskId : "",
      launch,
    );
  },
};

/**
 * Run one Project Script with its reviewed literal arguments, with the
 * terminal. A script whose contents changed since its review runs nothing.
 */
async function runScript(
  context: DeskFlowContext,
  out: Out,
  owner: DeskScriptOwner,
  name: string,
  args: readonly string[],
  digest: string | undefined,
): Promise<DeskOutcome> {
  const row = owner.kind === "task"
    ? await childTask(context, owner.taskId, "inspect")
    : undefined;
  const directory = row?.entry.path ?? context.root;
  const inventory = row === undefined
    ? await scriptInventory(context, context.root)
    : { directory, scripts: row.scripts };
  const script = inventory.scripts.find((candidate) => candidate.name === name);
  if (script === undefined || script.availability === "disabled") {
    throw new WorktreeGitError(
      script?.reason ?? `${name} is no longer available.`,
    );
  }
  const command = commandEvidence(["discern", "scripts", name, ...args]);
  if (
    script.path !== undefined && digest !== undefined &&
    await context.runtime.fileDigest(script.path) !== digest
  ) {
    return {
      command,
      ok: false,
      message: {
        tone: "warning",
        text: `${name} changed since you reviewed it; nothing ran`,
      },
    };
  }
  echoDeskCommand(
    out,
    `${command}  (in ${row?.task.name ?? basename(context.root)})`,
  );
  const code = await context.runtime.runScript(
    directory,
    name,
    args,
    deskSessionEnv(),
    script.path,
  );
  await reportExit(context, out, `Project Script ${name}`, code);
  return {
    command,
    ok: code === 0,
    back: {
      label: name,
      ...(owner.kind === "task" ? { taskId: owner.taskId } : {}),
    },
  };
}

/** Check for updates: the disclosure, then the release page in the browser. */
const UPDATES_FLOW: DeskFlow = {
  review: (context) =>
    Promise.resolve(reviewFor({
      kind: "command",
      command: "updates",
      facts: {
        version: DISCERN_VERSION,
        trunk: context.config.repository.trunk,
        ...(context.state.data === undefined
          ? {}
          : { data: context.state.data }),
      },
    }, {
      bound: { "running-version": DISCERN_VERSION },
      footnote: untilChosen("opens", OPEN),
      running: "Opening the release page in your browser",
    })),
  apply: async (context): Promise<DeskOutcome> => {
    const command = commandEvidence(
      DESK_COMMAND_REGISTRY.updates.command().argv,
    );
    const result = await executeDeskOperation(
      context.root,
      { command: "releases" },
      () =>
        releasesResult(context.root, {
          mode: "desk",
          stdinTty: true,
          stdoutTty: true,
          dryRun: false,
        }, {
          now: context.runtime.now,
          open: async (url) => await context.runtime.openBrowser(url),
        }),
    );
    if (!result.ok) {
      const title = "The release page didn't open";
      return {
        command,
        ok: false,
        message: { tone: "danger", text: title },
        result: failureSheet(title, result.message ?? title, command),
      };
    }
    if (result.data?.launch_succeeded === true) {
      return {
        command,
        ok: true,
        message: { tone: "success", text: "Opened the release page" },
      };
    }
    // The browser could not open: the sheet carries the page's address.
    const title = "Your browser didn't open";
    return {
      command,
      ok: true,
      message: {
        tone: "warning",
        text: "Your browser didn't open; the release page's address follows",
      },
      result: {
        title,
        tone: "warning",
        lines: [
          {
            mark: "failure",
            text: result.data?.launch_message ?? title,
            source: { kind: "result", field: "data.launch_message" },
          },
          {
            mark: "changes",
            text: "Open the release page yourself:",
            ...(result.data === undefined
              ? {}
              : { detail: [result.data.urls.html] }),
            source: { kind: "result", field: "data.urls.html" },
          },
        ],
        command,
      },
    };
  },
};

/** Where a script runs, as its review names it. */
function scriptPlace(context: DeskFlowContext, step: DeskFlowStep): {
  readonly owner: DeskScriptOwner;
  readonly row?: DeskRow;
  readonly where: string;
} {
  if (step.kind === "action") {
    const row = stepRow(context, step);
    return {
      owner: { kind: "task", taskId: step.taskId },
      row,
      where: row.task.name,
    };
  }
  return { owner: { kind: "main" }, where: "the main checkout" };
}

/**
 * A Project Script's review: its literal arguments, where it runs, and the
 * script it runs, bound to that script's path and contents.
 */
const SCRIPTS_FLOW: DeskFlow = {
  review: async (context, step) => {
    const name = step.values?.script ?? "";
    const parsed = parseProjectScriptArguments(step.values?.args ?? "");
    const { owner, row, where } = scriptPlace(context, step);
    const inventory = row === undefined
      ? await scriptInventory(context, context.root)
      : { directory: row.entry.path, scripts: row.scripts };
    const script = inventory.scripts.find((candidate) =>
      candidate.name === name
    );
    const args = parsed.ok ? parsed.args : [];
    const argv = ["discern", "scripts", name, ...args];
    const read = {
      question: `Run ${name} in ${where}?`,
      facts: { script: { argv, where } },
      argv,
      core: { kind: "script" as const, owner, name, args },
      bound: {
        "script-path": script?.path ?? name,
        "script-digest": script?.path === undefined
          ? "unknown"
          : await context.runtime.fileDigest(script.path),
        argv: commandEvidence(argv),
        "main-path": context.root,
      },
      blockers: [
        ...(parsed.ok ? [] : [parsed.message]),
        ...(script === undefined || script.availability === "disabled"
          ? [script?.reason ?? `${name} is no longer available.`]
          : []),
      ],
      confirmLabel: RUN,
      footnote: untilChosen("runs", RUN),
      running:
        `Running ${name} in ${where} · it owns the terminal until it exits`,
    };
    return row === undefined
      ? reviewFor({
        kind: "command",
        command: "main_scripts",
        facts: {
          version: DISCERN_VERSION,
          trunk: context.config.repository.trunk,
        },
      }, read)
      : reviewFor(actionTarget(context, row, offerFor(row, "scripts")), read);
  },
  apply: async (context, step, expected, { out }) => {
    if (step.kind === "action") {
      const changed = await rebound(context, step, expected, "scripts");
      if (changed !== undefined) return changed;
    }
    if (expected.core?.kind !== "script") {
      throw new TypeError("A script runs only its reviewed arguments.");
    }
    const { owner, name, args } = expected.core;
    const digest = expected.facts["script-digest"];
    return await runScript(context, out, owner, name, args, digest);
  },
};

/** The children family's reviewed flows, by registry action or command. */
export const CHILDREN_FLOWS = {
  agent: BRIEF_FLOW,
  scripts: SCRIPTS_FLOW,
  main_scripts: SCRIPTS_FLOW,
  updates: UPDATES_FLOW,
} as const satisfies Readonly<Record<string, DeskFlow>>;
