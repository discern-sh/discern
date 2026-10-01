/**
 * What each Desk intent does to the product state.
 *
 * A key resolves through the key map of the layer the selection puts the
 * inbox in (a task, a parked branch, or a landing); a row's Enter runs its
 * registry next step; menus, the palette, buttons, and reader keys name what
 * they run directly. An unavailable action answers with its registry reason
 * and opens nothing. Pure: the effects say what the controller should do.
 */

import {
  DESK_KEYS,
  type DeskKeyBinding,
  type DeskLayer as DeskKeyLayer,
} from "./keys.ts";
import {
  type DeskAction,
  type DeskRow,
  deskRowId,
  unavailableSentence,
} from "./model.ts";
import type { DeskCommand } from "../../shared/desk_vocabulary.ts";
import { FLEET_ROW_GROUP_TITLES } from "../status/row_states.ts";
import type {
  DeskIntent,
  DeskLayer,
  DeskProductState,
  DeskScriptOwner,
  DeskTransition,
  DeskUi,
} from "./desk_state.ts";
import type { DeskFlowStep } from "./flow_types.ts";
import {
  closeLayer,
  layerId,
  open,
  parkedBranches,
  parkedRowId,
  refresh,
  renameTitle,
  rowRef,
  toast,
} from "./desk_transitions.ts";
import type { DeskPreferences } from "./preferences.ts";

const UNCHANGED = (state: DeskProductState): DeskTransition => ({
  state,
  effects: [],
});

/** The key map layer the selection puts the inbox in. */
function keyLayer(state: DeskProductState, ui: DeskUi): DeskKeyLayer {
  switch (rowRef(state, ui.selected)?.kind) {
    case "parked":
      return "branch";
    case "landed":
      return "landed";
    default:
      return "inbox";
  }
}

/** What one base-layer key means for the current selection. */
export function keyBinding(
  state: DeskProductState,
  key: string,
  ui: DeskUi,
): DeskKeyBinding | undefined {
  return DESK_KEYS[keyLayer(state, ui)].find((binding) => binding.key === key);
}

/** The review step for one task action. */
function actionStep(
  action: DeskAction,
  row: DeskRow,
  values?: Readonly<Record<string, string>>,
): DeskFlowStep {
  return {
    kind: "action",
    action,
    taskId: deskRowId(row),
    stage: "review",
    ...(values === undefined ? {} : { values }),
  };
}

/** The review step for one command. */
function commandStep(
  command: DeskCommand,
  ref?: string,
  values?: Readonly<Record<string, string>>,
): DeskFlowStep {
  return {
    kind: "command",
    command,
    stage: "review",
    ...(ref === undefined ? {} : { ref }),
    ...(values === undefined ? {} : { values }),
  };
}

/** Open a review sheet that reads its plan while it shows. */
function review(state: DeskProductState, step: DeskFlowStep): DeskTransition {
  return open(state, { kind: "review", step, load: { state: "loading" } });
}

/** Run one available action on a task, from any route. */
function startAction(
  state: DeskProductState,
  action: DeskAction,
  row: DeskRow,
): DeskTransition {
  const taskId = deskRowId(row);
  switch (action) {
    case "recovery":
      return open(state, {
        kind: "reader",
        reader: { kind: "recovery", taskId },
      });
    case "inspect":
      return open(state, {
        kind: "reader",
        reader: { kind: "changes", taskId, load: { state: "loading" } },
      });
    case "jump":
      return {
        state: closeRoutes(state),
        effects: [{ kind: "child", child: { kind: "shell", taskId } }],
      };
    case "agent": {
      const enabled = row.agentLaunches.filter((launch) =>
        launch.availability !== "disabled"
      );
      const only = enabled.length === 1 ? enabled[0] : undefined;
      return only === undefined
        ? open(state, { kind: "agents", taskId })
        : launch(state, taskId, only.id);
    }
    case "scripts":
      return row.scripts.length === 0
        ? open(state, {
          kind: "reader",
          reader: {
            kind: "notice",
            title: "Project Scripts",
            lines: [
              row.scriptsUnavailableReason ??
                `No Project Scripts are available in ${row.task.name}.`,
            ],
          },
        })
        : open(state, {
          kind: "scripts",
          owner: { kind: "task", taskId },
          load: {
            state: "ready",
            value: {
              directory: row.entry.path,
              scripts: row.scripts,
              ...(row.scriptsUnavailableReason === undefined
                ? {}
                : { unavailableReason: row.scriptsUnavailableReason }),
            },
          },
        });
    case "rename":
      return open(state, {
        kind: "form",
        step: actionStep("rename", row),
        values: { title: renameTitle(row) },
      });
    case "follow_up":
      return open(state, {
        kind: "form",
        step: actionStep("follow_up", row),
        values: {},
      });
    default:
      return review(state, actionStep(action, row));
  }
}

/** Close the routing layers a handoff leaves behind. */
function closeRoutes(state: DeskProductState): DeskProductState {
  return closeLayer(
    closeLayer(closeLayer(state, "actions"), "palette"),
    "agents",
  );
}

/** Run an action on a task if it can run; otherwise say why. */
function actionIntent(
  state: DeskProductState,
  action: DeskAction,
  id: string,
): DeskTransition {
  const ref = rowRef(state, id);
  if (ref?.kind !== "task") return UNCHANGED(state);
  const offer = ref.row.decision.actions.find((candidate) =>
    candidate.action === action
  );
  if (offer === undefined) return UNCHANGED(state);
  if (offer.availability === "disabled") {
    return UNCHANGED(
      toast(state, "warning", unavailableSentence(offer.label, offer.reason)),
    );
  }
  return startAction(state, action, ref.row);
}

/** A row's Enter: its next step, or its menu when it has none. */
function nextIntent(
  state: DeskProductState,
  id: string,
  ui: DeskUi,
): DeskTransition {
  const fromPalette = ui.topLayerId === "palette";
  const ref = rowRef(state, id);
  if (ref === undefined) return UNCHANGED(state);
  let transition: DeskTransition;
  if (ref.kind === "parked") {
    transition = commandIntent(state, "resume", ref.branch);
  } else if (ref.kind === "landed") {
    transition = commandIntent(state, "landed_proof", id);
  } else {
    const next = ref.row.decision.next;
    transition = next === undefined
      ? open(state, { kind: "actions", rowId: id })
      : actionIntent(state, next.action, id);
  }
  return fromPalette
    ? {
      state: transition.state,
      effects: [{ kind: "select", id }, ...transition.effects],
    }
    : transition;
}

/** Toggle one persisted presentation preference. */
function toggle(
  state: DeskProductState,
  update: (preferences: DeskPreferences) => DeskPreferences,
): DeskTransition {
  const preferences = update(state.preferences);
  return {
    state: closeLayer({ ...state, preferences }, "palette"),
    effects: [{ kind: "persist", preferences }],
  };
}

/** A reader the command opens, when it opens one. */
function commandReader(
  command: DeskCommand,
): DeskLayer | undefined {
  switch (command) {
    case "landing":
      return { kind: "reader", reader: { kind: "landing" } };
    case "main_checkout":
      return { kind: "reader", reader: { kind: "main" } };
    case "activity":
      return { kind: "reader", reader: { kind: "activity" } };
    case "keys":
      return { kind: "reader", reader: { kind: "keys" } };
    case "tip":
      return { kind: "reader", reader: { kind: "tip" } };
    default:
      return undefined;
  }
}

/** Run one Desk command. */
function commandIntent(
  state: DeskProductState,
  command: DeskCommand,
  ref?: string,
): DeskTransition {
  const reader = commandReader(command);
  if (reader !== undefined) return open(state, reader);
  switch (command) {
    case "new_task":
      return open(state, {
        kind: "form",
        step: commandStep("new_task"),
        values: {},
      });
    case "resume":
      return ref === undefined ? UNCHANGED(state) : open(state, {
        kind: "form",
        step: commandStep("resume", ref),
        values: {},
      });
    case "main_scripts":
      return open(state, {
        kind: "scripts",
        owner: { kind: "main" },
        load: { state: "loading" },
      });
    case "branch_commits":
      return ref === undefined ? UNCHANGED(state) : open(state, {
        kind: "reader",
        reader: { kind: "branch", branch: ref, load: { state: "loading" } },
      });
    case "landed_proof":
      return ref === undefined ? UNCHANGED(state) : open(state, {
        kind: "reader",
        reader: { kind: "landed", ref, load: { state: "loading" } },
      });
    case "parked": {
      const first = parkedBranches(state.data)[0];
      return first === undefined
        ? UNCHANGED(
          toast(closeLayer(state, "palette"), "muted", "Nothing in Parked"),
        )
        : {
          state: closeLayer(state, "palette"),
          effects: [{ kind: "select", id: parkedRowId(first) }],
        };
    }
    case "manual":
      return {
        state: closeRoutes(state),
        effects: [{ kind: "child", child: { kind: "manual" } }],
      };
    case "updates":
      return review(state, commandStep("updates"));
    case "refresh":
      return refresh(closeLayer(state, "palette"));
    case "sort":
      return toggle(state, (preferences) => ({
        ...preferences,
        sort: preferences.sort === "title" ? "decision" : "title",
      }));
    case "details":
      return toggle(state, (preferences) => ({
        ...preferences,
        details: preferences.details === "hidden" ? "shown" : "hidden",
      }));
    case "mouse":
      return toggle(state, (preferences) => ({
        ...preferences,
        mouse: preferences.mouse !== true,
      }));
    case "quit":
      return { state, effects: [{ kind: "exit" }] };
    default:
      // Show progress belongs to work the Desk runs in session.
      return UNCHANGED(state);
  }
}

/** The first task row of one decision group, in display order. */
function firstOfGroup(
  state: DeskProductState,
  group: string,
): DeskRow | undefined {
  return state.rows.find((row) => row.decision.group === group);
}

/** A base-layer key. */
function keyIntent(
  state: DeskProductState,
  key: string,
  ui: DeskUi,
): DeskTransition {
  const binding = keyBinding(state, key, ui);
  if (binding === undefined) return UNCHANGED(state);
  const meaning = binding.meaning;
  const ref = rowRef(state, ui.selected);
  switch (meaning.kind) {
    case "action":
      return ref?.kind === "task"
        ? actionIntent(state, meaning.action, deskRowId(ref.row))
        : UNCHANGED(state);
    case "command":
      return commandIntent(
        state,
        meaning.command,
        ref?.kind === "parked" ? ref.branch : ui.selected,
      );
    case "gesture":
      switch (meaning.gesture) {
        case "actions":
          return ref?.kind === "task" || ref?.kind === "parked"
            ? open(state, { kind: "actions", rowId: ui.selected ?? "" })
            : UNCHANGED(state);
        case "palette":
          return open(state, { kind: "palette" });
        case "jump-group": {
          const group = meaning.group ?? "review";
          const first = firstOfGroup(state, group);
          return first === undefined
            ? UNCHANGED(
              toast(
                state,
                "muted",
                `Nothing in ${FLEET_ROW_GROUP_TITLES[group]}`,
              ),
            )
            : { state, effects: [{ kind: "select", id: deskRowId(first) }] };
        }
        case "dismiss":
          return UNCHANGED(toast(state, "muted", "q quits"));
        default:
          return UNCHANGED(state);
      }
  }
}

/** Launch one agent entry point, showing the stored brief first when the
 * provider takes no prompt. */
function launch(
  state: DeskProductState,
  taskId: string,
  launchId: string,
): DeskTransition {
  const ref = rowRef(state, taskId);
  if (ref?.kind !== "task") return UNCHANGED(state);
  const entry = ref.row.agentLaunches.find((candidate) =>
    candidate.id === launchId
  );
  if (entry === undefined) return UNCHANGED(state);
  if (entry.availability === "disabled") {
    return UNCHANGED(
      toast(
        state,
        "warning",
        entry.reason ?? `${entry.label} is unavailable.`,
      ),
    );
  }
  const brief = ref.row.entry.task?.brief;
  if (brief !== undefined && entry.promptArgument === undefined) {
    return review(closeRoutes(state), {
      ...actionStep("agent", ref.row, { launch: launchId }),
      stage: "brief",
    });
  }
  return {
    state: closeRoutes(state),
    effects: [{
      kind: "child",
      child: { kind: "agent", taskId, launch: launchId },
    }],
  };
}

/** Choose one script from the open picker: its arguments come next. */
function chooseScript(
  state: DeskProductState,
  name: string,
): DeskTransition {
  const picker = state.layers.find((layer) => layer.kind === "scripts");
  if (picker?.kind !== "scripts" || picker.load.state !== "ready") {
    return UNCHANGED(state);
  }
  const script = picker.load.value.scripts.find((candidate) =>
    candidate.name === name
  );
  if (script === undefined) return UNCHANGED(state);
  if (script.availability === "disabled") {
    return UNCHANGED(
      toast(state, "warning", script.reason ?? `${name} can't run.`),
    );
  }
  const step = scriptStep(state, picker.owner, name);
  if (step === undefined) return UNCHANGED(state);
  return open(closeLayer(state, "scripts"), {
    kind: "form",
    step,
    values: { args: "" },
  });
}

/** The form step that collects a script's arguments. */
function scriptStep(
  state: DeskProductState,
  owner: DeskScriptOwner,
  name: string,
): DeskFlowStep | undefined {
  if (owner.kind === "main") {
    return commandStep("main_scripts", undefined, { script: name });
  }
  const ref = rowRef(state, owner.taskId);
  return ref?.kind === "task"
    ? actionStep("scripts", ref.row, { script: name })
    : undefined;
}

/** A sheet's or form's confirm button. */
function confirm(
  state: DeskProductState,
  id: string,
  ui: DeskUi,
): DeskTransition {
  const layer = state.layers.find((candidate) => layerId(candidate) === id);
  if (layer === undefined) return UNCHANGED(state);
  if (layer.kind === "review") {
    if (layer.load.state !== "ready") return UNCHANGED(state);
    const prepared = layer.load.value;
    if (prepared.confirm === undefined) return UNCHANGED(state);
    if (prepared.confirm.kind === "review") {
      return review(closeLayer(state, id), prepared.confirm.step);
    }
    // The effect owns the terminal next; a form that collected its values
    // closes with it.
    const remaining = state.layers.filter((candidate) =>
      candidate.kind !== "form" && layerId(candidate) !== id
    );
    const challenge = ui.fields[id]?.challenge;
    return {
      state: { ...state, layers: remaining },
      effects: [{
        kind: "apply",
        step: layer.step,
        prepared,
        ...(challenge === undefined ? {} : { challenge }),
      }],
    };
  }
  if (layer.kind !== "form") return UNCHANGED(state);
  const values = {
    ...layer.step.values,
    ...layer.values,
    ...(ui.fields[id] ?? {}),
  };
  const step: DeskFlowStep = { ...layer.step, values };
  if (
    (step.kind === "action" && step.action === "scripts") ||
    (step.kind === "command" && step.command === "main_scripts")
  ) {
    const owner: DeskScriptOwner = step.kind === "action"
      ? { kind: "task", taskId: step.taskId }
      : { kind: "main" };
    return {
      state: closeLayer(state, id),
      effects: [{
        kind: "script",
        owner,
        name: values.script ?? "",
        args: values.args ?? "",
      }],
    };
  }
  return review(state, step);
}

/** A sheet's alternative button switches to another review. */
function alternative(
  state: DeskProductState,
  id: string,
  button: string,
): DeskTransition {
  const layer = state.layers.find((candidate) => layerId(candidate) === id);
  if (layer?.kind !== "review" || layer.load.state !== "ready") {
    return UNCHANGED(state);
  }
  const choice = layer.load.value.content.alternatives?.find((candidate) =>
    candidate.id === button
  );
  return choice === undefined
    ? UNCHANGED(state)
    : review(closeLayer(state, id), choice.step);
}

/** Resolve one intent. */
export function intentTransition(
  state: DeskProductState,
  intent: DeskIntent,
  ui: DeskUi,
): DeskTransition {
  switch (intent.kind) {
    case "key":
      return keyIntent(state, intent.key, ui);
    case "next":
      return nextIntent(state, intent.id, ui);
    case "action":
      return actionIntent(state, intent.action, intent.id);
    case "command":
      return commandIntent(state, intent.command, intent.ref);
    case "select":
      return {
        state: closeLayer(state, "palette"),
        effects: [{ kind: "select", id: intent.id }],
      };
    case "confirm":
      return confirm(state, intent.layer, ui);
    case "alternative":
      return alternative(state, intent.layer, intent.id);
    case "launch":
      return launch(state, intent.taskId, intent.launch);
    case "script":
      return chooseScript(state, intent.name);
    case "child":
      return { state, effects: [{ kind: "child", child: intent.child }] };
  }
}
