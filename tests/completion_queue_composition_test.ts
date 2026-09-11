import { GITATTRIBUTES_REL } from "../src/lib/agent_gitattributes.ts";
import { planRefresh } from "../src/engine/tracked_refresh.ts";
import { readTextIfExists } from "../src/shared/fs_presence.ts";
import { assert, assertEquals, assertRejects } from "@std/assert";
import { join } from "@std/path";
import { withTempDir } from "./helpers.ts";
import { git, gitOut } from "./engine_helpers.ts";
import { COMPLETION_CLOCK, COMPLETION_DIGEST } from "./completion_fixtures.ts";
import { AGENT_NAMES, loadConfig } from "../src/shared/config_schema.ts";
import {
  composeCandidate,
  discoverSourceDependencies,
  observeSource,
  publishCandidate,
  retainMeasurementCandidate,
  verifyComposition,
} from "../src/engine/landing_queue/composition.ts";
import { compositionRecipe } from "../src/engine/landing_queue/generation.ts";
import { candidateRef } from "../src/engine/completion/identity.ts";
import { TEST_PROCESS_TIMEOUT_MS } from "./waiting.ts";
import { compositionFixture } from "./completion_queue_git_fixture.ts";

Deno.test("queue A03: real Git composition and generation remain separate, with immutable refs and source identity", async () => {
  await withTempDir(async (base) => {
    const fixture = await compositionFixture(base, false);
    const recipe = await compositionRecipe(
      fixture.slot,
      await loadConfig(fixture.slot),
      COMPLETION_DIGEST,
      TEST_PROCESS_TIMEOUT_MS / 1000,
      {},
    );
    const candidate = await composeCandidate({
      prepare: async () => {
        assertEquals(await Deno.readTextFile(join(fixture.slot, "a")), "A\n");
        assertEquals(await Deno.readTextFile(join(fixture.slot, "b")), "B\n");
        assertEquals(
          await gitOut(fixture.slot, "log", "-1", "--format=%P").then((
            parents,
          ) => parents.split(" ").length),
          2,
        );
      },
      ...fixture,
      recipe,
      dependencies: [],
      predecessor: { head: fixture.predecessor, candidate_id: null },
      policy: COMPLETION_DIGEST,
      requirement_set: COMPLETION_DIGEST,
      clock: COMPLETION_CLOCK,
    });
    assert(!("kind" in candidate), JSON.stringify(candidate));
    assert(
      candidate.composition.merge_commit !== null &&
        candidate.composition.regeneration_commit !== null,
    );
    assert(
      candidate.composition.merge_commit !==
        candidate.composition.regeneration_commit,
    );
    assertEquals(
      await Deno.readTextFile(join(fixture.slot, "generated.txt")),
      "A\nB\n",
    );
    assertEquals(
      await gitOut(fixture.root, "rev-parse", candidate.source.branch),
      candidate.source.head,
    );
    assert(await verifyComposition(fixture.root, candidate, recipe));
    await publishCandidate(
      fixture.root,
      fixture.execution.candidate_id,
      candidate,
      fixture.execution.fence,
      COMPLETION_CLOCK,
    );
    assertEquals(
      await gitOut(
        fixture.root,
        "rev-parse",
        candidateRef(fixture.execution.candidate_id, candidate.attempt_id),
      ),
      candidate.head,
    );
    await Deno.writeTextFile(join(fixture.slot, "a"), "unapproved\n");
    await git(fixture.slot, "add", "a");
    await git(fixture.slot, "commit", "-m", "Unapproved conflict edit");
    const altered = {
      ...candidate,
      head: await gitOut(fixture.slot, "rev-parse", "HEAD"),
      tree: await gitOut(fixture.slot, "rev-parse", "HEAD^{tree}"),
    };
    assertEquals(await verifyComposition(fixture.root, altered, recipe), false);
    await assertRejects(
      () =>
        publishCandidate(
          fixture.root,
          fixture.execution.candidate_id,
          altered,
          fixture.execution.fence,
          COMPLETION_CLOCK,
        ),
      Error,
      "receipt",
    );
    assertEquals(
      await discoverSourceDependencies(
        fixture.root,
        candidate.source,
        fixture.predecessor,
        [candidate.source],
      ),
      [],
    );
  });
});

Deno.test("queue A02: substantive merge conflicts return judgment and preserve the source", async () => {
  await withTempDir(async (base) => {
    const fixture = await compositionFixture(base, true);
    const recipe = await compositionRecipe(
      fixture.slot,
      await loadConfig(fixture.slot),
      COMPLETION_DIGEST,
      TEST_PROCESS_TIMEOUT_MS / 1000,
      {},
    );
    const candidate = await composeCandidate({
      prepare: () => Promise.resolve(),
      ...fixture,
      recipe,
      dependencies: [],
      predecessor: { head: fixture.predecessor, candidate_id: null },
      policy: COMPLETION_DIGEST,
      requirement_set: COMPLETION_DIGEST,
      clock: COMPLETION_CLOCK,
    });
    assert("kind" in candidate && candidate.kind === "missing-judgment");
    assert(
      candidate.subjects.includes("conflict:a"),
      candidate.subjects.join(),
    );
    assertEquals(
      await gitOut(fixture.slot, "rev-parse", "HEAD"),
      fixture.execution.candidate.source.head,
    );
    assertEquals(await gitOut(fixture.slot, "status", "--porcelain"), "");
  });
});

Deno.test("queue A01/Q03: source dependencies retain the included revision after another source advances", async () => {
  await withTempDir(async (base) => {
    const fixture = await compositionFixture(base, true);
    const included = fixture.execution.candidate.source;
    await git(fixture.root, "branch", "agent/dependent", included.head);
    const dependent = await observeSource(
      fixture.root,
      "dependent",
      "refs/heads/agent/dependent",
    );
    const author = join(base, "author");
    await Deno.writeTextFile(join(author, "later"), "later source revision\n");
    await git(author, "add", "later");
    await git(author, "commit", "-m", "Replace source revision");
    const replaced = await observeSource(
      fixture.root,
      included.effort_id,
      included.branch,
    );
    assertEquals(
      await discoverSourceDependencies(
        fixture.root,
        dependent,
        fixture.predecessor,
        [replaced, included],
      ),
      [included],
    );
    const next = { ...dependent, head: replaced.head, tree: replaced.tree };
    assertEquals(
      await discoverSourceDependencies(
        fixture.root,
        next,
        fixture.predecessor,
        [included, replaced],
      ),
      [replaced],
    );
    assertEquals(
      await discoverSourceDependencies(fixture.root, next, replaced.head, [
        included,
        replaced,
      ]),
      [],
    );
  });
});

Deno.test("standalone measurement retention cannot publish queue composition without its receipt", async () => {
  await withTempDir(async (base) => {
    const fixture = await compositionFixture(base, false);
    const recipe = await compositionRecipe(
      fixture.slot,
      await loadConfig(fixture.slot),
      COMPLETION_DIGEST,
      TEST_PROCESS_TIMEOUT_MS / 1000,
      {},
    );
    const candidate = {
      ...fixture.execution.candidate,
      dependencies: [],
      expected_predecessor: { head: fixture.predecessor, candidate_id: null },
      composition: {
        ...recipe.identity,
        merge_commit: null,
        regeneration_commit: null,
      },
    };
    await retainMeasurementCandidate(
      fixture.slot,
      fixture.execution.candidate_id,
      candidate,
      fixture.execution.fence,
      COMPLETION_CLOCK,
    );
    await assertRejects(
      () =>
        publishCandidate(
          fixture.slot,
          fixture.execution.candidate_id,
          candidate,
          fixture.execution.fence,
          COMPLETION_CLOCK,
        ),
      Error,
      "composition receipt",
    );
    assertEquals(
      await gitOut(fixture.slot, "rev-parse", "HEAD"),
      candidate.source.head,
    );
  });
});

Deno.test("composition regenerates owned instructions for every provider while preserving co-managed artifacts", async () => {
  await withTempDir(async (base) => {
    const fixture = await compositionFixture(
      base,
      false,
      AGENT_NAMES,
      async (root) => {
        // A missing co-managed artifact is authored state, outside owned regeneration.
        await Deno.remove(join(root, GITATTRIBUTES_REL));
      },
    );
    const recipe = await compositionRecipe(
      fixture.slot,
      await loadConfig(fixture.slot),
      COMPLETION_DIGEST,
      TEST_PROCESS_TIMEOUT_MS / 1000,
      {},
    );
    const refresh = await planRefresh(fixture.slot, {
      reconcileProofNotesFetch: false,
    });
    const shared = refresh.effects.filter((effect) =>
      effect.type === "file" && !recipe.built_in_paths.includes(effect.target)
    );
    assert(
      shared.length > 0,
      "the provider registry must exercise co-managed refresh effects",
    );
    const before = await Promise.all(
      shared.map((effect) =>
        readTextIfExists(join(fixture.slot, effect.target))
      ),
    );
    const candidate = await composeCandidate({
      ...fixture,
      prepare: () => Promise.resolve(),
      recipe,
      dependencies: [],
      predecessor: { head: fixture.predecessor, candidate_id: null },
      policy: COMPLETION_DIGEST,
      requirement_set: COMPLETION_DIGEST,
      clock: COMPLETION_CLOCK,
    });
    assert(!("kind" in candidate), JSON.stringify(candidate));
    assert(await verifyComposition(fixture.root, candidate, recipe));
    assertEquals(
      await Promise.all(
        shared.map((effect) =>
          readTextIfExists(join(fixture.slot, effect.target))
        ),
      ),
      before,
    );
  });
});
