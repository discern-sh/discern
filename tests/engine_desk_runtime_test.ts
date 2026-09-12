/**
 * Behavioral coverage for the desk's interactive renderer and dispatcher.
 *
 * A piped test process must never impersonate a TTY, so the production desk
 * exposes its terminal/effect boundary as a runtime. These tests script that
 * boundary and exercise the same session loop the CLI uses: fleet rendering,
 * refresh, inspect, jump, update, acceptance, destructive drop, and lifecycle
 * refusals. No test mutates a real worktree.
 *
 * Guards: boundary:agent-runtime-boundary, boundary:invoked-process-lifecycle
 */

import { fixtureEffortGrant } from "./effort_grant_fixtures.ts";
import { assert, assertEquals, assertStringIncludes } from "@std/assert";
import { DISCERN_DOCS_URL, DISCERN_WORDMARK } from "../src/shared/brand.ts";
import {
  configSchema,
  type DiscernConfig,
} from "../src/shared/config_schema.ts";
import type {
  StartData,
  StatusData,
  StatusFleetEntry,
} from "../src/shared/result_schemas.ts";
import { Logger } from "../src/lib/log.ts";
import {
  type ConfirmationRequestOptions,
  InteractionCancelled,
  isSelectionHeading,
  type SelectionEntry,
  type SelectionRequestOptions,
  type SequentialFormRequestOptions,
  type SequentialInteractionRequests,
  type TextRequestOptions,
} from "../src/lib/terminal_interaction.ts";
import { makeOut, type Out } from "../src/engine/output.ts";
import {
  resolveTerminalContext,
  type TerminalContext,
} from "../src/lib/terminal.ts";
import {
  type DeskRuntime,
  runDesk,
  runDeskInteractiveChild,
  runDeskProjectScript,
} from "../src/engine/desk/desk.ts";
import { parseProjectScriptArguments } from "../src/engine/desk/literal_argv.ts";
import {
  DESK_REVIEW_ROUTES,
  DESK_ROUTES,
  deskUnlandedRoute,
} from "../src/engine/desk/view.ts";
import { DESK_ACTIONS, type DeskAction } from "../src/engine/desk/model.ts";
import {
  DESK_SESSION_ENV,
  deskSessionEnv,
} from "../src/engine/desk/session.ts";
import {
  IdentityError,
  type LifecycleContext,
  type PreparedStart,
  WorktreeGitError,
} from "../src/engine/worktree/lifecycle.ts";
import {
  freshTipSeenState,
  type TipSeenState,
} from "../src/engine/desk/tips.ts";
import { renderTipCli, TIPS } from "../src/shared/tips.ts";
import { DISCERN_VERSION } from "../src/lib/version.ts";
import { displayWidth, stripAnsi } from "../src/lib/text.ts";
import { assertTerminalTextIncludes, fakeEnv, withTempDir } from "./helpers.ts";
import { scaffoldEngine, writeExecutable } from "./engine_helpers.ts";
import { TEST_CLI_MODEL } from "./cli_model.ts";

const ROOT = "/project";
const QUIT = "\x00quit";
const REFRESH = "\x00refresh";
const BACK = "\x00back";
const START_TASK = "\x00start-task";
const RUN_PROJECT_SCRIPT = "\x00run-project-script";
const READ_DOCS = "\x00read-docs";
const NOW = Date.parse("2026-07-11T12:00:00Z");

const CONFIG: DiscernConfig = configSchema.parse({
  project: { slug: "demo" },
  repository: { trunk: "main" },
});

interface Transcript {
  out: Out;
  stdout: string[];
  stderr: string[];
}

/** Capture desk narration in ordered stdout and stderr arrays without a terminal. */
function transcript(
  terminal: TerminalContext = makeOut(false).terminal,
): Transcript {
  const stdout: string[] = [];
  const stderr: string[] = [];
  return {
    stdout,
    stderr,
    out: {
      color: terminal.color,
      terminal,
      info: (message) => stdout.push(`info:${message}`),
      ok: (message) => stdout.push(`ok:${message}`),
      warn: (message) => stderr.push(`warn:${message}`),
      error: (message) => stderr.push(`error:${message}`),
      errorBlock: (message) => stderr.push(`error:${message}`),
      heading: (message) => stdout.push(`heading:${message}`),
      group: () => stdout.push(""),
      raw: (message) => stdout.push(message),
    },
  };
}

/** Build a clean fleet row while letting each runtime case override only relevant status facts. */
function fleetEntry(
  branch: string,
  path: string,
  patch: Partial<StatusFleetEntry> = {},
): StatusFleetEntry {
  return {
    path,
    is_main: false,
    is_current: false,
    branch,
    branch_reachable: true,
    filesystem: { state: "directory" },
    setup: { state: "ready", marker: "present" },
    clean: true,
    changed_files: 0,
    ahead: 0,
    behind: 0,
    last_activity: "2026-07-11T11:00:00Z",
    ...patch,
  };
}

/** Build a minimal status survey for a chosen location and fleet. */
function statusData(
  fleet: StatusFleetEntry[] = [],
  location: StatusData["location"] = "main",
): StatusData {
  return {
    location,
    root: ROOT,
    project: "demo",
    worktree: null,
    git: null,
    standards: [],
    fleet,
  };
}

const CONTEXT: LifecycleContext = {
  root: ROOT,
  cwd: ROOT,
  config: CONFIG,
  log: new Logger({ json: true, noColor: true }),
};

const START_COMMIT = "a".repeat(40);

/** Build one retained start preview for the scripted Desk boundary. */
function preparedStart(
  title = "New task",
  patch: Partial<PreparedStart["plan"]> = {},
): PreparedStart {
  const plan = {
    id: "new-task",
    branch: "agent/new-task",
    worktreePath: "/worktrees/new-task",
    from: "main",
    fromCommit: START_COMMIT,
    trunk: "main",
    title,
    resources: [],
    ...patch,
  };
  return {
    plan,
    taskMetadata: {
      schema_version: 1,
      title: plan.title,
      ...(plan.brief === undefined ? {} : { brief: plan.brief }),
      created_from: { ref: plan.from, commit: plan.fromCommit },
    },
    reproduceCmd: "discern start",
  };
}

/** Project a scripted retained start into the public start payload. */
function startedTask(prepared: PreparedStart): StartData {
  const { plan } = prepared;
  return {
    id: plan.id,
    branch: plan.branch,
    path: plan.worktreePath,
    from: plan.from,
    task: {
      id: plan.id,
      branch: plan.branch,
      title: plan.title,
      title_source: "recorded",
      ...(plan.brief === undefined ? {} : { brief: plan.brief }),
      created_from: { ref: plan.from, commit: plan.fromCommit },
    },
    ...(plan.note === undefined ? {} : { name_note: plan.note }),
  };
}

/** Return the status row created by a scripted start result. */
function startedFleetEntry(started: StartData): StatusFleetEntry {
  return fleetEntry(started.branch, started.path, {
    id: started.id,
    task: started.task,
  });
}

interface ScriptedSelectionValue<T> {
  readonly token: string;
  readonly value: T;
}

/** Recover one typed form value from the string-only Desk script seam. */
function scriptedSelectionValue<T>(
  choices: readonly ScriptedSelectionValue<T>[],
  token: string,
): T {
  const choice = choices.find((candidate) => candidate.token === token);
  if (choice === undefined) {
    throw new Error(`Scripted selection returned unknown token ${token}.`);
  }
  return choice.value;
}

/** Adapt one generic form request to the Desk test runtime without a cast. */
async function scriptedSequentialSelection<T>(
  request: SelectionRequestOptions<T>,
  select: DeskRuntime["select"],
): Promise<T> {
  const choices: ScriptedSelectionValue<T>[] = [];
  const options: SelectionEntry<string>[] = request.options.map(
    (entry, index) => {
      if (isSelectionHeading(entry)) return entry;
      const token = typeof entry.value === "string"
        ? entry.value
        : entry.id ?? `scripted-choice-${index}`;
      choices.push({ token, value: entry.value });
      return { ...entry, value: token };
    },
  );
  const defaultToken = request.default === undefined
    ? undefined
    : choices.find((choice) => Object.is(choice.value, request.default))?.token;
  const validate = request.validate;
  const selected = await select({
    message: request.message,
    options,
    ...(defaultToken === undefined ? {} : { default: defaultToken }),
    ...(request.hint === undefined ? {} : { hint: request.hint }),
    ...(request.required === undefined ? {} : { required: request.required }),
    ...(request.completion === undefined
      ? {}
      : { completion: request.completion }),
    ...(request.presentation === undefined
      ? {}
      : { presentation: request.presentation }),
    ...(validate === undefined ? {} : {
      validate: (token: string) =>
        validate(scriptedSelectionValue(choices, token)),
    }),
    ...(request.search === undefined ? {} : { search: request.search }),
    ...(request.searchLabel === undefined
      ? {}
      : { searchLabel: request.searchLabel }),
    ...(request.maxRows === undefined ? {} : { maxRows: request.maxRows }),
    ...(request.reservedRows === undefined
      ? {}
      : { reservedRows: request.reservedRows }),
  });
  return scriptedSelectionValue(choices, selected);
}

/** Provide deterministic desk dependencies whose behavior can be selectively overridden. */
function scriptedRuntime(
  output: Transcript,
  patch: Partial<DeskRuntime> = {},
): DeskRuntime {
  const main = fleetEntry("main", ROOT, {
    is_main: true,
    is_current: true,
  });
  const data = statusData([main]);
  const select = patch.select ?? (() => QUIT);
  const confirm = patch.confirm ?? (() => true);
  const input = patch.input ?? (() => "");
  const sequence = async (
    options: SequentialFormRequestOptions,
  ): Promise<Record<string, unknown>> => {
    const values: Record<string, unknown> = {};
    const requests: SequentialInteractionRequests = {
      select: async <T>(request: SelectionRequestOptions<T>): Promise<T> =>
        await scriptedSequentialSelection(request, select),
      text: async (request: TextRequestOptions): Promise<string> =>
        await input(request),
      confirm: async (
        message: string,
        request: ConfirmationRequestOptions,
      ): Promise<boolean> => await confirm(message, request),
    };
    for (const step of options.steps) {
      if (step.when?.(values) === false) {
        delete values[step.id];
        continue;
      }
      values[step.id] = await step.run(
        values,
        values[step.id],
        requests,
      );
    }
    return values;
  };
  return {
    canInteract: () => true,
    inDeskSession: () => false,
    findRoot: () => ROOT,
    loadConfig: () => CONFIG,
    status: () => ({ ok: true, data }),
    mainRepoPath: () => ROOT,
    grantEffortPlan: () => ({
      title: "Landing pre-authorization plan",
      details: [],
      steps: [],
    }),
    grantEffort: (_path, branch) => ({
      status: "granted",
      grant: fixtureEffortGrant(branch),
    }),
    clearEffortGrantPlan: () => ({
      title: "Landing pre-authorization revocation plan",
      details: [],
      steps: [],
    }),
    clearEffortGrant: () => true,
    makeOut: () => output.out,
    error: (message) => output.stderr.push(`console:${message}`),
    select,
    confirm,
    input,
    sequence,
    pause: () => {},
    lifecycle: () => CONTEXT,
    done: () => ({ ok: true, verb: "done" }),
    donePlan: () => ({ ok: true, verb: "done" }),
    acceptPlan: () => ({ ok: true, verb: "accept" }),
    accept: () => {},
    update: () => {},
    updatePlan: () => ({ ok: true, verb: "update" }),
    setup: () => {},
    setupPlan: () => ({ title: "Setup plan", details: [], steps: [] }),
    drop: () => {},
    dropPlan: () => ({ title: "Drop plan", details: [], steps: [] }),
    park: () => {},
    parkPlan: () => ({ title: "Park plan", details: [], steps: [] }),
    reclaim: () => {},
    reclaimPlan: () => ({ title: "Reclaim plan", details: [], steps: [] }),
    git: () => ({ success: true, stdout: "", stderr: "" }),
    proof: () => ({ status: "missing" }),
    pager: () => ({ shown: true }),
    editor: () => ({ reason: "No editor configured." }),
    openEditor: () => 0,
    interactive: () => 0,
    detectAgents: () => [],
    startPlan: (_ctx, opts) =>
      preparedStart(opts.title ?? "Random codename", {
        ...(opts.brief === undefined ? {} : { brief: opts.brief }),
        ...(opts.from === undefined ? {} : { from: opts.from }),
      }),
    start: (_ctx, prepared) => startedTask(prepared),
    renamePlan: (_ctx, title) => ({
      ok: true,
      verb: "worktree rename",
      dry_run: true,
      plan: { title: `Change title to ${title}`, details: [], steps: [] },
    }),
    rename: (_ctx, title) => ({
      ok: true,
      verb: "worktree rename",
      message: `Changed the task title to ${JSON.stringify(title)}.`,
    }),
    scripts: () => [],
    runScript: () => 0,
    openBrowser: (url) => ({
      status: "opened",
      launch: { command: "open", args: [url] },
    }),
    now: () => NOW,
    readTipState: () => freshTipSeenState(DISCERN_VERSION),
    writeTipState: () => {},
    readPreferences: () => ({ schema_version: 1 }),
    writePreferences: () => ({ status: "saved" }),
    recordTipShown: () => {},
    size: () => ({ columns: 80, rows: 24 }),
    ...patch,
  };
}

/** Combine both captured desk streams for order-insensitive message assertions. */
function joined(output: Transcript): string {
  return [...output.stdout, ...output.stderr].join("\n");
}

/** The registered tip with `id`, or a failed assertion. */
function registeredTip(id: string): (typeof TIPS)[number] {
  const tip = TIPS.find((entry) => entry.id === id);
  assert(tip !== undefined, `the shipped registry must carry ${id}`);
  return tip;
}

/** Count overlapping candidate positions to prove a tip is narrated exactly once. */
function countOccurrences(haystack: string, needle: string): number {
  let count = 0;
  let index = haystack.indexOf(needle);
  while (index !== -1) {
    count += 1;
    index = haystack.indexOf(needle, index + needle.length);
  }
  return count;
}

Deno.test("desk-owned terminal children receive the desk-session marker", async () => {
  assertEquals(
    await runDeskInteractiveChild(
      "sh",
      ["-c", `test "$${DESK_SESSION_ENV}" = "1"`],
      Deno.cwd(),
      deskSessionEnv(),
    ),
    0,
  );
});

Deno.test("desk-owned Project Scripts receive no private desk-session marker", async () => {
  await withTempDir(async (dir) => {
    await scaffoldEngine(dir);
    await writeExecutable(
      `${dir}/discern/scripts/record-desk-session`,
      [
        "#!/usr/bin/env sh",
        `printf '%s' "$${DESK_SESSION_ENV}" > desk-session.txt`,
        "",
      ].join("\n"),
    );

    assertEquals(
      await runDeskProjectScript(
        dir,
        "record-desk-session",
        [],
        deskSessionEnv(),
      ),
      0,
    );
    assertEquals(await Deno.readTextFile(`${dir}/desk-session.txt`), "");
  });
});

Deno.test("Desk Project Script arguments are literal argv, not shell syntax", () => {
  assertEquals(parseProjectScriptArguments(""), { ok: true, args: [] });
  assertEquals(
    parseProjectScriptArguments(
      `--target 'review environment' "" '--literal=$HOME' 'a;b'`,
    ),
    {
      ok: true,
      args: [
        "--target",
        "review environment",
        "",
        "--literal=$HOME",
        "a;b",
      ],
    },
  );
  assertEquals(parseProjectScriptArguments("'unfinished"), {
    ok: false,
    message: "The argument line has an unclosed single quote.",
  });
  assertEquals(parseProjectScriptArguments("unfinished\\"), {
    ok: false,
    message: "The argument line ends with an incomplete escape.",
  });
});

Deno.test("a desk-owned child refuses a nested desk before surveying the fleet", async () => {
  const output = transcript();
  let surveyed = false;
  assertEquals(
    await runDesk(
      {},
      scriptedRuntime(output, {
        inDeskSession: () => true,
        status: () => {
          surveyed = true;
          return { ok: true, data: statusData([], "worktree") };
        },
      }),
    ),
    1,
  );
  assertEquals(surveyed, false);
  assertStringIncludes(joined(output), "already active");
  assertStringIncludes(joined(output), "exit");
  assert(!joined(output).includes("cd /"));
});

Deno.test("desk session renders task-first fleet rows from the survey's own proof facts", async () => {
  const output = transcript();
  const main = fleetEntry("main", ROOT, {
    is_main: true,
    is_current: true,
    clean: false,
    changed_files: 1,
  });
  const ready = fleetEntry(
    "agent/ready-to-land-a1b2c3",
    "/worktrees/ready-to-land-a1b2c3",
    { id: "ready-to-land-a1b2c3", ahead: 2, proof_honored: true },
  );
  const flying = fleetEntry("agent/flying-c4d5e6", "/worktrees/flying-c4d5e6", {
    id: "flying-c4d5e6",
    clean: false,
    changed_files: 3,
  });
  const broken = fleetEntry("agent/broken-123abc", "/worktrees/broken-123abc", {
    id: "broken-123abc",
    broken: true,
  });
  const unreadable = fleetEntry(
    "agent/unreadable-456def",
    "/worktrees/unreadable-456def",
    {
      id: "unreadable-456def",
      clean: undefined,
      changed_files: undefined,
      git_unavailable: true,
    },
  );
  const data = {
    ...statusData([main, ready, flying, broken, unreadable]),
    unlanded_branches: ["agent/orphan"],
  };
  const optionText: string[] = [];
  const runtime = scriptedRuntime(output, {
    status: () => ({ ok: true, data }),
    select: (options) => {
      assertEquals(options.search, false);
      assertStringIncludes(String(options.hint), "arrow keys");
      optionText.push(JSON.stringify(options.options));
      return QUIT;
    },
  });

  assertEquals(await runDesk({}, runtime), 0);
  const text = joined(output);
  assertStringIncludes(text, `${DISCERN_WORDMARK} · demo`);
  assertStringIncludes(text, "4 tasks");
  assertStringIncludes(text, "main has 1 uncommitted change");
  assertStringIncludes(text, "1 branch has no worktree: agent/orphan");
  assertStringIncludes(text, "Refreshed just now");
  assertStringIncludes(text, "Tip:");
  const options = optionText.join("\n");
  for (const task of ["Ready to land", "Flying", "Broken", "Unreadable"]) {
    assertStringIncludes(options, task);
  }
  for (
    const branch of [
      ready.branch,
      flying.branch,
      broken.branch,
      unreadable.branch,
    ]
  ) {
    assert(
      !options.includes(branch),
      "live fleet rows should lead with task names",
    );
  }
  assertStringIncludes(options, "Work without a worktree");
  assertStringIncludes(options, "agent/orphan");
  assert(
    !options.includes("Ready to land  a1b2c3"),
    "a unique task name should not display its id tail",
  );
  for (
    const section of [
      '"kind":"group-heading","id":"tasks-needs_attention","name":"Needs attention · 2"',
      '"kind":"group-heading","id":"tasks-ready_to_review","name":"Ready to review · 1"',
      '"kind":"group-heading","id":"tasks-paused","name":"Paused · 1"',
      '"kind":"group-heading","id":"desk-commands","name":"Desk commands"',
      '"kind":"group-heading","id":"session-commands","name":"Session"',
    ]
  ) {
    assertStringIncludes(options, section);
  }
});

Deno.test("desk reports removed worktree paths that are present again", async () => {
  const output = transcript();
  const main = fleetEntry("main", ROOT, {
    is_main: true,
    is_current: true,
  });
  const data = {
    ...statusData([main]),
    reappeared_worktree_paths: [{
      path: "/worktrees/apollo-11",
      removed_at: "2026-08-08T11:00:00.000Z",
      kind: "directory" as const,
      contents: ["observer-state/checkpoint.bin"],
      contents_truncated: false,
      entries: 2,
    }],
  };
  const runtime = scriptedRuntime(output, {
    status: () => ({ ok: true, data }),
    select: () => QUIT,
  });

  assertEquals(await runDesk({}, runtime), 0);
  const text = joined(output);
  assertStringIncludes(text, "1 removed worktree path is present again");
  assertStringIncludes(
    text,
    "Review with discern worktree prune --dry-run.",
  );
});

Deno.test("dirty main is inspectable without offering agent work", async () => {
  const output = transcript();
  const main = fleetEntry("main", ROOT, {
    is_main: true,
    is_current: true,
    clean: false,
    changed_files: 2,
  });
  const data = statusData([main]);
  const choices = [DESK_ROUTES.mainCheckout, "inspect", BACK, QUIT];
  const commands: string[][] = [];
  const pages: string[] = [];
  const menus: string[] = [];
  const runtime = scriptedRuntime(output, {
    status: () => ({ ok: true, data }),
    select: (options) => {
      menus.push(JSON.stringify(options.options));
      return choices.shift() ?? QUIT;
    },
    git: (args) => {
      commands.push([...args]);
      return {
        success: true,
        stdout: args[0] === "status"
          ? "## main\n M src/main.ts\n?? notes.txt\n"
          : " src/main.ts | 2 +-\n",
        stderr: "",
      };
    },
    pager: (page) => {
      pages.push(page);
      return { shown: true };
    },
  });

  assertEquals(await runDesk({}, runtime), 0);
  assertEquals(commands, [
    ["status", "--short", "--branch"],
    ["diff", "--stat", "HEAD"],
  ]);
  assertStringIncludes(menus[0] ?? "", "Inspect main checkout");
  assertStringIncludes(menus[1] ?? "", "Inspect status and diff");
  assert(!menus[1]?.includes('"value":"agent"'), menus[1]);
  assertStringIncludes(pages[0] ?? "", "Command: git status --short --branch");
  assertStringIncludes(pages[0] ?? "", "src/main.ts");
  assertStringIncludes(
    joined(output).replaceAll(/\s+/gu, " "),
    "agent work remains in linked",
  );
  assertStringIncludes(joined(output), "worktrees.");
});

Deno.test("recent completed tasks expose bounded local landing evidence", async () => {
  const output = transcript();
  const main = fleetEntry("main", ROOT, {
    is_main: true,
    is_current: true,
  });
  const data: StatusData = {
    ...statusData([main]),
    recent_completed_tasks: [{
      branch: "agent/completed",
      head: "abc1234",
      completed_at: "2026-07-11T11:58:00.000Z",
      proof_line: "Proof: agent/completed abc1234 · gate passed",
    }],
  };
  const choices = [DESK_ROUTES.recentCompleted, QUIT];
  const menus: string[] = [];
  let pauses = 0;
  const runtime = scriptedRuntime(output, {
    status: () => ({ ok: true, data }),
    select: (options) => {
      menus.push(JSON.stringify(options.options));
      return choices.shift() ?? QUIT;
    },
    pause: () => {
      pauses++;
    },
  });

  assertEquals(await runDesk({}, runtime), 0);
  assertEquals(pauses, 1);
  assertStringIncludes(menus[0] ?? "", "Recent completed tasks · 1");
  assertStringIncludes(joined(output), "agent/completed");
  assertStringIncludes(
    joined(output),
    "Proof: agent/completed abc1234",
  );
  assertStringIncludes(joined(output), "gate passed");
});

Deno.test("desk grants and revokes one effort only through its human action", async () => {
  const output = transcript();
  const effort = fleetEntry("agent/overnight", "/worktrees/overnight", {
    ahead: 2,
  });
  const data = statusData([
    fleetEntry("main", ROOT, { is_main: true, is_current: true }),
    effort,
  ]);
  const choices = [
    effort.path,
    "grant",
    "revoke_grant",
    BACK,
    QUIT,
  ];
  const menus: string[] = [];
  const confirmations: Array<{
    message: string;
    options: ConfirmationRequestOptions;
  }> = [];
  const grants: Array<{ path: string; branch: string }> = [];
  const revokes: string[] = [];
  const grantPlans: Array<{ path: string; branch: string }> = [];
  const revokePlans: string[] = [];
  let granted = false;
  let pauses = 0;
  const runtime = scriptedRuntime(output, {
    status: () => {
      if (granted) {
        effort.landing_authority = {
          kind: "authorized",
          source: "effort-grant",
        };
      } else {
        delete effort.landing_authority;
      }
      return { ok: true, data };
    },
    select: (options) => {
      menus.push(JSON.stringify(options.options));
      return choices.shift() ?? QUIT;
    },
    confirm: (message, options) => {
      confirmations.push({ message, options });
      return true;
    },
    grantEffortPlan: (path, branch) => {
      grantPlans.push({ path, branch });
      return {
        title: "Landing pre-authorization plan",
        details: [],
        steps: [],
      };
    },
    grantEffort: (path, branch) => {
      grants.push({ path, branch });
      granted = true;
      return {
        status: "granted",
        grant: fixtureEffortGrant(branch),
      };
    },
    clearEffortGrantPlan: (path) => {
      revokePlans.push(path);
      return {
        title: "Landing pre-authorization revocation plan",
        details: [],
        steps: [],
      };
    },
    clearEffortGrant: (path) => {
      revokes.push(path);
      granted = false;
      return true;
    },
    pause: () => {
      pauses++;
    },
  });

  assertEquals(await runDesk({}, runtime), 0);
  assertEquals(grants, [{ path: effort.path, branch: effort.branch }]);
  assertEquals(revokes, [effort.path]);
  assertEquals(grantPlans, [{ path: effort.path, branch: effort.branch }]);
  assertEquals(revokePlans, [effort.path]);
  assertEquals(pauses, 2);
  assertEquals(confirmations, [
    {
      message:
        `Allow ${effort.branch} to land once green without a further conversation?`,
      options: { defaultTo: false, noLabel: "Keep", yesLabel: "Allow" },
    },
    {
      message: `Revoke landing pre-authorization for ${effort.branch}?`,
      options: { defaultTo: false, noLabel: "Keep", yesLabel: "Revoke" },
    },
  ]);
  assertStringIncludes(
    menus.join("\n"),
    "Pre-authorize landing once green",
  );
  assertStringIncludes(
    menus.join("\n"),
    "Revoke landing pre-authorization",
  );
  assertStringIncludes(
    joined(output),
    `${effort.branch} lands once green without a further conversation. A variance, a standard proposal, or an emergency still needs you.`,
  );
  assertStringIncludes(
    joined(output),
    `Landing pre-authorization revoked for ${effort.branch}.`,
  );
  assert(
    !joined(output).includes("discern grant"),
    "the human-only grant must not imply an agent-run command",
  );
});

Deno.test("desk keeps landing pre-authorization selectable during final checks", async () => {
  const output = transcript();
  const effort = fleetEntry("agent/running-gate", "/worktrees/running-gate", {
    ahead: 2,
    gate_proof: { status: "honored" },
    running: {
      verb: "done",
      started: "2026-07-11T11:59:00.000Z",
      elapsed_ms: 60_000,
      typical_duration_ms: 60_000,
    },
  });
  const data = statusData([
    fleetEntry("main", ROOT, { is_main: true, is_current: true }),
    effort,
  ]);
  const choices = [effort.path, BACK, QUIT];
  let actionOptions: readonly SelectionEntry<string>[] | undefined;
  const runtime = scriptedRuntime(output, {
    status: () => ({ ok: true, data }),
    select: (options) => {
      if (options.message === "Choose an action") {
        actionOptions = options.options;
      }
      return choices.shift() ?? QUIT;
    },
  });

  assertEquals(await runDesk({}, runtime), 0);
  const options = actionOptions;
  assert(options !== undefined);
  const action = (value: string) =>
    options.find((entry) =>
      !isSelectionHeading(entry) && entry.value === value
    );
  const grant = action("grant");
  const rename = action("rename");
  assert(grant !== undefined && !isSelectionHeading(grant));
  assert(rename !== undefined && !isSelectionHeading(rename));
  assertEquals(grant.disabled, undefined);
  assertEquals(rename.disabled, true);
  assertEquals(
    rename.description,
    "discern done is running. It usually takes 1m.",
  );
});

Deno.test("desk adds filtering for a large fleet and disambiguates duplicate task names", async () => {
  const output = transcript();
  const main = fleetEntry("main", ROOT, {
    is_main: true,
    is_current: true,
  });
  const tasks = [
    fleetEntry("agent/same-task-a1b2c3", "/worktrees/same-task-a1b2c3", {
      id: "same-task-a1b2c3",
    }),
    fleetEntry("agent/same-task-d4e5f6", "/worktrees/same-task-d4e5f6", {
      id: "same-task-d4e5f6",
    }),
    ...Array.from({ length: 7 }, (_, index) => {
      const id = `task-${index}-a0000${index}`;
      return fleetEntry(`agent/${id}`, `/worktrees/${id}`, { id });
    }),
  ];
  let optionText = "";
  const runtime = scriptedRuntime(output, {
    status: () => ({ ok: true, data: statusData([main, ...tasks]) }),
    select: (options) => {
      assertEquals(options.search, true);
      assertEquals(options.searchLabel, "filter");
      assertStringIncludes(String(options.hint), "Type to filter");
      optionText = JSON.stringify(options.options);
      return QUIT;
    },
  });

  assertEquals(await runDesk({}, runtime), 0);
  assertStringIncludes(optionText, "Same task · a1b2c3");
  assertStringIncludes(optionText, "Same task · d4e5f6");
});

Deno.test("desk bootstrap and refresh failures remain actionable", async () => {
  const noProject = transcript();
  assertEquals(
    await runDesk(
      {},
      scriptedRuntime(noProject, {
        findRoot: () => undefined,
      }),
    ),
    1,
  );
  assertStringIncludes(
    joined(noProject),
    "Run the read-only `discern setup` welcome, then `discern setup begin`",
  );

  const failedSurvey = transcript();
  assertEquals(
    await runDesk(
      {},
      scriptedRuntime(failedSurvey, {
        status: () => ({
          ok: false,
          message: "survey failed — run status",
        }),
      }),
    ),
    1,
  );
  assertStringIncludes(joined(failedSurvey), "survey failed — run status");

  const worktree = transcript();
  assertEquals(
    await runDesk(
      {},
      scriptedRuntime(worktree, {
        status: () => ({ ok: true, data: statusData([], "worktree") }),
        mainRepoPath: () => "/main-checkout",
      }),
    ),
    0,
  );
  assertStringIncludes(joined(worktree), "cd /main-checkout");
  assertStringIncludes(joined(worktree), "discern status");

  const refreshFailure = transcript();
  let surveys = 0;
  assertEquals(
    await runDesk(
      {},
      scriptedRuntime(refreshFailure, {
        status: () => {
          surveys++;
          return surveys === 1
            ? { ok: true, data: statusData() }
            : { ok: false };
        },
        select: (options) => {
          assertStringIncludes(
            String(options.message),
            "Choose a desk command",
          );
          return REFRESH;
        },
      }),
    ),
    1,
  );
  assertStringIncludes(joined(refreshFailure), "the status survey failed");
});

Deno.test("desk Refresh replaces the root menu from a fresh fleet survey", async () => {
  const output = transcript();
  const main = fleetEntry("main", ROOT, {
    is_main: true,
    is_current: true,
  });
  const created = fleetEntry(
    "agent/newly-created-a1b2c3",
    "/worktrees/newly-created-a1b2c3",
    { id: "newly-created-a1b2c3" },
  );
  const menus: string[] = [];
  const choices = [REFRESH, QUIT];
  let surveys = 0;
  const runtime = scriptedRuntime(output, {
    status: () => {
      surveys++;
      return {
        ok: true,
        data: statusData(surveys === 1 ? [main] : [main, created]),
      };
    },
    select: (options) => {
      menus.push(JSON.stringify(options.options));
      return choices.shift() ?? QUIT;
    },
  });

  assertEquals(await runDesk({}, runtime), 0);
  assertEquals(surveys, 2);
  assertEquals(menus.length, 2);
  assert(!menus[0]?.includes("Newly created"));
  assertStringIncludes(menus[1] ?? "", "Newly created");
});

Deno.test("Park refreshes a removed checkout into its resumable branch", async () => {
  const output = transcript();
  const main = fleetEntry("main", ROOT, {
    is_main: true,
    is_current: true,
  });
  const effort = fleetEntry("agent/park-refresh", "/worktrees/park-refresh", {
    ahead: 1,
    task: {
      id: "park-refresh",
      branch: "agent/park-refresh",
      title: "Park refresh",
      title_source: "recorded",
    },
  });
  let parked = false;
  const choices = [effort.path, "park", BACK, QUIT];
  const runtime = scriptedRuntime(output, {
    status: () => ({
      ok: true,
      data: parked
        ? {
          ...statusData([main]),
          unlanded_branches: [effort.branch],
          parked_tasks: [{
            id: "park-refresh",
            branch: effort.branch,
            head: "a".repeat(40),
            parked_at: "2026-07-11T12:00:00.000Z",
            task: effort.task ?? {
              id: "park-refresh",
              branch: effort.branch,
              title: "Park refresh",
              title_source: "recorded",
            },
          }],
        }
        : statusData([main, effort]),
    }),
    select: () => choices.shift() ?? QUIT,
    park: () => {
      parked = true;
    },
  });

  assertEquals(await runDesk({}, runtime), 0);
  assertStringIncludes(
    joined(output),
    "Task changed; refreshed. Its branch is ready to resume.",
  );
  assertStringIncludes(joined(output), "Committed branch has no worktree");
  assertStringIncludes(joined(output), effort.branch);
});

Deno.test("a lifecycle refusal refreshes a task that landed outside the Desk", async () => {
  const output = transcript();
  const main = fleetEntry("main", ROOT, {
    is_main: true,
    is_current: true,
  });
  const effort = fleetEntry("agent/external-land", "/worktrees/external-land", {
    ahead: 1,
  });
  let landed = false;
  const choices = [effort.path, "park", QUIT];
  const runtime = scriptedRuntime(output, {
    status: () => ({
      ok: true,
      data: landed
        ? {
          ...statusData([main]),
          recent_completed_tasks: [{
            branch: effort.branch,
            head: "b".repeat(40),
            completed_at: "2026-07-11T12:00:00.000Z",
          }],
        }
        : statusData([main, effort]),
    }),
    select: () => choices.shift() ?? QUIT,
    park: () => {
      landed = true;
      throw new WorktreeGitError(
        "The selected task landed before Park could apply.",
      );
    },
  });

  assertEquals(await runDesk({}, runtime), 0);
  assertStringIncludes(
    joined(output),
    "The selected task landed before Park could apply.",
  );
  assertStringIncludes(
    joined(output),
    "Task landed; refreshed. Completion evidence is available.",
  );
});

Deno.test("a lifecycle refusal reports an externally removed task and refreshes", async () => {
  const output = transcript();
  const main = fleetEntry("main", ROOT, {
    is_main: true,
    is_current: true,
  });
  const effort = fleetEntry(
    "agent/external-remove",
    "/worktrees/external-remove",
    {
      ahead: 1,
    },
  );
  let removed = false;
  const choices = [effort.path, "park", QUIT];
  const runtime = scriptedRuntime(output, {
    status: () => ({
      ok: true,
      data: statusData(removed ? [main] : [main, effort]),
    }),
    select: () => choices.shift() ?? QUIT,
    park: () => {
      removed = true;
      throw new WorktreeGitError(
        "The selected task no longer has a registered checkout.",
      );
    },
  });

  assertEquals(await runDesk({}, runtime), 0);
  assertStringIncludes(
    joined(output),
    "The selected task no longer has a registered checkout.",
  );
  assertStringIncludes(joined(output), "Task changed; refreshed.");
});

Deno.test("desk starts a named task and focuses its ready worktree immediately", async () => {
  const output = transcript();
  const main = fleetEntry("main", ROOT, {
    is_main: true,
    is_current: true,
  });
  const startedEntry = fleetEntry(
    "agent/desk-launchers",
    "/worktrees/desk-launchers",
  );
  const prepared = preparedStart("  desk launchers  ", {
    id: "desk-launchers",
    branch: startedEntry.branch,
    worktreePath: startedEntry.path,
  });
  const started = startedTask(prepared);
  let hasStarted = false;
  const choices = [
    START_TASK,
    "describe",
    "compact",
    "none",
    BACK,
    QUIT,
  ];
  const menus: Array<{ message: string; options: string }> = [];
  const starts: Array<Parameters<DeskRuntime["startPlan"]>[1]> = [];
  const applied: PreparedStart[] = [];
  const runtime = scriptedRuntime(output, {
    status: () => ({
      ok: true,
      data: statusData(hasStarted ? [main, startedEntry] : [main]),
    }),
    select: (options) => {
      menus.push({
        message: String(options.message),
        options: JSON.stringify(options.options),
      });
      return choices.shift() ?? QUIT;
    },
    input: () => "  desk launchers  ",
    startPlan: (_ctx, opts) => {
      starts.push(opts);
      return prepared;
    },
    start: (_ctx, retained) => {
      applied.push(retained);
      hasStarted = true;
      return started;
    },
  });

  assertEquals(await runDesk({}, runtime), 0);
  assertEquals(starts, [{
    worktreeRoot: "/project.worktrees",
    title: "  desk launchers  ",
  }]);
  assertEquals(applied, [prepared]);
  assertStringIncludes(menus[0]?.options ?? "", "Start a task");
  assertStringIncludes(
    menus[0]?.message ?? "",
    "Choose a desk command",
  );
  assert(
    menus.some((menu) => menu.message === "Choose an action"),
    "the new worktree action menu should open without another root-menu choice",
  );
  assertStringIncludes(
    joined(output),
    "Run: discern start --title ' desk launchers '",
  );
});

Deno.test("desk uses a generated codename only after the explicit fallback", async () => {
  const output = transcript();
  const main = fleetEntry("main", ROOT, {
    is_main: true,
    is_current: true,
  });
  const random = fleetEntry(
    "agent/random-codename",
    "/worktrees/random-codename",
  );
  let hasStarted = false;
  const choices = [START_TASK, "codename", "compact", "none", BACK, QUIT];
  const starts: Array<Parameters<DeskRuntime["startPlan"]>[1]> = [];
  const prepared = preparedStart("Random codename", {
    id: "random-codename",
    branch: random.branch,
    worktreePath: random.path,
  });
  const runtime = scriptedRuntime(output, {
    status: () => ({
      ok: true,
      data: statusData(hasStarted ? [main, random] : [main]),
    }),
    select: () => choices.shift() ?? QUIT,
    startPlan: (_ctx, opts) => {
      starts.push(opts);
      return prepared;
    },
    start: () => {
      hasStarted = true;
      return startedTask(prepared);
    },
  });

  assertEquals(await runDesk({}, runtime), 0);
  assertEquals(starts, [{ worktreeRoot: "/project.worktrees" }]);
  assertStringIncludes(joined(output), "Run: discern start");
  assert(!joined(output).includes("--title"));
});

Deno.test("expanded creation retains trunk, live-task, and unlanded bases", async () => {
  const main = fleetEntry("main", ROOT, {
    is_main: true,
    is_current: true,
  });
  const live = fleetEntry("agent/existing-task", "/worktrees/existing-task", {
    id: "existing-task",
  });
  const orphan = "agent/unlanded-branch";
  const cases = [
    { name: "trunk", base: "main", expectedFrom: undefined },
    { name: "live task", base: live.branch, expectedFrom: live.branch },
    { name: "unlanded branch", base: orphan, expectedFrom: orphan },
  ] as const;

  for (const testCase of cases) {
    const output = transcript();
    const title = `Repair ingress from ${testCase.name} — 修复`;
    const brief = `Preserve the exact ${testCase.name} base and human wording.`;
    const inputs = [title, brief];
    const choices = [
      START_TASK,
      "describe",
      "expanded",
      testCase.base,
      "none",
      BACK,
      QUIT,
    ];
    const confirmations = [true];
    const requests: Array<Parameters<DeskRuntime["startPlan"]>[1]> = [];
    const grants: Array<{ path: string; branch: string }> = [];
    const saved: Array<Parameters<DeskRuntime["writePreferences"]>[1]> = [];
    let created: StartData | undefined;
    const runtime = scriptedRuntime(output, {
      status: () => ({
        ok: true,
        data: {
          ...statusData([
            main,
            live,
            ...(created === undefined ? [] : [startedFleetEntry(created)]),
          ]),
          unlanded_branches: [orphan],
        },
      }),
      select: () => choices.shift() ?? QUIT,
      input: () => inputs.shift() ?? "",
      confirm: () => confirmations.shift() ?? false,
      startPlan: (_ctx, request) => {
        requests.push(request);
        return preparedStart(request.title ?? "Generated title", {
          id: `created-from-${testCase.name.replaceAll(" ", "-")}`,
          branch: `agent/created-from-${testCase.name.replaceAll(" ", "-")}`,
          worktreePath: `/worktrees/created-from-${
            testCase.name.replaceAll(" ", "-")
          }`,
          from: request.from ?? "main",
          ...(request.brief === undefined ? {} : { brief: request.brief }),
          resources: [{ name: "database", identity: "demo_created_task" }],
        });
      },
      start: (_ctx, prepared) => {
        created = startedTask(prepared);
        return created;
      },
      grantEffort: (path, branch) => {
        grants.push({ path, branch });
        return {
          status: "granted",
          grant: fixtureEffortGrant(branch),
        };
      },
      writePreferences: (_root, preferences) => {
        saved.push(preferences);
        return { status: "saved" };
      },
    });

    assertEquals(await runDesk({}, runtime), 0, testCase.name);
    assertEquals(requests, [{
      worktreeRoot: "/project.worktrees",
      title,
      brief,
      ...(testCase.expectedFrom === undefined
        ? {}
        : { from: testCase.expectedFrom }),
    }], testCase.name);
    assertEquals(
      grants.length,
      0,
      testCase.name,
    );
    assertEquals(saved, [{
      schema_version: 1,
      creation_path: "expanded",
    }]);
    const text = joined(output).replaceAll(/\s+/gu, "");
    assertStringIncludes(text, title.replaceAll(/\s+/gu, ""));
    assertStringIncludes(text, brief.replaceAll(/\s+/gu, ""));
    assertStringIncludes(text, testCase.base.replaceAll(/\s+/gu, ""));
    assertStringIncludes(text, "demo_created_task");
    assertStringIncludes(text, "Noagentwillopen");
    assertStringIncludes(text, created?.path.replaceAll(/\s+/gu, "") ?? "");
  }
});

Deno.test("compact creation opens the remembered available agent", async () => {
  const output = transcript();
  const main = fleetEntry("main", ROOT, {
    is_main: true,
    is_current: true,
  });
  const config = configSchema.parse({
    project: { slug: "demo", agents: ["codex"] },
    repository: { trunk: "main" },
  });
  const choices = [START_TASK, "describe", "compact", BACK, QUIT];
  const menus: string[] = [];
  const saved: Array<Parameters<DeskRuntime["writePreferences"]>[1]> = [];
  const launches: Array<{
    command: string;
    args: readonly string[];
    cwd: string;
  }> = [];
  let created: StartData | undefined;
  const runtime = scriptedRuntime(output, {
    loadConfig: () => config,
    status: () => ({
      ok: true,
      data: statusData([
        main,
        ...(created === undefined ? [] : [startedFleetEntry(created)]),
      ]),
    }),
    detectAgents: () => [{ name: "codex", binary: "codex" }],
    readPreferences: () => ({
      schema_version: 1,
      last_agent: "codex",
      creation_path: "compact",
    }),
    select: (options) => {
      menus.push(String(options.message));
      return choices.shift() ?? QUIT;
    },
    input: () => "Human title",
    start: (_ctx, prepared) => {
      created = startedTask(prepared);
      return created;
    },
    interactive: (command, args, cwd) => {
      launches.push({ command, args, cwd });
      return 0;
    },
    writePreferences: (_root, preferences) => {
      saved.push(preferences);
      return { status: "saved" };
    },
  });

  assertEquals(await runDesk({}, runtime), 0);
  assertEquals(menus.includes("Choose an agent action"), false);
  assertEquals(launches, [{
    command: "codex",
    args: [],
    cwd: "/worktrees/new-task",
  }]);
  assertEquals(saved, [{
    schema_version: 1,
    last_agent: "codex",
    creation_path: "compact",
  }]);
  assertStringIncludes(joined(output), "Open in Codex");
});

Deno.test("an unavailable preference write leaves creation intact and explains the fallback", async () => {
  const output = transcript();
  const main = fleetEntry("main", ROOT, {
    is_main: true,
    is_current: true,
  });
  const choices = [START_TASK, "codename", "compact", "none", BACK, QUIT];
  const confirmations = [true];
  let created: StartData | undefined;
  const runtime = scriptedRuntime(output, {
    status: () => ({
      ok: true,
      data: statusData([
        main,
        ...(created === undefined ? [] : [startedFleetEntry(created)]),
      ]),
    }),
    select: () => choices.shift() ?? QUIT,
    confirm: () => confirmations.shift() ?? false,
    start: (_ctx, prepared) => {
      created = startedTask(prepared);
      return created;
    },
    writePreferences: () => ({
      status: "unavailable",
      reason: "the repository preference store is read-only",
    }),
  });

  assertEquals(await runDesk({}, runtime), 0);
  assert(created !== undefined);
  assertStringIncludes(joined(output), "Desk preferences were not saved");
  assertStringIncludes(joined(output), "preference store is read-only");
  assertStringIncludes(joined(output), "current task is unchanged");
  assertStringIncludes(joined(output), "may ask you to choose again");
});

Deno.test("task creation cannot approve future authored source", async () => {
  const output = transcript();
  const main = fleetEntry("main", ROOT, {
    is_main: true,
    is_current: true,
  });
  const choices = [
    START_TASK,
    "codename",
    "expanded",
    "main",
    "none",
    BACK,
    QUIT,
  ];
  const confirmations = [true];
  let created: StartData | undefined;
  let grants = 0;
  const runtime = scriptedRuntime(output, {
    status: () => ({
      ok: true,
      data: statusData([
        main,
        ...(created === undefined ? [] : [startedFleetEntry(created)]),
      ]),
    }),
    select: () => choices.shift() ?? QUIT,
    input: () => "",
    confirm: () => confirmations.shift() ?? false,
    start: (_ctx, prepared) => {
      created = startedTask(prepared);
      return created;
    },
    grantEffort: () => {
      grants++;
      throw new Error("creation must not call the grant writer");
    },
  });

  assertEquals(await runDesk({}, runtime), 0);
  assert(created !== undefined);
  assertEquals(grants, 0);
  assertStringIncludes(
    joined(output),
    "A later conversation must authorize landing",
  );
});

Deno.test("a stale remembered agent falls back to an explicit choice", async () => {
  const output = transcript();
  const main = fleetEntry("main", ROOT, {
    is_main: true,
    is_current: true,
  });
  const config = configSchema.parse({
    project: { slug: "demo", agents: ["gemini"] },
    repository: { trunk: "main" },
  });
  const choices = [
    START_TASK,
    "codename",
    "compact",
    "gemini:open",
    BACK,
    QUIT,
  ];
  let agentMenu = "";
  let launchCount = 0;
  let created: StartData | undefined;
  const runtime = scriptedRuntime(output, {
    loadConfig: () => config,
    status: () => ({
      ok: true,
      data: statusData([
        main,
        ...(created === undefined ? [] : [startedFleetEntry(created)]),
      ]),
    }),
    detectAgents: () => [{ name: "gemini", binary: "gemini" }],
    readPreferences: () => ({
      schema_version: 1,
      last_agent: "codex",
      creation_path: "compact",
    }),
    select: (options) => {
      if (String(options.message) === "Choose an agent action") {
        agentMenu = JSON.stringify(options.options);
      }
      return choices.shift() ?? QUIT;
    },
    start: (_ctx, prepared) => {
      created = startedTask(prepared);
      return created;
    },
    interactive: () => {
      launchCount++;
      return 0;
    },
  });

  assertEquals(await runDesk({}, runtime), 0);
  assertStringIncludes(agentMenu, "Gemini");
  assert(!agentMenu.includes("Codex"));
  assertStringIncludes(agentMenu, "Create without opening an agent");
  assertEquals(launchCount, 1);
});

Deno.test("task creation returns safely from every progressive prompt", async () => {
  const cases = [
    {
      name: "title route",
      choices: [START_TASK, BACK, QUIT],
      cancelInputAt: 0,
      planned: 0,
    },
    {
      name: "title text",
      choices: [START_TASK, "describe", QUIT],
      cancelInputAt: 1,
      planned: 0,
    },
    {
      name: "creation path",
      choices: [START_TASK, "codename", BACK, QUIT],
      cancelInputAt: 0,
      planned: 0,
    },
    {
      name: "creation base",
      choices: [START_TASK, "codename", "expanded", BACK, QUIT],
      cancelInputAt: 0,
      planned: 0,
    },
    {
      name: "brief",
      choices: [START_TASK, "codename", "expanded", "main", QUIT],
      cancelInputAt: 1,
      planned: 0,
    },
    {
      name: "agent action",
      choices: [
        START_TASK,
        "codename",
        "expanded",
        "main",
        BACK,
        QUIT,
      ],
      cancelInputAt: 0,
      planned: 0,
    },
    {
      name: "expanded creation confirmation",
      choices: [
        START_TASK,
        "codename",
        "expanded",
        "main",
        "none",
        QUIT,
      ],
      cancelInputAt: 0,
      cancelConfirmAt: 1,
      planned: 1,
    },
    {
      name: "creation confirmation",
      choices: [START_TASK, "codename", "compact", "none", QUIT],
      cancelInputAt: 0,
      planned: 1,
    },
  ] as const;

  for (const testCase of cases) {
    const output = transcript();
    const main = fleetEntry("main", ROOT, {
      is_main: true,
      is_current: true,
    });
    const choices = [...testCase.choices];
    let inputCalls = 0;
    let confirmCalls = 0;
    let planCalls = 0;
    let startCalls = 0;
    let preferenceWrites = 0;
    const runtime = scriptedRuntime(output, {
      status: () => ({ ok: true, data: statusData([main]) }),
      select: () => choices.shift() ?? QUIT,
      input: () => {
        inputCalls++;
        if (inputCalls === testCase.cancelInputAt) {
          throw new InteractionCancelled();
        }
        return "";
      },
      confirm: () => {
        confirmCalls++;
        if (
          "cancelConfirmAt" in testCase &&
          confirmCalls === testCase.cancelConfirmAt
        ) {
          throw new InteractionCancelled();
        }
        return false;
      },
      startPlan: (_ctx, request) => {
        planCalls++;
        return preparedStart(request.title ?? "Generated codename");
      },
      start: (_ctx, prepared) => {
        startCalls++;
        return startedTask(prepared);
      },
      writePreferences: () => {
        preferenceWrites++;
        return { status: "saved" };
      },
    });

    assertEquals(await runDesk({}, runtime), 0, testCase.name);
    assertEquals(planCalls, testCase.planned, testCase.name);
    assertEquals(startCalls, 0, testCase.name);
    assertEquals(preferenceWrites, 0, testCase.name);
  }
});

Deno.test("an unlanded branch can be inspected or resumed by its exact ref", async () => {
  const branch = "agent/orphan-修复";
  const main = fleetEntry("main", ROOT, {
    is_main: true,
    is_current: true,
  });

  const inspectOutput = transcript();
  const inspectChoices = [deskUnlandedRoute(branch), "inspect", BACK, QUIT];
  const gitCalls: string[][] = [];
  let branchMenu = "";
  let page = "";
  assertEquals(
    await runDesk(
      {},
      scriptedRuntime(inspectOutput, {
        status: () => ({
          ok: true,
          data: { ...statusData([main]), unlanded_branches: [branch] },
        }),
        select: (options) => {
          if (String(options.message) === "Choose a branch action") {
            branchMenu = JSON.stringify(options.options);
          }
          return inspectChoices.shift() ?? QUIT;
        },
        git: (args) => {
          gitCalls.push(args);
          return {
            success: true,
            stdout: args[0] === "log"
              ? "abc1234 Keep orphan work\n"
              : "src/a.ts | 2 ++\n",
            stderr: "",
          };
        },
        pager: (text) => {
          page = text;
          return { shown: true };
        },
      }),
    ),
    0,
  );
  assertEquals(gitCalls, [
    ["log", "--oneline", "--decorate", `main..${branch}`],
    ["diff", "--stat", `main...${branch}`],
  ]);
  assertStringIncludes(page, branch);
  assertStringIncludes(page, "abc1234 Keep orphan work");
  assertStringIncludes(page, "src/a.ts | 2 ++");
  assertStringIncludes(branchMenu, "Resume in a worktree");
  assert(!branchMenu.includes("Delete"));

  const resumeOutput = transcript();
  const resumeChoices = [
    deskUnlandedRoute(branch),
    "resume",
    "describe",
    "none",
    BACK,
    QUIT,
  ];
  const inputs = ["Resume orphan work", "Retain the branch's committed base."];
  const confirmations = [true];
  const requests: Array<Parameters<DeskRuntime["startPlan"]>[1]> = [];
  let created: StartData | undefined;
  assertEquals(
    await runDesk(
      {},
      scriptedRuntime(resumeOutput, {
        status: () => ({
          ok: true,
          data: {
            ...statusData([
              main,
              ...(created === undefined ? [] : [startedFleetEntry(created)]),
            ]),
            unlanded_branches: [branch],
          },
        }),
        select: () => resumeChoices.shift() ?? QUIT,
        input: () => inputs.shift() ?? "",
        confirm: () => confirmations.shift() ?? false,
        startPlan: (_ctx, request) => {
          requests.push(request);
          return preparedStart(request.title ?? "Generated title", {
            from: request.from ?? "main",
            ...(request.brief === undefined ? {} : { brief: request.brief }),
          });
        },
        start: (_ctx, prepared) => {
          created = startedTask(prepared);
          return created;
        },
      }),
    ),
    0,
  );
  assertEquals(requests, [{
    worktreeRoot: "/project.worktrees",
    title: "Resume orphan work",
    brief: "Retain the branch's committed base.",
    from: branch,
  }]);
  assertStringIncludes(joined(resumeOutput), branch);
});

Deno.test("a live task starts a follow-up from its exact branch tip", async () => {
  const output = transcript();
  const main = fleetEntry("main", ROOT, { is_main: true, is_current: true });
  const parent = fleetEntry("agent/parent-task", "/worktrees/parent-task", {
    id: "parent-task",
  });
  const choices = [
    parent.path,
    "follow_up",
    "describe",
    "none",
    BACK,
    QUIT,
  ];
  const inputs = [
    "Follow-up: preserve metadata",
    "Build on the selected task's committed tip.",
  ];
  const confirmations = [true];
  const requests: Array<Parameters<DeskRuntime["startPlan"]>[1]> = [];
  const preferences: Array<Parameters<DeskRuntime["writePreferences"]>[1]> = [];
  let created: StartData | undefined;
  const runtime = scriptedRuntime(output, {
    status: () => ({
      ok: true,
      data: statusData([
        main,
        parent,
        ...(created === undefined ? [] : [startedFleetEntry(created)]),
      ]),
    }),
    readPreferences: () => ({
      schema_version: 1,
      creation_path: "compact",
    }),
    select: () => choices.shift() ?? QUIT,
    input: () => inputs.shift() ?? "",
    confirm: () => confirmations.shift() ?? false,
    startPlan: (_ctx, request) => {
      requests.push(request);
      return preparedStart(request.title ?? "Generated title", {
        from: request.from ?? "main",
        ...(request.brief === undefined ? {} : { brief: request.brief }),
      });
    },
    start: (_ctx, prepared) => {
      created = startedTask(prepared);
      return created;
    },
    writePreferences: (_root, value) => {
      preferences.push(value);
      return { status: "saved" };
    },
  });

  assertEquals(await runDesk({}, runtime), 0);
  assertEquals(requests, [{
    worktreeRoot: "/project.worktrees",
    title: "Follow-up: preserve metadata",
    brief: "Build on the selected task's committed tip.",
    from: parent.branch,
  }]);
  assertEquals(preferences, [{
    schema_version: 1,
    creation_path: "compact",
  }]);
  assertStringIncludes(joined(output), parent.branch);
  assertStringIncludes(joined(output), START_COMMIT);
});

Deno.test("renaming changes only the recorded title through preview and apply", async () => {
  const output = transcript();
  const oldTitle = "Original title";
  const newTitle = "Renamed: Unicode 修复";
  const branch = "agent/stable-identity";
  const path = "/worktrees/stable-identity";
  let currentTitle = oldTitle;
  const main = fleetEntry("main", ROOT, { is_main: true, is_current: true });
  const task = (): StatusFleetEntry =>
    fleetEntry(branch, path, {
      id: "stable-identity",
      task: {
        id: "stable-identity",
        branch,
        title: currentTitle,
        title_source: "recorded",
        brief: "Keep this brief.",
        created_from: { ref: "main", commit: START_COMMIT },
      },
    });
  const choices = [path, "rename", BACK, QUIT];
  const previews: string[] = [];
  const applies: string[] = [];
  const runtime = scriptedRuntime(output, {
    status: () => ({ ok: true, data: statusData([main, task()]) }),
    select: () => choices.shift() ?? QUIT,
    input: () => newTitle,
    renamePlan: (_ctx, title) => {
      previews.push(title);
      return {
        ok: true,
        verb: "worktree rename",
        dry_run: true,
        plan: {
          title: "Task title plan",
          details: [
            `Branch: ${branch}`,
            `Path: ${path}`,
            `New title: ${title}`,
          ],
          steps: [],
        },
      };
    },
    rename: (_ctx, title) => {
      applies.push(title);
      currentTitle = title;
      return {
        ok: true,
        verb: "worktree rename",
        message: `Changed the task title to ${JSON.stringify(title)}.`,
      };
    },
  });

  assertEquals(await runDesk({}, runtime), 0);
  assertEquals(previews, [newTitle]);
  assertEquals(applies, [newTitle]);
  assertEquals(task().branch, branch);
  assertEquals(task().path, path);
  assertEquals(task().task?.brief, "Keep this brief.");
  assertStringIncludes(
    joined(output),
    "discern worktree rename 'Renamed: Unicode 修复'",
  );
});

Deno.test("desk explains missing configured agents and launches available argv in the worktree", async () => {
  const output = transcript();
  const effort = fleetEntry("agent/agents", "/worktrees/agents");
  const data = statusData([
    fleetEntry("main", ROOT, { is_main: true, is_current: true }),
    effort,
  ]);
  const worktreeConfig = configSchema.parse({
    project: { slug: "demo", agents: ["claude_code", "codex"] },
    repository: { trunk: "main" },
  });
  const choices = [
    effort.path,
    "agent",
    "claude_code:open",
    BACK,
    effort.path,
    "agent",
    "claude_code:continue",
    BACK,
    QUIT,
  ];
  const menus: Array<{
    message: string;
    options: string;
    reservedRows: number | undefined;
  }> = [];
  const launches: Array<{
    command: string;
    args: readonly string[];
    cwd: string;
    env: Record<string, string>;
  }> = [];
  const preferences: Array<Parameters<DeskRuntime["writePreferences"]>[1]> = [];
  const runtime = scriptedRuntime(output, {
    status: () => ({ ok: true, data }),
    loadConfig: (root) => root === effort.path ? worktreeConfig : CONFIG,
    detectAgents: () => [
      { name: "claude_code", binary: "claude" },
      { name: "gemini", binary: "gemini" },
    ],
    select: (options) => {
      menus.push({
        message: String(options.message),
        options: JSON.stringify(options.options),
        reservedRows: options.reservedRows,
      });
      return choices.shift() ?? QUIT;
    },
    interactive: (command, args, cwd, env) => {
      launches.push({ command, args, cwd, env });
      return 0;
    },
    readPreferences: () => ({
      schema_version: 1,
      creation_path: "expanded",
    }),
    writePreferences: (_root, value) => {
      preferences.push(value);
      return { status: "saved" };
    },
  });

  assertEquals(await runDesk({}, runtime), 0);
  assertEquals(launches, [
    {
      command: "claude",
      args: [],
      cwd: effort.path,
      env: { [DESK_SESSION_ENV]: "1" },
    },
    {
      command: "claude",
      args: ["--continue"],
      cwd: effort.path,
      env: { [DESK_SESSION_ENV]: "1" },
    },
  ]);
  assertEquals(preferences, [{
    schema_version: 1,
    creation_path: "expanded",
    last_agent: "claude_code",
  }, {
    schema_version: 1,
    creation_path: "expanded",
    last_agent: "claude_code",
  }]);
  const actionMenu = menus.find((menu) => menu.message === "Choose an action");
  const agentMenu = menus.find((menu) =>
    menu.message.startsWith("Choose an agent for Agents")
  );
  const boardMenu = menus.find((menu) =>
    menu.message === "Choose a task or desk command"
  );
  assert(actionMenu !== undefined);
  assert(agentMenu !== undefined);
  assert(boardMenu !== undefined);
  assert(
    (boardMenu.reservedRows ?? 0) >= 4,
    "the board menu must reserve the header rows the desk wrote above it",
  );
  assert(
    (actionMenu.reservedRows ?? 0) > 4,
    "the action menu must reserve the complete task-detail frame",
  );
  assertStringIncludes(actionMenu.options, "Continue with an agent");
  assertStringIncludes(
    agentMenu.options,
    '"kind":"group-heading","id":"agent-claude_code","name":"Claude Code"',
  );
  assertStringIncludes(
    agentMenu.options,
    '"kind":"group-heading","id":"task-navigation","name":"Task"',
  );
  assert(
    !agentMenu.options.includes('"name":"Agents"'),
    "agent actions should be grouped by provider",
  );
  assertStringIncludes(agentMenu.options, "Open in Claude Code");
  assertStringIncludes(agentMenu.options, "Continue in Claude Code");
  assertStringIncludes(agentMenu.options, "Codex");
  assertStringIncludes(agentMenu.options, "Codex is configured");
  assertStringIncludes(agentMenu.options, "not on PATH");
  assertStringIncludes(agentMenu.options, '"disabled":true');
  assert(
    !agentMenu.options.includes("Gemini"),
    "detected but unconfigured stays hidden",
  );
  assertStringIncludes(
    joined(output),
    `Run: claude --continue (cwd: ${effort.path})`,
  );
});

Deno.test("desk inspect and jump actions use the scripted effect boundary", async () => {
  const output = transcript();
  const effort = fleetEntry("agent/inspect", "/worktrees/inspect", {
    ahead: 2,
    behind: 1,
    proof_honored: true,
    gate_proof: { status: "honored" },
  });
  const data = statusData([
    fleetEntry("main", ROOT, { is_main: true, is_current: true }),
    effort,
  ]);
  const choices = [
    effort.path,
    "inspect",
    DESK_REVIEW_ROUTES.diff,
    DESK_REVIEW_ROUTES.back,
    "jump",
    BACK,
    QUIT,
  ];
  const menus: string[] = [];
  const gitResults = [
    { success: true, stdout: "abc123 Explain the change\n", stderr: "" },
    { success: true, stdout: '3\t1\tsrc/café"desk.ts\0', stderr: "" },
    { success: true, stdout: 'M\0src/café"desk.ts\0', stderr: "" },
    { success: true, stdout: ' M src/café"desk.ts\0', stderr: "" },
    { success: false, stdout: "", stderr: "diff unavailable\n" },
  ];
  const shellCalls: Array<{
    command: string;
    args: readonly string[];
    cwd: string;
    env: Record<string, string>;
  }> = [];
  const runtime = scriptedRuntime(output, {
    status: () => ({ ok: true, data }),
    select: (options) => {
      menus.push(JSON.stringify(options.options));
      const choice = choices.shift();
      assert(choice !== undefined, "the scripted desk exhausted its choices");
      return choice;
    },
    git: () => {
      const result = gitResults.shift();
      assert(result !== undefined, "inspect ran an unexpected git read");
      return result;
    },
    interactive: (command, args, cwd, env) => {
      shellCalls.push({ command, args, cwd, env });
      return 0;
    },
  });

  assertEquals(await runDesk({}, runtime), 0);
  assertEquals(shellCalls.length, 1);
  assertEquals(shellCalls[0]?.cwd, effort.path);
  assertEquals(shellCalls[0]?.args, []);
  assertEquals(shellCalls[0]?.env, { [DESK_SESSION_ENV]: "1" });
  assert((shellCalls[0]?.command ?? "").length > 0);
  const text = joined(output);
  assertStringIncludes(text, "abc123 Explain the change");
  assertStringIncludes(text, 'src/café"desk.ts');
  assertStringIncludes(text, "diff unavailable");
  assertStringIncludes(text, "Proof honored for this commit");
  const actionMenu = menus.join("\n");
  for (
    const group of [
      '"kind":"group-heading","id":"actions-recommended","name":"Recommended"',
      '"kind":"group-heading","id":"actions-work","name":"Work"',
      '"kind":"group-heading","id":"actions-review","name":"Review"',
      '"kind":"group-heading","id":"actions-manage","name":"Manage"',
      '"kind":"group-heading","id":"actions-danger","name":"Danger"',
      '"kind":"group-heading","id":"task-navigation","name":"Task"',
    ]
  ) {
    assertStringIncludes(actionMenu, group);
  }
  for (
    const label of [
      "Update branch",
      "Open a shell",
      "Review Proof and changes",
      "Drop worktree",
    ]
  ) {
    assertStringIncludes(actionMenu, label);
  }
  assertStringIncludes(actionMenu, "Review and land on main");
  assertStringIncludes(actionMenu, "1 commit behind main.");
  assertStringIncludes(actionMenu, "Run a Project Script");
  assertStringIncludes(actionMenu, "No Project Scripts are available");
});

Deno.test("desk offers and runs only the selected worktree's Project Scripts", async () => {
  const output = transcript();
  const empty = fleetEntry("agent/empty", "/worktrees/empty");
  const scripted = fleetEntry("agent/scripted", "/worktrees/scripted");
  const data = statusData([
    fleetEntry("main", ROOT, { is_main: true, is_current: true }),
    empty,
    scripted,
  ]);
  const choices = [
    empty.path,
    BACK,
    scripted.path,
    "scripts",
    "deploy",
    "run",
    BACK,
    QUIT,
  ];
  const menus: Array<{ message: string; options: string }> = [];
  const discoveryRoots: string[] = [];
  const runs: Array<{
    root: string;
    name: string;
    args: readonly string[];
    env: Record<string, string>;
  }> = [];
  let pauses = 0;
  const runtime = scriptedRuntime(output, {
    status: () => ({ ok: true, data }),
    scripts: (root) => {
      discoveryRoots.push(root);
      return root === scripted.path
        ? [{ name: "deploy", description: "deploy this checkout" }]
        : [];
    },
    select: (options) => {
      menus.push({
        message: String(options.message),
        options: JSON.stringify(options.options),
      });
      const choice = choices.shift();
      assert(choice !== undefined, "the scripted desk exhausted its choices");
      return choice;
    },
    runScript: (root, name, args, env) => {
      runs.push({ root, name, args, env });
      return 7;
    },
    pause: () => {
      pauses++;
    },
  });

  assertEquals(await runDesk({}, runtime), 0);
  assert(discoveryRoots.includes(empty.path));
  assert(discoveryRoots.includes(scripted.path));
  assertEquals(runs, [{
    root: scripted.path,
    name: "deploy",
    args: [],
    env: { [DESK_SESSION_ENV]: "1" },
  }]);
  assertEquals(pauses, 1);

  const actionMenus = menus.filter((menu) =>
    menu.message === "Choose an action"
  );
  const emptyMenu = actionMenus.find((menu) =>
    menu.options.includes("No Project Scripts are available")
  );
  const scriptedMenu = actionMenus.find((menu) =>
    menu.options.includes("Run a Project Script")
  );
  const scriptMenu = menus.find((menu) =>
    menu.message.startsWith("Choose a Project Script for Scripted")
  );
  assert(emptyMenu !== undefined);
  assert(scriptedMenu !== undefined);
  assert(scriptMenu !== undefined);
  assertStringIncludes(emptyMenu.options, "Run a Project Script");
  assertStringIncludes(
    emptyMenu.options,
    "No Project Scripts are available in this task.",
  );
  assertStringIncludes(scriptedMenu.options, "Run a Project Script");
  assertStringIncludes(scriptMenu.options, "deploy");
  assertStringIncludes(scriptMenu.options, "deploy this checkout");

  const text = joined(output);
  assertStringIncludes(text, "Run: discern scripts deploy (in scripted)");
  assertStringIncludes(text, "Project Script exited with status 7");
});

Deno.test("desk collects and forwards literal arguments to a worktree Project Script", async () => {
  const output = transcript();
  const scripted = fleetEntry(
    "agent/script-arguments",
    "/worktrees/script-arguments",
  );
  const data = statusData([
    fleetEntry("main", ROOT, { is_main: true, is_current: true }),
    scripted,
  ]);
  const choices = [
    scripted.path,
    "scripts",
    "publish-canary",
    "run",
    BACK,
    QUIT,
  ];
  const inputs: TextRequestOptions[] = [];
  const runs: unknown[][] = [];
  const runtime = scriptedRuntime(output, {
    status: () => ({ ok: true, data }),
    scripts: (root) =>
      root === scripted.path
        ? [{ name: "publish-canary", description: "publish one preview" }]
        : [],
    select: () => choices.shift() ?? QUIT,
    input: (options) => {
      inputs.push(options);
      return `--target 'review environment' '--literal=$HOME'`;
    },
    runScript: (...values: unknown[]) => {
      runs.push(values);
      return 0;
    },
    pause: () => {},
  });

  assertEquals(await runDesk({}, runtime), 0);
  assertEquals(inputs.length, 1);
  assertEquals(runs, [[
    scripted.path,
    "publish-canary",
    ["--target", "review environment", "--literal=$HOME"],
    { [DESK_SESSION_ENV]: "1" },
  ]]);
  const text = joined(output);
  assertTerminalTextIncludes(
    text,
    "discern scripts publish-canary --target 'review environment' '--literal=$HOME'",
  );
});

Deno.test("desk offers and runs Project Scripts from the project root", async () => {
  const output = transcript();
  const choices = [RUN_PROJECT_SCRIPT, "health", "run", QUIT];
  const menus: Array<{ message: string; options: string }> = [];
  const runs: Array<{
    root: string;
    name: string;
    args: readonly string[];
    env: Record<string, string>;
  }> = [];
  let pauses = 0;
  const confirmations: ConfirmationRequestOptions[] = [];
  const runtime = scriptedRuntime(output, {
    scripts: (root) =>
      root === ROOT
        ? [{ name: "health", description: "check the project" }]
        : [],
    select: (options) => {
      menus.push({
        message: String(options.message),
        options: JSON.stringify(options.options),
      });
      return choices.shift() ?? QUIT;
    },
    input: () => `--mode 'full scan'`,
    runScript: (root, name, args, env) => {
      runs.push({ root, name, args, env });
      return 0;
    },
    confirm: (_message, options) => {
      confirmations.push(options);
      return true;
    },
    pause: () => {
      pauses++;
    },
  });

  assertEquals(await runDesk({}, runtime), 0);
  assertEquals(runs, [{
    root: ROOT,
    name: "health",
    args: ["--mode", "full scan"],
    env: { [DESK_SESSION_ENV]: "1" },
  }]);
  assertEquals(pauses, 1);
  assertEquals(confirmations, [{
    defaultTo: false,
    noLabel: "Cancel",
    yesLabel: "Run",
  }]);

  const rootMenu = menus[0]?.options ?? "";
  const startAt = rootMenu.indexOf("Start a task");
  const scriptAt = rootMenu.indexOf("Run a Project Script");
  const docsAt = rootMenu.indexOf("Read discern's docs");
  assert(startAt >= 0 && startAt < scriptAt && scriptAt < docsAt);
  const scriptMenu = menus.find((menu) =>
    menu.message === "Choose a Project Script for demo"
  );
  assert(scriptMenu !== undefined);
  assertStringIncludes(scriptMenu.options, "health");
  assertStringIncludes(scriptMenu.options, "check the project");
  assertStringIncludes(
    scriptMenu.options,
    '"kind":"group-heading","id":"desk-navigation","name":"Desk"',
  );
  assertStringIncludes(
    joined(output),
    "Run: discern scripts health --mode 'full scan' (in project root)",
  );
  assertStringIncludes(joined(output), "Executable");
  assertStringIncludes(joined(output), "Working directory");
  assertStringIncludes(joined(output), "Destructive policy: undeclared");
});

Deno.test("desk opens discern's online docs from the root menu", async () => {
  const output = transcript();
  const choices = [READ_DOCS, QUIT];
  const menus: string[] = [];
  const opened: string[] = [];
  let pauses = 0;
  const runtime = scriptedRuntime(output, {
    select: (options) => {
      menus.push(JSON.stringify(options.options));
      return choices.shift() ?? QUIT;
    },
    openBrowser: (url) => {
      opened.push(url);
      return {
        status: "opened",
        launch: { command: "open", args: [url] },
      };
    },
    pause: () => {
      pauses++;
    },
  });

  assertEquals(await runDesk({}, runtime), 0);
  assertEquals(opened, [DISCERN_DOCS_URL]);
  assertEquals(pauses, 1);
  assertStringIncludes(menus[0] ?? "", "Read discern's docs");
  assertStringIncludes(joined(output), `Opened ${DISCERN_DOCS_URL}.`);
});

Deno.test("desk final checks use the shared core and return to refreshed Proof", async () => {
  const output = transcript();
  const main = fleetEntry("main", ROOT, { is_main: true, is_current: true });
  const effort = fleetEntry("agent/final-checks", "/worktrees/final-checks", {
    ahead: 2,
    gate_proof: { status: "missing" },
  });
  const data = statusData([main, effort]);
  const choices = [effort.path, "done", BACK, QUIT];
  let finished = false;
  let planCalls = 0;
  let doneCalls = 0;
  let planWasVisibleAtConfirmation = false;
  const confirmations: ConfirmationRequestOptions[] = [];
  const runtime = scriptedRuntime(output, {
    status: () => {
      if (finished) {
        effort.proof_honored = true;
        effort.proof_line =
          "Proof: agent/final-checks abc1234 · gate passed in 1m";
        effort.gate_proof = {
          status: "honored",
          proof_line: effort.proof_line,
        };
      }
      return { ok: true, data };
    },
    select: () => choices.shift() ?? QUIT,
    donePlan: () => {
      planCalls++;
      return {
        ok: true,
        verb: "done",
        plan: { title: "Final checks plan", details: [], steps: [] },
      };
    },
    confirm: (_message, options) => {
      confirmations.push(options);
      planWasVisibleAtConfirmation = joined(output).includes(
        "Final checks plan",
      );
      return true;
    },
    done: () => {
      doneCalls++;
      finished = true;
      return {
        ok: true,
        verb: "done",
        message: "Final checks passed and Proof was refreshed.",
      };
    },
  });

  assertEquals(
    await runDesk({ cliModel: TEST_CLI_MODEL }, runtime),
    0,
  );
  assertEquals(planCalls, 1);
  assertEquals(doneCalls, 1);
  assert(planWasVisibleAtConfirmation);
  assertEquals(confirmations, [{
    defaultTo: false,
    noLabel: "Cancel",
    yesLabel: "Run",
  }]);
  const text = joined(output);
  assertStringIncludes(text, "Final checks passed and Proof was refreshed.");
  assertStringIncludes(
    text,
    "Proof: agent/final-checks abc1234 · gate passed in 1m",
  );
  assertStringIncludes(text, "Review and land on main");

  const cancelledOutput = transcript();
  const cancelledChoices = [effort.path, "done", BACK, QUIT];
  let cancelledDoneCalls = 0;
  assertEquals(
    await runDesk(
      { cliModel: TEST_CLI_MODEL },
      scriptedRuntime(cancelledOutput, {
        status: () => ({ ok: true, data }),
        select: () => cancelledChoices.shift() ?? QUIT,
        confirm: () => false,
        done: () => {
          cancelledDoneCalls++;
          return { ok: true, verb: "done" };
        },
      }),
    ),
    0,
  );
  assertEquals(cancelledDoneCalls, 0);
});

Deno.test("every registered Desk action reaches its shared runtime effect", async () => {
  interface RuntimeActionCase {
    readonly entry?: Partial<StatusFleetEntry>;
    readonly choices: readonly string[];
    readonly needsCliModel?: boolean;
    readonly runtime: (
      effects: DeskAction[],
    ) => Partial<DeskRuntime>;
  }
  const cases: Readonly<Record<DeskAction, RuntimeActionCase>> = {
    recovery: {
      entry: { broken: true },
      choices: ["recovery", BACK, QUIT],
      runtime: (effects: DeskAction[]) => ({
        pause: () => {
          effects.push("recovery");
        },
      }),
    },
    retry_setup: {
      entry: {
        setup: {
          state: "incomplete",
          marker: "missing",
          repair: {
            kind: "retry",
            command: "discern worktree setup",
            reason: "The ready marker is missing.",
          },
        },
      },
      choices: ["retry_setup", BACK, QUIT],
      runtime: (effects: DeskAction[]) => ({
        setup: () => {
          effects.push("retry_setup");
        },
      }),
    },
    done: {
      entry: { ahead: 1, gate_proof: { status: "missing" } },
      choices: ["done", BACK, QUIT],
      needsCliModel: true,
      runtime: (effects: DeskAction[]) => ({
        done: () => {
          effects.push("done");
          return { ok: true, verb: "done" };
        },
      }),
    },
    accept: {
      entry: {
        ahead: 1,
        proof_honored: true,
        gate_proof: { status: "honored" },
      },
      choices: ["accept", BACK, QUIT],
      needsCliModel: true,
      runtime: (effects: DeskAction[]) => ({
        accept: () => {
          effects.push("accept");
        },
      }),
    },
    update: {
      entry: { ahead: 1, behind: 1 },
      choices: ["update", BACK, QUIT],
      runtime: (effects: DeskAction[]) => ({
        update: () => {
          effects.push("update");
        },
      }),
    },
    agent: {
      choices: ["agent", "claude_code:open", BACK, QUIT],
      runtime: (effects: DeskAction[]) => ({
        loadConfig: () =>
          configSchema.parse({
            project: { slug: "demo", agents: ["claude_code"] },
            repository: { trunk: "main" },
          }),
        detectAgents: () => [{ name: "claude_code", binary: "claude" }],
        interactive: () => {
          effects.push("agent");
          return 0;
        },
      }),
    },
    follow_up: {
      choices: ["follow_up", "describe", "none", QUIT],
      runtime: (effects: DeskAction[]) => {
        const inputs = ["Follow-up task", "Carry the current work forward."];
        return {
          input: () => inputs.shift() ?? "",
          start: (_ctx, prepared) => {
            effects.push("follow_up");
            return startedTask(prepared);
          },
        };
      },
    },
    scripts: {
      choices: ["scripts", "verify", "run", BACK, QUIT],
      runtime: (effects: DeskAction[]) => ({
        scripts: () => [{
          name: "verify",
          path: "/worktrees/action-class/discern/scripts/verify",
          workingDirectory: "/worktrees/action-class",
          availability: "enabled",
        }],
        runScript: () => {
          effects.push("scripts");
          return 0;
        },
      }),
    },
    jump: {
      choices: ["jump", BACK, QUIT],
      runtime: (effects: DeskAction[]) => ({
        interactive: () => {
          effects.push("jump");
          return 0;
        },
      }),
    },
    inspect: {
      choices: ["inspect", DESK_REVIEW_ROUTES.back, BACK, QUIT],
      runtime: (effects: DeskAction[]) => ({
        git: () => {
          effects.push("inspect");
          return { success: true, stdout: "", stderr: "" };
        },
      }),
    },
    rename: {
      choices: ["rename", BACK, QUIT],
      runtime: (effects: DeskAction[]) => ({
        input: () => "A clearer task title",
        rename: (_ctx, title) => {
          effects.push("rename");
          return {
            ok: true,
            verb: "worktree rename",
            message: `Changed the task title to ${JSON.stringify(title)}.`,
          };
        },
      }),
    },
    grant: {
      choices: ["grant", BACK, QUIT],
      runtime: (effects: DeskAction[]) => ({
        grantEffort: (_path, branch) => {
          effects.push("grant");
          return {
            status: "granted",
            grant: fixtureEffortGrant(branch),
          };
        },
      }),
    },
    revoke_grant: {
      entry: {
        landing_authority: { kind: "authorized", source: "effort-grant" },
      },
      choices: ["revoke_grant", BACK, QUIT],
      runtime: (effects: DeskAction[]) => ({
        clearEffortGrant: () => {
          effects.push("revoke_grant");
          return true;
        },
      }),
    },
    reclaim: {
      entry: { ahead: 1, contained_in: "agent/later" },
      choices: ["reclaim", BACK, QUIT],
      runtime: (effects: DeskAction[]) => ({
        reclaim: () => {
          effects.push("reclaim");
        },
      }),
    },
    park: {
      choices: ["park", BACK, QUIT],
      runtime: (effects: DeskAction[]) => ({
        park: () => {
          effects.push("park");
        },
      }),
    },
    drop: {
      entry: { broken: true },
      choices: ["drop", BACK, QUIT],
      runtime: (effects: DeskAction[]) => ({
        drop: () => {
          effects.push("drop");
        },
      }),
    },
  };
  assertEquals(Object.keys(cases), [...DESK_ACTIONS]);

  for (const action of DESK_ACTIONS) {
    const output = transcript();
    const effort = fleetEntry(
      `agent/action-${action}`,
      "/worktrees/action-class",
      cases[action].entry ?? {},
    );
    const data = statusData([
      fleetEntry("main", ROOT, { is_main: true, is_current: true }),
      effort,
    ]);
    const choices = [effort.path, ...cases[action].choices];
    const effects: DeskAction[] = [];
    const opts = cases[action].needsCliModel === true
      ? { cliModel: TEST_CLI_MODEL }
      : {};
    assertEquals(
      await runDesk(
        opts,
        scriptedRuntime(output, {
          status: () => ({ ok: true, data }),
          select: () => choices.shift() ?? QUIT,
          confirm: () => true,
          ...cases[action].runtime(effects),
        }),
      ),
      0,
      action,
    );
    assert(
      effects.includes(action),
      `${action} did not reach its shared runtime effect`,
    );
  }
});

Deno.test("desk lifecycle actions preview, confirm, apply, and contain refusals", async () => {
  const effort = fleetEntry("agent/actions", "/worktrees/actions", {
    ahead: 2,
    behind: 1,
  });
  const main = fleetEntry("main", ROOT, { is_main: true, is_current: true });
  const data = statusData([main, effort]);

  const updateOutput = transcript();
  const updateChoices = [effort.path, "update", BACK, QUIT];
  const confirmationOptions: ConfirmationRequestOptions[] = [];
  let updatePlanCalls = 0;
  const updateCalls: Array<{ dryRun?: boolean }> = [];
  let updatePauses = 0;
  assertEquals(
    await runDesk(
      { cliModel: TEST_CLI_MODEL },
      scriptedRuntime(updateOutput, {
        status: () => ({ ok: true, data }),
        select: () => updateChoices.shift() ?? QUIT,
        confirm: (_message, options) => {
          confirmationOptions.push(options);
          return true;
        },
        updatePlan: () => {
          updatePlanCalls++;
          return { ok: true, verb: "update" };
        },
        update: (_ctx, opts) => {
          updateCalls.push(opts);
        },
        pause: () => {
          updatePauses++;
        },
      }),
    ),
    0,
  );
  assertEquals(updatePlanCalls, 1);
  assertEquals(updateCalls, [{}]);
  assertEquals(updatePauses, 1);
  assertEquals(confirmationOptions, [{
    defaultTo: false,
    noLabel: "Keep",
    yesLabel: "Update",
  }]);

  const acceptOutput = transcript();
  const ready = fleetEntry("agent/ready", "/worktrees/ready", {
    ahead: 2,
    behind: 0,
    proof_honored: true,
    gate_proof: { status: "honored" },
  });
  const readyData = statusData([main, ready]);
  const acceptChoices = [ready.path, "accept", BACK, QUIT];
  let acceptPlanCalls = 0;
  const appliedAccept: Array<Parameters<DeskRuntime["accept"]>[1]> = [];
  let acceptPauses = 0;
  assertEquals(
    await runDesk(
      { cliModel: TEST_CLI_MODEL },
      scriptedRuntime(acceptOutput, {
        status: () => ({ ok: true, data: readyData }),
        select: () => acceptChoices.shift() ?? QUIT,
        acceptPlan: () => {
          acceptPlanCalls++;
          return { ok: true, verb: "accept" };
        },
        accept: (_ctx, opts) => {
          appliedAccept.push(opts);
        },
        pause: () => {
          acceptPauses++;
        },
      }),
    ),
    0,
  );
  // The desk's interactive confirm IS the acceptance, so the apply carries the
  // attestation (ADR 0134) — never a bare, consent-less landing.
  assertEquals(acceptPlanCalls, 1);
  assertEquals(appliedAccept, [{ confirmed: true }]);
  assertEquals(acceptPauses, 1);

  const dropOutput = transcript();
  const abandoned = fleetEntry("agent/abandoned", "/worktrees/abandoned", {
    broken: true,
  });
  const dropData = statusData([main, abandoned]);
  const dropChoices = [abandoned.path, "drop", BACK, QUIT];
  const dropCalls: Array<{ dryRun?: boolean; force?: boolean }> = [];
  const dropPlans: string[] = [];
  const dropTargets: string[] = [];
  const dropConfirmations: ConfirmationRequestOptions[] = [];
  let dropPauses = 0;
  assertEquals(
    await runDesk(
      {},
      scriptedRuntime(dropOutput, {
        status: () => ({ ok: true, data: dropData }),
        select: () => dropChoices.shift() ?? QUIT,
        confirm: (_message, options) => {
          dropConfirmations.push(options);
          return true;
        },
        input: () => abandoned.branch,
        dropPlan: (_ctx, target) => {
          dropPlans.push(target);
          return { title: "Drop plan", details: [], steps: [] };
        },
        drop: (_ctx, target, opts) => {
          dropTargets.push(target);
          dropCalls.push(opts);
          if (!(opts.dryRun ?? false) && !(opts.force ?? false)) {
            throw new WorktreeGitError("unlanded work would be discarded");
          }
        },
        pause: () => {
          dropPauses++;
        },
      }),
    ),
    0,
  );
  assertEquals(dropPlans, [abandoned.path]);
  assertEquals(dropCalls, [{}, { force: true }]);
  assertEquals(dropTargets, [
    abandoned.path,
    abandoned.path,
  ]);
  assertEquals(dropPauses, 1);
  assertEquals(dropConfirmations, [{
    defaultTo: false,
    noLabel: "Keep",
    yesLabel: "Drop",
  }]);
  assertStringIncludes(joined(dropOutput), "unlanded work would be discarded");
  assertStringIncludes(joined(dropOutput), "--force");
  assertStringIncludes(
    joined(dropOutput),
    `discern worktree drop ${abandoned.path}`,
  );

  const refusalOutput = transcript();
  const refusalChoices = [effort.path, "accept", BACK, QUIT];
  assertEquals(
    await runDesk(
      { cliModel: TEST_CLI_MODEL },
      scriptedRuntime(refusalOutput, {
        status: () => ({ ok: true, data }),
        select: () => refusalChoices.shift() ?? QUIT,
        accept: () =>
          Promise.reject(new IdentityError("identity is unavailable")),
      }),
    ),
    0,
  );
  assertStringIncludes(joined(refusalOutput), "identity is unavailable");
});

Deno.test("Park cancellation keeps the checkout without calling apply", async () => {
  const output = transcript();
  const main = fleetEntry("main", ROOT, { is_main: true, is_current: true });
  const effort = fleetEntry("agent/park-cancel", "/worktrees/park-cancel", {
    ahead: 1,
  });
  const data = statusData([main, effort]);
  const choices = [effort.path, "park", BACK, QUIT];
  let planCalls = 0;
  let applyCalls = 0;
  const runtime = scriptedRuntime(output, {
    status: () => ({ ok: true, data }),
    select: () => choices.shift() ?? QUIT,
    confirm: () => false,
    parkPlan: () => {
      planCalls++;
      return { title: "Park plan", details: [], steps: [] };
    },
    park: () => {
      applyCalls++;
    },
  });

  assertEquals(await runDesk({}, runtime), 0);
  assertEquals(planCalls, 1);
  assertEquals(applyCalls, 0);
});

Deno.test("desk reclaims a contained checkout only through its explicit confirmation", async () => {
  const main = fleetEntry("main", ROOT, { is_main: true, is_current: true });
  const spent = fleetEntry("agent/stage-a", "/worktrees/stage-a", {
    ahead: 1,
    contained_in: "agent/stage-b",
  });
  const data = statusData([main, spent]);

  // Declined: the confirmation names the specific worktree, what is kept (the
  // branch ref), where the work travels, and the proof consequence — and a
  // "no" runs nothing.
  const declinedOutput = transcript();
  const declinedChoices = [spent.path, "reclaim", BACK, QUIT];
  const declinedReclaims: string[] = [];
  const confirmMessages: string[] = [];
  const confirmOptions: ConfirmationRequestOptions[] = [];
  assertEquals(
    await runDesk(
      {},
      scriptedRuntime(declinedOutput, {
        status: () => ({ ok: true, data }),
        select: () => declinedChoices.shift() ?? QUIT,
        confirm: (message, options) => {
          confirmMessages.push(message);
          confirmOptions.push(options);
          return false;
        },
        reclaim: (_ctx, target) => {
          declinedReclaims.push(target);
        },
      }),
    ),
    0,
  );
  assertEquals(
    declinedReclaims,
    [],
    "declining the confirmation must reclaim nothing",
  );
  const message = confirmMessages.join("\n");
  assertStringIncludes(message, "stage-a");
  assertStringIncludes(message, "agent/stage-a");
  assertStringIncludes(message, "KEPT");
  assertStringIncludes(message, "agent/stage-b");
  assertStringIncludes(message, "gate Proof included");
  assertEquals(confirmOptions, [{
    defaultTo: false,
    noLabel: "Keep",
    yesLabel: "Reclaim",
  }]);

  // Confirmed: the validated core runs against the selected worktree, and the
  // action menu offered the reclaim with its containing branch named.
  const output = transcript();
  const choices = [spent.path, "reclaim", BACK, QUIT];
  const reclaims: string[] = [];
  let pauses = 0;
  assertEquals(
    await runDesk(
      {},
      scriptedRuntime(output, {
        status: () => ({ ok: true, data }),
        select: () => choices.shift() ?? QUIT,
        confirm: () => true,
        reclaim: (_ctx, target) => {
          reclaims.push(target);
        },
        pause: () => {
          pauses++;
        },
      }),
    ),
    0,
  );
  // The core receives the ABSOLUTE selected path — two roots can hold
  // same-named worktree directories, and the reclaim must hit exactly the
  // row the confirmation named.
  assertEquals(reclaims, ["/worktrees/stage-a"]);
  assertEquals(pauses, 1);
  assertStringIncludes(joined(output), "Branch agent/stage-a kept");
});

Deno.test("desk shows one tip below status, stable across redraws, marked once", async () => {
  const output = transcript();
  const writes: TipSeenState[] = [];
  const recorded: string[] = [];
  const choices = [REFRESH, QUIT];
  const runtime = scriptedRuntime(output, {
    select: () => choices.shift() ?? QUIT,
    writeTipState: (_root, state) => {
      writes.push(state);
    },
    recordTipShown: (id) => {
      recorded.push(id);
    },
  });

  assertEquals(await runDesk({}, runtime), 0);
  // The scripted survey configures no standards, so the contextual
  // standards tip outranks the curriculum opener.
  const plainTranscript = stripAnsi(output.stdout.join(""));
  assertEquals(
    countOccurrences(plainTranscript, "Tip:"),
    2,
    "the same tip renders below status on both board passes",
  );
  assertEquals(
    countOccurrences(plainTranscript, "A standard is a quality measure"),
    2,
  );
  assertEquals(
    recorded,
    ["standards-first-rule"],
    "the shown id is reported once per session, not once per redraw",
  );
  assertEquals(writes.length, 1, "the seen-state is written once per session");
  assertEquals(writes[0]?.tips["standards-first-rule"], {
    count: 1,
    last_shown: new Date(NOW).toISOString(),
  });
});

Deno.test("desk renders tips through the package note cue", async () => {
  const terminal = resolveTerminalContext({
    noColor: false,
    env: fakeEnv({
      TERM: "xterm-256color",
      COLORTERM: "truecolor",
      LANG: "en_GB.UTF-8",
    }),
    isTerminal: () => true,
    consoleSize: () => ({ columns: 80, rows: 24 }),
  });
  const output = transcript(terminal);

  assertEquals(await runDesk({}, scriptedRuntime(output)), 0);
  assertTerminalTextIncludes(stripAnsi(output.stdout.join("")), "▸ Tip:");
  assertStringIncludes(output.stdout.join(""), "\x1b[");
});

Deno.test("desk wraps the complete tip at 60 columns without truncating it", async () => {
  const output = transcript();
  const runtime = scriptedRuntime(output, {
    size: () => ({ columns: 60, rows: 24 }),
  });

  assertEquals(await runDesk({}, runtime), 0);
  const lines = stripAnsi(output.stdout.join("")).split("\n");
  const first = lines.findIndex((line) => line.includes("Tip:"));
  assert(first >= 0, "the tip line must render");
  const block = [lines[first] ?? ""];
  for (
    let index = first + 1;
    index < lines.length && (lines[index] ?? "").startsWith("  ");
    index += 1
  ) {
    block.push(lines[index] ?? "");
  }
  assert(block.length >= 2, "a 60-column terminal wraps the tip");
  for (const line of block) {
    assert(
      displayWidth(line) <= 60,
      `a tip line exceeds the terminal width: ${JSON.stringify(line)}`,
    );
  }
  assertEquals(
    block
      .map((line, index) =>
        index === 0
          ? line.slice(line.indexOf("Tip:") + "Tip: ".length)
          : line.trimStart()
      )
      .join(" "),
    renderTipCli(registeredTip("standards-first-rule")),
    "wrapping reflows the whole text — nothing is truncated",
  );
});

Deno.test("desk rotates the tip across sessions through the seen-state", async () => {
  const stateRef = { state: freshTipSeenState(DISCERN_VERSION) };
  const shown: string[] = [];
  const session = async (): Promise<void> => {
    const output = transcript();
    const runtime = scriptedRuntime(output, {
      readTipState: () => stateRef.state,
      writeTipState: (_root, state) => {
        stateRef.state = state;
      },
      recordTipShown: (id) => {
        shown.push(id);
      },
    });
    assertEquals(await runDesk({}, runtime), 0);
  };

  await session();
  await session();
  await session();
  // Contextual first (no standards configured), then the curriculum in
  // authored order; entries whose predicates do not hold never surface.
  assertEquals(shown, [
    "standards-first-rule",
    "desk-is-home",
    "status-orients-anywhere",
  ]);
});

Deno.test("desk survives a tip-state failure with a tipless header, no warning", async () => {
  const output = transcript();
  const runtime = scriptedRuntime(output, {
    readTipState: () => {
      throw new Error("tip state unreadable");
    },
  });

  assertEquals(await runDesk({}, runtime), 0);
  assert(
    !joined(output).includes("Tip:"),
    "a failed tip read renders no tip line",
  );
  assertEquals(output.stderr, [], "and warns about nothing");
});

Deno.test("desk renders a reclaimed stage ref as a dim fact, not a missing-worktree warning", async () => {
  const main = fleetEntry("main", ROOT, { is_main: true, is_current: true });
  const live = fleetEntry("agent/stage-c", "/worktrees/stage-c", { ahead: 3 });
  const data: StatusData = {
    ...statusData([main, live]),
    contained_refs: [
      { branch: "agent/stage-a", contained_in: "agent/stage-c" },
    ],
  };
  const output = transcript();
  assertEquals(
    await runDesk(
      {},
      scriptedRuntime(output, {
        status: () => ({ ok: true, data }),
        select: () => QUIT,
      }),
    ),
    0,
  );
  const text = joined(output);
  assertStringIncludes(
    text.replaceAll(/\s+/gu, ""),
    "agent/stage-aremainsinsideagent/stage-cuntilitlands",
  );
  assert(
    !text.includes("has no worktree"),
    `a contained ref must not raise the missing-worktree warning\n${text}`,
  );
  assert(
    !text.includes("start --from"),
    "no resume hint for a deliberately kept ref",
  );
});
