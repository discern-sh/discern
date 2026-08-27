/** Pure coverage for the Desk's responsive product presentation boundary. */

import { assert, assertEquals, assertStringIncludes } from "@std/assert";
import { measureText, stripAnsi } from "discern-design-system/cli";
import type {
  StatusData,
  StatusFleetEntry,
} from "../src/shared/result_schemas.ts";
import {
  buildDeskBoardDecision,
  buildDeskRows,
  type DeskAgentLaunch,
  type DeskRow,
} from "../src/engine/desk/model.ts";
import {
  deskActionGroups,
  deskCompositionReserveRows,
  deskRootSelectionGroups,
  deskRowLayout,
  renderDeskBoard,
  renderDeskTaskDetail,
} from "../src/engine/desk/view.ts";
import {
  resolveTerminalContext,
  type TerminalContext,
  type TerminalSize,
} from "../src/lib/terminal.ts";
import { fakeEnv } from "./helpers.ts";

const NOW = Date.parse("2026-08-27T12:00:00Z");

Deno.test("Desk compositions leave two thirds of the viewport for package frame fitting", () => {
  assertEquals(deskCompositionReserveRows(5, 24), 5);
  assertEquals(deskCompositionReserveRows(40, 24), 8);
  assertEquals(deskCompositionReserveRows(40, 15), 5);
  assertEquals(deskCompositionReserveRows(-1, 24), 0);
});

/** Resolve one deterministic terminal context for a view fixture. */
function terminal(
  size: TerminalSize,
  options: { readonly color?: boolean; readonly unicode?: boolean } = {},
): TerminalContext {
  return resolveTerminalContext({
    noColor: options.color !== true,
    env: fakeEnv({
      TERM: options.unicode === false ? "dumb" : "xterm-256color",
      LANG: options.unicode === false ? "C" : "en_GB.UTF-8",
    }),
    isTerminal: () => true,
    consoleSize: () => size,
  });
}

/** Build one non-main status entry with stable Desk defaults. */
function entry(
  name: string,
  patch: Partial<StatusFleetEntry> = {},
): StatusFleetEntry {
  return {
    path: `/tmp/worktrees/${name}`,
    is_main: false,
    is_current: false,
    branch: `agent/${name}`,
    clean: true,
    changed_files: 0,
    ahead: 1,
    behind: 0,
    last_activity: "2026-08-27T11:00:00Z",
    gate_proof: { status: "missing" },
    ...patch,
  };
}

const AGENT: DeskAgentLaunch = {
  id: "codex:open",
  agent: "codex",
  providerLabel: "Codex",
  binary: "codex",
  kind: "open",
  label: "Open in Codex",
  args: [],
};

/** Adapt status entries into complete Desk rows for view assertions. */
function rows(entries: readonly StatusFleetEntry[]): DeskRow[] {
  return buildDeskRows(
    entries,
    new Map(entries.map((item) => [item.path, [{ name: "verify" }]])),
    new Map(entries.map((item) => [item.path, [AGENT]])),
    { trunk: "main", nowMs: NOW },
  );
}

/** Require every ANSI-stripped physical line to fit its viewport. */
function assertBounded(frame: string, width: number): void {
  for (const line of stripAnsi(frame).split("\n")) {
    assert(
      measureText(line) <= width,
      `${measureText(line)} > ${width}: ${JSON.stringify(line)}`,
    );
  }
}

Deno.test("Desk row breakpoints map 40, 60, 80, and 120 columns deliberately", () => {
  assertEquals(deskRowLayout(40), "narrow");
  assertEquals(deskRowLayout(60), "medium");
  assertEquals(deskRowLayout(80), "medium");
  assertEquals(deskRowLayout(120), "wide");
});

Deno.test("root rows stay bounded without coupling a short task to the longest title", () => {
  const short = entry("short-task-a1b2c3");
  const long = entry(
    "a-very-long-ASCII-task-title-that-must-not-set-a-fleet-wide-column-abcdef",
  );
  const unicode = entry("修复-终端-布局-和-证明-显示-fedcba");
  for (const columns of [40, 60, 80, 120]) {
    const size = { columns, rows: 30 };
    const context = terminal(size);
    const shortOnly = deskRootSelectionGroups({
      rows: rows([short]),
      hasProjectScripts: false,
      viewport: size,
      terminal: context,
    });
    const fleet = deskRootSelectionGroups({
      rows: rows([short, long, unicode]),
      hasProjectScripts: false,
      viewport: size,
      terminal: context,
    });
    const shortOnlyEntry = shortOnly.flatMap((group) => group.items).find(
      (item) => item.value === short.path,
    );
    const fleetEntry = fleet.flatMap((group) => group.items).find((item) =>
      item.value === short.path
    );
    assert(shortOnlyEntry !== undefined && fleetEntry !== undefined);
    assertEquals(fleetEntry.name, shortOnlyEntry.name);
    for (const item of fleet.flatMap((group) => group.items)) {
      assert(measureText(item.name) <= columns - 8, item.name);
      if (item.description !== undefined) {
        assert(!item.description.includes("\n"));
      }
    }
  }
});

Deno.test("root board states project, main checkout, triage counts, age, and notices", () => {
  const size = { columns: 40, rows: 18 };
  const context = terminal(size, { unicode: false });
  const taskRows = rows([
    entry("review-a1b2c3", {
      gate_proof: {
        status: "honored",
        proof_line: "Proof: ready-a1b2c3",
      },
      landing_authority: { kind: "conversation-required" },
    }),
  ]);
  const data: StatusData = {
    location: "main",
    root: "/tmp/project",
    project: "demo",
    worktree: null,
    git: null,
    standards: [],
    fleet: [
      entry("main", {
        path: "/tmp/project",
        branch: "main",
        is_main: true,
        is_current: true,
        ahead: 0,
      }),
      ...taskRows.map((row) => row.entry),
    ],
    unlanded_branches: ["agent/orphan"],
  };
  const rendered = renderDeskBoard({
    board: buildDeskBoardDecision(data, taskRows),
    tip: "Run discern status for a read-only orientation check.",
    viewport: size,
    terminal: context,
  });
  const plain = stripAnsi(rendered.text);
  assertStringIncludes(plain, "discern · demo");
  assertStringIncludes(plain, "Main checkout");
  assertStringIncludes(plain, "main is clean");
  assertStringIncludes(plain, "1 task");
  assertStringIncludes(plain, "1 need you");
  assertStringIncludes(plain, "1 ready to review");
  assertStringIncludes(plain, "Refreshed just now");
  assertStringIncludes(plain, "1 branch has no worktree");
  assertStringIncludes(plain, "Tip:");
  assertEquals(rendered.rows, rendered.text.split("\n").length);
  assertBounded(rendered.text, size.columns);
});

Deno.test("task detail recovers full identity and every decision evidence group", () => {
  const title = "Unicode task 修复终端布局和证明显示 a1b2c3";
  const task = entry("unicode-task-a1b2c3", {
    id: "a1b2c3",
    branch: "agent/unicode-task-a1b2c3",
    path: "/tmp/worktrees/unicode-task-a1b2c3",
    clean: false,
    changed_files: 3,
    ahead: 2,
    running: {
      verb: "done",
      started: "2026-08-27T11:59:00Z",
      elapsed_ms: 60_000,
      typical_duration_ms: 120_000,
    },
    gate_proof: {
      status: "honored",
      proof_line: "Proof: agent/unicode-task-a1b2c3 abcdef0 · gate passed",
    },
    landing_authority: {
      kind: "conversation-required",
      uncovered: [{ path: "src/desk.ts", scopes: ["source"] }],
      warnings: ["Owner review is required."],
    },
  });
  const [row] = rows([task]);
  assert(row !== undefined);
  const displayRow: DeskRow = {
    ...row,
    task: { ...row.task, name: title },
    decision: {
      ...row.decision,
      collisions: [{
        kind: "changed_files",
        otherBranch: "agent/other",
        paths: ["src/desk.ts"],
        total: 1,
      }],
      details: [
        ...row.decision.details,
        { kind: "containment", text: "Commits are contained in agent/next" },
      ],
    },
  };
  for (const columns of [40, 60, 80, 120]) {
    const size = { columns, rows: 24 };
    const rendered = renderDeskTaskDetail(
      displayRow,
      size,
      terminal(size),
    );
    const plain = stripAnsi(rendered.text);
    const compact = plain.replaceAll(/[\s│]+/gu, "");
    for (
      const expected of [
        title,
        "agent/unicode-task-a1b2c3",
        "/tmp/worktrees/unicode-task-a1b2c3",
        "Proof: agent/unicode-task-a1b2c3",
      ]
    ) {
      assertStringIncludes(compact, expected.replaceAll(/\s+/gu, ""));
    }
    for (
      const expected of [
        "Branch",
        "Path",
        "Running discern done",
        "3 uncommitted files",
        "2 commits ahead of main",
        "Proof honored for this commit",
        "Owner approval",
        "needed for 1",
        "Collisions",
        "src/desk.ts",
        "Containment",
        "Open in Codex",
        "verify",
      ]
    ) {
      assertStringIncludes(compact, expected.replaceAll(/\s+/gu, ""));
    }
    assertBounded(rendered.text, columns);
  }
});

Deno.test("only the model-recommended action receives recommendation copy", () => {
  const [row] = rows([entry("needs-gate-a1b2c3")]);
  assert(row !== undefined);
  assert(row.decision.recommendedAction !== undefined);
  const items = deskActionGroups(row).flatMap((group) => group.items);
  assertEquals(
    items.filter((item) => item.description !== undefined).map((item) =>
      item.value
    ),
    [row.decision.recommendedAction],
  );
});
