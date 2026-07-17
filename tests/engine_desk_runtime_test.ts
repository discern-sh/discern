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
import type { Out, Palette } from "../src/engine/output.ts";
import { type DeskRuntime, runDesk } from "../src/engine/desk/desk.ts";
import {
  IdentityError,
  type LifecycleContext,
  WorktreeGitError,
} from "../src/engine/worktree/lifecycle.ts";

const ROOT = "/project";
const QUIT = "\x00quit";
const REFRESH = "\x00refresh";
const BACK = "\x00back";
const START_TASK = "\x00start-task";
const NOW = Date.parse("2026-07-11T12:00:00Z");

const CONFIG: DiscernConfig = configSchema.parse({
  project: { slug: "demo", main_branch: "main" },
});

const PLAIN: Palette = {
  reset: "",
  bold: "",
  dim: "",
  red: "",
  green: "",
  yellow: "",
  cyan: "",
};

interface Transcript {
  out: Out;
  stdout: string[];
  stderr: string[];
}

function transcript(): Transcript {
  const stdout: string[] = [];
  const stderr: string[] = [];
  return {
    stdout,
    stderr,
    out: {
      c: PLAIN,
      color: false,
      info: (message) => stdout.push(`info:${message}`),
      ok: (message) => stdout.push(`ok:${message}`),
      warn: (message) => stderr.push(`warn:${message}`),
      error: (message) => stderr.push(`error:${message}`),
      heading: (message) => stdout.push(`heading:${message}`),
      raw: (message) => stdout.push(message),
    },
  };
}

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

function statusData(
  fleet: StatusFleetEntry[] = [],
  location: StatusData["location"] = "main",
): StatusData {
  return {
    location,
    root: ROOT,
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
    canPrompt: () => true,
    findRoot: () => ROOT,
    loadConfig: () => CONFIG,
    status: () => ({ ok: true, data }),
    mainRepoPath: () => ROOT,
    receiptHonored: () => false,
    makeOut: () => output.out,
    error: (message) => output.stderr.push(`console:${message}`),
    select: () => QUIT,
    confirm: () => true,
    input: () => "",
    pause: () => {},
    lifecycle: () => CONTEXT,
    accept: () => {},
    update: () => {},
    drop: () => {},
    git: () => ({ success: true, stdout: "", stderr: "" }),
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
    now: () => NOW,
    ...patch,
  };
}

function joined(output: Transcript): string {
  return [...output.stdout, ...output.stderr].join("\n");
}

Deno.test("desk session renders every fleet class and checks receipts only for healthy efforts", async () => {
  const output = transcript();
  const main = fleetEntry("main", ROOT, {
    is_main: true,
    is_current: true,
    clean: false,
    changed_files: 1,
  });
  const ready = fleetEntry("agent/ready", "/worktrees/ready", { ahead: 2 });
  const flying = fleetEntry("agent/flying", "/worktrees/flying", {
    clean: false,
    changed_files: 3,
  });
  const broken = fleetEntry("agent/broken", "/worktrees/broken", {
    broken: true,
  });
  const unreadable = fleetEntry("agent/unreadable", "/worktrees/unreadable", {
    clean: undefined,
    changed_files: undefined,
    git_unavailable: true,
  });
  const data = {
    ...statusData([main, ready, flying, broken, unreadable]),
    unlanded_branches: ["agent/orphan"],
  };
  const receiptPaths: string[] = [];
  const optionText: string[] = [];
  const runtime = scriptedRuntime(output, {
    status: () => ({ ok: true, data }),
    receiptHonored: (path) => {
      receiptPaths.push(path);
      return path === ready.path;
    },
    select: (options) => {
      optionText.push(JSON.stringify(options.options));
      return QUIT;
    },
  });

  assertEquals(await runDesk({}, runtime), 0);
  assertEquals(receiptPaths, [ready.path, flying.path]);
  const text = joined(output);
  assertStringIncludes(text, "discern desk — demo");
  assertStringIncludes(text, "main: 1 uncommitted change");
  assertStringIncludes(text, "unlanded work with no worktree: agent/orphan");
  for (
    const branch of [
      "agent/ready",
      "agent/flying",
      "agent/broken",
      "agent/unreadable",
    ]
  ) {
    assertStringIncludes(optionText.join("\n"), branch);
  }
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
          assertStringIncludes(String(options.message), "No efforts in flight");
          return REFRESH;
        },
      }),
    ),
    1,
  );
  assertStringIncludes(joined(refreshFailure), "the status survey failed");
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
    "No efforts in flight — start a task or quit",
  );
  assert(
    menus[1]?.message.startsWith(started.branch) ?? false,
    "the new worktree action menu should open without another root-menu choice",
  );
  assertStringIncludes(
    joined(output),
    "discern start --name='desk launchers'",
  );
});

Deno.test("desk leaves the start name unset when the optional prompt is blank", async () => {
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

Deno.test("desk offers only configured agents detected on PATH and launches argv in the worktree", async () => {
  const output = transcript();
  const effort = fleetEntry("agent/agents", "/worktrees/agents");
  const data = statusData([
    fleetEntry("main", ROOT, { is_main: true, is_current: true }),
    effort,
  ]);
  const worktreeConfig = configSchema.parse({
    project: { slug: "demo", main_branch: "main" },
    guidance: { agents: ["claude_code", "codex"] },
  });
  const choices = [
    effort.path,
    "agent",
    "claude_code:open",
    effort.path,
    "agent",
    "claude_code:continue",
    QUIT,
  ];
  const menus: Array<{ message: string; options: string }> = [];
  const launches: Array<{
    command: string;
    args: readonly string[];
    cwd: string;
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
      });
      return choices.shift() ?? QUIT;
    },
    interactive: (command, args, cwd) => {
      launches.push({ command, args, cwd });
      return 0;
    },
  });

  assertEquals(await runDesk({}, runtime), 0);
  assertEquals(launches, [
    { command: "claude", args: [], cwd: effort.path },
    { command: "claude", args: ["--continue"], cwd: effort.path },
  ]);
  const actionMenu = menus.find((menu) =>
    menu.message.startsWith(effort.branch)
  );
  const agentMenu = menus.find((menu) =>
    menu.message.startsWith("Open an agent")
  );
  assert(actionMenu !== undefined);
  assert(agentMenu !== undefined);
  assertStringIncludes(actionMenu.options, "Open with agent");
  assertStringIncludes(agentMenu.options, "Open in Claude Code");
  assertStringIncludes(agentMenu.options, "Continue in Claude Code");
  assert(
    !agentMenu.options.includes("Codex"),
    "configured but absent stays hidden",
  );
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
  });
  const data = statusData([
    fleetEntry("main", ROOT, { is_main: true, is_current: true }),
    effort,
  ]);
  const choices = [effort.path, "inspect", "jump", QUIT];
  const menus: string[] = [];
  const gitResults = [
    { success: true, stdout: "abc123 Explain the change\n", stderr: "" },
    { success: true, stdout: "", stderr: "" },
    { success: false, stdout: "", stderr: "diff unavailable\n" },
  ];
  const shellCalls: Array<{
    command: string;
    args: readonly string[];
    cwd: string;
  }> = [];
  const runtime = scriptedRuntime(output, {
    status: () => ({ ok: true, data }),
    receiptHonored: () => true,
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
    interactive: (command, args, cwd) => {
      shellCalls.push({ command, args, cwd });
      return 0;
    },
  });

  assertEquals(await runDesk({}, runtime), 0);
  assertEquals(shellCalls.length, 1);
  assertEquals(shellCalls[0]?.cwd, effort.path);
  assertEquals(shellCalls[0]?.args, []);
  assert((shellCalls[0]?.command ?? "").length > 0);
  const text = joined(output);
  assertStringIncludes(text, "abc123 Explain the change");
  assertStringIncludes(text, "(none)");
  assertStringIncludes(text, "diff unavailable");
  assertStringIncludes(
    text,
    "gate receipt: this clean HEAD holds a recorded pass",
  );
  const actionMenu = menus.join("\n");
  for (const label of ["Accept", "Update", "Jump in", "Inspect", "Drop"]) {
    assertStringIncludes(actionMenu, label);
  }
  assert(
    !actionMenu.includes("Run Script"),
    "a worktree without executable scripts must not offer Run Script",
  );
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
  const choices = [empty.path, BACK, scripted.path, "script", "deploy", QUIT];
  const menus: Array<{ message: string; options: string }> = [];
  const discoveryRoots: string[] = [];
  const runs: Array<{ root: string; name: string }> = [];
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
    runScript: (root, name) => {
      runs.push({ root, name });
      return 7;
    },
    pause: () => {
      pauses++;
    },
  });

  assertEquals(await runDesk({}, runtime), 0);
  assert(discoveryRoots.includes(empty.path));
  assert(discoveryRoots.includes(scripted.path));
  assertEquals(runs, [{ root: scripted.path, name: "deploy" }]);
  assertEquals(pauses, 1);

  const emptyMenu = menus.find((menu) => menu.message.startsWith(empty.branch));
  const scriptedMenu = menus.find((menu) =>
    menu.message.startsWith(scripted.branch)
  );
  const scriptMenu = menus.find((menu) =>
    menu.message.startsWith("Run a Project Script")
  );
  assert(emptyMenu !== undefined);
  assert(scriptedMenu !== undefined);
  assert(scriptMenu !== undefined);
  assert(!emptyMenu.options.includes("Run Script"));
  assertStringIncludes(scriptedMenu.options, "Run Script");
  assertStringIncludes(scriptMenu.options, "deploy");
  assertStringIncludes(scriptMenu.options, "deploy this checkout");

  const text = joined(output);
  assertStringIncludes(text, "discern script deploy  (in scripted)");
  assertStringIncludes(text, "Project Script exited with status 7");
});

Deno.test("desk lifecycle actions preview, confirm, apply, and contain refusals", async () => {
  const effort = fleetEntry("agent/actions", "/worktrees/actions", {
    ahead: 2,
    behind: 1,
  });
  const main = fleetEntry("main", ROOT, { is_main: true, is_current: true });
  const data = statusData([main, effort]);

  const updateOutput = transcript();
  const updateChoices = [effort.path, "accept", "update", QUIT];
  const confirmations = [false, true];
  const acceptCalls: Array<{ dryRun?: boolean }> = [];
  const updateCalls: Array<{ dryRun?: boolean }> = [];
  let updatePauses = 0;
  assertEquals(
    await runDesk(
      {},
      scriptedRuntime(updateOutput, {
        status: () => ({ ok: true, data }),
        select: () => updateChoices.shift() ?? QUIT,
        confirm: () => confirmations.shift() ?? false,
        accept: (_ctx, opts) => {
          acceptCalls.push(opts);
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
  assertEquals(acceptCalls, [{ dryRun: true }]);
  assertEquals(updateCalls, [{ dryRun: true }, {}]);
  assertEquals(updatePauses, 1);

  const acceptOutput = transcript();
  const acceptChoices = [effort.path, "accept", QUIT];
  const appliedAccept: Array<{ dryRun?: boolean; confirmed?: boolean }> = [];
  let acceptPauses = 0;
  assertEquals(
    await runDesk(
      {},
      scriptedRuntime(acceptOutput, {
        status: () => ({ ok: true, data }),
        select: () => acceptChoices.shift() ?? QUIT,
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
  assertEquals(appliedAccept, [{ dryRun: true }, { confirmed: true }]);
  assertEquals(acceptPauses, 1);

  const dropOutput = transcript();
  const abandoned = fleetEntry("agent/abandoned", "/worktrees/abandoned", {
    broken: true,
  });
  const dropData = statusData([main, abandoned]);
  const dropChoices = [abandoned.path, "drop", QUIT];
  const dropCalls: Array<{ dryRun?: boolean; force?: boolean }> = [];
  let dropPauses = 0;
  assertEquals(
    await runDesk(
      {},
      scriptedRuntime(dropOutput, {
        status: () => ({ ok: true, data: dropData }),
        select: () => dropChoices.shift() ?? QUIT,
        input: () => abandoned.branch,
        drop: (_ctx, _target, opts) => {
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
  assertEquals(dropCalls, [{ dryRun: true }, {}, { force: true }]);
  assertEquals(dropPauses, 1);
  assertStringIncludes(joined(dropOutput), "unlanded work would be discarded");
  assertStringIncludes(joined(dropOutput), "--force");

  const refusalOutput = transcript();
  const refusalChoices = [effort.path, "accept", BACK, QUIT];
  assertEquals(
    await runDesk(
      {},
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
