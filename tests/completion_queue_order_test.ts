import { assert, assertEquals } from "@std/assert";
import {
  approveBatch,
  dependencyBlocker,
  orderedEntries,
  reprioritize,
} from "../src/engine/landing_queue/model.ts";
import {
  invalidateDependents,
  reconcilePredecessors,
  removeEligibility,
  replaceSource,
} from "../src/engine/landing_queue/invalidation.ts";
import { workCapacity } from "../src/engine/landing_queue/claims.ts";
import { queueAuthority, queueExample } from "./completion_queue_fixture.ts";
import { completionId } from "./completion_fixtures.ts";
import { CompletionPolicySchema } from "../src/shared/config_schema.ts";

Deno.test("queue Q02/Q03: promotion stays stable across 2–5 efforts and atomic reverse-order batches", () => {
  for (const count of [2, 3, 4, 5, 120]) {
    const fixture = queueExample(count);
    const promoted = approveBatch(
      fixture.queue,
      completionId(500),
      new Map([["effort-1", queueAuthority(1)]]),
    );
    assert(promoted.kind === "changed");
    const rest = [...fixture.queue.entries].reverse().filter((entry) =>
      entry.source.effort_id !== "effort-1"
    );
    const approved = approveBatch(
      promoted.queue,
      completionId(501),
      new Map(
        rest.map((
          entry,
          i,
        ) => [entry.source.effort_id, queueAuthority(i + 10)]),
      ),
    );
    assert(approved.kind === "changed");
    assertEquals(
      orderedEntries(approved.queue).map((entry) => entry.source.effort_id),
      [
        "effort-1",
        ...fixture.queue.entries.filter((entry) =>
          entry.source.effort_id !== "effort-1"
        ).map((entry) => entry.source.effort_id),
      ],
    );
    const repeated = approveBatch(
      approved.queue,
      completionId(502),
      new Map([["effort-1", queueAuthority(1)]]),
    );
    assert(repeated.kind === "changed");
    assertEquals(repeated.queue, approved.queue);
  }
});

Deno.test("queue Q03: real source dependencies require their own approval and precede successors", () => {
  const { queue } = queueExample(3);
  const dependent = {
    ...queue,
    entries: queue.entries.map((entry, i) => ({
      ...entry,
      dependencies: i === 1 ? ["effort-0"] : [],
    })),
  };
  assertEquals(
    approveBatch(
      dependent,
      completionId(500),
      new Map([["effort-1", queueAuthority(1)]]),
    ).kind,
    "missing-authority",
  );
  const both = approveBatch(
    dependent,
    completionId(501),
    new Map([["effort-1", queueAuthority(1)], ["effort-0", queueAuthority(0)]]),
  );
  assert(both.kind === "changed");
  assertEquals(
    orderedEntries(both.queue).map((entry) => entry.source.effort_id),
    ["effort-0", "effort-1", "effort-2"],
  );
  assertEquals(
    reprioritize(both.queue, {
      id: completionId(503),
      expected: ["effort-0", "effort-1"],
      order: ["effort-1", "effort-0"],
    }).kind,
    "missing-judgment",
  );
  const cycle = {
    ...dependent,
    entries: dependent.entries.map((entry, i) =>
      i === 0 ? { ...entry, dependencies: ["effort-1"] } : entry
    ),
  };
  assertEquals(dependencyBlocker(cycle)?.kind, "missing-authority");
});

Deno.test("queue Q03: shared dependency subgraphs remain bounded and landed dependencies are settled", () => {
  const { queue } = queueExample(120);
  const linked = {
    ...queue,
    entries: queue.entries.map((entry, index) => ({
      ...entry,
      dependencies: queue.entries.slice(Math.max(0, index - 2), index).map((
        dependency,
      ) => dependency.source.effort_id),
    })),
  };
  assertEquals(dependencyBlocker(linked), undefined);
  const missing = {
    ...linked,
    entries: linked.entries.map((entry, index) =>
      index === 0 ? { ...entry, dependencies: ["absent-source"] } : entry
    ),
  };
  const blocked = dependencyBlocker(missing);
  assert(blocked?.kind === "missing-authority");
  assertEquals(blocked.sources.length, 120);
  const settled = {
    ...missing,
    entries: missing.entries.map((entry, index) =>
      index === 0 ? { ...entry, state: "landed" as const } : entry
    ),
  };
  assertEquals(dependencyBlocker(settled), undefined);
});

Deno.test("queue Q05/E06: invalidation follows dependency edges and preserves unrelated artifacts", () => {
  const { queue, candidates } = queueExample(3);
  const a = candidates.get(completionId(100));
  const b = candidates.get(completionId(101));
  assert(a !== undefined && b !== undefined);
  candidates.set(completionId(101), {
    ...b,
    expected_predecessor: { head: a.head, candidate_id: completionId(100) },
  });
  for (
    const reason of [
      "withdrawn",
      "source-replaced",
      "authority-revoked",
      "policy-changed",
      "candidate-failed",
    ] as const
  ) {
    const invalidated = invalidateDependents(
      queue,
      candidates,
      ["effort-0"],
      reason,
    );
    assertEquals(invalidated.efforts, ["effort-0", "effort-1"]);
    assertEquals(invalidated.candidate_ids, [
      completionId(100),
      completionId(101),
    ]);
    assertEquals(invalidated.queue.entries[2], queue.entries[2]);
    assertEquals(candidates.size, 3);
  }
  const removed = removeEligibility(queue, candidates, "effort-0", "withdrawn");
  assertEquals(removed.queue.entries[0]?.state, "withdrawn");
  const replacement = replaceSource(queue, candidates, {
    ...a.source,
    head: "e".repeat(40),
  }, []);
  assertEquals(replacement.queue.entries[0]?.authority_id, null);
});

Deno.test("queue Q05: actual prefix landing preserves its prediction; external movement changes the affected base", () => {
  const { queue, candidates } = queueExample(2);
  const a = candidates.get(completionId(100));
  const b = candidates.get(completionId(101));
  assert(a !== undefined && b !== undefined);
  candidates.set(completionId(101), {
    ...b,
    expected_predecessor: { head: a.head, candidate_id: completionId(100) },
  });
  const landed = {
    ...queue,
    entries: queue.entries.map((entry, index) =>
      index === 0 ? { ...entry, state: "landed" as const } : entry
    ),
  };
  assertEquals(
    reconcilePredecessors(landed, candidates, a.head, "predecessor-changed")
      .candidate_ids,
    [],
  );
  assertEquals(
    reconcilePredecessors(landed, candidates, "f".repeat(40), "external-trunk")
      .candidate_ids,
    [completionId(101)],
  );
});

Deno.test("queue Q08: lookahead and capacity are separate, with a reserved head slot", () => {
  const { queue } = queueExample(120);
  const policy = CompletionPolicySchema.parse({ concurrency: 3, lookahead: 2 });
  const entries = orderedEntries(queue);
  assertEquals(
    workCapacity(entries, "effort-3", policy)?.kind,
    "environment-unavailable",
  );
  const occupied = entries.map((entry, index) =>
    index === 1 || index === 2 ? { ...entry, state: "active" as const } : entry
  );
  assertEquals(workCapacity(occupied, "effort-0", policy), undefined);
  assertEquals(
    workCapacity(occupied, "effort-4", policy)?.kind,
    "environment-unavailable",
  );
  assertEquals(
    workCapacity(
      entries,
      "effort-1",
      CompletionPolicySchema.parse({ concurrency: 1, lookahead: 5 }),
    )?.kind,
    "environment-unavailable",
  );
});
