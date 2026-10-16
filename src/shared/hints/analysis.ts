/**
 * Analysis hints: coupling, patterns, logbook findings, and improvement advice
 * derived from project history. Entries are registered here and fired only
 * through `HINTS` in `../hints.ts`.
 */

import {
  discernCommand,
  flag,
  ownerDiscernCommand,
  positional,
} from "../command_reference.ts";
import { defineHint } from "./define.ts";

/** The analysis catalog, keyed by hint id. */
export const ANALYSIS_HINTS = {
  /** Ownership notice for an explicit coupling input excluded from the model. */
  "coupling-generated-exclusion": defineHint<{
    path: string;
    group: string;
  }>({
    id: "coupling-generated-exclusion",
    category: "notice",
    audience: "all",
    when:
      "A coupling result excludes an input owned by a generated declaration.",
    family: "coupling-exclusion",
    example: { path: "build/reference.dat", group: "reference" },
    template: ({ path, group }): string =>
      `Coupling excluded \`${path}\` because \`[generated.${group}]\` owns it ` +
      "as a declared output. A declared output is a projection, so it is not an " +
      "independent change partner.",
  }),

  /** Pair evidence when the files have never co-changed in the mined window. */
  "coupling-evidence-none": defineHint<{
    a: string;
    b: string;
    ofA: number;
    ofB: number;
  }>({
    id: "coupling-evidence-none",
    category: "notice",
    audience: "all",
    when: "A coupling query finds no shared commit history for the pair.",
    family: "coupling-evidence",
    example: {
      a: "src/main.ts",
      b: "tests/main_test.ts",
      ofA: 6,
      ofB: 4,
    },
    template: ({ a, b, ofA, ofB }): string =>
      `\`${a}\` and \`${b}\` have not changed together in recent history. ` +
      `The history examined includes ${ofA} commit${ofA === 1 ? "" : "s"} ` +
      `touching \`${a}\` and ${ofB} commit${ofB === 1 ? "" : "s"} touching ` +
      `\`${b}\`.`,
  }),

  /** Pair evidence summary; the result carries the bounded commit rows. */
  "coupling-evidence-summary": defineHint<{
    a: string;
    b: string;
    together: number;
    ofA: number;
    ofB: number;
  }>({
    id: "coupling-evidence-summary",
    category: "next-step",
    audience: "all",
    when: "A coupling query finds shared commit history for the pair.",
    family: "coupling-evidence",
    example: {
      a: "src/main.ts",
      b: "tests/main_test.ts",
      together: 3,
      ofA: 6,
      ofB: 4,
    },
    template: ({ a, b, together, ofA, ofB }): string => {
      const shareA = ofA > 0 ? ` (${Math.round((together / ofA) * 100)}%)` : "";
      const shareB = ofB > 0 ? ` (${Math.round((together / ofB) * 100)}%)` : "";
      return `Review the shared commits in this result. \`${a}\` and \`${b}\` ` +
        `changed together in ${together} recent commits: ${together} of the ` +
        `${ofA}${shareA} that touched \`${a}\`, and ${together} of the ` +
        `${ofB}${shareB} that touched \`${b}\`.`;
    },
  }),

  /** Evidence overflow stays explicit after per-commit hint rows are removed. */
  "coupling-evidence-more": defineHint<{ more: number }>({
    id: "coupling-evidence-more",
    category: "next-step",
    audience: "all",
    when: "Shared coupling evidence exceeds the result cap.",
    family: "coupling-evidence",
    example: { more: 3 },
    template: ({ more }): string =>
      `Review the most recent shared commits in this result. ${more} older ` +
      `commit${more === 1 ? " is" : "s are"} outside the result cap.`,
  }),

  /** Diff-aware summary before the single strongest missing partner. */
  "coupling-diff-header": defineHint({
    id: "coupling-diff-header",
    category: "next-step",
    audience: "all",
    when:
      "Diff-aware coupling finds habitual partners missing from the change.",
    family: "coupling-partners",
    example: undefined,
    template: (): string =>
      "Review the strongest habitual partner missing from this branch's changes. " +
      "Coupling is advisory, based on recent git history, and not exhaustive.",
  }),

  /** The strongest diff-aware partner; all ranked partner rows stay in data. */
  "coupling-diff-partner": defineHint<{
    from: string;
    path: string;
    cochanges: number;
    of: number;
    confidence: number;
  }>({
    id: "coupling-diff-partner",
    category: "next-step",
    audience: "all",
    when: "Diff-aware coupling selects the strongest missing partner.",
    family: "coupling-partners",
    example: {
      from: "src/main.ts",
      path: "tests/main_test.ts",
      cochanges: 4,
      of: 5,
      confidence: 0.8,
    },
    template: ({ from, path, cochanges, of, confidence }): string =>
      `Start with \`${path}\`: it changed in ${cochanges} of the ${of} recent ` +
      `commits that touched \`${from}\` (${
        Math.round(confidence * 100)
      }%), and this branch changed \`${from}\` without it.`,
  }),

  /** Query summary before the single strongest co-change partner. */
  "coupling-query-header": defineHint<{ target: string }>({
    id: "coupling-query-header",
    category: "next-step",
    audience: "all",
    when: "A path coupling query finds one or more habitual partners.",
    family: "coupling-partners",
    example: { target: "src/main.ts" },
    template: ({ target }): string =>
      `Review the strongest file that usually changes with \`${target}\`. ` +
      "Coupling is advisory, based on recent git history, and not exhaustive.",
  }),

  /** The strongest query partner; all ranked partner rows stay in data. */
  "coupling-query-partner": defineHint<{
    path: string;
    target: string;
    cochanges: number;
    of: number;
    confidence: number;
  }>({
    id: "coupling-query-partner",
    category: "next-step",
    audience: "all",
    when: "A path coupling query selects the strongest partner.",
    family: "coupling-partners",
    example: {
      path: "tests/main_test.ts",
      target: "src/main.ts",
      cochanges: 4,
      of: 5,
      confidence: 0.8,
    },
    template: ({ path, target, cochanges, of, confidence }): string =>
      `Start with \`${path}\`: it changed in ${cochanges} of the ${of} recent ` +
      `commits that touched \`${target}\` (${Math.round(confidence * 100)}%).`,
  }),

  "coupling-more-partners": defineHint<{
    remaining: number;
    queryTarget: string | undefined;
  }>({
    id: "coupling-more-partners",
    category: "next-step",
    audience: "all",
    when: "A coupling result has more ranked partners than it displays.",
    family: "coupling-partners",
    example: { remaining: 3, queryTarget: "src/main.ts" },
    template: ({ remaining, queryTarget }): string => {
      const command = queryTarget === undefined
        ? discernCommand("coupling")
        : discernCommand("coupling", positional("file", queryTarget));
      return `Run ${command} to review ${remaining} more ranked ` +
        `partner${remaining === 1 ? "" : "s"}.`;
    },
  }),

  "coupling-strong-pair": defineHint<{ from: string; path: string }>({
    id: "coupling-strong-pair",
    category: "next-step",
    audience: "all",
    when:
      "A coupling pair changes together often enough to suggest an invariant.",
    family: "coupling-partners",
    example: { from: "src/main.ts", path: "tests/main_test.ts" },
    template: ({ from, path }): string =>
      `Add a forcing-function if \`${from}\` and \`${path}\` share an essential ` +
      "invariant. They change together almost every time. The `discern-cure-a-bug` " +
      "skill covers the pattern.",
  }),

  "patterns-logbook-empty": defineHint({
    id: "patterns-logbook-empty",
    category: "notice",
    audience: "all",
    when: "`patterns` finds no recorded logbook events.",
    example: undefined,
    template: (): string =>
      `Run ${
        discernCommand("patterns")
      } after the logbook records more verb runs. ` +
      "The logbook currently has no events; discern stores one local event per verb run under the repository's git directory.",
  }),

  "patterns-insufficient-evidence": defineHint<{
    young: number;
    total: number;
  }>({
    id: "patterns-insufficient-evidence",
    category: "notice",
    audience: "all",
    when: "One or more pattern detectors lack their minimum evidence.",
    example: { young: 4, total: 10 },
    template: ({ young, total }): string =>
      `${young} of ${total} detectors do not yet have their minimum evidence. ` +
      `Each reports insufficient evidence and makes no finding.`,
  }),

  "patterns-advisory-findings": defineHint({
    id: "patterns-advisory-findings",
    category: "next-step",
    audience: "all",
    when: "`patterns` reports one or more advisory findings.",
    example: undefined,
    template: (): string =>
      "Use each finding's next step to investigate or improve the practice.",
  }),

  "patterns-findings-capped": defineHint<{
    shown: number;
    total: number;
  }>({
    id: "patterns-findings-capped",
    category: "notice",
    audience: "all",
    when: "`patterns` elides findings beyond each detector's per-report bound.",
    example: { shown: 42, total: 93 },
    template: ({ shown, total }): string =>
      `The report keeps each detector's strongest findings — ${shown} of ` +
      `${total} shown, and every detector row still counts everything it ` +
      `found. ${
        discernCommand("patterns", flag("all"))
      } reports the complete list.`,
  }),

  "patterns-recording-off": defineHint({
    id: "patterns-recording-off",
    category: "notice",
    audience: "all",
    when: "`patterns` runs while logbook recording is off.",
    example: undefined,
    template: (): string =>
      "Recording is off ([project].record_logbook = false), so new runs aren't " +
      "recorded. This report reads the history that already exists.",
  }),

  "patterns-archive-selection": defineHint({
    id: "patterns-archive-selection",
    category: "next-step",
    audience: "all",
    when:
      "`patterns --logbook-file` cannot resolve a regular sealed archive basename.",
    family: "patterns-archive",
    example: undefined,
    template: (): string =>
      `${
        ownerDiscernCommand("patterns archives")
      } lists the sealed archive filenames that can be read.`,
  }),

  "patterns-lifecycle-confirmation": defineHint({
    id: "patterns-lifecycle-confirmation",
    category: "next-step",
    audience: "all",
    when:
      "A logbook reset or archive apply is requested outside an eligible terminal.",
    family: "patterns-lifecycle",
    example: undefined,
    template: (): string =>
      "Use --dry-run to inspect the plan without interaction, or re-run apply from terminal stdin and stdout outside CI and --plain, then explicitly answer Yes.",
  }),

  "patterns-reset-empty": defineHint({
    id: "patterns-reset-empty",
    category: "notice",
    audience: "all",
    when: "`patterns reset` finds no logbook to remove.",
    family: "patterns-reset",
    example: undefined,
    template: (): string =>
      "No logbook exists to remove because nothing has been recorded.",
  }),

  "patterns-reset-preview": defineHint({
    id: "patterns-reset-preview",
    category: "next-step",
    audience: "all",
    when: "`patterns reset --dry-run` previews a logbook deletion.",
    family: "patterns-reset",
    example: undefined,
    template: (): string =>
      "Run without `--dry-run` to delete the logbook. This preview removed nothing.",
  }),

  "patterns-reset-recording-resumes": defineHint({
    id: "patterns-reset-recording-resumes",
    category: "notice",
    audience: "all",
    when:
      "`patterns reset` deletes the logbook while recording remains enabled.",
    family: "patterns-reset",
    example: undefined,
    template: (): string =>
      "Set [project].record_logbook = false to stop recording. Otherwise, recording " +
      "resumes on the next verb run after this reset.",
  }),

  /**
   * The Proof-tail finding: one strongest current-branch observation plus the
   * count and the route to the full evidence report.
   */
  "logbook-proof-finding": defineHint<{
    count: number;
    summary: string;
  }>({
    id: "logbook-proof-finding",
    category: "next-step",
    audience: "all",
    when: "Proof carries the strongest current-branch logbook finding.",
    family: "logbook-inline-finding",
    example: {
      count: 2,
      summary: "This branch has repeated the same failed stage.",
    },
    template: ({ count, summary }): string =>
      `Run ${
        discernCommand("patterns")
      } for full evidence and next steps. The logbook ` +
      `has ${count} branch finding${count === 1 ? "" : "s"}. ${summary}`,
  }),

  /** An observed conflict recurrence attached to the current merge recovery. */
  "logbook-merge-conflict-finding": defineHint<{
    observed: string;
    next: string;
  }>({
    id: "logbook-merge-conflict-finding",
    category: "next-step",
    audience: "all",
    when:
      "An update or acceptance conflicts in a file with repeated local merge evidence.",
    family: "logbook-inline-finding",
    example: {
      observed: "A shared file conflicted across several efforts.",
      next:
        "Inspect whether independent entries can generate the shared artifact.",
    },
    template: ({ observed, next }): string => `${observed} ${next}`,
  }),

  /** A session-scoped finding rendered as its summary and next step. */
  "logbook-status-finding": defineHint<{
    summary: string;
    next: string;
  }>({
    id: "logbook-status-finding",
    category: "next-step",
    audience: "all",
    when: "`status` carries a session-scoped logbook finding.",
    family: "logbook-inline-finding",
    example: {
      summary: "The same worktree has been refused 3 times.",
      next: "Inspect its current branch and Proof.",
    },
    template: ({ summary, next }): string =>
      `${next} Logbook finding: ${summary}`,
  }),

  /** The audit names its missing input instead of reading as a clean bill. */
  "improvement-logbook-off": defineHint({
    id: "improvement-logbook-off",
    category: "notice",
    audience: "all",
    when:
      "`improvement` runs while logbook recording is off, so the practice-history group has nothing to read.",
    example: undefined,
    template: (): string =>
      "Practice-history findings aren't available because `[project].record_logbook` is off.",
  }),

  /** A failed score threshold recovers through the report's ranked action, not
   * through the threshold message alone. */
  "improvement-follow-next-action": defineHint({
    id: "improvement-follow-next-action",
    category: "next-step",
    audience: "all",
    when: "`improvement --min-score` reports a score below its threshold.",
    family: "improvement-recovery",
    example: undefined,
    template: (): string =>
      "Carry out the report's ranked next action, then re-run the same improvement command to measure the result against its threshold.",
    interactiveTemplate: (): string =>
      "Carry out the report's ranked next action, then re-run the same " +
      "improvement command to measure the result against its threshold.",
  }),
} as const;
