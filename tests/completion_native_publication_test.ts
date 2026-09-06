import { SYSTEM_CLOCK, wallTimeIso } from "../src/shared/clock.ts";
import { currentOperationLocks } from "../src/shared/operation_lock_context.ts";
import { synchronizeQueueAuthorities } from "../src/engine/landing_queue/public_authority.ts";
/** Native queue publication guards use real complete done evidence and desk source grants. */
import { assert, assertEquals, assertRejects } from "@std/assert";
import { withTempDir } from "./helpers.ts";
import { git, gitOut, runAgent } from "./engine_helpers.ts";
import { project } from "./completion_public_fixture.ts";
import { grantEffort } from "../src/engine/worktree/effort_grant_writer.ts";
import { readEffortGrant } from "../src/engine/worktree/effort_grant.ts";
import { readCompletionRecord } from "../src/engine/completion/store.ts";
import {
  observedRecords,
  observeQueue,
  replaceQueue,
  requireQueue,
} from "../src/engine/landing_queue/repository.ts";
import { claimLandingAttempt } from "../src/engine/landing_queue/claims.ts";
import { planQueue } from "../src/engine/landing_queue/planner.ts";
import {
  type LandingBoundary,
  publishQueueLanding,
  type QueueLandingRuntime,
  readLandingProof,
  recoverQueueLanding,
} from "../src/engine/landing_queue/publication.ts";
import { OperationLockError } from "../src/engine/operation_lock.ts";
import { readAcceptanceTransactionMarker } from "../src/engine/worktree/git.ts";

/** All machine evidence comes from public done; the fixture supplies only the owner's desk decision. */
async function ready(root: string): Promise<{
  runtime: QueueLandingRuntime;
  record: import("../src/engine/landing_queue/publication.ts").LandingRecord;
  claim: import("../src/engine/landing_queue/claims.ts").QueueWorkClaim;
  path: string;
}> {
  const path = await project(root, ["local"]);
  const done = await runAgent(path, ["done", "--json"]);
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

Deno.test("native queue landing settles exact authority and retries notes after source checkout removal", async () => {
  await withTempDir(async (root) => {
    const { runtime, record, claim, path } = await ready(root);
    const originalProof = await readLandingProof(runtime, record);
    assert(originalProof.markdown.includes("test"));
    await Deno.writeTextFile(`${root}/receiving-checkout-only`, "keep\n");
    assertEquals(await readLandingProof(runtime, record), originalProof);
    const landed = await publishQueueLanding(
      {
        ...runtime,
        writeNote: () => Promise.reject(new Error("controlled note failure")),
      },
      record,
      null,
      claim.fence,
    );
    assert("outcome" in landed);
    assertEquals(landed.outcome.kind, "landed");
    assertEquals(landed.authority_settlement, "consumed");
    assertEquals(landed.note, "recovery");
    assertEquals(await gitOut(root, "rev-parse", "main"), record.data.target);
    assertEquals(
      await gitOut(root, "status", "--short"),
      "?? receiving-checkout-only",
    );
    assertEquals((await readEffortGrant(path)).status, "missing");
    const authority = record.data.claim.kind === "normal"
      ? await readCompletionRecord(root, {
        kind: "authority",
        id: record.data.claim.authority_id,
      })
      : undefined;
    assert(
      authority?.kind === "recorded" && authority.record.kind === "authority",
    );
    assertEquals(authority.record.data.state.kind, "consumed");
    await git(root, "worktree", "remove", path);
    assertEquals(await readLandingProof(runtime, record), originalProof);
    const retried = await recoverQueueLanding({
      ...runtime,
      sourceCheckout: () => Promise.resolve(undefined),
    }, record.id);
    assert("outcome" in retried);
    assertEquals(retried.outcome.kind, "landed");
    assertEquals(retried.note, "published");
    assertEquals(
      await readCompletionRecord(root, {
        kind: "authority",
        id: authority.record.id,
      }),
      authority,
      "note retry must not spend authority again",
    );
    assertEquals(await readAcceptanceTransactionMarker(root, record.id, true), {
      kind: "present",
      target: record.data.target,
    });
  });
});

Deno.test("native queue publication rejects superseded observation before any ref or grant movement", async () => {
  await withTempDir(async (root) => {
    const { runtime, record, claim, path } = await ready(root);
    const before = await gitOut(root, "rev-parse", "main");
    const grant = await readEffortGrant(path);
    const refused = await publishQueueLanding(
      {
        ...runtime,
        audit: async () => {
          const observation = await observeQueue(root, "main");
          const queue = await requireQueue(root);
          assertEquals(
            (await replaceQueue(root, queue, queue.record.data)).kind,
            "written",
          );
          return observation;
        },
      },
      record,
      null,
      claim.fence,
    );
    assert("kind" in refused);
    assertEquals(refused.kind, "stale-evidence");
    assertEquals(await gitOut(root, "rev-parse", "main"), before);
    assertEquals(await readEffortGrant(path), grant);
    assertEquals((await readCompletionRecord(root, record)).kind, "missing");
  });
});

Deno.test("native racing accept actors have one checked-out ref publication", async () => {
  await withTempDir(async (root) => {
    const { runtime, record, claim } = await ready(root);
    const entered = Promise.withResolvers<void>();
    const release = Promise.withResolvers<void>();
    const first = publishQueueLanding(
      {
        ...runtime,
        afterBoundary: async (boundary) => {
          if (boundary === "planned") {
            entered.resolve();
            await release.promise;
          }
        },
      },
      record,
      null,
      claim.fence,
    );
    await entered.promise;
    try {
      await assertRejects(
        () => publishQueueLanding(runtime, record, null, claim.fence),
        OperationLockError,
      );
    } finally {
      release.resolve();
    }
    const result = await first;
    assert("outcome" in result);
    assertEquals(result.outcome.kind, "landed");
    assertEquals(await gitOut(root, "rev-parse", "main"), record.data.target);
    assertEquals(
      (await requireQueue(root)).record.data.entries[0]?.state,
      "landed",
    );
  });
});

for (
  const boundary of [
    "planned",
    "grant",
    "ref",
    "authority",
    "note",
  ] satisfies LandingBoundary[]
) {
  Deno.test(`native landing recovery after ${boundary} preserves exactly-once transition and settlement`, async () => {
    await withTempDir(async (root) => {
      const { runtime, record, claim, path } = await ready(root);
      await assertRejects(
        () =>
          publishQueueLanding(
            {
              ...runtime,
              afterBoundary: (phase) => {
                if (phase === boundary) {
                  return Promise.reject(new Error("controlled interruption"));
                }
                return Promise.resolve();
              },
            },
            record,
            null,
            claim.fence,
          ),
        Error,
        "controlled interruption",
      );
      const recovered = await recoverQueueLanding(runtime, record.id);
      assert("outcome" in recovered);
      const advanced = boundary !== "planned" && boundary !== "grant";
      assertEquals(recovered.outcome.kind, advanced ? "landed" : "not-landed");
      assertEquals(
        recovered.authority_settlement,
        advanced ? "consumed" : "restored",
      );
      assertEquals(
        await gitOut(root, "rev-parse", "main"),
        advanced ? record.data.target : record.data.expected_trunk,
      );
      assertEquals(
        (await readEffortGrant(path)).status,
        advanced ? "missing" : "granted",
      );
      assertEquals(await gitOut(root, "status", "--short"), "");
    });
  });
}
