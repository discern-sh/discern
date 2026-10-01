/**
 * The Desk's pure views over every row state, layer and sheet: each view the
 * Desk can build is one the package accepts and renders at a wide and a
 * narrow geometry, and each shows the facts it owes in status's words.
 */

import { assert, assertEquals, assertStringIncludes } from "@std/assert";
import {
  createTerminalApplicationModel,
  renderTerminalApplication,
  type TerminalApplicationView,
} from "discern-design-system/cli/interactive";
import { proofLineBlock } from "../src/engine/desk/inspector_view.ts";
import { testTerminalCapabilities } from "discern-design-system/cli/interactive/testing";
import {
  type DeskIntent,
  type DeskLayer,
  deskProduct,
  type DeskProductState,
} from "../src/engine/desk/desk_state.ts";
import {
  landedRowId,
  open,
  parkedRowId,
} from "../src/engine/desk/desk_transitions.ts";
import { deskKeymap, deskView } from "../src/engine/desk/inbox_view.ts";
import { UNSHOWABLE_LAYER_TITLE } from "../src/engine/desk/layer_view.ts";
import {
  deskChips,
  inlineRuns,
  toggleLabel,
} from "../src/engine/desk/header_view.ts";
import { deskRowId } from "../src/engine/desk/model.ts";
import { taskEvidenceSubject } from "../src/engine/desk/evidence.ts";
import type { DeskReview } from "../src/engine/desk/flow_types.ts";
import {
  FLEET_ROW_STATES,
  rowStateLabel,
} from "../src/engine/status/row_states.ts";
import type { StatusData } from "../src/shared/result_schemas.ts";
import type { EmergencyValidation } from "../src/shared/emergency.ts";
import {
  exceptionProof,
  fleetEntry,
  mainFleetEntry,
  statusData,
} from "./status_fleet.ts";
import { renderProofLine } from "../src/engine/gate/proof_render.ts";
import { NOW, TABLE_ROWS } from "./row_state_table.ts";
import {
  freshDesk,
  observeDesk,
  PRODUCT_UI,
  PRODUCT_VIEW_ENV,
  productSurvey,
  readyReview,
} from "./fixtures/desk_product.ts";

const ENV = { ...PRODUCT_VIEW_ENV, now: NOW };

/** Render a view the way the package would, at one geometry. */
function render(
  view: TerminalApplicationView<DeskIntent>,
  columns: number,
  rows: number,
): string {
  const model = createTerminalApplicationModel(view, {
    keymap: deskKeymap(),
    viKeys: true,
  }).model;
  return renderTerminalApplication(
    model,
    { columns, rows },
    testTerminalCapabilities({ columns }),
  ).frame;
}

/**
 * The view for `state` with one item selected, rendered wide and narrow.
 * Every layer must be the Desk's own: none stands in for one the package
 * would refuse.
 */
function frames(state: DeskProductState, selected?: string): string[] {
  const view = deskView(
    state,
    { ...PRODUCT_UI, ...(selected === undefined ? {} : { selected }) },
    ENV,
  );
  for (const layer of view.layers ?? []) {
    assert(
      !("title" in layer && layer.title === UNSHOWABLE_LAYER_TITLE),
      `${layer.id} breaks a package rule`,
    );
  }
  return [render(view, 120, 40), render(view, 60, 20)];
}

/** An emergency landing whose validation is still owed. */
function outstanding(id: string): EmergencyValidation {
  return {
    landing_id: id,
    head: "a".repeat(40),
    reason: "hotfix",
    exceptions: [],
    state: "outstanding",
    next_action: "discern done",
  };
}

/** Everything a value says, for presence checks. */
function said(value: unknown): string {
  return JSON.stringify(value);
}

/** A desk that adopted `data` at the table's clock. */
function desk(data: StatusData): DeskProductState {
  return observeDesk(freshDesk(), data, NOW).state;
}

Deno.test("a layer the package would refuse gives way to a sheet that says so, under its id", () => {
  const state = desk(
    statusData([mainFleetEntry(), fleetEntry({ id: "alpha" })]),
  );
  const step = {
    kind: "action" as const,
    action: "drop" as const,
    taskId: "alpha",
    stage: "review" as const,
  };
  const broken = open(state, {
    kind: "review",
    step,
    load: {
      state: "ready",
      value: readyReview("Drop Alpha?", {
        challenge: { mustEqual: "" },
        destructive: true,
        confirmLabel: "Drop",
      }),
    },
  }).state;
  const view = deskView(broken, PRODUCT_UI, ENV);
  const [layer] = view.layers ?? [];
  assertEquals(
    layer?.id,
    "review-drop-review",
    "the same id, so Escape closes it",
  );
  assert(layer !== undefined && "title" in layer);
  assertEquals(layer.title, UNSHOWABLE_LAYER_TITLE);
  assert(render(view, 80, 24).includes("Nothing ran"), "the package draws it");
  // A layer that keeps every rule is left exactly as the Desk built it.
  const kept = open(state, { kind: "palette" }).state;
  const palette = deskView(kept, PRODUCT_UI, ENV).layers?.[0];
  assert(palette !== undefined && palette.kind === "palette");
});

Deno.test("a survey that only restamps a checkout's edits keeps its commits on screen", () => {
  const edited = (at: string) =>
    statusData([
      mainFleetEntry(),
      fleetEntry({
        id: "alpha",
        clean: false,
        changed_files: 2,
        last_activity: at,
      }),
    ]);
  const before = edited("2026-07-11T11:00:00Z");
  let state = desk(before);
  const [row] = state.rows;
  assert(row !== undefined);
  state = deskProduct(state, {
    kind: "evidence",
    subject: taskEvidenceSubject(row, before, "main"),
    read: {
      committed: {
        commits: {
          state: "ready",
          value: [{ sha: "abc1234", subject: "Committed work" }],
        },
        files: { state: "ready", value: [] },
      },
      uncommitted: {
        state: "ready",
        value: [{ path: "notes.md", status: "updated" }],
      },
    },
  }).state;
  const after = observeDesk(state, edited("2026-07-11T11:00:05Z"), NOW).state;
  const view = deskView(after, { ...PRODUCT_UI, selected: "alpha" }, ENV);
  assert(view.body.kind === "master-detail");
  const content = said(view.body.detail.content.alpha);
  assertStringIncludes(content, "Committed work");
  assertStringIncludes(content, "notes.md");
  assert(!content.includes("Reading…"), "nothing blinks back to Reading…");
});

Deno.test("a stored Proof line reads as styled words, without its CLI pointer", () => {
  const { line: _line, markdown: _markdown, ...facts } = exceptionProof();
  const line = renderProofLine(facts);
  assertStringIncludes(line, "**Proof:**", "the producer writes Markdown");
  const block = proofLineBlock(line);
  assert(block.kind === "text");
  const words = block.runs.map((run) => run.text).join("");
  assert(words.startsWith("Proof: Gate passed for agent/task at abc1234"));
  for (const marker of ["**", "`", "> ", "View the full Proof"]) {
    assert(!words.includes(marker), `${JSON.stringify(words)} shows ${marker}`);
  }
  assertEquals(
    block.runs.filter((run) => run.role !== undefined).map((run) => [
      run.role,
      run.text,
    ]),
    [
      ["title", "Proof:"],
      ["code", "agent/task"],
      ["code", "abc1234"],
      ["code", "main"],
    ],
  );
  // The landed row's inspector shows the same block.
  const data = statusData([mainFleetEntry(), fleetEntry({ id: "alpha" })], {
    recent_completed_tasks: [{
      branch: "agent/landed",
      head: "b".repeat(40),
      completed_at: "2026-09-30T11:00:00.000Z",
      proof_line: line,
    }],
  });
  const landed = landedRowId("agent/landed", "2026-09-30T11:00:00.000Z");
  const view = deskView(desk(data), { ...PRODUCT_UI, selected: landed }, ENV);
  assert(view.body.kind === "master-detail");
  assertStringIncludes(
    said(view.body.detail.content[landed]),
    said(block),
  );
  // A code span holding a backtick keeps it, inside its longer fence.
  assertEquals(inlineRuns("> a ``x`y`` b"), [
    { text: "a " },
    { text: "x`y", role: "code" },
    { text: " b" },
  ]);
});

Deno.test("every row state's inspector and strip render in status's words", () => {
  for (const row of TABLE_ROWS) {
    const integration = row.context?.integration;
    const data = statusData([
      mainFleetEntry(),
      row.entry,
      ...(integration === undefined ? [] : [
        fleetEntry({ branch: "integration/task", integration }),
      ]),
    ], {
      queue: row.context?.queueRow === undefined ? [] : [row.context.queueRow],
    });
    let state = desk(data);
    const [shown] = state.rows;
    assert(shown !== undefined, `row ${row.row}`);
    const id = deskRowId(shown);
    state = deskProduct(state, {
      kind: "evidence",
      subject: taskEvidenceSubject(shown, data, "main"),
      read: row.row % 2 === 0
        ? {
          committed: {
            commits: {
              state: "ready",
              value: [{ sha: "abc1234", subject: "Explain the change" }],
            },
            files: {
              state: "ready",
              value: [{ path: "src/a.ts", status: "updated", added: 3 }],
            },
          },
          uncommitted: {
            state: "ready",
            value: [{ path: "notes.txt", status: "added" }],
          },
          failure: {
            state: "ready",
            value: [{ name: "lint", message: "Unused import", file: "a.ts" }],
          },
        }
        : {
          committed: {
            commits: { state: "failed", error: "fatal: bad revision" },
            files: { state: "ready", value: [] },
          },
        },
    }).state;
    const view = deskView(state, { ...PRODUCT_UI, selected: id }, ENV);
    assert(view.body.kind === "master-detail", `row ${row.row}`);
    const content = said(view.body.detail.content[id]);
    const label = rowStateLabel(row.state, row.context?.queueRow);
    assertStringIncludes(content, label, `row ${row.row}`);
    assertStringIncludes(
      content,
      row.row % 2 === 0 ? "Explain the change" : "fatal: bad revision",
      `row ${row.row}`,
    );
    assertStringIncludes(
      said(view.body.detail.strip?.[id]),
      label,
      `row ${row.row}`,
    );
    for (const frame of frames(state, id)) {
      assertStringIncludes(
        frame,
        shown.task.name.slice(0, 6),
        `row ${row.row}`,
      );
    }
  }
});

Deno.test("branch and landing rows render their own inspectors", () => {
  const data = productSurvey([], {
    unlanded_branches: ["agent/spike", "agent/plain"],
    parked_tasks: [{
      id: "spike",
      branch: "agent/spike",
      head: "a".repeat(40),
      parked_at: "2026-09-29T12:00:00.000Z",
      task: {
        id: "spike",
        branch: "agent/spike",
        title: "Spike cache",
        title_source: "recorded",
        brief: "Try an LRU cache\nin front of the index.",
      },
    }],
    recent_completed_tasks: [{
      branch: "agent/landed",
      head: "b".repeat(40),
      completed_at: "2026-09-30T11:00:00.000Z",
      proof_line: "Proof: agent/landed bbbbbbb · gate passed",
    }],
  });
  const state = desk(data);
  const view = deskView(state, PRODUCT_UI, ENV);
  assert(view.body.kind === "empty" && view.body.list !== undefined);
  const parked = parkedRowId("agent/spike");
  const landed = landedRowId("agent/landed", "2026-09-30T11:00:00.000Z");
  const titles = view.body.list.groups.flatMap((group) =>
    group.items.map((item) => item.title)
  );
  assertEquals(titles.includes("Spike cache"), true, said(titles));
  const withTask = desk({
    ...data,
    fleet: [
      ...(data.fleet ?? []),
      fleetEntry({ id: "alpha", branch: "agent/alpha", ahead: 1 }),
    ],
  });
  const detailed = deskView(withTask, PRODUCT_UI, ENV);
  assert(detailed.body.kind === "master-detail");
  assertStringIncludes(
    said(detailed.body.detail.content[parked]),
    "Try an LRU cache",
  );
  assertStringIncludes(
    said(detailed.body.detail.content[landed]),
    "gate passed",
  );
  for (const selected of [parked, landed]) frames(withTask, selected);
});

Deno.test("header chips route fleet facts to where they live", () => {
  assertEquals(deskChips(undefined), []);
  assertEquals(deskChips(productSurvey([])), []);
  const chips = deskChips(productSurvey([], {
    git: {
      branch: "main",
      trunk: "main",
      clean: false,
      changed_files: 2,
      tracked_changes: 2,
      behind_trunk: 0,
      ahead_trunk: 0,
    },
    pending_tracked_refresh: ["AGENTS.md"],
    emergency_validation: [outstanding("one"), outstanding("two")],
    adr_collisions: [{
      number: "0415",
      branches: ["agent/a", "agent/b"],
      paths: ["a.md", "b.md"],
    }],
    release_reminder: "2026-09-01T00:00:00.000Z",
  }));
  assertEquals(
    chips.map((chip) => chip.runs.map((run) => run.text).join("")),
    [
      "! main has changes",
      "! main needs a refresh",
      "! 2 emergency exceptions",
      "! 1 ADR number clash",
      "Update available",
    ],
  );
  const state = desk(productSurvey([]));
  assertEquals(toggleLabel(state, "sort"), "Sort by title");
  assertEquals(
    toggleLabel(
      { ...state, preferences: { schema_version: 2, sort: "title" } },
      "sort",
    ),
    "Group by next step",
  );
  assertEquals(
    toggleLabel(
      { ...state, preferences: { schema_version: 2, details: "hidden" } },
      "details",
    ),
    "Show details",
  );
  assertEquals(
    toggleLabel(
      { ...state, preferences: { schema_version: 2, mouse: true } },
      "mouse",
    ),
    "Turn mouse off",
  );
});

Deno.test("every layer the Desk opens is a view the package renders", () => {
  const data = productSurvey([
    fleetEntry({
      id: "alpha",
      branch: "agent/alpha",
      path: "/worktrees/alpha",
      ahead: 1,
      clean: false,
      changed_files: 2,
      broken: true,
    }),
  ], {
    unlanded_branches: ["agent/spike"],
    queue: [],
    recent_completed_tasks: [{
      branch: "agent/landed",
      head: "b".repeat(40),
      completed_at: "2026-09-30T11:00:00.000Z",
    }],
  });
  let state = desk(data);
  state = deskProduct(state, {
    kind: "returned",
    now: NOW,
    outcome: {
      command: "discern done",
      ok: false,
      message: { tone: "danger", text: "Checks failed" },
    },
  }).state;
  const step = {
    kind: "action" as const,
    action: "drop" as const,
    taskId: "alpha",
    stage: "review" as const,
  };
  const prepared: DeskReview = readyReview("Drop Alpha?", {
    lines: [
      {
        mark: "discards",
        text: "Discards 2 uncommitted changes",
        source: { kind: "plan", key: "discards" },
      },
      {
        mark: "failure",
        text: "Conflict",
        detail: ["src/a.ts"],
        source: { kind: "result", field: "message" },
      },
      {
        mark: "changes",
        text: "Lands 2 commits · 1 file",
        diff: { insertions: 3, deletions: 1 },
        source: { kind: "plan", key: "lands" },
      },
    ],
    disclosures: {
      plan: { title: "Drop plan", details: ["Branch: agent/alpha"], steps: [] },
      command: "discern worktree drop /worktrees/alpha",
      changes: { taskId: "alpha", files: 1, insertions: 3, deletions: 1 },
      open: "command",
    },
    challenge: { mustEqual: "agent/alpha" },
    footnote: "Its last commit is kept for a while.",
    safeLabel: "Keep",
    confirmLabel: "Drop",
    destructive: true,
    blockers: ["Another landing holds the turn"],
    alternatives: [{
      id: "park",
      label: "Park instead",
      key: "p",
      intent: { kind: "action", action: "park", id: "alpha" },
    }],
  });
  const review = {
    trunk: "main",
    proof: { status: "honored" as const },
    commits: "abc1234 Explain the change",
    files: [{
      path: "src/a.ts",
      disposition: "updated" as const,
      added: 3,
      removed: 1,
      uncommitted: false,
    }],
    insertions: 3,
    deletions: 1,
    failures: [{
      title: "Uncommitted paths could not be read",
      command: "git status",
      detail: "status unavailable",
      nextAction: "Retry",
      safeToRetry: true,
    }],
    diffCommand: "git diff main...HEAD",
  };
  const layers: readonly DeskLayer[] = [
    { kind: "actions", rowId: "alpha" },
    { kind: "actions", rowId: parkedRowId("agent/spike") },
    { kind: "actions", rowId: "gone" },
    { kind: "agents", taskId: "alpha" },
    { kind: "agents", taskId: "gone" },
    { kind: "palette" },
    {
      kind: "scripts",
      owner: { kind: "main" },
      load: { state: "loading" },
    },
    {
      kind: "scripts",
      owner: { kind: "task", taskId: "alpha" },
      load: { state: "failed", error: "scripts unreadable" },
    },
    {
      kind: "scripts",
      owner: { kind: "main" },
      load: {
        state: "ready",
        value: {
          directory: "/project",
          scripts: [
            { name: "deploy", description: "ship it", availability: "enabled" },
            {
              name: "broken",
              availability: "disabled",
              reason: "not executable",
            },
          ],
        },
      },
    },
    ...(["keys", "tip", "landing", "main", "activity"] as const).map((
      kind,
    ): DeskLayer => ({ kind: "reader", reader: { kind } })),
    { kind: "reader", reader: { kind: "recovery", taskId: "alpha" } },
    ...([
      { state: "loading" },
      { state: "failed", error: "git failed" },
      { state: "ready", value: review },
    ] as const).map((load): DeskLayer => ({
      kind: "reader",
      reader: { kind: "changes", taskId: "alpha", load },
    })),
    {
      kind: "reader",
      reader: {
        kind: "branch",
        branch: "agent/spike",
        load: { state: "ready", value: { markdown: "# Spike\n\nCommits" } },
      },
    },
    {
      kind: "reader",
      reader: {
        kind: "landed",
        ref: landedRowId("agent/landed", "2026-09-30T11:00:00.000Z"),
        load: { state: "failed", error: "Stored record: missing." },
      },
    },
    {
      kind: "reader",
      reader: { kind: "notice", title: "Project Scripts", lines: ["None"] },
    },
    {
      kind: "result",
      sheet: {
        title: "Checks failed",
        tone: "danger",
        lines: prepared.lines,
        output: "**test** failed",
        command: "discern done",
        taskId: "alpha",
      },
    },
    { kind: "review", step, load: { state: "loading" } },
    { kind: "review", step, load: { state: "failed", error: "plan failed" } },
    { kind: "review", step, load: { state: "ready", value: prepared } },
    {
      kind: "review",
      step: { ...step, taskId: "gone" },
      load: { state: "ready", value: prepared },
    },
    ...([
      { state: "loading" },
      { state: "failed", error: "start refused" },
      {
        state: "ready",
        value: readyReview("Create New?", {
          expected: { facts: { "branch-name": "agent/new" } },
        }),
      },
    ] as const).map((load): DeskLayer => ({
      kind: "form",
      step: { kind: "command", command: "new_task", stage: "review" },
      values: { title: "New", brief: "Line one\nLine two", base: "main" },
      load,
    })),
    {
      kind: "form",
      step: {
        kind: "command",
        command: "resume",
        ref: "agent/spike",
        stage: "review",
      },
      values: {},
      load: { state: "loading" },
    },
    {
      kind: "form",
      step: {
        kind: "action",
        action: "rename",
        taskId: "alpha",
        stage: "review",
      },
      values: { title: "Alpha" },
      load: {
        state: "ready",
        value: readyReview("Rename Alpha?", {
          blockers: ["Type a different title to rename it."],
        }),
      },
    },
    {
      kind: "form",
      step: {
        kind: "action",
        action: "scripts",
        taskId: "alpha",
        stage: "review",
        values: { script: "deploy" },
      },
      values: { args: "'unclosed" },
      load: { state: "failed", error: "Unclosed quote" },
    },
  ];
  for (const layer of layers) {
    const opened = open(state, layer).state;
    for (const frame of frames(opened, "alpha")) {
      assert(frame.length > 0, said(layer));
    }
  }
});

Deno.test("the inbox shows a running task's meter and time and the overlap flag", () => {
  const running = fleetEntry({
    id: "running",
    branch: "agent/running",
    ahead: 1,
    running: {
      verb: "done",
      started: "2026-09-30T11:59:00.000Z",
      elapsed_ms: 60_000,
      typical_duration_ms: 120_000,
    },
  });
  const overlapping = fleetEntry({
    id: "overlap",
    branch: "agent/overlap",
    clean: false,
    changed_files: 1,
  });
  const data = productSurvey([running, overlapping], {
    fleet_collisions: [{
      branches: ["agent/running", "agent/overlap"],
      overlap: ["src/shared.ts"],
      total: 1,
    }],
  });
  const view = deskView(desk(data), PRODUCT_UI, ENV);
  assert(view.body.kind === "master-detail");
  const items = view.body.list.groups.flatMap((group) => group.items);
  const runningItem = items.find((item) => item.id === "running");
  assertStringIncludes(said(runningItem?.cells?.label), "━");
  assertEquals(runningItem?.marker?.animation, "spinner");
  assertEquals(
    FLEET_ROW_STATES.parked.label.length > 0,
    true,
  );
});
