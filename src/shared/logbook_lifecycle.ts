/**
 * The destructive Logbook lifecycle action registry and its shared interaction
 * policy. Dispatch, recording, and the safety matrix derive from this one set,
 * so a new action cannot acquire a separate unattended apply path.
 */

/** One CLI-only action that replaces or removes the active Logbook. */
export interface LogbookLifecycleAction {
  readonly name: "reset" | "seal";
  readonly description: string;
}

/** Every action allowed to detach the active Logbook. */
export const LOGBOOK_LIFECYCLE_ACTIONS = [
  {
    name: "reset",
    description:
      "Permanently remove the active Logbook after terminal confirmation. Sealed archives and other Git-admin state remain.",
  },
  {
    name: "seal",
    description:
      "Seal the active event history into a timestamped archive and begin a fresh active Logbook after terminal confirmation.",
  },
] as const satisfies readonly LogbookLifecycleAction[];

/** One registered Logbook lifecycle action name. */
export type LogbookLifecycleActionName =
  (typeof LOGBOOK_LIFECYCLE_ACTIONS)[number]["name"];

/** Registered lifecycle action names in CLI order. */
export const LOGBOOK_LIFECYCLE_ACTION_NAMES:
  readonly LogbookLifecycleActionName[] = LOGBOOK_LIFECYCLE_ACTIONS.map((
    action,
  ) => action.name);

/** Exact invocation spellings deliberately omitted from their own Logbook. */
export const LOGBOOK_SELF_MUTATING_INVOCATIONS: ReadonlySet<string> = new Set(
  LOGBOOK_LIFECYCLE_ACTION_NAMES.map((name) => `patterns ${name}`),
);

/** The disposition of one lifecycle invocation before any mutation. */
export type LogbookLifecycleAccess = "preview" | "apply" | "refuse";

/**
 * Decide whether one invocation may preview, apply, or must refuse. The action
 * name is intentionally irrelevant: every present and future registry member
 * receives the same terminal-only policy.
 */
export function logbookLifecycleAccess(input: {
  readonly dryRun: boolean;
  readonly json: boolean;
  readonly interactive: boolean;
}): LogbookLifecycleAccess {
  if (input.dryRun) {
    return "preview";
  }
  if (input.json || !input.interactive) {
    return "refuse";
  }
  return "apply";
}
