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
  DESK_FILTER_THRESHOLD,
  deskActionGroups,
  deskCompositionReserveRows,
  type DeskReview,
  deskReviewGroups,
  deskRootSelectionGroups,
  deskRootUsesSearch,
  deskRowLayout,
  deskUnlandedBranch,
  renderDeskActionFailure,
  renderDeskActionPlan,
  renderDeskAgentHandoff,
  renderDeskBoard,
  renderDeskCreatedTask,
  renderDeskProjectScriptPlan,
  renderDeskReview,
  renderDeskStartPreview,
  renderDeskTaskDetail,
  renderDeskUnlandedBranchDetail,
} from "../src/engine/desk/view.ts";
import { startPlanToEngine } from "../src/engine/worktree/plan.ts";
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

Deno.test("Desk filtering begins exactly above the direct-scan threshold", () => {
  assertEquals(DESK_FILTER_THRESHOLD, 8);
  assertEquals(deskRootUsesSearch(8), false);
  assertEquals(deskRootUsesSearch(9), true);
});

Deno.test("a 50-task Unicode fleet projects bounded selectable content", () => {
  const unicode = entry("unicode-修复终端布局和证明显示-a1b2c3");
  const entries = [
    unicode,
    ...Array.from(
      { length: 49 },
      (_, index) =>
        entry(`routine-task-${index + 1}-${String(index).padStart(6, "0")}`),
    ),
  ];
  const size = { columns: 120, rows: 50 };
  const groups = deskRootSelectionGroups({
    rows: rows(entries),
    hasProjectScripts: false,
    viewport: size,
    terminal: terminal(size, { color: true }),
  });
  const items = groups.flatMap((group) => group.items).filter((item) =>
    !item.value.startsWith("\x00")
  );
  assertEquals(items.length, 50);
  assertStringIncludes(
    items.find((item) => item.value === unicode.path)?.name ?? "",
    "修复终端布局和证明显示",
  );
  for (const item of items) {
    assert(measureText(item.name) <= size.columns - 8, item.name);
  }
});

Deno.test("branches without worktrees remain exact selectable refs", () => {
  const size = { columns: 60, rows: 24 };
  const branch = "agent/orphan-修复-terminal";
  const groups = deskRootSelectionGroups({
    rows: [],
    unlandedBranches: [branch],
    hasProjectScripts: false,
    viewport: size,
    terminal: terminal(size),
  });
  const group = groups.find((candidate) =>
    candidate.id === "unlanded-branches"
  );
  assert(group !== undefined);
  assertStringIncludes(group.label, "Work without a worktree");
  const item = group.items[0];
  assert(item !== undefined);
  assertEquals(deskUnlandedBranch(item.value), branch);

  const rendered = renderDeskUnlandedBranchDetail(
    branch,
    "main",
    size,
    terminal(size),
  );
  assertStringIncludes(stripAnsi(rendered.text), branch);
  assertStringIncludes(stripAnsi(rendered.text), "Resume in a worktree");
  assertBounded(rendered.text, size.columns);
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

Deno.test("task metadata preserves human wording beside normalized identity", () => {
  const title = "Repair: terminal ingress — 修复";
  const brief = "Keep the person's exact words through agent handoff.";
  const id = "repair-terminal-ingress-a1b2c3";
  const branch = `agent/${id}`;
  const commit = "a".repeat(40);
  const [row] = rows([entry(id, {
    id,
    branch,
    task: {
      id,
      branch,
      title,
      title_source: "recorded",
      brief,
      created_from: { ref: "agent/earlier-task", commit },
    },
  })]);
  assert(row !== undefined);
  for (const columns of [40, 80, 120]) {
    const size = { columns, rows: 40 };
    const rendered = renderDeskTaskDetail(row, size, terminal(size));
    const compact = stripAnsi(rendered.text).replaceAll(/[\s│]+/gu, "");
    for (
      const expected of [title, brief, id, branch, "agent/earlier-task", commit]
    ) {
      assertStringIncludes(compact, expected.replaceAll(/\s+/gu, ""));
    }
    assertBounded(rendered.text, columns);
  }
});

Deno.test("task detail distinguishes unavailable metadata from a legacy fallback", () => {
  const reason =
    "Task metadata is unavailable because its record does not match the supported schema.";
  const id = "fallback-task-a1b2c3";
  const [row] = rows([entry(id, {
    id,
    task: {
      id,
      branch: `agent/${id}`,
      title: "Fallback task",
      title_source: "unavailable-fallback",
      unavailable_reason: reason,
    },
  })]);
  assert(row !== undefined);
  const rendered = renderDeskTaskDetail(
    row,
    { columns: 80, rows: 40 },
    terminal({ columns: 80, rows: 40 }),
  );
  const plain = stripAnsi(rendered.text);
  assertStringIncludes(
    plain.replaceAll(/\s+/gu, ""),
    reason.replaceAll(/\s+/gu, ""),
  );
  assertEquals(plain.includes("older task"), false);
});

Deno.test("start preview and receipt retain every creation fact", () => {
  const title = "Repair: task ingress — 修复";
  const brief = "Open the selected agent with the stored context visible.";
  const commit = "b".repeat(40);
  const plan = {
    id: "repair-task-ingress-a1b2c3",
    branch: "agent/repair-task-ingress-a1b2c3",
    worktreePath: "/tmp/worktrees/repair-task-ingress-a1b2c3",
    from: "agent/earlier-task",
    fromCommit: commit,
    title,
    brief,
    resources: [{ name: "database", identity: "demo_repair_task_ingress" }],
    note: "Normalized the worktree id to repair-task-ingress-a1b2c3.",
  };
  const started = {
    id: plan.id,
    branch: plan.branch,
    path: plan.worktreePath,
    from: plan.from,
    task: {
      id: plan.id,
      branch: plan.branch,
      title,
      title_source: "recorded" as const,
      brief,
      created_from: { ref: plan.from, commit },
    },
    name_note: plan.note,
  };
  for (const columns of [40, 80, 120]) {
    const size = { columns, rows: 60 };
    const context = terminal(size);
    const preview = renderDeskStartPreview({
      plan,
      enginePlan: startPlanToEngine(plan),
      command: [
        "discern",
        "start",
        "--title",
        title,
        "--brief",
        brief,
        "--from",
        plan.from,
      ],
      launch: AGENT,
      preauthorizeLanding: true,
      viewport: size,
      terminal: context,
    });
    const receipt = renderDeskCreatedTask(
      started,
      AGENT,
      true,
      size,
      context,
    );
    for (const rendered of [preview, receipt]) {
      const compact = stripAnsi(rendered.text).replaceAll(/[\s│]+/gu, "");
      for (
        const expected of [
          title,
          brief,
          plan.id,
          plan.branch,
          plan.from,
          plan.worktreePath,
          plan.note,
        ]
      ) {
        assertStringIncludes(compact, expected.replaceAll(/\s+/gu, ""));
      }
      assertBounded(rendered.text, columns);
    }
    const previewText = stripAnsi(preview.text).replaceAll(/[\s│]+/gu, "");
    for (
      const expected of [
        commit,
        "database=demo_repair_task_ingress",
        "OpeninCodex",
      ]
    ) {
      assertStringIncludes(previewText, expected.replaceAll(/\s+/gu, ""));
    }
  }
});

Deno.test("agent handoff keeps an unpassed brief copyable", () => {
  const size = { columns: 50, rows: 24 };
  const brief = "Preserve Unicode 修复 and punctuation: exactly.";
  const copyable = renderDeskAgentHandoff(
    { title: "Task title", brief },
    AGENT,
    false,
    size,
    terminal(size),
  );
  assert(copyable !== undefined);
  const copyableText = stripAnsi(copyable.text);
  const compactCopyable = copyableText.replaceAll(/[\s│]+/gu, "");
  assertStringIncludes(compactCopyable, brief.replaceAll(/\s+/gu, ""));
  assertStringIncludes(compactCopyable, "Copythisstoredbrief");
  assertStringIncludes(compactCopyable, "doesnotdeclareapromptoption");
  assertBounded(copyable.text, size.columns);

  const passed = renderDeskAgentHandoff(
    { title: "Task title", brief },
    {
      ...AGENT,
      promptArgument: {
        kind: "option",
        flag: "--prompt",
        documentation: "https://provider.example/cli#prompt",
      },
    },
    true,
    size,
    terminal(size),
  );
  assert(passed !== undefined);
  assertStringIncludes(stripAnsi(passed.text), "discern passes");
  assertEquals(
    renderDeskAgentHandoff(
      { title: "Task title" },
      AGENT,
      false,
      size,
      terminal(size),
    ),
    undefined,
  );
});

Deno.test("only the model-recommended action receives recommendation copy", () => {
  const [row] = rows([entry("needs-gate-a1b2c3")]);
  assert(row !== undefined);
  assert(row.decision.recommendedAction !== undefined);
  const items = deskActionGroups(row).flatMap((group) => group.items);
  assertEquals(
    items.filter((item) =>
      item.description === "This action best fits the current task state."
    ).map((item) => item.value),
    [row.decision.recommendedAction],
  );
});

Deno.test("action menus retain disabled offers with factual recovery", () => {
  const task = entry("blocked-capabilities-a1b2c3", {
    clean: false,
    changed_files: 1,
    gate_proof: { status: "dirty" },
  });
  const [row] = buildDeskRows(
    [task],
    new Map([[task.path, []]]),
    new Map([[task.path, [{
      ...AGENT,
      availability: "disabled" as const,
      reason:
        "Codex is configured, but `codex` is not on PATH. Install Codex or remove it from [project].agents in discern.toml.",
    }]]]),
    {
      trunk: "main",
      nowMs: NOW,
      scriptsUnavailableReasons: new Map([[
        task.path,
        "Project Scripts directory /tmp/scripts does not exist. Create it and add an executable script.",
      ]]),
    },
  );
  assert(row !== undefined);
  const groups = deskActionGroups(row);
  assertEquals(groups.map((group) => group.label), [
    "Work",
    "Review",
    "Manage",
    "Danger",
  ]);
  const items = groups.flatMap((group) => group.items);
  const agent = items.find((item) => item.value === "agent");
  const scripts = items.find((item) => item.value === "scripts");
  assert(agent !== undefined && agent.disabled === true);
  assertStringIncludes(agent.description ?? "", "not on PATH");
  assert(scripts !== undefined && scripts.disabled === true);
  assertStringIncludes(
    scripts.description ?? "",
    "Create it and add an executable script",
  );
});

Deno.test("action plans use package command, procedure, consequence, and warning frames", () => {
  const [row] = rows([entry("plan-a1b2c3")]);
  assert(row !== undefined);
  const offer = row.decision.actions.find((candidate) =>
    candidate.action === "done"
  );
  assert(offer !== undefined);
  const size = { columns: 80, rows: 40 };
  const rendered = renderDeskActionPlan(
    row,
    offer,
    {
      title: "Final checks plan",
      details: ["The shared gate core produced this plan."],
      steps: [],
    },
    size,
    terminal(size),
  );
  const plain = stripAnsi(rendered.text);
  for (
    const expected of [
      "Run: discern done",
      "Final checks plan",
      "Consequence account",
      "Keeps",
      "Changes",
      "Removes",
      "Recoverable",
      "Expected result",
    ]
  ) {
    assertStringIncludes(plain, expected);
  }
  assertBounded(rendered.text, size.columns);

  const script = renderDeskProjectScriptPlan(
    {
      name: "release",
      description: "Publish the current checkout",
      path: "/tmp/project scripts/$release",
      workingDirectory: "/tmp/project",
      availability: "enabled",
      confirmation: "required",
      destructive: "undeclared",
    },
    "/tmp/project",
    size,
    terminal(size),
  );
  const scriptText = stripAnsi(script.text).replaceAll(/\s+/gu, " ");
  assertStringIncludes(scriptText, "'/tmp/project scripts/$release'");
  assertStringIncludes(scriptText, "Publish the current checkout");
  assertStringIncludes(scriptText, "Confirmation policy: required");
  assertStringIncludes(scriptText, "Destructive policy: undeclared");
  assertStringIncludes(scriptText, "Human confirmation in the Desk");
});

Deno.test("Proof-first review renders stored Markdown and every review evidence class", () => {
  const proofLine = "Proof: agent/review-a1b2c3 abc1234 · gate passed in 1m";
  const proofPage =
    "# Gate Proof\n\n## Checks\n\n- test passed\n\n## Standards\n\n- coverage held";
  const [row] = rows([entry("review-a1b2c3", {
    gate_proof: { status: "honored", proof_line: proofLine },
    landing_authority: {
      kind: "conversation-required",
      uncovered: [{ path: "src/review.ts", scopes: ["source"] }],
    },
  })]);
  assert(row !== undefined);
  const review: DeskReview = {
    trunk: "main",
    proof: {
      status: "honored",
      head: "abc1234",
      recorded: "abc1234",
      proof: proofPage,
      proof_line: proofLine,
      proof_data: {
        branch: row.entry.branch,
        trunk: "main",
        head: "abc1234",
        files_total: 2,
        insertions: 12,
        deletions: 3,
        line: proofLine,
        markdown: proofPage,
      },
    },
    commits: "abc1234 Add Proof review\ndef5678 Map package frames",
    files: [{
      path: "src/review.ts",
      disposition: "updated",
      added: 12,
      removed: 3,
      uncommitted: true,
    }],
    insertions: 12,
    deletions: 3,
    failures: [{
      title: "Pager failed",
      command: "$PAGER",
      detail: "pager exited with status 1",
      nextAction: "Set $PAGER to a working command, then retry.",
      safeToRetry: true,
    }],
    diffCommand: "git diff --no-ext-diff --color=always main...HEAD",
    editorUnavailableReason: "No editor configured in $VISUAL or $EDITOR.",
  };
  const size = { columns: 100, rows: 80 };
  const rendered = renderDeskReview(row, review, size, terminal(size));
  const plain = stripAnsi(rendered.text);
  for (
    const expected of [
      proofLine,
      "Gate Proof",
      "Checks",
      "test passed",
      "Standards",
      "+12 −3",
      "abc1234 Add Proof review",
      "src/review.ts",
      "Uncommitted paths",
      "Owner approval remains for src/review.ts",
      "Pager failed",
      "pager exited with status 1",
      "Safe to retry",
    ]
  ) {
    assertStringIncludes(plain, expected);
  }
  const editor = deskReviewGroups(review).flatMap((group) => group.items)
    .find((item) => item.value === "\x00review-editor");
  assert(editor !== undefined && editor.disabled === true);
  assertStringIncludes(editor.description ?? "", "$VISUAL");
  assertBounded(rendered.text, size.columns);
});

Deno.test("lifecycle refusals use the shared diagnostic and retry contract", () => {
  const [row] = rows([entry("failure-a1b2c3")]);
  assert(row !== undefined);
  const offer = row.decision.actions.find((candidate) =>
    candidate.action === "done"
  );
  assert(offer !== undefined);
  const size = { columns: 80, rows: 30 };
  const rendered = renderDeskActionFailure(
    row,
    offer,
    "The branch moved. Run discern status, then retry.",
    size,
    terminal(size),
  );
  const plain = stripAnsi(rendered.text);
  assertStringIncludes(plain, "Run final checks was refused");
  assertStringIncludes(plain, "Reproduce: $ discern done");
  assertStringIncludes(plain, "Safe to retry");
  assertStringIncludes(plain, "The branch moved");
  assertBounded(rendered.text, size.columns);
});
