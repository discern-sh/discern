/** Reviewed modules below the product's per-module line coverage floor. */

import type { ModuleCoverageException } from "./coverage_lib.ts";

/** A useful behavioral floor: at least four of every five executable lines. */
export const MODULE_LINE_COVERAGE_FLOOR = 80;

/**
 * Temporary exact-path debts. A module may improve above its recorded value,
 * but may neither regress nor remain here after reaching the floor.
 */
export const MODULE_COVERAGE_EXCEPTIONS = [
  {
    path: "src/engine/worktree/accept_convergence.ts",
    measuredPct: 73.5,
    owner: "worktree lifecycle",
    reason:
      "The fail-open catch arms (refresh throw, smoke run-context failure, unreadable status) need fault injection; the sequence itself is covered end to end by the landing and emergency journeys.",
    recovery:
      "Inject one fault per catch arm through a seam the module owns, then remove this row.",
  },
  {
    path: "src/commands/setup_accept.ts",
    measuredPct: 69.3,
    owner: "setup lifecycle",
    reason: "Landing and recovery branches need isolated Git-state seams.",
    recovery:
      "Drive each acceptance refusal and recovery state through the result core.",
  },
  {
    path: "src/commands/upgrade.ts",
    measuredPct: 67.8,
    owner: "upgrade lifecycle",
    reason:
      "Reconciliation and partial-refresh branches span many filesystem states.",
    recovery:
      "Add behavioral fixtures for migration failures and partial refresh outcomes.",
  },
  {
    path: "src/engine/gate/gate_tty.ts",
    measuredPct: 73.5,
    owner: "gate presentation",
    reason:
      "Terminal layouts retain uncommon width and write-failure branches.",
    recovery:
      "Extend the terminal matrix across the remaining responsive and failure states.",
  },
  {
    path: "src/engine/gate/standard_proposals.ts",
    measuredPct: 74.4,
    owner: "Standards lifecycle",
    reason:
      "Transaction recovery spans stale, interrupted, and divergent stores.",
    recovery:
      "Exercise the remaining proposal reconciliation states through public results.",
  },
  {
    path: "src/engine/worktree/effort_grant_cleanup.ts",
    measuredPct: 63.3,
    owner: "worktree lifecycle",
    reason:
      "Grant cleanup spans Git-admin absence and corruption recovery states.",
    recovery:
      "Plant each missing, malformed, retained, and successfully reaped grant state.",
  },
  {
    path: "src/lib/docs_search.js",
    measuredPct: 47.6,
    owner: "documentation UI",
    reason:
      "Browser search interaction retains keyboard and navigation edge branches.",
    recovery:
      "Drive the remaining search, selection, and dismissal journeys in-browser.",
  },
  {
    path: "src/lib/refresh_file_ops.ts",
    measuredPct: 79.4,
    owner: "refresh subsystem",
    reason:
      "File reconciliation retains uncommon mode, symlink, and write-failure paths.",
    recovery:
      "Add filesystem fixtures for each remaining reconciliation outcome.",
  },
  {
    path: "src/lib/terminal_animation.ts",
    measuredPct: 32.1,
    owner: "terminal presentation",
    reason:
      "Interactive animation fallbacks and stream failures lack deterministic seams.",
    recovery:
      "Inject time and output adapters, then exercise every animation state transition.",
  },
  {
    path: "src/lib/worktree_hooks.ts",
    measuredPct: 75.9,
    owner: "worktree lifecycle",
    reason:
      "Provider hook delivery retains uncommon malformed and teardown outcomes.",
    recovery:
      "Cover every hook event, invalid payload, and cleanup response through adapters.",
  },
  {
    path: "src/shared/checkpoint_question_files.ts",
    measuredPct: 70.7,
    owner: "checkpoint subsystem",
    reason:
      "Question-file resolution spans Git-tree, deletion, and unreadable path states.",
    recovery:
      "Plant the remaining blob, path-shape, and read-failure combinations.",
  },
] as const satisfies readonly ModuleCoverageException[];
