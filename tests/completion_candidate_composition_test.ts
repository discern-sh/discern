/**
 * The candidate's composition-input contract: the sources list is the one
 * writable authority, an ordinary candidate stays its single source tip, an
 * integrated candidate records its procedure explicitly, and a stored
 * singular-source candidate still reads through the store's in-memory
 * migration without a version bump or byte rewrite.
 */

import { assert, assertEquals, assertStringIncludes } from "@std/assert";
import { dirname } from "@std/path";
import {
  candidateAuthor,
  candidateIsIntegrated,
  CandidateSchema,
  migrateProofEmbeddedCandidate,
  migrateSingularSourceCandidate,
} from "../src/engine/completion/candidate.ts";
import {
  completionRecordPath,
  readCompletionRecord,
} from "../src/engine/completion/store.ts";
import { ON_DISK_FORMATS } from "../src/shared/on_disk_formats.ts";
import { withTempDir } from "./helpers.ts";
import { gitInit, scaffoldEngine } from "./engine_helpers.ts";
import {
  COMPLETION_SOURCE,
  completionFixtures,
  completionId,
} from "./completion_fixtures.ts";

const DIGEST = "a".repeat(64);
const TRUNK_COMMIT = "1".repeat(40);
const MERGED_COMMIT = "2".repeat(40);
const MERGED_TREE = "3".repeat(40);

/** One valid source-tip candidate payload the cases below start from. */
function ordinaryCandidate(): Record<string, unknown> {
  return {
    attempt_id: completionId(2),
    sources: [COMPLETION_SOURCE],
    predecessor: TRUNK_COMMIT,
    head: COMPLETION_SOURCE.head,
    tree: COMPLETION_SOURCE.tree,
    policy: DIGEST,
    requirement_set: DIGEST,
  };
}

Deno.test("an ordinary candidate is its single source tip", () => {
  const parsed = CandidateSchema.parse(ordinaryCandidate());
  assertEquals(candidateAuthor(parsed), COMPLETION_SOURCE);
  assertEquals(candidateIsIntegrated(parsed), false);

  const detached = CandidateSchema.safeParse({
    ...ordinaryCandidate(),
    head: MERGED_COMMIT,
  });
  assert(!detached.success, "an unmarked candidate may not leave its tip");
  assertStringIncludes(
    JSON.stringify(detached.error.issues),
    "single source tip",
  );
});

Deno.test("an integrated candidate records its procedure and tested result separately", () => {
  const parsed = CandidateSchema.parse({
    ...ordinaryCandidate(),
    head: MERGED_COMMIT,
    tree: MERGED_TREE,
    integration: { procedure: "merge-trunk" },
  });
  assertEquals(candidateIsIntegrated(parsed), true);
  assertEquals(candidateAuthor(parsed).head, COMPLETION_SOURCE.head);
  assertEquals(parsed.head, MERGED_COMMIT);

  const empty = CandidateSchema.safeParse({
    ...ordinaryCandidate(),
    sources: [],
    integration: { procedure: "merge-trunk" },
  });
  assert(!empty.success, "the composition input list is nonempty");
});

Deno.test("the singular-source migration touches only candidate payloads", () => {
  const stored = {
    version: ON_DISK_FORMATS.completionRecord.version,
    kind: "candidate",
    id: completionId(1),
    revision: 1,
    data: { ...ordinaryCandidate(), sources: undefined },
  };
  const data = stored.data as Record<string, unknown>;
  delete data.sources;
  data.source = COMPLETION_SOURCE;
  const migrated = migrateSingularSourceCandidate(stored) as {
    data: Record<string, unknown>;
  };
  assertEquals(migrated.data.sources, [COMPLETION_SOURCE]);
  assert(!("source" in migrated.data));

  const attempt = completionFixtures().attempt;
  assertEquals(migrateSingularSourceCandidate(attempt), attempt);
  assertEquals(migrateSingularSourceCandidate("text"), "text");
});

Deno.test("a retained Proof presentation's embedded singular candidate migrates in place", () => {
  const candidate = ordinaryCandidate() as Record<string, unknown>;
  delete candidate.sources;
  candidate.source = COMPLETION_SOURCE;
  const proof = {
    head: "abcdef123456",
    branch: "amber",
    completion: { candidate, validation: { mode: "strict" } },
    line: "> **Proof:** …",
  };
  const migrated = migrateProofEmbeddedCandidate(proof) as {
    completion: { candidate: Record<string, unknown> };
    line: string;
  };
  assertEquals(migrated.completion.candidate.sources, [COMPLETION_SOURCE]);
  assert(!("source" in migrated.completion.candidate));
  assertEquals(migrated.line, proof.line);

  // Both embeddings of the same old bytes migrate identically, so the
  // presentation's byte-for-byte comparison against its complete evidence
  // still holds after both sides migrate.
  const storeRecord = migrateSingularSourceCandidate({
    version: ON_DISK_FORMATS.completionRecord.version,
    kind: "candidate",
    id: completionId(1),
    revision: 1,
    data: structuredClone(candidate),
  }) as { data: Record<string, unknown> };
  assertEquals(
    JSON.stringify(migrated.completion.candidate),
    JSON.stringify(storeRecord.data),
  );

  // Anything that is not the exact embedding passes through untouched.
  const current = { completion: { candidate: ordinaryCandidate() } };
  assertEquals(migrateProofEmbeddedCandidate(current), current);
  assertEquals(migrateProofEmbeddedCandidate({ line: "x" }), { line: "x" });
  assertEquals(migrateProofEmbeddedCandidate(null), null);
});

Deno.test("the store reads a stored singular-source candidate as the current list shape", async () => {
  await withTempDir(async (dir) => {
    await scaffoldEngine(dir);
    await gitInit(dir);
    const selector = { kind: "candidate" as const, id: completionId(1) };
    const path = await completionRecordPath(dir, selector);
    assert(path !== undefined);
    const stored = {
      version: ON_DISK_FORMATS.completionRecord.version,
      kind: "candidate",
      id: selector.id,
      revision: 1,
      data: {
        attempt_id: completionId(2),
        source: COMPLETION_SOURCE,
        predecessor: TRUNK_COMMIT,
        head: COMPLETION_SOURCE.head,
        tree: COMPLETION_SOURCE.tree,
        policy: DIGEST,
        requirement_set: DIGEST,
      },
    };
    await Deno.mkdir(dirname(path), { recursive: true });
    await Deno.writeTextFile(path, `${JSON.stringify(stored)}\n`);
    const reading = await readCompletionRecord(dir, selector);
    assert(reading.kind === "recorded", JSON.stringify(reading));
    assert(reading.record.kind === "candidate");
    assertEquals(reading.record.data.sources, [COMPLETION_SOURCE]);
    // The migration is in-memory only: the stored bytes keep their shape.
    assertStringIncludes(await Deno.readTextFile(path), '"source"');
  });
});
