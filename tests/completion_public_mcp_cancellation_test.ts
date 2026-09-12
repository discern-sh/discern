import { quoteCommandWord } from "../src/shared/command_evidence.ts";
import { withCompletionPublication } from "../src/engine/operation_lock.ts";
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
import {
  processAllowance,
  waitForPendingCondition,
  waitUntil,
} from "./waiting.ts";
import { pathExists } from "../src/shared/fs_presence.ts";
import { GIT_ADMIN_STATE } from "../src/shared/git_admin_state.ts";
import { observeCompletionRecords } from "../src/engine/validation/runtime.ts";
import type { CompletionRecord } from "../src/engine/completion/records.ts";
import { gitOut, runAgent } from "./engine_helpers.ts";
import { readPidsIfReady } from "./process_id.ts";

const StatusToolResultSchema = z.object({
  structuredContent: StatusOutputSchema,
});

/** Project recorded readings onto validated envelopes. */
async function observedRecords(root: string): Promise<CompletionRecord[]> {
  return (await observeCompletionRecords(root)).records.flatMap((
    { reading },
  ) => reading.kind === "recorded" ? [reading.record] : []);
}

for (const phase of ["producer", "capacity", "queued-producer"] as const) {
  Deno.test(`real MCP cancellation during ${phase} preserves source and supports reconnect`, async () => {
    await withTempDir(async (root) => {
      await withTempDir(async (aux) => {
        const producer =
          `echo $$ > '${aux}/leader'; tail -f /dev/null & echo $! > '${aux}/descendant'; wait`;
        const path = await project(
          root,
          `
[gate]
concurrent_test_runs = 1
`,
          phase === "queued-producer"
            ? `discern queue -- sh -c ${quoteCommandWord(producer)}`
            : producer,
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
        const allowance = processAllowance();
        try {
          await using peer = await completionMcpPeer(path, {}, allowance);
          await peer.call(2, "discern_done", { path });
          await waitForPendingCondition(
            peer.finished,
            async () => {
              peer.ensurePending(2);
              if (phase !== "capacity") {
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
            },
            `MCP completion to reach ${phase}`,
            { allowance },
          );
          if (phase === "queued-producer") {
            let publicationEntered = false;
            await withCompletionPublication(root, () => {
              publicationEntered = true;
              return Promise.resolve();
            });
            assert(
              publicationEntered,
              "expensive validation must not retain the common publication lock",
            );
            const competing = await runAgent(path, ["done", "--json"]);
            assertEquals(competing.code, 1, competing.output);
            assert(
              /lock|operation|in use/i.test(competing.output),
              competing.output,
            );
          }
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
            { allowance },
          );
          await waitUntil(
            async () => {
              const records = await observedRecords(root);
              return records.some((record) => record.kind === "attempt") &&
                records.every((record) =>
                  record.kind !== "attempt" ||
                  record.data.state.kind !== "claimed"
                );
            },
            "the cancelled MCP attempt to settle",
            { allowance },
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
          const records = await observedRecords(root);
          assertEquals(records.filter((record) => record.kind === "proof"), []);
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
        await using reconnect = await completionMcpPeer(root, {}, allowance);
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
