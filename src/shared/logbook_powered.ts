/**
 * The logbook-powered capabilities — the SINGLE source of truth for what an
 * owner gives up by setting `[project].logbook = false`, beside the other
 * closed-set registries (`verbs.ts`, `capabilities.ts`).
 *
 * The wording surfaces speak from this list rather than hand-copying it: the
 * config schema's `logbook` description renders it directly (so the generated
 * editor schema and config reference carry it by construction), while the
 * hand-authored surfaces — the config template's `[project]` comment block and
 * the logbook reference page — are held to every member's `phrase` verbatim by
 * `tests/logbook_powered_test.ts`. The same guard runs a reader census: every
 * authored module that calls a logbook read entry point must be claimed by a
 * member's `readers`, and every member must name a real reading module — so a
 * new reader can't ship without enrolling here, and a stale member can't
 * outlive its code.
 */

/** One capability the logbook feeds, and where its absence shows. */
export interface LogbookPoweredCapability {
  /** Stable kebab-case registry key. */
  readonly key: string;
  /**
   * The short user-facing phrase every wording surface carries verbatim.
   * Written to sit mid-sentence or as a list item on any surface: lowercase,
   * no trailing punctuation, backticks for anything the user types.
   */
  readonly phrase: string;
  /** The surface where the capability's absence shows when recording is off. */
  readonly surface: string;
  /** Repo-relative authored modules that read the logbook to provide it. */
  readonly readers: readonly string[];
}

/** Every capability that turns off (or freezes) with `[project].logbook = false`. */
export const LOGBOOK_POWERED: readonly LogbookPoweredCapability[] = [
  {
    key: "patterns-report",
    phrase: "the practice report (`discern patterns`)",
    surface: "`discern patterns`",
    readers: ["src/engine/logbook/patterns.ts"],
  },
  {
    key: "fleet-actions",
    phrase: "each worktree's last action and work in flight",
    surface: "the fleet survey in `discern status`",
    readers: ["src/engine/status/status.ts"],
  },
  {
    key: "fleet-activity-freshness",
    phrase: "fleet activity times that include verb runs",
    surface: "the fleet survey's `last_activity` column",
    readers: ["src/engine/status/status.ts"],
  },
  {
    key: "await-retry-pricing",
    phrase: "retry timing in `discern await` from typical run durations",
    surface: "`discern await` on a not-yet answer",
    readers: ["src/engine/await/await.ts"],
  },
  {
    key: "epoch-pin-trajectory",
    phrase: "config-change attribution and each standard's limit history",
    surface: "`discern patterns` trajectory findings",
    readers: ["src/engine/logbook/patterns.ts"],
  },
  {
    key: "inline-findings",
    phrase:
      "advisory findings on `status`, the `done` receipt, and `improvement`",
    surface: "`status` hints, the receipt tail, and `improvement`'s history",
    readers: [
      "src/engine/status/status.ts",
      "src/engine/gate/finish.ts",
      "src/engine/improve/rules.ts",
    ],
  },
  {
    key: "test-wait-estimate",
    phrase: "wait estimates when concurrent test runs queue",
    surface: "the queued-tests notice under `[gate].concurrent_test_runs`",
    readers: ["src/engine/gate/test_slots.ts"],
  },
  {
    key: "contained-idle-check",
    phrase: "the in-flight check on the contained-worktree offer",
    surface: "`worktree prune`, the fleet survey, and the desk",
    readers: ["src/engine/worktree/lifecycle.ts"],
  },
];

/**
 * The registry rendered as one sentence fragment for prose that lists what
 * recording feeds — the config schema's `logbook` description uses it, so the
 * generated schema and config reference can never trail the registry.
 */
export function logbookPoweredPhraseList(): string {
  return LOGBOOK_POWERED.map((m) => m.phrase).join("; ");
}
