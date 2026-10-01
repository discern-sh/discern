/**
 * The layers that exist, as the package draws them, bottom to top. Each
 * product layer has exactly one view, and its view id is the id dismissals
 * name. Pure.
 */

import {
  type ApplicationKeyBinding,
  type ApplicationLayer,
  type TerminalApplicationView,
  validateTerminalApplicationView,
} from "discern-design-system/cli/interactive";
import type { DeskIntent, DeskLayer, DeskProductState } from "./desk_state.ts";
import { rowRef } from "./desk_transitions.ts";
import {
  actionsMenu,
  agentsMenu,
  branchMenu,
  goneMenu,
  scriptsLayer,
} from "./menu_view.ts";
import { deskPalette } from "./palette_view.ts";
import { deskReader, type DeskReaderEnv } from "./reader_view.ts";
import {
  deskForm,
  type DeskSheetEnv,
  progressSheet,
  quitSheet,
  resultSheetView,
  reviewSheet,
} from "./sheet_view.ts";

/** What layers read besides product state. */
export type DeskLayerEnv = DeskReaderEnv & DeskSheetEnv;

/**
 * One layer's view. Every layer the product holds is drawn, including one
 * whose subject left the observation, so only the owner closes a layer.
 */
function layerView(
  state: DeskProductState,
  layer: DeskLayer,
  env: DeskLayerEnv,
): ApplicationLayer<DeskIntent> {
  switch (layer.kind) {
    case "actions": {
      const ref = rowRef(state, layer.rowId);
      return ref?.kind === "task"
        ? actionsMenu(ref.row)
        : ref?.kind === "parked"
        ? branchMenu(state, ref.branch)
        : goneMenu(state, "actions", layer.rowId);
    }
    case "palette":
      return deskPalette(state);
    case "agents":
      return agentsMenu(state, layer.taskId);
    case "scripts":
      return scriptsLayer(state, layer.owner, layer.load);
    case "reader":
      return deskReader(state, layer.reader, env);
    case "review":
      return reviewSheet(state, layer);
    case "form":
      return deskForm(state, layer, env);
    case "result":
      return resultSheetView(state, layer.sheet);
    case "progress":
      return progressSheet(state, layer.operationId);
    case "quit":
      return quitSheet(state);
  }
}

/** Every open layer's view. */
export function deskLayers(
  state: DeskProductState,
  env: DeskLayerEnv,
): ApplicationLayer<DeskIntent>[] {
  return state.layers.map((layer) => layerView(state, layer, env));
}

/** The layer path a view issue names: `layers[2].challenge…` is layer 2. */
const LAYER_ISSUE = /^layers\[(\d+)\]/u;

/** The title of the sheet that stands in for a layer the package refuses. */
export const UNSHOWABLE_LAYER_TITLE = "This couldn't be shown";

/** What stands in for a layer that broke one of the package's rules. */
function unshowableLayer(
  id: string,
  issue: string,
): ApplicationLayer<DeskIntent> {
  return {
    kind: "sheet",
    id,
    scope: "global",
    title: UNSHOWABLE_LAYER_TITLE,
    state: "failed",
    banner: { tone: "danger", runs: [{ text: issue }] },
    body: [{
      kind: "text",
      runs: [{
        text:
          "Nothing ran. Close it and carry on; anything running beside the desk carries on too.",
      }],
    }],
    buttons: [{ id: "safe", label: "Close", role: "safe" }],
  };
}

/**
 * The view with every layer the package would refuse replaced by a sheet
 * that says it couldn't be shown, under the same id, so Escape closes it as
 * it would have closed the layer. A layer built from an unusual observation
 * therefore never ends the session, nor the operations running beside it.
 * TODO(R-11): the package should refuse a broken layer itself, keeping the
 * session.
 */
export function withShowableLayers(
  view: TerminalApplicationView<DeskIntent>,
  keymap: readonly ApplicationKeyBinding<DeskIntent>[],
  viKeys: boolean,
): TerminalApplicationView<DeskIntent> {
  const layers = view.layers ?? [];
  if (layers.length === 0) return view;
  const broken = new Map<number, string>();
  for (
    const issue of validateTerminalApplicationView(view, {
      keymap,
      viKeys,
    })
  ) {
    const index = LAYER_ISSUE.exec(issue.path)?.[1];
    if (index !== undefined && !broken.has(Number(index))) {
      broken.set(Number(index), `${issue.path} ${issue.message}`);
    }
  }
  return broken.size === 0 ? view : {
    ...view,
    layers: layers.map((layer, index) => {
      const issue = broken.get(index);
      return issue === undefined ? layer : unshowableLayer(layer.id, issue);
    }),
  };
}
