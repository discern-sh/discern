/**
 * The operating-policy registry — the single source of truth for the core
 * policies carried by both discern's bundled instructions and its MCP server
 * instructions.
 *
 * MCP instructions render each required statement directly. The instructions
 * templates remain authored Markdown and must satisfy the same entry's probes.
 * A policy belongs here only when every declared surface must carry it.
 */

/** An authored surface that carries discern's core operating policies. */
export const OPERATING_POLICY_SURFACES = [
  "instructions-templates",
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
  "Do not surface progress until it returns. On `data.met: false`, resume " +
  "with `data.resume` without an update; repeat without a fixed limit until " +
  "met, stopped, or unnecessary. Never resume " +
  "`ok: false`; follow its recovery hint. Report only when the condition holds, the watch is " +
  "unnecessary, or an error needs action. Always respond to new user input.";

/** The effort boundary that decides whether `start` creates a worktree. */
export const WORKTREE_CONTINUITY_CORE =
  "One worktree lasts for an effort, across review feedback and " +
  "resumed sessions. If this effort already has one, continue at its recorded " +
  "path; pass `path` to every discern tool. If that path " +
  "is unavailable, ask for it instead of creating another.";

/** Render the continuity rule with the command name appropriate to its surface. */
export function worktreeContinuityPolicy(startCommand: string): string {
  return `${WORKTREE_CONTINUITY_CORE} Do not call ${startCommand} again.`;
}

/** Every core operating policy shared by the instructions and MCP instructions. */
export const OPERATING_POLICIES = [
  {
    id: "worktree-continuity",
    statement: worktreeContinuityPolicy("discern_start"),
    surfaces: OPERATING_POLICY_SURFACES,
    probes: [
      /one worktree[^.\n]{0,80}(?:an|the whole|the entire) (?:effort|line of work)/i,
      /review feedback/i,
      /resumed? (?:session|turn)s?/i,
      /effort already has one[^.\n]{0,100}(?:continue|resume|return)[^.\n]{0,80}recorded path/i,
      /path is unavailable[^.\n]{0,80}ask[^.\n]{0,100}creating another/i,
      /do not call `?discern(?:_| )start`? again/i,
    ],
  },
  {
    id: "worktree-first",
    statement:
      "On trunk, discern_start opens an isolated worktree and re-aims tools. Move " +
      "your own file operations too; otherwise edits hit trunk while the gate runs " +
      "in the worktree, so use `cd <path> &&` and pass `path` to every discern tool.",
    surfaces: OPERATING_POLICY_SURFACES,
    probes: [/(own|isolated) worktree/i, /discern_start/],
  },
  {
    id: "never-adopt",
    statement: "Never adopt another effort's idle or clean worktree.",
    surfaces: OPERATING_POLICY_SURFACES,
    probes: [/never (adopt|start work in one)/i, /another effort/i],
  },
  {
    id: "iterate-fast-loop",
    statement: "Iterate with discern_prepare or a reproduce command.",
    surfaces: OPERATING_POLICY_SURFACES,
    probes: [/discern_prepare/, /reproduce command/i, /iterat/i],
  },
  {
    id: "done-is-the-bar",
    statement: "Run discern_done on the final tree before claiming done.",
    surfaces: OPERATING_POLICY_SURFACES,
    probes: [/discern_done/, /final tree/i],
  },
  {
    id: "never-loosen",
    statement: "discern_done verifies no limit loosened.",
    surfaces: OPERATING_POLICY_SURFACES,
    probes: [/(never loosen|no limit loosened)/i],
  },
  {
    id: "update-behind",
    statement:
      "When behind, use discern_update; do not pre-check or hand-merge.",
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
      /do not surface progress until it returns/i,
      /data\.met: false/,
      /data\.resume.*without an update/i,
      /Report only when the condition holds/,
      /respond to new user input/i,
    ],
  },
  {
    id: "accept-on-handoff",
    statement:
      "Use discern_accept only with explicit consent or machine-verified " +
      "authority. A green gate is not permission.",
    surfaces: OPERATING_POLICY_SURFACES,
    probes: [
      /explicit\w*[^.\n]{0,80}(consent|hand\s?-?off)/i,
      /machine-verified[^.\n]{0,40}authority/i,
      /discern_accept/,
    ],
  },
  {
    id: "checkpoint-declarations",
    statement:
      "On discern_done, use met only for a satisfied served question; otherwise " +
      "use unmet with a short, owner-relevant, secret-free tradeoff. A " +
      "variance requires the owner to explicitly accept the exact declared-unmet " +
      "set; grants never cover it.",
    surfaces: OPERATING_POLICY_SURFACES,
    probes: [
      /^On discern_done,/,
      /served question/i,
      /\bmet\b[^.\n]{0,80}satisfied[^.\n]{0,80}question/i,
      /\bunmet\b[^.\n]{0,80}secret-free/i,
      /owner[^.\n]{0,80}explicitly accept/i,
      /exact[^.\n]{0,40}declared-unmet set/i,
      /grants never cover/i,
    ],
  },
  {
    id: "standalone-test-on-demand",
    statement:
      "discern_test runs complete tests on demand. discern_done includes them, " +
      "so the final gate needs no standalone preflight.",
    surfaces: OPERATING_POLICY_SURFACES,
    probes: [
      /discern_test[^.\n]{0,100}complete tests[^.\n]{0,60}on demand/i,
      /discern_done[^.\n]{0,100}includes them/i,
      /final gate[^.\n]{0,80}no standalone preflight/i,
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
