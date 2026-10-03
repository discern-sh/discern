/**
 * No Desk command refuses because something it reads is still loading. The
 * command registry declares what each command reads; for every command, one
 * test chooses it with each declared read deliberately held back and proves
 * it opens at once in a visible loading state that fills in, or runs as soon
 * as the read arrives, never asking for a retry, and that it then reaches
 * what choosing it on a ready desk reaches; until then, its faint value
 * stays blank. A command that declares nothing must do the same on a desk
 * still loading everything, so an undeclared read fails here too. The number keys that jump to a decision group follow the
 * same rule. Pure: the live controller's own wait for the manual is held by
 * the runtime tests.
 */

import { assert, assertEquals } from "@std/assert";
import type { ApplicationLayer } from "discern-design-system/cli/interactive";
import {
  DESK_COMMAND_REGISTRY,
  DESK_COMMANDS,
  type DeskCommand,
  type DeskCommandMetadata,
  type DeskCommandRead,
} from "../src/engine/desk/commands.ts";
import { DESK_COMMAND_LABELS } from "../src/shared/desk_vocabulary.ts";
import {
  type DeskEffect,
  type DeskIntent,
  deskProduct,
  type DeskProductState,
  type DeskTransition,
} from "../src/engine/desk/desk_state.ts";
import {
  landedRowId,
  layerId,
  parkedRowId,
  sessionRead,
} from "../src/engine/desk/desk_transitions.ts";
import { deskLayers } from "../src/engine/desk/layer_view.ts";
import { DESK_NO_TIP_YET } from "../src/engine/desk/reader_view.ts";
import { commandValue } from "../src/engine/desk/palette_view.ts";
import { DESK_KEYS } from "../src/engine/desk/keys.ts";
import { COMMANDS_ROW_ID } from "../src/engine/desk/desk_transitions.ts";
import { FLEET_ROW_DECISIONS } from "../src/shared/fleet_row_vocabulary.ts";
import { deskRowId } from "../src/engine/desk/model.ts";
import type { StatusData } from "../src/shared/result_schemas.ts";
import { taskFleetEntry } from "./status_fleet.ts";
import {
  deskIntent,
  editingTask,
  failDesk,
  freshDesk,
  observeDesk,
  PRODUCT_NOW,
  PRODUCT_UI,
  PRODUCT_VIEW_ENV,
  productSurvey,
} from "./fixtures/desk_product.ts";

const LANDED_AT = "2026-07-10T12:00:00.000Z";

/**
 * A fleet with something in most places a command goes: a task ready for
 * review, one needing attention and one being edited, a parked branch, a
 * queued submission and a landing.
 */
function fleet(): StatusData {
  return productSurvey(
    [
      taskFleetEntry("task-0", {
        ahead: 2,
        proof_honored: true,
        gate_proof: { status: "honored" },
        last_activity: "2026-07-11T11:00:00Z",
      }),
      taskFleetEntry("task-1", {
        ahead: 1,
        behind: 12,
        proof_honored: true,
        gate_proof: { status: "honored" },
        last_activity: "2026-07-01T11:00:00Z",
      }),
      editingTask("task-2"),
    ],
    {
      parked_tasks: [{
        id: "kept",
        branch: "agent/kept",
        head: "abc1234",
        parked_at: "2026-07-01T00:00:00.000Z",
        task: {
          id: "kept",
          branch: "agent/kept",
          title: "Kept",
          title_source: "recorded",
        },
      }],
      queue: [{
        effort: "task-0",
        branch: "agent/task-0",
        path: "/worktrees/task-0",
        head: "a".repeat(40),
        submitted_at: "2026-07-11T11:30:00.000Z",
        authority: "pre-authorized",
        position: 1,
        readiness: "ready",
      }],
      recent_completed_tasks: [{
        branch: "agent/done",
        completed_at: LANDED_AT,
      }],
    },
  );
}

/** A tip, as the session chooses one. */
const TIP = { brief: "Press `?` for keys.", full: "Press `?` for every key." };

/** Deliver one session read to a desk still waiting for it. */
function deliver(
  state: DeskProductState,
  read: DeskCommandRead,
): DeskTransition {
  switch (read) {
    case "survey":
      return observeDesk(state, fleet());
    case "manual":
      return deskProduct(state, {
        kind: "manual-read",
        result: { state: "ready" },
      });
    case "tip":
      return deskProduct(state, { kind: "tip", tip: TIP });
    case "own":
      return { state, effects: [] };
  }
}

/** The session reads a desk can hold back. */
const SESSION_READS = ["survey", "manual", "tip"] as const;

/** A desk on which only `loading` are still loading; the rest have arrived. */
function deskLoading(loading: readonly DeskCommandRead[]): DeskProductState {
  let state = deskProduct(freshDesk(), { kind: "refresh" }).state;
  for (const read of SESSION_READS) {
    if (!loading.includes(read)) state = deliver(state, read).state;
  }
  return state;
}

/** One command's contract, read through its declared type. */
function metadata(command: DeskCommand): DeskCommandMetadata {
  return DESK_COMMAND_REGISTRY[command];
}

/** The row a command scoped to one acts on, on the ready fleet. */
function refFor(command: DeskCommand): string | undefined {
  switch (metadata(command).scope) {
    case "parked-row":
      return "agent/kept";
    case "landed-row":
      return landedRowId("agent/done", LANDED_AT);
    default:
      return undefined;
  }
}

/** Choose one command, as the palette or its key does. */
function choose(state: DeskProductState, command: DeskCommand): DeskTransition {
  const ref = refFor(command);
  const intent: DeskIntent = {
    kind: "command",
    command,
    ...(ref === undefined ? {} : { ref }),
  };
  return deskIntent(state, intent, {
    ...PRODUCT_UI,
    selected: COMMANDS_ROW_ID,
  });
}

/** Apply one transition's state to the next step, keeping every effect. */
function then(
  first: DeskTransition,
  next: (state: DeskProductState) => DeskTransition,
): DeskTransition {
  const second = next(first.state);
  return {
    state: second.state,
    effects: [...first.effects, ...second.effects],
  };
}

/** What the owner sees a choice reach: what opened, moved, ran, or said. */
function reached(transition: DeskTransition): {
  readonly layers: readonly string[];
  readonly effects: readonly string[];
  readonly message?: string;
} {
  const owned = (effect: DeskEffect): string[] => {
    switch (effect.kind) {
      case "select":
        return [`select:${effect.id}`];
      case "manual":
      case "exit":
        return [effect.kind];
      case "child":
        return [`child:${effect.child.kind}`];
      default:
        return [];
    }
  };
  const message = transition.state.message?.text;
  return {
    layers: transition.state.layers.map(layerId),
    effects: transition.effects.flatMap(owned),
    ...(message === undefined ? {} : { message }),
  };
}

/** Whether a rendered layer shows a read still loading. */
function showsLoading(layer: ApplicationLayer<DeskIntent>): boolean {
  const seen = (value: unknown): boolean =>
    Array.isArray(value)
      ? value.some(seen)
      : typeof value === "object" && value !== null &&
        (("kind" in value && value.kind === "pending") ||
          ("state" in value && value.state === "loading") ||
          Object.values(value).some(seen));
  return seen(layer);
}

/** The top layer as the package draws it. */
function topLayer(
  state: DeskProductState,
): ApplicationLayer<DeskIntent> | undefined {
  return deskLayers(state, PRODUCT_VIEW_ENV).at(-1);
}

/** A message that refuses or claims something the desk hasn't read. */
function refuses(state: DeskProductState): boolean {
  const message = state.message;
  return message !== undefined &&
    (message.tone === "warning" ||
      /try again|still loading|^Nothing in/iu.test(message.text));
}

/** What choosing `command` reaches on a desk with every read in. */
function readyReach(command: DeskCommand): ReturnType<typeof reached> {
  return reached(choose(deskLoading([]), command));
}

/** Each read as a test names it. */
const READ_WORDS = {
  survey: "the tasks are",
  manual: "the manual is",
  tip: "the session's tip is",
  own: "its own read is",
} as const satisfies Record<DeskCommandRead, string>;

for (const command of DESK_COMMANDS) {
  const reads = metadata(command).reads;
  const label = DESK_COMMAND_LABELS[command];
  const held = reads.filter((read) => read !== "own");
  const name = reads.length === 0
    ? `${label} reads nothing that loads, so a loading desk runs it as a ready one does`
    : `${label} never refuses while ${
      reads.map((read) => READ_WORDS[read]).join(" or ")
    } still loading`;
  Deno.test(name, () => {
    const ready = readyReach(command);
    if (reads.length === 0) {
      assertEquals(
        commandValue(deskLoading(SESSION_READS), command, PRODUCT_NOW),
        commandValue(deskLoading([]), command, PRODUCT_NOW),
        "an undeclared read changed its value",
      );
      const early = choose(deskLoading(SESSION_READS), command);
      assert(!refuses(early.state), early.state.message?.text);
      assertEquals(reached(early), ready, "an undeclared read changed it");
      return;
    }
    for (const read of held) {
      assertEquals(
        commandValue(deskLoading([read]), command, PRODUCT_NOW),
        undefined,
        `${read}: no value claims what isn't read yet`,
      );
      const early = choose(deskLoading([read]), command);
      assert(
        !refuses(early.state),
        `${read}: ${early.state.message?.text ?? ""}`,
      );
      const top = topLayer(early.state);
      if (early.state.layers.length > 0) {
        assert(top !== undefined && showsLoading(top), `${read}: no loading`);
      } else if (early.state.awaiting !== undefined) {
        assertEquals(early.state.message?.tone, "muted", "it says it waits");
      } else {
        // Only the manual opens through the controller, which waits for it.
        assertEquals(reached(early).effects, ["manual"], read);
      }
      const arrived = then(early, (state) => deliver(state, read));
      assertEquals(sessionRead(arrived.state, read), "ready");
      assertEquals(reached(arrived), ready, `${read}: once it arrived`);
      const filled = topLayer(arrived.state);
      assert(
        filled === undefined || !showsLoading(filled),
        `${read}: it filled in`,
      );
    }
    if (reads.includes("own")) {
      // The command starts its own read and shows it loading until it lands.
      const opened = choose(deskLoading([]), command);
      const top = topLayer(opened.state);
      assert(top !== undefined && showsLoading(top), "its layer shows loading");
      assert(
        opened.effects.some((effect) =>
          effect.kind === "prepare" || effect.kind === "read" ||
          effect.kind === "load-scripts"
        ),
        "it starts its read",
      );
    }
  });
}

Deno.test("Tip of the session never waits on a tip the session can't choose", () => {
  // The first survey failed, so no tip is being chosen: the reader says the
  // session has none yet instead of waiting.
  const unread = failDesk(deskLoading(["survey", "tip"])).state;
  assertEquals(sessionRead(unread, "tip"), "failed");
  const early = topLayer(choose(unread, "tip").state);
  assert(early !== undefined && !showsLoading(early), "it waits for nothing");
  assert(JSON.stringify(early).includes(DESK_NO_TIP_YET), "it says why");
  // A tip that couldn't be chosen leaves the session with none.
  const surveyed = deliver(unread, "survey").state;
  const none = deskProduct(surveyed, { kind: "tip" }).state;
  assertEquals(sessionRead(none, "tip"), "ready");
  assert(
    JSON.stringify(topLayer(choose(none, "tip").state)).includes(
      "This session has no tip.",
    ),
  );
});

Deno.test("a group's key before the first survey goes there once the tasks are read", () => {
  const jumps = DESK_KEYS.commands.flatMap((binding) =>
    binding.meaning.kind === "gesture" &&
      binding.meaning.gesture === "jump-group" &&
      binding.meaning.group !== undefined
      ? [{ key: binding.key, group: binding.meaning.group }]
      : []
  );
  assertEquals(
    jumps.map((jump) => jump.group),
    [...FLEET_ROW_DECISIONS],
    "every decision group has a key",
  );
  const ui = { ...PRODUCT_UI, selected: COMMANDS_ROW_ID };
  const selected: string[] = [];
  for (const { key, group } of jumps) {
    const early = deskIntent(deskLoading(["survey"]), { kind: "key", key }, ui);
    assert(!refuses(early.state), early.state.message?.text);
    assertEquals(early.state.awaiting, { kind: "group", group });
    const arrived = then(early, (state) => deliver(state, "survey"));
    assertEquals(arrived.state.awaiting, undefined);
    assertEquals(
      reached(arrived),
      reached(deskIntent(deskLoading([]), { kind: "key", key }, ui)),
      group,
    );
    const first = arrived.state.rows.find((row) =>
      row.decision.group === group
    );
    if (first !== undefined) selected.push(deskRowId(first));
  }
  // Ready for review is empty: its task is queued, so it is approved.
  assertEquals(selected, ["task-1", "task-2", "task-0"], "groups hold tasks");
});

Deno.test("whatever the owner asks next replaces a request still waiting for the survey", () => {
  const ui = { ...PRODUCT_UI, selected: COMMANDS_ROW_ID };
  const parked = choose(deskLoading(["survey"]), "parked");
  assertEquals(parked.state.awaiting, { kind: "command", command: "parked" });
  const keys = deskIntent(
    parked.state,
    { kind: "command", command: "keys" },
    ui,
  );
  assertEquals(keys.state.awaiting, undefined);
  const arrived = deliver(keys.state, "survey");
  assert(
    !arrived.effects.some((effect) =>
      effect.kind === "select" && effect.id === parkedRowId("agent/kept")
    ),
    "the replaced request never runs",
  );
});
