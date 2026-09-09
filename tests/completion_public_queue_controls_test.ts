/** Owner decisions operate on one reviewed queue snapshot through CLI and MCP. */
import { assert, assertEquals } from "@std/assert";
import { z } from "@zod/zod";
import { withTempDir } from "./helpers.ts";
import { project } from "./completion_public_fixture.ts";
import { addWorktree, git, gitOut, runAgent } from "./engine_helpers.ts";
import { completionMcpPeer } from "./completion_mcp_fixture.ts";
import { AcceptOutputSchema } from "../src/shared/result_schemas.ts";
import { decodeCliResult } from "./decode_cli_result.ts";
import { grantEffort } from "../src/engine/worktree/effort_grant_writer.ts";
import { SYSTEM_CLOCK, wallTimeIso } from "../src/shared/clock.ts";
import { synchronizeQueueAuthorities } from "../src/engine/landing_queue/public_authority.ts";
import { inspectLandingAuthority } from "../src/engine/worktree/landing_authority.ts";
import {
  observedRecords,
  observeQueue,
} from "../src/engine/landing_queue/repository.ts";

Deno.test("public queue controls preserve proof, reject changed plans, and let independent work pass a hold", async () => {
  await withTempDir(async (root) => {
    const path = await project(root, ["local"]);
    for (const action of [["hold"], ["--reconcile"]]) {
      const absent = await runAgent(root, [
        "accept",
        ...action,
        "--target",
        "public-done",
        "--dry-run",
        "--json",
      ]);
      assertEquals(absent.code, 1, absent.output);
      assert(!absent.output.includes("internal_error"), absent.output);
    }
    const earlier = await addWorktree(root, "earlier");
    await Deno.writeTextFile(`${earlier}/other`, "independent\n");
    await git(earlier, "add", "other");
    await git(earlier, "commit", "-m", "Author earlier work");
    for (
      const [cwd, branch] of [[earlier, "agent/earlier"], [
        path,
        "agent/public-done",
      ]]
    ) {
      assert(cwd !== undefined && branch !== undefined);
      const done = await runAgent(cwd, ["done", "--retain-checkout", "--json"]);
      assertEquals(done.code, 0, done.output);
      await grantEffort(cwd, branch, wallTimeIso(SYSTEM_CLOCK.wallNow()));
    }
    await synchronizeQueueAuthorities(root, "main");
    const evidence = observedRecords(await observeQueue(root, "main")).filter((
      record,
    ) => record.kind === "proof" || record.kind === "evidence");
    await using peer = await completionMcpPeer(root);
    let id = 10;
    const call = async (
      args: Record<string, unknown>,
    ): Promise<z.infer<typeof AcceptOutputSchema>> => {
      await peer.call(++id, "discern_accept", { path: root, ...args });
      return z.object({ structuredContent: AcceptOutputSchema }).parse(
        (await peer.response(id)).result,
      ).structuredContent;
    };
    for (
      const args of [
        { action: "hold", target: "main", dry_run: true },
        {
          action: "hold",
          target: "earlier",
          order: ["earlier"],
          dry_run: true,
        },
        { action: "reprioritize", order: ["main"], dry_run: true },
        { action: "reprioritize", order: ["earlier"], dry_run: true },
        { action: "hold", target: "earlier", reconcile: true },
        { action: "hold", target: "earlier", reclaim: "irrelevant" },
        { reconcile: true, dry_run: true },
        { reconcile: true, target: "main", dry_run: true },
      ]
    ) {
      const before = observedRecords(await observeQueue(root, "main"));
      const refused = await call(args);
      assertEquals(refused.ok, false, JSON.stringify(refused));
      assert(refused.error !== "internal_error", JSON.stringify(refused));
      assertEquals(observedRecords(await observeQueue(root, "main")), before);
    }
    const apply = async (
      action: string,
      args: Record<string, unknown> = {},
    ): Promise<void> => {
      const before = observedRecords(await observeQueue(root, "main"));
      const preview = await call({
        action,
        target: "earlier",
        ...args,
        dry_run: true,
      });
      assert(
        preview.ok && preview.data !== undefined &&
          "queue_control" in preview.data,
        JSON.stringify(preview),
      );
      const expected = preview.data.queue_control?.expected_state;
      assert(expected !== undefined);
      assertEquals(observedRecords(await observeQueue(root, "main")), before);
      const refused = await call({
        action,
        target: "earlier",
        ...args,
        expected,
        confirmed: true,
      });
      assert(refused.ok, JSON.stringify(refused));
      const after = observedRecords(await observeQueue(root, "main"));
      const repeat = await call({
        action,
        target: "earlier",
        ...args,
        expected,
        confirmed: true,
      });
      assert(repeat.ok, JSON.stringify(repeat));
      assertEquals(observedRecords(await observeQueue(root, "main")), after);
    };
    const noConsent = await runAgent(root, [
      "accept",
      "hold",
      "--target",
      "earlier",
      "--json",
    ]);
    assertEquals(
      decodeCliResult(noConsent.stdout, "accept").error,
      "awaiting_consent",
      noConsent.output,
    );
    const stale = await call({
      action: "hold",
      target: "earlier",
      confirmed: true,
      expected: "changed",
    });
    assertEquals(stale.error, "precondition_failed");
    await apply("reprioritize", { order: ["public-done", "earlier"] });
    await apply("reprioritize", { order: ["earlier", "public-done"] });
    await apply("hold");
    const accepted = await runAgent(root, [
      "accept",
      "--target",
      "public-done",
      "--json",
    ]);
    assertEquals(accepted.code, 0, accepted.output);
    assertEquals(
      await gitOut(root, "rev-parse", "main"),
      await gitOut(path, "rev-parse", "HEAD"),
    );
    const governed = await call({
      target: "public-done",
      reconcile: true,
      dry_run: true,
    });
    assertEquals(governed.ok, false, JSON.stringify(governed));
    assert(
      governed.message?.includes("governed transition"),
      JSON.stringify(governed),
    );
    const landedHold = await call({
      target: "public-done",
      action: "hold",
      dry_run: true,
    });
    assertEquals(landedHold.error, "no_target", JSON.stringify(landedHold));
    await apply("revoke");
    assertEquals(
      (await inspectLandingAuthority(earlier, "main")).effortGrant,
      undefined,
    );
    await apply("resume");
    const blocked = await call({ target: "earlier", dry_run: true });
    assert(blocked.data !== undefined && "pending" in blocked.data);
    assert(
      blocked.data.pending?.some((pending) =>
        pending.kind === "missing-authority"
      ),
      JSON.stringify(blocked),
    );
    await grantEffort(
      earlier,
      "agent/earlier",
      wallTimeIso(SYSTEM_CLOCK.wallNow()),
    );
    const reapproved = await call({ target: "earlier", dry_run: true });
    assert(reapproved.data !== undefined && "pending" in reapproved.data);
    assert(
      !reapproved.data.pending?.some((pending) =>
        pending.kind === "missing-authority"
      ),
      JSON.stringify(reapproved),
    );
    await apply("withdraw");
    assertEquals(
      observedRecords(await observeQueue(root, "main")).filter((record) =>
        record.kind === "proof" || record.kind === "evidence"
      ),
      evidence,
    );
  });
});
