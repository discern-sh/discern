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
import { git, gitInit, gitOut, scaffoldEngine } from "./engine_helpers.ts";
import { withOperationJournal } from "../src/engine/completion/operation_journal.ts";
import { removeIntegrationWorktree } from "../src/engine/worktree/lifecycle.ts";
import { Logger } from "../src/lib/log.ts";
import { join } from "@std/path";
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

Deno.test("the record's owner probe distinguishes a live process from a dead one", async () => {
  await withTempDir(async (dir) => {
    await scaffoldEngine(dir);
    await gitInit(dir);
    const root = await Deno.realPath(dir);
    assertEquals(
      await integrationOwnerLiveness(root, record("a-1")),
      "running",
    );
    // A pid beyond the platform's allocation range provably names no process.
    assertEquals(
      await integrationOwnerLiveness(root, record("a-1", 2 ** 22 - 7)),
      "gone",
    );
  });
});

Deno.test("a finished operation releases the copy even while its host process lives", async () => {
  await withTempDir(async (dir) => {
    await scaffoldEngine(dir);
    await gitInit(dir);
    const root = await Deno.realPath(dir);
    let recorded: IntegrationLandingRecord | undefined;
    await withOperationJournal(root, {
      verb: "accept",
      path: root,
    }, async (handle) => {
      assert(handle !== undefined, "the journal store must open");
      recorded = {
        ...record("a-1"),
        operation: { pid: Deno.pid, operation_handle: handle },
      };
      // While the operation runs, the record's owner is live.
      assertEquals(await integrationOwnerLiveness(root, recorded), "running");
    }, { result: () => ({ ok: true, verb: "accept" }) });
    assert(recorded !== undefined);
    // The operation finished; this very process still exists — the way a
    // persistent server outlives every landing it ran — and the copy is
    // released for prune.
    assertEquals(await integrationOwnerLiveness(root, recorded), "gone");
  });
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
Deno.test("the record outlives the branch: a refused deletion keeps the recovery record", async () => {
  await withTempDir(async (dir) => {
    await scaffoldEngine(dir);
    await gitInit(dir);
    const root = await Deno.realPath(dir);
    const branch = "integration/locked-1a2b3c";
    await git(dir, "branch", branch);
    const entry: IntegrationLandingRecord = {
      ...record("integration-locked-1a2b3c"),
      phase: "ready",
      worktree: {
        id: "integration-locked-1a2b3c",
        branch,
        path: join(root, "..", "integration-locked-1a2b3c"),
      },
    };
    await writeIntegrationLandingRecord(root, entry);
    const log = new Logger({ json: true, noColor: true });

    // A stale ref lock makes the owned deletion refuse; the record must
    // survive as prune's only ownership evidence for the branch.
    const lock = join(root, ".git", "refs", "heads", `${branch}.lock`);
    await Deno.writeTextFile(lock, "stale test lock\n");
    const failures = await removeIntegrationWorktree(root, entry, log);
    assertEquals(failures.length, 1, failures.join("; "));
    assertStringIncludes(failures[0] ?? "", "could not be deleted");
    assertEquals((await listIntegrationLandingRecords(root)).length, 1);
    assert((await gitOut(dir, "branch", "--list", branch)) !== "");

    // Clearing the cause lets the same route finish: branch and record go
    // together, in that order.
    await Deno.remove(lock);
    assertEquals(await removeIntegrationWorktree(root, entry, log), []);
    assertEquals(await listIntegrationLandingRecords(root), []);
    assertEquals(await gitOut(dir, "branch", "--list", branch), "");
  });
});
Deno.test("removal recovers a copy whose .git marker an interrupted deletion stripped", async () => {
  await withTempDir(async (dir) => {
    await scaffoldEngine(dir);
    await gitInit(dir);
    const root = await Deno.realPath(dir);
    const branch = "integration/partial-1a2b3c";
    const path = join(root, "..", "integration-partial-1a2b3c");
    await git(dir, "worktree", "add", "-b", branch, path);
    const entry: IntegrationLandingRecord = {
      ...record("integration-partial-1a2b3c", 2 ** 22 - 7),
      phase: "ready",
      worktree: { id: "integration-partial-1a2b3c", branch, path },
    };
    await writeIntegrationLandingRecord(root, entry);

    // An interrupted recursive deletion strips the marker first; the
    // directory and Git's registration survive it.
    await Deno.remove(join(path, ".git"));
    const failures = await removeIntegrationWorktree(
      root,
      entry,
      new Logger({ json: true, noColor: true }),
    );
    assertEquals(failures, []);
    assertEquals(await listIntegrationLandingRecords(root), []);
    assertEquals(await gitOut(dir, "branch", "--list", branch), "");
    assert(
      !(await gitOut(dir, "worktree", "list", "--porcelain")).includes(
        "integration-partial-1a2b3c",
      ),
      "the stale registration must be retired",
    );
    let present = true;
    try {
      await Deno.stat(path);
    } catch {
      present = false;
    }
    assertEquals(present, false, "the partial directory must be removed");
  });
});
