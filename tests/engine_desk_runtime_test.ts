/**
 * Behavioral coverage for the live Desk over the real package runtime.
 *
 * Each case starts the Desk on a fake terminal and a manual clock, drives it
 * with real keys, and records what reached the runtime seams: plans read
 * before a review, effects applied after its confirm, children and scripts
 * with their exact argv, refusals contained as messages, and the refreshed
 * observation afterwards. No test here mutates a real worktree.
 *
 * Guards: boundary:agent-runtime-boundary, boundary:invoked-process-lifecycle
 */

import { assert, assertEquals, assertStringIncludes } from "@std/assert";
import { fire, HINTS, hintTexts } from "../src/shared/hints.ts";
import {
  chooseManualEarly,
  DESK_MANUAL_FIXTURE,
  DESK_ROOT,
  type DeskSession,
  deskSession,
  deskSurvey,
  deskTaskEntry,
  deskTranscript,
  joinedTranscript,
  preparedStart,
  scriptedDeskRuntime,
  scriptedTermination,
  startedTask,
  withDeskSession,
} from "./fixtures/desk_session.ts";
import type { DocsBrowserRequest } from "../src/commands/docs.ts";
import { fixtureEffortGrant } from "./effort_grant_fixtures.ts";
import { configSchema } from "../src/shared/config_schema.ts";
import type {
  StartData,
  StatusData,
  StatusFleetEntry,
} from "../src/shared/result_schemas.ts";
import { exceptionProof } from "./status_fleet.ts";
import {
  type DeskRuntime,
  runDesk,
  runDeskInteractiveChild,
  runDeskProjectScript,
} from "../src/engine/desk/desk.ts";
import { parseProjectScriptArguments } from "../src/engine/desk/literal_argv.ts";
import { DESK_ACTIONS, type DeskAction } from "../src/engine/desk/model.ts";
import {
  landedRowId,
  parkedRowId,
} from "../src/engine/desk/desk_transitions.ts";
import {
  DESK_SESSION_ENV,
  deskSessionEnv,
  inDeskSession,
  withoutDeskSessionEnv,
} from "../src/engine/desk/session.ts";
import type { DropPlan } from "../src/engine/worktree/plan.ts";
import {
  DropWouldDiscardWork,
  IdentityError,
  type PreparedStart,
  WorktreeGitError,
} from "../src/engine/worktree/lifecycle.ts";
import { freshTipSeenState } from "../src/engine/desk/tips.ts";
import { DISCERN_VERSION } from "../src/lib/version.ts";
import { DISCERN_DOCS_URL } from "../src/shared/brand.ts";
import {
  DESK_LIST_ID,
  DESK_REFRESH_MS,
} from "../src/engine/desk/desk_state.ts";
import { DESK_SELECTION_SETTLE_MS } from "../src/engine/desk/live.ts";
import { ON_DISK_FORMATS } from "../src/shared/on_disk_formats.ts";
import { withTempDir } from "./helpers.ts";
import { gitInit, scaffoldEngine, writeExecutable } from "./engine_helpers.ts";
import { TEST_CLI_MODEL } from "./cli_model.ts";

const START_COMMIT = "a".repeat(40);

/** A status seam that answers every survey with `data()`. */
function surveys(
  data: () => StatusData,
): Pick<DeskRuntime, "status"> {
  return { status: () => ({ ok: true, data: data() }) };
}

/** Open a task's action menu and run one action from it. */
async function runAction(
  desk: DeskSession,
  taskId: string,
  action: DeskAction,
): Promise<void> {
  await desk.select(taskId);
  await desk.press(".");
  await desk.opened("actions");
  await desk.choose(action);
}

/** Move focus to a form field. */
async function focusField(
  desk: DeskSession,
  fieldId: string,
): Promise<void> {
  const layer = desk.top();
  assert(layer !== undefined, "no form is open");
  for (let step = 0; step < 30; step += 1) {
    const state = desk.state().layers[layer];
    if (state?.focusedControlId === `field:${fieldId}`) return;
    if (
      state?.focusedControlId === "group:options" &&
      !state.open.includes("options")
    ) {
      await desk.press("enter");
      continue;
    }
    await desk.press("tab");
  }
  throw new Error(`${layer} has no field ${fieldId}`);
}

/** Replace a text field's value. */
async function fill(
  desk: DeskSession,
  fieldId: string,
  text: string,
): Promise<void> {
  await focusField(desk, fieldId);
  const layer = desk.top() ?? "";
  const current = desk.state().fields[layer]?.[fieldId] ?? "";
  if (current !== "") {
    await desk.press("ctrl-e");
    await desk.type("\x7f".repeat([...current].length));
  }
  if (text !== "") await desk.type(text);
}

/** Cycle a choice field to one option. */
async function pick(
  desk: DeskSession,
  fieldId: string,
  value: string,
): Promise<void> {
  await focusField(desk, fieldId);
  const layer = desk.top() ?? "";
  for (let step = 0; step < 20; step += 1) {
    if (desk.state().fields[layer]?.[fieldId] === value) return;
    await desk.press("right");
  }
  throw new Error(`${fieldId} never offered ${value}`);
}

/** A Drop plan's subject for a task, discarding `blockers`. */
function dropSubject(
  entry: StatusFleetEntry,
  blockers: readonly string[],
): DropPlan {
  return {
    targetPath: entry.path,
    id: entry.id ?? entry.path,
    branch: entry.branch,
    deleteBranch: true,
    preserveHead: true,
    blockers: [...blockers],
    entries: [],
    head: "a".repeat(40),
    endsGrant: false,
    leavesQueue: false,
  };
}

/** Close the top layer with Escape and wait for it to go. */
async function close(desk: DeskSession): Promise<void> {
  const layer = desk.top();
  await desk.escape(() => desk.top() !== layer, `${layer} to close`);
}

/** Start seams that record each request and add the started task to later surveys. */
interface ScriptedStart {
  readonly requests: Array<Parameters<DeskRuntime["startPlan"]>[1]>;
  /** The task `start` produced, once it ran. */
  created(): StartData | undefined;
  /** A survey of `fleet`, plus the started task once it exists. */
  survey(
    fleet: readonly StatusFleetEntry[],
    patch?: Partial<StatusData>,
  ): StatusData;
  startPlan(
    ctx: unknown,
    request: Parameters<DeskRuntime["startPlan"]>[1],
  ): PreparedStart;
  start(ctx: unknown, prepared: PreparedStart): StartData;
}

/** Task creation seams that add the started task to later surveys. */
function scriptedStart(
  plan: Partial<PreparedStart["plan"]> = {},
): ScriptedStart {
  const requests: Array<Parameters<DeskRuntime["startPlan"]>[1]> = [];
  let created: StartData | undefined;
  return {
    requests,
    created: (): StartData | undefined => created,
    survey: (
      fleet: readonly StatusFleetEntry[],
      patch: Partial<StatusData> = {},
    ): StatusData =>
      deskSurvey([
        ...fleet,
        ...(created === undefined ? [] : [
          deskTaskEntry(created.branch, created.path, {
            id: created.id,
            task: created.task,
          }),
        ]),
      ], patch),
    startPlan: (
      _ctx: unknown,
      request: Parameters<DeskRuntime["startPlan"]>[1],
    ): PreparedStart => {
      requests.push(request);
      return preparedStart(request.title ?? "Generated title", {
        ...plan,
        from: request.from ?? "main",
        ...(request.brief === undefined ? {} : { brief: request.brief }),
      });
    },
    start: (_ctx: unknown, prepared: PreparedStart): StartData => {
      created = startedTask(prepared);
      return created;
    },
  };
}

Deno.test("the desk-session overlays mark and neutralize the one key inDeskSession reads", () => {
  const reader = (
    overlay: Record<string, string>,
  ): { get: (name: string) => string | undefined } => ({
    get: (name) => overlay[name],
  });
  assertEquals(Object.keys(deskSessionEnv()), [DESK_SESSION_ENV]);
  assertEquals(Object.keys(withoutDeskSessionEnv()), [DESK_SESSION_ENV]);
  assertEquals(inDeskSession(reader(deskSessionEnv())), true);
  assertEquals(inDeskSession(reader(withoutDeskSessionEnv())), false);
  assertEquals(
    inDeskSession(reader({ ...deskSessionEnv(), ...withoutDeskSessionEnv() })),
    false,
    "the neutralizing overlay must win over an inherited marker it is merged after",
  );
});

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
      args: ["--target", "review environment", "", "--literal=$HOME", "a;b"],
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

Deno.test("the Desk refuses before surveying when it cannot run here", async () => {
  let surveyed = false;
  const status = () => {
    surveyed = true;
    return { ok: true, data: deskSurvey() };
  };

  const nested = deskTranscript();
  assertEquals(
    await runDesk(
      {},
      scriptedDeskRuntime(nested, { inDeskSession: () => true, status }),
    ),
    1,
  );
  assertStringIncludes(joinedTranscript(nested), "already active");
  assert(!joinedTranscript(nested).includes("cd /"));

  const noProject = deskTranscript();
  assertEquals(
    await runDesk(
      {},
      scriptedDeskRuntime(noProject, { findRoot: () => undefined, status }),
    ),
    1,
  );
  assertStringIncludes(
    joinedTranscript(noProject),
    "Run the read-only `discern setup` welcome, then `discern setup begin`",
  );

  const worktree = deskTranscript();
  assertEquals(
    await runDesk(
      {},
      scriptedDeskRuntime(worktree, {
        mainRepoPath: () => "/main-checkout",
        status,
      }),
    ),
    0,
  );
  assertStringIncludes(joinedTranscript(worktree), "cd /main-checkout");
  assertStringIncludes(joinedTranscript(worktree), "discern status");
  assertEquals(surveyed, false);
});

Deno.test("a failed survey keeps the Desk open, and Refresh replaces the list from a fresh one", async () => {
  let calls = 0;
  const results: Array<() => Awaited<ReturnType<DeskRuntime["status"]>>> = [
    () => ({ ok: false, message: "status is unavailable" }),
    () => ({ ok: true, data: deskSurvey() }),
    () => ({
      ok: true,
      data: deskSurvey([
        deskTaskEntry("agent/newly-created", "/worktrees/newly-created", {
          id: "newly-created",
        }),
      ]),
    }),
    () => ({ ok: false, message: "status is unavailable" }),
  ];
  await withDeskSession({
    runtime: {
      status: () => {
        const result = results[Math.min(calls, results.length - 1)];
        calls += 1;
        assert(result !== undefined);
        return result();
      },
    },
  }, async (desk) => {
    await desk.shows("Retrying");
    await desk.press("r");
    await desk.until(() => calls === 2, "the second survey");
    await desk.shows("Live");
    assert(!desk.screen().includes("Newly created"));
    await desk.press("r");
    await desk.until(() => calls === 3, "the third survey");
    desk.settle();
    await desk.shows("Newly created");
    await desk.press("r");
    await desk.shows("Retrying");
    assertStringIncludes(desk.screen(), "Newly created");
  });
});

Deno.test("the Desk rotates its tip across sessions and survives a tip-state failure", async () => {
  const seen = { state: freshTipSeenState(DISCERN_VERSION) };
  const shown: string[] = [];
  for (let session = 0; session < 3; session += 1) {
    await withDeskSession({
      runtime: {
        readTipState: () => seen.state,
        writeTipState: (_root, state) => {
          seen.state = state;
        },
        recordTipShown: (id) => {
          shown.push(id);
        },
      },
    }, async (desk) => {
      await desk.until(() => shown.length === session + 1, "the tip shown");
      await desk.shows("Tip");
    });
  }
  assertEquals(shown, [
    "standards-first-rule",
    "desk-is-home",
    "status-orients-anywhere",
  ]);

  const output = deskTranscript();
  await withDeskSession({
    output,
    runtime: {
      readTipState: () => {
        throw new Error("tip state unreadable");
      },
    },
  }, async (desk) => {
    await desk.shows("Live");
    assert(!desk.screen().includes("Tip"), "a failed tip read shows no tip");
    // Tip of the session says so rather than waiting for one.
    await desk.palette("Tip of the session", "tip");
    await desk.shows("This session has no tip.");
  });
  assertEquals(output.stderr, [], "and warns about nothing");
});

Deno.test("the main checkout's hints are the owner's, with commands as code", async () => {
  const hints = hintTexts([
    fire(HINTS["status-start-on-trunk"]),
    fire(HINTS["completion-pending"], {
      action: "Run `discern status` and follow its next action.",
    }),
  ]);
  await withDeskSession({
    runtime: {
      status: () => ({ ok: true, data: deskSurvey([]), hints }),
    },
  }, async (desk) => {
    await desk.palette("Main checkout", "main_checkout");
    await desk.opened("reader-main");
    await desk.shows("Run discern status and follow its next action.");
    assert(
      !desk.screen().includes("Keep one worktree"),
      "agent-directed hints stay on the wire",
    );
    assert(!desk.screen().includes("`"), "code spans show as code");
  });
});

Deno.test("the main checkout is inspectable without offering agent work", async () => {
  const commands: string[][] = [];
  const pages: string[] = [];
  await withDeskSession({
    runtime: {
      ...surveys(() =>
        deskSurvey([], {
          fleet: [{
            path: DESK_ROOT,
            is_main: true,
            is_current: true,
            branch: "main",
            clean: false,
            changed_files: 2,
            ahead: 0,
            behind: 0,
          }],
        })
      ),
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
    },
  }, async (desk) => {
    await desk.palette("Main checkout", "main_checkout");
    await desk.opened("reader-main");
    assert(!desk.screen().includes("Open agent"));
    await desk.press("o");
    await desk.until(() => pages.length === 1, "the main checkout's diff");
    await desk.opened("reader-main");
    await close(desk);
  });
  assertEquals(commands, [
    ["status", "--short", "--branch"],
    ["diff", "--stat", "HEAD"],
  ]);
  assertStringIncludes(pages[0] ?? "", "src/main.ts");
  assertStringIncludes(pages[0] ?? "", "notes.txt");
});

Deno.test("a recent landing reads its stored Proof, or says why it can't", async () => {
  const landed = {
    branch: "agent/completed",
    head: "abc1234",
    completed_at: "2026-07-11T11:58:00.000Z",
    proof_line: "Proof: agent/completed abc1234 · gate passed",
  };
  let pauses = 0;
  await withDeskSession({
    runtime: {
      ...surveys(() => deskSurvey([], { recent_completed_tasks: [landed] })),
      git: () => ({
        success: false,
        stdout: "",
        stderr: "Recorded revision is unavailable",
      }),
      pause: () => {
        pauses += 1;
      },
    },
  }, async (desk) => {
    await desk.select(landedRowId(landed.branch, landed.completed_at));
    await desk.press("enter");
    await desk.opened("reader-landed");
    await desk.shows("Recorded revision is unavailable");
    await close(desk);
  });
  assertEquals(pauses, 0);
});

Deno.test("every registered Desk action reaches its shared runtime effect", async () => {
  interface ActionCase {
    readonly entry?: Partial<StatusFleetEntry>;
    readonly cliModel?: boolean;
    readonly runtime: (effects: DeskAction[]) => Partial<DeskRuntime>;
    /** What follows choosing the action from its menu. */
    readonly finish: (
      desk: DeskSession,
      effects: DeskAction[],
    ) => Promise<void>;
  }
  const review = async (desk: DeskSession): Promise<void> => {
    await desk.until(
      () => desk.top()?.startsWith("review-") ?? false,
      "the review to open",
    );
    await desk.confirm();
  };
  const cases: Readonly<Record<DeskAction, ActionCase>> = {
    recovery: {
      entry: { broken: true },
      runtime: () => ({}),
      finish: async (desk, effects) => {
        await desk.opened("reader-recovery");
        effects.push("recovery");
      },
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
      runtime: (effects) => ({
        setup: () => {
          effects.push("retry_setup");
        },
      }),
      finish: review,
    },
    done: {
      entry: { ahead: 1, gate_proof: { status: "missing" } },
      cliModel: true,
      runtime: (effects) => ({
        done: () => {
          effects.push("done");
          return { ok: true, verb: "done" };
        },
      }),
      finish: review,
    },
    submit: {
      entry: { ahead: 1, gate_proof: { status: "honored" } },
      runtime: (effects) => ({
        submit: (path, options) => {
          if (options.dryRun !== true) effects.push("submit");
          return {
            ok: true,
            verb: "accept",
            data: {
              revision: {
                path,
                branch: "agent/test",
                head: "a".repeat(40),
                proof: { candidate_id: "candidate", proof_id: "proof" },
              },
              submission: {
                state: options.dryRun === true ? "planned" : "queued",
                authority: { kind: "authorized" },
              },
            },
          };
        },
      }),
      finish: review,
    },
    accept: {
      entry: {
        ahead: 1,
        proof_honored: true,
        gate_proof: { status: "honored" },
      },
      cliModel: true,
      runtime: (effects) => ({
        accept: () => {
          effects.push("accept");
        },
      }),
      finish: review,
    },
    update: {
      entry: { ahead: 1, behind: 1 },
      runtime: (effects) => ({
        update: () => {
          effects.push("update");
        },
      }),
      finish: review,
    },
    agent: {
      runtime: (effects) => ({
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
      finish: async (desk) => {
        if (desk.top() === "agents") await desk.choose("claude_code:open");
      },
    },
    follow_up: {
      runtime: (effects) => ({
        start: (_ctx, prepared) => {
          effects.push("follow_up");
          return startedTask(prepared);
        },
      }),
      finish: async (desk) => {
        await desk.opened("form-follow_up-review");
        await fill(desk, "title", "Follow-up task");
        await desk.confirm();
      },
    },
    scripts: {
      runtime: (effects) => ({
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
      finish: async (desk) => {
        await desk.opened("scripts");
        await desk.choose("verify");
        await desk.opened("form-scripts-review");
        await desk.confirm();
      },
    },
    jump: {
      runtime: (effects) => ({
        interactive: () => {
          effects.push("jump");
          return 0;
        },
      }),
      finish: () => Promise.resolve(),
    },
    inspect: {
      runtime: (effects) => ({
        proof: () => {
          effects.push("inspect");
          return { status: "missing" };
        },
      }),
      finish: async (desk) => {
        await desk.opened("reader-changes");
      },
    },
    rename: {
      runtime: (effects) => ({
        rename: (_ctx, title) => {
          effects.push("rename");
          return {
            ok: true,
            verb: "worktree rename",
            message: `Changed the task title to ${JSON.stringify(title)}.`,
          };
        },
      }),
      finish: async (desk) => {
        await desk.opened("form-rename-review");
        await fill(desk, "title", "A clearer task title");
        await desk.confirm();
      },
    },
    grant: {
      runtime: (effects) => ({
        grantEffort: (_path, branch) => {
          effects.push("grant");
          return { status: "granted", grant: fixtureEffortGrant(branch) };
        },
      }),
      finish: review,
    },
    revoke_grant: {
      entry: {
        landing_authority: { kind: "authorized", source: "effort-grant" },
      },
      runtime: (effects) => ({
        clearEffortGrant: () => {
          effects.push("revoke_grant");
          return true;
        },
      }),
      finish: review,
    },
    reclaim: {
      entry: { ahead: 1, contained_in: "agent/later" },
      runtime: (effects) => ({
        reclaim: () => {
          effects.push("reclaim");
        },
      }),
      finish: review,
    },
    park: {
      runtime: (effects) => ({
        park: () => {
          effects.push("park");
        },
      }),
      finish: review,
    },
    drop: {
      entry: { broken: true },
      runtime: (effects) => ({
        drop: () => {
          effects.push("drop");
        },
      }),
      finish: review,
    },
  };
  assertEquals(Object.keys(cases).sort(), [...DESK_ACTIONS].sort());

  for (const action of DESK_ACTIONS) {
    const testCase = cases[action];
    const effort = deskTaskEntry(
      `agent/action-${action}`,
      "/worktrees/action-class",
      { id: "action-class", ...testCase.entry },
    );
    const effects: DeskAction[] = [];
    let discovered = 0;
    const runtime = testCase.runtime(effects);
    const detect = runtime.detectAgents;
    await withDeskSession({
      ...(testCase.cliModel === true ? { cliModel: TEST_CLI_MODEL } : {}),
      runtime: {
        ...surveys(() => deskSurvey([effort])),
        ...runtime,
        detectAgents: async () => {
          discovered += 1;
          return detect === undefined ? [] : await detect();
        },
      },
    }, async (desk) => {
      await desk.select("action-class");
      await desk.until(() => discovered > 0, `${action}: capabilities read`);
      await desk.press(".");
      await desk.opened("actions");
      await desk.choose(action);
      await testCase.finish(desk, effects);
      await desk.until(
        () => effects.includes(action),
        `${action} to reach its runtime effect`,
      );
    });
  }
});

Deno.test("Pre-authorize and Revoke reach their writers only through their reviews", async () => {
  const effort = deskTaskEntry("agent/overnight", "/worktrees/overnight", {
    id: "overnight",
    ahead: 2,
  });
  let granted = false;
  const grants: Array<{ path: string; branch: string }> = [];
  const revokes: string[] = [];
  const grantPlans: string[] = [];
  const revokePlans: string[] = [];
  let pauses = 0;
  await withDeskSession({
    runtime: {
      ...surveys(() =>
        deskSurvey([{
          ...effort,
          ...(granted
            ? {
              landing_authority: {
                kind: "authorized" as const,
                source: "effort-grant" as const,
              },
            }
            : {}),
        }])
      ),
      grantEffortPlan: (path) => {
        grantPlans.push(path);
        return {
          title: "Landing pre-authorization plan",
          details: [],
          steps: [],
        };
      },
      grantEffort: (path, branch) => {
        grants.push({ path, branch });
        granted = true;
        return { status: "granted", grant: fixtureEffortGrant(branch) };
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
        pauses += 1;
      },
    },
  }, async (desk) => {
    await desk.select("overnight");
    await desk.press("g");
    await desk.opened("review-grant-review");
    await desk.shows("Let Overnight land without asking?");
    assert(!desk.screen().includes("discern grant"));
    await desk.confirm();
    await desk.until(() => grants.length === 1, "the grant");
    await desk.shows("Pre-authorized Overnight");
    while (desk.top() !== undefined) await close(desk);
    await runAction(desk, "overnight", "revoke_grant");
    await desk.opened("review-revoke_grant-review");
    await desk.confirm();
    await desk.until(() => revokes.length === 1, "the revocation");
    await desk.shows("Revoked pre-authorization for Overnight");
  });
  assertEquals(grants, [{ path: effort.path, branch: effort.branch }]);
  assertEquals(revokes, [effort.path]);
  assertEquals(grantPlans, [effort.path]);
  // The review reads the grant record, and the revoke reads it again.
  assertEquals(revokePlans, [effort.path, effort.path]);
  assertEquals(pauses, 0);
});

Deno.test("after a grant the Desk offers only the landings the task can make now", async () => {
  const cases = [
    {
      name: "ready work",
      proof: { status: "honored" as const },
      offered: ["Land…", "Queue for landing…"],
    },
    {
      name: "an exception",
      proof: {
        status: "honored" as const,
        proof_data: exceptionProof(["exactness"]),
      },
      offered: [],
    },
  ];
  for (const testCase of cases) {
    let granted = false;
    await withDeskSession({
      runtime: {
        ...surveys(() =>
          deskSurvey([
            deskTaskEntry("agent/granted", "/worktrees/granted", {
              id: "granted",
              ahead: 2,
              gate_proof: testCase.proof,
              ...(granted
                ? {
                  landing_authority: {
                    kind: "authorized" as const,
                    source: "effort-grant" as const,
                  },
                }
                : {}),
            }),
          ])
        ),
        grantEffort: (_path, branch) => {
          granted = true;
          return { status: "granted", grant: fixtureEffortGrant(branch) };
        },
      },
    }, async (desk) => {
      await runAction(desk, "granted", "grant");
      await desk.confirm();
      await desk.until(() => granted, `${testCase.name}: granted`);
      if (testCase.offered.length === 0) {
        await desk.shows("Pre-authorized Granted");
        assertEquals(desk.top(), undefined, "nothing more to decide");
        return;
      }
      await desk.opened("review-grant-granted");
      for (const label of testCase.offered) await desk.shows(label);
      await close(desk);
    });
  }
});

Deno.test("Pre-authorize stays available while final checks run", async () => {
  await withDeskSession({
    runtime: surveys(() =>
      deskSurvey([
        deskTaskEntry("agent/running-gate", "/worktrees/running-gate", {
          id: "running-gate",
          ahead: 2,
          gate_proof: { status: "honored" },
          running: {
            verb: "done",
            started: "2026-07-11T11:59:00.000Z",
            elapsed_ms: 60_000,
            typical_duration_ms: 60_000,
          },
        }),
      ])
    ),
  }, async (desk) => {
    await desk.select("running-gate");
    await desk.press("g");
    await desk.opened("review-grant-review");
    await close(desk);
  });
});

Deno.test("Rename changes only the recorded title, through its form and review", async () => {
  const branch = "agent/stable-identity";
  const path = "/worktrees/stable-identity";
  const newTitle = "Renamed: Unicode 修复";
  let title = "Original title";
  const previews: string[] = [];
  const applies: string[] = [];
  const entry = (): StatusFleetEntry =>
    deskTaskEntry(branch, path, {
      id: "stable-identity",
      task: {
        id: "stable-identity",
        branch,
        title,
        title_source: "recorded",
        brief: "Keep this brief.",
        created_from: { ref: "main", commit: START_COMMIT },
      },
    });
  await withDeskSession({
    runtime: {
      ...surveys(() => deskSurvey([entry()])),
      renamePlan: (_ctx, next) => {
        previews.push(next);
        return {
          ok: true,
          verb: "worktree rename",
          dry_run: true,
          plan: {
            title: "Task title plan",
            details: [`Branch: ${branch}`, `New title: ${next}`],
            steps: [],
          },
        };
      },
      rename: (_ctx, next) => {
        applies.push(next);
        title = next;
        return {
          ok: true,
          verb: "worktree rename",
          message: `Changed the task title to ${JSON.stringify(next)}.`,
        };
      },
    },
  }, async (desk) => {
    await desk.select("stable-identity");
    await desk.press("e");
    await desk.opened("form-rename-review");
    assertEquals(
      desk.state().fields["form-rename-review"]?.title,
      "Original title",
    );
    await fill(desk, "title", newTitle);
    // The technical plan is the core's own preview of the typed title.
    await desk.settleForm();
    await desk.press("ctrl-t");
    // The plan lays its details out as label and value.
    await desk.until(
      () => /New title\s+Renamed: Unicode 修复/u.test(desk.screen()),
      "the plan's new title",
    );
    await desk.confirm();
    await desk.until(() => applies.length === 1, "the rename");
    await desk.shows(newTitle);
  });
  assertEquals(previews, [newTitle]);
  assertEquals(applies, [newTitle]);
  assertEquals(entry().branch, branch);
  assertEquals(entry().path, path);
  assertEquals(entry().task?.brief, "Keep this brief.");
});

Deno.test("Run checks reads its plan, runs the shared core once, and Cancel runs nothing", async () => {
  let finished = false;
  let planCalls = 0;
  let doneCalls = 0;
  const effort = (): StatusFleetEntry =>
    deskTaskEntry("agent/final-checks", "/worktrees/final-checks", {
      id: "final-checks",
      ahead: 2,
      gate_proof: finished
        ? {
          status: "honored",
          proof_line: "Proof: agent/final-checks abc1234 · gate passed in 1m",
        }
        : { status: "missing" },
      ...(finished ? { proof_honored: true } : {}),
    });
  await withDeskSession({
    cliModel: TEST_CLI_MODEL,
    runtime: {
      ...surveys(() => deskSurvey([effort()])),
      donePlan: () => {
        planCalls += 1;
        return {
          ok: true,
          verb: "done",
          plan: {
            title: "Final checks plan",
            details: ["Runs the gate"],
            steps: [],
          },
        };
      },
      done: () => {
        doneCalls += 1;
        finished = true;
        return { ok: true, verb: "done" };
      },
    },
  }, async (desk) => {
    await desk.select("final-checks");
    await desk.press("c");
    await desk.opened("review-done-review");
    await close(desk);
    assertEquals(doneCalls, 0, "Cancel runs nothing");
    await desk.press("c");
    await desk.opened("review-done-review");
    await desk.shows("Runs this project's checks here");
    await desk.press("d");
    await desk.shows("Runs the gate");
    await desk.confirm();
    await desk.until(() => doneCalls === 1, "the checks");
    await desk.shows("Ready");
  });
  assertEquals(planCalls, 2);
  assertEquals(doneCalls, 1);
});

Deno.test("a failed final check or landing keeps its details in a result sheet", async () => {
  for (const action of ["done", "accept"] as const) {
    const failure = {
      ok: false as const,
      verb: action,
      error: "precondition_failed" as const,
      message: "The selected revision needs another review.",
      hints: ["Read the current Proof before retrying."],
    };
    await withDeskSession({
      cliModel: TEST_CLI_MODEL,
      runtime: {
        ...surveys(() =>
          deskSurvey([
            deskTaskEntry("agent/reading", "/worktrees/reading", {
              id: "reading",
              ahead: 1,
              gate_proof: {
                status: action === "done" ? "missing" : "honored",
              },
              ...(action === "accept" ? { proof_honored: true } : {}),
            }),
          ])
        ),
        done: () => failure,
        accept: () => failure,
      },
    }, async (desk) => {
      await runAction(desk, "reading", action);
      await desk.confirm();
      await desk.opened("result");
      await desk.shows(failure.message);
      assertEquals(
        desk.state().layers.result?.focusedControlId,
        "button:safe",
        `${action}: the result sheet opens on Close`,
      );
      await desk.press("o");
      await desk.shows(failure.hints[0] ?? "");
      await close(desk);
      assertEquals(
        desk.state().lists.inbox?.selectedId,
        "reading",
        `${action}: the sheet returns to the selected task`,
      );
    });
  }
});

Deno.test("Update, Land and Drop preview, confirm, apply, and contain refusals", async () => {
  const updateCalls: Array<{ dryRun?: boolean }> = [];
  let updatePlans = 0;
  await withDeskSession({
    runtime: {
      ...surveys(() =>
        deskSurvey([
          deskTaskEntry("agent/actions", "/worktrees/actions", {
            id: "actions",
            ahead: 2,
            behind: 1,
            gate_proof: { status: "honored" },
          }),
        ])
      ),
      updatePlan: () => {
        updatePlans += 1;
        return { ok: true, verb: "update" };
      },
      update: (_ctx, options) => {
        updateCalls.push(options);
      },
    },
  }, async (desk) => {
    await desk.select("actions");
    await desk.press("u");
    await desk.opened("review-update-review");
    await desk.confirm();
    await desk.until(() => updateCalls.length === 1, "the update");
  });
  assertEquals(updatePlans, 1);
  assertEquals(updateCalls, [{}]);

  const applied: Array<Parameters<DeskRuntime["accept"]>[1]> = [];
  await withDeskSession({
    cliModel: TEST_CLI_MODEL,
    runtime: {
      ...surveys(() =>
        deskSurvey([
          deskTaskEntry("agent/ready", "/worktrees/ready", {
            id: "ready",
            ahead: 2,
            proof_honored: true,
            gate_proof: { status: "honored" },
          }),
        ])
      ),
      accept: (_ctx, options) => {
        applied.push(options);
      },
    },
  }, async (desk) => {
    await desk.select("ready");
    await desk.press("l");
    await desk.opened("review-accept-review");
    await desk.confirm();
    await desk.until(() => applied.length === 1, "the landing");
  });
  // The Desk's confirm IS the acceptance, so the apply carries the
  // attestation (ADR 0134): never a bare, consent-less landing.
  assertEquals(applied, [{ confirmed: true, cliModel: TEST_CLI_MODEL }]);

  const abandoned = deskTaskEntry("agent/abandoned", "/worktrees/abandoned", {
    id: "abandoned",
    broken: true,
  });
  const dropCalls: Array<{ force?: boolean }> = [];
  await withDeskSession({
    runtime: {
      ...surveys(() => deskSurvey([abandoned])),
      dropPlan: () => ({
        title: "Drop plan",
        details: [],
        steps: [],
        subject: dropSubject(abandoned, ["1 commit not on main"]),
      }),
      drop: (_ctx, _target, options) => {
        dropCalls.push(
          options.force === undefined ? {} : {
            force: options.force,
          },
        );
        if (options.force !== true) {
          throw new DropWouldDiscardWork("unlanded work would be discarded");
        }
      },
    },
  }, async (desk) => {
    await desk.select("abandoned");
    await desk.press("D");
    await desk.opened("review-drop-review");
    // The plan predicts lost work, so the branch name is asked up front.
    await desk.shows("Discards 1 commit not on main");
    await desk.until(
      () =>
        desk.state().layers["review-drop-review"]?.focusedControlId ===
          "field:challenge",
      "focus in the challenge",
    );
    await desk.type(abandoned.branch);
    await desk.confirm();
    await desk.until(() => dropCalls.length === 1, "the forced drop");
  });
  assertEquals(dropCalls, [{ force: true }]);

  await withDeskSession({
    cliModel: TEST_CLI_MODEL,
    runtime: {
      ...surveys(() =>
        deskSurvey([
          deskTaskEntry("agent/refused", "/worktrees/refused", {
            id: "refused",
            ahead: 2,
            proof_honored: true,
            gate_proof: { status: "honored" },
          }),
        ])
      ),
      accept: () =>
        Promise.reject(new IdentityError("identity is unavailable")),
    },
  }, async (desk) => {
    await runAction(desk, "refused", "accept");
    await desk.confirm();
    await desk.shows("identity is unavailable");
  });
});

Deno.test("Park applies only on confirm and refreshes the checkout into its branch", async () => {
  let parked = false;
  let planCalls = 0;
  let applyCalls = 0;
  const task = {
    id: "park-refresh",
    branch: "agent/park-refresh",
    title: "Park refresh",
    title_source: "recorded" as const,
  };
  const effort = deskTaskEntry(task.branch, "/worktrees/park-refresh", {
    id: task.id,
    ahead: 1,
    task,
  });
  await withDeskSession({
    runtime: {
      ...surveys(() =>
        parked
          ? deskSurvey([], {
            unlanded_branches: [task.branch],
            parked_tasks: [{
              id: task.id,
              branch: task.branch,
              head: "a".repeat(40),
              parked_at: "2026-07-11T12:00:00.000Z",
              task,
            }],
          })
          : deskSurvey([effort])
      ),
      parkPlan: () => {
        planCalls += 1;
        return { title: "Park plan", details: [], steps: [] };
      },
      park: () => {
        applyCalls += 1;
        parked = true;
      },
    },
  }, async (desk) => {
    await desk.select(task.id);
    await desk.press("p");
    await desk.opened("review-park-review");
    await close(desk);
    assertEquals(applyCalls, 0, "Keep parks nothing");
    await desk.press("p");
    await desk.confirm();
    await desk.until(() => applyCalls === 1, "the park");
    await desk.shows("Parked Park refresh; its branch is kept");
    desk.settle();
    await desk.until(
      () => desk.state().lists.inbox?.selectedId !== task.id,
      "the task leaves the inbox",
    );
  });
  assertEquals(planCalls, 2);
});

Deno.test("a refusal is contained as a message and the next survey shows why", async () => {
  const cases = [
    {
      name: "landed",
      refusal: "The selected task landed before Park could apply.",
      after: (entry: StatusFleetEntry): StatusData =>
        deskSurvey([], {
          recent_completed_tasks: [{
            branch: entry.branch,
            head: "b".repeat(40),
            completed_at: "2026-07-11T12:00:00.000Z",
          }],
        }),
    },
    {
      name: "removed",
      refusal: "The selected task no longer has a registered checkout.",
      after: (): StatusData => deskSurvey(),
    },
  ];
  for (const testCase of cases) {
    const effort = deskTaskEntry(
      `agent/external-${testCase.name}`,
      `/worktrees/${testCase.name}`,
      { id: testCase.name, ahead: 1 },
    );
    let changed = false;
    await withDeskSession({
      runtime: {
        ...surveys(() =>
          changed ? testCase.after(effort) : deskSurvey([effort])
        ),
        park: () => {
          changed = true;
          throw new WorktreeGitError(testCase.refusal);
        },
      },
    }, async (desk) => {
      await desk.select(testCase.name);
      await desk.press("p");
      await desk.confirm();
      await desk.shows(testCase.refusal.slice(0, 40));
      desk.settle();
      await desk.until(
        () => desk.state().lists.inbox?.selectedId !== testCase.name,
        "the task leaves the inbox",
      );
      // Home leads back to the Commands row, whose panel has no task left.
      await desk.press("home");
      await desk.shows("No tasks yet");
    });
  }
});

Deno.test("Reclaim names its consequences and reclaims the exact checkout on confirm", async () => {
  const spent = deskTaskEntry("agent/stage-a", "/worktrees/stage-a", {
    id: "stage-a",
    ahead: 1,
    contained_in: "agent/stage-b",
  });
  const reclaims: string[] = [];
  await withDeskSession({
    runtime: {
      ...surveys(() => deskSurvey([spent])),
      reclaim: (_ctx, target) => {
        reclaims.push(target);
      },
    },
  }, async (desk) => {
    await runAction(desk, "stage-a", "reclaim");
    await desk.opened("review-reclaim-review");
    await desk.shows("Reclaim Stage a's checkout?");
    await desk.shows("agent/stage-b");
    await close(desk);
    assertEquals(reclaims, [], "Keep reclaims nothing");
    await desk.press(".");
    await desk.opened("actions");
    await desk.choose("reclaim");
    await desk.confirm();
    await desk.until(() => reclaims.length === 1, "the reclaim");
  });
  // The core receives the absolute selected path: two roots can hold
  // same-named worktree directories.
  assertEquals(reclaims, ["/worktrees/stage-a"]);
});

Deno.test("Drop never turns a generic refusal into destructive force", async () => {
  for (
    const error of [
      new WorktreeGitError("The checkout is locked."),
      new Error("The target is unavailable."),
    ]
  ) {
    const calls: Array<{ force?: boolean }> = [];
    await withDeskSession({
      runtime: {
        ...surveys(() =>
          deskSurvey([
            deskTaskEntry("agent/refused-drop", "/worktrees/refused-drop", {
              id: "refused-drop",
              ahead: 1,
            }),
          ])
        ),
        drop: (_ctx, _target, options) => {
          calls.push(
            options.force === undefined ? {} : { force: options.force },
          );
          throw error;
        },
      },
    }, async (desk) => {
      await desk.select("refused-drop");
      await desk.press("D");
      await desk.confirm();
      await desk.shows(error.message);
      assertEquals(desk.top(), undefined, "no challenge follows a refusal");
    });
    assertEquals(calls, [{}]);
  }
});

Deno.test("New task creates a named task from its form, then selects it", async () => {
  const started = scriptedStart({
    id: "desk-launchers",
    branch: "agent/desk-launchers",
    worktreePath: "/worktrees/desk-launchers",
  });
  const output = deskTranscript();
  await withDeskSession({
    output,
    runtime: {
      ...surveys(() => started.survey([])),
      startPlan: started.startPlan,
      start: started.start,
    },
  }, async (desk) => {
    await desk.press("n");
    await desk.opened("form-new_task-review");
    await fill(desk, "title", "desk launchers");
    await desk.settleForm();
    await desk.shows("Create branch agent/desk-launchers from main");
    await desk.confirm();
    await desk.until(() => started.created() !== undefined, "the start");
    await desk.until(
      () => desk.state().lists.inbox?.selectedId === "desk-launchers",
      "the new task selected",
    );
  });
  assertEquals(started.requests.slice(-1), [{
    worktreeRoot: "/project.worktrees",
    title: "desk launchers",
  }]);
  assertStringIncludes(
    joinedTranscript(output),
    "discern start --title 'desk launchers'",
  );
});

Deno.test("an empty title starts a generated codename and the command says so", async () => {
  const started = scriptedStart();
  const output = deskTranscript();
  await withDeskSession({
    output,
    runtime: {
      ...surveys(() => started.survey([])),
      startPlan: started.startPlan,
      start: started.start,
    },
  }, async (desk) => {
    await desk.press("n");
    await desk.opened("form-new_task-review");
    await desk.confirm();
    await desk.until(() => started.created() !== undefined, "the start");
  });
  assertEquals(started.requests, [{ worktreeRoot: "/project.worktrees" }]);
  assert(!joinedTranscript(output).includes("--title"));
});

Deno.test("a new task can start from the trunk, a live task, or an unlanded branch", async () => {
  const live = deskTaskEntry(
    "agent/existing-task",
    "/worktrees/existing-task",
    {
      id: "existing-task",
    },
  );
  const orphan = "agent/unlanded-branch";
  const cases = [
    { name: "trunk", base: "main", from: undefined },
    { name: "live task", base: live.branch, from: live.branch },
    { name: "unlanded branch", base: orphan, from: orphan },
  ];
  for (const testCase of cases) {
    const started = scriptedStart();
    const title = `Repair ingress from ${testCase.name} — 修复`;
    const brief = `Preserve the exact ${testCase.name} base and wording.`;
    let grants = 0;
    await withDeskSession({
      runtime: {
        ...surveys(() =>
          started.survey([live], { unlanded_branches: [orphan] })
        ),
        startPlan: started.startPlan,
        start: started.start,
        grantEffort: () => {
          grants += 1;
          throw new Error("creation must not call the grant writer");
        },
      },
    }, async (desk) => {
      await desk.press("n");
      await desk.opened("form-new_task-review");
      await fill(desk, "title", title);
      await pick(desk, "base", testCase.base);
      await fill(desk, "brief", brief);
      await desk.settleForm();
      await desk.shows("Landing permission");
      await desk.confirm();
      await desk.until(
        () => started.created() !== undefined,
        testCase.name,
      );
    });
    assertEquals(started.requests.at(-1), {
      worktreeRoot: "/project.worktrees",
      title,
      brief,
      ...(testCase.from === undefined ? {} : { from: testCase.from }),
    }, testCase.name);
    assertEquals(grants, 0, testCase.name);
  }
});

Deno.test("New task opens the remembered available agent, and a stale one falls back to None", async () => {
  const cases = [
    { name: "remembered", detected: "codex" as const, launches: 1 },
    { name: "stale", detected: "gemini" as const, launches: 0 },
  ];
  for (const testCase of cases) {
    const started = scriptedStart();
    const opened: Array<{ command: string; cwd: string }> = [];
    const saved: Array<Parameters<DeskRuntime["writePreferences"]>[1]> = [];
    await withDeskSession({
      runtime: {
        loadConfig: () =>
          configSchema.parse({
            project: { slug: "demo", agents: [testCase.detected] },
            repository: { trunk: "main" },
          }),
        ...surveys(() => started.survey([])),
        detectAgents: () => [{
          name: testCase.detected,
          binary: testCase.detected,
        }],
        readPreferences: () => ({ schema_version: 2, last_agent: "codex" }),
        startPlan: started.startPlan,
        start: started.start,
        interactive: (command, _args, cwd) => {
          opened.push({ command, cwd });
          return 0;
        },
        writePreferences: (_root, preferences) => {
          saved.push(preferences);
          return { status: "saved" };
        },
      },
    }, async (desk) => {
      await desk.press("n");
      await desk.opened("form-new_task-review");
      await fill(desk, "title", "Human title");
      // The remembered agent's own button creates the task and opens it;
      // a stale one offers no such button.
      await desk.confirm(testCase.launches > 0 ? "confirm-open" : "confirm");
      await desk.until(() => started.created() !== undefined, testCase.name);
    });
    assertEquals(opened.length, testCase.launches, testCase.name);
    if (testCase.launches > 0) {
      assertEquals(opened, [{ command: "codex", cwd: "/worktrees/new-task" }]);
      assertEquals(saved[0]?.last_agent, "codex");
    }
  }
});

Deno.test("an unavailable preference write leaves creation intact and says so", async () => {
  const started = scriptedStart();
  const output = deskTranscript();
  await withDeskSession({
    output,
    runtime: {
      loadConfig: () =>
        configSchema.parse({
          project: { slug: "demo", agents: ["codex"] },
          repository: { trunk: "main" },
        }),
      ...surveys(() => started.survey([])),
      detectAgents: () => [{ name: "codex", binary: "codex" }],
      readPreferences: () => ({ schema_version: 2, last_agent: "codex" }),
      startPlan: started.startPlan,
      start: started.start,
      writePreferences: () => ({
        status: "unavailable",
        reason: "the repository preference store is read-only",
      }),
    },
  }, async (desk) => {
    await desk.press("n");
    await desk.opened("form-new_task-review");
    await desk.confirm("confirm-open");
    await desk.until(() => started.created() !== undefined, "the start");
  });
  assertStringIncludes(
    joinedTranscript(output),
    "Desk preferences were not saved",
  );
  assertStringIncludes(joinedTranscript(output), "read-only");
});

Deno.test("task creation creates nothing until Create, whatever its preview read", async () => {
  let plans = 0;
  let starts = 0;
  let writes = 0;
  await withDeskSession({
    runtime: {
      startPlan: (_ctx, request) => {
        plans += 1;
        return preparedStart(request.title ?? "Generated codename");
      },
      start: (_ctx, prepared) => {
        starts += 1;
        return startedTask(prepared);
      },
      writePreferences: () => {
        writes += 1;
        return { status: "saved" };
      },
    },
  }, async (desk) => {
    await desk.press("n");
    await desk.opened("form-new_task-review");
    await desk.type("Abandoned");
    await desk.settleForm();
    await desk.until(() => plans > 0, "the live preview");
    await close(desk);
    await desk.press("n");
    await desk.opened("form-new_task-review");
    await desk.settleForm();
    await close(desk);
  });
  assert(plans > 0, "the form previews what Create would do");
  assertEquals(starts, 0, "Cancel creates nothing");
  assertEquals(writes, 0);
});

Deno.test("a parked branch can be read or resumed by its exact ref", async () => {
  const branch = "agent/orphan-修复";
  const gitCalls: string[][] = [];
  await withDeskSession({
    runtime: {
      ...surveys(() => deskSurvey([], { unlanded_branches: [branch] })),
      git: (args) => {
        gitCalls.push([...args]);
        return {
          success: true,
          stdout: args[0] === "log"
            ? "abc1234 Keep orphan work\n"
            : "src/a.ts | 2 ++\n",
          stderr: "",
        };
      },
    },
  }, async (desk) => {
    await desk.select(parkedRowId(branch));
    await desk.press("v");
    await desk.opened("reader-branch");
    await desk.shows("abc1234 Keep orphan work");
    await desk.shows("src/a.ts | 2 ++");
    await close(desk);
  });
  assert(
    gitCalls.some((args) =>
      args.join(" ") === `log --oneline --decorate main..${branch}`
    ),
  );
  assert(
    gitCalls.some((args) => args.join(" ") === `diff --stat main...${branch}`),
  );

  const started = scriptedStart();
  await withDeskSession({
    runtime: {
      ...surveys(() => started.survey([], { unlanded_branches: [branch] })),
      startPlan: started.startPlan,
      start: started.start,
    },
  }, async (desk) => {
    await desk.select(parkedRowId(branch));
    await desk.press("enter");
    await desk.opened("form-resume-review");
    await fill(desk, "title", "Resume orphan work");
    await fill(desk, "brief", "Retain the branch's committed base.");
    await desk.confirm();
    await desk.until(() => started.created() !== undefined, "the resume");
  });
  assertEquals(started.requests.slice(-1), [{
    worktreeRoot: "/project.worktrees",
    title: "Resume orphan work",
    brief: "Retain the branch's committed base.",
    from: branch,
  }]);
});

Deno.test("Start follow-up starts from the task's exact branch", async () => {
  const parent = deskTaskEntry("agent/parent-task", "/worktrees/parent-task", {
    id: "parent-task",
  });
  const started = scriptedStart();
  await withDeskSession({
    runtime: {
      ...surveys(() => started.survey([parent])),
      startPlan: started.startPlan,
      start: started.start,
    },
  }, async (desk) => {
    await desk.select("parent-task");
    await desk.press("f");
    await desk.opened("form-follow_up-review");
    await desk.shows(`from ${parent.branch}`);
    await fill(desk, "title", "Follow-up: preserve metadata");
    await fill(desk, "brief", "Build on the selected task's committed tip.");
    await desk.confirm();
    await desk.until(() => started.created() !== undefined, "the follow-up");
  });
  assertEquals(started.requests.slice(-1), [{
    worktreeRoot: "/project.worktrees",
    title: "Follow-up: preserve metadata",
    brief: "Build on the selected task's committed tip.",
    from: parent.branch,
  }]);
});

Deno.test("Open agent lists configured agents, explains missing ones, and launches exact argv", async () => {
  const effort = deskTaskEntry("agent/agents", "/worktrees/agents", {
    id: "agents",
  });
  const launches: Array<{
    command: string;
    args: readonly string[];
    cwd: string;
    env: Record<string, string>;
  }> = [];
  const preferences: Array<Parameters<DeskRuntime["writePreferences"]>[1]> = [];
  let discovered = 0;
  await withDeskSession({
    runtime: {
      ...surveys(() => deskSurvey([effort])),
      loadConfig: () =>
        configSchema.parse({
          project: { slug: "demo", agents: ["claude_code", "codex"] },
          repository: { trunk: "main" },
        }),
      detectAgents: () => {
        discovered += 1;
        return [
          { name: "claude_code", binary: "claude" },
          { name: "gemini", binary: "gemini" },
        ];
      },
      interactive: (command, args, cwd, env) => {
        launches.push({ command, args, cwd, env });
        return 0;
      },
      writePreferences: (_root, value) => {
        preferences.push(value);
        return { status: "saved" };
      },
    },
  }, async (desk) => {
    await desk.select("agents");
    await desk.until(() => discovered > 0, "agent discovery");
    // Nothing is remembered yet, so `a` asks which launch.
    await desk.press("a");
    await desk.opened("agents");
    const screen = desk.screen();
    assertStringIncludes(screen, "Claude Code");
    assertStringIncludes(screen, "Codex");
    assert(
      !screen.includes("Gemini"),
      "detected but unconfigured stays hidden",
    );
    await desk.choose("claude_code:open");
    await desk.until(() => launches.length === 1, "the new session");
    await desk.shows("Back from Claude Code");
    // Now `a` runs the remembered agent at once, picking up its last
    // conversation.
    await desk.press("a");
    await desk.until(() => launches.length === 2, "the remembered launch");
    await desk.shows("Back from Claude Code");
    // The actions menu's Open agent still offers every launch.
    await desk.press(".");
    await desk.opened("actions");
    await desk.choose("agent");
    await desk.opened("agents");
    assertEquals(
      desk.state().layers.agents?.focusedControlId,
      "item:claude_code:continue",
      "the picker starts on the remembered launch",
    );
    await desk.choose("claude_code:open");
    await desk.until(() => launches.length === 3, "the chosen launch");
    await desk.shows("Back from Claude Code");
  });
  const session = (args: readonly string[]) => ({
    command: "claude",
    args,
    cwd: effort.path,
    env: { [DESK_SESSION_ENV]: "1" },
  });
  assertEquals(launches, [session([]), session(["--continue"]), session([])]);
  assertEquals(preferences.map((value) => value.last_agent), [
    "claude_code",
    "claude_code",
    "claude_code",
  ]);
  assertEquals(
    preferences.filter((value) => value.folded_groups !== undefined),
    [],
    "unchanged folds are not written back",
  );
});

Deno.test("an agent's edits re-read only the uncommitted files, and the commits stay on screen", async () => {
  let surveysRun = 0;
  const reads: string[] = [];
  await withDeskSession({
    columns: 120,
    rows: 30,
    runtime: {
      status: () => {
        surveysRun += 1;
        return {
          ok: true,
          data: deskSurvey([
            deskTaskEntry("agent/first", "/worktrees/first", {
              id: "first",
              clean: false,
              changed_files: 2,
              // An agent is editing: each survey sees newer activity.
              last_activity: new Date(
                Date.parse("2026-07-11T11:00:00Z") + surveysRun * 5_000,
              ).toISOString(),
            }),
          ]),
        };
      },
      git: (args) => {
        reads.push(args[0] ?? "");
        return args[0] === "log"
          ? {
            success: true,
            stdout: "abc1234\u0000Committed work\u0000\n",
            stderr: "",
          }
          : args[0] === "status"
          ? { success: true, stdout: " M notes.md\u0000", stderr: "" }
          : { success: true, stdout: "", stderr: "" };
      },
    },
  }, async (desk) => {
    await desk.select("first");
    await desk.shows("Committed work");
    reads.length = 0;
    desk.advance(DESK_REFRESH_MS);
    await desk.until(() => surveysRun >= 2, "the next survey");
    // The slot reads once the survey lands and its settle passes.
    await desk.until(() => {
      desk.advance(DESK_SELECTION_SETTLE_MS / 10);
      return reads.length > 0;
    }, "the slot's read");
    await desk.shows("Committed work");
  });
  assertEquals(reads, ["status"], "only the uncommitted files are read again");
});

Deno.test("the session waits for a toggle's write before it remembers its folds", async () => {
  let release: (() => void) | undefined;
  let written = false;
  // Each read records whether the toggle's write had finished by then.
  const reads: boolean[] = [];
  const desk = await deskSession({
    runtime: {
      readPreferences: () => {
        reads.push(written);
        return { schema_version: 2 };
      },
      writePreferences: async () => {
        await new Promise<void>((resolve) => {
          release = resolve;
        });
        written = true;
        return { status: "saved" };
      },
    },
  });
  await desk.palette("Sort by title", "sort");
  await desk.until(() => release !== undefined, "the toggle's write to start");
  desk.io.enqueueKeys("ctrl-c");
  // The package leaves the alternate screen once the session has ended.
  await desk.until(
    () => desk.io.output().includes("\x1b[?1049l"),
    "the screen to be restored",
  );
  release?.();
  assertEquals(await desk.exit, 0);
  desk.io.close();
  assertEquals(
    reads,
    [false, true],
    "the folds are read and written only after the toggle's write",
  );
});

Deno.test("View changes reads the task's evidence and lends the terminal to the pager, the editor and a shell", async () => {
  const effort = deskTaskEntry("agent/inspect", "/worktrees/inspect", {
    id: "inspect",
    ahead: 2,
    behind: 1,
    proof_honored: true,
    gate_proof: { status: "honored" },
  });
  const reads = new Map<
    string,
    { success: boolean; stdout: string; stderr: string }
  >([
    ["log", {
      success: true,
      stdout: "abc123 Explain the change\n",
      stderr: "",
    }],
    ["diff --numstat", {
      success: true,
      stdout: '3\t1\tsrc/café"desk.ts\0',
      stderr: "",
    }],
    ["diff --name-status", {
      success: true,
      stdout: 'M\0src/café"desk.ts\0',
      stderr: "",
    }],
    ["status", { success: false, stdout: "", stderr: "status unavailable\n" }],
  ]);
  const pages: string[] = [];
  const shells: Array<{ cwd: string; env: Record<string, string> }> = [];
  const editors: Array<
    { program: string; args: readonly string[]; cwd: string }
  > = [];
  await withDeskSession({
    runtime: {
      ...surveys(() => deskSurvey([effort])),
      editor: () => ({
        editor: { command: "edit --wait", program: "edit", args: ["--wait"] },
      }),
      openEditor: (editor, cwd) => {
        editors.push({ program: editor.program, args: editor.args, cwd });
        return 0;
      },
      git: (args) => {
        const key = args[0] === "diff" ? `diff ${args[1]}` : args[0] ?? "";
        return reads.get(key) ?? { success: true, stdout: "", stderr: "" };
      },
      pager: (text) => {
        pages.push(text);
        return { shown: true };
      },
      interactive: (_command, _args, cwd, env) => {
        shells.push({ cwd, env });
        return 0;
      },
    },
  }, async (desk) => {
    await desk.select("inspect");
    await desk.press("v");
    await desk.opened("reader-changes");
    for (
      const text of [
        "abc123 Explain the change",
        'src/café"desk.ts',
        "status unavailable",
      ]
    ) await desk.shows(text);
    // The pager and the editor each borrow the terminal and return to it.
    for (const [key, opened] of [["o", pages], ["e", editors]] as const) {
      await desk.press(key);
      await desk.until(() => opened.length === 1, `the child behind ${key}`);
      await desk.opened("reader-changes");
    }
    await close(desk);
    await desk.press("s");
    await desk.until(() => shells.length === 1, "the shell");
  });
  assertEquals(editors, [{
    program: "edit",
    args: ["--wait"],
    cwd: effort.path,
  }]);
  assertEquals(shells, [{
    cwd: effort.path,
    env: { [DESK_SESSION_ENV]: "1" },
  }]);
});

Deno.test("Run a script offers only the selected checkout's Project Scripts and passes literal arguments", async () => {
  const empty = deskTaskEntry("agent/empty", "/worktrees/empty", {
    id: "empty",
  });
  const scripted = deskTaskEntry("agent/scripted", "/worktrees/scripted", {
    id: "scripted",
  });
  const runs: Array<{
    root: string;
    name: string;
    args: readonly string[];
    env: Record<string, string>;
  }> = [];
  const discovered: string[] = [];
  let pauses = 0;
  const output = deskTranscript();
  await withDeskSession({
    output,
    runtime: {
      ...surveys(() => deskSurvey([empty, scripted])),
      scripts: (root) => {
        discovered.push(root);
        return root === scripted.path
          ? [{ name: "deploy", description: "deploy this checkout" }]
          : [];
      },
      runScript: (root, name, args, env) => {
        runs.push({ root, name, args, env });
        return runs.length === 1 ? 7 : 0;
      },
      pause: () => {
        pauses += 1;
      },
    },
  }, async (desk) => {
    await desk.select("empty");
    await desk.until(() => discovered.includes(empty.path), "empty discovery");
    await desk.press("x");
    await desk.shows("No Project Scripts");
    await close(desk);
    await desk.select("scripted");
    await desk.until(
      () => discovered.includes(scripted.path),
      "scripted discovery",
    );
    for (
      const typed of ["", `--target 'review environment' '--literal=$HOME'`]
    ) {
      await desk.press("x");
      await desk.opened("scripts");
      await desk.shows("deploy this checkout");
      await desk.choose("deploy");
      await desk.opened("form-scripts-review");
      if (typed !== "") await fill(desk, "args", typed);
      await desk.confirm();
      await desk.until(
        () => runs.length === (typed === "" ? 1 : 2),
        "the script run",
      );
    }
  });
  assertEquals(runs, [
    {
      root: scripted.path,
      name: "deploy",
      args: [],
      env: { [DESK_SESSION_ENV]: "1" },
    },
    {
      root: scripted.path,
      name: "deploy",
      args: ["--target", "review environment", "--literal=$HOME"],
      env: { [DESK_SESSION_ENV]: "1" },
    },
  ]);
  assertEquals(pauses, 1, "only the failed run waits to be read");
  assertStringIncludes(
    joinedTranscript(output),
    "Project Script deploy exited with status 7",
  );
});

Deno.test("a layer the package refuses closes with a message while the session carries on", async () => {
  const scripted = deskTaskEntry("agent/scripted", "/worktrees/scripted", {
    id: "scripted",
  });
  const discovered: string[] = [];
  await withDeskSession({
    runtime: {
      ...surveys(() => deskSurvey([scripted])),
      // Two scripts under one name make a menu that lists one id twice,
      // which breaks one of the package's view rules.
      scripts: (root) => {
        discovered.push(root);
        return [{ name: "deploy" }, { name: "deploy" }];
      },
    },
  }, async (desk) => {
    await desk.select("scripted");
    await desk.until(
      () => discovered.includes(scripted.path),
      "scripted discovery",
    );
    await desk.press("x");
    await desk.shows("Couldn't show that, and nothing ran");
    assertEquals(desk.top(), undefined, "the refused menu is gone");
    // The session answers on: the task's actions open as before.
    await desk.press(".");
    await desk.opened("actions");
  });
});

Deno.test("Project Scripts run from the main checkout through the palette once their argument line reads", async () => {
  const runs: Array<{ root: string; name: string; args: readonly string[] }> =
    [];
  await withDeskSession({
    runtime: {
      scripts: (root) =>
        root === DESK_ROOT
          ? [{ name: "health", description: "check the project" }]
          : [],
      runScript: (root, name, args) => {
        runs.push({ root, name, args });
        return 0;
      },
    },
  }, async (desk) => {
    await desk.palette("Run a script in the main", "main_scripts");
    await desk.opened("scripts");
    await desk.shows("check the project");
    await desk.choose("health");
    await desk.opened("form-main_scripts-review");
    await fill(desk, "args", `'unfinished`);
    await desk.settleForm();
    await desk.shows("The argument line has an unclosed single quote.");
    await fill(desk, "args", `--mode 'full scan'`);
    await desk.confirm();
    await desk.until(() => runs.length === 1, "the script run");
  });
  assertEquals(runs, [{
    root: DESK_ROOT,
    name: "health",
    args: ["--mode", "full scan"],
  }]);
});

Deno.test("Check for updates asks before it opens a browser, and Cancel opens nothing", async () => {
  let opened = 0;
  await withDeskSession({
    runtime: {
      openBrowser: () => {
        opened += 1;
        throw new Error("a declined disclosure must open nothing");
      },
    },
  }, async (desk) => {
    await desk.palette("Check for updates", "updates");
    await desk.opened("review-updates-review");
    await desk.shows("Check for updates?");
    await desk.shows(DISCERN_VERSION);
    await close(desk);
  });
  assertEquals(opened, 0);
});

Deno.test("Check for updates opens the release page beside the screen and reads out its release information", async () => {
  await withTempDir(async (root) => {
    await scaffoldEngine(root, { agents: [] });
    await gitInit(root);
    for (const launches of [true, false]) {
      const opened: string[] = [];
      await withDeskSession({
        runtime: {
          findRoot: () => root,
          mainRepoPath: () => root,
          openBrowser: (url) => {
            opened.push(url);
            const launch = { command: "open", args: [url] };
            return launches
              ? { status: "opened", launch }
              : { status: "failed", launch, message: "no browser here" };
          },
        },
      }, async (desk) => {
        await desk.palette("Check for updates", "updates");
        await desk.opened("review-updates-review");
        await desk.confirm();
        await desk.opened("reader-opened");
        await desk.until(() => opened.length === 1, "the release page");
        await desk.shows("Release information");
        await desk.shows(
          launches ? "Opening release notes" : "Couldn't open your browser",
        );
        assertStringIncludes(desk.screen(), `since=${DISCERN_VERSION}`);
        await desk.escape(() => desk.top() === undefined, "the inbox");
      });
      assertEquals(opened.length, 1);
    }
  });
});

/** Two tasks, so returning from the manual can show the selection kept. */
const MANUAL_FLEET = [
  deskTaskEntry("agent/first", "/worktrees/first", { id: "first" }),
  deskTaskEntry("agent/second", "/worktrees/second", { id: "second" }),
];

/** Escape out of the manual's current place, waiting for `shown`. */
async function manualBack(desk: DeskSession, shown: string): Promise<void> {
  await desk.escape(() => desk.screen().includes(shown), shown);
}

/** Choose Read the manual from the palette and wait for its contents. */
async function openManual(desk: DeskSession): Promise<void> {
  await desk.palette("Read the manual", "manual");
  await desk.shows("Manual fixture");
}

/** Wait for the manual to give way to the inbox, its selection as left. */
async function backFromManual(desk: DeskSession, why: string): Promise<void> {
  await desk.until(() => !desk.screen().includes("Manual fixture"), why);
  assertEquals(desk.state().lists[DESK_LIST_ID]?.selectedId, "second");
}

Deno.test("Read the manual opens in place of the inbox and Escape returns to it as it was", async () => {
  let pauses = 0;
  await withDeskSession({
    runtime: {
      ...surveys(() => deskSurvey(MANUAL_FLEET)),
      pause: () => {
        pauses += 1;
      },
      openBrowser: () => {
        throw new Error("reading the manual opens no page");
      },
    },
  }, async (desk) => {
    await desk.select("second");
    await openManual(desk);
    await desk.shows("Back to the desk");
    // The contents open the first page; its first link opens the guide.
    await desk.press("enter");
    await desk.shows("Read the guide");
    await desk.press("tab", "enter");
    await desk.shows("Guide body text");
    // Back returns to the home page with its followed link still focused;
    // Escape leaves the link first, then goes back to the contents.
    await manualBack(desk, "›guide");
    await manualBack(desk, "Read the guide");
    await manualBack(desk, "Back to the desk");
    await desk.escape(
      () => !desk.screen().includes("Manual fixture"),
      "the inbox again",
    );
    assertEquals(desk.top(), undefined);
    assertEquals(desk.state().lists[DESK_LIST_ID]?.selectedId, "second");
    // The next opening resumes where its reader left it.
    await openManual(desk);
    await desk.press("q");
    await backFromManual(desk, "the inbox after q");
  });
  assertEquals(pauses, 0);
});

Deno.test("the manual opens its pages while the screen stays and says when one can't", async () => {
  const opened: string[] = [];
  await withDeskSession({
    runtime: {
      openBrowser: (url) => {
        opened.push(url);
        return url === DISCERN_DOCS_URL
          ? { status: "unsupported", message: "no browser here" }
          : { status: "opened", launch: { command: "open", args: [url] } };
      },
    },
  }, async (desk) => {
    await openManual(desk);
    await desk.press("enter", "tab", "tab", "enter");
    await desk.until(
      () => opened.includes("https://example.com/docs"),
      "the website to open",
    );
    await desk.press("c");
    await desk.shows("Manual home");
    await desk.press("down", "down", "enter");
    await desk.until(() => opened.includes(DISCERN_DOCS_URL), "the docs");
    await desk.shows("no browser here");
    assertStringIncludes(desk.screen(), "Manual fixture");
  });
  assertEquals(opened, ["https://example.com/docs", DISCERN_DOCS_URL]);
});

/** A manual read the test finishes, with or without a manual to show. */
function heldManual(): {
  readonly read: () => Promise<DocsBrowserRequest>;
  readonly finish: (outcome: "read" | "failed") => void;
} {
  let finish: ((outcome: "read" | "failed") => void) | undefined;
  const done = new Promise<"read" | "failed">((resolve) => {
    finish = resolve;
  });
  return {
    read: async () => {
      if (await done === "failed") {
        throw new Error("this binary has no bundled manual");
      }
      return DESK_MANUAL_FIXTURE;
    },
    finish: (outcome) => finish?.(outcome),
  };
}

for (const outcome of ["read", "failed"] as const) {
  const name = outcome === "read"
    ? "Read the manual chosen before the manual is read opens it in place as soon as it is"
    : "Read the manual chosen before a read that fails says why back on the Desk";
  Deno.test(name, async () => {
    const manual = heldManual();
    // Once the read settles, choosing it again opens it in place where its
    // reader left it, or says at once why it can't.
    const settled = outcome === "read" ? "Read the guide" : "could not open";
    await withDeskSession({
      runtime: {
        ...surveys(() => deskSurvey(MANUAL_FLEET)),
        manual: manual.read,
      },
    }, async (desk) => {
      await desk.select("second");
      // The Desk hands the terminal over at once and says why.
      await chooseManualEarly(desk);
      assert(!desk.screen().includes("try again"));
      manual.finish(outcome);
      if (outcome === "read") {
        await desk.shows("Manual fixture");
        await desk.press("enter");
        await desk.shows("Read the guide");
        await desk.press("q");
      } else await desk.shows(settled);
      await backFromManual(desk, "the inbox as it was left");
      await desk.palette("Read the manual", "manual");
      await desk.shows(settled);
    });
  });
}

Deno.test("a Ctrl+C while the Desk waits to read the manual quits as one on the inbox does", async () => {
  const termination = scriptedTermination();
  const raised: Deno.Signal[] = [];
  let preferenceReads = 0;
  const desk = await deskSession({
    runtime: {
      // The read never finishes, so the Desk waits with the terminal handed
      // over, where a typed Ctrl+C arrives as SIGINT.
      manual: () => new Promise<DocsBrowserRequest>(() => {}),
      terminations: () => termination,
      raise: (signal) => {
        raised.push(signal);
      },
      readPreferences: () => {
        preferenceReads += 1;
        return { schema_version: 2 };
      },
    },
  });
  await chooseManualEarly(desk);
  assert(termination.interruptHandedOver(), "the Desk hears SIGINT itself");
  assertEquals(await desk.exit, 0);
  desk.io.close();
  assertEquals(raised, [], "it quits; no signal ends the process");
  assertEquals(preferenceReads, 2, "it remembers its folds as any quit does");
});

Deno.test("a reader chosen before the first survey opens at once and fills in once the tasks are read", async () => {
  let release: (() => void) | undefined;
  const surveyed = new Promise<void>((resolve) => {
    release = resolve;
  });
  const queued = deskSurvey(MANUAL_FLEET, {
    queue: [{
      effort: "second",
      branch: "agent/second",
      path: "/worktrees/second",
      head: "a".repeat(40),
      submitted_at: "2026-07-11T11:30:00.000Z",
      authority: "pre-authorized",
      position: 1,
      readiness: "ready",
    }],
  });
  await withDeskSession({
    loading: true,
    runtime: {
      status: async () => {
        await surveyed;
        return { ok: true, data: queued };
      },
    },
  }, async (desk) => {
    await desk.palette("Landing", "landing");
    await desk.opened("reader-landing");
    await desk.shows("Loading tasks…");
    assert(!desk.screen().includes("Nothing is queued"), "nothing is claimed");
    release?.();
    await desk.until(
      () => !desk.screen().includes("Loading tasks…"),
      "the reader to fill in",
    );
    await desk.shows("#1");
    assertEquals(desk.top(), "reader-landing", "it stayed open");
  });
});

Deno.test("an agent without a prompt option shows the stored brief before it opens", async () => {
  const effort = deskTaskEntry("agent/briefed", "/worktrees/briefed", {
    id: "briefed",
    task: {
      id: "briefed",
      branch: "agent/briefed",
      title: "Briefed",
      title_source: "recorded",
      brief: "Keep the public names stable.",
    },
  });
  const launches: string[][] = [];
  let discovered = 0;
  const output = deskTranscript();
  await withDeskSession({
    output,
    runtime: {
      ...surveys(() => deskSurvey([effort])),
      loadConfig: () =>
        configSchema.parse({
          project: { slug: "demo", agents: ["claude_code"] },
          repository: { trunk: "main" },
        }),
      detectAgents: () => {
        discovered += 1;
        return [{ name: "claude_code", binary: "claude" }];
      },
      interactive: (command, args) => {
        launches.push([command, ...args]);
        return 0;
      },
      writePreferences: () => ({
        status: "unavailable",
        reason: "the repository preference store is read-only",
      }),
    },
  }, async (desk) => {
    await desk.select("briefed");
    await desk.until(() => discovered > 0, "agent discovery");
    await desk.press("a");
    await desk.opened("agents");
    await desk.choose("claude_code:open");
    await desk.opened("review-agent-brief");
    await desk.shows("takes no prompt");
    await desk.shows("Keep the public names stable.");
    assertEquals(launches, [], "nothing opens before the brief is read");
    await desk.confirm();
    await desk.until(() => launches.length === 1, "the agent");
    await desk.shows("Back from Claude Code");
  });
  assertEquals(launches, [["claude"]]);
  assertStringIncludes(
    joinedTranscript(output),
    "Desk preferences were not saved: the repository preference store is read-only",
  );
});

Deno.test("Queue for landing asks for a pre-authorization first when the queue needs one", async () => {
  const effort = deskTaskEntry("agent/nightly", "/worktrees/nightly", {
    id: "nightly",
    ahead: 1,
    gate_proof: { status: "honored" },
  });
  const calls: string[] = [];
  let authorized = false;
  await withDeskSession({
    runtime: {
      ...surveys(() => deskSurvey([effort])),
      submit: (path, options) => {
        calls.push(options.dryRun === true ? "plan" : "submit");
        return {
          ok: true,
          verb: "accept",
          data: {
            revision: {
              path,
              branch: effort.branch,
              head: "a".repeat(40),
              proof: { candidate_id: "candidate", proof_id: "proof" },
            },
            submission: {
              state: options.dryRun === true ? "planned" : "queued",
              authority: {
                kind: authorized ? "authorized" : "conversation-required",
              },
            },
          },
        };
      },
      grantEffort: (_path, branch) => {
        calls.push("grant");
        authorized = true;
        return { status: "granted", grant: fixtureEffortGrant(branch) };
      },
    },
  }, async (desk) => {
    await runAction(desk, "nightly", "submit");
    await desk.opened("review-submit-review");
    // The grant question comes first; Allow records it and asks the queue
    // question next.
    await desk.shows("Let Nightly land without asking?");
    await desk.shows("asks this first; Keep queues nothing");
    await desk.confirm();
    await desk.until(() => calls.includes("grant"), "the grant");
    await desk.opened("review-submit-review");
    await desk.shows("Queue Nightly for landing?");
    await desk.confirm();
    await desk.until(() => calls.includes("submit"), "the queue entry");
    await desk.shows("Queued Nightly");
  });
  assertEquals(calls, ["plan", "grant", "plan", "submit"]);
});

Deno.test("a failed run's retained failures reach the inspector, and a toggle is remembered", async () => {
  const effort = deskTaskEntry("agent/failing", "/worktrees/failing", {
    id: "failing",
    ahead: 1,
    last_action: {
      verb: "done",
      outcome: "failed",
      at: "2026-07-11T11:00:00Z",
    },
  });
  const selectors: Array<{ branch: string; verb: string }> = [];
  const saved: Array<Parameters<DeskRuntime["writePreferences"]>[1]> = [];
  await withDeskSession({
    runtime: {
      ...surveys(() => deskSurvey([effort])),
      operationRecord: (_root, selector) => {
        selectors.push({ ...selector });
        return {
          kind: "found",
          record_path: "/journal/R1-failing.json",
          handle: "R1-failing",
          executor: "gone",
          record: {
            schema_version: ON_DISK_FORMATS.operationJournal.version,
            operation: {
              handle: "R1-failing",
              verb: "done",
              path: effort.path,
              branch: effort.branch,
              pid: 1,
              started_at: 0,
              finished_at: 1,
            },
            failures: [{
              producer: "test",
              name: "upload",
              message: "upload retried twice",
              file: "tests/upload_test.ts",
              line: 42,
              partial: false,
            }],
            outcome: "failed",
          },
        };
      },
      writePreferences: (_root, preferences) => {
        saved.push(preferences);
        return { status: "saved" };
      },
    },
  }, async (desk) => {
    await desk.select("failing");
    await desk.shows("upload retried twice");
    await desk.palette("Sort by title", "sort");
    await desk.until(() => saved.length === 1, "the remembered sort");
  });
  assertEquals(selectors, [{ branch: effort.branch, verb: "done" }]);
  assertEquals(saved.map((preferences) => preferences.sort), ["title"]);
});
