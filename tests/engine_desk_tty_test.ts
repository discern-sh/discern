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
const EMPTY_ROOT_READY = ["Choose a Desk command", "Quit"] as const;
const TASK_ROOT_READY = ["Choose a task or Desk command", "Quit"] as const;
const TASK_START_SELECTED = [
  "Choose a task or Desk command",
  "› [●] Start a task",
] as const;
const TASK_ACTION_READY = ["Choose an action"] as const;
const TASK_ACTION_BACK_SELECTED = [
  "Choose an action",
  "› [●] Back",
] as const;

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

/** One visible picker frame has exactly one active item. */
function assertUniqueFocus(value: DeskVisibleFrame): void {
  assertEquals(
    value.focusMarkers.length,
    1,
    `${value.name} must expose one focus marker\n${value.text}`,
  );
  assertEquals(
    value.lines.filter((row) => row.focused).length,
    1,
    `${value.name} must style one focused row\n${value.text}`,
  );
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
  name:
    "Desk PTY: a 40-column short empty fleet exposes Start and exits cleanly",
  ignore: PTY_UNAVAILABLE,
  fn: async () => {
    await withDeskTtyProject(deskFleetFixture(), async (project) => {
      const result = await runDeskTty(project, {
        geometry: { columns: 40, rows: 16 },
        colorMode: "no-color-env",
        input: [{
          waitFor: ["Choose a Desk command", "Start a task"],
          captureAs: "root",
          chunks: [{ keys: ["end", "enter"] }],
        }],
        env: { LANG: "C", LC_ALL: "C" },
      });

      assertHealthySession(result);
      const root = frame(result, "root");
      assertStringIncludes(root.text, "Start a task");
      assertStringIncludes(root.text, "3 more");
      assertStringIncludes(result.transcript, "Quit");
      assertStringIncludes(result.transcript, "No tasks");
      assertUniqueFocus(root);
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
          chunks: [{ keys: ["end"] }],
        }, {
          waitFor: TASK_ACTION_BACK_SELECTED,
          captureAs: "action",
          chunks: [{ keys: ["enter"] }],
        }, {
          waitFor: TASK_ROOT_READY,
          captureAs: "back-at-root",
          chunks: [{ keys: ["end", "enter"] }],
        }],
      });

      assertHealthySession(result);
      assertStringIncludes(frame(result, "root").text, "Focused task");
      assertStringIncludes(frame(result, "action").text, "Choose an action");
      assertStringIncludes(frame(result, "action").text, "Back");
      assertStringIncludes(frame(result, "back-at-root").text, "Focused task");
    });
  },
});

Deno.test({
  name:
    "Desk PTY: final-check cancellation defaults to No and keeps disabled recovery visible",
  ignore: PTY_UNAVAILABLE,
  fn: async () => {
    const fixture = deskFleetFixture([
      deskFleetEntry("safe-default-a1b2c3", { aheadCommits: 1 }),
    ]);
    await withDeskTtyProject(fixture, async (project) => {
      const result = await runDeskTty(project, {
        geometry: { columns: 110, rows: 50 },
        colorMode: "no-color-env",
        input: [{
          waitFor: TASK_ROOT_READY,
          chunks: [{ keys: ["enter"] }],
        }, {
          waitFor: ["Choose an action", "Run final checks"],
          captureAs: "action-with-disabled-reasons",
          chunks: [{ keys: ["enter"] }],
        }, {
          waitFor: [
            "Run final checks for agent/safe-default-a1b2c3?",
            "Cancel",
            "Run",
          ],
          captureAs: "safe-confirmation",
          chunks: [{ keys: ["enter"] }],
        }, {
          waitFor: TASK_ACTION_READY,
          captureAs: "cancelled-action",
          chunks: [{ keys: ["end", "enter"] }],
        }, {
          waitFor: TASK_ROOT_READY,
          chunks: [{ keys: ["end", "enter"] }],
        }],
      });

      assertHealthySession(result);
      assertStringIncludes(
        frame(result, "safe-confirmation").text,
        "› Cancel",
      );
      assertStringIncludes(result.transcript, "Run: discern done");
      assertStringIncludes(result.transcript, "Consequence account");
      assertStringIncludes(result.transcript, "not on PATH");
      assertStringIncludes(result.transcript, "Project Scripts directory");
      assertEquals(
        result.transcript.includes("Final checks passed"),
        false,
        result.transcript,
      );
    });
  },
});

Deno.test({
  name:
    "Desk PTY: Run final checks records Proof and returns to Proof-led review",
  ignore: PTY_UNAVAILABLE,
  fn: async () => {
    const fixture = deskFleetFixture([
      deskFleetEntry("run-checks-d4e5f6", { aheadCommits: 1 }),
    ]);
    await withDeskTtyProject(fixture, async (project) => {
      const result = await runDeskTty(project, {
        geometry: { columns: 110, rows: 50 },
        colorMode: "no-color-env",
        input: [{
          waitFor: TASK_ROOT_READY,
          chunks: [{ keys: ["enter"] }],
        }, {
          waitFor: ["Choose an action", "Run final checks"],
          chunks: [{ keys: ["enter"] }],
        }, {
          waitFor: [
            "Run final checks for agent/run-checks-d4e5f6?",
            "Cancel",
            "Run",
          ],
          chunks: [{ keys: ["right", "enter"] }],
        }, {
          waitFor: [
            "Final checks passed and Proof was refreshed.",
            "press ↵ to return to the desk",
          ],
          captureAs: "gate-result",
          chunks: [{ keys: ["enter"] }],
        }, {
          waitFor: [
            "Proof honored for this commit",
            "Choose an action",
            "Review and land on main",
          ],
          captureAs: "proof-led-action",
          chunks: [{ keys: ["end", "enter"] }],
        }, {
          waitFor: TASK_ROOT_READY,
          chunks: [{ keys: ["end", "enter"] }],
        }],
        timeoutMs: 120_000,
      });

      assertHealthySession(result);
      assertStringIncludes(
        frame(result, "gate-result").text,
        "Final checks passed and Proof was refreshed.",
      );
      assertStringIncludes(
        frame(result, "proof-led-action").text,
        "Proof honored for this commit",
      );
      assertStringIncludes(
        frame(result, "proof-led-action").text,
        "Review and land on main",
      );
      assertStringIncludes(result.transcript, "Run: discern done");
    });
  },
});

Deno.test({
  name:
    "Desk PTY: Proof review opens the actual diff through the pager and returns",
  ignore: PTY_UNAVAILABLE,
  fn: async () => {
    const name = "review-pager-a1b2c3";
    const fixture = deskFleetFixture([
      deskFleetEntry(name, {
        committedFiles: [{
          path: "review.txt",
          contents: "review through the repository pager\n",
        }],
        proof: deskProof({
          line: "Proof: review pager fixture",
          markdown:
            "# Stored Proof\n\n## Checks\n\n- fixture passed\n\n## Standards\n\n- held",
        }),
      }),
    ]);
    await withDeskTtyProject(fixture, async (project) => {
      const result = await runDeskTty(project, {
        geometry: { columns: 110, rows: 50 },
        colorMode: "no-color-env",
        env: {
          PAGER: "perl -pe 's/\\e\\[[0-9;]*m//g'",
          VISUAL: "",
          EDITOR: "",
        },
        input: [{
          waitFor: TASK_ROOT_READY,
          chunks: [{ keys: ["enter"] }],
        }, {
          waitFor: ["Choose an action", "Review Proof and changes"],
          chunks: [{ keys: ["down", "down", "down", "enter"] }],
        }, {
          waitFor: [
            "Review Review pager",
            "Stored Proof",
            "View actual diff",
          ],
          captureAs: "proof-review",
          chunks: [{ keys: ["enter"] }],
        }, {
          waitFor: ["Review Review pager", "View actual diff"],
          captureAs: "pager-return",
          chunks: [{ keys: ["end", "enter"] }],
        }, {
          waitFor: TASK_ACTION_READY,
          chunks: [{ keys: ["end", "enter"] }],
        }, {
          waitFor: TASK_ROOT_READY,
          chunks: [{ keys: ["end", "enter"] }],
        }],
        timeoutMs: 60_000,
      });

      assertHealthySession(result);
      const review = frame(result, "proof-review");
      const returned = frame(result, "pager-return");
      assertStringIncludes(review.text, "Proof: review pager fixture");
      assertStringIncludes(review.text, "Stored Proof");
      assertStringIncludes(review.text, "Open in editor");
      assertStringIncludes(review.text, "$VISUAL or $EDITOR");
      assertStringIncludes(result.transcript, "diff --git");
      assertStringIncludes(result.transcript, "review.txt");
      assertStringIncludes(returned.text, "View actual diff");
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
            action.message.indexOf(
              "Choose a task or Desk command",
              dismissedAt,
            ) >
              dismissedAt,
            action.message,
          );
          continue;
        }
        const action = await actionRun();
        assertHealthySession(action);
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
      const captureAs = `${taskCount}-tasks`;
      const input: readonly DeskTtyInputPhase[] = taskCount > 8
        ? [{
          waitFor: [
            "Choose a task or Desk command",
            "Type to filter",
            "Threshold task",
          ],
          captureAs,
          chunks: [{ keys: ["ctrl-c"] }],
        }]
        : [{
          waitFor: ["Choose a task or Desk command", "Threshold task"],
          captureAs,
          chunks: [{ keys: ["end"] }],
        }, {
          waitFor: ["› [●] Quit"],
          chunks: [{ keys: ["enter"] }],
        }];
      const result = await runDeskTty(project, {
        geometry: { columns: 80, rows: 18 },
        colorMode: "no-color-env",
        input,
        timeoutMs: 30_000,
      });
      assertHealthySession(result);
      const root = frame(result, captureAs);
      if (taskCount > 8) {
        assertEquals(root.focusMarkers.length, 0, root.text);
      } else {
        assertUniqueFocus(root);
      }
      return root;
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

    // The ninth task activates search while a directly scannable fleet does
    // not spend a row on filter help.
  },
});

Deno.test({
  name:
    "Desk PTY: a 120-column tall 50-task Unicode fleet stays bounded and recovers its decision",
  ignore: PTY_UNAVAILABLE,
  fn: async () => {
    const unicodeName = "unicode-修复终端布局和证明显示-a1b2c3";
    const entries = [
      deskFleetEntry(unicodeName, {
        aheadCommits: 1,
        proof: deskProof(),
        landingAuthority: deskLandingAuthority("conversation-required"),
      }),
      ...Array.from(
        { length: 49 },
        (_, index) =>
          deskFleetEntry(
            `routine-task-${index + 1}-${String(index).padStart(6, "0")}`,
          ),
      ),
    ];
    await withDeskTtyProject(deskFleetFixture(entries), async (project) => {
      const result = await runDeskTty(project, {
        geometry: { columns: 120, rows: 50 },
        colorMode: "color",
        input: [{
          waitFor: [
            "Choose a task or Desk command",
            "Unicode 修复终端布局和证明显示",
            "Proof honored for this commit",
          ],
          chunks: [{ keys: ["down"] }],
        }, {
          waitFor: [
            "Choose a task or Desk command",
            "›",
            "Unicode 修复终端布局和证明显示",
          ],
          captureAs: "50-task-root",
          chunks: [{ keys: ["enter"] }],
        }, {
          waitFor: TASK_ACTION_READY,
          captureAs: "50-task-detail",
          chunks: [{ keys: ["end", "enter"] }],
        }, {
          waitFor: [
            "Choose a task or Desk command",
            "Unicode 修复终端布局和证明显示",
          ],
          chunks: [{ keys: ["ctrl-c"] }],
        }],
        timeoutMs: 60_000,
      });

      assertHealthySession(result);
      const root = frame(result, "50-task-root");
      const detail = frame(result, "50-task-detail");
      assertUniqueFocus(root);
      assertUniqueFocus(detail);
      assertStringIncludes(result.transcript, "50 tasks");
      assertStringIncludes(result.transcript, "1 need you");
      assertStringIncludes(result.transcript, "1 ready to review");
      assertStringIncludes(result.transcript, "修复终端布局和证明显示");
      assertStringIncludes(result.transcript, "Proof honored for this commit");
      assertStringIncludes(result.transcript, "Landing authority");
      assertStringIncludes(result.transcript, "Choose an action");
    });
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
          geometry: { columns: 60, rows: 40 },
          colorMode: "no-color-env",
          input: [{
            waitFor: TASK_ROOT_READY,
            captureAs: "narrow",
            chunks: [{ resize: { columns: 120, rows: 50 } }, {
              keys: ["down"],
            }],
          }, {
            waitFor: TASK_START_SELECTED,
            captureAs: "wide",
            chunks: [{ keys: ["up", "enter"] }],
          }, {
            waitFor: TASK_ACTION_READY,
            captureAs: "full-detail",
            chunks: [{ keys: ["end"] }],
          }, {
            waitFor: TASK_ACTION_BACK_SELECTED,
            chunks: [{ keys: ["enter"] }],
          }, {
            waitFor: TASK_ROOT_READY,
            chunks: [{ keys: ["end", "enter"] }],
          }],
        });

        assertHealthySession(result);
        const narrow = frame(result, "narrow");
        const wide = frame(result, "wide");
        assertEquals(narrow.columns, 60);
        assertEquals(wide.columns, 120);
        assertEquals(narrow.text.includes(friendly), false, narrow.text);
        assertStringIncludes(wide.text, "Responsive terminal boar");
        assertStringIncludes(result.transcript, friendly);
        assertStringIncludes(result.transcript, "Task evidence");
        assertStringIncludes(
          frame(result, "full-detail").text,
          "Choose an action",
        );
        assertUniqueFocus(narrow);
        assertUniqueFocus(wide);
        assertUniqueFocus(frame(result, "full-detail"));
        assertEquals(result.terminal.initialSize, { columns: 60, rows: 40 });
        assertEquals(result.terminal.finalSize, { columns: 120, rows: 50 });
        assertEquals(result.terminal.resizes, [{ columns: 120, rows: 50 }]);

        // The narrow queue keeps identity bounded; selecting the task opens
        // its full title and evidence. The wide queue can expose more identity
        // without changing the selected task.
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

  const styledFocus = normaliseDeskTranscript(
    "styled-focus",
    "\x1b[1m› \x1b[0m○ Choice",
    { columns: 20, rows: 3 },
  );
  assertEquals(styledFocus.focusMarkers.length, 1);
  assertEquals(styledFocus.lines[0]?.focused, true);

  const asciiFocus = normaliseDeskTranscript(
    "ascii-focus",
    "> [*] Choice",
    { columns: 20, rows: 3 },
  );
  assertEquals(asciiFocus.focusMarkers.length, 1);
  assertEquals(asciiFocus.lines[0]?.focused, true);
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
