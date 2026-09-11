import { SYSTEM_CLOCK } from "../src/shared/clock.ts";
/** External integration has evidence and ancestry, without historical acceptance authority. */
import { assert, assertEquals } from "@std/assert";
import { z } from "@zod/zod";
import { withTempDir } from "./helpers.ts";
import { project } from "./completion_public_fixture.ts";
import { addWorktree, git, gitOut, runAgent } from "./engine_helpers.ts";
import { completionMcpPeer } from "./completion_mcp_fixture.ts";
import { AcceptOutputSchema } from "../src/shared/result_schemas.ts";
import { decodeCliResult } from "./decode_cli_result.ts";
import {
  observedRecords,
  observeQueue,
  replaceQueue,
  requireQueue,
} from "../src/engine/landing_queue/repository.ts";
import {
  readCompletionRecord,
  writeCompletionRecord,
} from "../src/engine/completion/store.ts";
import { completionFixtures } from "./completion_fixtures.ts";
import { observeExternalIntegration } from "../src/engine/landing_queue/external_integration.ts";

Deno.test("externally integrated proven source resolves a new wait and reconciles without a landing receipt or repeated producer", async () => {
  await withTempDir(async (root) => {
    const path = await project(root, ["local"]);
    const green = await runAgent(path, ["done", "--retain-checkout", "--json"]);
    assertEquals(green.code, 0, green.output);
    const head = await gitOut(path, "rev-parse", "HEAD");
    const notIntegrated = await runAgent(root, [
      "accept",
      "--reconcile",
      "--target",
      "public-done",
      "--dry-run",
      "--json",
    ]);
    assertEquals(notIntegrated.code, 1, notIntegrated.output);
    await git(root, "merge", "--ff-only", "agent/public-done");
    let before = observedRecords(await observeQueue(root, "main"));
    const observation = await observeExternalIntegration(
      root,
      await observeQueue(root, "main"),
      "refs/heads/agent/public-done",
      head,
    );
    assert(
      !("kind" in observation),
      JSON.stringify({
        observation,
        candidates: before.filter((record) =>
          record.kind === "candidate" || record.kind === "proof"
        ),
      }),
    );
    const waited = await runAgent(root, [
      "await",
      "--landed",
      "public-done",
      "--timeout",
      "0",
      "--json",
    ]);
    assertEquals(waited.code, 0, waited.output);
    const wait = decodeCliResult(waited.stdout, "await");
    assert(
      wait.data !== undefined && "met" in wait.data && wait.data.met,
      waited.output,
    );
    assertEquals(observedRecords(await observeQueue(root, "main")), before);
    await using peer = await completionMcpPeer(root);
    await peer.call(2, "discern_accept", {
      path: root,
      target: "public-done",
      reconcile: true,
      dry_run: true,
    });
    const preview = z.object({ structuredContent: AcceptOutputSchema }).parse(
      (await peer.response(2)).result,
    ).structuredContent;
    assert(
      preview.ok && preview.data !== undefined &&
        "external_integration" in preview.data,
      JSON.stringify(preview),
    );
    let expected = preview.data.external_integration?.expected_state;
    assert(expected !== undefined);
    assertEquals(observedRecords(await observeQueue(root, "main")), before);
    await git(
      path,
      "commit",
      "--allow-empty",
      "-m",
      "Move the source after review",
    );
    const moved = await runAgent(root, [
      "accept",
      "--reconcile",
      "--target",
      "public-done",
      "--expected",
      expected,
      "--json",
    ]);
    assertEquals(moved.code, 1, moved.output);
    assert(moved.output.includes("stale-evidence"), moved.output);
    assertEquals(observedRecords(await observeQueue(root, "main")), before);
    await git(path, "reset", "--hard", head);
    const queue = await requireQueue(root);
    const candidate = before.find((record) => record.kind === "candidate");
    const environment = before.find((record) => record.kind === "environment");
    assert(
      candidate?.kind === "candidate" && environment?.kind === "environment",
    );
    const fixture = completionFixtures().attempt;
    assert(fixture.kind === "attempt");
    assertEquals(
      (await writeCompletionRecord(root, {
        ...fixture,
        data: {
          ...fixture.data,
          identity: { ...fixture.data.identity, candidate_id: candidate.id },
          environment_id: environment.id,
          subjects: [],
        },
      }, null)).kind,
      "written",
    );
    assertEquals(
      (await replaceQueue(root, queue, {
        ...queue.record.data,
        entries: queue.record.data.entries.map((entry) => ({
          ...entry,
          state: "active" as const,
        })),
      })).kind,
      "written",
    );
    const claim = await readCompletionRecord(root, {
      kind: "attempt",
      id: fixture.id,
    });
    assert(
      claim.kind === "recorded" && claim.record.kind === "attempt" &&
        claim.record.data.state.kind === "claimed",
    );
    const live = {
      ...claim.record,
      revision: claim.record.revision + 1,
      data: {
        ...claim.record.data,
        state: {
          ...claim.record.data.state,
          claim: {
            ...claim.record.data.state.claim,
            expires_at: SYSTEM_CLOCK.wallNow() + 60_000,
          },
        },
      },
    };
    assertEquals(
      (await writeCompletionRecord(root, live, claim.stamp)).kind,
      "written",
    );
    const held = observedRecords(await observeQueue(root, "main"));
    const reserved = await runAgent(root, [
      "accept",
      "--reconcile",
      "--target",
      "refs/heads/agent/public-done",
      "--dry-run",
      "--json",
    ]);
    assertEquals(reserved.code, 1, reserved.output);
    assert(reserved.output.includes("waiting-for-operation"), reserved.output);
    assertEquals(observedRecords(await observeQueue(root, "main")), held);
    const liveRead = await readCompletionRecord(root, {
      kind: "attempt",
      id: fixture.id,
    });
    assert(liveRead.kind === "recorded");
    assertEquals(
      (await writeCompletionRecord(root, {
        ...claim.record,
        revision: live.revision + 1,
      }, liveRead.stamp)).kind,
      "written",
    );
    const stale = await runAgent(root, [
      "accept",
      "--reconcile",
      "--target",
      "public-done",
      "--expected",
      expected,
      "--json",
    ]);
    assertEquals(stale.code, 1, stale.output);
    const refreshed = await runAgent(root, [
      "accept",
      "--reconcile",
      "--target",
      "public-done",
      "--dry-run",
      "--json",
    ]);
    assertEquals(refreshed.code, 0, refreshed.output);
    const plan = decodeCliResult(refreshed.stdout, "accept");
    assert(plan.data !== undefined && "external_integration" in plan.data);
    expected = plan.data.external_integration?.expected_state;
    assert(expected !== undefined);
    assertEquals(plan.data.external_integration?.reservations, [fixture.id]);
    before = observedRecords(await observeQueue(root, "main"));
    const reconciled = await runAgent(root, [
      "accept",
      "--reconcile",
      "--target",
      "public-done",
      "--expected",
      expected,
      "--json",
    ]);
    assertEquals(reconciled.code, 0, reconciled.output);
    // The owner hears which effort was recorded and what did not happen,
    // in effort vocabulary.
    const recorded = decodeCliResult(reconciled.stdout, "accept").message ??
      "";
    assert(
      recorded.startsWith(
        "Recorded the outside integration of `agent/public-done`; its Proof stands, nothing landed again, and no approval was spent.",
      ),
      recorded,
    );
    const after = observedRecords(await observeQueue(root, "main"));
    assertEquals(after.filter((record) => record.kind === "landing"), []);
    const reservation = after.find((record) =>
      record.kind === "attempt" && record.id === fixture.id
    );
    assert(reservation?.kind === "attempt");
    assertEquals(reservation.data.state.kind, "finished");
    assertEquals(
      after.filter((record) => record.kind === "integration").length,
      1,
    );
    assertEquals(
      after.filter((record) =>
        record.kind === "proof" || record.kind === "evidence" ||
        record.kind === "authority"
      ),
      before.filter((record) =>
        record.kind === "proof" || record.kind === "evidence" ||
        record.kind === "authority"
      ),
    );
    assertEquals(await Deno.readTextFile(`${path}/executions`), "t");
    assertEquals(await gitOut(root, "rev-parse", "main"), head);
    const repeat = await runAgent(root, [
      "accept",
      "--reconcile",
      "--target",
      "public-done",
      "--json",
    ]);
    assertEquals(repeat.code, 0, repeat.output);
    const release = await runAgent(path, [
      "done",
      "--release-checkout",
      "--json",
    ]);
    assertEquals(release.code, 0, release.output);
    const retire = await runAgent(root, [
      "accept",
      "--reconcile",
      "--target",
      "public-done",
      "--json",
    ]);
    assertEquals(retire.code, 0, retire.output);
    const retired = decodeCliResult(retire.stdout, "accept");
    assert(
      retired.data !== undefined && "external_integration" in retired.data,
    );
    assertEquals(
      retired.data.external_integration?.retirement,
      "retired",
      retire.output,
    );
    assert(
      retired.data.external_integration?.retirement_id !== undefined,
      retire.output,
    );
    assertEquals(retired.data.storage_cleanup?.state, "settled", retire.output);
    const reclaim = await runAgent(root, [
      "accept",
      "--reclaim",
      retired.data.external_integration.retirement_id,
      "--json",
    ]);
    assertEquals(reclaim.code, 0, reclaim.output);
    const fresh = await addWorktree(root, "fresh");
    const notLanded = await runAgent(root, [
      "await",
      "--landed",
      fresh,
      "--timeout",
      "0",
      "--json",
    ]);
    const untouched = decodeCliResult(notLanded.stdout, "await");
    assert(untouched.data !== undefined && "met" in untouched.data);
    assertEquals(untouched.data.met, false, notLanded.output);
  });
});
