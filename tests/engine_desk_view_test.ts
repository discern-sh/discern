/** Pure coverage for the Desk's responsive product presentation boundary. */

import { assert, assertEquals, assertStringIncludes } from "@std/assert";
import { measureText, stripAnsi } from "discern-design-system/cli";
import type {
  StatusData,
  StatusFleetEntry,
} from "../src/shared/result_schemas.ts";
import {
  buildDeskRows,
  type DeskAgentLaunch,
  type DeskRow,
} from "../src/engine/desk/model.ts";
import {
  deskCompositionReserveRows,
  type DeskReview,
  deskReviewGroups,
  renderDeskActionFailure,
  renderDeskActionPlan,
  renderDeskAgentHandoff,
  renderDeskCreatedTask,
  renderDeskMainCheckoutDetail,
  renderDeskProjectScriptPlan,
  renderDeskRecentCompleted,
  renderDeskRecovery,
  renderDeskReview,
  renderDeskStartPreview,
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

Deno.test("start preview and created-task report retain every creation fact", () => {
  const title = "Repair: task ingress — 修复";
  const brief = "Open the selected agent with the stored context visible.";
  const commit = "b".repeat(40);
  const plan = {
    id: "repair-task-ingress-a1b2c3",
    branch: "agent/repair-task-ingress-a1b2c3",
    worktreePath: "/tmp/worktrees/repair-task-ingress-a1b2c3",
    from: "agent/earlier-task",
    fromCommit: commit,
    trunk: "main",
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
    const createdTask = renderDeskCreatedTask(
      started,
      AGENT,
      true,
      size,
      context,
    );
    for (const rendered of [preview, createdTask]) {
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
    ["--target", "review environment"],
    "/tmp/project",
    size,
    terminal(size),
  );
  const scriptText = stripAnsi(script.text).replaceAll(/\s+/gu, " ");
  assertStringIncludes(scriptText, "'/tmp/project scripts/$release'");
  assertStringIncludes(scriptText, "--target 'review environment'");
  assertStringIncludes(scriptText, "Publish the current checkout");
  assertStringIncludes(scriptText, "Confirmation policy: required");
  assertStringIncludes(scriptText, "Destructive policy: undeclared");
  assertStringIncludes(scriptText, "Human confirmation in the desk");
});

Deno.test("recovery, main, and completion views use package workflow evidence", () => {
  const degraded = entry("recovery-a1b2c3", {
    clean: undefined,
    changed_files: undefined,
    ahead: undefined,
    git_unavailable: true,
    git_failure: {
      command: "git status --porcelain=v1",
      reason: "fatal: index file smaller than expected",
    },
    registration: {
      head: "a".repeat(40),
      locked: false,
      prunable: false,
    },
    branch_reachable: true,
    filesystem: { state: "directory" },
    setup: {
      state: "ready",
      marker: "present",
    },
    last_action: {
      verb: "worktree setup",
      outcome: "failed",
      at: "2026-08-27T11:30:00.000Z",
      failed_stage: "refresh",
    },
  });
  const [recoveryRow] = rows([degraded]);
  assert(recoveryRow !== undefined);
  const size = { columns: 100, rows: 70 };
  const recovery = stripAnsi(
    renderDeskRecovery(recoveryRow, size, terminal(size)).text,
  );
  for (
    const expected of [
      "Task recovery needed",
      "fatal: index file smaller than expected",
      "Reproduce: $ git status --porcelain=v1",
      "Observed evidence",
      "Git registration",
      "Last lifecycle result: worktree setup failed",
      "Manual recovery",
      "The task remains intact",
    ]
  ) {
    assertStringIncludes(recovery, expected);
  }

  const mainData: StatusData = {
    location: "main",
    root: "/tmp/project",
    project: "demo",
    worktree: null,
    git: null,
    standards: [],
    fleet: [{
      path: "/tmp/project",
      branch: "main",
      is_main: true,
      is_current: true,
      git_unavailable: true,
      git_failure: {
        command: "git status --porcelain=v1",
        reason: "fatal: bad index",
      },
    }],
  };
  const main = stripAnsi(
    renderDeskMainCheckoutDetail(mainData, size, terminal(size)).text,
  );
  assertStringIncludes(main, "Main checkout boundary");
  assertStringIncludes(main, "Main Git state is unavailable");
  assertStringIncludes(main, "Git-dependent fleet operations remain blocked");
  assertStringIncludes(main, "Reproduce: $ git status --porcelain=v1");

  const completedData: StatusData = {
    ...mainData,
    recent_completed_tasks: [{
      branch: "agent/completed",
      head: "abc1234",
      completed_at: "2026-08-27T11:00:00.000Z",
      proof_line:
        "> **Proof:** Gate passed for `agent/completed` at `abc1234` · View the full Proof: `discern status --verbose`",
    }],
  };
  const completed = stripAnsi(
    renderDeskRecentCompleted(completedData, size, terminal(size)).text,
  );
  assertStringIncludes(completed, "Recent completed tasks");
  assertStringIncludes(completed, "agent/completed");
  assertStringIncludes(completed, "**Proof:** Gate passed");
  assertStringIncludes(completed, "`agent/completed`");
  assertBounded(completed, size.columns);
});

Deno.test("Proof-first review renders stored Markdown and every review evidence class", () => {
  const proofLine =
    "> **Proof:** Gate passed for `agent/review-a1b2c3` at `abc1234` · View the full Proof: `discern status --verbose`";
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
  assertStringIncludes(plain, "**Proof:** Gate passed");
  assertStringIncludes(plain, "`agent/review-a1b2c3`");
  assertEquals(plain.includes("Proof line"), false);
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
