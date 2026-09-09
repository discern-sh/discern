/**
 * Pure validation-comparison substrate for Patterns.
 *
 * Recorded job outcomes are observations, never part of a comparison key.
 * One condition registry accounts for every controlled v1 execution field;
 * strict comparisons project all of it, while cross-context comparisons may
 * differ only on dimensions the registry marks as controlled variants.
 */

import {
  boundedPatternEvidenceCondition,
  type PatternEvidenceBasis,
} from "../../shared/patterns_vocabulary.ts";
import {
  canonicalJson,
  RECORDED_VALIDATION_VERBS,
  type ValidationEvidence,
  type ValidationJobOutcome,
  validationJobOutcome,
} from "./validation.ts";
import type { VerbEvent } from "./schema.ts";

/** A failed invocation alone does not establish a completed validation verdict.
 * Older stage-only records retain their recorded check failure, while explicit
 * job observations take precedence over the enclosing invocation outcome. */
export function hasRecordedValidationFailure(event: VerbEvent): boolean {
  if (event.gate_ran === false) return false;
  if (event.validation !== undefined) {
    return event.validation.execution.jobs.some((job) =>
      job.outcome === "failed"
    );
  }
  if (event.steps !== undefined) {
    return event.steps.some((step) =>
      (step.kind === "job" || step.kind === "standard") &&
      step.outcome === "failed"
    );
  }
  return event.outcome === "failed" &&
    ["fix", "build", "check", "test", "check/test", "standards"].includes(
      event.failed_stage ?? "",
    );
}

interface VerbInvocations {
  readonly events: readonly VerbEvent[];
  readonly conflicts: ReadonlySet<VerbEvent>;
}

/** Retain one delivery per invocation. A contradictory copy marks that position
 * unknown; leaving its position present prevents joining a streak across it.
 * Records without identity remain separate, since their multiplicity is unknown. */
export function verbInvocations(
  events: readonly VerbEvent[],
): VerbInvocations {
  const seen = new Map<string, VerbEvent>();
  const result: VerbEvent[] = [];
  const conflicts = new Set<VerbEvent>();
  for (const event of events) {
    if (event.invocation === undefined) result.push(event);
    else if (!seen.has(event.invocation)) {
      seen.set(event.invocation, event);
      result.push(event);
    } else {
      const prior = seen.get(event.invocation);
      if (
        prior !== undefined && canonicalJson(prior) !== canonicalJson(event)
      ) {
        conflicts.add(prior);
      }
    }
  }
  return { events: result, conflicts };
}

/** Only unambiguous completed failure observations enter validation counts. */
export function failedValidationInvocations(
  observations: VerbInvocations,
): ReadonlySet<VerbEvent> {
  return new Set(
    observations.events.filter((event) =>
      !observations.conflicts.has(event) && hasRecordedValidationFailure(event)
    ),
  );
}

/** The two validation relationships this wave publishes. The retained id is
 * the compatibility seam; the second id prevents execution-context changes
 * from being emitted as duplicate same-envelope findings. */
export const VALIDATION_FINDING_RELATIONSHIPS = [
  {
    kind: "same-envelope",
    detectorId: "same-tree-flake",
    compatibility: "retained",
  },
  {
    kind: "cross-context",
    detectorId: "execution-context-divergence",
  },
] as const;

export type ValidationFindingRelationship =
  (typeof VALIDATION_FINDING_RELATIONSHIPS)[number]["kind"];

export const VALIDATION_COMPATIBILITY_DETECTOR_ID =
  VALIDATION_FINDING_RELATIONSHIPS[0].detectorId;

/** How one recorded schema field participates in comparison. The field-parity
 * test checks this inventory against the live Zod shapes, so a future field
 * cannot silently fall outside the evidence contract. */
export const VALIDATION_COMPARISON_FIELD_ACCOUNTING = {
  evidence: {
    version: "comparison-identity",
    state: "nested-state",
    execution: "nested-execution",
  },
  state: {
    version: "comparison-identity",
    complete: "eligibility",
    capture: "controlled-condition",
    elapsed_ms: "capture-measurement",
    digest: "comparison-identity",
    components: "state-digest-support",
    counts: "capture-measurement",
    bytes: "capture-measurement",
    incomplete: "eligibility",
    exclusions: "finding-limitations",
  },
  execution: {
    version: "controlled-condition",
    complete: "eligibility",
    mode: "controlled-condition",
    writer: "controlled-condition",
    config_digest: "controlled-condition",
    setup_digest: "controlled-condition",
    jobs: "recorded-job-enrollment",
    incomplete: "eligibility",
  },
  job: {
    id: "job-identity",
    stage: "job-identity",
    kind: "job-identity",
    definition_digest: "controlled-condition",
    outcome: "observation-not-condition",
    concurrent_siblings: "controlled-condition",
  },
} as const;

type RecordedValidationJob = ValidationEvidence["execution"]["jobs"][number];

export type ComparableValidationVerdict = "red" | "green" | "excluded";

/** One condition value carries a canonical key and a bounded public label. */
interface ConditionReading {
  key: string;
  label: string;
}

interface ConditionInput {
  validation: ValidationEvidence;
  job: RecordedValidationJob;
  siblings: readonly RecordedValidationJob[];
}

export interface ValidationConditionDeclaration {
  id:
    | "capture-boundary"
    | "execution-version"
    | "execution-mode"
    | "writer"
    | "configuration"
    | "setup"
    | "job-definition"
    | "concurrency"
    | "sibling-context";
  /** Only these dimensions may differ in a cross-context finding. */
  crossContext: "must-match" | "may-differ";
  /** Live schema fields this condition projects. */
  sources: readonly string[];
  read(input: ConditionInput): ConditionReading;
}

/** Non-condition fields that establish the state and target-job identity. */
export const VALIDATION_COMPARISON_IDENTITY_SOURCES = [
  "evidence.version",
  "state.version",
  "state.digest",
  "job.id",
  "job.stage",
  "job.kind",
] as const;

/** Outcome-free identity for one planned job in the execution envelope. */
function plannedJobIdentity(job: RecordedValidationJob): string {
  return canonicalJson({
    id: job.id,
    stage: job.stage,
    kind: job.kind,
    definition: job.definition_digest,
    concurrentSiblings: job.concurrent_siblings,
  });
}

/** Maximum sibling labels shown in one prose context. The condition basis
 * independently carries the bounded value set plus exact omitted cardinality. */
const VALIDATION_SIBLING_LABELS_MAX = 3;

/** Bounded readable sibling label; its canonical key still carries every job. */
function siblingLabel(siblings: readonly RecordedValidationJob[]): string {
  if (siblings.length === 0) {
    return "none";
  }
  const labels = siblings
    .map((job) =>
      `${job.id} (${job.stage}, ${job.kind}, ${
        job.definition_digest ?? "definition unavailable"
      }, ${job.concurrent_siblings ? "concurrent" : "serial"})`
    )
    .sort();
  const shown = labels.slice(0, VALIDATION_SIBLING_LABELS_MAX);
  const omitted = labels.length - shown.length;
  return [
    ...shown,
    ...(omitted > 0 ? [`${omitted} additional siblings omitted`] : []),
  ].join(", ");
}

/** The sole registry for the controlled v1 comparison envelope. The pure
 * projection, same-envelope signature, cross-context invariant signature,
 * matched fields, and differing fields all iterate this set. */
export const VALIDATION_CONTROLLED_CONDITIONS:
  readonly ValidationConditionDeclaration[] = [
    {
      id: "capture-boundary",
      crossContext: "may-differ",
      sources: ["state.capture"],
      read: ({ validation }) => ({
        key: validation.state.capture,
        label: validation.state.capture,
      }),
    },
    {
      id: "execution-version",
      crossContext: "must-match",
      sources: ["execution.version"],
      read: ({ validation }) => ({
        key: String(validation.execution.version),
        label: `v${validation.execution.version}`,
      }),
    },
    {
      id: "execution-mode",
      crossContext: "may-differ",
      sources: ["execution.mode"],
      read: ({ validation }) => ({
        key: validation.execution.mode,
        label: validation.execution.mode,
      }),
    },
    {
      id: "writer",
      crossContext: "must-match",
      sources: ["execution.writer"],
      read: ({ validation }) => ({
        key: validation.execution.writer,
        label: validation.execution.writer,
      }),
    },
    {
      id: "configuration",
      crossContext: "must-match",
      sources: ["execution.config_digest"],
      read: ({ validation }) => ({
        key: validation.execution.config_digest ?? "",
        label: validation.execution.config_digest ?? "unavailable",
      }),
    },
    {
      id: "setup",
      crossContext: "must-match",
      sources: ["execution.setup_digest"],
      read: ({ validation }) => ({
        key: validation.execution.setup_digest ?? "",
        label: validation.execution.setup_digest ?? "unavailable",
      }),
    },
    {
      id: "job-definition",
      crossContext: "must-match",
      sources: ["job.definition_digest"],
      read: ({ job }) => ({
        key: job.definition_digest ?? "",
        label: job.definition_digest ?? "unavailable",
      }),
    },
    {
      id: "concurrency",
      crossContext: "may-differ",
      sources: ["job.concurrent_siblings"],
      read: ({ job }) => ({
        key: String(job.concurrent_siblings),
        label: job.concurrent_siblings
          ? "concurrent siblings"
          : "no concurrent siblings",
      }),
    },
    {
      id: "sibling-context",
      crossContext: "may-differ",
      sources: [
        "execution.jobs",
        "job.id",
        "job.stage",
        "job.kind",
        "job.definition_digest",
        "job.concurrent_siblings",
      ],
      read: ({ siblings }) => ({
        key: canonicalJson(siblings.map(plannedJobIdentity).sort()),
        label: siblingLabel(siblings),
      }),
    },
  ];

export interface ValidationConditionProjection {
  readonly readings: Readonly<Record<string, ConditionReading>>;
}

/** Project one outcome-free execution envelope through the canonical registry. */
export function validationConditionProjection(
  validation: ValidationEvidence,
  job: RecordedValidationJob,
): ValidationConditionProjection {
  const siblings = validation.execution.jobs.filter((candidate) =>
    candidate !== job
  );
  const input: ConditionInput = { validation, job, siblings };
  const readings: Record<string, ConditionReading> = {};
  for (const condition of VALIDATION_CONTROLLED_CONDITIONS) {
    readings[condition.id] = condition.read(input);
  }
  return { readings };
}

/** Canonical projection signature over a selected relationship. Outcomes are
 * structurally absent because a projection contains only condition readings. */
function projectionSignature(
  projection: ValidationConditionProjection,
  include: (condition: ValidationConditionDeclaration) => boolean,
): string {
  return canonicalJson(
    VALIDATION_CONTROLLED_CONDITIONS
      .filter(include)
      .map((condition) => [
        condition.id,
        projection.readings[condition.id]?.key ?? "",
      ]),
  );
}

/** Exact same-envelope identity across every controlled recorded condition. */
export function sameExecutionEnvelopeSignature(
  projection: ValidationConditionProjection,
): string {
  return projectionSignature(projection, () => true);
}

/** Invariant identity for a cross-context comparison. A condition omitted
 * here is present in the allowed-context signature below by registry policy. */
function crossContextInvariantSignature(
  projection: ValidationConditionProjection,
): string {
  return projectionSignature(
    projection,
    (condition) => condition.crossContext === "must-match",
  );
}

/** Identity of the explicitly allowed controlled differences. */
function crossContextVariantSignature(
  projection: ValidationConditionProjection,
): string {
  return projectionSignature(
    projection,
    (condition) => condition.crossContext === "may-differ",
  );
}

/** Compare two projections. `undefined` means an invariant differed; otherwise
 * every returned difference is one registry-declared controlled variant. */
export function compareValidationContexts(
  left: ValidationConditionProjection,
  right: ValidationConditionProjection,
): string[] | undefined {
  const differences: string[] = [];
  for (const condition of VALIDATION_CONTROLLED_CONDITIONS) {
    const leftKey = left.readings[condition.id]?.key;
    const rightKey = right.readings[condition.id]?.key;
    if (leftKey === rightKey) {
      continue;
    }
    if (condition.crossContext === "must-match") {
      return undefined;
    }
    differences.push(condition.id);
  }
  return differences;
}

/** Turn a condition set into the shared structured evidence shape. */
function conditionEvidence(
  projections: readonly ValidationConditionProjection[],
  select: (
    condition: ValidationConditionDeclaration,
    distinct: number,
  ) => boolean,
): PatternEvidenceBasis["matched_conditions"] {
  const evidence: PatternEvidenceBasis["matched_conditions"] = [];
  for (const condition of VALIDATION_CONTROLLED_CONDITIONS) {
    const values = new Map<string, string>();
    for (const projection of projections) {
      const reading = projection.readings[condition.id];
      if (reading !== undefined) {
        values.set(reading.key, reading.label);
      }
    }
    if (!select(condition, values.size)) {
      continue;
    }
    const bounded = boundedPatternEvidenceCondition(
      condition.id,
      [...values].map(([key, label]) => ({ key, label })),
    );
    if (bounded !== undefined) evidence.push(bounded);
  }
  return evidence;
}

/** Convert the normalized job outcome authority to finding vocabulary. */
function comparableVerdict(
  outcome: ValidationJobOutcome,
): ComparableValidationVerdict {
  if (outcome === "failed") return "red";
  if (outcome === "passed") return "green";
  return "excluded";
}

export interface CurrentValidationJobObservation {
  readonly source: "current";
  readonly event: VerbEvent;
  readonly validationVersion: number;
  readonly stateVersion: number;
  readonly stateDigest: string;
  readonly jobId: string;
  readonly jobStage: string;
  readonly jobKind: string;
  readonly verdict: ComparableValidationVerdict;
  readonly projection: ValidationConditionProjection;
}

/** Complete current evidence must make every condition in the planned-job
 * envelope available. An incomplete reason on a nominally complete record is
 * treated conservatively as incomplete too. */
export function validationEvidenceIsComparable(
  validation: ValidationEvidence,
): boolean {
  return validation.state.complete && validation.state.digest !== undefined &&
    (validation.state.incomplete?.length ?? 0) === 0 &&
    validation.execution.complete &&
    validation.execution.config_digest !== undefined &&
    validation.execution.setup_digest !== undefined &&
    (validation.execution.incomplete?.length ?? 0) === 0 &&
    validation.version === validation.state.version &&
    validation.version === validation.execution.version &&
    validation.execution.jobs.every((job) =>
      job.definition_digest !== undefined
    );
}

/** Duplicate ids make the target/sibling distinction ambiguous. */
function uniqueJobIds(jobs: readonly RecordedValidationJob[]): boolean {
  return new Set(jobs.map((job) => job.id)).size === jobs.length;
}

/** Every complete current-version test job auto-enrols from the event's
 * execution list; no detector-side command or job-name table exists. */
export function currentValidationJobObservations(
  events: readonly VerbEvent[],
): CurrentValidationJobObservation[] {
  const observations: CurrentValidationJobObservation[] = [];
  for (const event of events) {
    if (!RECORDED_VALIDATION_VERBS.some((verb) => verb === event.verb)) {
      continue;
    }
    const validation = event.validation;
    if (
      validation === undefined ||
      !validationEvidenceIsComparable(validation) ||
      !uniqueJobIds(validation.execution.jobs)
    ) {
      continue;
    }
    for (const job of validation.execution.jobs) {
      if (job.stage !== "test" || job.kind === "standard") continue;
      observations.push({
        source: "current",
        event,
        validationVersion: validation.version,
        stateVersion: validation.state.version,
        stateDigest: validation.state.digest ?? "",
        jobId: job.id,
        jobStage: job.stage,
        jobKind: job.kind,
        verdict: comparableVerdict(validationJobOutcome(job)),
        projection: validationConditionProjection(validation, job),
      });
    }
  }
  return observations;
}

/** Group a list by a canonical key without making event order meaningful. */
function grouped<T>(
  values: readonly T[],
  keyOf: (value: T) => string,
): T[][] {
  const groups = new Map<string, T[]>();
  for (const value of values) {
    const key = keyOf(value);
    const group = groups.get(key);
    if (group === undefined) {
      groups.set(key, [value]);
    } else {
      group.push(value);
    }
  }
  return [...groups.values()];
}

/** The state/job identity shared by both current relationships. */
function currentJobIdentity(
  observation: CurrentValidationJobObservation,
): string {
  return canonicalJson({
    validationVersion: observation.validationVersion,
    stateVersion: observation.stateVersion,
    stateDigest: observation.stateDigest,
    jobId: observation.jobId,
    jobStage: observation.jobStage,
    jobKind: observation.jobKind,
  });
}

export interface CurrentValidationRepeatGroup {
  readonly basisKind: "complete-validation-state";
  readonly stateVersion: number;
  readonly jobId: string;
  readonly observations: readonly CurrentValidationJobObservation[];
  readonly matchedConditions: PatternEvidenceBasis["matched_conditions"];
}

/** Positive evidence of a repeated green job, with intervening attempts retained. */
export function repeatedGreenValidationJobs(
  events: readonly VerbEvent[],
): {
  events: number;
  observations: number;
  groups: { group: CurrentValidationRepeatGroup; repeats: number }[];
} {
  const observations = verbInvocations(events);
  const unique = observations.events;
  const previous = new Map<VerbEvent, VerbEvent>();
  const branchTail = new Map<string, VerbEvent>();
  for (const event of unique) {
    if (
      event.branch === null ||
      !RECORDED_VALIDATION_VERBS.some((verb) => verb === event.verb)
    ) continue;
    const tail = branchTail.get(event.branch);
    if (tail !== undefined) previous.set(event, tail);
    branchTail.set(event.branch, event);
  }
  const eligible = (event: VerbEvent): boolean =>
    !observations.conflicts.has(event) &&
    event.invocation !== undefined && event.outcome === "ok" &&
    event.gate_ran !== false &&
    !event.flags?.includes("rerun") && event.epoch !== null;
  const groups = sameEnvelopeValidationGroups(unique).flatMap((group) => {
    const green = new Set(
      group.observations.filter((item) =>
        item.verdict === "green" && eligible(item.event)
      ).map((item) => item.event),
    );
    let repeats = 0;
    for (const event of green) {
      const prior = previous.get(event);
      if (
        prior !== undefined && green.has(prior) &&
        prior.head !== null && prior.head === event.head &&
        prior.epoch === event.epoch
      ) repeats += 1;
    }
    return repeats === 0 ? [] : [{ group, repeats }];
  });
  return {
    events: unique.length,
    observations: currentValidationJobObservations(unique).length,
    groups,
  };
}

/** Full green invocations with explicit wait accounting, deduplicated by durable invocation id. */
export function observedGreenGateDurations(
  events: readonly VerbEvent[],
): VerbEvent[] {
  const observations = verbInvocations(events);
  return observations.events.filter((event) => {
    if (
      observations.conflicts.has(event) ||
      event.verb !== "done" || event.outcome !== "ok" ||
      event.gate_ran !== true ||
      event.invocation === undefined || event.epoch === null ||
      event.writer === undefined ||
      event.waited_ms === undefined || !Number.isFinite(event.waited_ms) ||
      event.waited_ms < 0 ||
      !Number.isFinite(event.duration_ms) ||
      event.waited_ms > event.duration_ms ||
      event.change === undefined
    ) return false;
    return true;
  });
}

/** Repeated groups are the documented `considered` population for the retained
 * detector: eligible per-job observations whose full comparison key appears at
 * least twice. */
export function sameEnvelopeValidationGroups(
  events: readonly VerbEvent[],
): CurrentValidationRepeatGroup[] {
  const current: CurrentValidationRepeatGroup[] = [];
  for (
    const observations of grouped(
      currentValidationJobObservations(events),
      (observation) =>
        `${currentJobIdentity(observation)}\0${
          sameExecutionEnvelopeSignature(observation.projection)
        }`,
    ).filter((group) => group.length >= 2)
  ) {
    const first = observations[0];
    if (first === undefined) continue;
    current.push({
      basisKind: "complete-validation-state" as const,
      stateVersion: first.stateVersion,
      jobId: first.jobId,
      observations,
      matchedConditions: conditionEvidence(
        observations.map((observation) => observation.projection),
        (_condition, distinct) => distinct === 1,
      ),
    });
  }

  return current;
}

export interface ValidationContextBucket {
  readonly observations: readonly CurrentValidationJobObservation[];
  readonly projection: ValidationConditionProjection;
}

export interface ValidationContextGroup {
  readonly basisKind: "complete-validation-state";
  readonly stateVersion: number;
  readonly jobId: string;
  readonly observations: readonly CurrentValidationJobObservation[];
  readonly contexts: readonly ValidationContextBucket[];
  readonly matchedConditions: PatternEvidenceBasis["matched_conditions"];
  readonly differingConditions: PatternEvidenceBasis["differing_conditions"];
}

/** Cross-context `considered` covers eligible per-job observations whose state,
 * job, and invariant conditions recur across at least two declared controlled
 * contexts. Invariant differences form another group and never compare. */
export function crossContextValidationGroups(
  events: readonly VerbEvent[],
): ValidationContextGroup[] {
  const bases = grouped(
    currentValidationJobObservations(events),
    (observation) =>
      `${currentJobIdentity(observation)}\0${
        crossContextInvariantSignature(observation.projection)
      }`,
  );
  const groups: ValidationContextGroup[] = [];
  for (const observations of bases) {
    const first = observations[0];
    if (first === undefined) continue;
    const contextObservations = grouped(
      observations,
      (observation) => crossContextVariantSignature(observation.projection),
    ).filter((context) =>
      context.some((observation) => observation.verdict !== "excluded")
    );
    if (contextObservations.length < 2) continue;
    const contexts: ValidationContextBucket[] = [];
    for (const context of contextObservations) {
      const firstContext = context[0];
      if (firstContext === undefined) continue;
      contexts.push({
        observations: context,
        projection: firstContext.projection,
      });
    }
    const projections = contexts.map((context) => context.projection);
    // Pairwise comparison is a defensive assertion that no condition outside
    // the registry's variant set slipped through the invariant key.
    if (
      projections.some((projection, index) =>
        projections.slice(index + 1).some((other) =>
          compareValidationContexts(projection, other) === undefined
        )
      )
    ) {
      continue;
    }
    groups.push({
      basisKind: "complete-validation-state",
      stateVersion: first.stateVersion,
      jobId: first.jobId,
      observations: contexts.flatMap((context) => context.observations),
      contexts,
      matchedConditions: conditionEvidence(
        projections,
        (_condition, distinct) => distinct === 1,
      ),
      differingConditions: conditionEvidence(
        projections,
        (condition, distinct) =>
          condition.crossContext === "may-differ" && distinct > 1,
      ),
    });
  }
  return groups;
}

/** Common observed-value projection keeps the flat compatible map and the
 * additive provenance map numerically identical by construction. */
export function observedEvidenceValues(
  evidence: Readonly<Record<string, number>>,
): PatternEvidenceBasis["values"] {
  return Object.fromEntries(
    Object.entries(evidence).map(([key, value]) => [
      key,
      { value, kind: "observed" as const },
    ]),
  );
}

/** Human label for one controlled context; the condition basis carries the
 * full exact differences, while this stays terse enough for interim prose. */
export function validationContextLabel(
  context: ValidationContextBucket,
): string {
  const first = context.observations[0];
  if (first === undefined) return "recorded context";
  const mode = first.event.validation?.execution.mode === "full-gate"
    ? "full gate"
    : "standalone test";
  const concurrency = first.projection.readings.concurrency?.label;
  const siblings = first.projection.readings["sibling-context"]?.label;
  if (concurrency === "no concurrent siblings" && siblings === "none") {
    return mode;
  }
  return `${mode}, ${concurrency ?? "unknown concurrency"}, siblings ${
    siblings ?? "unknown"
  }`;
}
