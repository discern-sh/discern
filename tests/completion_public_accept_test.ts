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
    const before = await gitOut(root, "rev-parse", "main");
    const source = await gitOut(path, "rev-parse", "HEAD");
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
