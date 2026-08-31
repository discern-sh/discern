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
  type DeskTtyCapture,
  type DeskTtyInputPhase,
  type DeskTtyRunResult,
  type DeskVisibleFrame,
  normaliseDeskTranscript,
  runDeskTty,
  withDeskTtyProject,
} from "./fixtures/desk_tty_harness.ts";
import { decodeCliResult } from "./decode_cli_result.ts";
import { realPtyTest } from "./real_pty.ts";

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

/** Capture only after the visible Desk frame exposes its complete focus state. */
function focusedCapture(
  name: string,
  firstText: string,
  ...remainingText: string[]
): DeskTtyCapture {
  return {
    name,
    when: {
      includes: [firstText, ...remainingText],
      focusMarkers: 1,
    },
  };
}

/** Capture a non-picker frame only after all asserted visible text exists. */
function textCapture(
  name: string,
  firstText: string,
  ...remainingText: string[]
): DeskTtyCapture {
  return {
    name,
    when: { includes: [firstText, ...remainingText] },
  };
}

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
    `${value.name} wrote through the ${value.columns}-column boundary\n${value.text}`,
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
function rootExitInput(captureName = "root"): readonly DeskTtyInputPhase[] {
  return [{
    waitFor: EMPTY_ROOT_READY,
    capture: focusedCapture(captureName, "Start a task", "Quit"),
    chunks: [{ keys: ["end", "enter"] }],
  }];
}

realPtyTest({
  name:
    "Desk PTY: a 40-column short empty fleet exposes Start and exits cleanly",
  contracts: [
    "terminal-modes",
    "control-rendering",
    "process-lifecycle",
    "platform-transport",
  ],
  canary: true,
  ignore: PTY_UNAVAILABLE,
  fn: async () => {
    await withDeskTtyProject(deskFleetFixture(), async (project) => {
      const result = await runDeskTty(project, {
        geometry: { columns: 40, rows: 16 },
        colorMode: "no-color-env",
        input: [{
          waitFor: ["Choose a Desk command", "Start a task"],
          capture: focusedCapture("root", "Start a task", "3 more"),
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

realPtyTest({
  name:
    "Desk PTY: an incomplete setup opens read-only recovery before task actions",
  contracts: [
    "terminal-modes",
    "control-rendering",
    "process-lifecycle",
    "platform-transport",
  ],
  canary: true,
  ignore: PTY_UNAVAILABLE,
  fn: async () => {
    const fixture = deskFleetFixture([
      deskFleetEntry("recovery-task-a1b2c3", { setup: "incomplete" }),
    ]);
    await withDeskTtyProject(fixture, async (project) => {
      const result = await runDeskTty(project, {
        geometry: { columns: 100, rows: 42 },
        colorMode: "no-color-env",
        input: [{
          waitFor: TASK_ROOT_READY,
          chunks: [{ keys: ["enter"] }],
        }, {
          waitFor: ["Choose an action", "Show recovery steps"],
          capture: focusedCapture(
            "recovery-action",
            "Choose an action",
            "Show recovery steps",
          ),
          chunks: [{ keys: ["enter"] }],
        }, {
          waitFor: [
            "Task recovery needed",
            "Setup repair",
            "The task remains intact",
          ],
          capture: textCapture(
            "recovery-detail",
            "Task recovery needed",
            "Setup repair",
            "The task remains intact",
          ),
          chunks: [{ keys: ["enter"] }],
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
      const action = frame(result, "recovery-action");
      const detail = frame(result, "recovery-detail");
      assertUniqueFocus(action);
      assertStringIncludes(detail.text, "Task recovery needed");
      assertStringIncludes(detail.text, "Setup repair");
      assertStringIncludes(detail.text, "The task remains intact");
    });
  },
});

realPtyTest({
  name:
    "Desk PTY: progressive creation preserves title, brief, base, and identity",
  contracts: [
    "terminal-modes",
    "control-rendering",
    "process-lifecycle",
    "platform-transport",
  ],
  canary: true,
  ignore: PTY_UNAVAILABLE,
  fn: async () => {
    const title = "Complete task ingress: Unicode 修复";
    const brief = "Preserve this exact brief before the selected agent opens.";
    await withDeskTtyProject(deskFleetFixture(), async (project) => {
      const result = await runDeskTty(project, {
        geometry: { columns: 100, rows: 55 },
        colorMode: "no-color-env",
        input: [{
          waitFor: EMPTY_ROOT_READY,
          chunks: [{ keys: ["enter"] }],
        }, {
          waitFor: ["What are you changing?", "Describe the task"],
          capture: focusedCapture(
            "creation-title-route",
            "What are you changing?",
            "Describe the task",
          ),
          chunks: [{ keys: ["enter"] }],
        }, {
          waitFor: ["Task title", "Describe the change in one line"],
          chunks: [{ input: `${title}\r` }],
        }, {
          waitFor: ["Choose the creation path", "More options"],
          chunks: [{ keys: ["down", "enter"] }],
        }, {
          waitFor: [
            "Choose where this task starts",
            "Start from the current trunk tip",
          ],
          chunks: [{ keys: ["enter"] }],
        }, {
          waitFor: ["One-line task brief", "What should the agent know"],
          chunks: [{ input: `${brief}\r` }],
        }, {
          waitFor: [
            "Choose an agent action",
            "Create without opening an agent",
          ],
          chunks: [{ keys: ["enter"] }],
        }, {
          waitFor: ["Pre-authorize this task", "Later", "Pre-authorize"],
          chunks: [{ keys: ["enter"] }],
        }, {
          waitFor: ["Creation facts", title, brief, "Base commit"],
          capture: textCapture(
            "creation-preview",
            "Creation facts",
            title,
            brief,
            "Worktree id",
            "No agent will open",
          ),
          chunks: [{ keys: ["right", "enter"] }],
        }, {
          waitFor: "Press Enter to continue.",
          capture: textCapture(
            "creation-report",
            "Created identity",
            title,
            brief,
            "Path",
          ),
          chunks: [{ keys: ["enter"] }],
        }, {
          waitFor: "Choose an action",
          capture: focusedCapture(
            "created-task-detail",
            "Choose an action",
          ),
          chunks: [{ keys: ["end", "enter"] }],
        }, {
          waitFor: TASK_ROOT_READY,
          chunks: [{ keys: ["end", "enter"] }],
        }],
        env: { LANG: "en_GB.UTF-8", LC_ALL: "en_GB.UTF-8" },
      });

      assertHealthySession(result);
      assertUniqueFocus(frame(result, "creation-title-route"));
      assertStringIncludes(frame(result, "creation-preview").text, title);
      assertStringIncludes(frame(result, "creation-preview").text, brief);
      assertStringIncludes(frame(result, "creation-report").text, "Path");
      assertStringIncludes(
        result.transcript,
        `# ${title}\r\n\r\nTask metadata\r\nOutcome: ${brief}`,
      );

      const status = await runAgent(project.root, [
        "status",
        "--verbose",
        "--json",
      ]);
      assertEquals(status.code, 0, status.output);
      const decoded = decodeCliResult(status.stdout, "status");
      assert(decoded.data !== undefined && "fleet" in decoded.data);
      const created = decoded.data.fleet?.find((entry) => !entry.is_main);
      assert(created !== undefined, status.stdout);
      assertEquals(created.task?.title, title);
      assertEquals(created.task?.brief, brief);
      assertEquals(created.task?.title_source, "recorded");
      assertEquals(created.task?.created_from?.ref, "main");
      assertEquals(created.task?.id, created.id);
      assertEquals(created.task?.branch, created.branch);
      assert(created.task?.title !== created.id);
    });
  },
});

realPtyTest({
  name: "Desk PTY: task rename changes the title without changing identity",
  contracts: [
    "terminal-modes",
    "control-rendering",
    "process-lifecycle",
    "platform-transport",
  ],
  canary: true,
  ignore: PTY_UNAVAILABLE,
  fn: async () => {
    const id = "rename-journey-a1b2c3";
    const originalTitle = "Rename journey";
    const title = "Renamed task: Unicode 修复";
    await withDeskTtyProject(
      deskFleetFixture([deskFleetEntry(id, { aheadCommits: 1 })]),
      async (project) => {
        const result = await runDeskTty(project, {
          geometry: { columns: 100, rows: 50 },
          colorMode: "no-color-env",
          input: [{
            waitFor: TASK_ROOT_READY,
            chunks: [{ keys: ["enter"] }],
          }, {
            waitFor: ["Choose an action", "Change task title"],
            chunks: [{
              keys: ["down", "down", "down", "down", "down", "enter"],
            }],
          }, {
            waitFor: "New task title",
            chunks: [{
              input: `${"\u007f".repeat(originalTitle.length)}${title}\r`,
            }],
          }, {
            waitFor: ["Task title plan", title, "Change"],
            capture: textCapture("rename-preview", "Task title plan", title),
            chunks: [{ keys: ["right", "enter"] }],
          }, {
            waitFor: "Press Enter to continue.",
            chunks: [{ keys: ["enter"] }],
          }, {
            waitFor: "Choose an action",
            chunks: [{ keys: ["end", "enter"] }],
          }, {
            waitFor: TASK_ROOT_READY,
            chunks: [{ keys: ["end", "enter"] }],
          }],
          env: { LANG: "en_GB.UTF-8", LC_ALL: "en_GB.UTF-8" },
        });

        assertHealthySession(result);
        assertStringIncludes(frame(result, "rename-preview").text, title);
        assertStringIncludes(result.transcript, `# ${title}`);

        const status = await runAgent(project.root, [
          "status",
          "--verbose",
          "--json",
        ]);
        assertEquals(status.code, 0, status.output);
        const decoded = decodeCliResult(status.stdout, "status");
        assert(decoded.data !== undefined && "fleet" in decoded.data);
        const renamed = decoded.data.fleet?.find((entry) => !entry.is_main);
        assert(renamed !== undefined, status.stdout);
        assertEquals(renamed.id, id);
        assertEquals(renamed.branch, `agent/${id}`);
        assertEquals(renamed.task?.title, title);
        assertEquals(renamed.task?.title_source, "recorded");
      },
    );
  },
});

realPtyTest({
  name:
    "Desk PTY: Proof review opens the actual diff through the pager and returns",
  contracts: ["terminal-modes", "process-lifecycle", "platform-transport"],
  canary: true,
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
          chunks: [{ keys: ["down", "down", "down", "down", "enter"] }],
        }, {
          waitFor: [
            "Review Review pager",
            "Stored Proof",
            "View actual diff",
          ],
          capture: textCapture(
            "proof-review",
            "Proof: review pager fixture",
            "Stored Proof",
            "Open in editor",
            "$VISUAL or $EDITOR",
          ),
          chunks: [{ keys: ["enter"] }],
        }, {
          waitFor: ["Review Review pager", "View actual diff"],
          capture: textCapture(
            "pager-return",
            "Review Review pager",
            "View actual diff",
          ),
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

realPtyTest({
  name:
    "Desk PTY: Escape and Ctrl-C retain their current root and action semantics",
  contracts: [
    "line-discipline",
    "signal-delivery",
    "terminal-modes",
    "process-lifecycle",
  ],
  canary: true,
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
            capture: focusedCapture(
              `${key}-at-root`,
              "Choose a task or Desk command",
            ),
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
              capture: focusedCapture(
                `${key}-at-action`,
                "Choose an action",
              ),
              chunks: [{
                keys: [key],
                ...(key === "escape" ? { allowLoneEscape: true } : {}),
              }],
            }, {
              waitFor: TASK_ROOT_READY,
              capture: focusedCapture(
                `${key}-returned-to-root`,
                "Cancellation task",
              ),
              chunks: [{ settleMs: 500, keys: ["ctrl-c"] }],
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

realPtyTest({
  name: "Desk PTY: colour and --no-color preserve one semantic frame",
  contracts: ["control-rendering", "terminal-modes"],
  canary: true,
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
      for (const result of [colored, flag]) {
        assertHealthySession(result);
        assertStringIncludes(
          frame(result, result.frames[0]?.name ?? "").text,
          "Start a task",
        );
      }
      assert(SGR.test(colored.transcript), colored.transcript);
      assertEquals(SGR.test(flag.transcript), false, flag.transcript);
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

realPtyTest({
  name: "Desk PTY: a live 60-to-120-column resize redraws without overflow",
  contracts: ["resize-delivery", "control-rendering", "terminal-modes"],
  canary: true,
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
            capture: focusedCapture(
              "narrow",
              "Choose a task or Desk command",
            ),
            chunks: [{ resize: { columns: 120, rows: 50 } }, {
              keys: ["down"],
            }],
          }, {
            waitFor: TASK_START_SELECTED,
            capture: focusedCapture("wide", "› [●] Start a task"),
            chunks: [{ keys: ["up", "enter"] }],
          }, {
            waitFor: TASK_ACTION_READY,
            capture: focusedCapture("full-detail", "Choose an action"),
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
