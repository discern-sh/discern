/** Readiness loss changes queue priority without silently revoking source permission. */
import { assert, assertEquals } from "@std/assert";
import { withTempDir } from "./helpers.ts";
import { project } from "./completion_public_fixture.ts";
import { addWorktree, git, runAgent } from "./engine_helpers.ts";
import { quoteCommandWord } from "../src/shared/command_evidence.ts";
import { grantEffort } from "../src/engine/worktree/effort_grant_writer.ts";
import { SYSTEM_CLOCK, wallTimeIso } from "../src/shared/clock.ts";
import { synchronizeQueueAuthorities } from "../src/engine/landing_queue/public_authority.ts";
import { requireQueue } from "../src/engine/landing_queue/repository.ts";
import { orderedEntries } from "../src/engine/landing_queue/model.ts";

Deno.test("public failed rerun keeps source approval and fresh completion re-enters behind already eligible work", async () => {
  await withTempDir(async (root) => {
    await withTempDir(async (aux) => {
      const path = await project(
        root,
        ["local"],
        "",
        `if test -f ${
          quoteCommandWord(aux + "/fail")
        }; then exit 1; fi; printf t >> executions; printf 'DISCERN_METRIC coverage 93\\n'`,
        ["**"],
        // The rerun must be admitted while another approved source reserves head capacity.
        { concurrency: 2, environment: ["READINESS_PROBE"] },
      );
      const done = await runAgent(path, [
        "done",
        "--retain-checkout",
        "--json",
      ]);
      assertEquals(done.code, 0, done.output);
      await grantEffort(
        path,
        "agent/public-done",
        wallTimeIso(SYSTEM_CLOCK.wallNow()),
      );
      await synchronizeQueueAuthorities(root, "main");
      const peer = await addWorktree(root, "peer");
      await Deno.writeTextFile(`${peer}/peer`, "independent\n");
      await git(peer, "add", "peer");
      await git(peer, "commit", "-m", "Author peer work");
      const peerDone = await runAgent(peer, [
        "done",
        "--retain-checkout",
        "--json",
      ]);
      assertEquals(peerDone.code, 0, peerDone.output);
      await grantEffort(
        peer,
        "agent/peer",
        wallTimeIso(SYSTEM_CLOCK.wallNow()),
      );
      await synchronizeQueueAuthorities(root, "main");
      const approved = (await requireQueue(root)).record.data.entries.find((
        entry,
      ) => entry.source.effort_id === "public-done")?.authority_id;
      assert(approved !== null && approved !== undefined);
      await Deno.writeTextFile(`${aux}/fail`, "fail\n");
      const red = await runAgent(path, [
        "done",
        "--rerun",
        "--retain-checkout",
        "--json",
      ], { env: { READINESS_PROBE: "changed" } });
      assertEquals(red.code, 1, red.output);
      const failed = (await requireQueue(root)).record.data;
      const source = failed.entries.find((entry) =>
        entry.source.effort_id === "public-done"
      );
      assertEquals(source?.state, "failed");
      assertEquals(source?.authority_id, approved);
      assertEquals(source?.eligible_order, null);
      assertEquals(orderedEntries(failed)[0]?.source.effort_id, "peer");
      await synchronizeQueueAuthorities(root, "main");
      assertEquals(
        (await requireQueue(root)).record.data.entries.find((entry) =>
          entry.source.effort_id === "public-done"
        )?.eligible_order,
        null,
      );
      await Deno.remove(`${aux}/fail`);
      const green = await runAgent(path, [
        "done",
        "--rerun",
        "--retain-checkout",
        "--json",
      ], { env: { READINESS_PROBE: "changed" } });
      assertEquals(green.code, 0, green.output);
      const ready = (await requireQueue(root)).record.data;
      assertEquals(
        orderedEntries(ready).map((entry) => entry.source.effort_id),
        ["peer", "public-done"],
      );
      assertEquals(
        ready.entries.find((entry) => entry.source.effort_id === "public-done")
          ?.authority_id,
        approved,
      );
    });
  });
});
