/**
 * The Desk at every pinned geometry, on the real package runtime: the list
 * keeps focus while the inspector follows it, every row's next step and its
 * menu are one key away without Tab, the label and age columns line up, a
 * review opens on its safe choice, and every state the Desk can be in (no
 * tasks, a failed first survey, a fleet) is a view the package accepts.
 */

import { assert, assertEquals } from "@std/assert";
import {
  type DeskSession,
  deskSession,
  deskSurvey,
  withDeskSession,
} from "./fixtures/desk_session.ts";
import type {
  StatusData,
  StatusFleetEntry,
} from "../src/shared/result_schemas.ts";
import { taskFleetEntry } from "./status_fleet.ts";
import { DESK_LIST_ID } from "../src/engine/desk/desk_state.ts";
import { COMMANDS_ROW_ID } from "../src/engine/desk/desk_transitions.ts";

/** The inbox geometries the design pins. */
const INBOX_SIZES = [
  [120, 30],
  [80, 24],
  [60, 20],
  [40, 20],
  [80, 13],
  [32, 10],
] as const;

/** The sheet geometries the design pins. */
const SHEET_SIZES = [
  [80, 24],
  [132, 40],
  [80, 48],
  [40, 24],
  [80, 13],
] as const;

/** One task per row label the columns must align across. */
function fleet(): StatusFleetEntry[] {
  const at = "2026-07-11T11:00:00Z";
  return [
    taskFleetEntry("ready", {
      ahead: 2,
      proof_honored: true,
      gate_proof: { status: "honored" },
      last_activity: at,
      task: {
        id: "ready",
        branch: "agent/ready",
        title: "Ready work",
        title_source: "recorded",
      },
    }),
    taskFleetEntry("editing", {
      clean: false,
      changed_files: 3,
      last_activity: "2026-07-11T11:58:00Z",
      task: {
        id: "editing",
        branch: "agent/editing",
        title: "Editing work",
        title_source: "recorded",
      },
    }),
    taskFleetEntry("stale", {
      ahead: 1,
      behind: 12,
      proof_honored: true,
      gate_proof: { status: "honored" },
      last_activity: "2026-07-01T11:00:00Z",
      task: {
        id: "stale",
        branch: "agent/stale",
        title: "Stale work",
        title_source: "recorded",
      },
    }),
    taskFleetEntry("empty", {
      last_activity: "2026-07-09T11:00:00Z",
      task: {
        id: "empty",
        branch: "agent/empty",
        title: "Empty work",
        title_source: "recorded",
      },
    }),
  ];
}

/** Run one session at a size and close it. */
async function atSize(
  columns: number,
  rows: number,
  data: () => StatusData | undefined,
  body: (desk: DeskSession) => Promise<void>,
): Promise<void> {
  await withDeskSession(
    {
      columns,
      rows,
      runtime: {
        status: () => {
          const observed = data();
          return observed === undefined
            ? { ok: false, message: "status is unavailable" }
            : { ok: true, data: observed };
        },
      },
    },
    body,
    (error) =>
      new Error(`${columns}x${rows}: ${String(error)}`, { cause: error }),
  );
}

Deno.test("the inbox needs no Tab at any pinned geometry", async () => {
  for (const [columns, rows] of INBOX_SIZES) {
    await atSize(columns, rows, () => deskSurvey(fleet()), async (desk) => {
      await desk.until(
        () => desk.state().lists[DESK_LIST_ID]?.selectedId !== undefined,
        "a selected row",
      );
      assertEquals(desk.state().focusedControlId, DESK_LIST_ID);
      const first = desk.state().lists[DESK_LIST_ID]?.selectedId;
      assertEquals(first, COMMANDS_ROW_ID, "the Desk opens on its commands");
      await desk.press("down");
      const second = desk.state().lists[DESK_LIST_ID]?.selectedId;
      assert(second !== first, "Down moves the selection to a task");
      assertEquals(
        desk.state().focusedControlId,
        DESK_LIST_ID,
        "the inspector follows without taking focus",
      );
      await desk.press(".");
      await desk.opened("actions");
      await desk.escape(() => desk.top() === undefined, "the menu to close");
      await desk.press("enter");
      await desk.until(
        () => desk.top()?.startsWith("review-") ?? false,
        "Enter to open the next step",
      );
      await desk.escape(() => desk.top() === undefined, "the review to close");
      await desk.press("tab");
      assertEquals(
        desk.state().focusedControlId,
        DESK_LIST_ID,
        "Tab moves between groups, never into the detail",
      );
    });
  }
});

Deno.test("label and age columns line up at every geometry that shows them", async () => {
  const titles = ["Ready work", "Editing work", "Stale work", "Empty work"];
  const age = /(?:now|\d+[mhdw]|\d+mo|\d+y)$/u;
  for (const [columns, rows] of INBOX_SIZES) {
    await atSize(columns, rows, () => deskSurvey(fleet()), async (desk) => {
      await desk.until(
        () => desk.state().lists[DESK_LIST_ID]?.selectedId !== undefined,
        "a selected row",
      );
      const screen = desk.screen();
      const cells = screen.split("\n").flatMap((line) => {
        if (!titles.some((title) => line.includes(title))) return [];
        const row = (line.split("│")[0] ?? line).trimEnd();
        const shown = age.exec(row);
        if (shown === null) return [];
        return [{
          age: row.length,
          label: row.slice(0, shown.index).trimEnd().length,
        }];
      });
      const ends = (key: "age" | "label"): number =>
        new Set(cells.map((cell) => cell[key])).size;
      if (columns >= 60) {
        assert(cells.length >= 2, `${columns}x${rows} shows ages:\n${screen}`);
      }
      if (cells.length > 1) {
        assertEquals(ends("age"), 1, `${columns}x${rows} ages:\n${screen}`);
        assertEquals(
          ends("label"),
          1,
          `${columns}x${rows} labels:\n${screen}`,
        );
      }
    });
  }
});

Deno.test("every Desk state is a view the package accepts at every geometry", async () => {
  const states: ReadonlyArray<readonly [string, () => StatusData | undefined]> =
    [
      ["no tasks", () => deskSurvey()],
      [
        "only parked branches",
        () => deskSurvey([], { unlanded_branches: ["agent/spike"] }),
      ],
      ["a failed first survey", () => undefined],
      ["a fleet", () => deskSurvey(fleet())],
    ];
  for (const [name, data] of states) {
    for (const [columns, rows] of INBOX_SIZES) {
      await atSize(columns, rows, data, async (desk) => {
        await desk.until(
          () => /Live|Retrying/u.test(desk.screen()) || rows < 12,
          `${name}: the first survey settles`,
        );
        await desk.press("ctrl-k");
        await desk.opened("palette");
        await desk.escape(() => desk.top() === undefined, `${name}: palette`);
        await desk.press("?");
        await desk.opened("reader-keys");
        await desk.escape(() => desk.top() === undefined, `${name}: keys`);
      });
    }
  }
});

Deno.test("a review opens on its safe choice at every sheet geometry", async () => {
  for (const [columns, rows] of SHEET_SIZES) {
    let landed = 0;
    const desk = await deskSession({
      columns,
      rows,
      runtime: {
        status: () => ({ ok: true, data: deskSurvey(fleet()) }),
        accept: () => {
          landed += 1;
        },
      },
    });
    await desk.select("ready");
    await desk.press("enter");
    await desk.opened("review-accept-review");
    await desk.until(
      () => !desk.screen().includes("Checking current state"),
      "the plan read",
    );
    assertEquals(
      desk.state().layers["review-accept-review"]?.focusedControlId,
      "button:safe",
      `${columns}x${rows}`,
    );
    await desk.press("enter");
    await desk.until(() => desk.top() === undefined, "Enter keeps");
    assertEquals(landed, 0, `${columns}x${rows}: Enter on open lands nothing`);
    assertEquals(await desk.quit(), 0);
  }
});
