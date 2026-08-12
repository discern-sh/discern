/**
 * The `patterns` verb's **wire vocabulary and data shapes** — the detector
 * enums the registry derives from, and the Zod schemas its `data` payloads
 * validate against.
 *
 * A dedicated module (rather than a section of `result_schemas.ts`) because
 * the logbook subsystem sits behind the no-network guard, which walks every
 * module it imports: this file's whole dependency footprint is Zod, so the
 * detector registry can share one vocabulary with the wire layer without
 * pulling the rest of the result-schema surface inside the wall.
 * `result_schemas.ts` re-exports everything here, so wire consumers keep one
 * import site.
 */

import { z } from "@zod/zod";

/** The detector families the `patterns` registry groups by: how agents behave,
 * how the gate fits the stack, how the task funnel flows, and how the numbers
 * move over time. SSOT for the family vocabulary — the schema enums below and
 * the engine's detector registry both derive from it. */
export const DETECTOR_FAMILIES = [
  "trajectory",
  "gate-fit",
  "behaviour",
  "funnel",
] as const;
/** One detector family ({@link DETECTOR_FAMILIES}). */
export type DetectorFamily = (typeof DETECTOR_FAMILIES)[number];

/** What a finding is ABOUT — the surface a later wave routes it to: one
 * branch's work, one conversation's runs, or the whole project. */
export const DETECTOR_SCOPES = ["branch", "session", "project"] as const;
/** One detector scope ({@link DETECTOR_SCOPES}). */
export type DetectorScope = (typeof DETECTOR_SCOPES)[number];

/** How costly a detector is to run: `inline` is cheap enough for the proof
 * and `status` to carry (a glance at recent events); `batch` runs only under
 * the `patterns` verb, so `done` never pays for longitudinal analysis. */
export const DETECTOR_TIERS = ["inline", "batch"] as const;
/** One detector tier ({@link DETECTOR_TIERS}). */
export type DetectorTier = (typeof DETECTOR_TIERS)[number];

/** How a detector's run turned out: it spoke (`fired`), it saw enough evidence
 * and found nothing (`quiet`), or the logbook is too young for it to speak
 * (`insufficient-evidence` — reported as such, never extrapolated past). */
export const DETECTOR_STATUSES = [
  "fired",
  "quiet",
  "insufficient-evidence",
] as const;
/** One detector status ({@link DETECTOR_STATUSES}). */
export type DetectorStatus = (typeof DETECTOR_STATUSES)[number];

/** Presentation vocabulary derived from a finding's recorded facts. */
export const PATTERN_FINDING_TONES = [
  "good",
  "neutral",
  "attention",
] as const;
/** One finding tone ({@link PATTERN_FINDING_TONES}). */
export type PatternFindingTone = (typeof PATTERN_FINDING_TONES)[number];

/** Maximum readings carried by one finding's compact trajectory series. */
export const PATTERNS_SERIES_MAX_POINTS = 24;

/** Maximum findings one detector contributes to the default report. The
 * ranked list keeps each detector's strongest evidence; `detectors` carries
 * every true count, and `--all` lifts the bound. Keeps the report — and the
 * wire result every surface serializes — bounded by the registry size instead
 * of growing with recorded history. */
export const PATTERNS_FINDINGS_PER_DETECTOR = 3;

/** Whether one numerical finding value was read directly from recorded events
 * or derived by a declared estimator. A confidence score is deliberately not
 * part of the vocabulary: uncertainty belongs in the denominator and
 * limitations. */
export const PATTERN_EVIDENCE_VALUE_KINDS = ["observed", "estimated"] as const;
export type PatternEvidenceValueKind =
  (typeof PATTERN_EVIDENCE_VALUE_KINDS)[number];

/** Maximum displayed readings for one condition. The full cardinality remains
 * explicit through `distinct` and `omitted`, so the wire stays bounded without
 * turning a sample into the complete set. */
export const PATTERN_EVIDENCE_CONDITION_VALUES_MAX = 16;

/** One controlled condition and a bounded sample of its recorded values. */
export const PatternEvidenceConditionSchema = z.strictObject({
  dimension: z.string().min(1),
  values: z.array(z.string()).min(1).max(
    PATTERN_EVIDENCE_CONDITION_VALUES_MAX,
  ),
  distinct: z.number().int().positive(),
  omitted: z.number().int().nonnegative(),
}).superRefine((condition, context) => {
  if (condition.distinct !== condition.values.length + condition.omitted) {
    context.addIssue({
      code: "custom",
      path: ["distinct"],
      message:
        "condition distinct count must equal displayed values plus omitted values",
    });
  }
});
export type PatternEvidenceCondition = z.infer<
  typeof PatternEvidenceConditionSchema
>;

/** Project distinct keyed readings into the bounded public condition shape.
 * Ordering and truncation affect display only; callers retain the complete
 * readings for comparison and signatures. */
export function boundedPatternEvidenceCondition(
  dimension: string,
  readings: readonly { key: string; label: string }[],
): PatternEvidenceCondition | undefined {
  const distinct = new Map(readings.map((reading) => [
    reading.key,
    reading.label,
  ]));
  const ordered = [...distinct.entries()].sort(([left], [right]) =>
    left.localeCompare(right)
  );
  if (ordered.length === 0) return undefined;
  const values = ordered.slice(0, PATTERN_EVIDENCE_CONDITION_VALUES_MAX)
    .map(([, label]) => label);
  return {
    dimension,
    values,
    distinct: ordered.length,
    omitted: ordered.length - values.length,
  };
}

/** The additive evidence contract shared by current and future findings. It
 * keeps coverage, validation provenance, controlled-condition boundaries,
 * exclusions, limitations, and observed/estimated value provenance separate
 * from the compatible flat numerical `evidence` map. */
export const PatternEvidenceBasisSchema = z.strictObject({
  kind: z.string().min(1),
  coverage: z.strictObject({
    comparable: z.number().int().nonnegative(),
    denominator: z.number().int().nonnegative(),
    unit: z.string().min(1),
  }).refine(
    (coverage) => coverage.comparable <= coverage.denominator,
    { message: "comparable evidence cannot exceed its denominator" },
  ),
  validation_state: z.strictObject({
    version: z.number().int().nonnegative().nullable(),
    complete: z.boolean(),
  }),
  matched_conditions: z.array(PatternEvidenceConditionSchema).max(16),
  differing_conditions: z.array(PatternEvidenceConditionSchema).max(16),
  legacy_events: z.number().int().nonnegative(),
  excluded_events: z.number().int().nonnegative(),
  limitations: z.array(z.string().min(1)).max(16),
  values: z.record(
    z.string(),
    z.strictObject({
      value: z.number(),
      kind: z.enum(PATTERN_EVIDENCE_VALUE_KINDS),
    }),
  ),
});
export type PatternEvidenceBasis = z.infer<typeof PatternEvidenceBasisSchema>;

/** One `patterns` finding: which detector spoke, its presentation tone and
 * one-line brief, an optional bounded trajectory series, what it observed (one
 * plain-count sentence), the named counts behind it, and the recommended next
 * step. `strength` is the report's ranking key — unitless, never evidence. */
export const PatternsFindingSchema = z.strictObject({
  detector: z.string(),
  family: z.enum(DETECTOR_FAMILIES),
  scope: z.enum(DETECTOR_SCOPES),
  tone: z.enum(PATTERN_FINDING_TONES),
  subject: z.string().optional(),
  brief: z.string(),
  series: z.array(z.number()).max(PATTERNS_SERIES_MAX_POINTS).optional(),
  observed: z.string(),
  evidence: z.record(z.string(), z.number()),
  basis: PatternEvidenceBasisSchema.optional(),
  strength: z.number(),
  next_step: z.string(),
}).superRefine((finding, context) => {
  if (finding.basis === undefined) {
    return;
  }
  const evidenceKeys = Object.keys(finding.evidence).sort();
  const valueKeys = Object.keys(finding.basis.values).sort();
  if (evidenceKeys.join("\0") !== valueKeys.join("\0")) {
    context.addIssue({
      code: "custom",
      path: ["basis", "values"],
      message:
        "structured evidence values must classify every flat evidence value exactly once",
    });
    return;
  }
  for (const key of evidenceKeys) {
    if (finding.basis.values[key]?.value !== finding.evidence[key]) {
      context.addIssue({
        code: "custom",
        path: ["basis", "values", key, "value"],
        message: `structured evidence value ${key} must equal flat evidence`,
      });
    }
  }
});
/** One patterns finding. */
export type PatternsFinding = z.infer<typeof PatternsFindingSchema>;

/** One detector's run in a `patterns` report: its registry identity, how many
 * qualifying events it saw against its threshold, and how it turned out —
 * `insufficient-evidence` is reported, never hidden. `findings` is the count;
 * the findings themselves ride the top-level ranked list. */
const patternsDetectorSchema = z.strictObject({
  id: z.string(),
  title: z.string(),
  family: z.enum(DETECTOR_FAMILIES),
  scope: z.enum(DETECTOR_SCOPES),
  tier: z.enum(DETECTOR_TIERS),
  status: z.enum(DETECTOR_STATUSES),
  considered: z.number().int(),
  threshold: z.number().int(),
  findings: z.number().int(),
});
/** One detector's reported run. */
export type PatternsDetector = z.infer<typeof patternsDetectorSchema>;

/** The logbook the report was read from, in counts: parsed events, skipped
 * torn/foreign lines, events set aside as one-time-setup work (recorded, kept,
 * but excluded from analysis), month files, the span, distinct branches seen,
 * and whether recording is currently on (`[project].logbook`) — the report
 * reads existing history either way. */
const patternsLogbookSchema = z.strictObject({
  source: z.discriminatedUnion("kind", [
    z.strictObject({ kind: z.literal("active") }),
    z.strictObject({
      kind: z.literal("archive"),
      filename: z.string(),
    }),
  ]),
  events: z.number().int(),
  unparsed: z.number().int(),
  setup_era: z.number().int(),
  months: z.number().int(),
  first_at: z.string().optional(),
  last_at: z.string().optional(),
  branches: z.number().int(),
  recording: z.boolean(),
});

/** Who plausibly drove the analyzed runs, scored by the reader from recorded
 * driver evidence — never stored, so a smarter release re-scores all history.
 * `analyzed` counts the analysis population (CI and previews excluded);
 * `agent`/`human`/`unknown` partition it. `identities` counts the runs whose
 * invocation-scoped evidence names exactly one agent, by stable catalogue id
 * with its display label — ambient host state and conflicting evidence
 * attribute nothing, so the identity counts can sum below `agent`. */
const patternsPopulationSchema = z.strictObject({
  analyzed: z.number().int(),
  agent: z.number().int(),
  human: z.number().int(),
  unknown: z.number().int(),
  identities: z.array(z.strictObject({
    agent: z.string(),
    label: z.string(),
    runs: z.number().int(),
  })),
});
/** The scored driver population of one report. */
export type PatternsPopulation = z.infer<typeof patternsPopulationSchema>;

/** The recorded order in which one change cycle first entered validation. */
export const VALIDATION_WORKFLOW_ROUTES = [
  "test-first",
  "commit-first",
  "unattributed",
] as const;
export type ValidationWorkflowRoute =
  (typeof VALIDATION_WORKFLOW_ROUTES)[number];

/** Counts shared by every validation-workflow route. */
const validationWorkflowRouteSchema = z.strictObject({
  route: z.enum(VALIDATION_WORKFLOW_ROUTES),
  cycles: z.number().int().nonnegative(),
  branches: z.number().int().nonnegative(),
  runs: z.number().int().nonnegative(),
  successful_cycles: z.number().int().nonnegative(),
  successful_runs: z.number().int().nonnegative(),
  failed_cycles: z.number().int().nonnegative(),
  failed_runs: z.number().int().nonnegative(),
  retried_cycles: z.number().int().nonnegative(),
  retry_runs: z.number().int().nonnegative(),
});

/** Per-verb validation-workflow counts. */
const validationWorkflowVerbSchema = z.strictObject({
  verb: z.enum(["prepare", "test", "done"]),
  runs: z.number().int().nonnegative(),
  branches: z.number().int().nonnegative(),
  clean: z.number().int().nonnegative(),
  dirty: z.number().int().nonnegative(),
  unknown: z.number().int().nonnegative(),
  successes: z.number().int().nonnegative(),
  failures: z.number().int().nonnegative(),
  retries: z.number().int().nonnegative(),
});

/** One cohort's workflow counts, after the shared cohort minimums admit it. */
const validationWorkflowCohortSchema = z.strictObject({
  agent: z.string(),
  label: z.string(),
  cycles: z.number().int().nonnegative(),
  runs: z.number().int().nonnegative(),
  test_first_cycles: z.number().int().nonnegative(),
  commit_first_cycles: z.number().int().nonnegative(),
  successful_cycles: z.number().int().nonnegative(),
  failed_cycles: z.number().int().nonnegative(),
  retried_cycles: z.number().int().nonnegative(),
});

/** Validation-workflow Stats: counts over runs, change cycles, and eligible
 * identity cohorts. The payload carries denominators rather than scores. */
const validationWorkflowStatsSchema = z.strictObject({
  runs: z.strictObject({
    total: z.number().int().nonnegative(),
    branches: z.number().int().nonnegative(),
    by_verb: z.array(validationWorkflowVerbSchema).length(3),
    evidence: z.strictObject({
      denominator: z.number().int().nonnegative(),
      complete: z.number().int().nonnegative(),
      incomplete: z.number().int().nonnegative(),
      legacy: z.number().int().nonnegative(),
      unattributed: z.number().int().nonnegative(),
    }),
    dirty_state: z.strictObject({
      denominator: z.number().int().nonnegative(),
      tracked_only: z.number().int().nonnegative(),
      untracked_only: z.number().int().nonnegative(),
      mixed: z.number().int().nonnegative(),
      unclassified: z.number().int().nonnegative(),
    }),
  }),
  cycles: z.strictObject({
    total: z.number().int().nonnegative(),
    branches: z.number().int().nonnegative(),
    routes: z.array(validationWorkflowRouteSchema).length(
      VALIDATION_WORKFLOW_ROUTES.length,
    ),
    precommit_to_clean_gate: z.strictObject({
      cycles: z.number().int().nonnegative(),
      branches: z.number().int().nonnegative(),
      runs: z.number().int().nonnegative(),
      retry_runs: z.number().int().nonnegative(),
    }),
  }),
  /** Present only when at least 2 cohorts clear the existing shared minimums. */
  cohorts: z.strictObject({
    denominator_cycles: z.number().int().nonnegative(),
    denominator_runs: z.number().int().nonnegative(),
    identities: z.array(validationWorkflowCohortSchema).max(10),
    below_minimum: z.strictObject({
      cohorts: z.number().int().nonnegative(),
      cycles: z.number().int().nonnegative(),
      runs: z.number().int().nonnegative(),
    }),
    unattributed: z.strictObject({
      cycles: z.number().int().nonnegative(),
      runs: z.number().int().nonnegative(),
    }),
  }).optional(),
});

/** The `--stats` payload — practice stats: the practice's countable feats,
 * read from the same analysis population as the detectors (CI runs, previews,
 * and setup-era events excluded). Counts and durations only, all local
 * evidence; nothing is scored and nothing is compared to anyone else's
 * numbers. Present exactly when the invocation asked for it.
 *
 * The cadence series (`per_day` and kin) cover the span's calendar days,
 * zero-filled, one point per run of `series_days_per_point` whole days —
 * 1 until the span outgrows the wire cap. They appear once the span holds
 * at least 2 days. */
export const PatternsStatsSchema = z.strictObject({
  /** Whole days each cadence-series point covers (the last point may cover
   * fewer). Present exactly when any series is. */
  series_days_per_point: z.number().int().optional(),
  /** Successful `accept` runs — accepted changes. Sums read from each
   * accepted change's recorded scale; a change recorded without one still
   * counts, contributing zero to the sums. */
  accepted: z.strictObject({
    count: z.number().int(),
    branches: z.number().int(),
    insertions: z.number().int(),
    deletions: z.number().int(),
    files: z.number().int(),
    commits: z.number().int(),
    /** Accepted changes whose recorded scale removed more lines than it
     * added. */
    cleanups: z.number().int(),
    /** Changes accepted per series point across the span. */
    per_day: z.array(z.number().int()).max(PATTERNS_SERIES_MAX_POINTS)
      .optional(),
    /** The largest single accepted change by changed lines, when any carried
     * a change scale. `branch` is absent when the event recorded none. */
    biggest: z.strictObject({
      branch: z.string().optional(),
      lines: z.number().int(),
      files: z.number().int(),
      day: z.string(),
    }).optional(),
    /** The UTC day with the most accepted changes (earliest such day on a
     * tie). */
    best_day: z.strictObject({
      day: z.string(),
      accepted: z.number().int(),
    }).optional(),
    /** Longest run of consecutive UTC days each with at least one accepted
     * change. */
    longest_streak: z.number().int(),
  }),
  /** `done` runs — the full gate. Streaks count consecutive `done` runs in
   * stream order across all branches; `check_hours` sums wall-clock time
   * across `done`, `prepare`, and `test` runs. */
  gate: z.strictObject({
    runs: z.number().int(),
    greens: z.number().int(),
    first_try_green_branches: z.number().int(),
    gated_branches: z.number().int(),
    longest_green_streak: z.number().int(),
    current_green_streak: z.number().int(),
    check_hours: z.number(),
    /** Green `done` runs per series point across the span. */
    greens_per_day: z.array(z.number().int()).max(PATTERNS_SERIES_MAX_POINTS)
      .optional(),
  }),
  /** How this project moves from working validation to a clean green Gate.
   * Change cycles and evidence boundaries are defined in the Patterns map. */
  validation_workflows: validationWorkflowStatsSchema,
  /** Completed start-to-accept cycles, matched the same way the funnel
   * detector matches them. Present once at least one cycle completed. */
  cycles: z.strictObject({
    /** Successful `start` runs that created a branch — the population the
     * completed cycles are drawn from. */
    started: z.number().int(),
    completed: z.number().int(),
    /** Completed cycles that finished inside 24 hours. */
    under_day: z.number().int(),
    median_hours: z.number(),
    fastest_hours: z.number(),
  }).optional(),
  /** The standards ratchet, read from pin events and the standard readings
   * recorded on gate runs: limits tightened, how many distinct standards
   * they cover, and how the measured values moved. */
  ratchet: z.strictObject({
    pins: z.number().int(),
    standards: z.number().int(),
    /** Average improvement across all measured standards per series point,
     * as a percent of each standard's first recorded reading — direction-
     * adjusted so better is always positive, which is what makes standards
     * on different scales comparable. Present once the span holds a series
     * and at least one standard was read twice. */
    trend: z.array(z.number()).max(PATTERNS_SERIES_MAX_POINTS).optional(),
    /** The standard whose reading improved the most against its first
     * recorded value, percent-normalized the same way. Absent when no
     * standard improved. */
    most_improved: z.strictObject({
      standard: z.string(),
      from: z.number(),
      to: z.number(),
      better_percent: z.number(),
    }).optional(),
  }),
  /** Attributed agent identities and their runs, segmented through the same
   * cohort seam the detectors use: identities below the reporting minimums
   * are counted but never listed, and the unattributed share is always
   * stated. Listed identities carry the most runs first. */
  agents: z.strictObject({
    detected: z.number().int(),
    /** Agent-driven runs per series point across the span. */
    per_day: z.array(z.number().int()).max(PATTERNS_SERIES_MAX_POINTS)
      .optional(),
    identities: z.array(z.strictObject({
      agent: z.string(),
      label: z.string(),
      runs: z.number().int(),
      done_runs: z.number().int(),
      greens: z.number().int(),
      /** This identity's runs per series point across the span. */
      per_day: z.array(z.number().int()).max(PATTERNS_SERIES_MAX_POINTS)
        .optional(),
    })).max(10),
    /** Identities whose runs sit below the cohort reporting minimums —
     * counted here, never listed. Absent when none. */
    below_minimum: z.strictObject({
      agents: z.number().int(),
      runs: z.number().int(),
    }).optional(),
    unattributed_runs: z.number().int(),
  }),
  /** How wide the practice ran: distinct branches driven, days with at least
   * one analyzed run against the span, and the day most branches were active. */
  breadth: z.strictObject({
    branches: z.number().int(),
    active_days: z.number().int(),
    span_days: z.number().int(),
    first_day: z.string().optional(),
    last_day: z.string().optional(),
    busiest_day: z.strictObject({
      day: z.string(),
      branches: z.number().int(),
    }).optional(),
    /** Distinct branches active per series point across the span; a point
     * covering several days keeps its peak day. */
    branches_per_day: z.array(z.number().int()).max(PATTERNS_SERIES_MAX_POINTS)
      .optional(),
    /** The most change branches in flight at one instant: each branch counts
     * from its first analyzed event to its last (a pause inside that window
     * stays in flight; after its last event a branch stops counting), and
     * the trunk is not a change. Absent before the first change branch. */
    peak_in_flight: z.strictObject({
      branches: z.number().int(),
      day: z.string(),
    }).optional(),
  }),
});
/** The `--stats` payload. */
export type PatternsStats = z.infer<typeof PatternsStatsSchema>;

/** `patterns` — the logbook read back as findings: `findings` ranked by
 * evidence strength, `detectors` reporting every registry member (fired,
 * quiet, or insufficient evidence), the `logbook` counts behind them, and the
 * scored driver `population`. By default `findings` keeps each detector's
 * strongest {@link PATTERNS_FINDINGS_PER_DETECTOR}; when that bound elided
 * anything, `findings_total` reports the uncapped count (absent means the
 * list is complete) and each detector row still counts everything it found.
 * `stats` joins when the invocation asked for practice stats
 * ({@link PatternsStatsSchema}). */
export const PatternsDataSchema = z.strictObject({
  logbook: patternsLogbookSchema,
  population: patternsPopulationSchema,
  findings: z.array(PatternsFindingSchema),
  findings_total: z.number().int().optional(),
  detectors: z.array(patternsDetectorSchema),
  stats: PatternsStatsSchema.optional(),
});
export type PatternsData = z.infer<typeof PatternsDataSchema>;

const logbookLifecycleFileSchema = z.strictObject({
  file: z.string(),
  bytes: z.number().int(),
});

const logbookLifecycleImpactSchema = z.strictObject({
  key: z.string(),
  phrase: z.string(),
  surface: z.string(),
});

/** `patterns reset` — the exact active history and capability evidence its
 * deletion (or `--dry-run` preview) covers. */
export const PatternsResetDataSchema = z.strictObject({
  dir: z.string(),
  removed: z.array(logbookLifecycleFileSchema),
  bytes: z.number().int(),
  events: z.number().int(),
  unparsed: z.number().int(),
  first_at: z.string().optional(),
  last_at: z.string().optional(),
  impacts: z.array(logbookLifecycleImpactSchema),
  recovery_path: z.string().optional(),
});
export type PatternsResetData = z.infer<typeof PatternsResetDataSchema>;

/** `patterns archive` — the reviewed active source and sealed destination. */
export const PatternsArchiveDataSchema = z.strictObject({
  source_dir: z.string(),
  destination_dir: z.string(),
  archive_file: z.string(),
  archive_path: z.string(),
  files: z.array(logbookLifecycleFileSchema),
  source_bytes: z.number().int(),
  archive_bytes: z.number().int(),
  events: z.number().int(),
  unparsed: z.number().int(),
  first_at: z.string().optional(),
  last_at: z.string().optional(),
  recovery_path: z.string().optional(),
});
export type PatternsArchiveData = z.infer<typeof PatternsArchiveDataSchema>;

/** One discoverable sealed archive and the tolerant counts inside it. */
export const PatternsArchiveEntrySchema = z.strictObject({
  filename: z.string(),
  events: z.number().int(),
  unparsed: z.number().int(),
  bytes: z.number().int(),
  first_at: z.string().optional(),
  last_at: z.string().optional(),
});
export type PatternsArchiveEntry = z.infer<
  typeof PatternsArchiveEntrySchema
>;

/** `patterns archives` — every sealed archive under the registered directory. */
export const PatternsArchivesDataSchema = z.strictObject({
  dir: z.string(),
  archives: z.array(PatternsArchiveEntrySchema),
});
export type PatternsArchivesData = z.infer<typeof PatternsArchivesDataSchema>;
