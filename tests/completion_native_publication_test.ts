import { withCompletionObserver } from "../src/engine/completion/events.ts";
import type { CompletionEvent } from "../src/engine/completion/protocol.ts";
import { countedAdminQueries } from "./git_admin_observer.ts";
/** Native queue publication guards use real complete done evidence and desk source grants. */
import { assert, assertEquals, assertRejects } from "@std/assert";
import { withTempDir } from "./helpers.ts";
import { git, gitOut } from "./engine_helpers.ts";
import {
  claimedLanding,
  provenSource,
  type ReadyLanding,
} from "./completion_journey_fixture.ts";
import { readEffortGrant } from "../src/engine/worktree/effort_grant.ts";
import { readCompletionRecord } from "../src/engine/completion/store.ts";
import {
  observeQueue,
  replaceQueue,
  requireQueue,
} from "../src/engine/landing_queue/repository.ts";
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
import type { CompletionLanding } from "../src/engine/completion/outcomes.ts";
import type { Proof } from "../src/shared/result_schemas.ts";

/** One complete public done, granted at the desk and claimed by a native landing actor. */
async function ready(root: string): Promise<ReadyLanding> {
  return await claimedLanding(root, await provenSource(root));
}

// Every refusal below leaves the claimed plan landable, so one proven source
// carries the read-only Proof checks, each no-movement refusal, the racing
// second actor, and finally the landing whose note publication is retried.
Deno.test("native queue landing refuses without movement, then settles exact authority and retries notes after source checkout removal", async (t) => {
  await withTempDir(async (root) => {
    const { runtime, record, claim, path } = await ready(root);
    const before = await gitOut(root, "rev-parse", "main");
    const grant = await readEffortGrant(path);
    const unmoved = async (): Promise<void> => {
      assertEquals(await gitOut(root, "rev-parse", "main"), before);
      assertEquals(await readEffortGrant(path), grant);
      assertEquals((await readCompletionRecord(root, record)).kind, "missing");
    };
    let originalProof: Proof | undefined;

    await t.step(
      "native queue landing reads its exact retained Proof and rejects another subject or trunk",
      async () => {
        const reading = await countedAdminQueries(() =>
          readLandingProof(runtime, record)
        );
        originalProof = reading.value;
        assertEquals(
          reading.queries,
          4,
          "one record-store scope and one read of each retained review and presentation",
        );
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
          () =>
            readLandingProof({ ...runtime, trunk: "another-trunk" }, record),
          Error,
          "Proof names another trunk",
        );
        assertEquals(await readLandingNoteResult(root, record.data), undefined);
      },
    );

    await t.step(
      "native queue publication rejects superseded observation before any ref or grant movement",
      async () => {
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
        await unmoved();
      },
    );

    await t.step(
      "native publication preserves source authority when the receiving checkout is unavailable",
      async () => {
        const publish = (): ReturnType<typeof publishQueueLanding> =>
          publishQueueLanding(runtime, record, null, claim.fence);
        const marker = `${root}/.git/MERGE_HEAD`;
        await Deno.writeTextFile(marker, `${before}\n`);
        let refusal = await publish();
        assert("kind" in refusal && refusal.kind === "environment-unavailable");
        await Deno.remove(marker);
        await git(root, "checkout", "-b", "receiving-other");
        refusal = await publish();
        assert("kind" in refusal && refusal.kind === "environment-unavailable");
        await git(root, "checkout", "main");
        await git(root, "branch", "-D", "receiving-other");
        const configPath = `${root}/discern.toml`;
        const config = await Deno.readTextFile(configPath);
        await Deno.writeTextFile(
          configPath,
          `${config}\n# unsaved receiving edit\n`,
        );
        refusal = await publish();
        assert("kind" in refusal && refusal.kind === "environment-unavailable");
        await Deno.writeTextFile(configPath, config);
        const sourceConfigPath = `${path}/discern.toml`;
        const sourceConfig = await Deno.readTextFile(sourceConfigPath);
        await Deno.writeTextFile(
          sourceConfigPath,
          `${sourceConfig}\n# unsaved source edit\n`,
        );
        refusal = await publish();
        assert("kind" in refusal && refusal.kind === "stale-evidence");
        assertEquals(refusal.reason, "source-replaced");
        await Deno.writeTextFile(sourceConfigPath, sourceConfig);
        await unmoved();
        assertEquals(await gitOut(root, "status", "--short"), "");
      },
    );

    // The landing keeps the untracked receiving file and fails its note on purpose;
    // the racing second actor is refused at the checkout lock while it is planned.
    let landed: CompletionLanding | undefined;
    await t.step(
      "native racing accept actors have one checked-out ref publication",
      async () => {
        const proof = originalProof;
        assert(proof !== undefined);
        await Deno.writeTextFile(`${root}/receiving-checkout-only`, "keep\n");
        assertEquals(await readLandingProof(runtime, record), proof);
        const entered = Promise.withResolvers<void>();
        const release = Promise.withResolvers<void>();
        const facts: CompletionEvent[] = [];
        const first = withCompletionObserver((fact) => {
          if (fact.kind === "event") facts.push(fact.event);
        }, () =>
          publishQueueLanding(
            {
              ...runtime,
              writeNote: () =>
                Promise.reject(new Error("controlled note failure")),
              afterBoundary: async (boundary, planned) => {
                await runtime.afterBoundary?.(boundary, planned);
                if (boundary === "planned") {
                  entered.resolve();
                  await release.promise;
                }
              },
            },
            record,
            null,
            claim.fence,
          ));
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
        const spans = facts.flatMap((event) =>
          event.fact.kind === "timing" &&
            event.fact.category === "approval-to-land"
            ? [event.fact]
            : []
        );
        assertEquals(spans.length, 1);
        assert(result.outcome.kind === "landed");
        assertEquals(spans[0]?.finished_at, result.outcome.at);
        assert((spans[0]?.started_at ?? Infinity) <= result.outcome.at);

        assertEquals(
          await gitOut(root, "rev-parse", "main"),
          record.data.target,
        );
        assertEquals(
          (await requireQueue(root)).record.data.entries[0]?.state,
          "landed",
        );
        landed = result;
      },
    );

    await t.step(
      "native queue landing settles exact authority and retries notes after source checkout removal",
      async () => {
        const landing = landed;
        const proof = originalProof;
        assert(landing !== undefined && proof !== undefined);
        assertEquals(landing.authority_settlement, "consumed");
        assertEquals(landing.note, "recovery");
        assert(landing.note_result !== undefined);
        for (const field of ["attempt_id", "candidate_id"] as const) {
          const note_result = {
            ...landing.note_result,
            [field]: "00000000-0000-4000-8000-000000000001",
          };
          await assertRejects(
            () => readLandingNoteResult(root, { ...landing, note_result }),
            Error,
            "another landing attempt or candidate",
          );
        }
        const note = await readLandingNoteResult(root, landing);
        assert(note !== undefined && note.hints.length > 0);
        assertEquals(
          await gitOut(root, "rev-parse", "main"),
          record.data.target,
        );
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
          authority?.kind === "recorded" &&
            authority.record.kind === "authority",
        );
        assertEquals(authority.record.data.state.kind, "consumed");
        await git(root, "worktree", "remove", path);
        assertEquals(await readLandingProof(runtime, record), proof);
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
        assertEquals(
          await readAcceptanceTransactionMarker(root, record.id, true),
          {
            kind: "present",
            target: record.data.target,
          },
        );
      },
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
