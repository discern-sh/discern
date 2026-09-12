/**
 * The integration-landing record: intent precedes effects, the stored snapshot
 * and owner survive re-reading, dead and live owners are distinguished, and
 * branch ownership for the integration copy comes from the record — never
 * from parsing a branch name.
 */

import { assert, assertEquals, assertStringIncludes } from "@std/assert";
import {
  type IntegrationLandingRecord,
  integrationOwnerLiveness,
  integrationRecordForPath,
  listIntegrationLandingRecords,
  parseIntegrationLandingRecord,
  removeIntegrationLandingRecord,
  writeIntegrationLandingRecord,
} from "../src/engine/worktree/integration_record.ts";
import { classifyAutomaticBranchOwnership } from "../src/engine/worktree/ownership.ts";
import { ON_DISK_FORMATS } from "../src/shared/on_disk_formats.ts";
import { withTempDir } from "./helpers.ts";
import { gitInit, scaffoldEngine } from "./engine_helpers.ts";
import { completionId } from "./completion_fixtures.ts";

/** One valid record whose owner is this test process (live by construction). */
function record(worktreeId: string, pid = Deno.pid): IntegrationLandingRecord {
  return {
    version: ON_DISK_FORMATS.integrationLanding.version,
    id: completionId(1),
    phase: "intent",
    created_at: "2026-09-12T00:00:00.000Z",
    operation: { pid },
    landing: {
      effort_id: "amber-cove-1a2b3c",
      branch: "agent/amber-cove-1a2b3c",
      worktree_path: "/tmp/fleet/amber-cove-1a2b3c",
      submission_id: completionId(2),
      head: "1".repeat(40),
      tree: "2".repeat(40),
      proof: { candidate_id: completionId(3), proof_id: completionId(4) },
      trunk: "main",
      expected_trunk: "3".repeat(40),
    },
    worktree: {
      id: worktreeId,
      branch: `integration/${worktreeId}`,
      path: `/tmp/fleet/${worktreeId}`,
    },
  };
}

Deno.test("integration records round-trip through the common store", async () => {
  await withTempDir(async (dir) => {
    await scaffoldEngine(dir);
    await gitInit(dir);
    const stored = record("amber-cove-1a2b3c-9f");
    await writeIntegrationLandingRecord(dir, stored);
    const entries = await listIntegrationLandingRecords(dir);
    assertEquals(entries.length, 1);
    assert(entries[0]?.reading.status === "recorded");
    assertEquals(entries[0].reading.record, stored);
    assertEquals(
      integrationRecordForPath(entries, stored.worktree.path)?.id,
      stored.id,
    );
    assertEquals(integrationRecordForPath(entries, "/tmp/other"), undefined);

    await writeIntegrationLandingRecord(dir, { ...stored, phase: "ready" });
    const advanced = await listIntegrationLandingRecords(dir);
    assert(advanced[0]?.reading.status === "recorded");
    assertEquals(advanced[0].reading.record.phase, "ready");

    await removeIntegrationLandingRecord(dir, stored.worktree.id);
    assertEquals(await listIntegrationLandingRecords(dir), []);
    // Removal settles: repeating it is a no-op, never an error.
    await removeIntegrationLandingRecord(dir, stored.worktree.id);
  });
});

Deno.test("a newer or malformed integration record fails closed with its reason", () => {
  const newer = parseIntegrationLandingRecord(
    JSON.stringify({ ...record("a-1"), version: 99 }),
  );
  assert(newer.status === "newer");
  assertStringIncludes(newer.reason, "newer discern");

  const malformed = parseIntegrationLandingRecord("{}");
  assert(malformed.status === "invalid");
  assertStringIncludes(malformed.reason, "integration-landing record");

  assertEquals(parseIntegrationLandingRecord("not json").status, "invalid");
});

Deno.test("the record's owner probe distinguishes a live process from a dead one", () => {
  assertEquals(integrationOwnerLiveness(record("a-1")), "running");
  // A pid beyond the platform's allocation range provably names no process.
  assertEquals(
    integrationOwnerLiveness(record("a-1", 2 ** 22 - 7)),
    "gone",
  );
});

Deno.test("integration branch ownership comes from the recorded copy, not the name", () => {
  const owned = classifyAutomaticBranchOwnership({
    kind: "integration",
    branch: "integration/amber-cove-1a2b3c-9f",
    recordedBranch: "integration/amber-cove-1a2b3c-9f",
  });
  assert(owned.owned);
  const mismatched = classifyAutomaticBranchOwnership({
    kind: "integration",
    branch: "integration/other",
    recordedBranch: "integration/amber-cove-1a2b3c-9f",
  });
  assert(!mismatched.owned);
  assertStringIncludes(mismatched.reason, "integration/amber-cove-1a2b3c-9f");
});
