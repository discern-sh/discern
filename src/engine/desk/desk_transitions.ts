/**
 * Pure transitions the Desk's product state machine and its intent
 * resolution share: which layers exist, the messages they leave, and how
 * list identities map back to the rows and branches they stand for.
 */

import type { StatusData } from "../../shared/result_schemas.ts";
import type {
  DeskDeparture,
  DeskEffect,
  DeskLayer,
  DeskMessage,
  DeskProductState,
  DeskTransition,
} from "./desk_state.ts";
import type { DeskFlowStep } from "./flow_types.ts";
import { type DeskRow, deskRowId } from "./model.ts";
import { taskLabel } from "../worktree/task_label.ts";
import { compareTaskTitles } from "../status/fleet_rows.ts";

/** The one list the inbox shows; the package remembers selection by it. */
export const DESK_LIST_ID = "inbox";

/**
 * Layers open at once, bottom to top: the package's own limit, which a test
 * holds equal to its exported value.
 */
export const DESK_LAYER_DEPTH = 2;

/** How long a toast stays before the package dismisses it. */
export const DESK_TOAST_MS = 6_000;

/** Departures remembered for the message that names a vanished row. */
const DEPARTURES_KEPT = 64;

/** The list identity of a parked or unlanded branch row. */
export function parkedRowId(branch: string): string {
  return `parked:${branch}`;
}

/** The list identity of a recent landing's row. */
export function landedRowId(branch: string, completedAt: string): string {
  return `landed:${branch}@${completedAt}`;
}

/** A step's stable name inside a layer id. */
function stepName(step: DeskFlowStep): string {
  return `${step.kind === "action" ? step.action : step.command}-${step.stage}`;
}

/** The id the view gives a layer; dismissals name layers by it. */
export function layerId(layer: DeskLayer): string {
  switch (layer.kind) {
    case "actions":
    case "palette":
    case "agents":
      return layer.kind;
    case "scripts":
      return layer.load.state === "ready" ? "scripts" : "scripts-finding";
    case "reader":
      return `reader-${layer.reader.kind}`;
    case "review":
      return `review-${stepName(layer.step)}`;
    case "form":
      return `form-${stepName(layer.step)}`;
  }
}

/** Layers that only route somewhere: whatever they open replaces them. */
function routes(layer: DeskLayer): boolean {
  return layer.kind === "actions" || layer.kind === "palette" ||
    layer.kind === "agents";
}

/** The read a newly opened layer starts, if it shows something not yet read. */
function readFor(layer: DeskLayer, id: string): DeskEffect | undefined {
  if (layer.kind === "review" && layer.load.state === "loading") {
    return { kind: "prepare", layerId: id, step: layer.step };
  }
  if (layer.kind === "scripts" && layer.load.state === "loading") {
    return { kind: "load-scripts", owner: layer.owner };
  }
  if (
    layer.kind === "reader" &&
    (layer.reader.kind === "changes" || layer.reader.kind === "branch" ||
      layer.reader.kind === "landed") &&
    layer.reader.load.state === "loading"
  ) {
    return { kind: "read", layerId: id, reader: layer.reader };
  }
  return undefined;
}

/**
 * Open a layer on top. Routing layers (menus, the palette) are replaced by
 * what they open, a layer with the same id is replaced, and the oldest layer
 * gives way beyond the package's depth.
 */
export function open(
  state: DeskProductState,
  layer: DeskLayer,
): DeskTransition {
  const id = layerId(layer);
  const kept = state.layers.filter((existing) =>
    !routes(existing) && layerId(existing) !== id
  );
  const layers = [...kept, layer].slice(-DESK_LAYER_DEPTH);
  const read = readFor(layer, id);
  return {
    state: { ...state, layers },
    effects: read === undefined ? [] : [read],
  };
}

/** Remove one layer by its view id. */
export function closeLayer(
  state: DeskProductState,
  id: string,
): DeskProductState {
  return {
    ...state,
    layers: state.layers.filter((layer) => layerId(layer) !== id),
  };
}

/** Replace one layer by its view id. */
export function updateLayer(
  state: DeskProductState,
  id: string,
  update: (layer: DeskLayer) => DeskLayer,
): DeskProductState {
  return {
    ...state,
    layers: state.layers.map((layer) =>
      layerId(layer) === id ? update(layer) : layer
    ),
  };
}

/** Start a survey now, or queue exactly one follow-up while one runs. */
export function refresh(state: DeskProductState): DeskTransition {
  if (state.survey.inFlight) {
    return {
      state: { ...state, survey: { ...state.survey, followUp: true } },
      effects: [],
    };
  }
  const generation = state.survey.generation + 1;
  return {
    state: {
      ...state,
      survey: { ...state.survey, generation, inFlight: true, followUp: false },
    },
    effects: [{ kind: "survey", generation }],
  };
}

/** Show one message, replacing any message already shown. */
export function toast(
  state: DeskProductState,
  tone: DeskMessage["tone"],
  text: string,
  extra: Pick<DeskMessage, "mark" | "key" | "tip"> = {},
): DeskProductState {
  const serial = state.serial + 1;
  return {
    ...state,
    serial,
    message: { id: `message-${serial}`, tone, text, ...extra },
  };
}

/** The title a row shows. */
export function rowTitle(row: DeskRow): string {
  return row.task.name;
}

/** The title a rename starts from: the recorded title, else the shown one. */
export function renameTitle(row: DeskRow): string {
  return row.entry.task?.title ?? row.task.name;
}

/** The title a branch without a checkout shows. */
export function branchTitle(
  branch: string,
  data: StatusData | undefined,
): string {
  const parked = data?.parked_tasks?.find((task) => task.branch === branch);
  return parked?.task.title ?? taskLabel({ path: branch }).name;
}

/** What a list identity stands for. */
export type DeskRowRef =
  | { readonly kind: "task"; readonly row: DeskRow }
  | { readonly kind: "parked"; readonly branch: string }
  | {
    readonly kind: "landed";
    readonly task: NonNullable<StatusData["recent_completed_tasks"]>[number];
  };

/** Resolve a list identity against the adopted observation. */
export function rowRef(
  state: DeskProductState,
  id: string | undefined,
): DeskRowRef | undefined {
  if (id === undefined) return undefined;
  const row = state.rows.find((candidate) => deskRowId(candidate) === id);
  if (row !== undefined) return { kind: "task", row };
  if (id.startsWith("parked:")) {
    const branch = id.slice("parked:".length);
    return parkedBranches(state.data).includes(branch)
      ? { kind: "parked", branch }
      : undefined;
  }
  const task = state.data?.recent_completed_tasks?.find((candidate) =>
    landedRowId(candidate.branch, candidate.completed_at) === id
  );
  return task === undefined ? undefined : { kind: "landed", task };
}

/** Every branch without a checkout, in title order like every group. */
export function parkedBranches(data: StatusData | undefined): string[] {
  const parked = (data?.parked_tasks ?? []).map((task) => task.branch);
  return [
    ...parked,
    ...(data?.unlanded_branches ?? []).filter((branch) =>
      !parked.includes(branch)
    ),
  ].sort((left, right) =>
    compareTaskTitles(branchTitle(left, data), branchTitle(right, data)) ||
    left.localeCompare(right, "en")
  );
}

/** Rows that left the inbox with this observation, and why. */
export function departures(
  previous: DeskProductState,
  data: StatusData,
  rows: readonly DeskRow[],
): ReadonlyMap<string, DeskDeparture> {
  const departed = new Map(previous.departed);
  const live = new Set(rows.map((row) => deskRowId(row)));
  const liveBranches = new Set(rows.map((row) => row.entry.branch));
  const landed = new Set(
    (data.recent_completed_tasks ?? []).map((task) => task.branch),
  );
  const parked = new Set(parkedBranches(data));
  for (const row of previous.rows) {
    const id = deskRowId(row);
    if (live.has(id)) continue;
    departed.set(id, {
      title: rowTitle(row),
      reason: landed.has(row.entry.branch)
        ? "landed"
        : parked.has(row.entry.branch)
        ? "parked"
        : "removed",
    });
  }
  for (const branch of parkedBranches(previous.data)) {
    if (parked.has(branch)) continue;
    departed.set(parkedRowId(branch), {
      title: branchTitle(branch, previous.data),
      reason: liveBranches.has(branch) ? "resumed" : "removed",
    });
  }
  return new Map([...departed].slice(-DEPARTURES_KEPT));
}

/** The message that names a departed row. */
export function departureMessage(
  departure: DeskDeparture,
  trunk: string,
): string {
  switch (departure.reason) {
    case "landed":
      return `${departure.title} landed on ${trunk}`;
    case "parked":
      return `${departure.title} was parked; its branch is kept`;
    case "resumed":
      return `${departure.title} resumed as a task`;
    case "removed":
      return `${departure.title} is no longer listed`;
  }
}

/**
 * Why a layer's subject that left the inbox can't be acted on:
 * `<title> is gone: <reason>`.
 */
export function goneSentence(
  departed: ReadonlyMap<string, DeskDeparture>,
  id: string,
  trunk: string,
): string {
  const departure = departed.get(id);
  if (departure === undefined) {
    return "This task is gone: it is no longer listed";
  }
  const reason = {
    landed: `it landed on ${trunk}`,
    parked: "it was parked; its branch is kept",
    resumed: "it resumed as a task",
    removed: "it is no longer listed",
  }[departure.reason];
  return `${departure.title} is gone: ${reason}`;
}
