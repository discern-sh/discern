/**
 * The operating-policy registry — the single source of truth for the core
 * policies carried by both discern's bundled guidance and its MCP server
 * instructions.
 *
 * MCP instructions render each required statement directly. The guidance
 * templates remain authored Markdown and must satisfy the same entry's probes.
 * A policy belongs here only when every declared surface must carry it.
 */

/** An authored surface that carries discern's core operating policies. */
export const OPERATING_POLICY_SURFACES = [
  "guidance-templates",
  "mcp-instructions",
] as const;

export type OperatingPolicySurface = (typeof OPERATING_POLICY_SURFACES)[number];

/** One core policy, its canonical statement, required surfaces, and probes. */
export interface OperatingPolicy {
  readonly id: string;
  readonly statement: string;
  readonly surfaces: readonly OperatingPolicySurface[];
  readonly probes: readonly RegExp[];
}

/** How an agent communicates while one resumable fleet watch is in progress. */
export const AWAIT_WATCH_POLICY =
  "Do not surface progress updates until it returns. On `data.met: false`, " +
  "continue with `data.resume` without surfacing an update; repeat with no " +
  "fixed limit until the condition is met, stopped, or unneeded. Never resume " +
  "`ok: false`; follow its recovery hint. Report only when the condition holds, the watch is " +
  "unnecessary, or a refusal/error needs action. Always respond to new user input.";

/** The effort boundary that decides whether `start` creates a worktree. */
export const WORKTREE_CONTINUITY_CORE =
  "One worktree lasts for the whole effort, including review feedback and " +
  "resumed sessions. If this effort already has a worktree, continue at its " +
  "recorded path and pass `path` to discern tools; if that path is unavailable, " +
  "ask for it instead of creating another.";

/** Render the continuity rule with the command name appropriate to its surface. */
export function worktreeContinuityPolicy(startCommand: string): string {
  return `${WORKTREE_CONTINUITY_CORE} Do not call ${startCommand} again.`;
}

/** Every core operating policy shared by the guidance and MCP instructions. */
export const OPERATING_POLICIES = [
  {
    id: "worktree-continuity",
    statement: worktreeContinuityPolicy("discern_start"),
    surfaces: OPERATING_POLICY_SURFACES,
    probes: [
      /one worktree[^.\n]{0,80}whole (?:effort|line of work)/i,
      /review feedback/i,
      /resumed? (?:session|turn)s?/i,
      /effort already has a worktree[^.\n]{0,100}(?:continue|resume|return)[^.\n]{0,80}recorded path/i,
      /path is unavailable[^.\n]{0,80}ask[^.\n]{0,100}creating another/i,
      /do not call `?discern(?:_| )start`? again/i,
    ],
  },
  {
    id: "worktree-first",
    statement:
      "On main, call discern_start only for a new effort with no worktree. It " +
      "creates an isolated worktree, re-aiming tools. Re-root file work " +
      "there; otherwise prefix shell commands with `cd <path> &&` and pass `path` " +
      "to discern tools. Edits otherwise land on trunk.",
    surfaces: OPERATING_POLICY_SURFACES,
    probes: [/(own|isolated) worktree/i, /discern_start/],
  },
  {
    id: "never-adopt",
    statement:
      "Never adopt another effort's worktree because it is idle or clean.",
    surfaces: OPERATING_POLICY_SURFACES,
    probes: [/never (adopt|start work in one)/i, /another effort/i],
  },
  {
    id: "iterate-fast-loop",
    statement:
      "While iterating, use discern_prepare for fix/check and discern_test for tests.",
    surfaces: OPERATING_POLICY_SURFACES,
    probes: [/discern_prepare/, /iterat/i],
  },
  {
    id: "done-is-the-bar",
    statement:
      "Before calling a change done, run discern_done on the final tree.",
    surfaces: OPERATING_POLICY_SURFACES,
    probes: [/discern_done/, /final tree/i],
  },
  {
    id: "never-loosen",
    statement: "discern_done verifies no limit loosened against the trunk.",
    surfaces: OPERATING_POLICY_SURFACES,
    probes: [/(never loosen|no limit loosened)/i],
  },
  {
    id: "update-behind",
    statement:
      "When behind the trunk, call discern_update instead of hand-merging or pre-checking.",
    surfaces: OPERATING_POLICY_SURFACES,
    probes: [/discern_update/, /behind/i],
  },
  {
    id: "await-longest-safe",
    statement:
      `Use discern_await in one longest-safe call to watch a sibling or trunk. ${AWAIT_WATCH_POLICY}`,
    surfaces: OPERATING_POLICY_SURFACES,
    probes: [
      /discern_await/,
      /longest[ -]safe/i,
      /do not surface progress updates until it returns/i,
      /data\.met: false/,
      /data\.resume.*without surfacing an update/i,
      /Report only when the condition holds/,
      /respond to new user input/i,
    ],
  },
  {
    id: "accept-on-handoff",
    statement:
      "Use discern_accept only with explicit conversation consent to land, or " +
      "machine-verified authority. A green gate is not permission; otherwise " +
      "report ready for review and stop.",
    surfaces: OPERATING_POLICY_SURFACES,
    probes: [
      /explicit\w*[^.\n]{0,80}(consent|hand\s?-?off)/i,
      /machine-verified[^.\n]{0,40}authority/i,
      /discern_accept/,
    ],
  },
] as const satisfies readonly OperatingPolicy[];

/** The policy statements one authored surface must carry, in registry order. */
export function operatingPolicyStatementsFor(
  surface: OperatingPolicySurface,
): readonly string[] {
  return OPERATING_POLICIES
    .filter((policy) => policy.surfaces.includes(surface))
    .map((policy) => policy.statement);
}
