/**
 * Validation evidence shared by the gate writers and Logbook readers.
 *
 * The result envelope carries this evidence on a symbol: recorders in the same
 * process can lift it, while JSON serialization and the public result schemas
 * remain unchanged. The durable copy is the optional `validation` field on a
 * local Logbook verb event.
 */

import { z } from "@zod/zod";
import { DISCERN_VERSION } from "../../lib/version.ts";
import type { DiscernConfig } from "../../shared/config_schema.ts";
import type { DiscernResult } from "../../shared/result.ts";
import { ON_DISK_FORMATS } from "../../shared/on_disk_formats.ts";

/** Validation entry points. Adding one enrolls it in the outcome matrix. */
export const VALIDATION_RUNS = {
  done: {
    mode: "full-gate",
    capture: "after-fix-build",
    stages: ["check", "test"],
  },
  test: {
    mode: "standalone-test",
    capture: "before-test-group",
    stages: ["test"],
  },
} as const;

export type ValidationVerb = keyof typeof VALIDATION_RUNS;
export type ValidationRun = (typeof VALIDATION_RUNS)[ValidationVerb];

/** The sole job-verdict vocabulary used by Patterns. */
export const VALIDATION_JOB_OUTCOMES = [
  "passed",
  "failed",
  "skipped",
  "cancelled",
  "unavailable",
] as const;
export type ValidationJobOutcome = (typeof VALIDATION_JOB_OUTCOMES)[number];

/** Minimum recorded step shape needed to derive a verdict. */
export interface RecordedJobStep {
  readonly outcome?: string | undefined;
}

/**
 * Derive a configured job's verdict from its explicit recorded step only.
 * Missing and unknown values remain unavailable; absence never means
 * either success or failure.
 */
export function validationJobOutcome(
  step: RecordedJobStep | undefined,
): ValidationJobOutcome {
  switch (step?.outcome) {
    case "ok":
    case "passed":
      return "passed";
    case "failed":
      return "failed";
    case "skipped":
      return "skipped";
    case "cancelled":
      return "cancelled";
    default:
      return "unavailable";
  }
}

export const VALIDATION_EVIDENCE_VERSION =
  ON_DISK_FORMATS.logbookValidationEvidence.version;

export const VALIDATION_INCOMPLETE_CATEGORIES = [
  "boundary",
  "key",
  "head",
  "index",
  "tracked",
  "untracked",
  "submodules",
  "execution",
  "budget",
  "internal",
] as const;

export const VALIDATION_INCOMPLETE_REASONS = [
  "not-reached",
  "unavailable",
  "unreadable",
  "invalid",
  "path-limit",
  "entry-limit",
  "byte-limit",
  "time-limit",
  "dirty",
] as const;

/** Dimensions deliberately outside the local, repository-state snapshot. */
export const VALIDATION_EXCLUSIONS = [
  "ignored-files",
  "external-services",
  "clocks",
  "random-seeds",
  "runtime-environment",
  "concurrent-external-processes",
] as const;

const incompleteSchema = z.looseObject({
  category: z.enum(VALIDATION_INCOMPLETE_CATEGORIES),
  reason: z.enum(VALIDATION_INCOMPLETE_REASONS),
});

const stateSchema = z.looseObject({
  version: z.literal(VALIDATION_EVIDENCE_VERSION),
  complete: z.boolean(),
  capture: z.enum(["after-fix-build", "before-test-group"]),
  elapsed_ms: z.number().nonnegative(),
  digest: z.string().optional(),
  components: z.looseObject({
    head: z.string().optional(),
    index: z.string().optional(),
    tracked: z.string().optional(),
    untracked: z.string().optional(),
    submodules: z.string().optional(),
  }),
  counts: z.looseObject({
    index_entries: z.number().int().nonnegative(),
    tracked_paths: z.number().int().nonnegative(),
    untracked_paths: z.number().int().nonnegative(),
    submodules: z.number().int().nonnegative(),
  }),
  bytes: z.looseObject({
    index_manifest: z.number().int().nonnegative(),
    tracked_content: z.number().int().nonnegative(),
    untracked_content: z.number().int().nonnegative(),
    git_output: z.number().int().nonnegative().optional(),
  }),
  incomplete: z.array(incompleteSchema).optional(),
  exclusions: z.array(z.enum(VALIDATION_EXCLUSIONS)),
});

const executionJobSchema = z.looseObject({
  id: z.string(),
  stage: z.string(),
  kind: z.string(),
  definition_digest: z.string().optional(),
  outcome: z.enum(VALIDATION_JOB_OUTCOMES),
  concurrent_siblings: z.boolean(),
});

const executionSchema = z.looseObject({
  version: z.literal(VALIDATION_EVIDENCE_VERSION),
  complete: z.boolean(),
  mode: z.enum(["full-gate", "standalone-test"]),
  writer: z.string(),
  config_digest: z.string().optional(),
  setup_digest: z.string().optional(),
  jobs: z.array(executionJobSchema),
  incomplete: z.array(incompleteSchema).optional(),
});

/** Additive, versioned evidence stored only in the repository-local Logbook. */
export const validationEvidenceSchema = z.looseObject({
  version: z.literal(VALIDATION_EVIDENCE_VERSION),
  state: stateSchema,
  execution: executionSchema,
});

/** Canonical field inventory for readers that must account for every recorded
 * validation dimension. A schema addition widens this inventory immediately;
 * the comparison-accounting guard then requires an explicit classification. */
export const VALIDATION_EVIDENCE_SCHEMA_FIELDS = {
  evidence: Object.keys(validationEvidenceSchema.shape),
  state: Object.keys(stateSchema.shape),
  execution: Object.keys(executionSchema.shape),
  job: Object.keys(executionJobSchema.shape),
} as const;

/** Commands whose current writers always attach validation evidence. Patterns
 * derives its comparable observation set from this same enrollment registry. */
export const RECORDED_VALIDATION_VERBS = ["test", "done"] as const;

export type ValidationEvidence = z.infer<typeof validationEvidenceSchema>;
export type ValidationState = ValidationEvidence["state"];
export type ValidationIncomplete = NonNullable<
  ValidationState["incomplete"]
>[number];

/** A captured boundary before result steps are available. */
export interface ValidationStart {
  readonly version: typeof VALIDATION_EVIDENCE_VERSION;
  readonly state: ValidationState;
  readonly execution: ValidationExecutionStart;
}

export interface ValidationExecutionStart {
  readonly version: typeof VALIDATION_EVIDENCE_VERSION;
  readonly complete: boolean;
  readonly mode: ValidationRun["mode"];
  readonly writer: string;
  readonly config_digest?: string | undefined;
  readonly setup_digest?: string | undefined;
  readonly jobs: readonly ValidationExecutionJobPlan[];
  readonly incomplete?: readonly ValidationIncomplete[] | undefined;
}

export interface ValidationExecutionJobPlan {
  readonly id: string;
  readonly stage: string;
  readonly kind: string;
  readonly definition_digest?: string | undefined;
  readonly concurrent_siblings: boolean;
}

/** Structural plan view keeps the local Logbook graph independent of Gate code. */
export interface ValidationPlannedJob {
  readonly label: string;
  readonly command: string;
  readonly kind: string;
  readonly reportStage: string;
  readonly willRun: boolean;
  readonly timeout?:
    | { readonly seconds: number; readonly key: string }
    | undefined;
}

export interface ValidationJobGroup {
  readonly stage?: string | undefined;
  readonly mode: "serial" | "parallel";
  readonly heading?: string | undefined;
  readonly display?: string | undefined;
  readonly jobs: readonly ValidationPlannedJob[];
}

/** Symbol metadata is local to the process and invisible to JSON/MCP schemas. */
const VALIDATION_EVIDENCE = Symbol("discern.validation-evidence");
type ResultWithValidation = DiscernResult & {
  [VALIDATION_EVIDENCE]?: ValidationEvidence;
};

/** Attach recorder-only evidence without changing the public result surface. */
export function attachValidationEvidence<T extends DiscernResult>(
  result: T,
  evidence: ValidationEvidence,
): T {
  Object.defineProperty(result, VALIDATION_EVIDENCE, {
    value: evidence,
    enumerable: true,
    configurable: false,
    writable: false,
  });
  return result;
}

/** Read recorder-only evidence from a result, if its producing verb attached it. */
export function validationEvidence(
  result: DiscernResult | undefined,
): ValidationEvidence | undefined {
  return (result as ResultWithValidation | undefined)?.[VALIDATION_EVIDENCE];
}

/** Stable JSON for inputs whose ordinary object insertion order is incidental. */
export function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== "object") {
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    return `[${value.map(canonicalJson).join(",")}]`;
  }
  const object = value as Record<string, unknown>;
  return `{${
    Object.keys(object).sort().map((key) =>
      `${JSON.stringify(key)}:${canonicalJson(object[key])}`
    ).join(",")
  }}`;
}

/** Setup-affecting config projection; values are HMACed and never recorded. */
export function setupIdentityProjection(cfg: DiscernConfig): unknown {
  return {
    repositoryEnsure: cfg.repository.ensure,
    worktreeSetup: cfg.worktree.setup,
    resources: cfg.worktree.resources,
    inheritEnv: cfg.worktree.inherit_env,
    envFiles: cfg.worktree.env_files,
  };
}

/** Lazily select jobs so bounded evidence consumers can stop before allocating. */
export function* validationJobEntries(
  run: ValidationRun,
  groups: readonly ValidationJobGroup[],
): Generator<{ job: ValidationPlannedJob; concurrentSiblings: boolean }> {
  for (const group of groups) {
    for (const job of group.jobs) {
      if (!run.stages.some((stage) => stage === job.reportStage)) continue;
      yield {
        job,
        concurrentSiblings: group.mode === "parallel" && group.jobs.length > 1,
      };
    }
  }
}

/** Complete a boundary capture with the explicit step outcomes it produced. */
export function completeValidationEvidence(
  start: ValidationStart,
  steps: readonly { step: { label: string }; outcome: string }[] | undefined,
): ValidationEvidence {
  const byLabel = new Map((steps ?? []).map((step) => [step.step.label, step]));
  return {
    version: VALIDATION_EVIDENCE_VERSION,
    state: start.state,
    execution: {
      version: start.execution.version,
      complete: start.execution.complete,
      mode: start.execution.mode,
      writer: start.execution.writer,
      ...(start.execution.config_digest !== undefined
        ? { config_digest: start.execution.config_digest }
        : {}),
      ...(start.execution.setup_digest !== undefined
        ? { setup_digest: start.execution.setup_digest }
        : {}),
      ...(start.execution.incomplete !== undefined
        ? { incomplete: [...start.execution.incomplete] }
        : {}),
      jobs: start.execution.jobs.map((job) => ({
        ...job,
        outcome: validationJobOutcome(byLabel.get(job.id)),
      })),
    },
  };
}

/** Shared writer value for captures assembled without filesystem work. */
export const VALIDATION_WRITER = DISCERN_VERSION;
