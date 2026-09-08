/** Transport cancellation must reach the source engine and settle owned execution. */
import { assert, assertEquals } from "@std/assert";
import { z } from "@zod/zod";
import { StatusOutputSchema } from "../src/shared/result_schemas.ts";
import { withTempDir } from "./helpers.ts";
import { project } from "./completion_public_fixture.ts";
import {
  completionMcpPeer,
  completionProcessAlive as alive,
} from "./completion_mcp_fixture.ts";
import { waitForPendingCondition, waitUntil } from "./waiting.ts";
import { pathExists } from "../src/shared/fs_presence.ts";
import { GIT_ADMIN_STATE } from "../src/shared/git_admin_state.ts";
import {
  observedRecords,
  observeQueue,
} from "../src/engine/landing_queue/repository.ts";
import { gitOut } from "./engine_helpers.ts";
import { readPidsIfReady } from "./process_id.ts";

const StatusToolResultSchema = z.object({
  structuredContent: StatusOutputSchema,
});

for (const phase of ["producer", "capacity"] as const) {
  Deno.test(`real MCP cancellation during ${phase} preserves source and supports reconnect`, async () => {
    await withTempDir(async (root) => {
      await withTempDir(async (aux) => {
        const path = await project(
          root,
          ["local"],
          `
[gate]
concurrent_test_runs = 1
`,
          `echo $$ > '${aux}/leader'; tail -f /dev/null & echo $! > '${aux}/descendant'; wait`,
        );
        const before = await gitOut(path, "rev-parse", "HEAD", "HEAD^{tree}");
        let slot: Deno.FsFile | undefined;
        if (phase === "capacity") {
          const directory = `${root}/.git/${GIT_ADMIN_STATE.testSlots.path}`;
          await Deno.mkdir(directory, { recursive: true });
          slot = await Deno.open(`${directory}/slot-1`, {
            create: true,
            read: true,
            write: true,
          });
          assert(await slot.tryLock(true));
        }
        const pids: number[] = [];
        try {
          await using peer = await completionMcpPeer(path);
          await peer.call(2, "discern_done", { path });
          await waitForPendingCondition(peer.finished, async () => {
            peer.ensurePending(2);
            if (phase === "producer") {
              const ready = await readPidsIfReady([
                `${aux}/leader`,
                `${aux}/descendant`,
              ]);
              if (ready === undefined) return false;
              pids.push(...ready);
              return true;
            }
            return peer.messages.some((message) =>
              message.method === "notifications/progress" &&
              JSON.stringify(message).includes("test") &&
              /capacity|slot|waiting/i.test(JSON.stringify(message))
            );
          }, `MCP completion to reach ${phase}`);
          await peer.send({
            method: "notifications/cancelled",
            params: {
              requestId: 2,
              reason: "Owner cancelled the completion fixture",
            },
          });
          await waitUntil(
            () => pids.every((pid) => !alive(pid)),
            "the cancelled MCP process tree to stop",
            { timeoutMs: 10_000 },
          );
          await waitUntil(
            async () => {
              const records = observedRecords(await observeQueue(root, "main"));
              return records.some((record) => record.kind === "attempt") &&
                records.every((record) =>
                  record.kind !== "attempt" ||
                  record.data.state.kind !== "claimed"
                );
            },
            "the cancelled MCP attempt to settle",
            { timeoutMs: 10_000 },
          );
          await peer.call(3, "discern_status", { path });
          const status = await peer.response(3);
          assertEquals(status.error, undefined);
          assertEquals(
            StatusToolResultSchema.parse(status.result).structuredContent.ok,
            true,
          );
          assertEquals(
            await gitOut(path, "rev-parse", "HEAD", "HEAD^{tree}"),
            before,
          );
          const records = observedRecords(await observeQueue(root, "main"));
          assertEquals(records.filter((record) => record.kind === "proof"), []);
          assert(records.every((record) =>
            record.kind !== "environment" ||
            record.data.state.kind === "idle" ||
            record.data.state.kind === "recovery"
          ));
          if (phase === "capacity") {
            assertEquals(await pathExists(`${aux}/leader`), false);
          }
        } finally {
          if (slot !== undefined) {
            slot.unlockSync();
            slot.close();
          }
          for (const pid of pids) {
            if (alive(pid)) Deno.kill(pid, "SIGKILL");
          }
        }
        await using reconnect = await completionMcpPeer(root);
        await reconnect.call(2, "discern_status", { path: root });
        const response = await reconnect.response(2);
        assertEquals(response.error, undefined);
        assertEquals(
          StatusToolResultSchema.parse(response.result).structuredContent.ok,
          true,
        );
      });
    });
  });
}
