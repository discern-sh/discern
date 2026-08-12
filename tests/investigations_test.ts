/** Registry-driven tests for Patterns investigation synthesis. */

import { assert, assertEquals } from "@std/assert";
import {
  INVESTIGATION_RELATIONSHIPS,
  synthesizeInvestigations,
} from "../src/engine/logbook/investigations.ts";
import {
  type PatternEvidenceBasis,
  PatternInvestigationSchema,
  type PatternsFinding,
} from "../src/shared/patterns_vocabulary.ts";

/** Build one complete single-value evidence condition. */
function condition(
  dimension: string,
  value: string,
): PatternEvidenceBasis["matched_conditions"][number] {
  return { dimension, values: [value], distinct: 1, omitted: 0 };
}

/** Build a compact evidence basis for relationship fixtures. */
function basis(
  evidence: Readonly<Record<string, number>>,
  options: {
    setup?: string | undefined;
    completeValidation?: boolean | undefined;
    validationVersion?: number | null | undefined;
    legacy?: number | undefined;
    estimated?: readonly string[] | undefined;
    mixedSetup?: boolean | undefined;
  } = {},
): PatternEvidenceBasis {
  const setup = options.setup ?? "setup-a";
  return {
    kind: options.completeValidation === true
      ? "complete-validation-state"
      : "decision-evidence",
    coverage: {
      comparable: evidence.runs ?? evidence.readings ?? 5,
      denominator: evidence.denominator ?? evidence.runs ??
        evidence.readings ?? 5,
      unit: "recorded runs",
    },
    validation_state: {
      version: options.validationVersion ??
        (options.completeValidation === true ? 1 : null),
      complete: options.completeValidation === true,
    },
    matched_conditions: options.completeValidation === true
      ? [condition("execution-mode", "full-gate")]
      : [
        options.mixedSetup === true
          ? {
            dimension: "config-epoch",
            values: [setup, "setup-b"],
            distinct: 2,
            omitted: 0,
          }
          : condition("config-epoch", setup),
        condition("writer-release", "9.9.9"),
      ],
    differing_conditions: [],
    legacy_events: options.legacy ?? 0,
    excluded_events: 0,
    limitations: [],
    values: Object.fromEntries(
      Object.entries(evidence).map(([key, value]) => [
        key,
        {
          value,
          kind: options.estimated?.includes(key) === true
            ? "estimated" as const
            : "observed" as const,
        },
      ]),
    ),
  };
}

/** Build one raw finding while preserving production wire vocabulary. */
function finding(
  detector: string,
  evidence: Record<string, number>,
  options: {
    subject?: string;
    basis?: PatternEvidenceBasis;
  } = {},
): PatternsFinding {
  return {
    detector,
    family: detector === "standard-trajectory" ? "trajectory" : "gate-fit",
    scope: detector === "done-thrash" || detector === "skipped-prepare"
      ? "branch"
      : "project",
    tone: "attention",
    ...(options.subject === undefined ? {} : { subject: options.subject }),
    brief: `${detector} brief`,
    observed: `${detector} observed ${JSON.stringify(evidence)}`,
    evidence,
    ...(options.basis === undefined ? {} : { basis: options.basis }),
    strength: 10,
    next_step: `${detector} next step`,
  };
}

/** Build the valid or deliberately weakened validation relationship. */
function validationSources(
  options: { complete?: boolean; legacy?: number } = {},
): PatternsFinding[] {
  const divergence = {
    runs: 4,
    denominator: 4,
    red: 2,
    green: 2,
    excluded_outcomes: 0,
  };
  return [
    finding("same-tree-flake", divergence, {
      subject: "unit",
      basis: basis(divergence, {
        completeValidation: options.complete ?? true,
        legacy: options.legacy,
      }),
    }),
    finding("confirmed-rerun", { confirmed_runs: 3, branches: 1 }),
  ];
}

/** Build two branch findings for the feedback-loop relationship. */
function feedbackSources(
  options: { subject?: string; setup?: string; mixedSetup?: boolean } = {},
): PatternsFinding[] {
  const subject = options.subject ?? "agent/change";
  const streak = { consecutive_failures: 3, runs: 4 };
  const preflight = {
    prepare_preventable_failures: 2,
    done_runs: 4,
    distinct_clean_heads: 2,
    same_head_additional_runs: 0,
    fix_drift_failures: 1,
    regeneration_failures: 1,
    prepare_runs: 0,
  };
  return [
    finding("done-thrash", streak, {
      subject,
      basis: basis(streak, {
        setup: options.setup,
        mixedSetup: options.mixedSetup,
      }),
    }),
    finding("skipped-prepare", preflight, {
      subject,
      basis: basis(preflight, { setup: options.setup }),
    }),
  ];
}

/** Build the fail-fast and validation-cost scheduling sources. */
function schedulingSources(
  options: {
    setup?: string;
    costSetup?: string;
    savingsConflict?: boolean;
    legacy?: number;
  } = {},
): PatternsFinding[] {
  const later = {
    cancelled_jobs: 3,
    never_started_jobs: 0,
    later_distinct_failures: 3,
    additional_gate_rounds: 3,
    later_round_elapsed_seconds: 100,
    estimated_saved_tail_seconds: options.savingsConflict === true ? 200 : 40,
    conservative_saved_tail_seconds: 60,
    tail_duration_samples: 9,
    unestimated_tail_jobs: 0,
    branches: 1,
    recommendation_supported: 0,
  };
  const queued = {
    capped_runs: 6,
    median_wait_seconds: 40,
    median_execution_seconds: 100,
    wait_to_execution_pct: 40,
  };
  return [
    finding("masked-failures", later, {
      basis: basis(later, {
        setup: options.setup,
        legacy: options.legacy,
        estimated: [
          "estimated_saved_tail_seconds",
          "conservative_saved_tail_seconds",
        ],
      }),
    }),
    finding("slot-contention", queued, {
      basis: basis(queued, { setup: options.costSetup ?? options.setup }),
    }),
  ];
}

/** Build one mechanically eligible Standard trajectory. */
function varianceSource(
  subject = "coverage",
  options: {
    reversal?: number;
    failure?: number;
    recommendation?: number;
    legacy?: number;
  } = {},
): PatternsFinding {
  const evidence = {
    readings: 5,
    comparable_readings: 5,
    span_days: 5,
    pins: 0,
    first_value: 90,
    last_value: 92,
    mechanically_eligible: 1,
    recommendation_supported: options.recommendation ?? 0,
    current_measurement: 1,
    recent_failures: options.failure ?? 0,
    recent_reversals: options.reversal ?? 1,
    retired: 0,
    legacy_eligibility_readings: 0,
  };
  return finding("standard-trajectory", evidence, {
    subject,
    basis: basis(evidence, { legacy: options.legacy }),
  });
}

const VALID_FIXTURES: Record<string, PatternsFinding[]> = {
  "validation-instability": validationSources(),
  "feedback-loop": feedbackSources(),
  "validation-scheduling": schedulingSources(),
  "standard-variance": [varianceSource()],
};

Deno.test("investigation registry enrolls every relationship in shared invariants", () => {
  assertEquals(
    Object.keys(VALID_FIXTURES).sort(),
    INVESTIGATION_RELATIONSHIPS.map((relationship) => relationship.id).sort(),
    "a new relationship must add one valid fixture",
  );
  assertEquals(
    new Set(INVESTIGATION_RELATIONSHIPS.map((relationship) => relationship.id))
      .size,
    INVESTIGATION_RELATIONSHIPS.length,
    "relationship ids are stable and unique",
  );
  for (const relationship of INVESTIGATION_RELATIONSHIPS) {
    assert(relationship.requiredFindings.length > 0, relationship.id);
    assert(relationship.suppressors.length > 0, relationship.id);
    assertEquals(relationship.cohortPolicy, "pooled-only", relationship.id);
    for (const requirement of relationship.requiredFindings) {
      assert(requirement.kinds.length > 0, relationship.id);
      assert(
        requirement.kinds.every((kind) => kind.length > 0),
        relationship.id,
      );
    }
    const fixture = VALID_FIXTURES[relationship.id];
    assert(fixture !== undefined, relationship.id);
    const results = synthesizeInvestigations(fixture);
    assertEquals(results.length, 1, `${relationship.id} must synthesize`);
    PatternInvestigationSchema.parse(results[0]);
    assertEquals(
      results[0]?.id.startsWith(relationship.id),
      true,
      relationship.id,
    );
  }
});

Deno.test("investigations keep source findings and their denominators traceable", () => {
  const sources = [
    ...validationSources(),
    ...feedbackSources(),
    ...schedulingSources(),
    varianceSource(),
  ];
  const before = structuredClone(sources);
  const results = synthesizeInvestigations(sources);
  assertEquals(sources, before, "synthesis is a pure additive projection");
  assertEquals(results.length, 4);
  for (const investigation of results) {
    assert(investigation.observations.length > 0);
    assert(
      investigation.observations.every((observation) =>
        observation.denominator.value >= 0 &&
        observation.denominator.unit.length > 0
      ),
    );
    assertEquals(
      new Set(investigation.finding_ids),
      new Set(investigation.observations.map((entry) => entry.finding_id)),
    );
  }
});

Deno.test("investigation near misses and conflicting evidence leave raw findings only", () => {
  const nearMisses: PatternsFinding[][] = [
    validationSources({ complete: false }),
    feedbackSources().map((source, index) =>
      index === 1 ? { ...source, subject: "agent/other" } : source
    ),
    feedbackSources({ mixedSetup: true }),
    schedulingSources({ costSetup: "setup-b" }),
    schedulingSources({ savingsConflict: true }),
    schedulingSources({ legacy: 1 }),
    [varianceSource("coverage", { reversal: 0, failure: 0 })],
    [varianceSource("coverage", { recommendation: 1 })],
    [varianceSource("coverage", { legacy: 1 })],
  ];
  for (const sources of nearMisses) {
    assertEquals(synthesizeInvestigations(sources), []);
    assert(sources.length > 0, "raw findings remain available");
  }
});

Deno.test("investigation values retain observed and estimated provenance", () => {
  const [investigation] = synthesizeInvestigations(schedulingSources());
  assert(investigation !== undefined);
  const ledger = investigation.observations.find((observation) =>
    observation.finding_id === "masked-failures"
  );
  assert(ledger !== undefined);
  assertEquals(ledger.values.estimated_saved_tail_seconds?.kind, "estimated");
  assertEquals(ledger.values.later_round_elapsed_seconds?.kind, "observed");
  assert(
    investigation.interpretation.includes("supports") &&
      !investigation.interpretation.includes("caused"),
  );
});

Deno.test("cohort evidence cannot mint or alter pooled investigations", () => {
  const cohort = finding("cohort-done-thrash", {
    cohorts: 2,
    unattributed_runs: 4,
  });
  assertEquals(synthesizeInvestigations([cohort]), []);
  assertEquals(
    synthesizeInvestigations([...validationSources(), cohort]),
    synthesizeInvestigations(validationSources()),
  );
});

Deno.test("investigation order and deduplication are registry-stable", () => {
  const sources = [
    varianceSource("zeta"),
    ...schedulingSources(),
    ...feedbackSources(),
    varianceSource("alpha"),
    ...validationSources(),
    ...validationSources(),
  ];
  const expected = [
    "validation-instability",
    "feedback-loop/agent%2Fchange",
    "validation-scheduling",
    "standard-variance/alpha",
    "standard-variance/zeta",
  ];
  assertEquals(synthesizeInvestigations(sources).map(({ id }) => id), expected);
  assertEquals(
    synthesizeInvestigations([...sources].reverse()).map(({ id }) => id),
    expected,
  );
});
