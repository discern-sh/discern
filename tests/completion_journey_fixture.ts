/** One real public done, the owner's desk decision, and one claimed landing plan shared by the native queue guards. */
import { assert, assertEquals } from "@std/assert";
import { SYSTEM_CLOCK, wallTimeIso } from "../src/shared/clock.ts";
import { currentOperationLocks } from "../src/shared/operation_lock_context.ts";
import { synchronizeQueueAuthorities } from "../src/engine/landing_queue/public_authority.ts";
import { runAgent } from "./engine_helpers.ts";
import { project } from "./completion_public_fixture.ts";
import { grantEffort } from "../src/engine/worktree/effort_grant_writer.ts";
import type { CompletionRecord } from "../src/engine/completion/records.ts";
import type { CompletionLanding } from "../src/engine/completion/outcomes.ts";
import {
  observedRecords,
  observeQueue,
  requireQueue,
} from "../src/engine/landing_queue/repository.ts";
import {
  claimLandingAttempt,
  type QueueWorkClaim,
} from "../src/engine/landing_queue/claims.ts";
import { planQueue } from "../src/engine/landing_queue/planner.ts";
import {
  type LandingRecord,
  publishQueueLanding,
  type QueueLandingRuntime,
} from "../src/engine/landing_queue/publication.ts";

export interface ProvenSource {
  readonly path: string;
  readonly candidate: Extract<CompletionRecord, { kind: "candidate" }>;
  readonly proof: Extract<CompletionRecord, { kind: "proof" }>;
}

export interface ReadyLanding {
  readonly runtime: QueueLandingRuntime;
  readonly record: LandingRecord;
  readonly claim: QueueWorkClaim;
  readonly path: string;
}

/** All machine evidence comes from public done; the fixture supplies only the owner's desk decision. */
export async function provenSource(
  root: string,
  options: { readonly retainCheckout?: boolean } = {},
): Promise<ProvenSource> {
  const path = await project(root, ["local"]);
  const done = await runAgent(path, [
    "done",
    "--json",
    ...(options.retainCheckout ? ["--retain-checkout"] : []),
  ]);
  assertEquals(done.code, 0, done.output);
  const records = observedRecords(await observeQueue(root, "main"));
  const candidate = records.find((record) => record.kind === "candidate");
  const proof = records.find((record) => record.kind === "proof");
  assert(candidate?.kind === "candidate" && proof?.kind === "proof");
  await grantEffort(
    path,
    candidate.data.source.branch.slice("refs/heads/".length),
    wallTimeIso(SYSTEM_CLOCK.wallNow()),
  );
  return { path, candidate, proof };
}

/** Audit the desk decision into queue authority and claim one exact landing plan for a native actor. */
export async function claimedLanding(
  root: string,
  proven: ProvenSource,
): Promise<ReadyLanding> {
  const { path, candidate, proof } = proven;
  await synchronizeQueueAuthorities(root, "main");
  const queue = await requireQueue(root);
  const authorityId = queue.record.data.entries.find((entry) =>
    entry.source.effort_id === candidate.data.source.effort_id
  )?.authority_id;
  assert(authorityId !== undefined && authorityId !== null);
  await synchronizeQueueAuthorities(root, "main");
  assertEquals(
    await requireQueue(root),
    queue,
    "a repeated authority audit does not replace a current source decision or queue rank",
  );
  const actor = {
    operation_id: crypto.randomUUID(),
    originating_effort: candidate.data.source.effort_id,
    started_at: SYSTEM_CLOCK.wallNow(),
  };
  const claim = await claimLandingAttempt({
    root,
    candidate_id: candidate.id,
    executor: actor,
    lease_ms: 60_000,
  });
  assert(!("kind" in claim));
  const observation = await observeQueue(root, "main");
  const planned = planQueue({
    observation,
    policy: { required_contexts: ["local"], concurrency: 1, lookahead: 0 },
    requested_effort: candidate.data.source.effort_id,
    assessments: new Map([[candidate.id, {
      candidate_id: candidate.id,
      candidate: candidate.data,
      blockers: [],
      proof,
      authority_id: authorityId,
      decisions: { judgments: [], variances: [], proposals: [] },
      refresh: null,
    }]]),
    executor: actor,
    transition_attempts: new Map([[candidate.id, claim.attempt.identity]]),
  });
  assertEquals(planned.blockers, []);
  const action = planned.actions[0];
  assert(action?.kind === "land");
  return {
    path,
    record: action.record,
    claim,
    runtime: {
      root,
      mainRepo: root,
      trunk: "main",
      sourceCheckout: () => Promise.resolve(path),
      converge: () => {
        assertEquals([...(currentOperationLocks()?.boundaries ?? [])], [
          "checkout",
        ], "main convergence never holds the shared publication lock");
        return Promise.resolve({
          ok: true,
          steps: [],
          diagnostics: [],
          hints: [],
        });
      },
      afterBoundary: (phase) => {
        if (phase === "planned") {
          assertEquals(
            [...(currentOperationLocks()?.boundaries ?? [])].sort(),
            ["checkout", "common"],
            "native publication owns both concrete locks without a command-wide lock",
          );
        }
        return Promise.resolve();
      },
      // Publication is tested below an already evaluated plan; public assessment has separate guards.
      audit: () => observeQueue(root, "main"),
    },
  };
}

/** Settle the claimed plan through the production publication core; the outcome matches a public accept. */
export async function landInProcess(
  ready: ReadyLanding,
): Promise<CompletionLanding> {
  const landed = await publishQueueLanding(
    ready.runtime,
    ready.record,
    null,
    ready.claim.fence,
  );
  assert("outcome" in landed, JSON.stringify(landed));
  assertEquals(landed.outcome.kind, "landed");
  assertEquals(landed.authority_settlement, "consumed");
  assertEquals(landed.note, "published");
  return landed;
}
