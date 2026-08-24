/**
 * The canary test registry — the judgment calls behind `[jobs.canary]`.
 *
 * The canary is the subset of the suite that fails most often for the least
 * runtime: the content and structure guards agents trip while rephrasing
 * gated wording, plus a few cheap unit suites with a hot failure record. It
 * runs as a check-stage job, so `discern prepare` reports a tripped member in
 * seconds and a red canary ends the Gate's concurrent check/test group early
 * instead of waiting out the full suite. Every member also runs in the full
 * test stage: the canary changes when a failure is reported, never what a
 * green gate proves.
 *
 * Membership has two sources:
 *  - CONVENTION — every module matching {@link CANARY_CONVENTION_PATTERN}
 *    (the guard and enrolment classes) is a member the moment it exists, so
 *    a new guard is protected from its first commit;
 *  - REGISTRY — {@link CANARY_EXTRA_TEST_FILES} adds hot files outside the
 *    convention, and {@link CANARY_EXCLUDED_TEST_FILES} removes or refuses
 *    members that cannot hold the seconds bar. Each entry records its reason.
 *
 * Membership is judged on evidence: `discern scripts canary-audit` ranks the
 * Logbook's recorded per-file test failures against this registry and names
 * files whose membership looks wrong in either direction. The bar for a
 * member is hot AND cheap — worth hearing about early, and near-free to ask.
 */

/** One registry judgment: a test module and the one-line reason it is here. */
export interface CanaryRegistryEntry {
  /** Repo-relative test module path (`tests/..._test.ts`). */
  readonly file: string;
  /** Why this file is (or cannot be) a canary member, in one line. */
  readonly reason: string;
}

/**
 * The filename convention that auto-enrols the guard class: content/structure
 * guards and closed-set enrolment checks (both spellings). These modules are
 * static reads of the tree — the cheap, frequently-tripped class the canary
 * exists to surface early.
 */
export const CANARY_CONVENTION_PATTERN: RegExp =
  /_(?:guard|enrol{1,2}ment)_test\.ts$/;

/**
 * Hot files outside the naming convention, promoted on recorded failure
 * evidence. Keep entries cheap: a member that cannot run in about a second
 * belongs in {@link CANARY_EXCLUDED_TEST_FILES} with its measurement instead.
 */
export const CANARY_EXTRA_TEST_FILES: readonly CanaryRegistryEntry[] = [
  {
    file: "tests/brand_mark_test.ts",
    reason: "hot in the recorded failure ranking; static brand-output checks",
  },
  {
    file: "tests/comment_currency_test.ts",
    reason: "hot in the recorded failure ranking; static comment scan",
  },
  {
    file: "tests/logbook_test.ts",
    reason:
      "leads the recorded failure ranking; sub-second logbook unit suite",
  },
  {
    file: "tests/map_curation_test.ts",
    reason: "hot in the recorded failure ranking; static map content checks",
  },
  {
    file: "tests/map_frontmatter_test.ts",
    reason: "hot in the recorded failure ranking; static map metadata checks",
  },
  {
    file: "tests/vocab_drift_test.ts",
    reason: "hot in the recorded failure ranking; static vocabulary scan",
  },
];

/**
 * Files deliberately kept out of the canary, each with the judgment recorded.
 * A convention-matching entry here is dropped from the canary; any other
 * entry records why a hot file was refused, so `canary-audit` reports it as a
 * settled decision instead of a standing candidate.
 */
export const CANARY_EXCLUDED_TEST_FILES: readonly CanaryRegistryEntry[] = [
  {
    file: "tests/cli_test.ts",
    reason: "hot on record, but spawns the CLI end-to-end; far over the bar",
  },
  {
    file: "tests/docs_test.ts",
    reason: "hot on record, but renders the docs end-to-end; over the bar",
  },
  {
    file: "tests/engine_json_purity_test.ts",
    reason:
      "hot on record, but drives engine subprocesses (measured ~12s alone)",
  },
];

/**
 * Resolve canary membership over the given repo-relative test modules:
 * convention matches minus exclusions, plus the registered extras, deduped
 * and sorted so the derived list is deterministic for any input order.
 */
export function canaryTestFiles(testModules: readonly string[]): string[] {
  const excluded = new Set(CANARY_EXCLUDED_TEST_FILES.map((e) => e.file));
  const members = new Set<string>();
  for (const file of testModules) {
    if (CANARY_CONVENTION_PATTERN.test(file) && !excluded.has(file)) {
      members.add(file);
    }
  }
  for (const extra of CANARY_EXTRA_TEST_FILES) {
    members.add(extra.file);
  }
  return [...members].sort();
}
