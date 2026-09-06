/** Reviewed files that remain in FTA's extreme complexity tail. */

/** One file-specific ceiling retained while a hotspot is decomposed. */
export interface ComplexityHotspotBudget {
  readonly file: string;
  readonly maxScore: number;
  readonly maxCyclo: number;
  readonly owner: string;
  readonly reason: string;
  readonly recovery: string;
}

/**
 * Populated from the pinned FTA 3.0.1 census. A row must disappear as soon as
 * its file falls below both extreme thresholds; no new row is automatic.
 */
export const COMPLEXITY_HOTSPOT_BUDGETS = [
  {
    file: "scripts/project_control_integrity.ts",
    maxScore: 108.17,
    maxCyclo: 266,
    owner: "project controls",
    reason:
      "One integrity runner coordinates several independent project-control audits.",
    recovery:
      "Extract one coherent audit family and remove this row when it leaves the extreme tail.",
  },
  {
    file: "scripts/duplication_census_lib.ts",
    maxScore: 102.08,
    maxCyclo: 243,
    owner: "maintenance tooling",
    reason:
      "The clone analyzer still combines syntax normalization, grouping, and reporting.",
    recovery:
      "Separate one analyzer phase behind a typed boundary, then remeasure the whole file.",
  },
  {
    file: "scripts/promise_effects.ts",
    maxScore: 97.04,
    maxCyclo: 218,
    owner: "maintenance tooling",
    reason:
      "Type-aware promise ownership inspection crosses several syntax and effect forms.",
    recovery:
      "Extract a cohesive inspection phase and retain exact enrollment and diagnostics.",
  },
  {
    file: "scripts/public_schema_compatibility.ts",
    maxScore: 103.46,
    maxCyclo: 257,
    owner: "public contracts",
    reason:
      "Schema compatibility comparison still centralizes many supported schema shapes.",
    recovery:
      "Split comparison by schema responsibility without duplicating compatibility rules.",
  },
  {
    file: "src/commands/docs.ts",
    maxScore: 114.35,
    maxCyclo: 301,
    owner: "documentation command",
    reason:
      "The docs command coordinates multiple discovery, filtering, and rendering modes.",
    recovery:
      "Move one complete mode behind a narrow boundary while preserving result envelopes.",
  },
  {
    file: "src/commands/setup.ts",
    maxScore: 134.11,
    maxCyclo: 401,
    owner: "setup lifecycle",
    reason:
      "Setup planning spans project discovery, configuration, and installation surfaces.",
    recovery:
      "Extract one setup responsibility while keeping the plan and apply phases explicit.",
  },
  {
    file: "src/engine/desk/desk.ts",
    maxScore: 116.29,
    maxCyclo: 287,
    owner: "desk engine",
    reason:
      "The desk coordinator combines task discovery, state projection, interaction, and live rendering.",
    recovery:
      "Separate one view responsibility and remove this row once both thresholds are clear.",
  },
  {
    file: "src/engine/gate/finish.ts",
    maxScore: 112.65,
    maxCyclo: 295,
    owner: "gate engine",
    reason:
      "Finish orchestration still owns several result and diagnostic responsibilities.",
    recovery:
      "Extract one cohesive finish responsibility and prove the file-level metric falls.",
  },
  {
    file: "src/engine/logbook/detectors.ts",
    maxScore: 162.73,
    maxCyclo: 599,
    owner: "logbook detectors",
    reason:
      "The detector catalogue implements many independent evidence classifiers in one module.",
    recovery:
      "Partition a detector family around its shared inputs and preserve canonical enrollment.",
  },
  {
    file: "src/engine/logbook/patterns.ts",
    maxScore: 109.87,
    maxCyclo: 248,
    owner: "logbook patterns",
    reason:
      "Pattern parsing and matching cover several rule forms in a single implementation.",
    recovery:
      "Extract a complete pattern form with shared parsing contracts and focused tests.",
  },
  {
    file: "src/engine/status/tty.ts",
    maxScore: 108.65,
    maxCyclo: 275,
    owner: "terminal status",
    reason:
      "Interactive status rendering combines multiple terminal states and presentation modes.",
    recovery:
      "Move one stable presentation responsibility behind a pure rendering boundary.",
  },
  {
    file: "src/engine/worktree/git.ts",
    maxScore: 148.68,
    maxCyclo: 516,
    owner: "worktree lifecycle",
    reason:
      "Git inspection and mutation helpers cover the full worktree lifecycle in one module.",
    recovery:
      "Extract a cohesive Git responsibility while retaining effect planning and diagnostics.",
  },
  {
    file: "src/engine/worktree/lifecycle.ts",
    maxScore: 174.52,
    maxCyclo: 661,
    owner: "worktree lifecycle",
    reason:
      "The lifecycle coordinator spans start, update, await, and acceptance workflows.",
    recovery:
      "Decompose one complete workflow without splitting the effort identity invariant.",
  },
  {
    file: "src/shared/hints.ts",
    maxScore: 102.11,
    maxCyclo: 138,
    owner: "result guidance",
    reason:
      "A large declarative hint catalogue crosses the score threshold despite low branching.",
    recovery:
      "Review catalogue ownership before extracting; do not split declarations merely for score.",
  },
  {
    file: "src/shared/result_markdown.ts",
    maxScore: 117.02,
    maxCyclo: 319,
    owner: "result presentation",
    reason:
      "Markdown projection handles the complete result envelope and its optional sections.",
    recovery:
      "Extract one result section renderer and preserve the one-envelope presentation contract.",
  },
  {
    file: "tests/patterns_test.ts",
    maxScore: 103.51,
    maxCyclo: 128,
    owner: "logbook tests",
    reason:
      "The broad pattern qualification suite is large but has comparatively low branching.",
    recovery:
      "Split only along real feature ownership while preserving shared behavioral coverage.",
  },
  {
    file: "tests/terminal_boundary_guard_test.ts",
    maxScore: 126.73,
    maxCyclo: 365,
    owner: "terminal guards",
    reason:
      "One structural suite qualifies several related terminal boundary invariants.",
    recovery:
      "Partition a complete invariant family without hand-copying the canonical scan set.",
  },
] as const satisfies readonly ComplexityHotspotBudget[];
