/**
 * The Commands row and its home panel. The Desk opens on the row with and
 * without tasks, Down reaches the first task and Home returns to it, every
 * way into the row's choices opens the palette, and the panel lists every
 * command the registry marks for home beside the release check and the
 * session's tip. Sessions run on the real package runtime at every pinned
 * inbox geometry; the panel's contents are read from its pure builder.
 */

import { assert, assertEquals, assertStringIncludes } from "@std/assert";
import type { ApplicationDetailBlock } from "discern-design-system/cli/interactive";
import {
  DESK_COMMAND_LABELS,
  type DeskCommand,
} from "../src/shared/desk_vocabulary.ts";
import {
  DESK_COMMAND_REGISTRY,
  DESK_COMMANDS,
  DESK_PALETTE_SECTIONS,
  type DeskCommandMetadata,
  RELEASE_CHECK_CUES,
} from "../src/engine/desk/commands.ts";
import {
  COMMANDS_GROUP_ID,
  commandsGroup,
  DESK_HOME_COMMANDS,
  DESK_STRIP_COMMANDS,
  homeBlocks,
  homeSections,
  homeStrip,
} from "../src/engine/desk/home_view.ts";
import { COMMANDS_ROW_ID } from "../src/engine/desk/desk_transitions.ts";
import {
  DESK_LIST_ID,
  type DeskProductState,
} from "../src/engine/desk/desk_state.ts";
import { COMMANDS_LABEL, DESK_KEYS } from "../src/engine/desk/keys.ts";
import { deskChips } from "../src/engine/desk/header_view.ts";
import { deskPalette } from "../src/engine/desk/palette_view.ts";
import {
  deskView,
  EMPTY_LIST_MIN_TITLE,
} from "../src/engine/desk/inbox_view.ts";
import type { StatusData } from "../src/shared/result_schemas.ts";
import type { ReleaseCheckRead } from "../src/shared/release_check.ts";
import { taskFleetEntry } from "./status_fleet.ts";
import {
  type DeskSession,
  deskSurvey,
  withDeskSession,
} from "./fixtures/desk_session.ts";
import {
  freshDesk,
  observedDesk,
  PRODUCT_NOW,
  PRODUCT_UI,
  PRODUCT_VIEW_ENV,
  productSurvey,
} from "./fixtures/desk_product.ts";
import { DISCERN_VERSION } from "../src/lib/version.ts";
import { deskAtRest, type DeskFrameTest } from "./fixtures/desk_tty_harness.ts";
import { measureText } from "discern-design-system/cli";

/** The inbox geometries the design pins. */
const INBOX_SIZES = [
  [120, 30],
  [80, 24],
  [60, 20],
  [40, 20],
  [80, 13],
  [32, 10],
] as const;

/** A task ready for review, then one that needs attention. */
function fleet(extra: Partial<StatusData> = {}): StatusData {
  return deskSurvey([
    taskFleetEntry("ready", {
      ahead: 2,
      proof_honored: true,
      gate_proof: { status: "honored" },
      last_activity: "2026-07-11T11:00:00Z",
      task: {
        id: "ready",
        branch: "agent/ready",
        title: "Ready work",
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
  ], extra);
}

/**
 * A full standard fleet: eight tasks across the decision groups, with
 * titles long enough to hold the list at its widest, so the home panel
 * gets the narrowest standard column, and three parked branches.
 */
function fullFleet(): StatusData {
  const titles = [
    "Manual concision and the reading grade",
    "Auth refactor across the session store",
    "Homepage session prototype for review",
    "Release notes for the next minor",
    "Docs glossary of every product term",
    "Fix the flaky upload retry path",
    "Search index rebuilt from the map",
    "Tidy the project scripts directory",
  ];
  return deskSurvey(
    titles.map((title, index) =>
      taskFleetEntry(`task-${index}`, {
        ahead: index + 1,
        behind: index % 3 === 1 ? 12 : 0,
        clean: index % 2 === 0,
        changed_files: index % 2 === 0 ? 0 : 2,
        proof_honored: index < 3,
        gate_proof: { status: index < 3 ? "honored" : "missing" },
        task: {
          id: `task-${index}`,
          branch: `agent/task-${index}`,
          title,
          title_source: "recorded",
        },
      })
    ),
    { unlanded_branches: ["agent/spike", "agent/old", "agent/try"] },
  );
}

/** The fleets the Desk can open on: tasks, none, and only a parked branch. */
const FLEETS: ReadonlyArray<readonly [string, () => StatusData]> = [
  ["a fleet", () => fleet()],
  ["no tasks", () => deskSurvey()],
  [
    "only a parked branch",
    () => deskSurvey([], { unlanded_branches: ["agent/spike"] }),
  ],
];

/** A release record whose last handoff was `at`. */
function handedOff(at: string): ReleaseCheckRead {
  return {
    status: "recorded",
    value: {
      schema_version: 1,
      first_seen_at: "2026-06-01T00:00:00.000Z",
      last_handoff_at: at,
      version_when_handed_off: DISCERN_VERSION,
    },
  };
}

/** One session over `data`, at a size. */
async function session(
  data: () => StatusData,
  body: (desk: DeskSession) => Promise<void>,
  size: { readonly columns?: number; readonly rows?: number } = {},
  release: ReleaseCheckRead = { status: "missing" },
): Promise<void> {
  await withDeskSession(
    {
      ...size,
      runtime: {
        status: () => ({ ok: true, data: data() }),
        releaseCheck: () => release,
      },
    },
    body,
    (error) =>
      new Error(
        `${size.columns ?? 120}x${size.rows ?? 40}: ${String(error)}`,
        { cause: error },
      ),
  );
}

/** The selected list item. */
function selected(desk: DeskSession): string | undefined {
  return desk.state().lists[DESK_LIST_ID]?.selectedId;
}

/** The screen's line that holds `text`. */
function lineWith(desk: DeskSession, text: string): string {
  return desk.screen().split("\n").find((line) => line.includes(text)) ?? "";
}

/** Every run's words in a block, nested blocks included. */
function words(blocks: readonly ApplicationDetailBlock[]): string {
  return blocks.map((block): string => {
    switch (block.kind) {
      case "heading":
        return [block.title, ...(block.aside ?? []).map((run) => run.text)]
          .join(" ");
      case "text":
        return block.runs.map((run) => run.text).join("");
      case "section":
        return `${block.title} ${block.caption ?? ""} ${words(block.blocks)}`;
      case "rows":
        return block.items.map((item) =>
          [
            ...item.text,
            ...Object.values(item.cells ?? {}).flat(),
          ].map((run) => run.text).join(" ")
        ).join("\n");
      case "pending":
        return block.label;
      default:
        return "";
    }
  }).join("\n");
}

/** The home panel's command labels, in the order it lists them. */
function listedCommands(blocks: readonly ApplicationDetailBlock[]): string[] {
  return blocks.flatMap((block) =>
    block.kind === "section"
      ? block.blocks.flatMap((inner) =>
        inner.kind === "rows"
          ? inner.items.map((item) => item.text.map((run) => run.text).join(""))
          : []
      )
      : []
  );
}

/** A Desk that has read `data` and the release record's history. */
function surveyed(
  data: StatusData,
  history: DeskProductState["releaseCheck"],
): DeskProductState {
  const state = observedDesk(data);
  return history === undefined ? state : { ...state, releaseCheck: history };
}

const ENV = { version: "9.8.7", now: PRODUCT_NOW };

Deno.test("the Desk opens on the Commands row, with or without tasks", async () => {
  for (const [name, data] of FLEETS) {
    await session(data, async (desk) => {
      await desk.shows("Live");
      assertEquals(selected(desk), COMMANDS_ROW_ID, name);
      assertStringIncludes(desk.screen(), DESK_COMMAND_LABELS.updates, name);
      assertStringIncludes(desk.screen(), DESK_COMMAND_LABELS.manual, name);
    });
  }
});

Deno.test("Down reaches the first task and Home returns to the Commands row", async () => {
  await session(fleet, async (desk) => {
    await desk.shows("Ready work");
    await desk.press("down");
    assertEquals(selected(desk), "ready", "the first task that needs you");
    await desk.press("down");
    assertEquals(selected(desk), "stale");
    await desk.press("home");
    assertEquals(selected(desk), COMMANDS_ROW_ID);
    await desk.press("enter");
    await desk.opened("palette");
  });
});

Deno.test("every way into the Commands row's choices opens the palette", async () => {
  for (const key of ["enter", "right", "."]) {
    await session(fleet, async (desk) => {
      await desk.shows("Ready work");
      await desk.press(key);
      await desk.opened("palette");
      await desk.escape(() => desk.top() === undefined, "the palette closes");
      assertEquals(selected(desk), COMMANDS_ROW_ID, key);
    });
  }
  for (
    const binding of DESK_KEYS.commands.filter((each) =>
      ["enter", "right", "."].includes(each.key)
    )
  ) {
    assert(
      binding.meaning.kind === "gesture" &&
        binding.meaning.gesture === "palette",
      `${binding.key} on the Commands row opens the palette`,
    );
  }
});

Deno.test("the filter passes over the Commands row, and zoom numbers only the tasks", async () => {
  await session(fleet, async (desk) => {
    await desk.shows("Ready work");
    const zoomed = () => desk.state().lists[DESK_LIST_ID]?.zoomed === true;
    // From a task, a word only a home command holds matches nothing.
    await desk.press("down");
    for (const word of ["manual", "updates", "script", "shortcuts"]) {
      await desk.press("/");
      await desk.type(word);
      await desk.until(
        () => desk.screen().includes("0 of 2"),
        `${word}: no task matches, and the count holds the tasks alone`,
      );
      assert(!desk.screen().includes("≡ Commands"), "the row hides");
      await desk.escape(
        () => !desk.screen().includes("0 of 2"),
        `${word}: the filter clears`,
      );
      // Typing narrows letter by letter, so the selection may move to a
      // task an early letter matched, but never onto the Commands row.
      assert(
        ["ready", "stale"].includes(selected(desk) ?? ""),
        `${word}: a task stays selected, not ${selected(desk)}`,
      );
    }
    // From the Commands row, a filter moves to the first task it matches.
    await desk.press("home");
    await desk.press("/");
    await desk.type("work");
    await desk.until(() => desk.screen().includes("2 of 2"), "both tasks");
    assertEquals(selected(desk), "ready");
    await desk.escape(
      () => desk.screen().includes("≡ Commands"),
      "the row returns",
    );
    assertEquals(selected(desk), "ready", "clearing keeps the task");
    await desk.press(" ");
    await desk.until(zoomed, "the task zoomed");
    assertStringIncludes(lineWith(desk, "Ready work"), "1 of 2");
    await desk.press("up");
    await desk.until(() => selected(desk) === COMMANDS_ROW_ID, "walked up");
    assert(
      !/\d+ of \d+/u.test(lineWith(desk, COMMANDS_LABEL)),
      `the Commands row's zoom carries no position:\n${desk.screen()}`,
    );
  }, { columns: 80, rows: 24 });
});

Deno.test("the palette opened from the Commands row lists the home panel's commands first, on the one the row names", async () => {
  const highlighted = (desk: DeskSession) =>
    desk.state().layers.palette?.highlightedId;
  const cases: ReadonlyArray<
    readonly [string, () => StatusData, string, string]
  > = [
    ["nothing due", () => fleet(), "new_task", "form-new_task"],
    [
      "a check due",
      () => fleet({ release_reminder: "It's time to check." }),
      "updates",
      "review-updates",
    ],
    ["no tasks", () => deskSurvey(), "new_task", "form-new_task"],
  ];
  for (const [name, data, item, opens] of cases) {
    for (const key of ["enter", "ctrl-k"]) {
      await session(data, async (desk) => {
        await desk.until(
          () =>
            selected(desk) === COMMANDS_ROW_ID &&
            desk.screen().includes("Live"),
          `${name}: at home`,
        );
        await desk.press(key);
        await desk.opened("palette");
        assertEquals(highlighted(desk), item, `${name} ${key}`);
        const screen = desk.screen();
        const create = screen.indexOf(DESK_COMMAND_LABELS.new_task);
        assert(
          !screen.includes("Needs you") ||
            screen.indexOf("Needs you") > create,
          `${name}: the commands lead:\n${screen}`,
        );
        await desk.press("enter");
        await desk.until(
          () => desk.top()?.startsWith(opens) === true,
          `${name} ${key}: Enter twice opens ${opens}, not ${desk.top()}`,
        );
      }, { columns: 120, rows: 30 });
    }
  }
  // From a task, the palette leads with what needs the owner.
  await session(() => fleet(), async (desk) => {
    await desk.shows("Ready work");
    await desk.press("down");
    await desk.press("ctrl-k");
    await desk.opened("palette");
    assertEquals(highlighted(desk), "next:ready");
  }, { columns: 120, rows: 30 });
});

Deno.test("the footer offers the filter only while the list holds a task or a branch", () => {
  const filters = (state: DeskProductState): boolean =>
    (deskView(
      state,
      { ...PRODUCT_UI, selected: COMMANDS_ROW_ID },
      PRODUCT_VIEW_ENV,
    ).footer.extra ?? []).some((hint) => hint.key === "/");
  assertEquals(filters(freshDesk()), false, "before the first survey");
  for (const [name, data] of FLEETS) {
    assertEquals(filters(observedDesk(data())), name !== "no tasks", name);
  }
});

Deno.test("the Commands row's footer names Commands once", async () => {
  for (const [columns, rows] of INBOX_SIZES) {
    await session(() => fleet(), async (desk) => {
      await desk.until(
        () => selected(desk) === COMMANDS_ROW_ID,
        "the Commands row selected",
      );
      const footer = () => desk.screen().split("\n").at(-1) ?? "";
      assertEquals(
        footer().split(COMMANDS_LABEL).length - 1,
        1,
        `${columns}x${rows}: Enter's hint alone names it: ${footer()}`,
      );
      if (columns >= 80) {
        await desk.press("down");
        await desk.until(() => selected(desk) === "ready", "a task");
        assertStringIncludes(footer(), "^K", "a task's footer keeps ^K");
      }
    }, { columns, rows });
  }
});

Deno.test("the palette opened from the Commands row takes the home panel's column", async () => {
  await session(fleet, async (desk) => {
    await desk.shows("Ready work");
    const divider = lineWith(desk, "Ready work").indexOf("│");
    assert(divider > 0, "the wide split shows a divider");
    await desk.press("enter");
    await desk.opened("palette");
    const search = lineWith(desk, "Search tasks and commands");
    assert(
      search.indexOf("Search tasks and commands") > divider,
      `the palette sits in the detail column:\n${desk.screen()}`,
    );
    assertStringIncludes(
      lineWith(desk, "Ready work"),
      "Ready work",
      "the list stays beside it",
    );
  }, { columns: 120, rows: 30 });
});

Deno.test("the Commands row says a release check is due, from status's reminder", async () => {
  const due = () => deskSurvey([], { release_reminder: "It's time to check." });
  await session(
    due,
    async (desk) => {
      await desk.shows("Live");
      const row = lineWith(desk, "≡ Commands");
      assertStringIncludes(row, RELEASE_CHECK_CUES.due);
      assertStringIncludes(row, "^K", "the palette's key keeps its place");
      assertStringIncludes(
        lineWith(desk, DESK_COMMAND_LABELS.updates),
        "checked 3w ago",
        "the last check sits beside Check for updates",
      );
    },
    {},
    handedOff("2026-06-18T00:00:00.000Z"),
  );
  await session(() => deskSurvey(), async (desk) => {
    await desk.shows("Live");
    const row = lineWith(desk, "≡ Commands");
    assertStringIncludes(row, "^K");
    assert(!row.includes(RELEASE_CHECK_CUES.due), "nothing is due");
  });
});

Deno.test("each survey reads the release record once and hands status that read", async () => {
  const reads: ReleaseCheckRead[] = [];
  const given: ReleaseCheckRead[] = [];
  await withDeskSession({
    runtime: {
      releaseCheck: () => {
        const read = handedOff("2026-06-18T00:00:00.000Z");
        reads.push(read);
        return read;
      },
      status: (_root, release) => {
        if (release !== undefined) given.push(release);
        return { ok: true, data: fleet() };
      },
    },
  }, async (desk) => {
    await desk.shows("Ready work");
    await desk.press("r");
    await desk.until(() => reads.length >= 2, "a second survey");
  });
  // A survey still reading as the session quits may not reach status.
  assert(
    given.length === reads.length || given.length === reads.length - 1,
    `one read per survey: ${reads.length} reads, ${given.length} surveys`,
  );
  for (const [index, read] of reads.entries()) {
    assert(given[index] === read, `survey ${index} reads status from it`);
  }
});

Deno.test("the session's tip shows in the home panel, never on the message line", async () => {
  await session(fleet, async (desk) => {
    await desk.shows("Tip");
    const divider = lineWith(desk, "≡ Commands").indexOf("│");
    const tip = lineWith(desk, "Tip");
    assert(
      tip.indexOf("Tip") > divider,
      `the tip sits in the panel:\n${desk.screen()}`,
    );
    await desk.press("down");
    assert(!desk.screen().includes("Tip"), "it stays with the home panel");
  });
});

Deno.test("the Commands row and its panel paint at every pinned geometry", async () => {
  for (const [name, data] of FLEETS) {
    for (const [columns, rows] of INBOX_SIZES) {
      await session(data, async (desk) => {
        await desk.until(
          () => selected(desk) === COMMANDS_ROW_ID,
          `${name}: the Commands row selected`,
        );
        assertStringIncludes(lineWith(desk, "Commands"), "Commands", name);
        if (columns >= 80 && rows >= 24) {
          for (const label of ["new_task", "manual", "updates"] as const) {
            assertStringIncludes(
              desk.screen(),
              DESK_COMMAND_LABELS[label],
              `${name} ${columns}x${rows}: ${label} on the first screen`,
            );
          }
        }
        if (columns < 80 && rows >= 20) {
          // The strip names the row; Space reads the whole panel, and
          // paging reaches its last command.
          await desk.press(" ");
          await desk.until(
            () => desk.state().lists[DESK_LIST_ID]?.zoomed === true,
            `${name}: the panel zoomed`,
          );
          assertStringIncludes(desk.screen(), DESK_COMMAND_LABELS.new_task);
          for (
            let page = 0;
            page < 4 && !desk.screen().includes(DESK_COMMAND_LABELS.updates);
            page += 1
          ) await desk.press("page-down");
          assertStringIncludes(desk.screen(), DESK_COMMAND_LABELS.updates);
          await desk.escape(
            () => desk.state().lists[DESK_LIST_ID]?.zoomed !== true,
            `${name}: zoom closes`,
          );
        }
        await desk.press("enter");
        await desk.opened("palette");
        await desk.escape(() => desk.top() === undefined, "the palette");
      }, { columns, rows });
    }
  }
});

Deno.test("the home panel lists every command marked for home, the manual and the update check always among them", () => {
  const marked = DESK_COMMANDS.filter((command) =>
    (DESK_COMMAND_REGISTRY[command] as DeskCommandMetadata).home === true
  );
  assertEquals([...DESK_HOME_COMMANDS], marked);
  for (const always of ["manual", "updates", "new_task"] as const) {
    assert(DESK_HOME_COMMANDS.includes(always), `${always} is home`);
  }
  const order: DeskCommand[] = homeSections().flatMap((section) => [
    ...section.commands,
  ]);
  assertEquals(
    order.toSorted(),
    [...DESK_HOME_COMMANDS].toSorted(),
    "each home command sits in one section the panel shows",
  );
  assertEquals(
    homeSections().map((section) => section.section),
    DESK_PALETTE_SECTIONS.filter((section) =>
      DESK_HOME_COMMANDS.some((command) =>
        (DESK_COMMAND_REGISTRY[command] as DeskCommandMetadata).section ===
          section
      )
    ),
    "the panel keeps the palette's section order",
  );
  for (const command of DESK_HOME_COMMANDS) {
    const metadata: DeskCommandMetadata = DESK_COMMAND_REGISTRY[command];
    assertEquals(metadata.scope, "global", `${command} runs from anywhere`);
    assert(
      metadata.key === undefined || [...metadata.key].length === 1,
      `${command}: a home key is one character, shown as typed`,
    );
  }
  for (
    const state of [
      freshDesk(),
      observedDesk(productSurvey([])),
      observedDesk(fleet()),
    ]
  ) {
    assertEquals(
      listedCommands(homeBlocks(state, ENV)),
      order.map((command) => DESK_COMMAND_LABELS[command]),
    );
  }
});

/** The faint value beside one command in the home panel, if any. */
function besideCommand(
  blocks: readonly ApplicationDetailBlock[],
  label: string,
): string | undefined {
  for (const block of blocks) {
    if (block.kind !== "section") continue;
    for (const inner of block.blocks) {
      if (inner.kind !== "rows") continue;
      const row = inner.items.find((item) =>
        item.text.map((run) => run.text).join("") === label
      );
      if (row !== undefined) {
        return row.cells?.meta?.map((run) => run.text).join("");
      }
    }
  }
  return undefined;
}

/** The faint value the palette shows beside one command, if any. */
function paletteValue(
  state: DeskProductState,
  command: DeskCommand,
): string | undefined {
  return deskPalette(state, ENV.now, true).sections
    .flatMap((section) => section.items)
    .find((item) => item.id === command)
    ?.meta?.map((run) => run.text).join("");
}

/** The faint value the strip shows after one command's name, if any. */
function stripValue(
  state: DeskProductState,
  command: DeskCommand,
): string | undefined {
  const { short } = DESK_COMMAND_REGISTRY[command] as DeskCommandMetadata;
  const name = short ?? DESK_COMMAND_LABELS[command];
  const fact = homeStrip(state, ENV).facts.find((runs) =>
    runs.some((run) => run.text.trim() === name)
  );
  const value = fact?.at(-1);
  return value?.tone === "faint"
    ? /^ \((?<inner>.+)\)$/u.exec(value.text)?.groups?.inner
    : undefined;
}

Deno.test("the home panel names which discern runs, and every tier says the last check in one phrase", () => {
  const checked = { state: "checked", at: "2026-06-18T12:00:00.000Z" } as const;
  const cases: ReadonlyArray<
    readonly [DeskProductState["releaseCheck"], string | undefined]
  > = [
    [checked, "checked 3w ago"],
    [{ state: "never" }, "never checked"],
    [{ state: "unknown" }, undefined],
    [undefined, undefined],
  ];
  for (const [history, beside] of cases) {
    for (const data of [productSurvey([]), fleet()]) {
      const state = surveyed(data, history);
      const blocks = homeBlocks(state, ENV);
      // The panel and its zoom, the palette, and the strip read one value.
      assertEquals(
        [
          besideCommand(blocks, DESK_COMMAND_LABELS.updates),
          paletteValue(state, "updates"),
          stripValue(state, "updates"),
        ],
        [beside, beside, beside],
        JSON.stringify(history),
      );
      const [heading] = blocks;
      assert(heading?.kind === "heading");
      assertEquals(
        [heading.title, ...(heading.aside ?? []).map((run) => run.text)]
          .includes("discern 9.8.7"),
        true,
        "the heading names the running discern",
      );
    }
  }
  const working = homeBlocks(surveyed(fleet(), checked), ENV);
  assert(working[0]?.kind === "heading");
  assertEquals(working[0].title, "discern 9.8.7", "not Commands again");
  const due = surveyed(
    productSurvey([], { release_reminder: "due" }),
    checked,
  );
  assertEquals(
    besideCommand(homeBlocks(due, ENV), DESK_COMMAND_LABELS.updates),
    "checked 3w ago",
    "a due check keeps the history faint; the row says it is due",
  );
});

Deno.test("a due check reads in one phrase everywhere, in warning only on the Commands row", () => {
  const due = surveyed(
    productSurvey([], { release_reminder: "It's time to check." }),
    { state: "checked", at: "2026-06-18T12:00:00.000Z" },
  );
  /** Every run's text and tone, and every label, a value holds. */
  const runs = (value: unknown): { text: string; tone?: string }[] =>
    Array.isArray(value)
      ? value.flatMap(runs)
      : typeof value === "object" && value !== null
      ? "text" in value && typeof value.text === "string"
        ? [value as { text: string; tone?: string }]
        : [
          ...("label" in value && typeof value.label === "string"
            ? [{ text: value.label }]
            : []),
          ...Object.values(value).flatMap(runs),
        ]
      : [];
  const surfaces: ReadonlyArray<readonly [string, unknown, boolean]> = [
    ["the Commands row", commandsGroup(due).items, true],
    ["the header chip", deskChips(due.data), false],
    ["the strip", homeStrip(due, ENV), true],
    ["the home panel", homeBlocks(due, ENV), false],
    ["the palette", deskPalette(due, PRODUCT_NOW, true), false],
  ];
  for (const [surface, value, says] of surfaces) {
    const found = runs(value);
    const cues = found.filter((run) =>
      /check/iu.test(run.text) &&
      /due|update/iu.test(run.text) && run.text !== DESK_COMMAND_LABELS.updates
    );
    for (const cue of cues) {
      assertEquals(
        cue.text,
        RELEASE_CHECK_CUES.due,
        `${surface} says it one way`,
      );
    }
    assertEquals(
      found.some((run) => run.text === RELEASE_CHECK_CUES.due),
      says || surface === "the header chip" || surface === "the palette",
      `${surface} names the due check`,
    );
    assertEquals(
      found.filter((run) => run.tone === "warning").map((run) => run.text),
      surface === "the Commands row" || surface === "the strip"
        ? [RELEASE_CHECK_CUES.due]
        : [],
      `${surface}: only the row, or the strip standing in for it, warns`,
    );
  }
  const [row] = commandsGroup(due).items;
  assertEquals(row?.cells?.label?.[0]?.text, RELEASE_CHECK_CUES.due);
  assert(row?.cells?.age !== undefined, "the palette's key keeps its cell");
});

Deno.test("the home panel lays its commands out as the palette lists them", () => {
  const blocks = homeBlocks(
    observedDesk(fleet({ unlanded_branches: ["agent/one", "agent/two"] })),
    ENV,
  );
  const rows = blocks.flatMap((block) =>
    block.kind === "section"
      ? block.blocks.flatMap((inner) => inner.kind === "rows" ? [inner] : [])
      : []
  );
  assert(rows.length > 0);
  for (const block of rows) {
    assertEquals(block.lead, undefined, "no key leads a label");
    const ids = (block.columns ?? []).map((column) => column.id);
    assertEquals(
      ids.at(-1) === "key",
      block.items.some((item) => item.cells?.key !== undefined),
      "the key, where a command has one, ends its row",
    );
    assertEquals(
      block.fit,
      true,
      "the package keeps the longest label whole before a value drops",
    );
  }
  assertEquals(
    besideCommand(blocks, DESK_COMMAND_LABELS.parked),
    "2 branches",
    "Go to entries carry the palette's values",
  );
});

Deno.test("the home panel leads with what a task is while there are none", () => {
  const loading = words(homeBlocks(freshDesk(), ENV));
  assertStringIncludes(loading, "Loading tasks…");
  const empty = homeBlocks(observedDesk(productSurvey([])), ENV);
  assert(empty[0]?.kind === "heading" && empty[0].title === "No tasks yet");
  assertStringIncludes(words(empty), "A task is its own checkout and branch");
  assertEquals(
    listedCommands(empty)[0],
    DESK_COMMAND_LABELS.new_task,
    "New task leads the commands",
  );
  const working = homeBlocks(observedDesk(fleet()), ENV);
  assert(
    working[0]?.kind === "heading" && working[0].title === "discern 9.8.7",
  );
  assert(!words(working).includes("A task is its own"));
  const group = commandsGroup(observedDesk(fleet()));
  assertEquals(group.id, COMMANDS_GROUP_ID);
  assertEquals(group.headless, true);
  assertEquals(group.items.map((item) => item.id), [COMMANDS_ROW_ID]);
});

Deno.test("on a standard screen the home panel shows Create, Help and the tip, every label whole", async () => {
  const labels = (sections: readonly string[]) =>
    homeSections().filter((section) => sections.includes(section.section))
      .flatMap((section) => section.commands)
      .map((command) => DESK_COMMAND_LABELS[command]);
  for (
    const [name, data] of [["a full fleet", fullFleet], ...FLEETS] as const
  ) {
    // A check months ago is wider than `never checked`: Check for updates
    // moves it right over the key cell it leaves empty, so Help keeps both
    // it and `?`.
    await session(
      data,
      async (desk) => {
        await desk.until(
          () =>
            selected(desk) === COMMANDS_ROW_ID && desk.screen().includes("Tip"),
          `${name}: the tip on the first screen at 80x24:\n${desk.screen()}`,
        );
        const screen = desk.screen();
        for (const label of labels(["create", "help"])) {
          assertStringIncludes(screen, label, `${name}: ${label} whole`);
        }
        const updates = lineWith(desk, DESK_COMMAND_LABELS.updates);
        const keys = lineWith(desk, DESK_COMMAND_LABELS.keys);
        const check = /checked \d+mo ago/u.exec(updates);
        assert(check !== null, `${name}: the last check:\n${screen}`);
        assert(keys.trimEnd().endsWith(" ?"), `${name}: ? stays:\n${screen}`);
        assert(
          check.index + check[0].length <= keys.lastIndexOf("?") + 1,
          `${name}: the check ends by the key column:\n${screen}`,
        );
      },
      { columns: 80, rows: 24 },
      handedOff("2025-10-01T00:00:00.000Z"),
    );
    // Tall enough for the whole panel at the narrowest standard column:
    // every home label shows whole, beside its value and key; Parked
    // branches keeps the key named nowhere else on the screen.
    await session(
      data,
      async (desk) => {
        await desk.until(
          () => desk.screen().includes("Tip"),
          `${name}: the whole panel`,
        );
        for (const label of labels([...DESK_PALETTE_SECTIONS])) {
          assertStringIncludes(desk.screen(), label, `${name}: ${label} whole`);
        }
        // The tip may name the command too; the panel's row ends with its key.
        assert(
          desk.screen().split("\n").some((line) =>
            line.includes(DESK_COMMAND_LABELS.parked) &&
            line.trimEnd().endsWith(` ${DESK_COMMAND_REGISTRY.parked.key}`)
          ),
          `${name}: Parked branches keeps its key`,
        );
      },
      { columns: 80, rows: 60 },
      handedOff("2026-06-18T00:00:00.000Z"),
    );
  }
});

Deno.test("the narrow strip names the commands it leads to, each by its short form", async () => {
  for (const command of DESK_STRIP_COMMANDS) {
    assert(DESK_HOME_COMMANDS.includes(command), `${command} is home`);
  }
  const shorts = DESK_STRIP_COMMANDS.map((command) =>
    (DESK_COMMAND_REGISTRY[command] as DeskCommandMetadata).short ??
      DESK_COMMAND_LABELS[command]
  );
  for (
    const state of [observedDesk(fleet()), observedDesk(productSurvey([]))]
  ) {
    const strip = homeStrip(state, ENV);
    const facts = strip.facts.map((fact) =>
      fact.map((run) => run.text).join("")
    );
    for (const short of shorts) {
      assert(
        strip.facts.some((fact) =>
          fact.some((run) => run.text.trim() === short)
        ),
        `${short}: ${facts}`,
      );
    }
    assert(!facts.some((fact) => /\d+ commands?/u.test(fact)), "no count");
    assert(
      strip.title.some((run) => run.role === "key" && run.text === "^K"),
      "the row's strip carries the palette's key",
    );
  }
  await session(() => fleet(), async (desk) => {
    await desk.until(
      () => selected(desk) === COMMANDS_ROW_ID,
      "the Commands row selected",
    );
    for (const short of ["Manual", "Updates", "Scripts"]) {
      assertStringIncludes(desk.screen(), short, "named at 60 columns");
    }
    // The last check reads as the command's own, never as another command.
    assertStringIncludes(desk.screen(), "Updates (never checked)");
    assert(!desk.screen().includes("· never checked"), desk.screen());
  }, { columns: 60, rows: 20 });
});

Deno.test("with no tasks the list keeps the Commands row's room and the panel takes the rest", async () => {
  assertEquals(
    EMPTY_LIST_MIN_TITLE,
    measureText(COMMANDS_LABEL),
    "the empty list keeps exactly the Commands row's title",
  );
  const divider = (desk: DeskSession) =>
    lineWith(desk, "≡ Commands").indexOf("│");
  for (const [columns, rows] of [[80, 24], [120, 30]] as const) {
    let working = 0;
    await session(() => fleet(), async (desk) => {
      await desk.shows("Ready work");
      working = divider(desk);
    }, { columns, rows });
    await session(() =>
      deskSurvey([], {
        unlanded_branches: ["agent/spike", "agent/old", "agent/try"],
      }), async (desk) => {
      await desk.shows("No tasks yet");
      const empty = divider(desk);
      assert(
        empty > 0 && empty < working,
        `${columns}x${rows}: the panel widens (${empty} < ${working})`,
      );
      assertStringIncludes(lineWith(desk, "≡ Commands"), "^K");
      const fold = lineWith(desk, "Parked 3");
      assert(
        fold.slice(0, empty).trimEnd().length < empty - 1,
        `the fold's gloss keeps a gutter before the panel:\n${fold}`,
      );
      assert(!fold.includes("…"), `the gloss reads whole: ${fold}`);
    }, { columns, rows });
  }
});

Deno.test("a wait for a task at rest never passes on the Commands row", () => {
  // Only the state report matters to the predicate.
  const at = (selectedItemId: string): Parameters<DeskFrameTest>[0] =>
    ({ state: { selectedItemId, detailPending: false } }) as Parameters<
      DeskFrameTest
    >[0];
  assert(!deskAtRest()(at(COMMANDS_ROW_ID)), "home is not a task at rest");
  assert(deskAtRest()(at("ready")));
  assert(deskAtRest("ready")(at("ready")));
  assert(!deskAtRest("ready")(at("stale")));
});

Deno.test("the home panel carries the session's tip and the release it came with", () => {
  const state = observedDesk(fleet());
  const tipped = homeBlocks({
    ...state,
    tip: { brief: "Press `x`.", full: "Press `x` for x.", newIn: "9.8.0" },
  }, ENV);
  const titles = tipped.flatMap((block) =>
    block.kind === "section" ? [block.title] : []
  );
  assertEquals(
    titles,
    ["Create", "Help", "Tip", "Go to"],
    "the tip follows Help, above Go to",
  );
  const tip = tipped.find((block) =>
    block.kind === "section" && block.title === "Tip"
  );
  assert(tip?.kind === "section");
  assertEquals(tip.caption, "new in 9.8.0");
  assertStringIncludes(words([tip]), "x");
  const plain = homeBlocks({
    ...state,
    tip: { brief: "Press `x`.", full: "Press `x` for x." },
  }, ENV).find((block) => block.kind === "section" && block.title === "Tip");
  assert(plain?.kind === "section" && plain.caption === undefined);
  assert(
    !homeBlocks(state, ENV).some((block) =>
      block.kind === "section" && block.title === "Tip"
    ),
    "no tip until one is chosen",
  );
});
