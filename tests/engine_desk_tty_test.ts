/** Real-PTY characterisation of the complete package-backed Desk session. */

import { assert, assertEquals, assertStringIncludes } from "@std/assert";
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
const EMPTY_ROOT_READY = ["No tasks yet", "/ find"] as const;
const TASK_ROOT_READY = ["Tasks (", "/ find"] as const;
const TASK_ACTION_READY = ["Task controls", "/ find"] as const;

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
  assertStringIncludes(result.stdout, "discern");
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
  for (const mode of ["1000", "1006"]) {
    const changes = exit.controls.filter((control) =>
      control.action.endsWith(`-mouse-${mode}`)
    );
    if (changes.length > 0) {
      assertEquals(
        changes.at(-1)?.action,
        `disable-mouse-${mode}`,
        "the shared reader releases mouse input on return",
      );
    }
  }
}

/** Select the last root action (Quit) after capturing the ready frame. */
function rootExitInput(captureName = "root"): readonly DeskTtyInputPhase[] {
  return [{
    waitFor: ["No tasks yet", "Tip:"],
    capture: focusedCapture(captureName, "Start a task"),
    chunks: [{ input: "q" }],
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
          waitFor: EMPTY_ROOT_READY,
          capture: focusedCapture("root", "Start a task"),
          chunks: [{ input: "q" }],
        }],
        env: { LANG: "C", LC_ALL: "C" },
      });

      assertHealthySession(result);
      const root = frame(result, "root");
      assertStringIncludes(root.text, "Start a task");
      assertStringIncludes(root.text, "/ find");
      assertStringIncludes(root.text, "Tab");
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
          waitFor: TASK_ACTION_READY,
          chunks: [{ input: "/more\r\r" }],
        }, {
          waitFor: "› More actions",
          chunks: [{ input: "/recovery\r\r" }],
        }, {
          waitFor: ["Recovery", "Tab choices/read  Esc back"],
          capture: textCapture(
            "recovery-detail",
            "Recovery",
            "Tab choices/read  Esc back",
          ),
          chunks: [{ keys: ["escape"], allowLoneEscape: true }],
        }, {
          waitFor: "› More actions",
          chunks: [{ keys: ["escape"], allowLoneEscape: true }],
        }, {
          waitFor: TASK_ACTION_READY,
          chunks: [{ keys: ["escape"], allowLoneEscape: true }],
        }, {
          waitFor: TASK_ROOT_READY,
          chunks: [{ input: "q" }],
        }],
        timeoutMs: 60_000,
      });

      assertHealthySession(result);
      const detail = frame(result, "recovery-detail");
      assertStringIncludes(detail.text, "Recovery");
      assertStringIncludes(detail.text, "Back");
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
          waitFor: [
            "Create task",
            "Cancel",
            "Tab choices/read  Esc back",
          ],
          capture: textCapture("creation-preview", "Create task", "Cancel"),
          chunks: [{ keys: ["tab", "down", "enter"] }],
        }, {
          waitFor: "Task controls",
          capture: focusedCapture(
            "created-task-detail",
            "Task controls",
          ),
          chunks: [{ keys: ["end", "enter"] }],
        }, {
          waitFor: TASK_ROOT_READY,
          chunks: [{ input: "q" }],
        }],
        env: { LANG: "en_GB.UTF-8", LC_ALL: "en_GB.UTF-8" },
      });

      assertHealthySession(result);
      assertUniqueFocus(frame(result, "creation-title-route"));
      assertStringIncludes(frame(result, "creation-preview").text, title);
      assertStringIncludes(result.transcript, brief);

      assertStringIncludes(
        result.transcript,
        title,
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
            waitFor: TASK_ACTION_READY,
            chunks: [{ input: "/more\r\r" }],
          }, {
            waitFor: "› More actions",
            chunks: [{ input: "/change task\r\r" }],
          }, {
            waitFor: "New task title",
            chunks: [{
              input: `${"\u007f".repeat(originalTitle.length)}${title}`,
            }, { resize: { columns: 80, rows: 24 } }],
          }, {
            waitFor: ["New task title", title],
            capture: textCapture("resized-form", title, "New task title"),
            chunks: [{ keys: ["enter"] }],
          }, {
            waitFor: [
              "Change task title",
              title,
              "Tab choices/read  Esc back",
            ],
            capture: textCapture("rename-preview", "Change task title", title),
            chunks: [{ keys: ["tab", "down", "enter"] }],
          }, {
            waitFor: "› More actions",
            chunks: [{ keys: ["escape"], allowLoneEscape: true }],
          }, {
            waitFor: TASK_ACTION_READY,
            chunks: [{ keys: ["escape"], allowLoneEscape: true }],
          }, {
            waitFor: TASK_ROOT_READY,
            chunks: [{ input: "q" }],
          }],
          env: { LANG: "en_GB.UTF-8", LC_ALL: "en_GB.UTF-8" },
        });

        assertHealthySession(result);
        assertStringIncludes(frame(result, "rename-preview").text, title);
        assertStringIncludes(result.transcript, title);

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
          waitFor: TASK_ACTION_READY,
          chunks: [{ input: "/more\r\r" }],
        }, {
          waitFor: "› More actions",
          chunks: [{ input: "/review\r\r" }],
        }, {
          waitFor: [
            "Review Review pager",
            "Complete Proof",
            "Tab choices/read  Esc back",
          ],
          capture: textCapture(
            "proof-review",
            "Proof: review pager fixture",
            "Complete Proof",
            "Back",
          ),
          chunks: [{ keys: ["tab", "down", "down", "down", "enter"] }],
        }, {
          waitFor: ["Review Review pager", "View actual diff"],
          capture: textCapture(
            "pager-return",
            "Review Review pager",
            "View actual diff",
          ),
          chunks: [{ keys: ["escape"], allowLoneEscape: true }],
        }, {
          waitFor: "› More actions",
          chunks: [{ keys: ["escape"], allowLoneEscape: true }],
        }, {
          waitFor: TASK_ACTION_READY,
          chunks: [{ keys: ["escape"], allowLoneEscape: true }],
        }, {
          waitFor: TASK_ROOT_READY,
          chunks: [{ input: "q" }],
        }],
        timeoutMs: 60_000,
      });

      assertHealthySession(result);
      const review = frame(result, "proof-review");
      const returned = frame(result, "pager-return");
      assertStringIncludes(review.text, "Proof: review pager fixture");
      assertStringIncludes(review.text, "Complete Proof");
      assertStringIncludes(review.text, "Back");
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
              "Tasks (",
            ),
            chunks: [{
              keys: [key],
              ...(key === "escape" ? { allowLoneEscape: true } : {}),
            }],
          }],
        });
        assertHealthySession(root);

        if (key === "ctrl-c") continue;
        const action = await runDeskTty(project, {
          geometry: { columns: 86, rows: 28 },
          colorMode: "no-color-env",
          input: [{
            waitFor: TASK_ROOT_READY,
            chunks: [{ keys: ["enter"] }],
          }, {
            waitFor: TASK_ACTION_READY,
            capture: focusedCapture(
              `${key}-at-action`,
              "Task controls",
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
            chunks: [{ keys: ["ctrl-c"] }],
          }],
        });
        assertHealthySession(action);
        assertStringIncludes(
          frame(action, `${key}-returned-to-root`).text,
          "Cancellation task",
        );
      }
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
  name:
    "Desk PTY: live resize preserves the selected task and fits the new viewport",
  contracts: ["resize-delivery", "control-rendering", "terminal-modes"],
  canary: true,
  ignore: PTY_UNAVAILABLE,
  fn: async () => {
    await withDeskTtyProject(
      deskFleetFixture([
        deskFleetEntry("responsive-task-a1b2c3", { aheadCommits: 1 }),
      ]),
      async (project) => {
        const result = await runDeskTty(project, {
          geometry: { columns: 60, rows: 40 },
          colorMode: "no-color-env",
          input: [{
            waitFor: TASK_ROOT_READY,
            capture: focusedCapture("narrow", "Tasks ("),
            chunks: [{ keys: ["enter"] }],
          }, {
            waitFor: TASK_ACTION_READY,
            chunks: [{ resize: { columns: 120, rows: 30 } }],
          }, {
            waitFor: ["Task controls", "Current work"],
            capture: focusedCapture("wide", "Task controls", "Current work"),
            chunks: [{ input: "q" }],
          }],
        });
        assertHealthySession(result);
        assertEquals(frame(result, "narrow").columns, 60);
        assertEquals(frame(result, "wide").columns, 120);
        assertStringIncludes(frame(result, "wide").text, "Responsive task");
        assertEquals(result.terminal.resizes, [{ columns: 120, rows: 30 }]);
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

  const restored = normaliseDeskTranscript(
    "foreground-return",
    "main\x1b[?1049h\x1b[2J\x1b[Htemporary\x1b[?1049l next",
    { columns: 30, rows: 4 },
  );
  assertStringIncludes(restored.text, "main next");
  assertEquals(restored.text.includes("temporary"), false);
  assertEquals(restored.implicitWraps, []);

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

realPtyTest({
  name:
    "Desk PTY: the offline manual keeps document focus and scroll through resize and returns to its command",
  contracts: [
    "resize-delivery",
    "control-rendering",
    "terminal-modes",
    "line-discipline",
  ],
  canary: true,
  ignore: PTY_UNAVAILABLE,
  fn: async () => {
    await withDeskTtyProject(deskFleetFixture(), async (project) => {
      const result = await runDeskTty(project, {
        geometry: { columns: 80, rows: 24 },
        colorMode: "no-color-env",
        input: [
          { waitFor: EMPTY_ROOT_READY, chunks: [{ input: "\t/manual\r\r" }] },
          {
            waitFor: ["DISCERN DOCS", "Enter open/action  Esc cancel"],
            chunks: [{ input: "Delegate substantial work" }],
          },
          {
            waitFor: [
              "Search: Delegate substantial work",
              "10-guides/delegate-work.md",
            ],
            chunks: [{ keys: ["enter"] }],
          },
          {
            waitFor: ["A substantial idea", "Tab picker  Esc/q close"],
            chunks: [{ keys: ["page-down"] }, {
              resize: { columns: 40, rows: 24 },
            }],
          },
          {
            waitFor: ["Document", "Tab picker  Esc/q close"],
            capture: textCapture(
              "resized-document",
              "Document",
              "Tab picker  Esc/q close",
            ),
            chunks: [{ input: "q" }],
          },
          {
            waitFor: "Enter open/action  Esc cancel",
            chunks: [{ keys: ["escape"], allowLoneEscape: true }],
          },
          {
            waitFor: ["Desk commands / manual", "/ find"],
            capture: focusedCapture("manual-return", "Read the manual"),
            chunks: [{ input: "q" }],
          },
        ],
      });
      assertHealthySession(result);
      const document = frame(result, "resized-document");
      assertEquals(document.columns, 40);
      assertEquals(
        document.text.includes("A substantial idea"),
        false,
        "the document did not jump to its opening",
      );
      assertStringIncludes(
        frame(result, "manual-return").text,
        "Read the manual",
      );
      assertEquals(result.terminal.resizes, [{ columns: 40, rows: 24 }]);
    });
  },
});
