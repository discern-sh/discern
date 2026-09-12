import { ON_DISK_FORMATS } from "../src/shared/on_disk_formats.ts";
/** Executable producer/extractor recipe for downstream measurement and public wiring. */
import { CandidateSchema } from "../src/engine/completion/candidate.ts";
import {
  type ProducerDeclaration,
  ProducerDeclarationSchema,
} from "../src/shared/config_schema.ts";
import type { ComponentEvidence } from "../src/engine/completion/evidence.ts";
import {
  type CompletionRecord,
  CompletionRecordSchema,
} from "../src/engine/completion/records.ts";
import type {
  ClaimedExecution,
  CompletionObservation,
  ValidationPlan,
} from "../src/engine/completion/protocol.ts";
import type { PublicationFence } from "../src/engine/completion/store.ts";
import {
  type ObligationDeclaration,
  prepareValidationSnapshot,
  requirementSetIdentity,
  type ValidationSnapshot,
} from "../src/engine/validation/catalog.ts";
import type {
  ProducerCapture,
  ValidationRuntime,
} from "../src/engine/validation/execute.ts";
import {
  COMPLETION_CLAIM,
  COMPLETION_CLOCK,
  COMPLETION_DIGEST,
  COMPLETION_EXECUTOR,
  completionFixtures,
  completionId,
} from "./completion_fixtures.ts";

export { COMPLETION_CLOCK, completionId };
export const PRODUCER_RECIPE = ProducerDeclarationSchema.parse({
  run:
    "printf 'DISCERN_METRIC covered 3\nDISCERN_METRIC population 4\nDISCERN_METRIC gaps 1\n'",
  inputs: ["src/**"],
  environment: ["MODE"],
  toolchain: ["tool.lock"],
});
export const ARTIFACT_RECIPE = ProducerDeclarationSchema.parse({
  run: "mkdir -p reports && printf '3 4' > reports/counts.txt",
  artifacts: ["reports/counts.txt"],
  inputs: ["src/**"],
});
export const ARTIFACT_EXTRACTOR =
  'read covered population; printf \'DISCERN_METRIC covered %s\nDISCERN_METRIC population %s\n\' "$covered" "$population"';
export const CONDITIONS = [{
  seed: 42,
  environment: { MODE: "test" },
  identity: COMPLETION_DIGEST,
}];
export const FILES = {
  complete: true,
  files: {
    "src/a.ts": { digest: COMPLETION_DIGEST, bytes: 100, words: 20, lines: 5 },
    "tool.lock": { digest: COMPLETION_DIGEST, bytes: 10, words: 2, lines: 1 },
    "docs/a.md": { digest: COMPLETION_DIGEST, bytes: 50, words: 10, lines: 2 },
  },
};

/** Declare a test obligation and two independent standards consuming one producer. */
export function obligations(): ObligationDeclaration[] {
  return [
    {
      requirement: {
        id: "test",
        kind: "job",
        definition: COMPLETION_DIGEST,
      },
      input: { producer: "jobs.test" },
    },
    {
      requirement: {
        id: "coverage",
        kind: "standard",
        definition: COMPLETION_DIGEST,
      },
      input: { producer: "jobs.test" },
      standard: {
        name: "coverage",
        metric: "covered",
        scale: 100,
        per: { kind: "metric", metric: "population" },
        direction: "up",
        limit: 75,
      },
    },
    {
      requirement: {
        id: "gaps",
        kind: "standard",
        definition: COMPLETION_DIGEST,
      },
      input: { producer: "standards.coverage" },
      standard: {
        name: "gaps",
        metric: "gaps",
        scale: 1,
        direction: "down",
        limit: 1,
      },
    },
  ];
}

/** Build a candidate and its matching requirement set from canonical contracts. */
export async function snapshot(
  overrides: Partial<Parameters<typeof prepareValidationSnapshot>[0]> = {},
): Promise<ValidationSnapshot> {
  const candidateRecord = completionFixtures().candidate;
  if (candidateRecord.kind !== "candidate") {
    throw new Error("missing fixture candidate");
  }
  const declarations = overrides.obligations ?? obligations();
  const candidate = CandidateSchema.parse({
    ...candidateRecord.data,
    ...overrides.candidate,
    requirement_set: await requirementSetIdentity(
      declarations.map((o) => o.requirement),
    ),
  });
  return await prepareValidationSnapshot({
    candidate_id: completionId(1),
    producers: { "jobs.test": PRODUCER_RECIPE },
    obligations: declarations,
    inputs: FILES,
    conditions: CONDITIONS,
    ...overrides,
    candidate,
  });
}

/** Wrap canonical records in a read-only observation. */
export function observation(
  records: readonly CompletionRecord[] = [],
): CompletionObservation {
  return {
    records: records.map((record) => ({
      selector: { kind: record.kind, id: record.id },
      reading: { kind: "recorded", record, stamp: COMPLETION_DIGEST },
    })),
    trunk: "b".repeat(40),
    observed_at: 100,
  };
}

/** Construct a matching attempt claim over the effort's own checkout, without host effects. */
export function claimed(
  snapshot: ValidationSnapshot,
  plan: ValidationPlan,
  sequence = 1,
  rerunOf: string | null = null,
): ClaimedExecution {
  const attemptId = completionId(100 + sequence);
  const subjects = [
    ...new Set(
      plan.producers.flatMap((producer) =>
        producer.consumers.map((consumer) => {
          const obligation = snapshot.obligations.find((o) =>
            JSON.stringify(o.requirement) ===
              JSON.stringify(consumer.requirement)
          );
          if (obligation === undefined) {
            throw new Error("missing fixture subject");
          }
          return obligation.subject;
        })
      ),
    ),
  ];
  return {
    candidate_id: snapshot.candidate_id,
    candidate: snapshot.candidate,
    signal: new AbortController().signal,
    path: "/workspace",
    seed: snapshot.conditions[0]?.seed ?? 42,
    fence: { attempt_id: attemptId, token: COMPLETION_CLAIM.token },
    attempt: {
      identity: {
        id: attemptId,
        candidate_id: snapshot.candidate_id,
        executor: COMPLETION_EXECUTOR,
        sequence,
        rerun_of: rerunOf,
        started_at: 10,
      },
      subjects,
      mode: plan.demand.mode,
      purpose: plan.demand.kind === "diagnostic" || plan.demand.kind === "test"
        ? "diagnostic"
        : "completion",
      state: { kind: "claimed", claim: COMPLETION_CLAIM },
    },
  };
}

/** Wrap completed component outcomes and their owning attempt as durable records. */
export function recorded(
  execution: ClaimedExecution,
  evidence: readonly ComponentEvidence[],
  outcome: "passed" | "failed" = "passed",
): CompletionRecord[] {
  return [
    CompletionRecordSchema.parse({
      version: ON_DISK_FORMATS.completionRecord.version,
      revision: 1,
      kind: "attempt",
      id: execution.attempt.identity.id,
      data: {
        ...execution.attempt,
        state: { kind: "finished", outcome, finished_at: 110 },
      },
    }),
    ...evidence.map((data, index) =>
      CompletionRecordSchema.parse({
        version: ON_DISK_FORMATS.completionRecord.version,
        revision: 1,
        kind: "evidence",
        id: completionId(execution.attempt.identity.sequence * 1000 + index),
        data,
      })
    ),
  ];
}

/** Reserve a live publication attempt after producer attempts have settled. */
export function assemblyRecord(
  snap: ValidationSnapshot,
  mode: ComponentEvidence["mode"] = "strict",
): Extract<CompletionRecord, { kind: "attempt" }> {
  const plan: ValidationPlan = {
    candidate_id: snap.candidate_id,
    candidate: snap.candidate,
    demand: {
      kind: "done",
      mode,
      requirements: snap.requirements,
    },
    producers: [],
    reused: [],
    blockers: [],
  };
  const execution = claimed(snap, plan, 999);
  const record = CompletionRecordSchema.parse({
    version: ON_DISK_FORMATS.completionRecord.version,
    revision: 1,
    kind: "attempt",
    id: execution.attempt.identity.id,
    data: execution.attempt,
  });
  if (record.kind !== "attempt") throw new Error("missing assembly attempt");
  return record;
}

/** The live publication fence of a recorded fixture attempt. */
export function fenceOf(
  record: Extract<CompletionRecord, { kind: "attempt" }>,
): PublicationFence {
  return { attempt_id: record.id, token: COMPLETION_CLAIM.token };
}

/** Supply complete metric protocol bytes to the controlled executor. */
export function captured(
  text =
    "DISCERN_METRIC covered 3\nDISCERN_METRIC population 4\nDISCERN_METRIC gaps 1\n",
): ProducerCapture {
  return {
    outcome: "passed",
    complete: true,
    output: new TextEncoder().encode(text),
    artifacts: [],
  };
}
/** Count physical producer calls while allowing deterministic failure and scheduling. */
export function countedRuntime(
  overrides: Partial<ValidationRuntime> = {},
): { runtime: ValidationRuntime; counts: Map<string, number> } {
  const counts = new Map<string, number>();
  return {
    counts,
    runtime: {
      verify: () => Promise.resolve(),
      produce: (producer) => {
        counts.set(producer.selector, (counts.get(producer.selector) ?? 0) + 1);
        return Promise.resolve(captured());
      },
      extract: (_obligation, capture) => Promise.resolve(capture),
      ...overrides,
    },
  };
}

/** Normalize recipe variants through the frozen producer declaration schema. */
export function recipes(
  extra: Record<string, Partial<ProducerDeclaration>>,
): Record<string, ProducerDeclaration> {
  return Object.fromEntries(
    Object.entries(extra).map((
      [name, value],
    ) => [
      name,
      ProducerDeclarationSchema.parse({ ...PRODUCER_RECIPE, ...value }),
    ]),
  );
}
