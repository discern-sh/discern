/**
 * Behavioral coverage for the desk's interactive renderer and dispatcher.
 *
 * A piped test process must never impersonate a TTY, so the production desk
 * exposes its terminal/effect boundary as a runtime. These tests script that
 * boundary and exercise the same session loop the CLI uses: fleet rendering,
 * refresh, inspect, jump, update, acceptance, destructive drop, and lifecycle
 * refusals. No test mutates a real worktree.
 */

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
import type { ConfirmationRequestOptions } from "../src/lib/terminal_interaction.ts";
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
import { DESK_REVIEW_ROUTES } from "../src/engine/desk/view.ts";
import { DESK_ACTIONS, type DeskAction } from "../src/engine/desk/model.ts";
import {
  DESK_SESSION_ENV,
  deskSessionEnv,
} from "../src/engine/desk/session.ts";
import {
  IdentityError,
  type LifecycleContext,
  WorktreeGitError,
} from "../src/engine/worktree/lifecycle.ts";
import {
  freshTipSeenState,
  type TipSeenState,
} from "../src/engine/desk/tips.ts";
import { renderTipCli, TIPS } from "../src/shared/tips.ts";
import { KIT_VERSION } from "../src/lib/version.ts";
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
      grant: {
        branch,
        granted_at: "2026-07-11T12:00:00.000Z",
      },
    }),
    clearEffortGrantPlan: () => ({
      title: "Landing pre-authorization revocation plan",
      details: [],
      steps: [],
    }),
    clearEffortGrant: () => true,
    makeOut: () => output.out,
    error: (message) => output.stderr.push(`console:${message}`),
    select: () => QUIT,
    confirm: () => true,
    input: () => "",
    pause: () => {},
    lifecycle: () => CONTEXT,
    done: () => ({ ok: true, verb: "done" }),
    donePlan: () => ({ ok: true, verb: "done" }),
    acceptPlan: () => ({ ok: true, verb: "accept" }),
    accept: () => {},
    update: () => {},
    updatePlan: () => ({ ok: true, verb: "update" }),
    drop: () => {},
    dropPlan: () => ({ title: "Drop plan", details: [], steps: [] }),
    reclaim: () => {},
    reclaimPlan: () => ({ title: "Reclaim plan", details: [], steps: [] }),
    git: () => ({ success: true, stdout: "", stderr: "" }),
    proof: () => ({ status: "missing" }),
    pager: () => ({ shown: true }),
    editor: () => ({ reason: "No editor configured." }),
    openEditor: () => 0,
    interactive: () => 0,
    detectAgents: () => [],
    start: () => ({
      id: "new-task",
      branch: "agent/new-task",
      path: "/worktrees/new-task",
      from: "main",
    }),
    scripts: () => [],
    runScript: () => 0,
    openBrowser: (url) => ({
      status: "opened",
      launch: { command: "open", args: [url] },
    }),
    now: () => NOW,
    readTipState: () => freshTipSeenState(KIT_VERSION),
    writeTipState: () => {},
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

Deno.test("desk-owned Project Scripts receive the desk-session marker", async () => {
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
        deskSessionEnv(),
      ),
      0,
    );
    assertEquals(await Deno.readTextFile(`${dir}/desk-session.txt`), "1");
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
  assert(!options.includes("agent/"), "fleet rows should lead with task names");
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
        grant: {
          branch,
          granted_at: "2026-07-11T12:00:00.000Z",
        },
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
    `${effort.branch} may land once green without a further conversation.`,
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
  assertStringIncludes(joined(noProject), "Run `discern setup`");

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
            "Choose a Desk command",
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
  const started: StartData = {
    id: "desk-launchers",
    branch: startedEntry.branch,
    path: startedEntry.path,
    from: "main",
  };
  let hasStarted = false;
  const choices = [START_TASK, BACK, QUIT];
  const menus: Array<{ message: string; options: string }> = [];
  const starts: Array<{ worktreeRoot: string; name?: string }> = [];
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
    start: (_ctx, opts) => {
      starts.push(opts);
      hasStarted = true;
      return started;
    },
  });

  assertEquals(await runDesk({}, runtime), 0);
  assertEquals(starts, [{
    worktreeRoot: "/project.worktrees",
    name: "desk launchers",
  }]);
  assertStringIncludes(menus[0]?.options ?? "", "Start a task");
  assertStringIncludes(
    menus[0]?.message ?? "",
    "Choose a Desk command",
  );
  assert(
    menus[1]?.message === "Choose an action",
    "the new worktree action menu should open without another root-menu choice",
  );
  assertStringIncludes(
    joined(output),
    "discern start --name='desk launchers'",
  );
});

Deno.test("desk leaves the start name unset when the optional request is blank", async () => {
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
  const choices = [START_TASK, BACK, QUIT];
  const starts: Array<{ worktreeRoot: string; name?: string }> = [];
  const runtime = scriptedRuntime(output, {
    status: () => ({
      ok: true,
      data: statusData(hasStarted ? [main, random] : [main]),
    }),
    select: () => choices.shift() ?? QUIT,
    input: () => "   ",
    start: (_ctx, opts) => {
      starts.push(opts);
      hasStarted = true;
      return {
        id: "random-codename",
        branch: random.branch,
        path: random.path,
        from: "main",
      };
    },
  });

  assertEquals(await runDesk({}, runtime), 0);
  assertEquals(starts, [{ worktreeRoot: "/project.worktrees" }]);
  assertStringIncludes(joined(output), "→ discern start");
  assert(!joined(output).includes("--name="));
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
  const actionMenu = menus.find((menu) => menu.message === "Choose an action");
  const agentMenu = menus.find((menu) =>
    menu.message.startsWith("Choose an agent for Agents")
  );
  const boardMenu = menus.find((menu) =>
    menu.message === "Choose a task or Desk command"
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
    `claude --continue  (cwd: ${effort.path})`,
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
    { success: true, stdout: "", stderr: "" },
    { success: true, stdout: "M\tsrc/desk.ts\n", stderr: "" },
    { success: true, stdout: " M src/desk.ts\n", stderr: "" },
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
    runScript: (root, name, env) => {
      runs.push({ root, name, env });
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
  assertStringIncludes(text, "discern scripts deploy  (in scripted)");
  assertStringIncludes(text, "Project Script exited with status 7");
});

Deno.test("desk offers and runs Project Scripts from the project root", async () => {
  const output = transcript();
  const choices = [RUN_PROJECT_SCRIPT, "health", "run", QUIT];
  const menus: Array<{ message: string; options: string }> = [];
  const runs: Array<{
    root: string;
    name: string;
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
    runScript: (root, name, env) => {
      runs.push({ root, name, env });
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
    "discern scripts health  (in project root)",
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
    grant: {
      choices: ["grant", BACK, QUIT],
      runtime: (effects: DeskAction[]) => ({
        grantEffort: (_path, branch) => {
          effects.push("grant");
          return {
            status: "granted",
            grant: { branch, granted_at: "2026-07-11T12:00:00.000Z" },
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
  assertEquals(appliedAccept, [{
    confirmed: true,
    cliModel: TEST_CLI_MODEL,
  }]);
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
  assertStringIncludes(message, "gate proof included");
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
    countOccurrences(plainTranscript, "A Standard is a quality measure"),
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
  const stateRef = { state: freshTipSeenState(KIT_VERSION) };
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
