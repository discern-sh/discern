/**
 * Pure synthesis of related Patterns findings into advisory investigation
 * paths. Raw findings remain authoritative and visible; this layer only
 * connects evidence that clears one registered relationship's declared
 * requirements.
 */

import {
  PATTERN_INVESTIGATION_OBSERVATIONS_MAX,
  type PatternEvidenceCondition,
  type PatternEvidenceValueKind,
  type PatternInvestigation,
  type PatternInvestigationBoundary,
  type PatternInvestigationObservation,
  PATTERNS_INVESTIGATIONS_MAX,
  type PatternsFinding,
} from "../../shared/patterns_vocabulary.ts";

interface EvidenceMinimum {
  key: string;
  atLeast: number;
}

interface FindingRequirement {
  /** Alternative detector ids accepted in this required relationship slot. */
  kinds: readonly string[];
  all: readonly EvidenceMinimum[];
  any?: readonly EvidenceMinimum[];
  basis: "required" | "optional";
}

type SetupRequirement =
  | "validation-source"
  | "shared-recorded-setup"
  | "source-established";

interface InvestigationRelationship {
  /** Stable investigation kind and registry order. */
  id: string;
  title: string;
  requiredFindings: readonly FindingRequirement[];
  /** `null` means validation identity is not part of this claim. */
  validationVersion: number | null;
  completeValidationState: boolean;
  setup: SetupRequirement;
  /** Explicit evidence conflicts that suppress synthesis, never raw findings. */
  suppressors: readonly string[];
  cohortPolicy: "pooled-only";
  produce(findings: readonly PatternsFinding[]): PatternInvestigation[];
}

const OBSERVED: PatternEvidenceValueKind = "observed";

/** The setup dimensions shared by decision findings. Client labels are
 * catalogue-derived, so the suffix is the stable part of that dimension. */
function isSetupDimension(dimension: string): boolean {
  return dimension === "config-epoch" || dimension === "writer-release" ||
    dimension.endsWith("-client-release");
}

/** A setup signature exists only when every recorded setup dimension carries
 * one complete value. Mixed or truncated eras stay visible as raw findings. */
function setupSignature(finding: PatternsFinding): string | undefined {
  const conditions =
    finding.basis?.matched_conditions.filter((condition) =>
      isSetupDimension(condition.dimension)
    ) ?? [];
  const config = conditions.find((condition) =>
    condition.dimension === "config-epoch"
  );
  const writer = conditions.find((condition) =>
    condition.dimension === "writer-release"
  );
  if (config === undefined || writer === undefined) return undefined;
  if (
    conditions.some((condition) =>
      condition.distinct !== 1 || condition.omitted !== 0 ||
      condition.values.length !== 1
    )
  ) {
    return undefined;
  }
  return conditions
    .map((condition) => `${condition.dimension}\0${condition.values[0] ?? ""}`)
    .sort()
    .join("\0");
}

/** Whether one finding clears a relationship slot's declared evidence floor. */
function meets(
  finding: PatternsFinding,
  requirement: FindingRequirement,
): boolean {
  if (!requirement.kinds.includes(finding.detector)) return false;
  if (requirement.basis === "required" && finding.basis === undefined) {
    return false;
  }
  if (
    !requirement.all.every((minimum) =>
      (finding.evidence[minimum.key] ?? Number.NEGATIVE_INFINITY) >=
        minimum.atLeast
    )
  ) {
    return false;
  }
  return requirement.any === undefined || requirement.any.length === 0 ||
    requirement.any.some((minimum) =>
      (finding.evidence[minimum.key] ?? Number.NEGATIVE_INFINITY) >=
        minimum.atLeast
    );
}

/** Select findings accepted by one declared relationship slot. */
function candidates(
  findings: readonly PatternsFinding[],
  requirement: FindingRequirement,
): PatternsFinding[] {
  return findings.filter((finding) => meets(finding, requirement));
}

/** Retain one source finding's prose, denominator, and value provenance. */
function sourceObservation(
  finding: PatternsFinding,
  denominator: { value: number; unit: string },
): PatternInvestigationObservation {
  return {
    finding_id: finding.detector,
    ...(finding.subject === undefined ? {} : { subject: finding.subject }),
    observed: finding.observed,
    denominator: finding.basis === undefined ? denominator : {
      value: finding.basis.coverage.denominator,
      unit: finding.basis.coverage.unit,
    },
    values: finding.basis?.values ?? Object.fromEntries(
      Object.entries(finding.evidence).map(([key, value]) => [
        key,
        { value, kind: OBSERVED },
      ]),
    ),
  };
}

/** Keep only setup conditions that agree across every supplied basis. */
function uniqueConditions(
  conditions: readonly PatternEvidenceCondition[],
): PatternEvidenceCondition[] {
  const byDimension = new Map<string, PatternEvidenceCondition>();
  for (const condition of conditions) {
    const existing = byDimension.get(condition.dimension);
    if (existing === undefined) {
      byDimension.set(condition.dimension, condition);
      continue;
    }
    if (JSON.stringify(existing) !== JSON.stringify(condition)) {
      byDimension.delete(condition.dimension);
    }
  }
  return [...byDimension.values()].sort((left, right) =>
    left.dimension.localeCompare(right.dimension)
  );
}

/** Project the shared evidence boundary for one investigation. */
function evidenceBoundary(
  findings: readonly PatternsFinding[],
  options: {
    validationVersion: number | null;
    completeValidationState: boolean;
    limitations: readonly string[];
    setup?: readonly PatternEvidenceCondition[];
  },
): PatternInvestigationBoundary {
  const bases = findings.flatMap((finding) =>
    finding.basis === undefined ? [] : [finding.basis]
  );
  const versions = options.validationVersion === null
    ? []
    : [options.validationVersion];
  return {
    validation_versions: versions,
    complete_validation_state: options.completeValidationState,
    setup_conditions: uniqueConditions(
      options.setup ?? bases.flatMap((basis) => basis.matched_conditions),
    ),
    excluded_events: bases.reduce(
      (sum, basis) => sum + basis.excluded_events,
      0,
    ),
    limitations: [
      ...new Set([
        ...bases.flatMap((basis) => basis.limitations),
        ...options.limitations,
      ]),
    ].slice(0, 16),
  };
}

/** Build a stable investigation id, optionally scoped to one subject. */
function investigationId(kind: string, subject?: string): string {
  return subject === undefined
    ? kind
    : `${kind}/${encodeURIComponent(subject)}`;
}

/** Return source detector ids once, preserving declared relationship order. */
function sourceIds(findings: readonly PatternsFinding[]): string[] {
  return [...new Set(findings.map((finding) => finding.detector))];
}

/** Project source observations into one concrete investigation evidence line. */
function joinedObservation(findings: readonly PatternsFinding[]): string {
  return findings.map((finding) => finding.observed).join(" ");
}

/** Require complete current-version validation identity. */
function completeCurrentValidation(finding: PatternsFinding): boolean {
  return finding.basis?.validation_state.version === 1 &&
    finding.basis.validation_state.complete;
}

const validationInstability: InvestigationRelationship = {
  id: "validation-instability",
  title: "Validation instability",
  requiredFindings: [
    {
      kinds: ["same-tree-flake"],
      all: [{ key: "runs", atLeast: 2 }],
      basis: "required",
    },
    {
      kinds: ["confirmed-rerun"],
      all: [{ key: "confirmed_runs", atLeast: 3 }],
      basis: "optional",
    },
  ],
  validationVersion: 1,
  completeValidationState: true,
  setup: "validation-source",
  suppressors: [
    "incomplete validation evidence",
    "cross-context divergence without a matched-envelope verdict change",
  ],
  cohortPolicy: "pooled-only",
  produce(findings): PatternInvestigation[] {
    const divergent = candidates(
      findings,
      this.requiredFindings[0] ?? {
        kinds: [],
        all: [],
        basis: "required",
      },
    ).filter(completeCurrentValidation)[0];
    const reruns = candidates(
      findings,
      this.requiredFindings[1] ?? {
        kinds: [],
        all: [],
        basis: "optional",
      },
    )[0];
    if (divergent === undefined || reruns === undefined) return [];
    const sources = [divergent, reruns];
    return [{
      id: this.id,
      title: this.title,
      finding_ids: sourceIds(sources),
      ...(divergent.subject === undefined
        ? {}
        : { subject: divergent.subject }),
      observations: [
        sourceObservation(divergent, { value: 0, unit: "job-runs" }),
        sourceObservation(reruns, {
          value: reruns.evidence.confirmed_runs ?? 0,
          unit: "explicit Gate reruns",
        }),
      ],
      evidence_boundary: evidenceBoundary(sources, {
        validationVersion: this.validationVersion,
        completeValidationState: this.completeValidationState,
        setup: divergent.basis?.matched_conditions ?? [],
        limitations: [
          "The verdict change has complete recorded validation identity; explicit reruns are a project-level practice count and are not claimed to be the same job or setup.",
          "Correlation between the findings does not identify the unstable input or establish a cause.",
        ],
      }),
      summary:
        "One validation job changed verdict under matched recorded conditions, alongside repeated explicit Gate reruns.",
      observed: joinedObservation(sources),
      diagnostic_action:
        "Reproduce the named job under the recorded envelope, then vary one unrecorded input at a time before changing the Gate or retry policy.",
      falsifier:
        "The interpretation is weakened if controlled reproductions stay stable and explicit reruns stop without any validation change.",
    }];
  },
};

const feedbackLoop: InvestigationRelationship = {
  id: "feedback-loop",
  title: "Feedback loop",
  requiredFindings: [
    {
      kinds: ["done-thrash"],
      all: [{ key: "consecutive_failures", atLeast: 3 }],
      basis: "required",
    },
    {
      kinds: ["skipped-prepare"],
      all: [{ key: "prepare_preventable_failures", atLeast: 2 }],
      basis: "required",
    },
  ],
  validationVersion: null,
  completeValidationState: false,
  setup: "shared-recorded-setup",
  suppressors: ["different branches", "different or mixed recorded setups"],
  cohortPolicy: "pooled-only",
  produce(findings): PatternInvestigation[] {
    const streaks = candidates(
      findings,
      this.requiredFindings[0] ?? {
        kinds: [],
        all: [],
        basis: "required",
      },
    );
    const preflight = candidates(
      findings,
      this.requiredFindings[1] ?? {
        kinds: [],
        all: [],
        basis: "required",
      },
    );
    const investigations: PatternInvestigation[] = [];
    for (const streak of streaks) {
      const streakSetup = setupSignature(streak);
      const caught = preflight.find((finding) =>
        finding.subject === streak.subject && streakSetup !== undefined &&
        setupSignature(finding) === streakSetup
      );
      if (caught === undefined || streak.subject === undefined) continue;
      const sources = [streak, caught];
      investigations.push({
        id: investigationId(this.id, streak.subject),
        title: this.title,
        subject: streak.subject,
        finding_ids: sourceIds(sources),
        observations: [
          sourceObservation(streak, {
            value: streak.evidence.runs ?? 0,
            unit: "Gate runs in the conversation",
          }),
          sourceObservation(caught, {
            value: caught.evidence.done_runs ?? 0,
            unit: "full-Gate runs",
          }),
        ],
        evidence_boundary: evidenceBoundary(sources, {
          validationVersion: null,
          completeValidationState: false,
          limitations: [
            "The relationship joins one branch and recorded setup; it does not claim every red Gate in the conversation was preflight-preventable.",
          ],
        }),
        summary:
          "This branch had repeated red Gates and separate evidence of work that preflight could perform.",
        observed: joinedObservation(sources),
        diagnostic_action:
          "On the next comparable change, run `discern prepare`, review its exact changes, then reserve `discern done` for the clean committed tree and compare the resulting Gate rounds.",
        falsifier:
          "The interpretation is weakened if comparable changes still need the same full-Gate rounds after recorded preflight work is complete.",
      });
    }
    return investigations.slice(0, 3);
  },
};

/** Whether the existing evidence supports retaining fail-fast instead. */
function savingsConflict(finding: PatternsFinding): boolean {
  const estimated = finding.evidence.estimated_saved_tail_seconds;
  const later = finding.evidence.later_round_elapsed_seconds;
  return estimated !== undefined && later !== undefined &&
    estimated > later * 1.5;
}

const validationScheduling: InvestigationRelationship = {
  id: "validation-scheduling",
  title: "Validation scheduling experiment",
  requiredFindings: [
    {
      kinds: ["masked-failures"],
      all: [
        { key: "later_distinct_failures", atLeast: 3 },
        { key: "additional_gate_rounds", atLeast: 3 },
      ],
      basis: "required",
    },
    {
      kinds: ["dominant-stage", "generator-gate-share", "slot-contention"],
      all: [],
      basis: "required",
    },
  ],
  validationVersion: null,
  completeValidationState: false,
  setup: "shared-recorded-setup",
  suppressors: [
    "different or mixed recorded setups",
    "saved-tail estimate already exceeds later-round cost by 1.5 times",
    "incomplete decision evidence",
  ],
  cohortPolicy: "pooled-only",
  produce(findings): PatternInvestigation[] {
    const later = candidates(
      findings,
      this.requiredFindings[0] ?? {
        kinds: [],
        all: [],
        basis: "required",
      },
    ).find((finding) =>
      finding.basis !== undefined && !savingsConflict(finding)
    );
    if (later === undefined) return [];
    const setup = setupSignature(later);
    if (setup === undefined) return [];
    const cost = candidates(
      findings,
      this.requiredFindings[1] ?? {
        kinds: [],
        all: [],
        basis: "required",
      },
    ).find((finding) =>
      finding.basis !== undefined && setupSignature(finding) === setup
    );
    if (cost === undefined) return [];
    const sources = [later, cost];
    return [{
      id: this.id,
      title: this.title,
      finding_ids: sourceIds(sources),
      observations: [
        sourceObservation(later, {
          value: later.evidence.additional_gate_rounds ?? 0,
          unit: "adjacent red Gate pairs",
        }),
        sourceObservation(cost, {
          value: cost.evidence.runs ?? cost.evidence.capped_runs ?? 0,
          unit: cost.detector === "slot-contention"
            ? "capped validation runs"
            : "Gate runs",
        }),
      ],
      evidence_boundary: evidenceBoundary(sources, {
        validationVersion: null,
        completeValidationState: false,
        limitations: [
          "Later failures and validation delay occurred under one recorded setup; their adjacency does not show that scheduling caused either one.",
          "Any saved-tail seconds remain estimates; later-round elapsed time and queue waits are recorded observations.",
        ],
      }),
      summary:
        "Later Gate rounds exposed other failures while validation was long-running or queued under the same recorded setup.",
      observed: joinedObservation(sources),
      diagnostic_action:
        "Run one bounded comparison of the current schedule against a single alternative, keeping jobs and setup fixed, then compare later-round time, queue wait, and distinct failures.",
      falsifier:
        "The interpretation is weakened if the controlled alternative does not reduce later-round time or reveals the failures independently of scheduling.",
    }];
  },
};

const standardVariance: InvestigationRelationship = {
  id: "standard-variance",
  title: "Standard variance",
  requiredFindings: [{
    kinds: ["standard-trajectory"],
    all: [
      { key: "mechanically_eligible", atLeast: 1 },
      { key: "current_measurement", atLeast: 1 },
    ],
    any: [
      { key: "recent_failures", atLeast: 1 },
      { key: "recent_reversals", atLeast: 1 },
    ],
    basis: "required",
  }],
  validationVersion: null,
  completeValidationState: false,
  setup: "source-established",
  suppressors: [
    "pin recommendation already supported",
    "retired Standard",
    "mixed recorded setup",
  ],
  cohortPolicy: "pooled-only",
  produce(findings): PatternInvestigation[] {
    return candidates(
      findings,
      this.requiredFindings[0] ?? {
        kinds: [],
        all: [],
        basis: "required",
      },
    ).filter((finding) =>
      finding.subject !== undefined &&
      finding.evidence.recommendation_supported === 0 &&
      finding.evidence.retired === 0 &&
      finding.basis !== undefined &&
      setupSignature(finding) !== undefined
    ).slice(0, 3).map((finding) => ({
      id: investigationId(this.id, finding.subject),
      title: this.title,
      subject: finding.subject,
      finding_ids: [finding.detector],
      observations: [sourceObservation(finding, {
        value: finding.evidence.readings ?? 0,
        unit: "Standard readings",
      })],
      evidence_boundary: evidenceBoundary([finding], {
        validationVersion: null,
        completeValidationState: false,
        limitations: [
          "Mechanical pin eligibility is a Gate fact; recent reversals or failures make variance the investigation and suppress pin advice.",
        ],
      }),
      summary:
        `\`${finding.subject}\` is mechanically eligible to tighten, but its recent comparable readings are unstable.`,
      observed: finding.observed,
      diagnostic_action:
        `Run \`discern standards\` for a current \`${finding.subject}\` reading and inspect the recent comparable values before deciding whether the headroom is durable.`,
      falsifier:
        "Three current comparable, failure-free readings without a direction reversal would falsify the recent-variance concern.",
    }));
  },
};

/** The sole authority for cross-finding relationships. Each member declares
 * sources, evidence boundary, setup rule, minimums, suppressors, cohort
 * policy, and producer; registry-driven tests enroll future members. */
export const INVESTIGATION_RELATIONSHIPS: readonly InvestigationRelationship[] =
  [
    validationInstability,
    feedbackLoop,
    validationScheduling,
    standardVariance,
  ];

/** Deterministically synthesize a bounded, de-duplicated investigation list.
 * Input order is the already-ranked finding order; relationship order is the
 * registry order, and subjects break ties inside one producer. */
export function synthesizeInvestigations(
  findings: readonly PatternsFinding[],
): PatternInvestigation[] {
  const investigations = INVESTIGATION_RELATIONSHIPS.flatMap((relationship) =>
    relationship.produce(findings).sort((left, right) =>
      (left.subject ?? "").localeCompare(right.subject ?? "") ||
      left.id.localeCompare(right.id)
    )
  );
  const unique = new Map<string, PatternInvestigation>();
  for (const investigation of investigations) {
    if (!unique.has(investigation.id)) {
      unique.set(investigation.id, investigation);
    }
  }
  return [...unique.values()].slice(0, PATTERNS_INVESTIGATIONS_MAX).map(
    (investigation) => ({
      ...investigation,
      finding_ids: investigation.finding_ids.slice(
        0,
        PATTERN_INVESTIGATION_OBSERVATIONS_MAX,
      ),
      observations: investigation.observations.slice(
        0,
        PATTERN_INVESTIGATION_OBSERVATIONS_MAX,
      ),
    }),
  );
}
