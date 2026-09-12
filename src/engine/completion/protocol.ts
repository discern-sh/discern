/** Shared completion, validation, and advisory event contracts. */
import type { Candidate } from "./candidate.ts";
import type {
  ProducerDeclaration,
  StandardInputPlan,
} from "../../shared/config_schema.ts";
import type { CompletionAttempt } from "./attempt.ts";
import type {
  CandidateProof,
  ComponentEvidence,
  Requirement,
} from "./evidence.ts";
import type { SourceRevision } from "./identity.ts";
import type { InvalidationReason } from "./outcomes.ts";
import type { CompletionRecord, RecordSelector } from "./records.ts";
import type { CompletionRecordReading, PublicationFence } from "./store.ts";

export type CompletionBlocker =
  | { readonly kind: "cancelled"; readonly reason: string }
  | {
    readonly kind: "record-incompatible" | "record-corrupt";
    readonly record_id: string;
    readonly reason: string;
  }
  | { readonly kind: "missing-judgment"; readonly subjects: readonly string[] }
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
  /** The checkout, its records, or its trunk cannot serve this run. */
  | { readonly kind: "unavailable"; readonly reason: string }
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
  & { readonly mode: ComponentEvidence["mode"] }
  & (
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

/** Returned only after durable claim publication. A plan alone cannot execute. */
export interface ClaimedExecution {
  readonly fence: PublicationFence;
  readonly attempt: CompletionAttempt;
  /** The checkout the producers run in: the effort's own worktree. */
  readonly path: string;
  /** The checkout's deterministic test-order seed. */
  readonly seed: number;
  readonly candidate_id: string;
  readonly candidate: Candidate;
  readonly signal: AbortSignal;
}

/** A transient observation of the working checkout; it has no publication capability.
 * The candidate is the committed comparison reference, not a claim about dirty bytes.
 */
export interface DiagnosticExecution {
  readonly diagnostic: true;
  readonly attempt:
    & Pick<CompletionAttempt, "identity" | "subjects" | "mode">
    & {
      readonly purpose: "diagnostic";
    };
  readonly path: string;
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

/** The evaluator plans demand over recorded evidence and assembles exact Proof. */
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
    /** The live completion attempt the assembled Proof is attributed to. */
    assembler: PublicationFence,
  ): MachineAssembly;
}

/** Event facts are advisory projections of canonical execution and durable outcomes. */
export const COMPLETION_TIMING_CATEGORIES = [
  "capacity-wait",
  "producer",
  "extraction",
  "validation",
  "validation-feedback",
] as const;

export interface CompletionEvent {
  readonly id: string;
  readonly effort_id: string;
  readonly source_head: string;
  readonly candidate_id: string | null;
  readonly attempt_id: string | null;
  readonly executor_operation: string;
  readonly at: number;
  readonly fact:
    | {
      readonly kind: "proven";
      readonly proof_id: string;
      readonly mode: "strict" | "report";
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
    }
    | {
      readonly kind: "timing";
      readonly interval_id: string;
      readonly category: typeof COMPLETION_TIMING_CATEGORIES[number];
      readonly started_at: number;
      readonly finished_at: number;
    };
}
