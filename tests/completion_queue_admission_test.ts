import { assert, assertEquals } from "@std/assert";
import { withTempDir } from "./helpers.ts";
import { environmentFixture } from "./completion_environments_fixture.ts";
import { countedRuntime, snapshot } from "./completion_producers_fixtures.ts";
import { completionId } from "./completion_fixtures.ts";
import { createProducerEvaluator } from "../src/engine/validation/evaluator.ts";
import { createEnvironmentExecutor } from "../src/engine/execution/executor.ts";
import {
  initializeQueue,
  observeQueue,
  requireQueue,
  reserveQueueAttempt,
} from "../src/engine/landing_queue/repository.ts";
import {
  claimQueueWork,
  retainedExecutionCount,
  workCapacity,
} from "../src/engine/landing_queue/claims.ts";
import { queueExample } from "./completion_queue_fixture.ts";
import { driveQueueValidation } from "../src/engine/landing_queue/driver.ts";
import { mutateQueue } from "../src/engine/landing_queue/mutations.ts";
import { CompletionPolicySchema } from "../src/engine/completion/configuration.ts";
import {
  readCompletionRecord,
  writeCompletionRecord,
} from "../src/engine/completion/store.ts";
import type { ValidationExecution } from "../src/engine/completion/protocol.ts";

Deno.test("queue Q01/Q06: complete demand admits once without preflight and survives unrelated queue publication", async () => {
  for (const withdraw of [false, true]) {
    await withTempDir(async (base) => {
      const f = await environmentFixture(base, "undeclared");
      const root = f.root;
      const trunk = f.source.branch;
      await initializeQueue(root, f.source.head);
      await mutateQueue({
        root,
        trunk,
        expected_stamp: (await requireQueue(root)).stamp,
        mutation: { kind: "select", source: f.source, dependencies: [] },
        clock: f.clock,
      });
      const tip = {
        ...f.candidate,
        head: f.source.head,
        tree: f.source.tree,
        expected_predecessor: { head: f.source.head, candidate_id: null },
      };
      const claim = await claimQueueWork({
        root,
        expected_stamp: (await requireQueue(root)).stamp,
        effort: f.source.effort_id,
        candidate_id: completionId(1),
        environment_id: f.id,
        executor: f.actor,
        policy: CompletionPolicySchema.parse({}),
        lease_ms: 10000,
        rerun_of: null,
        candidate: tip,
        clock: f.clock,
      });
      assert("fence" in claim);
      const snap = await snapshot({
        candidate: { ...tip, attempt_id: claim.fence.attempt_id },
      });
      // This fixture starts at the selected immutable candidate boundary; composition has separate real-Git guards.
      assertEquals(
        (await writeCompletionRecord(
          root,
          {
            version: 1,
            kind: "candidate",
            id: completionId(1),
            revision: 1,
            data: snap.candidate,
          },
          null,
          claim.fence,
          f.clock,
        )).kind,
        "written",
      );
      const started = Promise.withResolvers<void>();
      const continueRun = Promise.withResolvers<void>();
      const counted = countedRuntime();
      const runtime = {
        ...counted.runtime,
        produce: async (
          ...args: Parameters<typeof counted.runtime.produce>
        ) => {
          started.resolve();
          await continueRun.promise;
          return await counted.runtime.produce(...args);
        },
      };
      const evaluator = createProducerEvaluator({
        root,
        snapshot: snap,
        runtime,
        observe: () => observeQueue(root, trunk, f.clock),
        clock: f.clock,
      });
      const validation = evaluator.plan(
        await evaluator.observe(completionId(1)),
        {
          kind: "done",
          context: "local",
          mode: "strict",
          requirements: snap.requirements,
        },
        completionId(1),
      );
      const environment = createEnvironmentExecutor({
        ...f.options,
        reserveAttempt: (plan, executor) =>
          reserveQueueAttempt(root, plan, executor, null, f.clock),
        validationOutcome: (value) =>
          (value as ValidationExecution).blockers.length === 0
            ? "passed"
            : "failed",
      });
      const plan = environment.plan(
        await observeQueue(root, trunk, f.clock),
        validation,
      );
      assert(!("kind" in plan), JSON.stringify(plan));
      const running = driveQueueValidation({
        root,
        trunk,
        claim,
        plan,
        environment,
        evaluator,
        assembly_lease_ms: 10000,
        clock: f.clock,
      });
      await Promise.race([
        started.promise,
        running.then((result) => {
          throw new Error(
            `Validation returned before producing: ${JSON.stringify(result)}`,
          );
        }),
      ]);
      const selected = await requireQueue(root);
      const change = await mutateQueue({
        root,
        trunk,
        expected_stamp: selected.stamp,
        mutation: withdraw
          ? { kind: "withdrawn", effort: f.source.effort_id }
          : {
            kind: "select",
            source: {
              ...f.source,
              effort_id: "unrelated",
              branch: "refs/heads/agent/unrelated",
            },
            dependencies: [],
          },
        clock: f.clock,
      });
      assertEquals(change.kind, "changed");
      if (withdraw) {
        const retained = retainedExecutionCount(
          [],
          await observeQueue(root, trunk, f.clock),
        );
        assertEquals(retained, 1);
        assertEquals(
          workCapacity(
            queueExample(2).queue.entries,
            "effort-0",
            CompletionPolicySchema.parse({ concurrency: 1 }),
            false,
            retained,
          )?.kind,
          "environment-unavailable",
        );
      }
      continueRun.resolve();
      const result = await running;
      assertEquals(counted.counts.get("jobs.test"), 1);
      if (withdraw) {
        assert(result.kind !== "admitted");
        const after = await observeQueue(root, trunk, f.clock);
        assertEquals(
          after.records.filter(({ selector }) => selector.kind === "proof")
            .length,
          0,
        );
      } else {
        assertEquals(result.kind, "admitted", JSON.stringify(result));
        assert(result.kind === "admitted");
        const proof = await readCompletionRecord(root, {
          kind: "proof",
          id: result.proof_id,
        });
        assert(proof.kind === "recorded" && proof.record.kind === "proof");
        assertEquals(proof.record.data.requirements, snap.requirements);
        assertEquals(
          (await requireQueue(root)).record.data.entries[0]?.state,
          "provisional",
        );
      }
    });
  }
});
