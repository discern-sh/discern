/** Integrated Desk behavior through the production package application boundary. */
import { assertCases, assertCasesAsync } from "./assert_cases.ts";
import {
  assert,
  assertEquals,
  assertRejects,
  assertStringIncludes,
} from "@std/assert";
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
} from "../src/engine/desk/application_view.ts";
import { DESK_ACTION_LABELS } from "../src/shared/desk_vocabulary.ts";
import {
  buildDeskRows,
  DESK_ACTIONS,
  deskRowId,
} from "../src/engine/desk/model.ts";
import type {
  StatusData,
  StatusFleetEntry,
} from "../src/shared/result_schemas.ts";
import { statusData, taskFleetEntry } from "./fixtures/status_fleet.ts";
import { assertTerminalTextIncludes } from "./helpers.ts";
import { ManualScheduler } from "./manual_scheduler.ts";
import { waitForPendingCondition, waitUntil } from "./waiting.ts";

/** A healthy task with current Proof, as the status authority reports it. */
function entry(
  id: string,
  patch: Partial<StatusFleetEntry> = {},
): StatusFleetEntry {
  return taskFleetEntry(id, {
    ahead: 1,
    gate_proof: { status: "honored" },
    ...patch,
  });
}
/** Observe outstanding reads while retaining the package testing protocol. */
class CountedTerminal extends FakeTerminalIO {
  activeReads = 0;
  maximumReads = 0;
  override async read(): Promise<Uint8Array | null> {
    this.maximumReads = Math.max(this.maximumReads, ++this.activeReads);
    try {
      return await super.read();
    } finally {
      this.activeReads--;
    }
  }
}

/** Run the production adapter with package I/O and an explicitly controlled scheduler. */
async function session(patch: Partial<LiveDeskDependencies> = {}): Promise<{
  io: CountedTerminal;
  scheduler: ManualScheduler;
  running: Promise<TerminalApplicationState<DeskChoice>>;
  state: () => TerminalApplicationState<DeskChoice>;
  ready: () => Promise<void>;
  stop: () => Promise<void>;
  fail: (error: Error) => void;
}> {
  const io = new CountedTerminal([], { holdOpen: true, columns: 80, rows: 24 });
  const scheduler = new ManualScheduler();
  let context: TerminalApplicationContext<DeskChoice> | undefined;
  const options = liveDesk({
    observe: () => Promise.resolve(statusData([entry("alpha"), entry("beta")])),
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
    fail: (error) => context?.fail(error),
    stop: async () => {
      io.enqueue("q");
      await running;
      io.close();
      assertEquals(scheduler.pending.size, 0);
      assertEquals(io.rawTransitions.at(-1), false);
    },
  };
}

Deno.test("Desk live sessions retain navigation, observations, and bounded ownership", async () => {
  const cases = [
    {
      name:
        "Desk navigation and search complete while a later observation is unresolved",
      check: async () => {
        const pending = Promise.withResolvers<StatusData>();
        let calls = 0;
        const test = await session({
          observe: () =>
            ++calls === 1
              ? Promise.resolve(
                statusData(
                  Array.from(
                    { length: 100 },
                    (_, i) => entry(`task-${String(i).padStart(3, "0")}`),
                  ),
                ),
              )
              : pending.promise,
        });
        await test.ready();
        await waitUntil(
          () => test.scheduler.pending.size === 1,
          "refresh scheduled",
        );
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
        pending.resolve(statusData([entry("task-090"), entry("task-001")]));
        await waitUntil(
          () => test.state().view.title.includes("Refreshing") === false,
          "refresh settles",
        );
        assertEquals(test.state().positions.tasks?.query, "task 090");
        await test.stop();
      },
    },
    {
      name:
        "Desk retains the last good fleet after failure and Retry replaces it",
      check: async () => {
        let observed = statusData([entry("alpha")]);
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
        observed = statusData([entry("beta")]);
        test.io.enqueue("r");
        await waitUntil(
          () => test.state().positions.tasks?.selectedId === "beta",
          "retry adopted",
        );
        await test.stop();
      },
    },
    {
      name:
        "Desk initial failure remains usable and cancellation ignores an obsolete completion",
      check: async () => {
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
        pending.resolve(statusData([entry("late")]));
        await pending.promise;
        assertEquals(test.io.writes.length, writes);
        const failed = await session({
          observe: () => Promise.reject(new Error("First read failed")),
        });
        await failed.ready();
        assertStringIncludes(failed.state().view.title, "Stale");
        await failed.stop();
      },
    },
    {
      name: "Desk stale actions never fall through to a neighboring task",
      check: async () => {
        let observed = statusData([entry("alpha"), entry("beta")]);
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
        observed = statusData([entry("beta")]);
        // Land… is a ready task's next step, so it leads its controls.
        test.io.enqueueKeys("enter");
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
      },
    },
    {
      name:
        "Desk rechecks running state and preserves reading and focus through foreground return",
      check: async () => {
        let observed = statusData([entry("alpha")]);
        let effects = 0;
        const test = await session({
          observe: () => Promise.resolve(observed),
          perform: () => {
            effects++;
            return Promise.resolve();
          },
        });
        await test.ready();
        test.io.enqueueKeys("enter");
        await waitUntil(
          () =>
            test.state().positions["task:alpha:actions"]?.selectedId ===
              "accept",
          "Accept selected",
        );
        observed = statusData([
          entry("alpha", {
            running: {
              verb: "done",
              started: "2026-01-01T00:00:00Z",
              elapsed_ms: 1,
            },
          }),
        ]);
        test.io.enqueueKeys("enter");
        await waitUntil(
          () => test.state().view.title.includes("is running"),
          "fresh refusal",
        );
        assertEquals(effects, 0);
        observed = statusData([entry("alpha")]);
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
      },
    },
    {
      name:
        "Desk bounds selected capability discovery and keeps one stable Tip per session",
      check: async () => {
        const first = Promise.withResolvers<
          ReturnType<typeof buildDeskRows>[number]
        >();
        let calls = 0;
        let tips = 0;
        const test = await session({
          capabilities: (row) =>
            ++calls === 1 ? first.promise : Promise.resolve(row),
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
        await waitUntil(
          () => test.scheduler.pending.size === 1,
          "refresh complete",
        );
        assertEquals(tips, 1);
        await test.stop();
      },
    },
    {
      name:
        "Desk preserves detail reading, task identity and overview search through Back and resize",
      check: async () => {
        const observed = statusData([
          entry("alpha", { path: `/tasks/${"long path ".repeat(150)}` }),
          entry("beta"),
        ]);
        const test = await session({
          observe: () => Promise.resolve(observed),
        });
        await test.ready();
        test.io.enqueue("/alpha\r\r");
        await waitUntil(
          () => test.state().view.regions[0].id === "task:alpha:actions",
          "filtered task",
        );
        test.io.enqueue("/details\r\r");
        await waitUntil(
          () => test.state().focusedRegionId === "task:alpha:details",
          "details focused",
        );
        test.io.enqueueKeys("page-down");
        await waitUntil(
          () =>
            (test.state().positions["task:alpha:details"]?.scrollOffset ?? 0) >
              0,
          "reading scrolled",
        );
        const position = test.state().positions["task:alpha:details"]
          ?.scrollOffset;
        test.io.resize(40, 20);
        test.io.enqueue("r");
        await waitUntil(
          () => test.scheduler.pending.size === 1,
          "refresh complete",
        );
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
      },
    },
    {
      name:
        "Desk retains known tasks when a successful status envelope cannot observe Git or fleet",
      check: async () => {
        let observed = statusData([entry("alpha")]);
        const test = await session({
          observe: () => Promise.resolve(observed),
        });
        await test.ready();
        observed = { ...statusData(), git: null };
        test.io.enqueue("r");
        await waitUntil(
          () => test.state().view.title.includes("Stale"),
          "unknown Git retains board",
        );
        assertEquals(test.state().positions.tasks?.selectedId, "alpha");
        await test.stop();
      },
    },
    {
      name: "Desk optional Tip failures do not fail the live session",
      check: async () => {
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
      },
    },
    {
      name:
        "Desk capability discovery survives faster status refreshes without publishing stale task facts",
      check: async () => {
        let observed = statusData([entry("alpha")]);
        const pending = Promise.withResolvers<
          ReturnType<typeof buildDeskRows>[number]
        >();
        let capabilityRow: ReturnType<typeof buildDeskRows>[number] | undefined;
        let calls = 0;
        let observations = 0;
        const test = await session({
          observe: () => {
            observations++;
            return Promise.resolve(observed);
          },
          capabilities: (row) => {
            calls++;
            capabilityRow = row;
            return pending.promise;
          },
        });
        await test.ready();
        test.io.enqueueKeys("enter");
        await waitForPendingCondition(
          test.running,
          () => calls === 1,
          "capability read starts",
        );
        assert(capabilityRow);
        for (let i = 0; i < 3; i++) {
          observed = statusData([
            entry("alpha", { clean: false, gate_proof: { status: "dirty" } }),
          ]);
          test.io.enqueue("r");
          await waitForPendingCondition(
            test.running,
            () => observations === i + 2,
            "refresh observed",
          );
          await waitForPendingCondition(
            test.running,
            () => test.scheduler.pending.size === 1,
            "refresh settles",
          );
        }
        pending.resolve({
          ...capabilityRow,
          scripts: [{ name: "inspect-current" }],
        });
        await pending.promise;
        // The fresh status (now Editing) wins over the slower discovery's
        // snapshot, and the discovered scripts still apply.
        await waitUntil(
          () =>
            (test.state().view.regions[0]?.title ?? "").includes(
              "Task controls · Editing",
            ),
          "fresh status after discovery",
        );
        test.io.enqueueKeys("down", "down", "down", "enter");
        await waitUntil(
          () => test.state().view.regions[0]?.id === "task:alpha:more",
          "navigation after discovery",
        );
        const choices = test.state().view.regions[0];
        assert(choices?.kind === "choices");
        const scripts = choices.entries.find((choice) =>
          choice.id === "scripts"
        );
        assert(scripts && scripts.kind !== "group-heading");
        assertEquals(
          scripts.disabled,
          undefined,
          "finished discovery enables scripts despite intervening status refreshes",
        );
        assertEquals(
          calls,
          1,
          "status refresh must not restart the pending capability read",
        );
        await test.stop();
      },
    },
    {
      name:
        "Desk sustained refresh, resize and return keep one timer, subscription and input owner",
      check: async () => {
        let observations = 0;
        let effects = 0;
        const test = await session({
          observe: () => {
            observations++;
            return Promise.resolve(statusData([entry("alpha"), entry("beta")]));
          },
          perform: () => {
            effects++;
            return Promise.resolve();
          },
        });
        await test.ready();
        for (let cycle = 0; cycle < 100; cycle++) {
          await waitUntil(
            () => test.scheduler.pending.size === 1,
            "one refresh timer",
          );
          const next = observations + 1;
          test.scheduler.fire(5000);
          test.io.resize(cycle % 2 ? 80 : 120, cycle % 2 ? 24 : 30);
          await waitUntil(
            () => observations === next && test.scheduler.pending.size === 1,
            "refresh complete",
          );
          assertEquals(test.io.resizeListenerCount, 1);
          assert(test.io.activeReads <= 1);
          assertEquals(test.io.maximumReads, 1);
        }
        for (let cycle = 0; cycle < 20; cycle++) {
          test.io.enqueueKeys("tab", "home", "enter");
          await waitUntil(
            () =>
              effects === cycle + 1 && test.io.rawTransitions.at(-1) === true,
            "foreground returns",
          );
          // The first key after each return must reach the current Desk reader.
          test.io.enqueueKeys("tab", "end");
          await waitUntil(
            () =>
              test.state().focusedRegionId === "tasks" &&
              test.state().positions.tasks?.selectedId === "beta",
            "first returned key switches to tasks",
          );
          assertEquals(test.io.resizeListenerCount, 1);
          assertEquals(test.io.maximumReads, 1);
        }
        await test.stop();
        assertEquals(test.io.activeReads, 0);
        assertEquals(test.io.resizeListenerCount, 0);
      },
    },
    {
      name:
        "Desk EOF and fatal provider failure release refresh and input ownership",
      check: async () => {
        for (const cause of ["EOF", "fatal"] as const) {
          const test = await session();
          await test.ready();
          const failed = assertRejects(() => test.running);
          if (cause === "EOF") test.io.close();
          else test.fail(new Error("fatal source failure"));
          await failed;
          assertEquals(test.scheduler.pending.size, 0);
          assertEquals(test.io.resizeListenerCount, 0);
          assertEquals(test.io.rawTransitions.at(-1), false);
          test.io.close();
          await Promise.resolve();
          assertEquals(test.io.activeReads, 0);
        }
      },
    },
    {
      name:
        "Proof inspection does not wait for unrelated agent and script discovery",
      check: async () => {
        const pending = Promise.withResolvers<
          ReturnType<typeof buildDeskRows>[number]
        >();
        let started: ReturnType<typeof buildDeskRows>[number] | undefined;
        let performed = false;
        const test = await session({
          capabilities: (row) => {
            started = row;
            return pending.promise;
          },
          perform: (choice) => {
            performed = choice.kind === "action" && choice.action === "inspect";
            return Promise.resolve();
          },
        });
        try {
          await test.ready();
          test.io.enqueueKeys("enter");
          await waitUntil(
            () => started !== undefined,
            "capability discovery starts",
          );
          test.io.enqueue(`/${DESK_ACTION_LABELS.inspect}\r\r`);
          await waitUntil(
            () => performed,
            "Proof opens while unrelated discovery remains pending",
            { timeoutMs: 1000 },
          );
        } finally {
          assert(started);
          pending.resolve(started);
          await test.stop();
        }
      },
    },
  ];
  await assertCasesAsync(cases, (row) => row.name, async (row) => {
    await row.check();
  });
});

Deno.test("Desk application views keep independent facts, controls, and viewport contracts", () => {
  const cases = [
    {
      name:
        "Desk frames fit the viewport for empty, single and large fleets across geometry and appearance",
      check: () => {
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
                const fleet = statusData(
                  Array.from({ length: count }, (_, i) => entry(`task-${i}`)),
                );
                const tasks = buildDeskRows(
                  fleet.fleet ?? [],
                  new Map(),
                  new Map(),
                  {
                    trunk: "main",
                    nowMs: 0,
                  },
                );
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
                    {
                      data: fleet,
                      rows: tasks,
                      phase: "fresh",
                      tip: "Stable Tip",
                    },
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
                      ? "Keyboard shortcuts"
                      : page === "queue"
                      ? "Landing"
                      : "Tip",
                  );
                }
              }
            }
          }
        }
      },
    },
    {
      name:
        "the task page names status's state, while Proof, authority and the queue stay separate facts",
      check: () => {
        const fleet = statusData([
          entry("alpha", {
            landing_authority: { kind: "authorized", source: "effort-grant" },
          }),
        ]);
        const rowsFor = (data: StatusData) =>
          buildDeskRows(data.fleet ?? [], new Map(), new Map(), {
            trunk: "main",
            nowMs: 0,
            queue: data.queue ?? [],
            fleetCollisions: [{
              branches: ["agent/alpha", "agent/beta"],
              overlap: ["shared.ts"],
              total: 1,
            }],
          });
        const row = rowsFor(fleet)[0];
        assert(row);
        assertEquals(row.decision.state, "approved");
        assertEquals(row.decision.proof.honored, true);
        assertEquals(row.decision.authority.summary, "Pre-authorized by you");
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
        assertTerminalTextIncludes(controls.frame, "Task controls · Approved");
        assert(!controls.frame.includes("Proof valid"));

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
        const queued = rowsFor(fleet)[0];
        assert(queued);
        assertEquals(queued.decision.state, "queued");
        assertEquals(queued.decision.label, "Queued #1");
        assert(
          queued.decision.details.some((detail) =>
            detail.text === "Queue: #1 · lands with any landing"
          ),
        );
      },
    },
    {
      name:
        "the task page offers the state's next steps and More actions holds every other action once",
      check: () => {
        const rows = buildDeskRows([entry("alpha")], new Map(), new Map(), {
          trunk: "main",
          nowMs: 0,
        });
        const actionsOn = (page: "task" | "more"): string[] =>
          deskApplicationView({ rows, phase: "fresh" }, page, "alpha")
            .regions.flatMap((region) =>
              region.kind === "choices"
                ? region.entries.flatMap((choice) =>
                  choice.kind !== "group-heading" &&
                    choice.value.kind === "action"
                    ? [choice.value.action]
                    : []
                )
                : []
            );
        assertEquals(rows[0]?.decision.state, "ready");
        assertEquals(actionsOn("task"), ["accept", "inspect", "grant"]);
        assertEquals(
          [...actionsOn("task"), ...actionsOn("more")].sort(),
          [...DESK_ACTIONS].sort(),
        );
      },
    },
    {
      name: "an unavailable action shows its reason and cannot be chosen",
      check: () => {
        const rows = buildDeskRows([entry("alpha")], new Map(), new Map(), {
          trunk: "main",
          nowMs: 0,
        });
        const more =
          deskApplicationView({ rows, phase: "fresh" }, "more", "alpha")
            .regions[0];
        assert(more?.kind === "choices");
        const agent = more.entries.find((choice) => choice.id === "agent");
        assert(agent && agent.kind !== "group-heading");
        assertEquals(agent.disabled, true);
        assertStringIncludes(agent.description ?? "", "No agent is configured");
      },
    },
  ];
  assertCases(cases, (row) => row.name, (row) => {
    row.check();
  });
});
