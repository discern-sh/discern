/** Typed domain ports for the implementation streams. No public dispatcher imports them. */
import type { Candidate } from "./candidate.ts";
import type {
  CompletionPolicy,
  EnvironmentDeclaration,
  ProducerDeclaration,
  StandardInputPlan,
} from "./configuration.ts";
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

export type CompletionBlocker =
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
    | { readonly kind: "done"; readonly requirements: readonly Requirement[] }
    | {
      readonly kind: "test";
      readonly producers: readonly string[];
      readonly readings: "already-produced";
    }
    | {
      readonly kind: "standards" | "pin" | "proposal";
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

/** Event facts are advisory projections of durable outcomes. 7A owns logbook wiring. */
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
      readonly kind: "producer";
      readonly producer: string;
      readonly use: "executed" | "reused";
      readonly evidence_id: string;
      readonly outcome: "passed" | "failed" | "cancelled";
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
      readonly category:
        | "approval"
        | "queue"
        | "compute"
        | "execution"
        | "environment";
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
