/** Counts scale with the selected prefix, without Git repositories or timed waits. */
import { assert, assertEquals, assertRejects } from "@std/assert";
import { discoverSourceDependencies } from "../src/engine/landing_queue/composition.ts";
import { assessLandingPrefix } from "../src/engine/landing_queue/public_assessment.ts";
import { CompletionRecordSchema } from "../src/engine/completion/records.ts";
import { queueExample } from "./completion_queue_fixture.ts";
import { observation } from "./completion_producers_fixtures.ts";
import { completionFixtures } from "./completion_fixtures.ts";
import { REPOSITORY_QUEUE_ID } from "../src/engine/landing_queue/repository.ts";
import { ON_DISK_FORMATS } from "../src/shared/on_disk_formats.ts";

Deno.test("acceptance assessment visits the selected prefix as unrelated queue history grows", async () => {
  for (const size of [2, 8, 32]) {
    const { queue, candidates } = queueExample(size);
    const fixture = completionFixtures().candidate;
    const records = [
      CompletionRecordSchema.parse({
        version: ON_DISK_FORMATS.completionRecord.version,
        kind: "queue",
        id: REPOSITORY_QUEUE_ID,
        revision: 1,
        data: queue,
      }),
      ...[...candidates].map(([id, data]) =>
        CompletionRecordSchema.parse({ ...fixture, id, data })
      ),
    ];
    for (
      const [effort, expected] of [
        ["effort-0", 1],
        ["effort-1", 2],
        ["absent", 0],
      ] as const
    ) {
      let reads = 0;
      const result = await assessLandingPrefix(
        observation(records),
        effort,
        (candidate) => {
          reads++;
          return Promise.resolve({
            assessment: {
              candidate_id: candidate.id,
              candidate: candidate.data,
              blockers: [],
              proof: null,
              authority_id: null,
              decisions: { judgments: [], variances: [], proposals: [] },
              refresh: null,
            },
            preview_actions: [],
            approval_requests: [],
            scopes_changed: [],
            authority_details: [],
            checkpoint_drops: [],
          });
        },
      );
      assertEquals(reads, expected);
      assertEquals(
        [...result.keys()],
        queue.entries.slice(0, expected).map((entry) => entry.candidate_id),
      );
    }
    for (const state of ["held", "withdrawn", "landed"] as const) {
      const changed = records.map((record) =>
        record.kind !== "queue" ? record : {
          ...record,
          data: {
            ...record.data,
            entries: record.data.entries.map((entry, index) =>
              index !== 0 ? entry : {
                ...entry,
                ...(state === "held" ? { held: true } : { state }),
              }
            ),
          },
        }
      );
      let assessed = false;
      assertEquals(
        (await assessLandingPrefix(observation(changed), "effort-0", () => {
          assessed = true;
          throw new Error(
            "Inactive target must not invoke expensive assessment",
          );
        })).size,
        0,
      );
      assertEquals(assessed, false);
    }
  }
});

Deno.test("source dependency queries scale with distinct immutable pairs, preserving all dependencies", async () => {
  const { queue } = queueExample(4);
  const [selected, ...others] = queue.entries;
  assert(selected !== undefined);
  const source = selected.source;
  const sources = others.map((entry) => entry.source);
  for (const copies of [1, 8, 32]) {
    const calls = new Map<string, number>();
    const dependencies = await discoverSourceDependencies(
      "unused",
      source,
      queue.trunk,
      Array.from({ length: copies }, () => [source, ...sources]).flat(),
      (ancestor, descendant) => {
        const key = `${ancestor}:${descendant}`;
        calls.set(key, (calls.get(key) ?? 0) + 1);
        return Promise.resolve(descendant === source.head);
      },
    );
    assertEquals(dependencies, sources);
    assertEquals(calls.size, sources.length * 2);
    assertEquals(
      [...calls.values()],
      Array.from({ length: calls.size }, () => 1),
    );
  }
  await assertRejects(
    () =>
      discoverSourceDependencies(
        "unused",
        source,
        queue.trunk,
        sources,
        () => Promise.reject(new Error("ancestry unavailable")),
      ),
    Error,
    "ancestry unavailable",
  );
  await assertRejects(() =>
    discoverSourceDependencies(
      "unused",
      source,
      "main",
      sources,
      () => Promise.resolve(false),
    )
  );
});
