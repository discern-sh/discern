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
 * current files needing review and missing failure evidence. The bar for a
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
    file: "tests/adr_citation_form_test.ts",
    reason: "hot in the recorded failure ranking; static citation-form scan",
  },
  {
    file: "tests/brand_mark_test.ts",
    reason: "hot in the recorded failure ranking; static brand-output checks",
  },
  {
    file: "tests/comment_currency_test.ts",
    reason: "hot in the recorded failure ranking; static comment scan",
  },
  {
    file: "tests/discern_checkpoint_policy_test.ts",
    reason:
      "checkpoint scope changes require policy parity; static config and matcher checks",
  },
  {
    file: "tests/engine_temp_artifacts_test.ts",
    reason: "hot in the recorded failure ranking; near-second artifact checks",
  },
  {
    file: "tests/feature_canon_agent_benefit_test.ts",
    reason:
      "at least six identified failed runs; five-file review executes in about half a second",
  },
  {
    file: "tests/feature_canon_human_benefit_test.ts",
    reason:
      "at least six identified failed runs; five-file review executes in about half a second",
  },
  {
    file: "tests/feature_canon_plain_register_test.ts",
    reason:
      "at least six identified failed runs; five-file review executes in about half a second",
  },
  {
    file: "tests/hint_surface_rendering_test.ts",
    reason: "hot in the recorded failure ranking; sub-second hint rendering",
  },
  {
    file: "tests/logbook_no_network_test.ts",
    reason:
      "at least six identified failed runs; five-file review executes in about half a second",
  },
  {
    file: "tests/logbook_test.ts",
    reason: "leads the recorded failure ranking; sub-second logbook unit suite",
  },
  {
    file: "tests/manual_curation_test.ts",
    reason:
      "successor to the hot map-curation guard; static manual corpus checks",
  },
  {
    file: "tests/map_frontmatter_test.ts",
    reason: "hot in the recorded failure ranking; static map metadata checks",
  },
  {
    file: "tests/module_loading_test.ts",
    reason:
      "recorded cold-import context leak; fresh-process isolation regression takes under a second",
  },
  {
    file: "tests/paths_write_surface_test.ts",
    reason: "hot in the recorded failure ranking; near-second surface checks",
  },
  {
    file: "tests/reference_docs_test.ts",
    reason:
      "at least six identified failed runs; five-file review executes in about half a second",
  },
  {
    file: "tests/site_design_system_runtime_test.ts",
    reason: "hot in the recorded failure ranking; sub-second runtime checks",
  },
  {
    file: "tests/site_prose_test.ts",
    reason: "hot in the recorded failure ranking; sub-second prose checks",
  },
  {
    file: "tests/skill_name_parity_test.ts",
    reason: "hot in the recorded failure ranking; sub-second parity checks",
  },
  {
    file: "tests/standard_metric_test.ts",
    reason: "sub-second measurement protocol and diagnostic-payload isolation",
  },
  {
    file: "tests/test_runner_test.ts",
    reason:
      "recorded runner-command failure; sub-second queue and allocation contracts",
  },
  {
    file: "tests/vocab_drift_test.ts",
    reason: "hot in the recorded failure ranking; static vocabulary scan",
  },
  {
    file: "tests/worktree_identity_test.ts",
    reason:
      "recorded post-retirement crash; identity and removed-directory regressions take about two seconds",
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
    file: "tests/engine_desk_tty_test.ts",
    reason: "hot on record, but an end-to-end TTY suite (measured ~25s)",
  },
  {
    file: "tests/engine_done_tty_test.ts",
    reason: "hot on record, but an end-to-end TTY suite (measured ~18s)",
  },
  {
    file: "tests/engine_json_purity_test.ts",
    reason:
      "hot on record, but drives engine subprocesses (measured ~12s alone)",
  },
  {
    file: "tests/engine_mcp_test.ts",
    reason: "hot on record, but an end-to-end MCP suite (measured ~63s)",
  },
  {
    file: "tests/engine_setup_handoff_test.ts",
    reason: "hot on record, but an end-to-end setup suite (measured ~13s)",
  },
  {
    file: "tests/engine_status_test.ts",
    reason: "hot on record, but an end-to-end status suite (measured ~70s)",
  },
  {
    file: "tests/flagship_terminal_capture_test.ts",
    reason: "hot on record, but renders terminal captures (measured ~12s)",
  },
  {
    file: "tests/interactive_tty_test.ts",
    reason: "hot on record, but an end-to-end TTY suite (measured ~5s)",
  },
  {
    file: "tests/result_schemas_test.ts",
    reason:
      "six identified failed runs, but retained 5C module cost is 264s; keep the complete native contract suite in the full gate",
  },
  {
    file: "tests/site_smoke_test.ts",
    reason: "hot on record, but serves the built site and needs the preflight",
  },
  {
    file: "tests/validation_evidence_test.ts",
    reason: "hot on record, but drives validation runs (measured ~10s)",
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
