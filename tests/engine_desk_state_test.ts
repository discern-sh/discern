/**
 * The Desk's product state machine, driven event by event without a
 * terminal: one survey at a time with a single queued follow-up, Retrying
 * then Offline, layers that only the owner opens and closes, the messages
 * a moved or vanished selection leaves, and what a returning child or effect
 * leaves behind.
 */

import { assert, assertEquals, assertStringIncludes } from "@std/assert";
import {
  APPLICATION_LAYER_DEPTH,
  terminalApplicationReservedKeys,
} from "discern-design-system/cli/interactive";
import {
  DESK_FORM_PREVIEW_MS,
  DESK_OFFLINE_FAILURES,
  DESK_REFRESH_MS,
  type DeskEffect,
  type DeskEvent,
  type DeskIntent,
  type DeskLayer,
  deskProduct,
  type DeskProductState,
  type DeskTransition,
  initialDeskProduct,
  layerId,
} from "../src/engine/desk/desk_state.ts";
import {
  DESK_LAYER_DEPTH,
  DESK_MESSAGE_TOPICS,
  deskMessageId,
  deskMessageTopic,
  formValuesKey,
  open,
  parkedRowId,
} from "../src/engine/desk/desk_transitions.ts";
import { deskLayers } from "../src/engine/desk/layer_view.ts";
import { deskView } from "../src/engine/desk/inbox_view.ts";
import { PACKAGE_RESERVED_KEYS } from "../src/engine/desk/keys.ts";
import { DESK_GLYPHS } from "../src/engine/desk/glyphs.ts";
import { TERMINAL_GLYPHS } from "discern-design-system/cli";
import { type DeskAgentLaunch, deskRowId } from "../src/engine/desk/model.ts";
import type { DeskPreferences } from "../src/engine/desk/preferences.ts";
import { FLEET_ROW_DECISIONS } from "../src/shared/fleet_row_vocabulary.ts";
import { FLEET_ROW_GROUP_TITLES } from "../src/engine/status/row_states.ts";
import type {
  StatusData,
  StatusFleetEntry,
} from "../src/shared/result_schemas.ts";
import { taskFleetEntry } from "./status_fleet.ts";
import {
  deskIntent,
  editingTask,
  failDesk,
  formRead,
  observedDesk,
  observeDesk,
  PRODUCT_NOW,
  PRODUCT_UI,
  PRODUCT_VIEW_ENV,
  productSurvey,
  readyReview,
} from "./fixtures/desk_product.ts";

const NOW = PRODUCT_NOW;
const UI = PRODUCT_UI;
const ENV = PRODUCT_VIEW_ENV;
const survey = productSurvey;
const editing = editingTask;
const observe = observeDesk;
const fail = failDesk;
const intent = deskIntent;

/** Apply events in order, collecting every effect. */
function run(
  state: DeskProductState,
  ...events: readonly DeskEvent[]
): DeskTransition {
  const effects: DeskEffect[] = [];
  for (const event of events) {
    const transition = deskProduct(state, event);
    state = transition.state;
    effects.push(...transition.effects);
  }
  return { state, effects };
}

/** The ids of the layers that exist, bottom to top. */
function layerIds(state: DeskProductState): string[] {
  return state.layers.map((layer) => layerId(layer));
}

/** A deterministic pseudo-random sequence. */
function seeded(seed: number): () => number {
  let value = seed >>> 0;
  return () => {
    value = (value + 0x6d2b79f5) >>> 0;
    let mixed = Math.imul(value ^ (value >>> 15), 1 | value);
    mixed ^= mixed + Math.imul(mixed ^ (mixed >>> 7), 61 | mixed);
    return ((mixed ^ (mixed >>> 14)) >>> 0) / 4_294_967_296;
  };
}

Deno.test("one survey runs at a time and a refresh during one queues exactly one follow-up", () => {
  const initial = initialDeskProduct({
    trunk: "main",
    preferences: { schema_version: 2 },
  });
  const first = deskProduct(initial, { kind: "refresh" });
  assertEquals(first.effects, [{ kind: "survey", generation: 1 }]);
  const queued = run(
    first.state,
    { kind: "refresh" },
    { kind: "refresh" },
    { kind: "refresh" },
  );
  assertEquals(queued.effects, [], "a running survey starts no other");
  assert(queued.state.survey.followUp);

  const stale = deskProduct(queued.state, {
    kind: "observed",
    generation: 0,
    now: NOW,
    data: survey([editing("alpha")]),
    hints: [],
    exceptionArgvs: new Map(),
  });
  assertEquals(stale.state, queued.state, "an obsolete survey is ignored");

  const adopted = observe(queued.state, survey([editing("alpha")]));
  assertEquals(adopted.effects, [{ kind: "survey", generation: 2 }]);
  assertEquals(adopted.state.rows.length, 1);
  const settled = observe(adopted.state, survey([editing("alpha")]));
  assertEquals(settled.effects, [{
    kind: "schedule-survey",
    afterMs: DESK_REFRESH_MS,
  }]);
  assertEquals(settled.state.survey.followUp, false);
});

Deno.test("every message's id names its topic, which a state report reader recovers", () => {
  for (const topic of DESK_MESSAGE_TOPICS) {
    assertEquals(deskMessageTopic(deskMessageId(topic, 12)), topic);
  }
  assertEquals(deskMessageTopic("operation-3"), undefined);
  assertEquals(deskMessageTopic(undefined), undefined);
  const tipped = deskProduct(observedDesk(survey([editing("alpha")])), {
    kind: "tip",
    tip: "Press `?` for keys",
  }).state.message;
  assertEquals(deskMessageTopic(tipped?.id), "tip");
  assertEquals(tipped?.topic, "tip");
});

Deno.test("a failed survey retries once before the Desk says it is offline", () => {
  const live = observedDesk(survey([editing("alpha")]));
  const header = (state: DeskProductState): string =>
    JSON.stringify(deskView(state, UI, ENV).header);

  const once = fail(live, NOW + 60_000);
  assertEquals(once.state.survey.failures, 1);
  assertEquals(once.state.warning, undefined, "one failure only retries");
  assertStringIncludes(header(once.state), "retrying");
  assertEquals(once.effects, [{
    kind: "schedule-survey",
    afterMs: DESK_REFRESH_MS,
  }]);
  assertEquals(once.state.rows.length, 1, "the last good rows stay");

  const offline = fail(once.state, NOW + 120_000);
  assertEquals(offline.state.survey.failures, DESK_OFFLINE_FAILURES);
  assertStringIncludes(header(offline.state), "stale");
  const warning = offline.state.warning;
  assert(warning !== undefined);
  assertEquals(deskMessageTopic(warning.id), "offline");
  assertEquals(warning.persistent, true);
  assertEquals(warning.key, { key: "r", label: "Retry" });
  assertStringIncludes(warning.text, "showing what was seen 2m ago");
  // An outage that starts seconds after the last survey names its seconds.
  const quick = fail(
    fail(live, NOW + 5_000).state,
    NOW + 12_000,
  ).state.warning;
  assertStringIncludes(quick?.text ?? "", "showing what was seen 12s ago");
  const again = fail(offline.state, NOW + 180_000);
  assertEquals(again.state.warning?.id, warning.id, "one warning, kept");

  const closed = deskProduct(again.state, {
    kind: "dismissed",
    target: { message: warning.id },
  });
  assertEquals(closed.state.warning, undefined);
  assertEquals(
    fail(closed.state).state.warning,
    undefined,
    "a closed offline warning stays closed while the outage lasts",
  );
  const back = observe(fail(closed.state).state, survey([editing("alpha")]));
  assertEquals(back.state.warning, undefined);
  assertEquals(back.state.offlineDismissed, undefined);
  assertEquals(back.state.survey.failures, 0);

  const never = fail(
    deskProduct(
      initialDeskProduct({ trunk: "main", preferences: { schema_version: 2 } }),
      { kind: "refresh" },
    ).state,
  );
  assertEquals(fail(never.state).state.warning?.text, "Couldn't read tasks");
});

Deno.test("observations never open or close a layer the owner did not", () => {
  const pool = ["alpha", "beta", "gamma", "delta", "epsilon"];
  for (let seed = 1; seed <= 40; seed += 1) {
    const random = seeded(seed);
    const fleet = (): StatusFleetEntry[] =>
      pool.filter(() => random() < 0.6).map((id) =>
        editing(id, 1 + Math.floor(random() * 4))
      );
    const parked = (): Partial<StatusData> =>
      random() < 0.5 ? { unlanded_branches: ["agent/spike"] } : {};
    let state = observedDesk(survey(pool.map((id) => editing(id)), {
      unlanded_branches: ["agent/spike"],
    }));
    const openers: readonly DeskIntent[] = [
      { kind: "key", key: "." },
      { kind: "command", command: "keys" },
      { kind: "command", command: "activity" },
      { kind: "action", action: "inspect", id: pool[0] ?? "" },
      { kind: "action", action: "rename", id: pool[1] ?? "" },
      { kind: "command", command: "new_task" },
      { kind: "command", command: "branch_commits", ref: "agent/spike" },
    ];
    const opener = openers[Math.floor(random() * openers.length)];
    assert(opener !== undefined);
    state = intent(state, opener, { ...UI, selected: pool[2] ?? "" }).state;
    const opened = layerIds(state);
    assert(opened.length > 0, `seed ${seed}: ${JSON.stringify(opener)}`);
    for (let step = 0; step < 12; step += 1) {
      state = random() < 0.8
        ? observe(state, survey(fleet(), parked())).state
        : fail(state).state;
      assertEquals(layerIds(state), opened, `seed ${seed} step ${step}`);
      assertEquals(
        deskLayers(state, ENV).map((layer) => layer.id),
        opened,
        `seed ${seed} step ${step}: the view draws every layer`,
      );
    }
  }
});

Deno.test("a layer whose subject leaves says so and offers nothing", () => {
  const listed = observedDesk(survey([editing("alpha"), editing("beta")]));
  const menu = intent(listed, { kind: "key", key: "." }, {
    ...UI,
    selected: "alpha",
  }).state;
  const review = open(menu, {
    kind: "review",
    step: { kind: "action", action: "park", taskId: "alpha", stage: "review" },
    load: { state: "loading" },
  }).state;
  const gone = observe(
    review,
    survey([editing("beta")], {
      parked_tasks: [{
        id: "alpha",
        branch: "agent/alpha",
        head: "a".repeat(40),
        parked_at: "2026-07-11T12:00:00.000Z",
        task: {
          id: "alpha",
          branch: "agent/alpha",
          title: "Alpha",
          title_source: "recorded",
        },
      }],
    }),
  ).state;
  const [sheet] = deskLayers(gone, ENV);
  assert(sheet?.kind === "sheet");
  assertEquals(sheet.state, "gone");
  assertStringIncludes(
    JSON.stringify(sheet.banner),
    "Alpha is gone: it was parked; its branch is kept",
  );
  assertEquals(
    sheet.buttons.find((button) => button.role === "safe")?.label,
    "Close",
  );

  const actions = observe(menu, survey([editing("beta")])).state;
  const [gonemenu] = deskLayers(actions, ENV);
  assert(gonemenu?.kind === "menu");
  assertEquals(gonemenu.sections, []);
  assertEquals(
    gonemenu.unavailable?.items.map((item) => item.sentence),
    ["Alpha is gone: it is no longer listed"],
  );
});

Deno.test("a review takes only the read its own opening started", () => {
  const listed = observedDesk(survey([editing("alpha"), editing("beta")]));
  const step = (taskId: string) => ({
    kind: "action" as const,
    action: "park" as const,
    taskId,
    stage: "review" as const,
  });
  const id = "review-park-review";
  const alphaOpened = open(listed, {
    kind: "review",
    step: step("alpha"),
    load: { state: "loading" },
  });
  const alphaRead = alphaOpened.effects[0];
  assert(alphaRead?.kind === "prepare");
  // The owner closes Alpha's sheet and opens Beta's under the same id.
  const closed = deskProduct(alphaOpened.state, {
    kind: "dismissed",
    target: { layer: id },
  }).state;
  const betaOpened = open(closed, {
    kind: "review",
    step: step("beta"),
    load: { state: "loading" },
  });
  const betaRead = betaOpened.effects[0];
  assert(betaRead?.kind === "prepare");
  assert(betaRead.read !== alphaRead.read, "each opening numbers its read");
  // Alpha's read finishes late: Beta's sheet keeps waiting for its own.
  const late = deskProduct(betaOpened.state, {
    kind: "prepared",
    layerId: id,
    read: alphaRead.read,
    result: {
      state: "ready",
      value: readyReview("Park Alpha?", {
        subject: {
          id: "alpha",
          title: "Alpha",
          branch: "agent/alpha",
          path: "/worktrees/alpha",
        },
      }),
    },
  }).state;
  const waiting = late.layers[0];
  assert(waiting?.kind === "review");
  assertEquals(waiting.load.state, "loading", "Alpha's read is set aside");
  assertEquals(
    intent(late, { kind: "confirm", layer: id }).effects,
    [],
    "nothing confirms on a sheet still reading",
  );
  // Even a review read for another task never applies to this one.
  const crossed = {
    ...late,
    layers: [{
      kind: "review" as const,
      step: step("beta"),
      load: {
        state: "ready" as const,
        value: readyReview("Park Alpha?", {
          subject: {
            id: "alpha",
            title: "Alpha",
            branch: "agent/alpha",
            path: "/worktrees/alpha",
          },
        }),
      },
    }],
  };
  assertEquals(intent(crossed, { kind: "confirm", layer: id }).effects, []);
  const own = deskProduct(late, {
    kind: "prepared",
    layerId: id,
    read: betaRead.read,
    result: { state: "ready", value: readyReview("Park Beta?") },
  }).state.layers[0];
  assert(own?.kind === "review");
  assertEquals(own.load.state, "ready", "Beta's own read fills its sheet");
});

Deno.test("the package reports a moved or vanished selection and the Desk names it once", () => {
  const before = observedDesk(survey([editing("alpha"), editing("beta")]));
  const regrouped = deskProduct(before, {
    kind: "selection-moved",
    itemId: "alpha",
    move: { kind: "regrouped", from: "working", to: "attention" },
  });
  assertEquals(
    regrouped.state.message?.text,
    "Alpha moved to Needs attention: editing",
  );

  const landed = observe(
    before,
    survey([editing("beta")], {
      recent_completed_tasks: [{
        branch: "agent/alpha",
        head: "b".repeat(40),
        completed_at: "2026-07-11T12:00:00.000Z",
      }],
    }),
  ).state;
  const named = deskProduct(landed, {
    kind: "selection-moved",
    itemId: "alpha",
    move: { kind: "removed", replacement: "beta" },
  });
  assertEquals(named.state.message?.text, "Alpha landed on main");
  assertEquals(named.state.message?.tone, "muted");

  const unknown = deskProduct(before, {
    kind: "selection-moved",
    itemId: "nobody",
    move: { kind: "removed" },
  });
  assertEquals(unknown.state.message, undefined);
});

Deno.test("launcher layers close when their child starts; readers and forms that lend the terminal survive", () => {
  const alpha = taskFleetEntry("alpha", {
    clean: false,
    changed_files: 1,
    last_activity: "2026-07-11T11:00:00Z",
  });
  const listed = observedDesk(survey([alpha]));
  const withAgents: DeskProductState = {
    ...listed,
    rows: listed.rows.map((row) => ({
      ...row,
      agentLaunches: ["one", "two"].map((name) => ({
        id: `claude:${name}`,
        kind: "open" as const,
        agent: "claude_code" as const,
        providerLabel: "Claude Code",
        label: name,
        binary: "claude",
        args: [],
        availability: "enabled" as const,
      })),
    })),
  };
  const picker = open(withAgents, { kind: "agents", taskId: "alpha" }).state;
  const launched = intent(picker, {
    kind: "launch",
    taskId: "alpha",
    launch: "claude:one",
  });
  assertEquals(layerIds(launched.state), []);
  assertEquals(launched.effects, [{
    kind: "child",
    child: { kind: "agent", taskId: "alpha", launch: "claude:one" },
  }]);

  const reader = open(listed, {
    kind: "reader",
    reader: { kind: "changes", taskId: "alpha", load: { state: "loading" } },
  }).state;
  const paged = intent(reader, {
    kind: "child",
    child: { kind: "diff", taskId: "alpha" },
  });
  assertEquals(layerIds(paged.state), ["reader-changes"]);
  assertEquals(paged.effects, [{
    kind: "child",
    child: { kind: "diff", taskId: "alpha" },
  }]);

  const updates = intent(listed, { kind: "command", command: "updates" });
  const ready = formRead(
    updates.state,
    "review-updates-review",
    readyReview("Check for updates?"),
  );
  const applied = intent(ready.state, {
    kind: "confirm",
    layer: "review-updates-review",
  });
  // The release page opens beside the screen; its reader waits for it.
  assertEquals(layerIds(applied.state), ["reader-opened"]);
  assertEquals(applied.effects.map((effect) => effect.kind), ["open"]);
  const page = applied.effects[0];
  assert(page?.kind === "open");
  const filled = deskProduct(applied.state, {
    kind: "opened",
    layerId: page.layerId,
    outcome: {
      command: "discern releases",
      ok: true,
      reading: "Release information for discern.",
    },
    now: NOW,
  });
  const release = filled.state.layers[0];
  assert(release?.kind === "reader" && release.reader.kind === "opened");
  assertEquals(release.reader.load, {
    state: "ready",
    value: { markdown: "Release information for discern." },
  });
  assertEquals(filled.state.activity.map((entry) => entry.command), [
    "discern releases",
  ]);
  assert(filled.effects.some((effect) => effect.kind === "survey"));
  const unread = deskProduct(applied.state, {
    kind: "opened",
    layerId: page.layerId,
    outcome: { command: "discern releases", ok: false },
    now: NOW,
  }).state.layers[0];
  assert(unread?.kind === "reader" && unread.reader.kind === "opened");
  assertEquals(unread.reader.load.state, "failed");

  const scripts = deskProduct(
    intent(listed, { kind: "command", command: "main_scripts" }).state,
    {
      kind: "scripts",
      result: {
        state: "ready",
        value: {
          directory: "/project",
          scripts: [{
            name: "deploy",
            path: "/project/discern/scripts/deploy",
            availability: "enabled",
          }],
        },
      },
    },
  ).state;
  const opened = intent(scripts, { kind: "script", name: "deploy" });
  assertEquals(layerIds(opened.state), ["form-main_scripts-review"]);
  assertEquals(opened.effects.map((effect) => effect.kind), ["prepare"]);
  const typed = deskProduct(opened.state, {
    kind: "field",
    layerId: "form-main_scripts-review",
    fieldId: "args",
    value: "--fast",
  });
  const waiting = typed.state.layers[0];
  assert(waiting?.kind === "form" && waiting.read !== undefined);
  assertEquals(typed.effects, [{
    kind: "prepare",
    layerId: "form-main_scripts-review",
    read: waiting.read,
    step: {
      kind: "command",
      command: "main_scripts",
      stage: "review",
      values: { script: "deploy", args: "--fast" },
    },
    debounceMs: DESK_FORM_PREVIEW_MS,
    readFor: formValuesKey({ args: "--fast" }),
  }]);
  // Confirm waits for the preview of the values on screen.
  const early = intent(typed.state, {
    kind: "confirm",
    layer: "form-main_scripts-review",
  });
  assertEquals(early.effects, []);
  const read = formRead(
    typed.state,
    "form-main_scripts-review",
    readyReview("Run deploy in the main checkout?"),
  ).state;
  const ran = intent(read, {
    kind: "confirm",
    layer: "form-main_scripts-review",
  });
  assertEquals(layerIds(ran.state), []);
  assertEquals(ran.effects.map((effect) => effect.kind), ["apply"]);
  const apply = ran.effects[0];
  assert(apply?.kind === "apply");
  assertEquals(apply.step.values, { script: "deploy", args: "--fast" });
});

Deno.test("a returning effect leaves its message, its result, and one refresh", () => {
  const listed = observedDesk(survey([editing("alpha", 2)]));
  const back = deskProduct(listed, {
    kind: "returned",
    now: NOW,
    outcome: {
      command: "/bin/sh",
      ok: true,
      back: { label: "the shell", taskId: "alpha", changedBefore: 2 },
    },
  });
  assertEquals(back.state.message?.text, "Back from the shell");
  assertEquals(back.state.activity.map((entry) => entry.command), ["/bin/sh"]);
  assertEquals(back.effects, [{ kind: "survey", generation: 2 }]);
  const counted = observe(back.state, survey([editing("alpha", 5)]));
  assertEquals(
    [counted.state.message?.text, counted.state.message?.detail],
    ["Back from the shell", "Alpha: 3 more files changed"],
  );
  assertEquals(counted.state.pendingReturn, undefined);
  // A child that changed nothing still names its task and the result.
  const unchanged = observe(back.state, survey([editing("alpha", 2)]));
  assertEquals(
    unchanged.state.message?.detail,
    "Alpha: no new changes",
  );

  const failed = deskProduct(listed, {
    kind: "returned",
    now: NOW,
    outcome: {
      command: "discern done",
      ok: false,
      message: { tone: "danger", text: "Checks failed" },
      result: {
        title: "Checks failed",
        tone: "danger",
        lines: [{
          mark: "failure",
          text: "test failed",
          source: { kind: "result", field: "message" },
        }],
        command: "discern done",
        output: "**test** failed",
      },
    },
  });
  // The result sheet is the failure's message; no toast repeats it.
  assertEquals(failed.state.message, undefined);
  assertEquals(layerIds(failed.state), ["result"]);
  assertEquals(failed.state.activity.at(-1)?.ok, false);

  const created = deskProduct(listed, {
    kind: "returned",
    now: NOW,
    outcome: { command: "discern start", ok: true, select: "/worktrees/beta" },
  });
  const listedCreated = observe(
    created.state,
    survey([editing("alpha"), editing("beta")]),
  );
  assert(
    listedCreated.effects.some((effect) =>
      effect.kind === "select" && effect.id === "beta"
    ),
    "the created checkout is selected once a survey lists it",
  );
});

Deno.test("Read the manual opens it once read and otherwise says why nothing opened", () => {
  const read = open(observedDesk(survey([])), { kind: "palette" });
  const manual: DeskIntent = { kind: "command", command: "manual" };
  const loading = intent(read.state, manual);
  assertEquals(loading.effects, []);
  assertEquals(loading.state.layers, []);
  assertStringIncludes(loading.state.message?.text ?? "", "still loading");
  const ready = run(read.state, {
    kind: "manual-read",
    result: { state: "ready" },
  });
  const opened = intent(ready.state, manual);
  assertEquals(opened.effects, [{ kind: "manual" }]);
  assertEquals(opened.state.layers, []);
  const failed = run(read.state, {
    kind: "manual-read",
    result: { state: "failed", error: "no bundled manual" },
  });
  const refused = intent(failed.state, manual);
  assertEquals(refused.effects, []);
  assertEquals(refused.state.message?.tone, "warning");
  assertStringIncludes(refused.state.message?.text ?? "", "discern docs");
});

Deno.test("Enter on a row with no next step it can run opens its actions, and the footer says so", () => {
  // Status can't tell whether this task's checks ran, so Run checks waits.
  const listed = observedDesk(survey([taskFleetEntry("alpha")]));
  const [row] = listed.rows;
  assert(row !== undefined);
  assertEquals(row.decision.next?.availability, "disabled");
  const ui = { ...UI, selected: "alpha" };
  const footer = deskView(listed, ui, ENV).footer;
  assertEquals(footer.left[0], { key: "enter", label: "Actions" });
  assert(
    !(footer.right ?? []).some((hint) => hint.key === "."),
    "Actions is named once",
  );
  const entered = intent(listed, { kind: "next", id: "alpha" }, ui);
  assertEquals(layerIds(entered.state), ["actions"]);
  // Every hint the footer leads with is Enter's.
  for (
    const data of [
      survey([editing("beta")]),
      survey([taskFleetEntry("gamma", { gate_proof: { status: "missing" } })]),
    ]
  ) {
    const state = observedDesk(data);
    const [first] = state.rows;
    assert(first !== undefined);
    assertEquals(
      deskView(state, { ...UI, selected: deskRowId(first) }, ENV).footer.left[0]
        ?.key,
      "enter",
    );
  }
});

Deno.test("an unavailable action answers with its reason and opens nothing", () => {
  const listed = observedDesk(survey([editing("alpha")]));
  const row = listed.rows[0];
  assert(row !== undefined);
  const disabled = row.decision.actions.find((offer) =>
    offer.availability === "disabled"
  );
  assert(disabled !== undefined, "an editing task has an unavailable action");
  const refused = intent(listed, {
    kind: "action",
    action: disabled.action,
    id: "alpha",
  });
  assertEquals(refused.state.layers, []);
  assertEquals(refused.effects, []);
  assertStringIncludes(refused.state.message?.text ?? "", "isn't available");
});

Deno.test("Enter on a parked branch resumes it and Enter from the palette selects first", () => {
  const listed = observedDesk(survey([], {
    unlanded_branches: ["agent/spike"],
  }));
  const id = parkedRowId("agent/spike");
  const resumed = intent(listed, { kind: "next", id }, {
    ...UI,
    topLayerId: "palette",
  });
  assertEquals(resumed.effects[0], { kind: "select", id });
  assertEquals(layerIds(resumed.state), ["form-resume-review"]);
});

Deno.test("toggles persist the preference they change and close the palette", () => {
  const palette = open(observedDesk(survey([editing("alpha")])), {
    kind: "palette",
  }).state;
  const cases = [
    { command: "sort", read: (p: DeskPreferences) => p.sort },
    { command: "details", read: (p: DeskPreferences) => p.details },
    { command: "mouse", read: (p: DeskPreferences) => p.mouse },
  ] as const;
  const seen: Record<string, unknown[]> = {};
  for (const { command, read } of cases) {
    let state = palette;
    for (let turn = 0; turn < 2; turn += 1) {
      const toggled = intent(state, { kind: "command", command });
      assertEquals(layerIds(toggled.state), []);
      assertEquals(toggled.effects, [{
        kind: "persist",
        preferences: toggled.state.preferences,
      }]);
      (seen[command] ??= []).push(read(toggled.state.preferences));
      state = toggled.state;
    }
  }
  assertEquals(seen, {
    sort: ["title", "decision"],
    details: ["hidden", "shown"],
    mouse: [true, false],
  });
});

Deno.test("routes to a group or Parked select what exists and name what doesn't", () => {
  const listed = observedDesk(survey([editing("alpha")]));
  const row = listed.rows[0];
  assert(row !== undefined);
  const groupKey = (group: (typeof FLEET_ROW_DECISIONS)[number]): string =>
    String(FLEET_ROW_DECISIONS.indexOf(group) + 1);
  const full = FLEET_ROW_DECISIONS.find((group) =>
    group === row.decision.group
  );
  assert(full !== undefined, "a live task sits in a decision group");
  assertEquals(
    intent(listed, { kind: "key", key: groupKey(full) }).effects,
    [{ kind: "select", id: "alpha" }],
  );
  const empty = FLEET_ROW_DECISIONS.find((group) =>
    group !== row.decision.group
  );
  assert(empty !== undefined);
  const missing = intent(listed, { kind: "key", key: groupKey(empty) });
  assertEquals(missing.effects, []);
  assertEquals(
    missing.state.message?.text,
    `Nothing in ${FLEET_ROW_GROUP_TITLES[empty]}`,
  );
  assertEquals(
    intent(listed, { kind: "key", key: "escape" }).state.message?.text,
    "q quits",
  );

  const palette = open(listed, { kind: "palette" }).state;
  const noParked = intent(palette, { kind: "command", command: "parked" });
  assertEquals(layerIds(noParked.state), []);
  assertEquals(noParked.state.message?.text, "Nothing in Parked");
  const parked = intent(
    observedDesk(survey([], { unlanded_branches: ["agent/spike"] })),
    { kind: "command", command: "parked" },
  );
  assertEquals(parked.effects, [{
    kind: "select",
    id: parkedRowId("agent/spike"),
  }]);
  assertEquals(
    intent(listed, { kind: "command", command: "quit" }).effects,
    [{ kind: "exit" }],
  );
});

Deno.test("a and Enter run the remembered agent's launch; the actions menu offers every launch", () => {
  const launches: DeskAgentLaunch[] = (["open", "continue"] as const).map((
    kind,
  ) => ({
    id: `claude_code:${kind}`,
    agent: "claude_code",
    providerLabel: "Claude Code",
    binary: "claude",
    kind,
    label: kind,
    args: kind === "continue" ? ["--continue"] : [],
    availability: "enabled",
  }));
  const discovered = (state: DeskProductState, taskId: string) =>
    deskProduct(state, {
      kind: "capabilities",
      taskId,
      capabilities: { scripts: [], agentLaunches: launches },
      now: NOW,
    }).state;
  const remembered = (state: DeskProductState): DeskProductState => ({
    ...state,
    preferences: { ...state.preferences, last_agent: "claude_code" },
  });
  const listed = remembered(
    discovered(
      discovered(
        observedDesk(
          survey([
            editing("alpha"),
            taskFleetEntry("fresh", { gate_proof: { status: "missing" } }),
          ]),
        ),
        "alpha",
      ),
      "fresh",
    ),
  );
  const ran = (state: DeskProductState, value: DeskIntent, selected: string) =>
    intent(state, value, { ...UI, selected }).effects;
  // Returning to a task with work picks up its last conversation.
  assertEquals(ran(listed, { kind: "key", key: "a" }, "alpha"), [{
    kind: "child",
    child: { kind: "agent", taskId: "alpha", launch: "claude_code:continue" },
  }]);
  assertEquals(ran(listed, { kind: "next", id: "alpha" }, "alpha"), [{
    kind: "child",
    child: { kind: "agent", taskId: "alpha", launch: "claude_code:continue" },
  }]);
  // An empty task has nothing to continue.
  assertEquals(ran(listed, { kind: "key", key: "a" }, "fresh"), [{
    kind: "child",
    child: { kind: "agent", taskId: "fresh", launch: "claude_code:open" },
  }]);
  const menu = intent(listed, {
    kind: "action",
    action: "agent",
    id: "alpha",
    choose: true,
  }, { ...UI, selected: "alpha" });
  assertEquals(layerIds(menu.state), ["agents"]);
  // Without a remembered agent, `a` asks.
  const forgotten = { ...listed, preferences: { schema_version: 2 as const } };
  assertEquals(
    layerIds(
      intent(forgotten, { kind: "key", key: "a" }, { ...UI, selected: "alpha" })
        .state,
    ),
    ["agents"],
  );
  // A launch the session opens is remembered for its later toggles.
  const back = deskProduct(forgotten, {
    kind: "returned",
    outcome: { command: "claude", ok: true, lastAgent: "claude_code" },
    now: NOW,
  }).state;
  assertEquals(back.preferences.last_agent, "claude_code");
});

Deno.test("an agent next step is offered before discovery reads its agents", () => {
  // Checks failed on Beta and Gamma is empty: both need an agent next.
  const listed = observedDesk(
    survey([
      editing("alpha"),
      taskFleetEntry("beta", {
        last_action: {
          verb: "done",
          outcome: "failed",
          at: "2026-07-11T11:00:00Z",
        },
      }),
      taskFleetEntry("gamma", { gate_proof: { status: "missing" } }),
    ]),
  );
  assertEquals(
    listed.rows.map((row) => [row.task.name, row.decision.next?.action]),
    [["Beta", "agent"], ["Alpha", "agent"], ["Gamma", "agent"]],
  );
  for (const row of listed.rows) {
    assertEquals(row.discovered, false);
    if (row.decision.next?.action === "agent") {
      assertEquals(row.decision.next.availability, "enabled", row.task.name);
    }
  }
  const palette = deskView(listed, UI, ENV).layers;
  assertEquals(palette, undefined);
  const opened = open(listed, { kind: "palette" }).state;
  const view = deskView(opened, UI, ENV).layers?.[0];
  assert(view?.kind === "palette");
  const needs = view.sections.find((section) => section.title === "Needs you");
  assertEquals(
    needs?.items.filter((item) => item.id.startsWith("next:")).length ?? 0,
    listed.rows.filter((row) =>
      row.decision.group === "review" || row.decision.group === "attention"
    ).length,
    "every task the header counts has its next step in the palette",
  );
  // The picker says it is finding agents until discovery reads them.
  const picker =
    deskLayers(open(listed, { kind: "agents", taskId: "alpha" }).state, ENV)[0];
  assert(picker?.kind === "menu");
  assertStringIncludes(JSON.stringify(picker.aside), "Finding agents…");
});

Deno.test("an agent launch refuses when unavailable and shows a stored brief before an agent without a prompt option", () => {
  const briefed = observedDesk(survey([
    taskFleetEntry("alpha", {
      clean: false,
      changed_files: 1,
      last_activity: "2026-07-11T11:00:00Z",
      task: {
        id: "alpha",
        branch: "agent/alpha",
        title: "Alpha",
        title_source: "recorded",
        brief: "Keep the brief.",
      },
    }),
  ]));
  const launch = (
    id: string,
    availability: "enabled" | "disabled",
  ): DeskAgentLaunch => ({
    id,
    kind: "open",
    agent: "claude_code",
    providerLabel: "Claude Code",
    label: "Open Claude Code",
    binary: "claude",
    args: [],
    availability,
    ...(availability === "disabled"
      ? { reason: "claude is not on PATH." }
      : {}),
  });
  const state: DeskProductState = {
    ...briefed,
    rows: briefed.rows.map((row) => ({
      ...row,
      agentLaunches: [
        launch("claude:open", "enabled"),
        launch("claude:missing", "disabled"),
      ],
    })),
  };
  const refused = intent(state, {
    kind: "launch",
    taskId: "alpha",
    launch: "claude:missing",
  });
  assertEquals(refused.effects, []);
  assertEquals(refused.state.message?.text, "claude is not on PATH.");
  assertEquals(
    intent(state, { kind: "launch", taskId: "alpha", launch: "absent" })
      .state,
    state,
  );
  const brief = intent(
    open(state, { kind: "agents", taskId: "alpha" }).state,
    { kind: "launch", taskId: "alpha", launch: "claude:open" },
  );
  assertEquals(layerIds(brief.state), ["review-agent-brief"]);
  assertEquals(
    brief.effects.filter((effect) => effect.kind === "child"),
    [],
    "nothing opens before the brief is read",
  );
});

Deno.test("a script that cannot run says why, and a task without scripts explains itself", () => {
  const listed = observedDesk(survey([editing("alpha")]));
  const picker = deskProduct(
    intent(listed, { kind: "command", command: "main_scripts" }).state,
    {
      kind: "scripts",
      result: {
        state: "ready",
        value: {
          directory: "/project",
          scripts: [{
            name: "deploy",
            path: "/project/discern/scripts/deploy",
            availability: "disabled",
            reason: "deploy is not executable.",
          }],
        },
      },
    },
  ).state;
  const refused = intent(picker, { kind: "script", name: "deploy" });
  assertEquals(layerIds(refused.state), ["scripts"]);
  assertEquals(refused.state.message?.text, "deploy is not executable.");
  assertEquals(
    intent(picker, { kind: "script", name: "absent" }).state,
    picker,
  );

  const unscripted: DeskProductState = {
    ...listed,
    rows: listed.rows.map((row) => ({
      ...row,
      scripts: [],
      scriptsUnavailableReason: "The scripts directory is unreadable.",
    })),
  };
  const notice = intent(unscripted, {
    kind: "action",
    action: "scripts",
    id: "alpha",
  });
  const [reader] = deskLayers(notice.state, ENV);
  assertStringIncludes(
    JSON.stringify(reader),
    "The scripts directory is unreadable.",
  );
});

Deno.test("the Desk's limits match the package's", () => {
  assertEquals(DESK_LAYER_DEPTH, APPLICATION_LAYER_DEPTH);
  for (const [name, pair] of Object.entries(DESK_GLYPHS)) {
    const shared = Object.entries(TERMINAL_GLYPHS).find(([candidate]) =>
      candidate === name
    )?.[1];
    if (shared === undefined) continue;
    assertEquals(
      pair,
      { unicode: shared.unicode, ascii: shared.ascii },
      `${name} carries the package's pair`,
    );
  }
  const view = deskView(
    observedDesk(survey([editing("alpha")])),
    UI,
    ENV,
  );
  assertEquals(
    [...PACKAGE_RESERVED_KEYS].sort(),
    [...terminalApplicationReservedKeys(view.body, { viKeys: true })].sort(),
  );
  const layers: DeskLayer[] = [
    { kind: "palette" },
    { kind: "reader", reader: { kind: "keys" } },
    { kind: "reader", reader: { kind: "activity" } },
  ];
  let state = observedDesk(survey([]));
  for (const layer of layers) state = open(state, layer).state;
  assertEquals(layerIds(state), ["reader-keys", "reader-activity"]);
});
