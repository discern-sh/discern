/**
 * The layers that exist, as the package draws them, bottom to top. Each
 * product layer has exactly one view, and its view id is the id dismissals
 * name. Pure.
 */

import type { ApplicationLayer } from "discern-design-system/cli/interactive";
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
