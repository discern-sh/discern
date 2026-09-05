import { assert, assertEquals } from "@std/assert";
import { join } from "@std/path";
import { withTempDir } from "./helpers.ts";
import { compositionFixture } from "./completion_queue_git_fixture.ts";
import {
  countedRuntime,
  obligations,
  snapshot,
} from "./completion_producers_fixtures.ts";
import {
  COMPLETION_CLOCK,
  COMPLETION_DIGEST,
  completionFixtures,
} from "./completion_fixtures.ts";
import { TEST_PROCESS_TIMEOUT_MS } from "./waiting.ts";
import { loadConfig } from "../src/shared/config_schema.ts";
import {
  composeCandidate,
  publishCandidate,
} from "../src/engine/landing_queue/composition.ts";
import { compositionRecipe } from "../src/engine/landing_queue/generation.ts";
import { predecessorPolicyIdentity } from "../src/engine/landing_queue/policy.ts";
import { assessQueueCandidate } from "../src/engine/landing_queue/assessment.ts";
import { createQueuePlanner } from "../src/engine/landing_queue/planner.ts";
import {
  observeQueue,
  replaceQueue,
  requireQueue,
} from "../src/engine/landing_queue/repository.ts";
import { createProducerEvaluator } from "../src/engine/validation/evaluator.ts";
import { CompletionPolicySchema } from "../src/engine/completion/configuration.ts";
import { COMPLETION_FAMILIES } from "../src/engine/completion/records.ts";
import {
  readCompletionRecord,
  writeCompletionRecord,
} from "../src/engine/completion/store.ts";
import type { EnvironmentExecutor } from "../src/engine/completion/protocol.ts";

Deno.test("queue ports: current composition selects evidence refresh and revoked authority rejects optimistic publication", async () => {
  await withTempDir(async (base) => {
    const f = await compositionFixture(base, false);
    const source = f.execution.candidate.source;
    const id = f.execution.candidate_id;
    const root = join(base, "repository-alias");
    await Deno.symlink(await Deno.realPath(f.root), root);
    const recipe = await compositionRecipe(
      f.slot,
      await loadConfig(f.slot),
      COMPLETION_DIGEST,
      TEST_PROCESS_TIMEOUT_MS / 1000,
      {},
    );
    const policy = await predecessorPolicyIdentity(root, source.head);
    const predecessor = { head: source.head, candidate_id: null };
    const initial = await snapshot({
      candidate_id: id,
      candidate: {
        ...f.execution.candidate,
        policy,
        expected_predecessor: predecessor,
      },
      obligations: obligations().filter((item) =>
        item.requirement.kind === "job"
      ),
    });
    const candidate = await composeCandidate({
      ...f,
      root,
      recipe,
      dependencies: [],
      predecessor,
      policy,
      requirement_set: initial.candidate.requirement_set,
      clock: COMPLETION_CLOCK,
    });
    assert(!("kind" in candidate), JSON.stringify(candidate));
    await publishCandidate(
      root,
      id,
      candidate,
      f.execution.fence,
      COMPLETION_CLOCK,
    );
    const authority = COMPLETION_FAMILIES.authority.schema.parse(
      completionFixtures().authority,
    );
    authority.data = {
      ...authority.data,
      sources: [source],
      policy,
      composition_procedure: recipe.identity.procedure,
    };
    assertEquals(
      (await writeCompletionRecord(
        root,
        authority,
        null,
        undefined,
        COMPLETION_CLOCK,
      )).kind,
      "written",
    );
    const selected = await requireQueue(root);
    await replaceQueue(root, selected, {
      trunk: source.head,
      entries: selected.record.data.entries.map((entry) => ({
        ...entry,
        state: "eligible",
        authority_id: authority.id,
      })),
    }, COMPLETION_CLOCK);
    const snap = await snapshot({
      candidate_id: id,
      candidate,
      obligations: obligations().filter((item) =>
        item.requirement.kind === "job"
      ),
    });
    const counted = countedRuntime();
    const evaluator = createProducerEvaluator({
      root,
      snapshot: snap,
      runtime: counted.runtime,
      observe: () => observeQueue(root, source.branch, COMPLETION_CLOCK),
      clock: COMPLETION_CLOCK,
    });
    let ready = false;
    let effects = 0;
    const forbidden = (): Promise<never> => {
      effects++;
      return Promise.reject(
        new Error(
          "A queue observation or plan must not execute the environment.",
        ),
      );
    };
    // Availability is controlled at the port; native environment execution is covered by the admission exercise.
    const environment: EnvironmentExecutor = {
      observe: (environmentId) =>
        readCompletionRecord(root, { kind: "environment", id: environmentId }),
      plan: (observation, validation) => {
        if (!ready) {
          return {
            kind: "environment-unavailable",
            reason: "No released validation environment",
          };
        }
        const reading = observation.records.find(({ selector }) =>
          selector.kind === "environment" &&
          selector.id === f.execution.environment_id
        )?.reading;
        assert(reading?.kind === "recorded");
        return {
          action: "source-tip",
          declaration: null,
          environment_id: f.execution.environment_id,
          expected_stamp: reading.stamp,
          candidate_id: id,
          validation,
        };
      },
      claim: forbidden,
      execute: forbidden,
      recover: forbidden,
    };
    const decisions = { judgments: [], variances: [], proposals: [] };
    const planner = createQueuePlanner({
      root,
      trunk: source.branch,
      executor: f.execution.attempt.identity.executor,
      transition_attempts: new Map(),
      clock: COMPLETION_CLOCK,
      assess: async (observation) =>
        new Map([[
          id,
          await assessQueueCandidate({
            root,
            observation,
            candidate_id: id,
            recipe,
            grants: [{
              source,
              record_id: authority.data.source.record_id,
              policy,
              current: true,
              classifications: [],
              granted_scopes: [],
              defined_scopes: [],
            }],
            current_decisions: decisions,
            authorized_decisions: decisions,
            judgment_blockers: [],
            standards: [],
            evaluator,
            environment,
            demand: {
              kind: "done",
              mode: "strict",
              context: "local",
              requirements: snap.requirements,
            },
          }),
        ]]),
    });
    const bounds = CompletionPolicySchema.parse({ concurrency: 2 });
    const before = await requireQueue(root);
    const unavailable = planner.plan(
      await planner.observe(),
      bounds,
      source.effort_id,
    );
    assertEquals(unavailable.blockers[0]?.kind, "environment-unavailable");
    assertEquals((await requireQueue(root)).stamp, before.stamp);
    ready = true;
    const refresh = planner.plan(
      await planner.observe(),
      bounds,
      source.effort_id,
    );
    assertEquals(refresh.actions[0]?.kind, "validate");
    assertEquals(refresh.blockers, []);
    assertEquals(
      (await planner.publish(refresh, f.execution.attempt.identity.executor))
        .kind,
      "published",
    );
    const stale = planner.plan(
      await planner.observe(),
      bounds,
      source.effort_id,
    );
    const currentAuthority = await readCompletionRecord(root, authority);
    assert(currentAuthority.kind === "recorded");
    await writeCompletionRecord(
      root,
      {
        ...authority,
        revision: 2,
        data: { ...authority.data, state: { kind: "revoked", at: 100 } },
      },
      currentAuthority.stamp,
      undefined,
      COMPLETION_CLOCK,
    );
    assertEquals(
      (await planner.publish(stale, f.execution.attempt.identity.executor))
        .kind,
      "replan",
    );
    const revoked = planner.plan(
      await planner.observe(),
      bounds,
      source.effort_id,
    );
    assertEquals(revoked.blockers[0]?.kind, "missing-authority");
    assertEquals(revoked.actions, []);
    assertEquals(effects, 0);
    assertEquals(counted.counts.size, 0);
    assertEquals(
      (await planner.observe()).records.filter(({ selector }) =>
        selector.kind === "landing"
      ).length,
      0,
    );
  });
});
