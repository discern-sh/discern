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

/** Every core operating policy shared by the guidance and MCP instructions. */
export const OPERATING_POLICIES = [
  {
    id: "worktree-first",
    statement:
      "Starting work from the main checkout, which holds the trunk (the shared " +
      "landing branch)? Run discern_start to create your own isolated worktree: " +
      "it returns the new worktree's path and re-aims these tools at it, so your " +
      "later done/update/accept calls operate on the new worktree automatically. " +
      "You must still move your OWN file operations into that path: re-root " +
      "there, or if you can't change your working root, prefix every shell " +
      "command with `cd <path> &&` and pass `path` to every discern tool. " +
      "Otherwise edits land on the trunk while the gate runs in the worktree.",
    surfaces: OPERATING_POLICY_SURFACES,
    probes: [/(own|isolated) worktree/i, /discern_start/],
  },
  {
    id: "never-adopt",
    statement:
      "NEVER adopt an existing idle worktree; each is another line of work, " +
      "and a clean working tree doesn't mean it's free.",
    surfaces: OPERATING_POLICY_SURFACES,
    probes: [/never (adopt|start work in one)/i],
  },
  {
    id: "done-is-the-bar",
    statement:
      "Before calling any change done, run discern_done on the final tree " +
      "(the full gate).",
    surfaces: OPERATING_POLICY_SURFACES,
    probes: [/discern_done/, /final tree/i],
  },
  {
    id: "iterate-fast-loop",
    statement:
      "While iterating, use discern_prepare (the fast fix-then-check loop) " +
      "and discern_test (just the tests).",
    surfaces: OPERATING_POLICY_SURFACES,
    probes: [/discern_prepare/, /iterat/i],
  },
  {
    id: "await-longest-safe",
    statement:
      "Wait for a sibling branch to go green, its work to land, or the trunk " +
      "to move with discern_await. Make one call and let it use the longest " +
      "safe bound; do not shorten it for progress updates. If it answers not " +
      "met, continue with data.resume until the condition holds, the user " +
      "stops, or the task no longer needs it. An ok:false refusal has no " +
      "continuation; follow its recovery hint.",
    surfaces: OPERATING_POLICY_SURFACES,
    probes: [/discern_await/, /longest[ -]safe/i, /progress/, /resume/],
  },
  {
    id: "never-loosen",
    statement:
      "Quality standards — numbers that can never get worse — are enforced " +
      "by discern_done itself: every run verifies no limit loosened versus " +
      "the trunk and measures each standard alongside the tests.",
    surfaces: OPERATING_POLICY_SURFACES,
    probes: [/(never loosen|no limit loosened)/i],
  },
  {
    id: "accept-on-handoff",
    statement:
      "Only when the user explicitly asks to hand off or land a finished " +
      'branch ("accept this", "I\'ll take it from here", "move this back to ' +
      '{{main_branch}}"), or a discern result reports machine-verified ' +
      "landing authority, should you use discern_accept. Do not treat a green " +
      "gate run alone as permission to accept; without either authority, stop " +
      "and report the branch ready for review.",
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
