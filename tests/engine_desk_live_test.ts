/** Integrated Desk behavior through the production package application boundary. */
import { assert, assertEquals, assertStringIncludes } from "@std/assert";
import {
  captureTerminalFrame,
  FakeTerminalIO,
} from "discern-design-system/cli/interactive/testing";
import {
  renderTerminalApplication,
  type TerminalApplicationContext,
  type TerminalApplicationState,
  updateTerminalApplication,
} from "discern-design-system/cli/interactive";
import { runTerminalApplication } from "../src/lib/terminal_interaction.ts";
import {
  liveDesk,
  type LiveDeskDependencies,
} from "../src/engine/desk/live.ts";
import {
  deskApplicationView,
  type DeskChoice,
  deskSubmission,
} from "../src/engine/desk/application_view.ts";
import {
  buildDeskRows,
  DESK_ACTIONS,
  deskRowId,
} from "../src/engine/desk/model.ts";
import type {
  StatusData,
  StatusFleetEntry,
} from "../src/shared/result_schemas.ts";
import { assertTerminalTextIncludes } from "./helpers.ts";
import { ManualScheduler } from "./manual_scheduler.ts";
import { waitForPendingCondition, waitUntil } from "./waiting.ts";

/** A healthy task from the status authority, with per-case observations. */
function entry(
  id: string,
  patch: Partial<StatusFleetEntry> = {},
): StatusFleetEntry {
  return {
    id,
    path: `/tasks/${id}`,
    branch: `agent/${id}`,
    is_main: false,
    is_current: false,
    clean: true,
    ahead: 1,
    behind: 0,
    filesystem: { state: "directory" },
    setup: { state: "ready", marker: "present" },
    gate_proof: { status: "honored" },
    ...patch,
  };
}
/** A projected status response with no inferred submission. */
function data(fleet: StatusFleetEntry[] = []): StatusData {
  return {
    location: "main",
    root: "/project",
    project: "Example",
    worktree: null,
    git: {
      branch: "main",
      trunk: "main",
      clean: true,
      changed_files: 0,
      behind_trunk: 0,
      ahead_trunk: 0,
    },
    standards: [],
    fleet,
  };
}
/** Run the production adapter with package I/O and an explicitly controlled scheduler. */
async function session(patch: Partial<LiveDeskDependencies> = {}): Promise<{
  io: FakeTerminalIO;
  scheduler: ManualScheduler;
  running: Promise<TerminalApplicationState<DeskChoice>>;
  state: () => TerminalApplicationState<DeskChoice>;
  ready: () => Promise<void>;
  stop: () => Promise<void>;
}> {
  const io = new FakeTerminalIO([], { holdOpen: true, columns: 80, rows: 24 });
  const scheduler = new ManualScheduler();
  let context: TerminalApplicationContext<DeskChoice> | undefined;
  const options = liveDesk({
    observe: () => Promise.resolve(data([entry("alpha"), entry("beta")])),
    capabilities: (row) => Promise.resolve(row),
    tip: () => Promise.resolve("One stable teaching line."),
    perform: () => Promise.resolve(),
    now: () => 0,
    trunk: "main",
    scheduler,
    ...patch,
  });
  const running = runTerminalApplication({
    ...options,
    start: (live) => {
      context = live;
      return options.start?.(live);
    },
  }, { io, interactive: () => true });
  await waitForPendingCondition(
    running,
    () => context !== undefined,
    "Desk subscription started",
  );
  return {
    io,
    scheduler,
    running,
    state: () => {
      assert(context);
      return context.state;
    },
    ready: () =>
      waitForPendingCondition(
        running,
        () => context?.state.view.title.includes("Loading") === false,
        "Desk observed",
      ),
    stop: async () => {
      io.enqueue("q");
      await running;
      io.close();
      assertEquals(scheduler.pending.size, 0);
      assertEquals(io.rawTransitions.at(-1), false);
    },
  };
}

Deno.test("Desk navigation and search complete while a later observation is unresolved", async () => {
  const pending = Promise.withResolvers<StatusData>();
  let calls = 0;
  const test = await session({
    observe: () =>
      ++calls === 1
        ? Promise.resolve(
          data(
            Array.from(
              { length: 100 },
              (_, i) => entry(`task-${String(i).padStart(3, "0")}`),
            ),
          ),
        )
        : pending.promise,
  });
  await test.ready();
  await waitUntil(() => test.scheduler.pending.size === 1, "refresh scheduled");
  test.scheduler.fire(5000);
  await waitUntil(() => calls === 2, "slow discovery started");
  test.io.enqueue("/task 090\r\r");
  await waitUntil(
    () => test.state().view.title.startsWith("Task 090"),
    "typing and activation complete before discovery",
  );
  assertEquals(calls, 2);
  test.io.enqueueKeys("escape", "down", "down");
  await waitUntil(
    () => test.state().positions.tasks?.selectedId === "task-090",
    "filtered selection survives Back",
  );
  pending.resolve(data([entry("task-090"), entry("task-001")]));
  await waitUntil(
    () => test.state().view.title.includes("Refreshing") === false,
    "refresh settles",
  );
  assertEquals(test.state().positions.tasks?.query, "task 090");
  await test.stop();
});

Deno.test("Desk retains the last good fleet after failure and Retry replaces it", async () => {
  let observed = data([entry("alpha")]);
  let fail = false;
  const test = await session({
    observe: () =>
      fail
        ? Promise.reject(new Error("Git unavailable"))
        : Promise.resolve(observed),
  });
  await test.ready();
  fail = true;
  test.io.enqueue("r");
  await waitUntil(
    () => test.state().view.title.includes("Stale"),
    "stale board",
  );
  assertEquals(test.state().positions.tasks?.selectedId, "alpha");
  assertStringIncludes(
    captureTerminalFrame(test.io.output(), test.io.size()).frame,
    "Alpha",
  );
  fail = false;
  observed = data([entry("beta")]);
  test.io.enqueue("r");
  await waitUntil(
    () => test.state().positions.tasks?.selectedId === "beta",
    "retry adopted",
  );
  await test.stop();
});

Deno.test("Desk initial failure remains usable and cancellation ignores an obsolete completion", async () => {
  const pending = Promise.withResolvers<StatusData>();
  const test = await session({ observe: () => pending.promise });
  test.io.enqueue("?");
  await waitForPendingCondition(
    pending.promise,
    () => test.state().view.regions[0].id === "help",
    "help available while loading",
  );
  await test.stop();
  const writes = test.io.writes.length;
  pending.resolve(data([entry("late")]));
  await pending.promise;
  assertEquals(test.io.writes.length, writes);
  const failed = await session({
    observe: () => Promise.reject(new Error("First read failed")),
  });
  await failed.ready();
  assertStringIncludes(failed.state().view.title, "Stale");
  await failed.stop();
});

Deno.test("Desk stale actions never fall through to a neighboring task", async () => {
  let observed = data([entry("alpha"), entry("beta")]);
  const performed: DeskChoice[] = [];
  const test = await session({
    observe: () => Promise.resolve(observed),
    perform: (choice) => {
      performed.push(choice);
      return Promise.resolve();
    },
  });
  await test.ready();
  test.io.enqueueKeys("enter");
  await waitUntil(
    () => test.state().view.regions[0].id === "task:alpha:actions",
    "alpha controls",
  );
  observed = data([entry("beta")]);
  test.io.enqueueKeys("down", "down", "down", "enter");
  await waitUntil(
    () => test.state().view.title.includes("no action ran"),
    "obsolete action refused",
  );
  assertEquals(performed, []);
  test.io.enqueueKeys("escape");
  await waitUntil(
    () => test.state().view.regions[0].id === "tasks",
    "return after removal",
  );
  assertEquals(test.state().positions.tasks?.selectedId, "beta");
  await test.stop();
});

Deno.test("Desk rechecks running state and preserves reading and focus through foreground return", async () => {
  let observed = data([entry("alpha")]);
  let effects = 0;
  const test = await session({
    observe: () => Promise.resolve(observed),
    perform: () => {
      effects++;
      return Promise.resolve();
    },
  });
  await test.ready();
  test.io.enqueueKeys("enter", "down", "down", "down");
  await waitUntil(
    () => test.state().positions["task:alpha:actions"]?.selectedId === "accept",
    "Accept selected",
  );
  observed = data([
    entry("alpha", {
      running: { verb: "done", started: "2026-01-01T00:00:00Z", elapsed_ms: 1 },
    }),
  ]);
  test.io.enqueueKeys("enter");
  await waitUntil(
    () => test.state().view.title.includes("is running"),
    "fresh refusal",
  );
  assertEquals(effects, 0);
  observed = data([entry("alpha")]);
  test.io.enqueue("r");
  await waitUntil(
    () => !test.state().view.title.includes("Refreshing"),
    "refusal remains while facts change",
  );
  const notice = test.state().view.regions[0];
  assertEquals(notice.id, "notice");
  assertTerminalTextIncludes(
    captureTerminalFrame(test.io.output(), test.io.size()).frame,
    "is running",
  );
  test.io.enqueueKeys("escape");
  await waitUntil(
    () => test.state().view.regions[0].id === "task:alpha:actions",
    "Back from refusal",
  );
  assertEquals(test.state().focusedRegionId, "task:alpha:actions");
  assertEquals(
    test.state().positions["task:alpha:actions"]?.selectedId,
    "accept",
  );
  test.io.enqueueKeys("enter");
  await waitUntil(() => effects === 1, "fresh Accept performed");
  await waitUntil(
    () => test.io.rawTransitions.length >= 5,
    "foreground restored",
  );
  assertEquals(
    test.state().positions["task:alpha:actions"]?.selectedId,
    "accept",
  );
  await test.stop();
});

Deno.test("Desk bounds selected capability discovery and keeps one stable Tip per session", async () => {
  const first = Promise.withResolvers<
    ReturnType<typeof buildDeskRows>[number]
  >();
  let calls = 0;
  let tips = 0;
  const test = await session({
    capabilities: (row) => ++calls === 1 ? first.promise : Promise.resolve(row),
    tip: () => {
      tips++;
      return Promise.resolve("Stable tip");
    },
  });
  await test.ready();
  test.io.enqueueKeys("enter", "escape", "down", "enter");
  await waitUntil(
    () => test.state().view.title.startsWith("Beta"),
    "selection changes during discovery",
  );
  assertEquals(calls, 1);
  const firstRow = buildDeskRows([entry("alpha")], new Map(), new Map(), {
    trunk: "main",
    nowMs: 0,
  })[0];
  assert(firstRow);
  first.resolve(firstRow);
  await waitUntil(
    () => calls === 2,
    "latest detail begins after obsolete detail",
  );
  test.io.enqueue("r");
  await waitUntil(() => test.scheduler.pending.size === 1, "refresh complete");
  assertEquals(tips, 1);
  await test.stop();
});

Deno.test("Desk frames fit the viewport for empty, single and large fleets across geometry and appearance", () => {
  for (const count of [0, 1, 100]) {
    for (
      const [columns, rows] of [
        [80, 24],
        [120, 30],
        [60, 50],
        [40, 20],
        [80, 13],
        [31, 9],
        [32, 10],
      ] as const
    ) {
      for (const unicode of [false, true]) {
        for (const theme of ["light", "dark"] as const) {
          const fleet = data(
            Array.from({ length: count }, (_, i) => entry(`task-${i}`)),
          );
          const tasks = buildDeskRows(fleet.fleet ?? [], new Map(), new Map(), {
            trunk: "main",
            nowMs: 0,
          });
          for (
            const page of [
              "overview",
              "task",
              "details",
              "help",
              "tip",
              "queue",
            ] as const
          ) {
            const io = new FakeTerminalIO([], {
              columns: columns,
              rows: rows,
              unicode,
              colorDepth: unicode ? "truecolor" : "none",
            });
            const view = deskApplicationView(
              { data: fleet, rows: tasks, phase: "fresh", tip: "Stable Tip" },
              page,
              tasks[0] && deskRowId(tasks[0]),
            );
            const frame = renderTerminalApplication(
              updateTerminalApplication(view),
              io.size(),
              io.capabilities(),
              { theme },
            );
            assertEquals(frame.frame.split("\n").length, rows);
            assertStringIncludes(
              frame.frame,
              columns < 32
                ? "Resize"
                : page === "overview"
                ? count === 0 ? "No tasks" : "Tasks"
                : count === 0 && ["task", "details"].includes(page)
                ? "No tasks"
                : page === "task" || page === "details"
                ? "Task controls"
                : page === "help"
                ? "Keyboard help"
                : page === "queue"
                ? "Landing queue"
                : "Tip",
            );
          }
        }
      }
    }
  }
});

Deno.test("Proof, authority, submission revision, activity and advisory overlap remain independent", () => {
  const fleet = data([
    entry("alpha", {
      landing_authority: { kind: "authorized", source: "effort-grant" },
    }),
  ]);
  const row = buildDeskRows(fleet.fleet ?? [], new Map(), new Map(), {
    trunk: "main",
    nowMs: 0,
    fleetCollisions: [{
      branches: ["agent/alpha", "agent/beta"],
      overlap: ["shared.ts"],
      total: 1,
    }],
  })[0];
  assert(row);
  assertEquals(row.decision.proof.honored, true);
  assertEquals(row.decision.authority.status, "granted");
  assertEquals(row.decision.recommendedAction, undefined);
  assertEquals(deskSubmission(row, fleet), "Not queued");
  const ordinary = new FakeTerminalIO([], { columns: 80, rows: 24 });
  const controls = renderTerminalApplication(
    updateTerminalApplication(
      deskApplicationView(
        { data: fleet, rows: [row], phase: "fresh" },
        "task",
        deskRowId(row),
      ),
    ),
    ordinary.size(),
    ordinary.capabilities(),
    { theme: "dark" },
  );
  assertTerminalTextIncludes(
    controls.frame,
    "Proof valid · Authorized · Not queued",
  );

  fleet.queue = [{
    effort: "alpha",
    branch: "agent/alpha",
    path: "/tasks/alpha",
    head: "older-submitted-revision",
    submitted_at: "2026-01-01",
    authority: "pre-authorized",
    position: 1,
    readiness: "ready",
  }];
  assertStringIncludes(deskSubmission(row, fleet), "older-submit");
});

Deno.test("Desk exposes every registered action once across primary and More controls", () => {
  const rows = buildDeskRows([entry("alpha")], new Map(), new Map(), {
    trunk: "main",
    nowMs: 0,
  });
  const actions = ["task", "more"].flatMap((page) =>
    deskApplicationView(
      { rows, phase: "fresh" },
      page as "task" | "more",
      "alpha",
    ).regions.flatMap((region) =>
      region.kind === "choices"
        ? region.entries.flatMap((choice) =>
          choice.kind !== "group-heading" && choice.value.kind === "action"
            ? [choice.value.action]
            : []
        )
        : []
    )
  );
  assertEquals(
    [...actions, "revoke_grant"].sort(),
    DESK_ACTIONS.filter((action) =>
      !["reclaim", "recovery", "retry_setup"].includes(action)
    ).sort(),
  );
  for (const action of ["reclaim", "recovery", "retry_setup"] as const) {
    assert(!actions.includes(action));
  }
  const granted = buildDeskRows(
    [entry("alpha", {
      landing_authority: {
        kind: "authorized",
        source: "effort-grant",
        scopes: [],
      },
    })],
    new Map(),
    new Map(),
    { trunk: "main", nowMs: 0 },
  );
  const grantMenu =
    deskApplicationView({ rows: granted, phase: "fresh" }, "task", "alpha")
      .regions[0];
  assert(grantMenu.kind === "choices");
  assert(grantMenu.entries.some((choice) => choice.id === "revoke_grant"));
  assertEquals(
    grantMenu.entries.some((choice) => choice.id === "grant"),
    false,
  );
});

Deno.test("Desk preserves detail reading, task identity and overview search through Back and resize", async () => {
  const observed = data([
    entry("alpha", { path: `/tasks/${"long path ".repeat(150)}` }),
    entry("beta"),
  ]);
  const test = await session({ observe: () => Promise.resolve(observed) });
  await test.ready();
  test.io.enqueue("/alpha\r\r");
  await waitUntil(
    () => test.state().view.regions[0].id === "task:alpha:actions",
    "filtered task",
  );
  test.io.enqueue("/proof\r\r");
  await waitUntil(
    () => test.state().focusedRegionId === "task:alpha:details",
    "details focused",
  );
  test.io.enqueueKeys("page-down");
  await waitUntil(
    () => (test.state().positions["task:alpha:details"]?.scrollOffset ?? 0) > 0,
    "reading scrolled",
  );
  const position = test.state().positions["task:alpha:details"]?.scrollOffset;
  test.io.resize(40, 20);
  test.io.enqueue("r");
  await waitUntil(() => test.scheduler.pending.size === 1, "refresh complete");
  assertEquals(
    test.state().positions["task:alpha:details"]?.scrollOffset,
    position,
  );
  test.io.enqueueKeys("escape");
  await waitUntil(
    () => test.state().focusedRegionId === "task:alpha:actions",
    "Back retains menu focus",
  );
  test.io.enqueueKeys("enter");
  await waitUntil(
    () => test.state().focusedRegionId === "task:alpha:details",
    "details reopened",
  );
  assertEquals(
    test.state().positions["task:alpha:details"]?.scrollOffset,
    position,
  );
  test.io.enqueueKeys("escape");
  await waitUntil(
    () => test.state().focusedRegionId === "task:alpha:actions",
    "Back again",
  );
  test.io.enqueueKeys("escape");
  await waitUntil(
    () => test.state().view.regions[0].id === "tasks",
    "overview restored",
  );
  assertEquals(test.state().positions.tasks?.query, "alpha");
  assertEquals(test.state().positions.tasks?.selectedId, "alpha");
  await test.stop();
});

Deno.test("Desk retains known tasks when a successful status envelope cannot observe Git or fleet", async () => {
  let observed = data([entry("alpha")]);
  const test = await session({ observe: () => Promise.resolve(observed) });
  await test.ready();
  observed = { ...data(), git: null };
  test.io.enqueue("r");
  await waitUntil(
    () => test.state().view.title.includes("Stale"),
    "unknown Git retains board",
  );
  assertEquals(test.state().positions.tasks?.selectedId, "alpha");
  await test.stop();
});

Deno.test("Desk optional Tip failures do not fail the live session", async () => {
  const test = await session({
    tip: () => Promise.reject(new Error("Tip storage unreadable")),
  });
  await test.ready();
  test.io.enqueueKeys("down");
  await waitUntil(
    () => test.state().positions.tasks?.selectedId === "beta",
    "navigation remains available",
  );
  await test.stop();
});
