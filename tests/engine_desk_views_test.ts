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
  validateTerminalApplicationView,
} from "discern-design-system/cli/interactive";
import {
  branchLine,
  checkoutPathRuns,
  proofLineBlock,
} from "../src/engine/desk/inspector_view.ts";
import { planBlocks, planLines } from "../src/engine/desk/sheet_view.ts";
import {
  BUILT_IN_STEP_LABELS,
  verbatimStepLabel,
} from "../src/shared/result.ts";
import { testTerminalCapabilities } from "discern-design-system/cli/interactive/testing";
import { stripAnsi } from "discern-design-system/cli";
import {
  DESK_OFFLINE_FAILURES,
  type DeskIntent,
  type DeskLayer,
  deskProduct,
  type DeskProductState,
} from "../src/engine/desk/desk_state.ts";
import {
  landedRowId,
  open,
  parkedRowId,
  toast,
} from "../src/engine/desk/desk_transitions.ts";
import {
  deskKeymap,
  deskTickDelay,
  deskView,
  messageLine,
  meterCells,
} from "../src/engine/desk/inbox_view.ts";
import {
  deskChips,
  inlineRuns,
  toggleLabel,
} from "../src/engine/desk/header_view.ts";
import {
  buildAgentLaunches,
  type DeskAgentLaunch,
  deskRowId,
} from "../src/engine/desk/model.ts";
import { configSchema } from "../src/shared/config_schema.ts";
import type { DetectedAgentBinary } from "../src/lib/detect_agents.ts";
import { DESK_KEYS } from "../src/engine/desk/keys.ts";
import { actionsMenu } from "../src/engine/desk/menu_view.ts";
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
import { NOW, SETUP, TABLE_ROWS, task } from "./row_state_table.ts";
import {
  freshDesk,
  observeDesk,
  PRODUCT_UI,
  PRODUCT_VIEW_ENV,
  productSurvey,
  readyReview,
} from "./fixtures/desk_product.ts";
import { uncommittedListedIn } from "./fixtures/desk_tty_harness.ts";

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
 * The view keeps every package rule, so the running package would refuse
 * none of its layers.
 */
function frames(state: DeskProductState, selected?: string): string[] {
  const view = deskView(
    state,
    { ...PRODUCT_UI, ...(selected === undefined ? {} : { selected }) },
    ENV,
  );
  assertEquals(
    validateTerminalApplicationView(view, {
      keymap: deskKeymap(),
      viKeys: true,
    }),
    [],
    "a layer the package would refuse",
  );
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

/** Every marks block a value holds, however deeply it nests. */
function marksBlocks(value: unknown): object[] {
  if (Array.isArray(value)) return value.flatMap(marksBlocks);
  if (typeof value !== "object" || value === null) return [];
  const nested = Object.values(value).flatMap(marksBlocks);
  return "kind" in value && value.kind === "marks"
    ? [value, ...nested]
    : nested;
}

/** A desk that adopted `data` at the table's clock. */
function desk(data: StatusData): DeskProductState {
  return observeDesk(freshDesk(), data, NOW).state;
}

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

Deno.test("a frame lists the surveyed uncommitted files only once their re-read lands", () => {
  const surveyed = (files: number, at: string): StatusData =>
    statusData([
      mainFleetEntry(),
      fleetEntry({
        id: "alpha",
        clean: false,
        changed_files: files,
        last_activity: at,
      }),
    ]);
  const listed = (
    state: DeskProductState,
    paths: readonly string[],
  ): DeskProductState => {
    const [row] = state.rows;
    assert(row !== undefined);
    return deskProduct(state, {
      kind: "evidence",
      subject: taskEvidenceSubject(row, state.data, "main"),
      read: {
        uncommitted: {
          state: "ready",
          value: paths.map((path) => ({ path, status: "updated" as const })),
        },
      },
    }).state;
  };
  const text = (state: DeskProductState): string =>
    stripAnsi(
      render(
        deskView(state, { ...PRODUCT_UI, selected: "alpha" }, ENV),
        120,
        40,
      ),
    );
  const read = listed(desk(surveyed(2, "2026-07-11T11:00:00Z")), [
    "a.md",
    "b.md",
  ]);
  assert(uncommittedListedIn(text(read)), text(read));
  // An agent edits a third file: the new survey counts it while the
  // inspector keeps the two-file list until the re-read lands.
  const rereading = observeDesk(
    read,
    surveyed(3, "2026-07-11T11:00:05Z"),
    NOW,
  ).state;
  assert(!uncommittedListedIn(text(rereading)), text(rereading));
  const reread = listed(rereading, ["a.md", "b.md", "c.md"]);
  assert(uncommittedListedIn(text(reread)), text(reread));
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

Deno.test("a stopped setup reads Error only for a recorded failure", () => {
  const facts = (patch: Parameters<typeof task>[0]) => {
    const state = desk(statusData([mainFleetEntry(), task(patch)]));
    const [row] = state.rows;
    assert(row !== undefined);
    const view = deskView(state, { ...PRODUCT_UI, selected: "task" }, ENV);
    assert(view.body.kind === "master-detail");
    return said(view.body.detail.content.task);
  };
  const retry = facts({
    ...SETUP("incomplete", "retry"),
  });
  assertStringIncludes(retry, "Stopped at step 3 of 4");
  assert(!retry.includes('"Error"'), "a safe retry is no error");
  assert(!retry.includes('"Why"'), "nor needs words of its own");
  const manual = facts(SETUP("incomplete", "manual"));
  assertStringIncludes(manual, '"Why"');
  const failed = SETUP("incomplete", "retry");
  const journal = failed.setup?.journal;
  assert(journal !== undefined);
  assertStringIncludes(
    facts({
      setup: {
        ...failed.setup,
        state: "incomplete",
        marker: "missing",
        journal: { ...journal, reason: "deno task site:build exited 1" },
      },
    }),
    '"Error"',
  );
  // With no step record, nothing names a step: no Setup fact repeats the
  // explanation, and the explanation promises no failed step to resume.
  const unrecorded = facts({
    setup: {
      ...failed.setup,
      state: "incomplete",
      marker: "missing",
      journal: { ...journal, steps: [] },
    },
  });
  assert(!unrecorded.includes('"Setup"'), unrecorded);
  assert(!unrecorded.includes("step that failed"), unrecorded);
  assertStringIncludes(unrecorded, "Retrying runs setup again.");
});

Deno.test("a failure's location and assertion start at its name's column", () => {
  const failed = TABLE_ROWS.find((row) => row.state === "checks-failed");
  assert(failed !== undefined);
  const data = statusData([mainFleetEntry(), failed.entry]);
  let state = desk(data);
  const [row] = state.rows;
  assert(row !== undefined);
  const id = deskRowId(row);
  state = deskProduct(state, {
    kind: "evidence",
    subject: taskEvidenceSubject(row, data, "main"),
    read: {
      committed: {
        commits: { state: "ready", value: [] },
        files: { state: "ready", value: [] },
      },
      failure: {
        state: "ready",
        value: [{
          name: "adds a widget",
          message: "Expected 3, got 2",
          file: "tests/widget_test.ts",
          line: 42,
        }],
      },
    },
  }).state;
  const view = deskView(state, { ...PRODUCT_UI, selected: id }, ENV);
  const lines = render(view, 120, 40).split("\n");
  const column = (text: string): number => {
    const line = lines.find((candidate) => candidate.includes(text));
    assert(line !== undefined, `${text} in\n${lines.join("\n")}`);
    return line.indexOf(text);
  };
  const name = column("✕ adds a widget") + 2;
  assertEquals(column("tests/widget_test.ts:42"), name);
  assertEquals(column("Expected 3, got 2"), name);
});

Deno.test("a running row's meter fills only once its usual time has passed, and dims when frozen", () => {
  assertEquals(meterCells(179_000, 180_000), 3);
  assertEquals(meterCells(180_000, 180_000), 4);
  assertEquals(meterCells(900_000, 180_000), 4);
  const running = statusData([
    mainFleetEntry(),
    task({
      running: {
        verb: "done",
        started: "2026-07-11T11:57:00Z",
        elapsed_ms: 170_000,
        typical_duration_ms: 180_000,
      },
    }),
  ]);
  const meterTones = (state: DeskProductState): string[] => {
    const view = deskView(state, PRODUCT_UI, ENV);
    assert(view.body.kind === "master-detail");
    const item = view.body.list.groups.flatMap((group) => group.items)
      .find((candidate) => candidate.id === "task");
    return (item?.cells?.label ?? []).filter((run) => run.ascii === "")
      .flatMap((run) => run.tone === undefined ? [] : [run.tone]);
  };
  const live = desk(running);
  assertEquals(meterTones(live), ["accent", "faint"]);
  const offline = {
    ...live,
    survey: { ...live.survey, failures: DESK_OFFLINE_FAILURES },
  };
  assert(!meterTones(offline).includes("accent"), "a frozen meter is faint");
});

Deno.test("a technical plan reads as sheet text, every word of the shared rendering kept", () => {
  const plan = {
    title: "Acceptance plan",
    details: [
      "Branch:        agent/manual",
      "From worktree: /tmp/project.worktrees/manual",
      "Into trunk:    /tmp/project (fast-forward main, delete agent/manual)",
      "No pre-authorization is recorded",
      "Landing queue:",
      "  1. agent/manual at 3f9c2e100000 — pre-authorized",
      "  2. agent/index at 9e2d77100000 — awaiting the owner",
    ],
    steps: [
      {
        kind: "tracked-refresh-check" as const,
        label: BUILT_IN_STEP_LABELS.trackedRefreshLandingBoundary,
        disposition: "gate" as const,
        note: "verify the refresh plan",
      },
      {
        kind: "git" as const,
        label: BUILT_IN_STEP_LABELS.fastForwardTrunk,
        disposition: "run" as const,
      },
      {
        kind: "repository-ensure" as const,
        label: verbatimStepLabel("deno install --frozen"),
        disposition: "run" as const,
        group: "Repository ensure",
      },
    ],
  };
  const blocks = planBlocks(plan);
  const words = (text: string): string[] =>
    text.replaceAll(":", " ").split(/\s+/u).filter((word) => word !== "");
  const shown = blocks.flatMap((block): string[] => {
    if (block.kind === "text") return block.runs.map((run) => run.text);
    if (block.kind !== "section") return [];
    return [
      block.title,
      ...block.blocks.flatMap((inner): string[] =>
        inner.kind === "facts"
          ? inner.rows.flatMap((row) => [
            row.label,
            ...row.value.flat().map((run) => run.text),
          ])
          : inner.kind === "text"
          ? inner.runs.map((run) => run.text)
          : []
      ),
    ];
  });
  assertEquals(
    words(shown.join(" ")),
    words(planLines(plan).join(" ")),
    "every word of the shared rendering, in order",
  );
  const context = blocks[1];
  assert(context?.kind === "section" && context.title === "Context");
  assert(
    context.blocks.some((block) => block.kind === "text"),
    "a detail that isn't a label and value stays a line of its own",
  );
  // A detail naming the list under it reads as one row, never as a heading
  // that a page could end on.
  const queue = context.blocks.flatMap((block) =>
    block.kind === "facts" ? block.rows : []
  ).find((row) => row.label === "Landing queue");
  assertEquals(queue?.value.length, 2, said(context.blocks));
});

Deno.test("a checkout's path reads short in the inspector and whole in View changes", () => {
  const root = "/private/var/folders/bc/tp3rgcfj4/T/discern-desk-42a1/project";
  const worktree = `${root}.worktrees/tidy-scripts-b8c9d0`;
  const shown = (path: string): string =>
    checkoutPathRuns(path, root).map((run) => run.text).join("");
  assertEquals(shown(worktree), "…/project.worktrees/tidy-scripts-b8c9d0");
  assertEquals(shown(root), "…/project");
  assertEquals(shown(`${root}/.trees/alpha`), "…/project/.trees/alpha");
  assertEquals(shown("/srv/checkouts/team/alpha"), "/srv/…/team/alpha");
  assertEquals(shown("/srv/team/alpha"), "/srv/team/alpha");
  assertEquals(
    checkoutPathRuns(worktree, root).map((run) => run.ascii ?? run.text)
      .join(""),
    ".../project.worktrees/tidy-scripts-b8c9d0",
  );

  const env = { ...ENV, root };
  const state = desk(
    statusData([
      mainFleetEntry(root),
      fleetEntry({ id: "alpha", branch: "agent/alpha", path: worktree }),
    ]),
  );
  const view = deskView(state, { ...PRODUCT_UI, selected: "alpha" }, env);
  assert(view.body.kind === "master-detail");
  const identity = (view.body.detail.content.alpha ?? []).find((block) =>
    block.kind === "section" && block.title === "Identity"
  );
  assert(identity?.kind === "section");
  const facts = identity.blocks.find((block) => block.kind === "facts");
  assert(facts?.kind === "facts");
  assertEquals(
    facts.rows.find((row) => row.label === "Path")?.value,
    [checkoutPathRuns(worktree, root)],
  );
  const reading = deskView(
    open(state, {
      kind: "reader",
      reader: {
        kind: "changes",
        taskId: "alpha",
        load: {
          state: "ready",
          value: {
            trunk: "main",
            proof: { status: "honored" },
            commits: "",
            files: [],
            insertions: 0,
            deletions: 0,
            failures: [],
            diffCommand: "git diff main...HEAD",
          },
        },
      },
    }).state,
    PRODUCT_UI,
    env,
  ).layers?.[0];
  assertStringIncludes(said(reading), worktree);
});

Deno.test("a task's identifier shows once under its title and once in its path", () => {
  assertEquals(branchLine("agent/tidy-b8c9d0", "tidy-b8c9d0"), "tidy-b8c9d0");
  assertEquals(branchLine("feature/login", "tidy-b8c9d0"), "feature/login");
  assertEquals(branchLine("", "tidy-b8c9d0"), "tidy-b8c9d0");
  const id = "tidy-scripts-b8c9d0";
  const state = desk(
    statusData([
      mainFleetEntry(),
      fleetEntry({ id, branch: `agent/${id}`, path: `/work/project/${id}` }),
    ]),
  );
  const view = deskView(state, { ...PRODUCT_UI, selected: id }, ENV);
  assert(view.body.kind === "master-detail");
  const blocks = view.body.detail.content[id] ?? [];
  const heading = blocks[0];
  assert(heading?.kind === "heading");
  assertEquals(heading.aside, [{ text: id, tone: "faint" }]);
  const identity = blocks.find((block) =>
    block.kind === "section" && block.title === "Identity"
  );
  assert(identity?.kind === "section");
  const labels = identity.blocks.flatMap((block) =>
    block.kind === "facts" ? block.rows.map((row) => row.label) : []
  );
  assertEquals(labels, ["Path"], "the id is the path's own last name");
  const reading = deskView(
    open(state, {
      kind: "reader",
      reader: {
        kind: "changes",
        taskId: id,
        load: {
          state: "ready",
          value: {
            trunk: "main",
            proof: { status: "honored" },
            commits: "",
            files: [],
            insertions: 0,
            deletions: 0,
            failures: [],
            diffCommand: "git diff main...HEAD",
          },
        },
      },
    }).state,
    PRODUCT_UI,
    ENV,
  ).layers?.[0];
  assertStringIncludes(said(reading), `agent/${id}`);
});

Deno.test("the keys reader groups each meaning's keys into one readable row", () => {
  const state = open(
    desk(statusData([mainFleetEntry(), task({ ahead: 2 })])),
    { kind: "reader", reader: { kind: "keys" } },
  ).state;
  const frame = render(deskView(state, PRODUCT_UI, ENV), 80, 60);
  // Arrow pairs touch, every other key stands a space apart, and a run of
  // digits reads as a range, Parked's key with the groups'.
  for (
    const row of [
      /↑↓ k j\s+Move\b/u,
      /Tab ⇧Tab\s+Next or previous group\b/u,
      /1–6\s+Jump to a group\b/u,
      /Home End\s+First or last row\b/u,
      /Space\s+Zoom details\b/u,
      /PgUp PgDn\s+Scroll details\b/u,
      /→ \.\s+Actions\b/u,
      /\^K :\s+Commands\b/u,
      / q\s+Quit\b/u,
      /Esc\s+Clear filter, leave zoom\b/u,
      /←→\s+Move between buttons\b/u,
      /Esc\s+The safe choice\b/u,
      /d \^T\s+Technical plan\b/u,
      /Esc Close\b/u,
    ]
  ) {
    assert(row.test(frame), `${row} in\n${frame}`);
  }
  // Alternatives left to the manual keep each row short.
  for (const left of ["⇧↑", "^C"]) {
    assert(!frame.includes(left), `${left} in\n${frame}`);
  }
});

Deno.test("the keys reader lists every key the inbox and a review answer to", () => {
  const view = deskView(
    open(desk(statusData([mainFleetEntry(), task({ ahead: 2 })])), {
      kind: "reader",
      reader: { kind: "keys" },
    }).state,
    PRODUCT_UI,
    ENV,
  );
  const reader = view.layers?.[0];
  assert(reader?.kind === "reader");
  const listed = new Set(
    reader.blocks.flatMap((block) =>
      block.kind === "section"
        ? block.blocks.flatMap((inner) =>
          inner.kind === "hints"
            ? inner.items.flatMap((item) =>
              typeof item.key === "string" ? [item.key] : [...item.key]
            )
            : []
        )
        : []
    ),
  );
  const missing = DESK_KEYS.inbox.filter((binding) =>
    binding.listed !== false && !listed.has(binding.key)
  ).map((binding) => binding.key);
  assertEquals(missing, [], "every inbox key the reader doesn't list");
});

Deno.test("an open layer leaves the inspector beneath it whole", () => {
  // The package starts what shows below a layer at a block boundary, so the
  // inspector never trims itself for a layer.
  const state = desk(statusData([mainFleetEntry(), task({ ahead: 2 })]));
  const inspector = (opened: DeskProductState) => {
    const view = deskView(opened, { ...PRODUCT_UI, selected: "task" }, ENV);
    assert(view.body.kind === "master-detail");
    return view.body.detail.content.task ?? [];
  };
  const open = inspector(state);
  const titles = open.flatMap((block) =>
    block.kind === "section" ? [block.title] : []
  );
  assert(titles.includes("Next") && titles.includes("Identity"), `${titles}`);
  const covered = deskProduct(state, {
    kind: "intent",
    intent: { kind: "key", key: "." },
    ui: { ...PRODUCT_UI, selected: "task" },
    now: NOW,
    clock: 0,
  }).state;
  assert(covered.layers.length > 0, "the actions menu is open");
  assertEquals(inspector(covered), open);
});

Deno.test("every row state's inspector and strip render in status's words", () => {
  let marks = 0;
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
    // A marks list in the narrow column is evidence, drawn compact.
    for (const block of marksBlocks(view.body.detail.content[id])) {
      assert("compact" in block && block.compact === true, `row ${row.row}`);
      marks += 1;
    }
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
  assert(marks > 0, "some inspector lists failures or setup steps");
});

Deno.test("the empty state says what a task is and how it lands, a line each", () => {
  const view = deskView(desk(statusData([mainFleetEntry()])), PRODUCT_UI, ENV);
  assert(view.body.kind === "empty");
  const lines = render(view, 80, 24).split("\n").map((line) => line.trim());
  for (
    const sentence of [
      "A task is its own checkout and branch for one change.",
      "Hand it to an agent; land it on main once its checks pass.",
    ]
  ) {
    assert(lines.includes(sentence), `${sentence} in\n${lines.join("\n")}`);
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
  // Enter's New task leads the footer, Down reaches the kept branches, and
  // no other hint repeats New task.
  assertEquals(view.footer.left.map((hint) => [hint.key, hint.label]), [
    ["enter", "New task…"],
    ["down", "Parked"],
  ]);
  assertEquals(
    [...view.footer.right ?? [], ...view.footer.extra ?? []].filter((hint) =>
      hint.label === "New task…"
    ),
    [],
  );
  assertEquals(
    view.body.list.groups.find((group) => group.id === "parked")?.aside,
    [{ text: "branches without a checkout", tone: "faint" }],
  );
  assertEquals(
    validateTerminalApplicationView(view, {
      keymap: deskKeymap(),
      viKeys: true,
    }),
    [],
  );
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
      "Update check due",
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

Deno.test("a running time is a clock the package paints; the view moves with its seconds", () => {
  const running = (elapsed: number) =>
    desk(productSurvey([fleetEntry({
      id: "running",
      branch: "agent/running",
      running: {
        verb: "done",
        started: "2026-09-30T11:59:00.000Z",
        elapsed_ms: elapsed,
      },
    })]));
  const env = { ...ENV, now: NOW + 2_400, clock: 50_000 };
  const age = (state: DeskProductState) => {
    const view = deskView(state, PRODUCT_UI, env);
    assert(view.body.kind === "master-detail");
    return view.body.list.groups.flatMap((group) => group.items)
      .find((item) => item.id === "running")?.cells?.age?.[0];
  };
  // Counted back from the view's clock: 62.4s run as it was built.
  assertEquals(age(running(60_000))?.clock, { since: 50_000 - 62_400 });
  assertEquals(
    age(running(60_000))?.text,
    "1:02",
    "words for a frame without a time",
  );
  // From ten minutes the column reads minutes, which a clock would outgrow.
  assertEquals(age(running(598_000))?.clock, undefined);
  assertEquals(age(running(598_000))?.text, "10m");

  const state = running(60_000);
  const selected = { ...PRODUCT_UI, selected: "running" };
  // The inspector's words count on with the clock, in whole seconds.
  const view = deskView(state, selected, env);
  assert(view.body.kind === "master-detail");
  assertStringIncludes(said(view.body.detail.content.running), "1m 2s ago");
  assertEquals(deskTickDelay(state, selected, env), 600, "at its next second");
  assertEquals(deskTickDelay(state, PRODUCT_UI, env), 1_000);
  assertEquals(
    deskTickDelay(desk(productSurvey([])), selected, env),
    undefined,
  );
  const frozen = {
    ...state,
    survey: { ...state.survey, failures: DESK_OFFLINE_FAILURES },
  };
  assertEquals(deskTickDelay(frozen, selected, env), undefined);
  assertEquals(age(frozen)?.clock, undefined, "a frozen time stays words");
});

Deno.test("only a message's mark carries its tone; its words stay neutral", () => {
  const tones = ["success", "warning", "danger", "muted", "accent"] as const;
  for (const tone of tones) {
    const message = toast(freshDesk(), tone, "Something happened", {
      detail: "what it found",
    }).message;
    const line = messageLine(message);
    assert(line !== undefined);
    assertEquals(line.tone, "muted", `${tone}: the line's own tone`);
    const marked = message?.mark !== undefined;
    if (tone !== "muted" && tone !== "accent") {
      assert(marked, `${tone}: a toned message leads with its mark`);
      assertEquals(line.runs[0]?.tone, tone, `${tone}: its mark's tone`);
    }
    const words = line.runs.slice(marked ? 1 : 0);
    const toned = words.filter((run) =>
      run.tone !== undefined && !["ink", "muted", "faint"].includes(run.tone)
    );
    assertEquals(toned, [], `${tone}: its words carry no tone`);
    assertEquals(line.optional, undefined, `${tone}: a toast always shows`);
  }
});

Deno.test("the tip shows only whole and never takes the footer's row", () => {
  const brief = "Space zooms the selected task's details to the whole screen.";
  const state = deskProduct(
    desk(statusData([mainFleetEntry(), task({ ahead: 2 })])),
    { kind: "tip", tip: { lead: "Tip", brief, full: brief } },
  ).state;
  const view = deskView(state, PRODUCT_UI, ENV);
  assertEquals(view.message?.optional, true);
  const footer = /\^K Commands/u;
  const wide = render(view, 80, 24);
  assertStringIncludes(wide, brief, "80 columns show the brief whole");
  assert(footer.test(wide), wide);
  for (const [columns, rows] of [[40, 20], [80, 13]] as const) {
    const frame = render(view, columns, rows);
    assert(
      !frame.includes("Tip "),
      `${columns}×${rows} leaves it out\n${frame}`,
    );
    assert(
      footer.test(frame.split("\n").at(-1) ?? ""),
      `${columns}×${rows} keeps the footer\n${frame}`,
    );
  }
});

Deno.test("an action menu's section titles carry no tone; a destructive item is red", () => {
  let destructive = 0;
  for (const row of TABLE_ROWS) {
    const [shown] = desk(statusData([mainFleetEntry(), row.entry])).rows;
    assert(shown !== undefined, `row ${row.row}`);
    for (const section of actionsMenu(shown).sections) {
      assertEquals(section.tone, undefined, `row ${row.row}: ${section.title}`);
      destructive += section.items.filter((item) => item.tone === "danger")
        .length;
    }
  }
  assert(destructive > 0, "some row offers a destructive action");
});

Deno.test("a changed review keeps r Review again in its footer as it narrows", () => {
  const state = open(desk(statusData([mainFleetEntry(), task({ ahead: 2 })])), {
    kind: "review",
    step: { kind: "action", action: "accept", taskId: "task", stage: "review" },
    load: {
      state: "ready",
      value: readyReview("Land the task?", {
        confirm: { kind: "apply", running: "Landing the task" },
        expected: { facts: { "branch-head": "moved since it was read" } },
        disclosures: {
          command: "discern accept --target agent/task --confirmed",
          plan: { title: "Acceptance plan", details: [], steps: [] },
        },
      }),
    },
  }).state;
  const view = deskView(state, { ...PRODUCT_UI, selected: "task" }, ENV);
  for (const [columns, rows] of [[40, 24], [60, 20], [80, 24]] as const) {
    const footer = render(view, columns, rows).split("\n").at(-1) ?? "";
    assertStringIncludes(footer, "r Review again", `${columns}×${rows}`);
    assertStringIncludes(footer, "Esc", `${columns}×${rows}`);
  }
});

Deno.test("a result sheet's next step names exactly the buttons it offers", () => {
  const sheet = {
    title: "Alpha landed; Beta didn't",
    tone: "warning" as const,
    lines: [],
    command: "discern accept",
    taskId: "beta",
    next: {
      actions: ["agent", "update"] as const,
      purpose: "resolve" as const,
      subject: "Beta",
      source: { kind: "result" as const, field: "landings" },
    },
  };
  const words: Record<string, RegExp> = {
    agent: /\bagent\b/u,
    update: /\bupdate\b/iu,
  };
  // Behind main, Update is offered; up to date, it is not.
  for (const behind of [0, 3]) {
    const state = open(
      desk(statusData([
        mainFleetEntry(),
        fleetEntry({ id: "beta", branch: "agent/beta", ahead: 1, behind }),
      ])),
      { kind: "result", sheet },
    ).state;
    const layer = deskView(state, PRODUCT_UI, ENV).layers?.[0];
    assert(layer?.kind === "sheet");
    const offered = (layer.buttons ?? []).map((button) => button.id);
    const sentence = said(layer.body);
    assertEquals(
      offered.some((id) => id.endsWith("update")),
      behind > 0,
      `behind ${behind}: ${offered.join(", ")}`,
    );
    for (const [action, pattern] of Object.entries(words)) {
      assertEquals(
        pattern.test(sentence),
        offered.some((id) => id.endsWith(action)),
        `behind ${behind}: ${action} in ${sentence} vs ${offered.join(", ")}`,
      );
    }
  }
});

Deno.test("zoom's footer walks to the next task and keeps the task's keys", () => {
  const view = deskView(
    desk(statusData([mainFleetEntry(), task({ ahead: 2 })])),
    { ...PRODUCT_UI, selected: "task" },
    ENV,
  );
  assert(view.body.kind === "master-detail");
  const zoom = view.body.zoomFooter;
  assert(zoom !== undefined);
  assertEquals(zoom.left[0], view.footer.left[0], "the next step leads");
  assertEquals(zoom.left[1], { key: ["up", "down"], label: "Next task" });
  assertEquals(zoom.right?.map((hint) => hint.label), ["Back", "Actions"]);
  assertEquals(
    zoom.left.slice(2),
    view.footer.left.slice(1),
    "every key of the task's own stays",
  );
});

/**
 * A Desk whose one task offers Claude Code and Codex, with the agents
 * picker open, finding only the named binaries on PATH.
 */
function agentPicker(
  found: readonly DetectedAgentBinary[],
): { view: TerminalApplicationView<DeskIntent>; launches: DeskAgentLaunch[] } {
  const config = configSchema.parse({
    project: { name: "demo", slug: "demo", agents: ["claude_code", "codex"] },
  });
  const launches = buildAgentLaunches(config, found);
  const listed = desk(statusData([mainFleetEntry(), task({ ahead: 2 })]));
  const state: DeskProductState = {
    ...listed,
    rows: listed.rows.map((row) => ({
      ...row,
      discovered: true,
      agentLaunches: launches,
    })),
  };
  const view = deskView(
    open(state, { kind: "agents", taskId: "task" }).state,
    PRODUCT_UI,
    ENV,
  );
  return { view, launches };
}

Deno.test("the agent picker says what a launch does and how to come back, never its argv", () => {
  const { view, launches } = agentPicker([
    { name: "claude_code", binary: "claude" },
    { name: "codex", binary: "codex" },
  ]);
  const menu = view.layers?.[0];
  assert(menu?.kind === "menu");
  const items = menu.sections.flatMap((section) => section.items);
  assert(items.length === 4, said(items));
  for (const item of items) {
    assertEquals(item.detail, undefined, `${item.id}: no row detail`);
    const words = said(item.description);
    for (const launch of launches) {
      const argv = [launch.binary, ...launch.args].join(" ");
      assert(!words.includes(argv), `${item.id}: ${words}`);
    }
  }
  const claude = items.filter((item) => item.id.startsWith("claude_code:"));
  assert(claude.every((item) => said(item.description).includes("/exit")));
});

Deno.test("an agent that can't open says why in a few words, and the remedy on Enter", () => {
  const { view } = agentPicker([{ name: "claude_code", binary: "claude" }]);
  const menu = view.layers?.[0];
  assert(menu?.kind === "menu");
  const unavailable = menu.sections.flatMap((section) =>
    section.unavailable ?? []
  );
  assertEquals(unavailable.map((item) => item.reason), ["not on your PATH"]);
  const [codex] = unavailable;
  assert(codex !== undefined);
  assertStringIncludes(codex.sentence, "[project].agents in discern.toml");
  assertStringIncludes(
    render(view, 80, 24),
    `${codex.label}  not on your PATH`,
  );
});
