import { completionRecordPath } from "../src/engine/completion/store.ts";
import { SYSTEM_CLOCK, wallTimeIso } from "../src/shared/clock.ts";
/** Public acceptance uses complete immutable evidence and the recorded desk decision. */
import { assert, assertEquals } from "@std/assert";
import { withTempDir } from "./helpers.ts";
import { project } from "./completion_public_fixture.ts";
import { gitOut, runAgent } from "./engine_helpers.ts";
import { grantEffort } from "../src/engine/worktree/effort_grant_writer.ts";
import { readEffortGrant } from "../src/engine/worktree/effort_grant.ts";
import {
  observedRecords,
  observeQueue,
} from "../src/engine/landing_queue/repository.ts";
import { decodeCliResult } from "./decode_cli_result.ts";
import { operationProgressResult } from "../src/engine/completion/progress_result.ts";

Deno.test("fresh public accept checks desk source authority and never lands twice", async () => {
  await withTempDir(async (root) => {
    const path = await project(root, ["local"]);
    const initialTrunk = await gitOut(root, "rev-parse", "main");
    const emptyPreview = await runAgent(path, [
      "accept",
      "--dry-run",
      "--json",
    ]);
    assertEquals(emptyPreview.code, 0, emptyPreview.output);
    const previewResult = decodeCliResult(emptyPreview.stdout, "accept");
    assert(previewResult.data !== undefined && "pending" in previewResult.data);
    assertEquals(previewResult.data.pending?.[0]?.kind, "missing-evidence");
    assertEquals(await gitOut(root, "rev-parse", "main"), initialTrunk);
    assertEquals(observedRecords(await observeQueue(root, "main")).length, 0);
    const done = await runAgent(path, ["done", "--retain-checkout", "--json"]);
    assertEquals(done.code, 0, done.output);
    // The worktree reconnects to its own gate; the preview above left no
    // journal because a dry run is not a long operation.
    const gate = await operationProgressResult(path);
    assert(gate.ok, JSON.stringify(gate));
    assertEquals(gate.data?.operation.verb, "done");
    assertEquals(gate.data?.outcome, "completed");
    const before = await gitOut(root, "rev-parse", "main");
    const source = await gitOut(path, "rev-parse", "HEAD");
    const admitted = observedRecords(await observeQueue(root, "main"));
    const candidate = admitted.find((record) => record.kind === "candidate");
    assert(candidate?.kind === "candidate");
    const candidatePath = await completionRecordPath(root, {
      kind: "candidate",
      id: candidate.id,
    });
    assert(candidatePath);
    const candidateBytes = await Deno.readTextFile(candidatePath);
    try {
      await Deno.writeTextFile(candidatePath, "unreadable candidate");
      const blocked = await runAgent(path, ["accept", "--json"]);
      assertEquals(blocked.code, 1, blocked.output);
      const blockedResult = decodeCliResult(blocked.stdout, "accept");
      assert(
        blockedResult.data !== undefined && "pending" in blockedResult.data,
      );
      assertEquals(
        blockedResult.data.pending?.[0]?.kind,
        "record-corrupt",
      );
      assert(
        blockedResult.data.pending?.[0]?.reason.includes(
          `Completion record candidate/${candidate.id} is invalid`,
        ),
        blocked.output,
      );
      assertEquals(await gitOut(root, "rev-parse", "main"), before);
      assertEquals(
        await Deno.readTextFile(candidatePath),
        "unreadable candidate",
      );
      assertEquals(
        observedRecords(await observeQueue(root, "main")).filter((record) =>
          record.kind !== "candidate"
        ),
        admitted.filter((record) => record.kind !== "candidate"),
        "Unreadable evidence must not create authority, claim work, or mutate the queue",
      );
    } finally {
      await Deno.writeTextFile(candidatePath, candidateBytes);
    }

    const refused = await runAgent(path, ["accept", "--json"]);
    assertEquals(refused.code, 1, refused.output);
    assert(refused.output.includes("awaiting_consent"), refused.output);
    assertEquals(await gitOut(root, "rev-parse", "main"), before);
    await grantEffort(
      path,
      "agent/public-done",
      wallTimeIso(SYSTEM_CLOCK.wallNow()),
    );
    const accepted = await runAgent(root, ["accept", "--json"]);
    assertEquals(accepted.code, 0, accepted.output);
    const result = decodeCliResult(accepted.stdout, "accept");
    assert(
      result.data !== undefined && "queue" in result.data,
      accepted.output,
    );
    assertEquals(result.data.queue?.map((row) => row.state), ["landed"]);
    assertEquals(await gitOut(root, "rev-parse", "main"), source);
    assertEquals(await gitOut(root, "status", "--short"), "");
    assertEquals((await readEffortGrant(path)).status, "missing");
    assertEquals(
      await Deno.readTextFile(`${path}/executions`),
      "t",
      "fresh actor must reuse complete evidence",
    );
    const records = observedRecords(await observeQueue(root, "main"));
    const landed = records.filter((record) => record.kind === "landing");
    assertEquals(landed.length, 1);
    // The acceptance ran from the main checkout, so that checkout reconnects
    // to it; its nested validation opened no journal of its own.
    const acceptance = await operationProgressResult(root);
    assert(acceptance.ok, JSON.stringify(acceptance));
    assertEquals(acceptance.data?.operation.verb, "accept");
    assertEquals(acceptance.data?.outcome, "completed");
    assertEquals(acceptance.data?.executor, "gone");
    const retried = await runAgent(path, ["accept", "--json"]);
    assertEquals(retried.code, 0, retried.output);
    assertEquals(
      observedRecords(await observeQueue(root, "main")).filter((record) =>
        record.kind === "authority" || record.kind === "landing"
      ),
      records.filter((record) =>
        record.kind === "authority" || record.kind === "landing"
      ),
    );
  });
});
