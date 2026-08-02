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
  "improvement",
  "standards",
  "refresh",
  "tidy",
  "impact",
  "coupling",
  "patterns",
  "status",
  "desk",
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
  "preset",
  "map",
  "docs",
  "help",
  "config",
  "licenses",
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
  "coupling",
  "doctor",
  "identity",
  "impact",
  "improvement",
  "licenses",
  "mcp",
  "status",
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
  "config get",
  "config has",
  "config keys",
  "config subsections",
  "patterns",
  "setup",
  "setup step",
  "setup verify",
  "skills",
  "skills list",
  "worktree",
]);

const SETUP_EFFECT_FLAGS: ReadonlySet<string> = new Set([
  "agents",
  "allow-dirty",
  "branch-prefix",
  "brief",
  "config",
  "confirmed",
  "force",
  "map",
  "model",
  "name",
  "slug",
  "source-globs",
  "yes",
]);

/** Whether this display-form invocation receives a logbook begin event. */
export function logbookVerbIsEffectful(
  verb: string,
  flags: readonly string[] = [],
): boolean {
  const topLevel = verb.split(" ")[0];
  if (
    topLevel === undefined || !LOGBOOK_EFFECTFUL_VERBS.has(topLevel)
  ) {
    return false;
  }
  if (verb === "docs" || verb === "map") {
    return flags.includes("output");
  }
  if (verb === "setup") {
    return flags.some((flag) => SETUP_EFFECT_FLAGS.has(flag));
  }
  if (verb === "upgrade" && flags.includes("check")) {
    return false;
  }
  return !LOGBOOK_READ_INVOCATIONS.has(verb);
}
