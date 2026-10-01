/**
 * The Desk's product state machine, driven without a terminal: a Desk that
 * has adopted an observation, the survey it asked for completing or failing,
 * and one intent as the package would report it.
 */

import {
  type DeskIntent,
  deskProduct,
  type DeskProductState,
  type DeskTransition,
  type DeskUi,
  initialDeskProduct,
} from "../../src/engine/desk/desk_state.ts";
import type {
  StatusData,
  StatusFleetEntry,
} from "../../src/shared/result_schemas.ts";
import { mainFleetEntry, statusData, taskFleetEntry } from "../status_fleet.ts";
import type { DeskReview } from "../../src/engine/desk/flow_types.ts";
import {
  formValuesKey,
  layerId as layerIdOf,
} from "../../src/engine/desk/desk_transitions.ts";

/** The wall time product events carry. */
export const PRODUCT_NOW = Date.parse("2026-07-11T12:00:00Z");

/** The package state of a screen with nothing selected or open. */
export const PRODUCT_UI: DeskUi = { zoomed: false, fields: {} };

/** What views read besides product state. */
export const PRODUCT_VIEW_ENV = {
  now: PRODUCT_NOW,
  root: "/project",
  version: "1.0.0",
  launches: [],
} as const;

/** A survey of the main checkout plus `fleet`. */
export function productSurvey(
  fleet: readonly StatusFleetEntry[],
  patch: Partial<StatusData> = {},
): StatusData {
  return statusData([mainFleetEntry(), ...fleet], patch);
}

/** A task that has work in its checkout. */
export function editingTask(id: string, changed = 2): StatusFleetEntry {
  return taskFleetEntry(id, {
    clean: false,
    changed_files: changed,
    last_activity: "2026-07-11T11:00:00Z",
  });
}

/** The survey the state machine asked for completes with `data`. */
export function observeDesk(
  state: DeskProductState,
  data: StatusData,
  now = PRODUCT_NOW,
): DeskTransition {
  const pending = state.survey.inFlight
    ? state
    : deskProduct(state, { kind: "refresh" }).state;
  return deskProduct(pending, {
    kind: "observed",
    generation: pending.survey.generation,
    now,
    data,
    hints: [],
    exceptionArgvs: new Map(),
  });
}

/** The survey the state machine asked for fails. */
export function failDesk(
  state: DeskProductState,
  now = PRODUCT_NOW,
): DeskTransition {
  const pending = state.survey.inFlight
    ? state
    : deskProduct(state, { kind: "refresh" }).state;
  return deskProduct(pending, {
    kind: "observation-failed",
    generation: pending.survey.generation,
    now,
    error: "status failed",
  });
}

/** A Desk before its first survey. */
export function freshDesk(): DeskProductState {
  return initialDeskProduct({
    trunk: "main",
    preferences: { schema_version: 2 },
  });
}

/** A fresh Desk that has adopted one observation. */
export function observedDesk(
  data: StatusData,
  now = PRODUCT_NOW,
): DeskProductState {
  return observeDesk(freshDesk(), data, now).state;
}

/** The application clock product events carry. */
export const PRODUCT_CLOCK = 1_000;

/** One intent, as the package reports it with `ui`. */
export function deskIntent(
  state: DeskProductState,
  value: DeskIntent,
  ui: DeskUi = PRODUCT_UI,
): DeskTransition {
  return deskProduct(state, {
    kind: "intent",
    intent: value,
    ui,
    now: PRODUCT_NOW,
    clock: PRODUCT_CLOCK,
  });
}

/** A ready review whose confirm applies, with `patch` over its defaults. */
export function readyReview(
  question: string,
  patch: Partial<DeskReview> = {},
): DeskReview {
  return {
    question,
    lines: [],
    blockers: [],
    expected: { facts: {} },
    disclosures: { command: "discern example" },
    safeLabel: "Cancel",
    confirmLabel: "Go",
    alternatives: [],
    confirm: { kind: "apply", running: question },
    ...patch,
  };
}

/**
 * The read a review or form layer waits for, as the live Desk reports it:
 * numbered for that opening, and for a form, its current values.
 */
export function formRead(
  state: DeskProductState,
  layerId: string,
  review: DeskReview,
): DeskTransition {
  const layer = state.layers.find((candidate) =>
    layerIdOf(candidate) === layerId
  );
  return deskProduct(state, {
    kind: "prepared",
    layerId,
    read: layer?.kind === "review" || layer?.kind === "form"
      ? layer.read ?? 0
      : 0,
    result: { state: "ready", value: review },
    ...(layer?.kind === "form"
      ? { readFor: formValuesKey(layer.values) }
      : {}),
  });
}
