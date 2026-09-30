/**
 * Status survey fixtures for pure Desk, status, and worktree tests.
 *
 * One clean linked-worktree row, its fully observed and named-task forms, the
 * main checkout's row, and a main-checkout envelope around a fleet. Each case
 * overrides only the facts it exercises, so a new required survey field is
 * added here once rather than in every suite.
 */

import type {
  StatusData,
  StatusFleetEntry,
} from "../../src/shared/result_schemas.ts";

/** A clean linked-worktree row on `branch`, stored under `/worktrees/`. */
export function fleetEntry(
  patch: Partial<StatusFleetEntry> = {},
): StatusFleetEntry {
  const branch = patch.branch ?? "agent/task";
  return {
    path: `/worktrees/${branch}`,
    is_main: false,
    is_current: false,
    branch,
    clean: true,
    changed_files: 0,
    ahead: 0,
    behind: 0,
    ...patch,
  };
}

/** A linked worktree the survey fully observed: reachable, present, set up. */
export function observedFleetEntry(
  patch: Partial<StatusFleetEntry> = {},
): StatusFleetEntry {
  return fleetEntry({
    branch_reachable: true,
    filesystem: { state: "directory" },
    setup: { state: "ready", marker: "present" },
    ...patch,
  });
}

/** A started task with a recorded id: `agent/<id>` at `/worktrees/<id>`. */
export function taskFleetEntry(
  id: string,
  patch: Partial<StatusFleetEntry> = {},
): StatusFleetEntry {
  return observedFleetEntry({
    id,
    branch: `agent/${id}`,
    path: `/worktrees/${id}`,
    ...patch,
  });
}

/** The main checkout's row at `root`, surveyed from the main checkout. */
export function mainFleetEntry(
  root = "/project",
  patch: Partial<StatusFleetEntry> = {},
): StatusFleetEntry {
  return fleetEntry({
    path: root,
    branch: "main",
    is_main: true,
    is_current: true,
    ...patch,
  });
}

/** A status envelope observed from a clean, current main checkout. */
export function statusData(
  fleet: StatusFleetEntry[] | undefined = [],
  patch: Partial<StatusData> = {},
): StatusData {
  return {
    location: "main",
    root: "/project",
    project: "demo",
    worktree: null,
    git: {
      branch: "main",
      trunk: "main",
      clean: true,
      changed_files: 0,
      behind_trunk: 0,
      ahead_trunk: 0,
    },
    standards: [],
    ...(fleet === undefined ? {} : { fleet }),
    ...patch,
  };
}
