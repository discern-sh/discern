/**
 * The words the Desk shows for its actions and commands. The action registry
 * (`src/engine/desk/model.ts`) and the command registry
 * (`src/engine/desk/commands.ts`) own each control's contract; this leaf module
 * holds only the ids and labels, because status recovery copy, hints, tips, and
 * plan titles quote them and must not import the Desk engine.
 *
 * A label ends with an ellipsis exactly when its control asks for more input or
 * a confirmation before it runs; the registry guard holds that rule.
 */

/** Every task action, in the registry's presentation order. */
export const DESK_ACTIONS = [
  "recovery",
  "retry_setup",
  "done",
  "accept",
  "submit",
  "update",
  "agent",
  "follow_up",
  "scripts",
  "jump",
  "inspect",
  "rename",
  "grant",
  "revoke_grant",
  "reclaim",
  "park",
  "drop",
] as const;

/** One task action ({@link DESK_ACTIONS}). */
export type DeskAction = (typeof DESK_ACTIONS)[number];

/** The one label each task action shows. */
export const DESK_ACTION_LABELS = {
  recovery: "Recovery steps",
  retry_setup: "Retry setup…",
  done: "Run checks…",
  accept: "Land…",
  submit: "Queue for landing…",
  update: "Update from main…",
  agent: "Open agent",
  follow_up: "Start follow-up…",
  scripts: "Run a script…",
  jump: "Open shell",
  inspect: "View changes",
  rename: "Rename…",
  grant: "Pre-authorize…",
  revoke_grant: "Revoke pre-authorization…",
  reclaim: "Reclaim checkout…",
  park: "Park…",
  drop: "Drop…",
} as const satisfies Record<DeskAction, string>;

/** Every Desk-level command: global routes, then branch-row and task routes. */
export const DESK_COMMANDS = [
  "new_task",
  "main_scripts",
  "landing",
  "parked",
  "main_checkout",
  "activity",
  "keys",
  "manual",
  "tip",
  "updates",
  "refresh",
  "sort",
  "details",
  "mouse",
  "quit",
  "resume",
  "branch_commits",
  "landed_proof",
  "progress",
] as const;

/** One Desk-level command ({@link DESK_COMMANDS}). */
export type DeskCommand = (typeof DESK_COMMANDS)[number];

/** The label each command shows; a toggle shows its first label until used. */
export const DESK_COMMAND_LABELS = {
  new_task: "New task…",
  main_scripts: "Run a script on main…",
  landing: "Landing",
  parked: "Parked branches",
  main_checkout: "Main checkout",
  activity: "Session activity",
  keys: "Keyboard shortcuts",
  manual: "Read the manual",
  tip: "Tip of the session",
  updates: "Check for updates…",
  refresh: "Refresh",
  sort: "Sort by title",
  details: "Hide details",
  mouse: "Turn mouse on",
  quit: "Quit",
  resume: "Resume…",
  branch_commits: "View commits",
  landed_proof: "View Proof",
  progress: "Show progress",
} as const satisfies Record<DeskCommand, string>;

/** The label a toggle command shows once it has been used. */
export const DESK_COMMAND_TOGGLED_LABELS = {
  sort: "Group by next step",
  details: "Show details",
  mouse: "Turn mouse off",
} as const satisfies Partial<Record<DeskCommand, string>>;

const ELLIPSIS = "…";

/** Whether a label promises more input or a confirmation before it runs. */
export function asksBeforeRunning(label: string): boolean {
  return label.endsWith(ELLIPSIS);
}

/** A label as a name inside a sentence or title: "Queue for landing". */
export function labelName(label: string): string {
  return asksBeforeRunning(label) ? label.slice(0, -ELLIPSIS.length) : label;
}
