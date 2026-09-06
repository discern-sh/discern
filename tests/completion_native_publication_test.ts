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
  LANDING_BOUNDARIES,
  publishQueueLanding,
  type QueueLandingRuntime,
  readLandingNoteResult,
  readLandingProof,
  recoverQueueLanding,
} from "../src/engine/landing_queue/publication.ts";
import { readLandingConvergenceResult } from "../src/engine/landing_queue/convergence.ts";
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

Deno.test("native queue landing settles exact authority and retries notes after source checkout removal", async () => {
  await withTempDir(async (root) => {
    const { runtime, record, claim, path } = await ready(root);
    const originalProof = await readLandingProof(runtime, record);
    assert(originalProof.markdown.includes("test"));
    for (
      const change of [
        { policy: "0".repeat(64) },
        { target: "0".repeat(40) },
        { expected_trunk: "0".repeat(40) },
        { source: { ...record.data.source, head: "0".repeat(40) } },
      ]
    ) {
      await assertRejects(
        () =>
          readLandingProof(runtime, {
            ...record,
            data: { ...record.data, ...change },
          }),
        Error,
        "landing subject differs",
      );
    }
    await assertRejects(
      () => readLandingProof({ ...runtime, trunk: "another-trunk" }, record),
      Error,
      "Proof names another trunk",
    );
    assertEquals(await readLandingNoteResult(root, record.data), undefined);
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
    assert(landed.note_result !== undefined);
    for (const field of ["attempt_id", "candidate_id"] as const) {
      const note_result = {
        ...landed.note_result,
        [field]: "00000000-0000-4000-8000-000000000001",
      };
      await assertRejects(
        () => readLandingNoteResult(root, { ...landed, note_result }),
        Error,
        "another landing attempt or candidate",
      );
    }
    const note = await readLandingNoteResult(root, landed);
    assert(note !== undefined && note.hints.length > 0);
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

for (const boundary of LANDING_BOUNDARIES) {
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

Deno.test("native publication preserves source authority when the receiving checkout is unavailable", async () => {
  await withTempDir(async (root) => {
    const { runtime, record, claim, path } = await ready(root);
    const head = await gitOut(root, "rev-parse", "main");
    const grant = await readEffortGrant(path);
    const publish = (): ReturnType<typeof publishQueueLanding> =>
      publishQueueLanding(runtime, record, null, claim.fence);
    const marker = `${root}/.git/MERGE_HEAD`;
    await Deno.writeTextFile(marker, `${head}\n`);
    let refusal = await publish();
    assert("kind" in refusal && refusal.kind === "environment-unavailable");
    await Deno.remove(marker);
    await git(root, "checkout", "-b", "receiving-other");
    refusal = await publish();
    assert("kind" in refusal && refusal.kind === "environment-unavailable");
    await git(root, "checkout", "main");
    const configPath = `${root}/discern.toml`;
    const config = await Deno.readTextFile(configPath);
    await Deno.writeTextFile(
      configPath,
      `${config}\n# unsaved receiving edit\n`,
    );
    refusal = await publish();
    assert("kind" in refusal && refusal.kind === "environment-unavailable");
    await Deno.writeTextFile(configPath, config);
    assertEquals(await gitOut(root, "rev-parse", "main"), head);
    assertEquals(await readEffortGrant(path), grant);
    assertEquals((await readCompletionRecord(root, record)).kind, "missing");
    assertEquals(await gitOut(root, "status", "--short"), "");
  });
});

Deno.test("native convergence retries preserve a landed ref and consumed authority", async () => {
  await withTempDir(async (root) => {
    const { runtime, record, claim } = await ready(root);
    let calls = 0;
    const retryRuntime: QueueLandingRuntime = {
      ...runtime,
      converge: async () => {
        calls += 1;
        if (calls === 1) throw new Error("controlled convergence failure");
        if (calls === 2) await git(root, "checkout", "-b", "convergence-other");
        return { ok: true, steps: [], diagnostics: [], hints: [] };
      },
    };
    let landed = await publishQueueLanding(
      retryRuntime,
      record,
      null,
      claim.fence,
    );
    assert("outcome" in landed && landed.outcome.kind === "landed");
    assertEquals(landed.authority_settlement, "consumed");
    let convergence = await readLandingConvergenceResult(root, landed);
    assert(convergence !== undefined && !convergence.ok);
    assertEquals(
      convergence.diagnostics[0]?.message,
      "controlled convergence failure",
    );
    assert(record.data.claim.kind === "normal");
    const authorityRef = {
      kind: "authority" as const,
      id: record.data.claim.authority_id,
    };
    const authority = await readCompletionRecord(root, authorityRef);
    await git(root, "checkout", "-b", "receiving-held");
    const blocked = await recoverQueueLanding(retryRuntime, record.id);
    assert("kind" in blocked && blocked.kind === "environment-unavailable");
    assertEquals(calls, 1, "an unavailable checkout cannot rerun convergence");
    await git(root, "checkout", "main");
    landed = await recoverQueueLanding(retryRuntime, record.id);
    assert("outcome" in landed && landed.outcome.kind === "landed");
    convergence = await readLandingConvergenceResult(root, landed);
    assert(convergence !== undefined && !convergence.ok);
    assert(
      convergence.diagnostics.some((diagnostic) =>
        diagnostic.message.includes("main checkout changed commits")
      ),
    );
    await git(root, "checkout", "main");
    landed = await recoverQueueLanding(retryRuntime, record.id);
    assert("outcome" in landed && landed.outcome.kind === "landed");
    assertEquals((await readLandingConvergenceResult(root, landed))?.ok, true);
    const repeated = await recoverQueueLanding(retryRuntime, record.id);
    assert("outcome" in repeated && repeated.outcome.kind === "landed");
    assertEquals(
      calls,
      3,
      "successful convergence is retained, never replayed",
    );
    assertEquals(await readCompletionRecord(root, authorityRef), authority);
    assertEquals(await gitOut(root, "rev-parse", "main"), record.data.target);
    assertEquals(await gitOut(root, "status", "--short"), "");
    assertEquals(await readAcceptanceTransactionMarker(root, record.id, true), {
      kind: "present",
      target: record.data.target,
    });
  });
});
