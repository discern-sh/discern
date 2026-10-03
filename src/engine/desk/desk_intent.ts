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
  rememberedLaunch,
  unavailableSentence,
} from "./model.ts";
import {
  DESK_COMMAND_LABELS,
  type DeskCommand,
} from "../../shared/desk_vocabulary.ts";
import {
  commandReaderKind,
  DESK_COMMAND_REGISTRY,
  type DeskCommandMetadata,
} from "./commands.ts";
import type { FleetRowGroup } from "../../shared/fleet_row_vocabulary.ts";
import { FLEET_ROW_GROUP_TITLES } from "../status/row_states.ts";
import type {
  DeskAwaited,
  DeskIntent,
  DeskLayer,
  DeskOperation,
  DeskProductState,
  DeskScriptOwner,
  DeskTransition,
  DeskUi,
} from "./desk_state.ts";
import type { DeskFlowStep, DeskReview } from "./flow_types.ts";
import {
  canStop,
  commandVerb,
  opensBeside,
  operationProgress,
  runsInSession,
  stopPolicy,
} from "./operations.ts";
import {
  closeLayer,
  deskMessageTopic,
  type DeskRowRef,
  formValuesKey,
  layerId,
  open,
  parkedBranches,
  parkedRowId,
  refresh,
  renameTitle,
  resultAlternatives,
  rowRef,
  sessionRead,
  taskOperation,
  toast,
  withRows,
} from "./desk_transitions.ts";
import type { DeskPreferences } from "./preferences.ts";

const UNCHANGED = (state: DeskProductState): DeskTransition => ({
  state,
  effects: [],
});

/** When an input arrived: wall time, and the application's clock. */
export interface DeskInputTime {
  readonly now: number;
  readonly clock: number;
}

/** Open the progress of one running operation. */
function showProgress(
  state: DeskProductState,
  operationId: string,
): DeskTransition {
  return state.operations.has(operationId)
    ? open(closeRoutes(state), { kind: "progress", operationId })
    : UNCHANGED(state);
}

/** The operation the open progress sheet shows. */
function shownOperation(state: DeskProductState): DeskOperation | undefined {
  const layer = state.layers.find((candidate) => candidate.kind === "progress");
  return layer?.kind === "progress"
    ? state.operations.get(layer.operationId)
    : undefined;
}

/** The key map layer the selection puts the inbox in. */
function keyLayer(state: DeskProductState, ui: DeskUi): DeskKeyLayer {
  switch (rowRef(state, ui.selected)?.kind) {
    case "commands":
      return "commands";
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

/** Open a form that reads its preview for its starting values. */
function form(
  state: DeskProductState,
  step: DeskFlowStep,
  values: Readonly<Record<string, string>>,
): DeskTransition {
  return open(state, {
    kind: "form",
    step,
    values,
    load: { state: "loading" },
  });
}

/**
 * Run one available action on a task, from any route. Open agent runs the
 * remembered launch, or the only one, unless the route asks to `choose`.
 */
function startAction(
  state: DeskProductState,
  action: DeskAction,
  row: DeskRow,
  choose = false,
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
      const direct = choose
        ? undefined
        : rememberedLaunch(row, state.preferences.last_agent) ??
          (enabled.length === 1 ? enabled[0] : undefined);
      return direct === undefined
        ? open(state, { kind: "agents", taskId })
        : launch(state, taskId, direct.id);
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
      return form(state, actionStep("rename", row), {
        title: renameTitle(row),
      });
    case "follow_up":
      return form(state, actionStep("follow_up", row), {});
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

/**
 * Open the manual in place of the inbox. The session reads it as it starts;
 * the controller opens it at once once read, or as soon as the read
 * finishes. Only a read that failed opens nothing, and the message says
 * where its diagnosis is.
 */
function readManual(state: DeskProductState): DeskTransition {
  const closed = closeRoutes(state);
  return sessionRead(state, "manual") === "failed"
    ? UNCHANGED(
      toast(
        closed,
        "warning",
        "The manual could not open. Run discern docs to read its diagnosis.",
      ),
    )
    : { state: closed, effects: [{ kind: "manual" }] };
}

/** Where an awaited request goes, as its message names it. */
function awaitedTitle(awaited: DeskAwaited): string {
  return awaited.kind === "group"
    ? FLEET_ROW_GROUP_TITLES[awaited.group]
    : DESK_COMMAND_LABELS[awaited.command];
}

/**
 * Keep a request only the survey can decide until it has read the tasks,
 * and say so, rather than answer from tasks it hasn't read.
 */
function awaitSurvey(
  state: DeskProductState,
  awaited: DeskAwaited,
): DeskTransition {
  return UNCHANGED(
    toast(
      { ...closeLayer(state, "palette"), awaiting: awaited },
      "muted",
      `Going to ${awaitedTitle(awaited)} once tasks load`,
      { topic: "awaiting" },
    ),
  );
}

/**
 * Whether a command waits for the survey before it can run: one the survey
 * decides, which reads it and has no review of its own to open at once and
 * fill in.
 */
function waitsForSurvey(
  state: DeskProductState,
  command: DeskCommand,
): boolean {
  const metadata: DeskCommandMetadata = DESK_COMMAND_REGISTRY[command];
  return metadata.reads.includes("survey") &&
    metadata.confirmation.kind === "none" &&
    sessionRead(state, "survey") !== "ready";
}

/** Go to the first task of one decision group, or say it has none. */
function jumpGroup(
  state: DeskProductState,
  group: FleetRowGroup,
): DeskTransition {
  if (sessionRead(state, "survey") !== "ready") {
    return awaitSurvey(state, { kind: "group", group });
  }
  const first = firstOfGroup(state, group);
  return first === undefined
    ? UNCHANGED(
      toast(state, "muted", `Nothing in ${FLEET_ROW_GROUP_TITLES[group]}`),
    )
    : { state, effects: [{ kind: "select", id: deskRowId(first) }] };
}

/**
 * Run a request the survey decided, now that it has read the tasks; the
 * message that said it was waiting goes with it.
 */
export function runAwaited(
  state: DeskProductState,
  awaited: DeskAwaited,
): DeskTransition {
  const { message, ...rest } = state;
  const settled = deskMessageTopic(message?.id) === "awaiting" ? rest : state;
  return awaited.kind === "group"
    ? jumpGroup(settled, awaited.group)
    : commandIntent(settled, awaited.command, awaited.ref);
}

/** Run an action on a task if it can run; otherwise say why. */
function actionIntent(
  state: DeskProductState,
  action: DeskAction,
  id: string,
  choose = false,
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
  return startAction(state, action, ref.row, choose);
}

/**
 * The palette as it opens from a row: over the home panel, beside the
 * Commands row, it lists the panel's commands first, where they were read.
 */
function paletteFrom(ref: DeskRowRef | undefined): DeskLayer {
  return ref?.kind === "commands"
    ? { kind: "palette", home: true }
    : { kind: "palette" };
}

/**
 * A row's Enter: its next step, or its menu when it has none it can run now,
 * whose Unavailable section says why. The Commands row's Enter opens the
 * palette over the home panel it leads to.
 */
function nextIntent(
  state: DeskProductState,
  id: string,
  ui: DeskUi,
): DeskTransition {
  const fromPalette = ui.topLayerId === "palette";
  const ref = rowRef(state, id);
  if (ref === undefined) return UNCHANGED(state);
  let transition: DeskTransition;
  if (ref.kind === "commands") {
    transition = open(state, paletteFrom(ref));
  } else if (ref.kind === "parked") {
    transition = commandIntent(state, "resume", ref.branch);
  } else if (ref.kind === "landed") {
    transition = commandIntent(state, "landed_proof", id);
  } else {
    const running = taskOperation(state, id);
    const next = ref.row.decision.next;
    transition = running !== undefined
      ? showProgress(state, running.id)
      : next?.availability !== "enabled"
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
function commandReader(command: DeskCommand): DeskLayer | undefined {
  const kind = commandReaderKind(command);
  return kind === undefined ? undefined : { kind: "reader", reader: { kind } };
}

/** Run one Desk command. */
function commandIntent(
  state: DeskProductState,
  command: DeskCommand,
  ref?: string,
): DeskTransition {
  // A reader or a review opens at once and fills in as its reads arrive;
  // anything else the survey decides waits for it.
  const reader = commandReader(command);
  if (reader !== undefined) return open(state, reader);
  if (waitsForSurvey(state, command)) {
    return awaitSurvey(state, {
      kind: "command",
      command,
      ...(ref === undefined ? {} : { ref }),
    });
  }
  switch (command) {
    case "new_task":
      return form(state, commandStep("new_task"), {});
    case "resume":
      return ref === undefined
        ? UNCHANGED(state)
        : form(state, commandStep("resume", ref), {});
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
      return readManual(state);
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
      // Leaving stops what runs beside the screen, so it asks first.
      return state.operations.size > 0
        ? open(closeRoutes(state), { kind: "quit" })
        : { state, effects: [{ kind: "exit" }] };
    case "progress": {
      const running = ref === undefined ? undefined : taskOperation(state, ref);
      return running === undefined
        ? UNCHANGED(state)
        : showProgress(state, running.id);
    }
    default:
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
          return open(state, paletteFrom(ref));
        case "jump-group":
          return jumpGroup(state, meaning.group ?? "review");
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
  return form(closeLayer(state, "scripts"), step, { args: "" });
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

/**
 * Start one confirmed effect beside the screen: its progress sheet replaces
 * the review, and its row shows it running. A task runs one operation at a
 * time; a second waits for the first.
 */
function operate(
  state: DeskProductState,
  step: DeskFlowStep,
  read: DeskReview,
  challenge: string | undefined,
  time: DeskInputTime,
): DeskTransition {
  const taskId = step.kind === "action" ? step.taskId : undefined;
  const title = read.confirm?.kind === "apply" ? read.confirm.running : "";
  const busy = taskId === undefined ? undefined : taskOperation(state, taskId);
  if (busy !== undefined) {
    return UNCHANGED(
      toast(
        state,
        "warning",
        `${busy.title} is still running; this can start once it ends`,
      ),
    );
  }
  const serial = state.serial + 1;
  const operation: DeskOperation = {
    id: `operation-${serial}`,
    step,
    review: read,
    ...(challenge === undefined ? {} : { challenge }),
    ...(taskId === undefined ? {} : { taskId }),
    verb: commandVerb(read.disclosures.command),
    title,
    command: read.disclosures.command,
    ...(read.disclosures.plan === undefined
      ? {}
      : { plan: read.disclosures.plan }),
    startedAt: time.now,
    progress: operationProgress(
      read.disclosures.plan,
      state.trunk,
      time.clock,
      read.follows ?? [],
    ),
    output: "",
  };
  const operations = new Map(state.operations);
  operations.set(operation.id, operation);
  const shown = open(withRows({ ...state, serial, operations }), {
    kind: "progress",
    operationId: operation.id,
  });
  return {
    state: shown.state,
    effects: [...shown.effects, { kind: "operate", operationId: operation.id }],
  };
}

/**
 * Open a reviewed page beside the screen: the sheet gives way to the reader
 * that shows what opening it left, which says what is happening until then.
 */
function openBeside(
  state: DeskProductState,
  step: DeskFlowStep,
  read: DeskReview,
): DeskTransition {
  const confirmed = read.confirm?.kind === "apply" ? read.confirm : undefined;
  const reader: DeskLayer = {
    kind: "reader",
    reader: {
      kind: "opened",
      title: confirmed?.reads ?? read.question,
      running: confirmed?.running ?? read.question,
      load: { state: "loading" },
    },
  };
  const serial = state.serial + 1;
  const shown = open({ ...state, serial }, reader);
  return {
    state: shown.state,
    effects: [...shown.effects, {
      kind: "open",
      commandId: `open-${serial}`,
      layerId: layerId(reader),
      step,
      review: read,
    }],
  };
}

/** Stop the operation the open progress sheet shows, if it can stop now. */
function stop(state: DeskProductState): DeskTransition {
  const operation = shownOperation(state);
  if (
    operation === undefined || operation.stopping === true ||
    !canStop(stopPolicy(operation.step), operation.progress)
  ) return UNCHANGED(state);
  const operations = new Map(state.operations);
  operations.set(operation.id, { ...operation, stopping: true });
  return {
    state: { ...state, operations },
    effects: [{ kind: "abort", operationId: operation.id }],
  };
}

/**
 * A sheet's or form's confirm button. A review that asks a further question
 * opens it; otherwise the effect runs, bound to the review, and the sheet or
 * form closes with it: beside the screen when it changes project state,
 * with the terminal when it launches a child. A form applies only the
 * preview of the values on screen, and only once nothing blocks it.
 */
function confirm(
  state: DeskProductState,
  id: string,
  ui: DeskUi,
  openAgent: string | undefined,
  time: DeskInputTime,
): DeskTransition {
  const layer = state.layers.find((candidate) => layerId(candidate) === id);
  if (layer?.kind !== "review" && layer?.kind !== "form") {
    return UNCHANGED(state);
  }
  if (layer.load.state !== "ready") return UNCHANGED(state);
  if (
    layer.kind === "form" && layer.readFor !== formValuesKey(layer.values)
  ) return UNCHANGED(state);
  const read = layer.load.value;
  if (read.confirm === undefined || read.blockers.length > 0) {
    return UNCHANGED(state);
  }
  // A review applies only to the task it was read for.
  if (
    layer.step.kind === "action" && read.subject !== undefined &&
    read.subject.id !== layer.step.taskId
  ) return UNCHANGED(state);
  if (read.confirm.kind === "review") {
    return review(closeLayer(state, id), read.confirm.step);
  }
  const challenge = ui.fields[id]?.challenge;
  const step = layer.kind === "form"
    ? { ...layer.step, values: { ...layer.step.values, ...layer.values } }
    : layer.step;
  if (opensBeside(step)) return openBeside(closeLayer(state, id), step, read);
  if (runsInSession(step, openAgent)) {
    return operate(closeLayer(state, id), step, read, challenge, time);
  }
  return {
    state: closeLayer(state, id),
    effects: [{
      kind: "apply",
      step,
      review: read,
      ...(challenge === undefined ? {} : { challenge }),
      ...(openAgent === undefined ? {} : { open: openAgent }),
    }],
  };
}

/** An alternative button: the sheet closes and its intent runs. */
function alternative(
  state: DeskProductState,
  id: string,
  button: string,
  ui: DeskUi,
  time: DeskInputTime,
): DeskTransition {
  const layer = state.layers.find((candidate) => layerId(candidate) === id);
  const choices = layer?.kind === "review" && layer.load.state === "ready"
    ? layer.load.value.alternatives
    : layer?.kind === "result"
    ? resultAlternatives(state, layer.sheet)
    : [];
  const choice = choices.find((candidate) => candidate.id === button);
  return choice === undefined
    ? UNCHANGED(state)
    : intentTransition(closeLayer(state, id), choice.intent, ui, time);
}

/** Read a review again: the same step, from a fresh preview. */
function reviewAgain(state: DeskProductState, id: string): DeskTransition {
  const layer = state.layers.find((candidate) => layerId(candidate) === id);
  return layer?.kind === "review"
    ? review(closeLayer(state, id), layer.step)
    : UNCHANGED(state);
}

/**
 * Resolve one intent. Whatever the owner asks for next replaces a request
 * still waiting for the survey.
 */
export function intentTransition(
  current: DeskProductState,
  intent: DeskIntent,
  ui: DeskUi,
  time: DeskInputTime,
): DeskTransition {
  const { awaiting: _replaced, ...state } = current;
  switch (intent.kind) {
    case "key":
      return keyIntent(state, intent.key, ui);
    case "next":
      return nextIntent(state, intent.id, ui);
    case "action":
      return actionIntent(
        state,
        intent.action,
        intent.id,
        intent.choose === true,
      );
    case "command":
      return commandIntent(state, intent.command, intent.ref);
    case "select":
      return {
        state: closeLayer(state, "palette"),
        effects: [{ kind: "select", id: intent.id }],
      };
    case "confirm":
      return confirm(state, intent.layer, ui, intent.open, time);
    case "review-again":
      return reviewAgain(state, intent.layer);
    case "alternative":
      return alternative(state, intent.layer, intent.id, ui, time);
    case "launch":
      return launch(state, intent.taskId, intent.launch);
    case "script":
      return chooseScript(state, intent.name);
    case "child":
      return { state, effects: [{ kind: "child", child: intent.child }] };
    case "progress":
      return showProgress(state, intent.operationId);
    case "stop":
      return stop(state);
    case "output": {
      const operation = shownOperation(state);
      return operation === undefined ? UNCHANGED(state) : open(state, {
        kind: "reader",
        reader: { kind: "output", operationId: operation.id },
      });
    }
    case "quit-anyway":
      return {
        state: closeLayer(state, "quit"),
        effects: [{ kind: "exit" }],
      };
  }
}
