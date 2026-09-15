import { LOGBOOK_SELF_MUTATING_INVOCATIONS } from "./logbook_lifecycle.ts";

/**
 * The built-in CLI verb vocabulary and its logbook execution classification.
 *
 * Top-level verb names are the routing single source of truth. Logbook begin
 * events derive from that universe: every verb is effectful unless it belongs
 * to the explicit pure-observation set. Mixed command groups use exact
 * invocation overrides so their read forms remain completion-only.
 */

/** The top-level engine verbs Cliffy owns. */
export const KNOWN_ENGINE_VERBS: ReadonlySet<string> = new Set([
  "done",
  "prepare",
  "test",
  "queue",
  "await",
  "progress",
  "improvement",
  "standards",
  "checkpoints",
  "refresh",
  "tidy",
  "impact",
  "coupling",
  "patterns",
  "status",
  "desk",
  "enter",
  "accept",
  "update",
  "start",
  "worktree",
  "identity",
  "skills",
  "scripts",
  "mcp",
]);

/** The installer verbs Cliffy owns. */
export const KNOWN_INSTALLER_VERBS: ReadonlySet<string> = new Set([
  "setup",
  "upgrade",
  "uninstall",
  "doctor",
  "map",
  "docs",
  "help",
  "config",
  "licenses",
  "releases",
  "triangle",
]);

/** Every built-in verb the router dispatches itself. */
export const KNOWN_VERBS: ReadonlySet<string> = new Set<string>([
  ...KNOWN_INSTALLER_VERBS,
  ...KNOWN_ENGINE_VERBS,
]);

/**
 * Top-level verbs whose invocations only observe or host. Every other known
 * top-level verb can run project commands or change project state and therefore
 * receives an automatic logbook begin event.
 *
 * `await` reads only, yet deliberately stays OUT of this set: its begin event
 * is what lets a fleet row report a blocked agent as `running: await` while the
 * verb holds, so the wait itself is visible fleet activity.
 *
 * Mixed command groups stay outside this set. Their exact read forms are
 * classified below.
 */
export const LOGBOOK_PURE_OBSERVATION_VERBS: ReadonlySet<string> = new Set([
  "checkpoints",
  "coupling",
  "doctor",
  "identity",
  "impact",
  "improvement",
  "licenses",
  "mcp",
  "progress",
  "status",
  "triangle",
  "enter",
]);

/** Effectful top-level verbs, derived from the routing vocabulary. */
export const LOGBOOK_EFFECTFUL_VERBS: ReadonlySet<string> = new Set(
  [...KNOWN_VERBS].filter((verb) => !LOGBOOK_PURE_OBSERVATION_VERBS.has(verb)),
);

/**
 * Exact read invocations under otherwise effectful or mixed top-level verbs.
 * These append their completion event only.
 */
const LOGBOOK_READ_INVOCATIONS: ReadonlySet<string> = new Set([
  "config",
  "config array",
  "config explain",
  "config get",
  "config has",
  "config keys",
  "config subsections",
  "patterns",
  "patterns archives",
  "setup",
  "setup step",
  "setup verify",
  "skills",
  "skills list",
  "worktree",
]);

/** Whether an invocation belongs in the Logbook it may read or mutate. */
export function logbookInvocationIsRecorded(verb: string): boolean {
  return !LOGBOOK_SELF_MUTATING_INVOCATIONS.has(verb);
}

/** Whether this display-form invocation receives a logbook begin event. */
export function logbookVerbIsEffectful(
  verb: string,
  flags: readonly string[] = [],
): boolean {
  if (!logbookInvocationIsRecorded(verb)) {
    return false;
  }
  const topLevel = verb.split(" ")[0];
  if (
    topLevel === undefined || !LOGBOOK_EFFECTFUL_VERBS.has(topLevel)
  ) {
    return false;
  }
  if (verb === "docs" || verb === "map") {
    return flags.includes("output");
  }
  if (verb === "upgrade" && flags.includes("check")) {
    return false;
  }
  return !LOGBOOK_READ_INVOCATIONS.has(verb);
}

/** The explicit emergency action is part of accept, with a separate exact confirmation exchange. */
export const EMERGENCY_ACCEPT_ACTION = "emergency";

/** MCP queue admission selects the CLI accept --queue-only mode. */
export const QUEUE_ACCEPT_ACTION = "queue";
