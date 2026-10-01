/** Real-PTY characterisation of the complete package-backed Desk session. */

import { DESK_COMMAND_LABELS } from "../src/shared/desk_vocabulary.ts";
import {
  assert,
  assertEquals,
  assertStringIncludes,
  assertThrows,
} from "@std/assert";
import { measureText } from "discern-design-system/cli";
import { runAgent } from "./engine_helpers.ts";
import {
  assertDeskTtyInputPhase,
  deskAtRest,
  deskCollision,
  deskFailedAction,
  deskFleetEntry,
  deskFleetFixture,
  deskFocused,
  type DeskFrameTest,
  type DeskImplicitWrap,
  deskLandingAuthority,
  deskLayerOpen,
  deskMissingAgentsAndScripts,
  deskOrphanBranch,
  deskProof,
  deskRunningAction,
  deskScreenShows,
  deskSettledPhase,
  deskShowing,
  type DeskTtyInputPhase,
  type DeskTtyRunResult,
  type DeskVisibleFrame,
  normaliseDeskTranscript,
  runDeskTty,
  withDeskTtyProject,
} from "./fixtures/desk_tty_harness.ts";
import { decodeCliResult } from "./decode_cli_result.ts";
import { realPtyTest } from "./real_pty.ts";
import type {
  PtyGeometry,
  PtyObservedOutput,
  PtyOutputCondition,
} from "./fixtures/pty_process.ts";

const PTY_UNAVAILABLE = Deno.build.os === "windows";
const SGR = new RegExp(`${String.fromCharCode(27)}\\[([0-9:;]*)m`, "gu");

/**
 * Whether a transcript sets any colour: a foreground or background SGR
 * parameter. Weight and inverse carry selection without colour, so they
 * stay legal under NO_COLOR.
 */
function colours(transcript: string): boolean {
  return [...transcript.matchAll(SGR)].some((match) =>
    (match[1] ?? "").split(/[;:]/u).some((part) => {
      const code = Number(part);
      return (code >= 30 && code <= 49) || (code >= 90 && code <= 107);
    })
  );
}
const NEW_TASK = DESK_COMMAND_LABELS.new_task;
const EMPTY = deskShowing("No tasks yet");
const phase = deskSettledPhase;

/** A review or form whose plan read has finished. */
function readyLayer(id: string): DeskFrameTest {
  return (capture) =>
    deskLayerOpen(id)(capture) &&
    !capture.text.includes("Checking current state");
}

/** Both tests hold. */
function both(left: DeskFrameTest, right: DeskFrameTest): DeskFrameTest {
  return (capture) => left(capture) && right(capture);
}

/** The screen shows `text`, whatever is open. */
function showing(text: string): DeskFrameTest {
  return (capture) => capture.text.includes(text);
}

/**
 * Move from a sheet's or form's safe button to its confirm button and press
 * it: two phases, each waiting for the focus it needs.
 */
function confirmPhases(
  size: PtyGeometry,
  layer: string,
): DeskTtyInputPhase[] {
  return [
    phase(
      size,
      undefined,
      `${layer} on its safe choice`,
      both(readyLayer(layer), deskFocused(layer, "button:safe")),
      { keys: ["tab"] },
    ),
    phase(
      size,
      undefined,
      `${layer}'s confirm button`,
      deskFocused(layer, "button:confirm"),
      { keys: ["enter"] },
    ),
  ];
}

/** Tab on from each focused control in turn, one phase per control. */
function tabThrough(
  size: PtyGeometry,
  layer: string,
  ...controls: readonly string[]
): DeskTtyInputPhase[] {
  return controls.map((control) =>
    phase(
      size,
      undefined,
      `${layer} ${control}`,
      deskFocused(layer, control),
      { keys: ["tab"] },
    )
  );
}

/** Press a form's confirm button, then confirm the review it opens. */
function submitForm(
  size: PtyGeometry,
  form: string,
  review: string,
): DeskTtyInputPhase[] {
  return [
    phase(
      size,
      undefined,
      `${form}'s confirm button`,
      deskFocused(form, "button:confirm"),
      { keys: ["enter"] },
    ),
    ...confirmPhases(size, review),
  ];
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

/**
 * The wraps the session's exit epilogue makes: each line names a command the
 * session ran in full, and the terminal wraps a long one.
 * TODO(R-5): the package prints epilogue lines unwrapped.
 */
function epilogueWraps(exit: DeskVisibleFrame): DeskImplicitWrap[] {
  return exit.implicitWraps.filter((wrap) =>
    exit.lines.find((line) => line.row === wrap.row)?.text.startsWith(
      "discern desk ran:",
    ) ?? false
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
  assertEquals(result.terminal.restored, true, JSON.stringify(result.terminal));
  assertEquals(
    result.terminal.childExited,
    true,
    JSON.stringify(result.terminal),
  );
  assertEquals(result.terminal.noChild, true, JSON.stringify(result.terminal));
  for (const visible of result.frames) {
    assertFrameFits(
      visible,
      expectedImplicitWraps[visible.name] ??
        (visible.name === "exit" ? epilogueWraps(visible) : []),
    );
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

/** The identity and recorded wording status reports for a task. */
interface ObservedTask {
  readonly id?: string | undefined;
  readonly branch: string;
  readonly task?: {
    readonly id: string;
    readonly branch: string;
    readonly title: string;
    readonly title_source: string;
    readonly brief?: string | undefined;
    readonly created_from?: { readonly ref: string } | undefined;
  } | undefined;
}

/** The status survey's view of the project's one task. */
async function onlyTask(root: string): Promise<ObservedTask> {
  const status = await runAgent(root, ["status", "--verbose", "--json"]);
  assertEquals(status.code, 0, status.output);
  const decoded = decodeCliResult(status.stdout, "status");
  assert(decoded.data !== undefined && "fleet" in decoded.data);
  const task = decoded.data.fleet?.find((entry) => !entry.is_main);
  assert(task !== undefined, status.stdout);
  return task;
}

realPtyTest({
  name: "Desk PTY: a 40-column empty project offers New task and exits cleanly",
  contracts: [
    "terminal-modes",
    "control-rendering",
    "process-lifecycle",
    "platform-transport",
  ],
  canary: true,
  ignore: PTY_UNAVAILABLE,
  fn: async () => {
    const size = { columns: 40, rows: 16 };
    await withDeskTtyProject(deskFleetFixture(), async (project) => {
      const result = await runDeskTty(project, {
        geometry: size,
        colorMode: "no-color-env",
        input: [phase(size, "root", "the empty Desk", EMPTY, { input: "q" })],
        env: { LANG: "C", LC_ALL: "C" },
      });
      assertHealthySession(result);
      const root = frame(result, "root");
      assertStringIncludes(root.text, "New task");
      assertEquals(colours(result.transcript), false, result.transcript);
    });
  },
});

realPtyTest({
  name: "Desk PTY: an incomplete setup reads its recovery steps from the menu",
  contracts: [
    "terminal-modes",
    "control-rendering",
    "process-lifecycle",
    "platform-transport",
  ],
  canary: true,
  ignore: PTY_UNAVAILABLE,
  fn: async () => {
    const size = { columns: 100, rows: 42 };
    const fixture = deskFleetFixture([
      deskFleetEntry("recovery-task-a1b2c3", { setup: "incomplete" }),
    ]);
    await withDeskTtyProject(fixture, async (project) => {
      const result = await runDeskTty(project, {
        geometry: size,
        colorMode: "no-color-env",
        input: [
          phase(size, undefined, "the task at rest", deskAtRest(), {
            input: ".",
          }),
          phase(
            size,
            undefined,
            "its actions",
            deskLayerOpen("actions"),
            { input: "/Recovery" },
          ),
          phase(
            size,
            undefined,
            "the filtered menu",
            both(deskLayerOpen("actions"), showing("Recovery steps")),
            { keys: ["enter"] },
          ),
          phase(
            size,
            "recovery-detail",
            "the recovery reader",
            deskLayerOpen("reader-recovery"),
            { keys: ["escape"], allowLoneEscape: true },
          ),
          phase(size, undefined, "back at rest", deskAtRest(), {
            input: "q",
          }),
        ],
        timeoutMs: 60_000,
      });
      assertHealthySession(result);
      assertStringIncludes(frame(result, "recovery-detail").text, "Recovery");
    });
  },
});

realPtyTest({
  name: "Desk PTY: New task records its title, brief, base, and identity",
  contracts: [
    "terminal-modes",
    "control-rendering",
    "process-lifecycle",
    "platform-transport",
  ],
  canary: true,
  ignore: PTY_UNAVAILABLE,
  fn: async () => {
    const size = { columns: 100, rows: 55 };
    const form = "form-new_task-review";
    const review = "review-new_task-review";
    const title = "Complete task ingress: Unicode 修复";
    const brief = "Preserve this brief exactly.";
    await withDeskTtyProject(deskFleetFixture(), async (project) => {
      const result = await runDeskTty(project, {
        geometry: size,
        colorMode: "no-color-env",
        input: [
          phase(size, undefined, "the empty Desk", EMPTY, { input: "n" }),
          phase(
            size,
            "creation-form",
            "the title field",
            deskFocused(form, "field:title"),
            { input: title },
          ),
          phase(
            size,
            undefined,
            "the typed title",
            both(deskFocused(form, "field:title"), showing(title)),
            { keys: ["tab"] },
          ),
          phase(
            size,
            undefined,
            "More options",
            deskFocused(form, "group:options"),
            { keys: ["enter"] },
          ),
          phase(
            size,
            undefined,
            "More options open",
            both(deskFocused(form, "group:options"), showing("Brief")),
            { keys: ["tab"] },
          ),
          ...tabThrough(size, form, "field:base"),
          phase(
            size,
            undefined,
            "the brief",
            deskFocused(form, "field:brief"),
            { input: brief },
          ),
          phase(
            size,
            undefined,
            "the typed brief",
            both(deskFocused(form, "field:brief"), showing(brief)),
            { keys: ["shift-tab", "shift-tab", "shift-tab", "shift-tab"] },
          ),
          ...submitForm(size, form, review),
          phase(
            size,
            "created",
            "the created task at rest",
            both(deskAtRest(), showing("Complete task ingress")),
            { input: "q" },
          ),
        ],
        env: { LANG: "en_GB.UTF-8", LC_ALL: "en_GB.UTF-8" },
      });
      assertHealthySession(result);
      assertStringIncludes(frame(result, "creation-form").text, NEW_TASK);
      const created = await onlyTask(project.root);
      assertEquals(created.task?.title, title);
      assertEquals(created.task?.brief, brief);
      assertEquals(created.task?.title_source, "recorded");
      assertEquals(created.task?.created_from?.ref, "main");
      assertEquals(created.task?.id, created.id);
      assertEquals(created.task?.branch, created.branch);
    });
  },
});

realPtyTest({
  name: "Desk PTY: Rename changes the title without changing identity",
  contracts: [
    "terminal-modes",
    "control-rendering",
    "process-lifecycle",
    "platform-transport",
  ],
  canary: true,
  ignore: PTY_UNAVAILABLE,
  fn: async () => {
    const wide = { columns: 100, rows: 50 };
    const narrow = { columns: 80, rows: 24 };
    const form = "form-rename-review";
    const id = "rename-journey-a1b2c3";
    const originalTitle = "Rename journey";
    const title = "Renamed task: Unicode 修复";
    await withDeskTtyProject(
      deskFleetFixture([deskFleetEntry(id, { aheadCommits: 1 })]),
      async (project) => {
        const result = await runDeskTty(project, {
          geometry: wide,
          colorMode: "no-color-env",
          input: [
            phase(wide, undefined, "the task at rest", deskAtRest(), {
              input: "e",
            }),
            phase(
              wide,
              undefined,
              "the title field",
              deskFocused(form, "field:title"),
              { input: `${"\u007f".repeat(originalTitle.length)}${title}` },
            ),
            phase(
              wide,
              "edited-form",
              "the edited title",
              both(deskFocused(form, "field:title"), showing(title)),
              { resize: narrow },
            ),
            phase(
              narrow,
              "resized-form",
              "the edited title after resize",
              both(deskFocused(form, "field:title"), showing(title)),
              { keys: ["tab"] },
            ),
            ...tabThrough(narrow, form, "button:safe"),
            ...submitForm(narrow, form, "review-rename-review"),
            phase(
              narrow,
              undefined,
              "the renamed task at rest",
              both(deskAtRest(), showing("Renamed task")),
              { input: "q" },
            ),
          ],
          env: { LANG: "en_GB.UTF-8", LC_ALL: "en_GB.UTF-8" },
        });
        assertHealthySession(result);
        assertEquals(frame(result, "edited-form").columns, 100);
        assertEquals(frame(result, "resized-form").columns, 80);
        assertStringIncludes(frame(result, "resized-form").text, title);
        const renamed = await onlyTask(project.root);
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
    "Desk PTY: View changes pages the actual diff and returns to its reader",
  contracts: ["terminal-modes", "process-lifecycle", "platform-transport"],
  canary: true,
  ignore: PTY_UNAVAILABLE,
  fn: async () => {
    const size = { columns: 110, rows: 50 };
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
        geometry: size,
        colorMode: "no-color-env",
        env: {
          PAGER: "perl -pe 's/\\e\\[[0-9;]*m//g'",
          VISUAL: "",
          EDITOR: "",
        },
        input: [
          phase(size, undefined, "the task at rest", deskAtRest(), {
            input: "v",
          }),
          phase(
            size,
            "changes",
            "its changes",
            both(deskLayerOpen("reader-changes"), showing("review.txt")),
            { input: "o" },
          ),
          phase(
            size,
            "pager-return",
            "the reader after the pager",
            both(deskLayerOpen("reader-changes"), showing("Back from")),
            { keys: ["escape"], allowLoneEscape: true },
          ),
          phase(size, undefined, "back at rest", deskAtRest(), {
            input: "q",
          }),
        ],
        timeoutMs: 60_000,
      });
      assertHealthySession(result);
      assertStringIncludes(frame(result, "changes").text, "review.txt");
      assertStringIncludes(result.transcript, "diff --git");
      assertStringIncludes(result.transcript, "review through the repository");
    });
  },
});

realPtyTest({
  name:
    "Desk PTY: Escape closes and never quits, and Ctrl-C quits from anywhere",
  contracts: [
    "line-discipline",
    "signal-delivery",
    "terminal-modes",
    "process-lifecycle",
  ],
  canary: true,
  ignore: PTY_UNAVAILABLE,
  fn: async () => {
    const size = { columns: 86, rows: 28 };
    const fixture = deskFleetFixture([
      deskFleetEntry("cancellation-task-c0ffee", { aheadCommits: 1 }),
    ]);
    await withDeskTtyProject(fixture, async (project) => {
      const root = await runDeskTty(project, {
        geometry: size,
        colorMode: "no-color-env",
        input: [
          // The first key dismisses the session's tip; Escape closes that
          // first, as it closes anything open, and only then answers.
          phase(
            size,
            "escape-at-root",
            "the task at rest with its tip",
            both(deskAtRest(), showing("Tip")),
            { keys: ["escape"], allowLoneEscape: true },
          ),
          phase(
            size,
            undefined,
            "the tip dismissed",
            both(deskAtRest(), (capture) => !capture.text.includes("Tip")),
            { keys: ["escape"], allowLoneEscape: true },
          ),
          phase(
            size,
            "escape-answered",
            "the quit hint",
            both(deskAtRest(), showing("q quits")),
            { keys: ["ctrl-c"] },
          ),
        ],
      });
      assertHealthySession(root);

      const layer = await runDeskTty(project, {
        geometry: size,
        colorMode: "no-color-env",
        input: [
          phase(size, undefined, "the task at rest", deskAtRest(), {
            input: ".",
          }),
          phase(
            size,
            "escape-at-actions",
            "its actions",
            deskLayerOpen("actions"),
            { keys: ["escape"], allowLoneEscape: true },
          ),
          phase(
            size,
            "escape-returned",
            "back at rest",
            both(deskAtRest(), showing("Cancellation task")),
            { input: "." },
          ),
          phase(
            size,
            undefined,
            "its actions again",
            deskLayerOpen("actions"),
            { keys: ["ctrl-c"] },
          ),
        ],
      });
      assertHealthySession(layer);
    });
  },
});

realPtyTest({
  name: "Desk PTY: colour and --no-color preserve one semantic frame",
  contracts: ["control-rendering", "terminal-modes"],
  canary: true,
  ignore: PTY_UNAVAILABLE,
  fn: async () => {
    const size = { columns: 80, rows: 24 };
    await withDeskTtyProject(deskFleetFixture(), async (project) => {
      const colored = await runDeskTty(project, {
        geometry: size,
        colorMode: "color",
        input: [
          phase(size, "colored", "the empty Desk", EMPTY, { input: "q" }),
        ],
      });
      const flag = await runDeskTty(project, {
        geometry: size,
        colorMode: "no-color-flag",
        input: [phase(size, "flag", "the empty Desk", EMPTY, { input: "q" })],
      });
      for (const result of [colored, flag]) {
        assertHealthySession(result);
        assertStringIncludes(
          frame(result, result.frames[0]?.name ?? "").text,
          NEW_TASK,
        );
      }
      assert(colours(colored.transcript), colored.transcript);
      assertEquals(colours(flag.transcript), false, flag.transcript);
      const roles = new Set(
        frame(colored, "colored").lines.flatMap((row) =>
          row.spans.flatMap((span) => span.roles)
        ),
      );
      // Colour carries roles beyond weight: the title's emphasis, and the
      // surfaces the package fills.
      assert(roles.has("emphasis"), JSON.stringify([...roles]));
      assert(roles.has("background"), JSON.stringify([...roles]));
    });
  },
});

realPtyTest({
  name:
    "Desk PTY: live resize keeps the open menu and the selected task and fits",
  contracts: ["resize-delivery", "control-rendering", "terminal-modes"],
  canary: true,
  ignore: PTY_UNAVAILABLE,
  fn: async () => {
    const narrow = { columns: 60, rows: 40 };
    const wide = { columns: 120, rows: 30 };
    await withDeskTtyProject(
      deskFleetFixture([
        deskFleetEntry("responsive-task-a1b2c3", { aheadCommits: 1 }),
      ]),
      async (project) => {
        const result = await runDeskTty(project, {
          geometry: narrow,
          colorMode: "no-color-env",
          input: [
            phase(narrow, "narrow", "the task at rest", deskAtRest(), {
              input: ".",
            }),
            phase(
              narrow,
              undefined,
              "its actions",
              deskLayerOpen("actions"),
              { resize: wide },
            ),
            phase(
              wide,
              "wide",
              "its actions, wide",
              both(deskLayerOpen("actions"), showing("Responsive task")),
              { keys: ["ctrl-c"] },
            ),
          ],
        });
        assertHealthySession(result);
        assertEquals(frame(result, "narrow").columns, 60);
        assertEquals(frame(result, "wide").columns, 120);
        assertStringIncludes(frame(result, "wide").text, "Responsive task");
        assertEquals(result.terminal.resizes, [wide]);
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

/** Read the visible document's scroll indicator, independent of its prose. */
function manualDocumentStart(text: string): number {
  if (!text.includes("Document") || !text.includes("Tab picker  Esc/q close")) {
    return 0;
  }
  return Number(text.match(/\b(\d+)-\d+\/\d+\b/u)?.[1] ?? 0);
}

/** Observe the complete manual frame at the journey's initial geometry. */
function manualDocumentReady(minimumStart: number): PtyOutputCondition {
  return {
    description:
      `the manual displays a document starting at line ${minimumStart} or later`,
    test: (output) =>
      manualDocumentStart(
        normaliseDeskTranscript(
          "manual-readiness",
          output.stdout,
          { columns: 80, rows: 24 },
        ).text,
      ) >= minimumStart,
  };
}

Deno.test("Desk PTY recipes separate resize from keyboard input before launching", () => {
  const resize = { resize: { columns: 61, rows: 27 } };
  const mixed: readonly DeskTtyInputPhase[] = [
    { waitFor: "Inventory", chunks: [{ input: "filter" }, resize] },
    { waitFor: "Review", chunks: [resize, { keys: ["down"] }] },
    {
      waitFor: "Editor",
      chunks: [{ ...resize, input: new Uint8Array([97]), settleMs: 10 }],
    },
  ];
  for (const phase of mixed) {
    assertThrows(
      () => assertDeskTtyInputPhase(phase),
      TypeError,
      "separate phases",
    );
  }
  assertDeskTtyInputPhase({ waitFor: "Edited value", chunks: [resize] });
  assertDeskTtyInputPhase({
    waitFor: "Resized view",
    chunks: [{ keys: ["enter"] }],
  });
  assertDeskTtyInputPhase({
    waitFor: "View",
    chunks: [{ ...resize, input: "" }],
  });
});

Deno.test("manual readiness requires the latest visible scrolled frame", () => {
  const opening = "Document\n1-12/200\nTab picker  Esc/q close";
  const scrolled = "Document\n13-24/200\nTab picker  Esc/q close";
  const observed = (stdout: string): PtyObservedOutput => ({
    stdout,
    stderr: "",
    transcript: stdout,
    phaseStdout: stdout,
    phaseStderr: "",
  });
  const ready = manualDocumentReady(2);
  assertEquals(ready.test(observed(opening)), false);
  assertEquals(ready.test(observed("Document\n13-24/200")), false);
  assertEquals(ready.test(observed(scrolled)), true);
  assertEquals(
    ready.test(observed(scrolled + "\x1b[2J\x1b[H" + opening)),
    false,
  );
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
    const size = { columns: 80, rows: 24 };
    await withDeskTtyProject(deskFleetFixture(), async (project) => {
      const result = await runDeskTty(project, {
        geometry: size,
        colorMode: "no-color-env",
        input: [
          phase(size, undefined, "the empty Desk", EMPTY, {
            keys: ["ctrl-k"],
          }),
          phase(
            size,
            undefined,
            "the palette",
            deskLayerOpen("palette"),
            { input: "Read the manual" },
          ),
          phase(
            size,
            undefined,
            "the manual found",
            both(deskLayerOpen("palette"), showing("Read the manual")),
            { keys: ["enter"] },
          ),
          {
            waitFor: ["DISCERN DOCS", "Enter open/action  Esc cancel"],
            chunks: [{ input: "Delegate substantial work" }],
          },
          {
            waitFor: deskScreenShows(
              size,
              "Search: Delegate substantial work",
              "20-guides/delegate-work.md",
            ),
            chunks: [{ keys: ["enter"] }],
          },
          {
            waitFor: manualDocumentReady(1),
            chunks: [{ keys: ["page-down"] }],
          },
          {
            waitFor: manualDocumentReady(2),
            capture: {
              name: "scrolled-document",
              when: { includes: ["Document", "Tab picker  Esc/q close"] },
            },
            chunks: [{ resize: { columns: 40, rows: 24 } }],
          },
          {
            waitFor: ["Document", "Tab picker  Esc/q close"],
            capture: {
              name: "resized-document",
              when: { includes: ["Document", "Tab picker  Esc/q close"] },
            },
            chunks: [{ input: "q" }],
          },
          {
            waitFor: "Enter open/action  Esc cancel",
            chunks: [{ keys: ["escape"], allowLoneEscape: true }],
          },
          phase(
            { columns: 40, rows: 24 },
            "manual-return",
            "back from the manual",
            both(EMPTY, showing("Back from the manual")),
            { input: "q" },
          ),
        ],
      });
      assertHealthySession(result);
      const document = frame(result, "resized-document");
      assertEquals(document.columns, 40);
      assert(manualDocumentStart(frame(result, "scrolled-document").text) > 1);
      assert(
        manualDocumentStart(document.text) > 1,
        "the resized document retains its scrolled position",
      );
      assertStringIncludes(
        frame(result, "manual-return").text,
        "Back from the manual",
      );
      assertEquals(result.terminal.resizes, [{ columns: 40, rows: 24 }]);
    });
  },
});
