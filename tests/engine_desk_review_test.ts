/**
 * Desk reviews lead with consequences, and the package holds them to the
 * safe choice.
 *
 * The projection: every line names the fact it rests on; a landing says
 * whether it composes first, what it walks after itself, and who approves
 * it; blockers come from typed preview facts; removals say which landing
 * records they end; every reviewed action and command binds the facts its
 * registry declares, and a moved binding reads as a Changed banner.
 *
 * The sheets, on the real package: a review opens on its safe button or its
 * challenge field; Escape is the safe choice; letters never confirm; the
 * plan and command are one key or chord away from any focus; a challenge
 * must match exactly and Enter in it moves to the safe button; a changed or
 * gone subject disables confirm; a body taller than the sheet keeps confirm
 * disabled until every line has been on screen; and the sheets fit every
 * geometry the redesign names.
 */

import { assert, assertEquals, assertStringIncludes } from "@std/assert";
import {
  consequenceLines,
  DESK_ACTION_REGISTRY,
  DESK_ACTIONS,
  type DeskAction,
  type DeskActionMetadata,
  type DeskRow,
  deskRowId,
} from "../src/engine/desk/model.ts";
import {
  commandConsequenceLines,
  DESK_COMMAND_REGISTRY,
  type DeskCommandMetadata,
} from "../src/engine/desk/commands.ts";
import {
  DESK_REVIEW_FACTS,
  type DeskPlanFacts,
  type DeskReviewSource,
} from "../src/engine/desk/review_facts.ts";
import {
  type DeskReviewTarget,
  reviewDrift,
  reviewFor,
} from "../src/engine/desk/review.ts";
import {
  DESK_ACTION_FLOWS,
  DESK_COMMAND_FLOWS,
} from "../src/engine/desk/flows/registry.ts";
import type { DeskFlowContext } from "../src/engine/desk/flows/context.ts";
import { reviewSheet } from "../src/engine/desk/sheet_view.ts";
import type { DeskFlowStep } from "../src/engine/desk/flow_types.ts";
import type { DeskProductState } from "../src/engine/desk/desk_state.ts";
import { DESK_REFRESH_MS } from "../src/engine/desk/desk_state.ts";
import type {
  AcceptPreviewData,
  StatusFleetEntry,
} from "../src/shared/result_schemas.ts";
import type { DeskRuntime } from "../src/engine/desk/desk.ts";
import { taskFleetEntry } from "./status_fleet.ts";
import { observedDesk, productSurvey } from "./fixtures/desk_product.ts";
import {
  DESK_CONFIG,
  DESK_ROOT,
  type DeskSession,
  deskSession,
  type DeskSessionOptions,
  deskSurvey,
  deskTaskEntry,
  deskTranscript,
  scriptedDeskRuntime,
} from "./fixtures/desk_session.ts";
import { TEST_CLI_MODEL } from "./cli_model.ts";

/** A task that is ready to land, with a recorded head and Proof. */
function readyTask(
  id: string,
  patch: Partial<StatusFleetEntry> = {},
): StatusFleetEntry {
  return taskFleetEntry(id, {
    ahead: 4,
    behind: 0,
    clean: true,
    changed_files: 0,
    registration: {
      head: "3f9c2e1".padEnd(40, "0"),
      locked: false,
      prunable: false,
    },
    gate_proof: {
      status: "honored",
      head: "3f9c2e1".padEnd(40, "0"),
      recorded: "2026-07-11T11:40:00Z",
    },
    proof_honored: true,
    last_activity: "2026-07-11T11:40:00Z",
    ...patch,
  });
}

/** The row a product state lists for `id`. */
function rowOf(state: DeskProductState, id: string): DeskRow {
  const row = state.rows.find((candidate) => deskRowId(candidate) === id);
  assert(row !== undefined, `no row ${id}`);
  return row;
}

/** One action's review target for a row. */
function target(row: DeskRow, action: DeskAction): DeskReviewTarget {
  const offer = row.decision.actions.find((candidate) =>
    candidate.action === action
  );
  assert(offer !== undefined, action);
  return { kind: "action", row, offer, trunkHead: "b10e572".padEnd(40, "0") };
}

/** What a landing lands, in every review that lands one. */
const LANDS: NonNullable<DeskPlanFacts["lands"]> = {
  sha: "3f9c2e1".padEnd(40, "0"),
  commits: 4,
  files: 61,
  insertions: 2023,
  deletions: 2038,
};

/** Every preview fact present, so every declared line can show. */
const EVERY_FACT: DeskPlanFacts = {
  lands: LANDS,
  integrates: { behind: 361 },
  authority: { kind: "partial", covered: 3 },
  queueWalk: [{ title: "Search index", branch: "agent/search-index" }],
  landingInProgress: { title: "Docs glossary" },
  ignoredRoots: ["site/_site"],
  endsGrant: true,
  leavesQueue: true,
  removesProof: true,
  discards: ["1 commit not on main"],
  uncertain: ["cannot read how many commits are not on main"],
  revision: "3f9c2e1".padEnd(40, "0"),
  creates: {
    branch: "agent/tighten",
    base: "main",
    commit: "b10e572".padEnd(40, "0"),
    resources: 1,
  },
  script: { argv: ["discern", "scripts", "deploy"], where: "Alpha" },
  setupStep: "ensure",
};

/** Whether a line's source names something real. */
function sourceIsReal(
  source: DeskReviewSource,
  bucket: string,
  items: readonly { readonly when?: string }[],
): boolean {
  switch (source.kind) {
    case "registry":
      return source.bucket === bucket &&
        items[source.index] !== undefined &&
        items[source.index]?.when === undefined;
    case "plan":
      return EVERY_FACT[source.key] !== undefined &&
        Object.values(DESK_REVIEW_FACTS).some((fact) =>
          fact.source.kind === "plan" && fact.source.key === source.key
        );
    case "status":
      return Object.values(DESK_REVIEW_FACTS).some((fact) =>
        fact.source.kind === "status" && fact.source.field === source.field
      );
    case "result":
      return false;
  }
}

Deno.test("every consequence a registry declares resolves to a line that names its source", () => {
  const stale = observedDesk(productSurvey([
    readyTask("alpha", {
      contained_in: "agent/beta",
      resources: { database: "alpha-db" },
      landing_authority: { kind: "authorized", source: "effort-grant" },
      last_activity: "2026-06-30T12:00:00Z",
    }),
  ]));
  const row = rowOf(stale, "alpha");
  for (const action of DESK_ACTIONS) {
    const metadata: DeskActionMetadata = DESK_ACTION_REGISTRY[action];
    const lines = consequenceLines(action, {
      context: row.decision.context,
      plan: EVERY_FACT,
    });
    assert(lines.length > 0, `${action} says what it does`);
    for (const line of lines) {
      assert(
        sourceIsReal(line.source, action, metadata.consequence),
        `${action}: "${line.text}" rests on ${JSON.stringify(line.source)}`,
      );
    }
  }
  for (const command of Object.keys(DESK_COMMAND_REGISTRY)) {
    const metadata: DeskCommandMetadata =
      DESK_COMMAND_REGISTRY[command as keyof typeof DESK_COMMAND_REGISTRY];
    for (
      const line of commandConsequenceLines(
        command as keyof typeof DESK_COMMAND_REGISTRY,
        { version: "1.0.0", trunk: "main", plan: EVERY_FACT },
      )
    ) {
      assert(
        sourceIsReal(line.source, command, metadata.consequence),
        `${command}: "${line.text}" rests on ${JSON.stringify(line.source)}`,
      );
    }
  }
});

Deno.test("a review sheet's body is exactly its sourced lines, never fewer", () => {
  const state = observedDesk(productSurvey([readyTask("alpha")]));
  const row = rowOf(state, "alpha");
  const review = reviewFor(target(row, "accept"), { facts: EVERY_FACT });
  const step: DeskFlowStep = {
    kind: "action",
    action: "accept",
    taskId: "alpha",
    stage: "review",
  };
  const sheet = reviewSheet(state, {
    kind: "review",
    step,
    load: { state: "ready", value: review },
  });
  const marks = sheet.body.flatMap((block) =>
    block.kind === "marks" ? block.items : []
  );
  assertEquals(sheet.body.length, 1, "one block of marked lines");
  assertEquals(
    marks.map((item) => item.runs[0]?.text),
    review.lines.map((line) => line.text),
  );
});

Deno.test("Land says whether it composes first, what it walks after itself, and who approves it", () => {
  const state = observedDesk(productSurvey([readyTask("alpha")]));
  const row = rowOf(state, "alpha");
  const integrating = reviewFor(target(row, "accept"), {
    facts: {
      lands: LANDS,
      integrates: { behind: 361 },
      authority: { kind: "partial", covered: 3 },
      queueWalk: [{ title: "Search index", branch: "agent/search-index" }],
    },
  });
  const said = (text: string): DeskReviewSource | undefined =>
    integrating.lines.find((line) => line.text === text)?.source;
  assertEquals(
    said(
      "main has 361 new commits. Landing first combines them in a separate copy and reruns every check",
    ),
    { kind: "plan", key: "integrates" },
  );
  assertEquals(
    said(
      "If they conflict or a check fails, nothing lands and the task stays as it is",
    ),
    { kind: "plan", key: "integrates" },
  );
  assertEquals(
    said(
      "Your standing approval covers 3 paths; choosing Land approves the rest",
    ),
    { kind: "plan", key: "authority" },
  );
  assertEquals(
    said("Then Search index lands too: queued and pre-authorized"),
    { kind: "plan", key: "queueWalk" },
  );
  assertEquals(
    integrating.lines.find((line) =>
      line.source.kind === "plan" &&
      line.source.key === "lands"
    )?.diff,
    { insertions: 2023, deletions: 2038 },
  );
  assertEquals(integrating.lines[0]?.mark, "evidence");
  assertStringIncludes(integrating.lines[0]?.text ?? "", "(3f9c2e1)");
  assertEquals(integrating.disclosures.changes?.files, 61);

  const direct = reviewFor(target(row, "accept"), {
    facts: {
      lands: LANDS,
      authority: { kind: "pre-authorized" },
    },
  });
  const words = direct.lines.map((line) => line.text);
  assert(words.includes("main hasn't moved, so it lands directly"));
  assert(words.includes("Covered by your pre-authorization"));
  assert(!words.some((text) => text.startsWith("If they conflict")));
  assertEquals(direct.blockers, []);
  assertEquals(direct.confirm?.kind, "apply");
});

Deno.test("a stale task's landing leads with how long it sat idle", () => {
  const state = observedDesk(productSurvey([
    readyTask("stale", { last_activity: "2026-06-30T12:00:00Z" }),
  ]));
  const review = reviewFor(target(rowOf(state, "stale"), "accept"), {
    facts: { lands: LANDS, integrates: { behind: 361 } },
  });
  assertEquals(review.lines[0], {
    mark: "warning",
    text: "No activity for 11 days",
    source: { kind: "status", field: "last_activity" },
  });
});

Deno.test("blockers come from the preview's typed facts and keep the exact hand-off one key away", () => {
  const state = observedDesk(productSurvey([readyTask("alpha")]));
  const row = rowOf(state, "alpha");
  const exception = reviewFor(target(row, "accept"), {
    facts: {
      lands: LANDS,
      exception: { variances: ["exactness"], standardApprovals: 0 },
    },
  });
  assertEquals(exception.blockers.length, 1);
  assertStringIncludes(exception.blockers[0] ?? "", "Run in a terminal");
  assertStringIncludes(
    exception.blockers[0] ?? "",
    exception.disclosures.command,
  );
  assertEquals(exception.disclosures.open, "command");
  assertStringIncludes(exception.disclosures.command, "--confirmed");

  const stale = reviewFor(target(row, "accept"), {
    facts: { lands: LANDS, staleDeclarations: ["map-drift"] },
  });
  assertStringIncludes(stale.blockers[0] ?? "", "map-drift");
});

Deno.test("removals say which landing records they end, from the plan", () => {
  const state = observedDesk(productSurvey([
    readyTask("alpha", { contained_in: "agent/beta" }),
  ]));
  const row = rowOf(state, "alpha");
  for (const action of ["park", "reclaim", "drop"] as const) {
    const ends = reviewFor(target(row, action), {
      facts: { endsGrant: true, leavesQueue: true },
    });
    for (
      const [text, key] of [
        ["Ends its pre-authorization", "endsGrant"],
        ["Leaves the landing queue", "leavesQueue"],
      ] as const
    ) {
      assertEquals(
        ends.lines.find((line) => line.text === text)?.source,
        { kind: "plan", key },
        `${action}: ${text}`,
      );
    }
    const none = reviewFor(target(row, action), {
      facts: { endsGrant: false, leavesQueue: false },
    });
    assert(
      !none.lines.some((line) => line.text.startsWith("Ends its")),
      `${action} without a grant ends none`,
    );
  }
  const drop = reviewFor(target(row, "drop"), {
    facts: { discards: ["1 commit not on main"] },
    challenge: row.entry.branch,
  });
  assertEquals(drop.lines[0], {
    mark: "discards",
    text: "Discards 1 commit not on main",
    source: { kind: "plan", key: "discards" },
  });
  assertEquals(drop.challenge, { mustEqual: row.entry.branch });
  assertEquals(drop.destructive, true);
});

Deno.test("a moved binding reads as what changed, and nothing else does", () => {
  const before = observedDesk(productSurvey([readyTask("alpha")]));
  const row = rowOf(before, "alpha");
  const review = reviewFor(target(row, "accept"), { facts: {} });
  const trunkHead = "b10e572".padEnd(40, "0");
  assertEquals(reviewDrift(review.expected, { row, trunkHead }), undefined);
  const committed = rowOf(
    observedDesk(productSurvey([
      readyTask("alpha", {
        registration: {
          head: "4a5b6c7".padEnd(40, "0"),
          locked: false,
          prunable: false,
        },
      }),
    ])),
    "alpha",
  );
  assertEquals(
    reviewDrift(review.expected, { row: committed, trunkHead }),
    "a new commit",
  );
  assertEquals(
    reviewDrift(review.expected, { row, trunkHead: "c".repeat(40) }),
    "main moved",
  );
});

/** A runtime whose previews return rich subjects for every reviewed flow. */
function previewRuntime(row: DeskRow): Partial<DeskRuntime> {
  const head = row.entry.registration?.head ?? "a".repeat(40);
  return {
    acceptPlan: () => ({
      ok: true,
      verb: "accept",
      dry_run: true,
      plan: { title: "Acceptance plan", details: [], steps: [] },
      data: {
        revision: {
          path: row.entry.path,
          branch: row.entry.branch,
          head,
          proof: { candidate_id: "candidate", proof_id: "proof" },
        },
        preview: acceptPreview(head),
      },
    }),
    donePlan: () => ({
      ok: true,
      verb: "done",
      dry_run: true,
      plan: { title: "Final checks plan", details: [], steps: [] },
    }),
    dropPlan: () => ({
      title: "Drop plan",
      details: [],
      steps: [],
      subject: {
        targetPath: row.entry.path,
        id: deskRowId(row),
        branch: row.entry.branch,
        deleteBranch: true,
        preserveHead: true,
        blockers: ["4 commits not on main"],
        entries: [],
        head,
        endsGrant: false,
        leavesQueue: false,
      },
    }),
  };
}

/** A complete landing preview. */
function acceptPreview(head: string): AcceptPreviewData {
  return {
    lands: { head, commits: 4, files: 61, insertions: 2023, deletions: 2038 },
    authority: {
      kind: "conversation-required",
      covered_paths: 0,
      uncovered_paths: 61,
    },
    queue_walk: [],
    ends_grant: false,
    leaves_queue: false,
  };
}

Deno.test("every action and command that asks before it acts has exactly one reviewed flow", () => {
  for (const action of DESK_ACTIONS) {
    const metadata: DeskActionMetadata = DESK_ACTION_REGISTRY[action];
    const asks = metadata.confirmation.kind !== "none";
    assertEquals(
      DESK_ACTION_FLOWS[action] !== undefined,
      // Open agent asks nothing, but shows a stored brief to copy first.
      asks || action === "agent",
      `${action}: a confirmation needs a flow, and a flow a confirmation`,
    );
  }
  for (
    const command of Object.keys(DESK_COMMAND_REGISTRY) as (
      keyof typeof DESK_COMMAND_REGISTRY
    )[]
  ) {
    const metadata: DeskCommandMetadata = DESK_COMMAND_REGISTRY[command];
    assertEquals(
      DESK_COMMAND_FLOWS[command] !== undefined,
      metadata.confirmation.kind !== "none",
      `${command}: a confirmation needs a flow, and a flow a confirmation`,
    );
  }
});

Deno.test("every reviewed action and command binds every fact its registry declares", async () => {
  const data = productSurvey([
    readyTask("alpha", {
      setup: {
        state: "incomplete",
        marker: "missing",
        repair: {
          kind: "retry",
          command: "discern worktree setup",
          reason: "The ready marker is missing.",
        },
      },
    }),
  ], { unlanded_branches: ["agent/parked"] });
  const state = observedDesk(data);
  const row = rowOf(state, "alpha");
  const runtime = scriptedDeskRuntime(deskTranscript(), previewRuntime(row));
  const context: DeskFlowContext = {
    root: DESK_ROOT,
    config: DESK_CONFIG,
    runtime,
    cliModel: TEST_CLI_MODEL,
    state: {
      ...state,
      rows: state.rows.map((candidate) => ({
        ...candidate,
        scripts: [{ name: "deploy", path: "/worktrees/alpha/deploy" }],
      })),
    },
  };
  const values = {
    title: "A different title",
    script: "deploy",
    args: "",
    launch: "claude_code:open",
  };
  for (const [action, flow] of Object.entries(DESK_ACTION_FLOWS)) {
    const registered: DeskActionMetadata =
      DESK_ACTION_REGISTRY[action as DeskAction];
    const offer = row.decision.actions.find((candidate) =>
      candidate.action === action
    );
    if (offer?.availability !== "enabled" || flow === undefined) continue;
    const review = await flow.review(context, {
      kind: "action",
      action: action as DeskAction,
      taskId: "alpha",
      stage: action === "agent" ? "brief" : "review",
      values,
    });
    for (const fact of registered.binding) {
      assert(
        review.expected.facts[fact] !== undefined,
        `${action} binds ${fact}`,
      );
    }
  }
  for (const [command, flow] of Object.entries(DESK_COMMAND_FLOWS)) {
    if (flow === undefined) continue;
    const registered: DeskCommandMetadata =
      DESK_COMMAND_REGISTRY[command as keyof typeof DESK_COMMAND_REGISTRY];
    const review = await flow.review(context, {
      kind: "command",
      command: command as keyof typeof DESK_COMMAND_REGISTRY,
      stage: "review",
      ref: "agent/parked",
      values,
    });
    for (const fact of registered.binding) {
      assert(
        review.expected.facts[fact] !== undefined,
        `${command} binds ${fact}`,
      );
    }
  }
});

/** Run one Desk session over a ready task, quitting once `body` finishes. */
async function withReview(
  options: DeskSessionOptions,
  body: (desk: DeskSession) => Promise<void>,
): Promise<void> {
  const desk = await deskSession(options);
  try {
    await body(desk);
  } catch (error) {
    desk.io.close();
    await desk.exit.catch(() => undefined);
    throw error;
  }
  assertEquals(await desk.quit(), 0);
}

/** A ready task the session lands, at its own head. */
function landable(
  head = "3f9c2e1".padEnd(40, "0"),
): StatusFleetEntry {
  return deskTaskEntry("agent/alpha", "/worktrees/alpha", {
    id: "alpha",
    ahead: 4,
    behind: 0,
    clean: true,
    registration: { head, locked: false, prunable: false },
    gate_proof: { status: "honored", head, recorded: "2026-07-11T11:40:00Z" },
    proof_honored: true,
  });
}

/** A Land review's session seams: its preview, and the landings it ran. */
function landing(
  landed: unknown[],
  preview: Partial<AcceptPreviewData> = {},
): Partial<DeskRuntime> {
  const head = "3f9c2e1".padEnd(40, "0");
  return {
    acceptPlan: () => ({
      ok: true,
      verb: "accept",
      dry_run: true,
      plan: {
        title: "Acceptance plan",
        details: ["Branch: agent/alpha"],
        steps: [],
      },
      data: { preview: { ...acceptPreview(head), ...preview } },
    }),
    accept: (_ctx, options) => {
      landed.push(options);
    },
  };
}

const LAND = "review-accept-review";

Deno.test("a review opens on its safe choice; letters never confirm; Escape keeps", async () => {
  const landed: unknown[] = [];
  await withReview({
    cliModel: TEST_CLI_MODEL,
    runtime: {
      status: () => ({ ok: true, data: deskSurvey([landable()]) }),
      ...landing(landed),
    },
  }, async (desk) => {
    await desk.select("alpha");
    await desk.press("l");
    await desk.opened(LAND);
    await desk.settleForm();
    const layer = () => desk.state().layers[LAND];
    assertEquals(layer()?.focusedControlId, "button:safe");
    for (const key of ["l", "y", "a", "q", "enter"]) {
      if (key === "enter") break;
      await desk.press(key);
    }
    assertEquals(desk.top(), LAND, "letters never confirm or close");
    assertEquals(landed, []);
    for (
      const [key, id] of [["d", "plan"], ["c", "command"], ["v", "changes"]]
    ) {
      await desk.press(key ?? "");
      assert(layer()?.open.includes(id ?? "") === true, `${key} opens ${id}`);
    }
    await desk.shows("Branch: agent/alpha");
    await desk.escape(() => desk.top() === undefined, "Escape keeps");
    assertEquals(landed, []);
  });
});

Deno.test("a challenge must match exactly; Enter in it moves to the safe choice; chords reach the plan", async () => {
  const drops: Array<{ force?: boolean }> = [];
  const entry = deskTaskEntry("agent/abandoned", "/worktrees/abandoned", {
    id: "abandoned",
    ahead: 1,
    clean: true,
  });
  await withReview({
    runtime: {
      status: () => ({ ok: true, data: deskSurvey([entry]) }),
      dropPlan: () => ({
        title: "Drop plan",
        details: ["Revision: abc"],
        steps: [],
        subject: {
          targetPath: entry.path,
          id: "abandoned",
          branch: entry.branch,
          deleteBranch: true,
          preserveHead: true,
          blockers: ["1 commit not on main"],
          entries: [],
          head: "a".repeat(40),
          endsGrant: false,
          leavesQueue: false,
        },
      }),
      drop: (_ctx, _target, options) => {
        drops.push(options.force === undefined ? {} : { force: options.force });
      },
    },
  }, async (desk) => {
    const id = "review-drop-review";
    await desk.select("abandoned");
    await desk.press("D");
    await desk.opened(id);
    const layer = () => desk.state().layers[id];
    assertEquals(layer()?.focusedControlId, "field:challenge");
    // Letters type into the field; they toggle nothing and confirm nothing.
    await desk.type("agent/abandone");
    assertEquals(layer()?.open, []);
    await desk.press("ctrl-t");
    assert(layer()?.open.includes("plan") === true, "^T opens the plan");
    await desk.press("ctrl-x");
    assert(layer()?.open.includes("command") === true, "^X the command");
    assertEquals(layer()?.focusedControlId, "field:challenge");
    // One character short: Drop stays disabled.
    await desk.press("enter");
    assertEquals(layer()?.focusedControlId, "button:safe");
    await desk.confirm();
    assertEquals(drops, [], "an inexact challenge drops nothing");
    await desk.press("shift-tab");
    while (layer()?.focusedControlId !== "field:challenge") {
      await desk.press("shift-tab");
    }
    await desk.type("d");
    await desk.confirm();
    await desk.until(() => drops.length === 1, "the drop");
  });
  assertEquals(drops, [{ force: true }]);
});

Deno.test("a changed subject disables confirm until r reads it again", async () => {
  const landed: unknown[] = [];
  let head = "3f9c2e1".padEnd(40, "0");
  let previews = 0;
  const seams = landing(landed);
  await withReview({
    cliModel: TEST_CLI_MODEL,
    runtime: {
      status: () => ({ ok: true, data: deskSurvey([landable(head)]) }),
      ...seams,
      acceptPlan: (ctx) => {
        previews += 1;
        const plan = seams.acceptPlan;
        assert(plan !== undefined);
        return plan(ctx);
      },
    },
  }, async (desk) => {
    await desk.select("alpha");
    await desk.press("l");
    await desk.opened(LAND);
    await desk.settleForm();
    head = "4a5b6c7".padEnd(40, "0");
    desk.advance(DESK_REFRESH_MS);
    await desk.shows("Changed since you opened this: a new commit");
    await desk.shows("r Review again");
    await desk.confirm();
    assertEquals(landed, [], "a changed review confirms nothing");
    const before = previews;
    await desk.press("r");
    await desk.until(() => previews === before + 1, "the review read again");
    await desk.settleForm();
    assert(!desk.screen().includes("Changed since you opened this"));
    await desk.confirm();
    await desk.until(() => landed.length === 1, "the landing");
  });
});

Deno.test("a body taller than the sheet keeps confirm disabled until it has been read", async () => {
  const landed: unknown[] = [];
  await withReview({
    columns: 80,
    rows: 13,
    cliModel: TEST_CLI_MODEL,
    runtime: {
      status: () => ({ ok: true, data: deskSurvey([landable()]) }),
      ...landing(landed, {
        integrates: { behind: 361 },
        queue_walk: [{
          effort: "search",
          branch: "agent/search",
          head: "b".repeat(40),
        }],
        ignored_roots: ["site/_site", "build", "dist"],
      }),
    },
  }, async (desk) => {
    await desk.select("alpha");
    await desk.press("l");
    await desk.opened(LAND);
    await desk.settleForm();
    assertEquals(desk.state().fullyRead[LAND], false);
    await desk.confirm();
    assertEquals(landed, [], "an unread body confirms nothing");
    for (let page = 0; page < 12 && !desk.state().fullyRead[LAND]; page += 1) {
      await desk.press("page-down");
    }
    assertEquals(desk.state().fullyRead[LAND], true);
    await desk.confirm();
    await desk.until(() => landed.length === 1, "the landing");
  });
});

Deno.test("review sheets open on their safe choice at every geometry the redesign names", async () => {
  for (
    const [columns, rows] of [
      [80, 24],
      [132, 40],
      [80, 48],
      [40, 24],
      [80, 13],
    ] as const
  ) {
    await withReview({
      columns,
      rows,
      cliModel: TEST_CLI_MODEL,
      runtime: {
        status: () => ({ ok: true, data: deskSurvey([landable()]) }),
        ...landing([]),
      },
    }, async (desk) => {
      await desk.select("alpha");
      await desk.press("l");
      await desk.opened(LAND);
      await desk.settleForm();
      assertEquals(
        desk.state().layers[LAND]?.focusedControlId,
        "button:safe",
        `${columns}x${rows}`,
      );
      const screen = desk.screen();
      assertStringIncludes(screen, "Land Alpha", `${columns}x${rows}`);
      for (const line of screen.split("\n")) {
        assert([...line].length <= columns, `${columns}x${rows}: ${line}`);
      }
      await desk.escape(() => desk.top() === undefined, "Escape keeps");
    });
  }
});
