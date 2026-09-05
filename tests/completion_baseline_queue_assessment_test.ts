/** Assessment traverses immutable predecessor records without trusting queue membership alone. */
import { assert, assertEquals, assertRejects } from "@std/assert";
import { withTempDir } from "./helpers.ts";
import { compositionFixture } from "./completion_queue_git_fixture.ts";
import {
  COMPLETION_CLOCK,
  COMPLETION_DIGEST,
  COMPLETION_REQUIREMENT,
  completionFixtures,
  completionId,
} from "./completion_fixtures.ts";
import { observation } from "./completion_producers_fixtures.ts";
import {
  COMPLETION_FAMILIES,
  type CompletionRecord,
} from "../src/engine/completion/records.ts";
import type {
  EnvironmentExecutor,
  ProducerEvaluator,
} from "../src/engine/completion/protocol.ts";
import {
  composeCandidate,
  publishCandidate,
} from "../src/engine/landing_queue/composition.ts";
import { compositionRecipe } from "../src/engine/landing_queue/generation.ts";
import { assessQueueCandidate } from "../src/engine/landing_queue/assessment.ts";
import { REPOSITORY_QUEUE_ID } from "../src/engine/landing_queue/repository.ts";
import { predecessorPolicyIdentity } from "../src/engine/landing_queue/policy.ts";
import { loadConfig } from "../src/shared/config_schema.ts";
import { TEST_PROCESS_TIMEOUT_MS } from "./waiting.ts";

Deno.test("completion baseline: predecessor chains require matching records and authority, and cycles remain judgment stops", async () => {
  await withTempDir(async (base) => {
    const f = await compositionFixture(base, false);
    const source = f.execution.candidate.source;
    const recipe = await compositionRecipe(
      f.slot,
      await loadConfig(f.slot),
      COMPLETION_DIGEST,
      TEST_PROCESS_TIMEOUT_MS / 1000,
      {},
    );
    const policy = await predecessorPolicyIdentity(f.root, source.head);
    const candidate = await composeCandidate({
      ...f,
      recipe,
      dependencies: [],
      predecessor: { head: source.head, candidate_id: null },
      policy,
      requirement_set: COMPLETION_DIGEST,
      clock: COMPLETION_CLOCK,
    });
    assert(!("kind" in candidate));
    await publishCandidate(
      f.root,
      f.execution.candidate_id,
      candidate,
      f.execution.fence,
      COMPLETION_CLOCK,
    );
    const fixtures = completionFixtures();
    const prior = COMPLETION_FAMILIES.candidate.schema.parse(
      fixtures.candidate,
    );
    prior.id = completionId(90);
    prior.data = {
      ...candidate,
      source: { ...source, effort_id: "predecessor" },
    };
    const authority = COMPLETION_FAMILIES.authority.schema.parse(
      fixtures.authority,
    );
    authority.data = {
      ...authority.data,
      sources: [prior.data.source],
      policy,
      composition_procedure: recipe.identity.procedure,
    };
    const forbidden = (): never => {
      throw new Error("Assessment must not execute or publish");
    };
    const evaluator: ProducerEvaluator = {
      observe: () => Promise.resolve(observation()),
      plan: (_observation, demand, id) => ({
        candidate_id: id,
        candidate,
        demand,
        producers: [],
        reused: [{
          requirement: COMPLETION_REQUIREMENT,
          evidence_id: completionId(3),
        }],
        blockers: [],
      }),
      execute: forbidden,
      assemble: forbidden,
    };
    const environment: EnvironmentExecutor = {
      observe: forbidden,
      claim: forbidden,
      execute: forbidden,
      recover: forbidden,
      plan: () => ({
        kind: "environment-unavailable",
        reason: "No released environment in this observation",
      }),
    };
    const decisions = { judgments: [], variances: [], proposals: [] };
    for (
      const scenario of [
        "missing",
        "mismatch",
        "authority-missing",
        "chain",
        "cycle",
      ] as const
    ) {
      const current: CompletionRecord = {
        version: 1,
        kind: "candidate",
        id: f.execution.candidate_id,
        revision: 1,
        data: {
          ...candidate,
          expected_predecessor: { head: source.head, candidate_id: prior.id },
        },
      };
      const predecessor: CompletionRecord = {
        ...prior,
        data: {
          ...prior.data,
          head: scenario === "mismatch" ? f.predecessor : source.head,
          expected_predecessor: {
            head: source.head,
            candidate_id: scenario === "cycle" ? prior.id : null,
          },
        },
      };
      const queue = COMPLETION_FAMILIES.queue.schema.parse(fixtures.queue);
      queue.id = REPOSITORY_QUEUE_ID;
      queue.data = {
        trunk: source.head,
        entries: queue.data.entries.map((entry) => ({
          ...entry,
          candidate_id: prior.id,
          source: prior.data.source,
          authority_id: authority.id,
        })),
      };
      const records = [
        current,
        queue,
        ...(scenario === "missing" ? [] : [predecessor]),
        ...(scenario === "authority-missing" ? [] : [authority]),
      ];
      const inputs = {
        root: f.root,
        observation: { ...observation(records), trunk: source.head },
        candidate_id: f.execution.candidate_id,
        recipe,
        grants: [],
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
          requirements: [COMPLETION_REQUIREMENT],
        } as const,
      };
      const result = await assessQueueCandidate(inputs);
      assertEquals(result.proof, null);
      if (scenario === "missing" || scenario === "mismatch") {
        assert(
          result.blockers.some((blocker) =>
            blocker.kind === "missing-evidence"
          ),
          scenario,
        );
      } else if (scenario === "authority-missing") {
        assert(
          result.blockers.some((blocker) =>
            blocker.kind === "missing-authority" &&
            blocker.sources.some((item) => item.effort_id === "predecessor")
          ),
        );
      } else if (scenario === "cycle") {
        assert(
          result.blockers.some((blocker) =>
            blocker.kind === "missing-judgment" &&
            blocker.subjects.includes("candidate-predecessor-cycle")
          ),
        );
      } else {
        assertEquals(
          result.blockers.some((blocker) =>
            blocker.kind === "missing-evidence"
          ),
          false,
        );
      }
      assertEquals(result.refresh, null);
      await assertRejects(
        () =>
          assessQueueCandidate({ ...inputs, candidate_id: completionId(999) }),
        Error,
        "required for assessment",
      );
    }
  });
});
