/** Shared completion, execution, queue and advisory event contracts. */
import type { Candidate } from "./candidate.ts";
import type {
  CompletionPolicy,
  EnvironmentDeclaration,
  ProducerDeclaration,
  StandardInputPlan,
} from "../../shared/config_schema.ts";
import type {
  CompletionAttempt,
  CompletionRecovery,
  ExecutionEnvironment,
} from "./environment.ts";
import type {
  CandidateProof,
  ComponentEvidence,
  Requirement,
} from "./evidence.ts";
import type { Executor, SourceRevision } from "./identity.ts";
import type {
  CompletionLanding,
  CompletionQueue,
  CompletionRetirement,
  InvalidationReason,
} from "./outcomes.ts";
import type { CompletionRecord, RecordSelector } from "./records.ts";
import type { CompletionRecordReading, PublicationFence } from "./store.ts";

/** Capacity facts describe the enforcing boundary, not a combined invented limit. */
export interface CompletionCapacity {
  readonly setting:
    | "completion.concurrency"
    | "completion.lookahead"
    | "execution.capacity";
  readonly limit: number;
  readonly occupied: number;
  readonly reserved: number;
  readonly blockers: readonly string[];
  readonly wake_condition: string;
}

export type CompletionBlocker =
  | { readonly kind: "cancelled"; readonly reason: string }
  | {
    readonly kind: "record-incompatible" | "record-corrupt";
    readonly record_id: string;
    readonly reason: string;
  }
  | {
    readonly kind: "capacity-unavailable";
    readonly reason: string;
    readonly capacity: CompletionCapacity;
    readonly transient: boolean;
  }
  | { readonly kind: "missing-judgment"; readonly subjects: readonly string[] }
  | {
    readonly kind: "missing-authority";
    readonly sources: readonly SourceRevision[];
  }
  | {
    readonly kind: "missing-evidence";
    readonly requirements: readonly Requirement[];
  }
  | {
    readonly kind: "stale-evidence";
    readonly evidence_ids: readonly string[];
    readonly reason: InvalidationReason;
  }
  | {
    readonly kind: "validation-failed";
    readonly evidence_ids: readonly string[];
    readonly requirement?: Requirement;
    readonly attempt_id?: string;
    readonly reason?: string;
  }
  | { readonly kind: "environment-unavailable"; readonly reason: string }
  | {
    readonly kind: "recovery-incomplete";
    readonly record_id: string;
    readonly recovery: CompletionRecovery;
  }
  | {
    readonly kind: "waiting-for-operation";
    readonly attempt_id: string;
    readonly expires_at: number;
  }
  | { readonly kind: "report-only" };

export interface CompletionObservation {
  readonly records: readonly {
    readonly selector: RecordSelector;
    readonly reading: CompletionRecordReading;
  }[];
  readonly trunk: string;
  readonly observed_at: number;
}

/** A planned use of an existing producer never changes the meaning of its run. */
export interface ProducerDemand {
  readonly selector: string;
  readonly recipe: ProducerDeclaration;
  /** Complete applicability for every component this producer will publish. */
  readonly evidence_subjects: readonly ComponentEvidence["applicability"][];
  readonly consumers: readonly {
    readonly requirement: Requirement;
    readonly input: StandardInputPlan;
  }[];
}

export type ValidationDemand =
  & {
    readonly context: string;
    readonly mode: ComponentEvidence["mode"];
  }
  & (
    | { readonly kind: "compose" }
    | { readonly kind: "done"; readonly requirements: readonly Requirement[] }
    | {
      readonly kind: "test";
      readonly producers: readonly string[];
      readonly readings: "already-produced";
    }
    | {
      readonly kind: "standards" | "pin" | "proposal" | "standalone";
      readonly requirements: readonly Requirement[];
    }
    | { readonly kind: "prepare"; readonly measurement: "none" }
    | {
      readonly kind: "diagnostic";
      readonly failing_requirement: Requirement;
      readonly source: SourceRevision;
      readonly base: string;
    }
  );

/** Standalone test and comparison work cannot publish completion authority. */
export function validationPurpose(
  demand: ValidationDemand,
): ComponentEvidence["purpose"] {
  return demand.kind === "test" || demand.kind === "diagnostic" ||
      demand.kind === "standalone"
    ? "diagnostic"
    : "completion";
}

export interface ValidationPlan {
  readonly candidate_id: string;
  readonly candidate: Candidate;
  readonly demand: ValidationDemand;
  readonly producers: readonly ProducerDemand[];
  readonly reused: readonly {
    readonly requirement: Requirement;
    readonly evidence_id: string;
  }[];
  readonly blockers: readonly CompletionBlocker[];
}

/** Returned only after durable exclusive claim publication. A plan alone cannot execute. */
export interface ClaimedExecution {
  readonly fence: PublicationFence;
  readonly attempt: CompletionAttempt;
  readonly environment_id: string;
  readonly environment: ExecutionEnvironment;
  readonly candidate_id: string;
  readonly candidate: Candidate;
  readonly signal: AbortSignal;
}

/** A transient observation of the working checkout; it has no release or publication capability.
 * The candidate is the committed comparison reference, not a claim about dirty bytes.
 */
export interface DiagnosticExecution {
  readonly diagnostic: true;
  readonly attempt:
    & Pick<CompletionAttempt, "identity" | "subjects" | "mode">
    & {
      readonly purpose: "diagnostic";
    };
  readonly environment_id: string;
  readonly environment: { readonly path: string };
  readonly seed: number;
  readonly candidate_id: string;
  readonly candidate: Candidate;
  readonly signal: AbortSignal;
}

export type ValidationSubject = ClaimedExecution | DiagnosticExecution;

export interface ValidationExecution {
  readonly evidence: readonly ComponentEvidence[];
  readonly blockers: readonly CompletionBlocker[];
}
export type MachineAssembly =
  | { readonly kind: "complete"; readonly proof: CandidateProof }
  | {
    readonly kind: "incomplete";
    readonly blockers: readonly CompletionBlocker[];
  };

/** 2A implements the evaluator, including exact aggregate assembly and rerun precedence. */
export interface ProducerEvaluator {
  observe(candidateId: string): Promise<CompletionObservation>;
  plan(
    observation: CompletionObservation,
    demand: ValidationDemand,
    candidateId: string,
  ): ValidationPlan;
  execute(
    plan: ValidationPlan,
    execution: ClaimedExecution,
  ): Promise<ValidationExecution>;
  assemble(
    candidateId: string,
    candidate: Candidate,
    requirements: readonly Requirement[],
    evidence: readonly CompletionRecord[],
    mode: ValidationDemand["mode"],
  ): MachineAssembly;
}

export type EnvironmentPlan =
  & {
    readonly environment_id: string;
    readonly expected_stamp: string | null;
    readonly candidate_id: string;
    readonly validation: ValidationPlan;
  }
  & (
    | { readonly action: "source-tip"; readonly declaration: null }
    | {
      readonly action: "borrow" | "provision" | "reuse";
      readonly declaration: EnvironmentDeclaration;
    }
  );
export type EnvironmentReturn =
  | {
    readonly kind: "restored" | "reset" | "disposed";
    readonly environment: ExecutionEnvironment;
  }
  | {
    readonly kind: "recovery-incomplete";
    readonly recovery: CompletionRecovery;
  };

/** 2B owns process supervision and checkout/resource effects through existing capabilities. */
export interface EnvironmentExecutor {
  observe(environmentId: string): Promise<CompletionRecordReading>;
  plan(
    observation: CompletionObservation,
    validation: ValidationPlan,
  ): EnvironmentPlan | CompletionBlocker;
  claim(
    plan: EnvironmentPlan,
    executor: Executor,
  ): Promise<ClaimedExecution | CompletionBlocker>;
  execute<T>(
    execution: ClaimedExecution,
    validate: (execution: ClaimedExecution) => Promise<T>,
  ): Promise<
    { readonly validation: T | null; readonly returned: EnvironmentReturn }
  >;
  recover(
    environmentId: string,
    expectedStamp: string,
    executor: Executor,
  ): Promise<EnvironmentReturn>;
}

export type QueueAction =
  | {
    readonly kind: "ready";
    readonly candidate_id: string;
    readonly expected_trunk: string;
    readonly authority_id: string;
  }
  | {
    readonly kind: "compose";
    readonly source: SourceRevision;
    readonly predecessor: Candidate["expected_predecessor"];
    readonly environment_id: string;
    readonly expected_stamp: string;
  }
  | {
    readonly kind: "validate";
    readonly plan: ValidationPlan;
    readonly environment: EnvironmentPlan;
  }
  | {
    readonly kind: "land";
    readonly record: Extract<CompletionRecord, { kind: "landing" }>;
    readonly expected_stamp: string | null;
  }
  | {
    readonly kind: "retire";
    readonly record: Extract<CompletionRecord, { kind: "retirement" }>;
    readonly expected_stamp: string | null;
  };
export interface QueuePlan {
  readonly queue_id: string;
  readonly expected_stamp: string | null;
  readonly queue: CompletionQueue;
  readonly actions: readonly QueueAction[];
  readonly blockers: readonly CompletionBlocker[];
}

/** 3A plans eligible work; 4A publishes exact transitions under current evidence. */
export interface QueuePlanner {
  observe(): Promise<CompletionObservation>;
  plan(
    observation: CompletionObservation,
    policy: CompletionPolicy,
    requestedEffort: string,
  ): QueuePlan;
  publish(
    plan: QueuePlan,
    executor: Executor,
  ): Promise<
    { readonly kind: "published" } | CompletionBlocker | {
      readonly kind: "replan";
    }
  >;
}

export interface LandingPublisher {
  plan(
    observation: CompletionObservation,
    candidateId: string,
  ): CompletionLanding | CompletionBlocker;
  publish(
    record: Extract<CompletionRecord, { kind: "landing" }>,
    expectedStamp: string | null,
    fence: PublicationFence,
  ): Promise<CompletionLanding | CompletionBlocker>;
  recover(
    landingId: string,
    executor: Executor,
  ): Promise<CompletionLanding | CompletionBlocker>;
  retire(
    record: Extract<CompletionRecord, { kind: "retirement" }>,
    expectedStamp: string | null,
    executor: Executor,
  ): Promise<CompletionRetirement>;
}

/** Event facts are advisory projections of canonical execution and durable outcomes. */
/** Coarse categories and precise executor phases have distinct keys. */
export const COMPLETION_TIMING_CATEGORIES = [
  "approval",
  "queue",
  "compute",
  "execution",
  "environment",
  "preparation",
  "return",
  "recovery",
  "capacity-wait",
  "validation",
  "reporting",
  "cleanup",
  "publication",
  "producer",
  "extraction",
  "approval-to-land",
  "validation-feedback",
] as const;

export interface CompletionEvent {
  readonly id: string;
  readonly effort_id: string;
  readonly source_head: string;
  readonly candidate_id: string | null;
  readonly environment_id: string | null;
  readonly attempt_id: string | null;
  readonly executor_operation: string;
  readonly at: number;
  readonly fact:
    | {
      readonly kind: "admitted";
      readonly proof_id: string;
      readonly mode: "strict" | "report";
      readonly eligible_prediction: boolean;
      readonly expected_predecessor_candidate_id: string | null;
    }
    | {
      readonly kind: "withdrawn";
      readonly admission: "before-green" | "after-green" | "unknown";
    }
    | {
      readonly kind: "validation-summary";
      readonly demand: ValidationDemand["kind"];
      readonly producer_executions: number;
      readonly reused_receipts: number;
    }
    | {
      readonly kind: "command-started";
      readonly execution_id: string;
      readonly producer: string;
      readonly role: "producer" | "extractor";
    }
    | {
      readonly kind: "command-finished";
      readonly execution_id: string;
      readonly producer: string;
      readonly role: "producer" | "extractor";
      readonly outcome: "passed" | "failed" | "cancelled";
      readonly started_at: number;
      readonly finished_at: number;
      readonly duration_ms: number;
    }
    | {
      readonly kind: "producer";
      readonly producer: string;
      readonly use: "executed" | "reused";
      readonly evidence_id: string;
      readonly outcome: ComponentEvidence["outcome"]["kind"];
      readonly duration_ms: number;
    }
    | {
      readonly kind: "invalidated";
      readonly reason: InvalidationReason;
      readonly affected_candidate_ids: readonly string[];
      readonly eligible_prediction: boolean;
    }
    | {
      readonly kind: "timing";
      readonly interval_id: string;
      readonly category: typeof COMPLETION_TIMING_CATEGORIES[number];
      readonly started_at: number;
      readonly finished_at: number;
    }
    | {
      readonly kind: "restoration";
      readonly outcome: EnvironmentReturn["kind"];
    }
    | {
      readonly kind: "landing";
      readonly landing_id: string;
      readonly outcome: CompletionLanding["outcome"]["kind"];
      readonly claim_kind: CompletionLanding["claim"]["kind"];
    }
    | {
      readonly kind: "retirement";
      readonly retirement_id: string;
      readonly outcome: CompletionRetirement["outcome"]["kind"];
    };
}
