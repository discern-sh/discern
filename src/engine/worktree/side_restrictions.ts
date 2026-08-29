/**
 * The **side-restriction registry** — the single source of truth for which
 * worktree-lifecycle operations may run only from one side of the
 * main-checkout / linked-worktree boundary.
 *
 * `assertOpSide` (git.ts) accepts ONLY keys of this registry, so an operation
 * cannot acquire a side restriction without declaring itself here — and a
 * declared entry with a `cli` surface auto-enrols in the wrong-side refusal
 * test (`tests/engine_worktree_test.ts` derives its cases via
 * {@link cliRefusalCases}), which drives every member through `--json` and
 * asserts the `precondition_failed` slug an agent branches on. A new lifecycle
 * verb therefore inherits both the guard and its coverage from one edit.
 *
 * Pure data with no imports, so the git layer (which enforces it) and the
 * tests (which iterate it) both read the one table without a cycle.
 */

/** The two sides of the boundary a restricted operation may be pinned to.
 * "main-checkout" is the LOCATION (the primary checkout), never the name of
 * the integration branch — branch names stay config-resolved (ADR 0048). */
export type WorktreeSide = "main-checkout" | "worktree";

/** One side-restricted lifecycle operation. */
export interface SideRestriction {
  /** The ONLY side the operation may run from; the other side is refused. */
  side: WorktreeSide;
  /** The user-facing operation name that prefixes the refusal message. */
  label: string;
  /**
   * How the CLI reaches this guard: the argv to run (`--json` capable — extra
   * tokens neutralize gates that would otherwise fire first, e.g. accept's
   * consent gate or a required positional the guard precedes), and the `verb`
   * the result envelope must carry. `null` marks an internal-only entry point
   * with no direct CLI invocation.
   */
  cli: { argv: readonly string[]; verb: string } | null;
}

/**
 * Every side-restricted lifecycle operation. `accept`'s guard is the one
 * sanctioned inline check (`buildAcceptPlan` diagnoses the boundary itself to
 * give accept-specific recovery advice); it is enrolled here so the derived
 * refusal test still proves its wrong-side run maps to the same slug.
 */
export const SIDE_RESTRICTED_OPS = {
  "worktree-setup": {
    side: "worktree",
    label: "discern worktree setup",
    cli: { argv: ["worktree", "setup"], verb: "worktree setup" },
  },
  "worktree-teardown": {
    side: "worktree",
    label: "discern worktree teardown",
    cli: { argv: ["worktree", "teardown"], verb: "worktree teardown" },
  },
  "worktree-rename": {
    side: "worktree",
    label: "discern worktree rename",
    cli: {
      argv: ["worktree", "rename", "Renamed task"],
      verb: "worktree rename",
    },
  },
  // The side guard precedes target resolution, so any placeholder target works.
  "worktree-drop": {
    side: "main-checkout",
    label: "discern worktree drop",
    cli: { argv: ["worktree", "drop", "any-target"], verb: "worktree drop" },
  },
  "worktree-park": {
    side: "main-checkout",
    label: "discern worktree park",
    cli: { argv: ["worktree", "park", "any-target"], verb: "worktree park" },
  },
  "worktree-prune": {
    side: "main-checkout",
    label: "discern worktree prune",
    cli: { argv: ["worktree", "prune", "--yes"], verb: "worktree prune" },
  },
  update: {
    side: "worktree",
    label: "discern update",
    cli: { argv: ["update"], verb: "update" },
  },
  start: {
    side: "main-checkout",
    label: "discern start",
    cli: { argv: ["start"], verb: "start" },
  },
  // --confirmed neutralizes the consent gate so the SIDE refusal is what fires.
  accept: {
    side: "worktree",
    label: "discern accept",
    cli: { argv: ["accept", "--confirmed"], verb: "accept" },
  },
  // The setup-time probe worktree is minted from the main checkout only.
  "worktree-probe": {
    side: "main-checkout",
    label: "worktree probe",
    cli: null,
  },
} as const satisfies Record<string, SideRestriction>;

/** One registry key — the only currency {@link assertOpSide} accepts. */
export type SideRestrictedOpName = keyof typeof SIDE_RESTRICTED_OPS;

/** One derived wrong-side CLI refusal case. */
export interface CliRefusalCase {
  op: string;
  side: WorktreeSide;
  argv: readonly string[];
  verb: string;
}

/**
 * Project the registry onto its CLI-reachable refusal cases — the derivation
 * the wrong-side refusal test iterates. Kept a pure function of its input so
 * the test can also feed it a synthetic fresh-named entry and prove a future
 * sibling enrols without any test edit.
 */
export function cliRefusalCases(
  ops: Record<string, SideRestriction> = SIDE_RESTRICTED_OPS,
): CliRefusalCase[] {
  return Object.entries(ops).flatMap(([op, r]) =>
    r.cli === null
      ? []
      : [{ op, side: r.side, argv: r.cli.argv, verb: r.cli.verb }]
  );
}
