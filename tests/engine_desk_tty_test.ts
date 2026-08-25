/** Real-PTY characterisation of the complete package-backed Desk session. */

import {
  assert,
  assertEquals,
  assertRejects,
  assertStringIncludes,
} from "@std/assert";
import { measureText } from "discern-design-system/cli";
import { runAgent } from "./engine_helpers.ts";
import {
  deskCollision,
  deskFailedAction,
  deskFleetEntry,
  deskFleetFixture,
  type DeskImplicitWrap,
  deskLandingAuthority,
  deskMissingAgentsAndScripts,
  deskOrphanBranch,
  deskProof,
  deskRunningAction,
  type DeskTtyInputPhase,
  type DeskTtyRunResult,
  type DeskVisibleFrame,
  normaliseDeskTranscript,
  runDeskTty,
  withDeskTtyProject,
} from "./fixtures/desk_tty_harness.ts";
import { decodeCliResult } from "./decode_cli_result.ts";

const PTY_UNAVAILABLE = Deno.build.os === "windows";
const SGR = new RegExp(`${String.fromCharCode(27)}\\[[0-9:;]*m`, "u");
const EMPTY_ROOT_READY = ["Choose a desk action", "Quit"] as const;
const TASK_ROOT_READY = ["Choose a task or action", "Quit"] as const;
const TASK_ACTION_READY = ["Choose an action", "Back"] as const;

/** Require one named semantic frame and keep failures transcript-oriented. */
function frame(
  result: DeskTtyRunResult,
  name: string,
): DeskVisibleFrame {
  const selected = result.frames.find((candidate) => candidate.name === name);
  assert(
    selected !== undefined,
    `missing frame ${name}: ${
      JSON.stringify(result.frames.map((item) => item.name))
    }`,
  );
  return selected;
}

/** Hold every rendered row to terminal cells and the supported-control set. */
function assertFrameFits(
  value: DeskVisibleFrame,
  expectedImplicitWraps: readonly DeskImplicitWrap[] = [],
): void {
  assertEquals(
    value.unexpectedControls,
    [],
    `${value.name} exposed unsupported terminal controls`,
  );
  assertEquals(
    value.implicitWraps,
    expectedImplicitWraps,
    `${value.name} wrote through the ${value.columns}-column boundary`,
  );
  for (const row of value.lines) {
    assertEquals(row.columns, measureText(row.text));
    assert(
      row.columns <= value.columns,
      `${value.name} row ${row.row} is ${row.columns}/${value.columns} columns: ${row.text}`,
    );
  }
}

/** Assert the lifecycle invariants every successful Desk journey shares. */
function assertHealthySession(
  result: DeskTtyRunResult,
  expectedImplicitWraps: Readonly<
    Partial<Record<string, readonly DeskImplicitWrap[]>>
  > = {},
): void {
  assertEquals(result.code, 0, result.transcript);
  assert(
    result.rawBytes.length > 0,
    "the diagnostic transcript must retain raw bytes",
  );
  assertStringIncludes(result.stdout, "Choose");
  assertEquals(result.terminal.restored, true, JSON.stringify(result.terminal));
  assertEquals(
    result.terminal.childExited,
    true,
    JSON.stringify(result.terminal),
  );
  assertEquals(result.terminal.noChild, true, JSON.stringify(result.terminal));
  for (const visible of result.frames) {
    assertFrameFits(visible, expectedImplicitWraps[visible.name]);
  }
  const exit = frame(result, "exit");
  assertEquals(exit.cursor.visible, true, exit.text);
  assertEquals(exit.alternateScreen, false, exit.text);
}

/** Select the last root action (Quit) after capturing the ready frame. */
function rootExitInput(captureAs = "root"): readonly DeskTtyInputPhase[] {
  return [{
    waitFor: EMPTY_ROOT_READY,
    captureAs,
    chunks: [{ keys: ["end", "enter"] }],
  }];
}

Deno.test({
  name: "Desk PTY: an empty fleet exposes Start and exits cleanly",
  ignore: PTY_UNAVAILABLE,
  fn: async () => {
    await withDeskTtyProject(deskFleetFixture(), async (project) => {
      const result = await runDeskTty(project, {
        geometry: { columns: 80, rows: 24 },
        colorMode: "no-color-env",
        input: rootExitInput(),
      });

      assertHealthySession(result);
      const root = frame(result, "root");
      assertStringIncludes(root.text, "Start a task");
      assertStringIncludes(root.text, "Quit");
      assert(root.focusMarkers.length === 1, root.text);
      assert(root.lines.some((row) => row.focused), root.text);
      assertEquals(SGR.test(result.transcript), false, result.transcript);
    });
  },
});

Deno.test({
  name: "Desk PTY: a task opens its real action menu, returns Back, then quits",
  ignore: PTY_UNAVAILABLE,
  fn: async () => {
    const fixture = deskFleetFixture([
      deskFleetEntry("focused-task-a1b2c3", { aheadCommits: 1 }),
    ]);
    await withDeskTtyProject(fixture, async (project) => {
      const result = await runDeskTty(project, {
        geometry: { columns: 90, rows: 28 },
        colorMode: "no-color-flag",
        input: [{
          waitFor: TASK_ROOT_READY,
          captureAs: "root",
          chunks: [{ keys: ["enter"] }],
        }, {
          waitFor: TASK_ACTION_READY,
          captureAs: "action",
          chunks: [{ keys: ["end", "enter"] }],
        }, {
          waitFor: TASK_ROOT_READY,
          captureAs: "back-at-root",
          chunks: [{ keys: ["end", "enter"] }],
        }],
      });

      const actionPreambleOverflow = [{ row: 4, column: 91, text: "w" }];
      assertHealthySession(result, {
        action: actionPreambleOverflow,
        "back-at-root": actionPreambleOverflow,
        exit: actionPreambleOverflow,
      });
      assertStringIncludes(frame(result, "root").text, "Focused task");
      assertStringIncludes(frame(result, "action").text, "Choose an action");
      assertStringIncludes(frame(result, "action").text, "Back");
      assertStringIncludes(frame(result, "back-at-root").text, "Focused task");

      // Characterisation only: the factual task summary is printed as one
      // product preamble line and wraps one cell beyond a 90-column action
      // frame. Responsive preamble layout belongs to
      // `2a-responsive-board.md`; every other overflow remains fatal here.
    });
  },
});

Deno.test({
  name:
    "Desk PTY: Escape and Ctrl-C retain their current root and action semantics",
  ignore: PTY_UNAVAILABLE,
  fn: async () => {
    const fixture = deskFleetFixture([
      deskFleetEntry("cancellation-task-c0ffee", { aheadCommits: 1 }),
    ]);
    await withDeskTtyProject(fixture, async (project) => {
      for (const key of ["escape", "ctrl-c"] as const) {
        const root = await runDeskTty(project, {
          geometry: { columns: 86, rows: 28 },
          colorMode: "no-color-env",
          input: [{
            waitFor: TASK_ROOT_READY,
            captureAs: `${key}-at-root`,
            chunks: [{
              keys: [key],
              ...(key === "escape" ? { allowLoneEscape: true } : {}),
            }],
          }],
        });
        assertHealthySession(root);

        const actionRun = (): Promise<DeskTtyRunResult> =>
          runDeskTty(project, {
            geometry: { columns: 86, rows: 28 },
            colorMode: "no-color-env",
            // The short deadline characterises Escape's known stranded reader.
            // Ctrl-C is a successful journey and keeps the harness's ordinary
            // readiness allowance, including under full-suite load.
            ...(key === "escape" ? { timeoutMs: 5_000 } : {}),
            input: [{
              waitFor: TASK_ROOT_READY,
              chunks: [{ keys: ["enter"] }],
            }, {
              waitFor: TASK_ACTION_READY,
              captureAs: `${key}-at-action`,
              chunks: [{
                keys: [key],
                ...(key === "escape" ? { allowLoneEscape: true } : {}),
              }],
            }, {
              waitFor: TASK_ROOT_READY,
              captureAs: `${key}-returned-to-root`,
              settleMs: 500,
              chunks: [{ keys: ["ctrl-c"] }],
            }],
          });
        if (key === "escape") {
          const action = await assertRejects(
            actionRun,
            Error,
            "exceeded 5000ms",
          );
          const dismissedAt = action.message.indexOf("× Dismissed.");
          assert(dismissedAt >= 0, action.message);
          assert(
            action.message.indexOf("Choose a task or action", dismissedAt) >
              dismissedAt,
            action.message,
          );
          continue;
        }
        const action = await actionRun();
        const actionPreambleOverflow = [{ row: 4, column: 87, text: "i" }];
        assertHealthySession(action, {
          "ctrl-c-at-action": actionPreambleOverflow,
          "ctrl-c-returned-to-root": actionPreambleOverflow,
          exit: actionPreambleOverflow,
        });
        assertStringIncludes(
          frame(action, `${key}-returned-to-root`).text,
          "Cancellation task",
        );
      }

      // Characterisation only: root cancellation exits while action-menu
      // Ctrl-C cancellation returns to a live root reader. Escape redraws the
      // same root but currently leaves its next reader stuck. Key semantics
      // and trap removal belong to
      // `6a-keyboard-accessibility.md`; lifecycle recovery belongs to
      // `7a-refresh-resilience.md`. The shared timeout guard proves the
      // stranded child is still reaped.
    });
  },
});

/** Materialise exactly N fleet members and return their first root frame. */
async function thresholdFrame(taskCount: number): Promise<DeskVisibleFrame> {
  const entries = Array.from(
    { length: taskCount },
    (_, index) =>
      deskFleetEntry(
        `threshold-task-${index + 1}-${String(index).padStart(6, "0")}`,
      ),
  );
  return await withDeskTtyProject(
    deskFleetFixture(entries),
    async (project) => {
      const result = await runDeskTty(project, {
        geometry: { columns: 100, rows: 50 },
        colorMode: "no-color-env",
        input: [{
          waitFor: taskCount > 8
            ? ["Choose a task or action", "Type to filter"]
            : TASK_ROOT_READY,
          captureAs: `${taskCount}-tasks`,
          chunks: [{
            ...(taskCount > 8 ? { input: "Quit" } : { keys: ["end"] }),
          }, {
            settleMs: 40,
            keys: taskCount > 8 ? ["down", "enter"] : ["enter"],
          }],
        }],
      });
      assertHealthySession(result);
      return frame(result, `${taskCount}-tasks`);
    },
  );
}

Deno.test({
  name: "Desk PTY: the ninth task crosses the current filtering threshold",
  ignore: PTY_UNAVAILABLE,
  fn: async () => {
    const eight = await thresholdFrame(8);
    const nine = await thresholdFrame(9);

    assertEquals(eight.text.includes("filter"), false, eight.text);
    assertStringIncludes(nine.text, "filter");
    assertStringIncludes(nine.text, "Type to filter");

    // This pins the current binary threshold, not its suitability. Responsive
    // filter and viewport treatment belongs to `2a-responsive-board.md`.
  },
});

Deno.test({
  name:
    "Desk PTY: colour, --no-color, and NO_COLOR preserve one semantic frame",
  ignore: PTY_UNAVAILABLE,
  fn: async () => {
    await withDeskTtyProject(deskFleetFixture(), async (project) => {
      const colored = await runDeskTty(project, {
        geometry: { columns: 80, rows: 24 },
        colorMode: "color",
        input: rootExitInput("colored"),
      });
      const flag = await runDeskTty(project, {
        geometry: { columns: 80, rows: 24 },
        colorMode: "no-color-flag",
        input: rootExitInput("flag"),
      });
      const environment = await runDeskTty(project, {
        geometry: { columns: 80, rows: 24 },
        colorMode: "no-color-env",
        input: rootExitInput("environment"),
      });

      for (const result of [colored, flag, environment]) {
        assertHealthySession(result);
        assertStringIncludes(
          frame(result, result.frames[0]?.name ?? "").text,
          "Start a task",
        );
      }
      assert(SGR.test(colored.transcript), colored.transcript);
      assertEquals(SGR.test(flag.transcript), false, flag.transcript);
      assertEquals(
        SGR.test(environment.transcript),
        false,
        environment.transcript,
      );
      const roles = new Set(
        frame(colored, "colored").lines.flatMap((row) =>
          row.spans.flatMap((span) => span.roles)
        ),
      );
      assert(roles.has("muted"), JSON.stringify([...roles]));
      assert(roles.has("emphasis"), JSON.stringify([...roles]));
    });
  },
});

Deno.test({
  name: "Desk PTY: a live 60-to-120-column resize redraws without overflow",
  ignore: PTY_UNAVAILABLE,
  fn: async () => {
    const name =
      "responsive-terminal-board-name-that-is-long-enough-to-truncate-cleanly-a1b2c3";
    const friendly =
      "Responsive terminal board name that is long enough to truncate cleanly";
    await withDeskTtyProject(
      deskFleetFixture([deskFleetEntry(name, { aheadCommits: 1 })]),
      async (project) => {
        const result = await runDeskTty(project, {
          geometry: { columns: 60, rows: 28 },
          colorMode: "no-color-env",
          input: [{
            waitFor: TASK_ROOT_READY,
            captureAs: "narrow",
            chunks: [{ resize: { columns: 120, rows: 32 } }, {
              settleMs: 80,
              keys: ["down"],
            }],
          }, {
            waitFor: TASK_ROOT_READY,
            captureAs: "wide",
            chunks: [{ keys: ["escape"], allowLoneEscape: true }],
          }],
        });

        assertHealthySession(result);
        const narrow = frame(result, "narrow");
        const wide = frame(result, "wide");
        assertEquals(narrow.columns, 60);
        assertEquals(wide.columns, 120);
        assertEquals(narrow.text.includes(friendly), false, narrow.text);
        assertStringIncludes(wide.text, friendly);
        assertEquals(result.terminal.initialSize, { columns: 60, rows: 28 });
        assertEquals(result.terminal.finalSize, { columns: 120, rows: 32 });
        assertEquals(result.terminal.resizes, [{ columns: 120, rows: 32 }]);

        // The current board truncates a task identity at narrow widths. Copy,
        // prioritisation, and responsive layout remain owned by
        // `2a-responsive-board.md`; this test only requires a bounded redraw.
      },
    );
  },
});

Deno.test("Desk PTY normalisation exposes clears, overflow, and unknown controls", () => {
  const cleared = normaliseDeskTranscript(
    "clear",
    "obsolete\x1b[2J\x1b[Hcurrent",
    { columns: 20, rows: 3 },
  );
  assertEquals(cleared.clearCount, 1);
  assertEquals(cleared.text.includes("obsolete"), false, cleared.text);
  assertStringIncludes(cleared.text, "current");

  const overflow = normaliseDeskTranscript(
    "overflow",
    "123456",
    { columns: 5, rows: 2 },
  );
  assertEquals(overflow.implicitWraps.length, 1, overflow.text);

  const unsupported = normaliseDeskTranscript(
    "unsupported",
    "before\x1b[999zafter",
    { columns: 20, rows: 3 },
  );
  assertEquals(unsupported.unexpectedControls.length, 1);
  assertEquals(unsupported.unexpectedControls[0]?.raw, "\x1b[999z");
});

Deno.test("Desk PTY fleet builders materialise later-wave state through real authorities", async () => {
  const fixture = deskFleetFixture([
    deskFleetEntry("ready-task-a1b2c3", {
      aheadCommits: 1,
      proof: deskProof(),
      action: deskRunningAction("done"),
      landingAuthority: deskLandingAuthority("effort-grant"),
      availability: { agents: "project-default", scripts: "available" },
    }),
    deskFleetEntry("failed-task-d4e5f6", {
      dirtyFiles: [{ path: "dirty.txt" }],
      action: deskFailedAction("done", { failedStage: "test" }),
      landingAuthority: deskLandingAuthority("conversation-required"),
      availability: deskMissingAgentsAndScripts(),
    }),
  ], {
    collisions: [deskCollision("shared.txt")],
    orphanBranches: [deskOrphanBranch("orphan-task-c0ffee")],
  });

  await withDeskTtyProject(fixture, async (project) => {
    assertEquals(project.worktrees.size, 2);
    const status = await runAgent(project.root, ["status", "--json"], {
      env: { ...project.env },
    });
    assertEquals(status.code, 0, status.output);
    const result = decodeCliResult(status.stdout, "status");
    assert(result.data !== undefined && "fleet" in result.data);
    const ready = result.data.fleet?.find((entry) =>
      entry.branch === "agent/ready-task-a1b2c3"
    );
    const failed = result.data.fleet?.find((entry) =>
      entry.branch === "agent/failed-task-d4e5f6"
    );
    assert(ready !== undefined, status.stdout);
    assert(failed !== undefined, status.stdout);
    assertEquals(ready.gate_proof?.status, "honored");
    assertEquals(ready.running?.verb, "done");
    assertEquals(ready.landing_authority?.kind, "authorized");
    assertEquals(ready.landing_authority?.source, "effort-grant");
    assertEquals(failed.last_action?.verb, "done");
    assertEquals(failed.last_action?.outcome, "failed");
    assertEquals(failed.last_action?.failed_stage, "test");
    assertEquals(result.data.fleet_collisions?.map((item) => item.total), [1]);
    assertEquals(result.data.unlanded_branches, ["agent/orphan-task-c0ffee"]);
  });
});
