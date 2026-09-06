/** Invalid composition inputs never publish or replace the author's source. */
import { assert, assertEquals, assertRejects } from "@std/assert";
import { join } from "@std/path";
import { withTempDir } from "./helpers.ts";
import { git, gitOut } from "./engine_helpers.ts";
import { compositionFixture } from "./completion_queue_git_fixture.ts";
import {
  COMPLETION_CLOCK,
  COMPLETION_DIGEST,
  completionId,
} from "./completion_fixtures.ts";
import { compositionRecipe } from "../src/engine/landing_queue/generation.ts";
import { loadConfig } from "../src/shared/config_schema.ts";
import {
  composeCandidate,
  publishCandidate,
  verifyComposition,
} from "../src/engine/landing_queue/composition.ts";
import { TEST_PROCESS_TIMEOUT_MS } from "./waiting.ts";

Deno.test("completion baseline: composition refuses dirty, attached, expired, and displaced execution subjects", async () => {
  for (
    const scenario of [
      "dirty",
      "attached",
      "expired",
      "environment",
      "ancestry",
    ] as const
  ) {
    await withTempDir(async (base) => {
      const f = await compositionFixture(base, false);
      const recipe = await compositionRecipe(
        f.slot,
        await loadConfig(f.slot),
        COMPLETION_DIGEST,
        TEST_PROCESS_TIMEOUT_MS / 1000,
        {},
      );
      if (scenario === "dirty") {
        await Deno.writeTextFile(
          join(f.slot, "unapproved"),
          "pending source\n",
        );
      }
      if (scenario === "attached") {
        await git(f.slot, "switch", "-c", "agent/attached");
      }
      const input = {
        prepare: () => Promise.resolve(),
        ...f,
        recipe,
        dependencies: [],
        predecessor: {
          head: scenario === "ancestry" ? "e".repeat(40) : f.predecessor,
          candidate_id: null,
        },
        policy: COMPLETION_DIGEST,
        requirement_set: COMPLETION_DIGEST,
        clock: scenario === "expired"
          ? { ...COMPLETION_CLOCK, wallNow: (): number => 300 }
          : COMPLETION_CLOCK,
        execution: scenario === "environment"
          ? { ...f.execution, environment_id: completionId(999) }
          : f.execution,
      };
      if (scenario === "expired" || scenario === "ancestry") {
        await assertRejects(
          () => composeCandidate(input),
          Error,
          scenario === "expired" ? "superseded" : "ancestry",
        );
      } else {
        const result = await composeCandidate(input);
        assert("kind" in result);
        assertEquals(
          result.kind,
          scenario === "dirty" ? "missing-judgment" : "environment-unavailable",
        );
      }
      assertEquals(
        await gitOut(f.root, "rev-parse", f.execution.candidate.source.branch),
        f.execution.candidate.source.head,
      );
      assertEquals(
        await gitOut(f.slot, "rev-parse", "HEAD"),
        f.execution.candidate.source.head,
      );
    });
  }
});

Deno.test("completion baseline: candidate publication is idempotent only for its exact attempt, tree, and procedure", async () => {
  await withTempDir(async (base) => {
    const f = await compositionFixture(base, false);
    const recipe = await compositionRecipe(
      f.slot,
      await loadConfig(f.slot),
      COMPLETION_DIGEST,
      TEST_PROCESS_TIMEOUT_MS / 1000,
      {},
    );
    const candidate = await composeCandidate({
      prepare: () => Promise.resolve(),
      ...f,
      recipe,
      dependencies: [],
      predecessor: { head: f.predecessor, candidate_id: null },
      policy: COMPLETION_DIGEST,
      requirement_set: COMPLETION_DIGEST,
      clock: COMPLETION_CLOCK,
    });
    assert(!("kind" in candidate));
    const publish = (
      id = f.execution.candidate_id,
      value = candidate,
    ): Promise<void> =>
      publishCandidate(f.root, id, value, f.execution.fence, COMPLETION_CLOCK);
    await assertRejects(
      () => publish(completionId(999)),
      Error,
      "another attempt identity",
    );
    await assertRejects(
      () =>
        publish(f.execution.candidate_id, {
          ...candidate,
          attempt_id: completionId(999),
        }),
      Error,
      "another attempt",
    );
    await publish();
    await publish();
    assertEquals(
      await verifyComposition(f.root, candidate, {
        ...recipe,
        identity: { ...recipe.identity, procedure: "e".repeat(64) },
      }),
      false,
    );
    assertEquals(await verifyComposition(f.root, candidate, recipe), true);
    assertEquals(
      await gitOut(f.root, "rev-parse", candidate.source.branch),
      candidate.source.head,
    );
  });
});
