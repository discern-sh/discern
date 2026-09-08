/** Cancellation at native capture and declared return crosses the real MCP transport. */
import { assert, assertEquals } from "@std/assert";
import { z } from "@zod/zod";
import { quoteCommandWord } from "../src/shared/command_evidence.ts";
import { pathExists } from "../src/shared/fs_presence.ts";
import { StatusOutputSchema } from "../src/shared/result_schemas.ts";
import {
  observedRecords,
  observeQueue,
} from "../src/engine/landing_queue/repository.ts";
import { withTempDir } from "./helpers.ts";
import { project } from "./completion_public_fixture.ts";
import { git, gitOut, writeExecutable } from "./engine_helpers.ts";
import {
  completionMcpPeer,
  completionProcessAlive,
} from "./completion_mcp_fixture.ts";
import { waitForPendingCondition, waitUntil } from "./waiting.ts";

const StatusResultSchema = z.object({ structuredContent: StatusOutputSchema });

for (const phase of ["capture", "restore"] as const) {
  Deno.test(
    "real MCP cancellation during " + phase +
      " stops owned children or retains explicit recovery",
    async () => {
      await withTempDir(async (root) => {
        await withTempDir(async (aux) => {
          const q = quoteCommandWord;
          const block = "echo $$ > " + q(aux + "/leader") +
            "; tail -f /dev/null & echo $! > " + q(aux + "/descendant") +
            "; wait";
          const once = "if mkdir " + q(aux + "/intercepted") +
            " 2>/dev/null; then " + block + "; fi";
          const declaration = phase === "restore"
            ? [
              "[execution.local]",
              "kind = 'borrowed'",
              "prepare = 'true'",
              "restore = " + JSON.stringify(once),
              "reusable = true",
              "capacity = 1",
              "resources = []",
              "ignored = ['executions']",
              "inputs = ['**']",
            ].join("\n")
            : "";
          const path = await project(
            root,
            ["local"],
            declaration,
            "printf t >> executions; touch " + q(aux + "/arm") +
              "; printf 'DISCERN_METRIC coverage 93\\n'",
          );
          const before = await gitOut(path, "rev-parse", "HEAD", "HEAD^{tree}");
          const branch = await gitOut(path, "symbolic-ref", "HEAD");
          if (phase === "restore") {
            await Deno.writeTextFile(
              root + "/predecessor",
              "independent predecessor\n",
            );
            await git(root, "add", "predecessor");
            await git(root, "commit", "-m", "Advance the composed predecessor");
          }
          const extraEnv: Record<string, string> = {};
          if (phase === "capture") {
            const shim = aux + "/git";
            await writeExecutable(
              shim,
              [
                "#!/bin/sh",
                "if [ -f " + q(aux + "/arm") + " ]; then",
                'case " $* " in',
                '*" ls-files --stage -v -z "*)',
                once,
                ";;",
                "esac",
                "fi",
                'exec git "$@"',
              ].join("\n") + "\n",
            );
            extraEnv.GIT_BIN = shim;
          }
          const pids: number[] = [];
          const peer = await completionMcpPeer(path, extraEnv);
          try {
            await peer.call(2, "discern_done", { path });
            await waitForPendingCondition(
              peer.finished,
              async () => {
                peer.ensurePending(2);
                return await pathExists(aux + "/descendant");
              },
              "the owned " + phase + " child to establish readiness",
            );
            for (const name of ["leader", "descendant"]) {
              const pid = Number(await Deno.readTextFile(aux + "/" + name));
              assert(Number.isSafeInteger(pid) && pid > 0);
              pids.push(pid);
            }
            await peer.send({
              method: "notifications/cancelled",
              params: {
                requestId: 2,
                reason: "Cancel the owned " + phase + " fixture",
              },
            });
            await waitUntil(
              async () => {
                const records = observedRecords(
                  await observeQueue(root, "main"),
                );
                const environment = records.find((record) =>
                  record.kind === "environment" && record.data.path === path
                );
                if (
                  environment?.kind !== "environment" ||
                  (environment.data.state.kind !== "idle" &&
                    environment.data.state.kind !== "recovery")
                ) return false;
                const state = environment.data.state;
                const ownedChildren = pids.every((pid) =>
                  !completionProcessAlive(pid)
                ) || (state.kind === "recovery" &&
                  !state.recovery.children_quiescent &&
                  state.recovery.retained_paths.length > 0);
                return records.some((record) => record.kind === "attempt") &&
                  ownedChildren &&
                  records.every((record) =>
                    record.kind !== "attempt" ||
                    record.data.state.kind === "finished" ||
                    (state.kind === "recovery" &&
                      state.attempt_id === record.id)
                  );
              },
              "the cancelled " + phase +
                " attempt to settle or retain explicit recovery",
              { timeoutMs: 10_000 },
            );
            assertEquals(
              await gitOut(path, "rev-parse", branch, branch + "^{tree}"),
              before,
            );
            const records = observedRecords(await observeQueue(root, "main"));
            assertEquals(
              records.filter((record) => record.kind === "proof"),
              [],
            );
            const environment = records.find((record) =>
              record.kind === "environment" && record.data.path === path
            );
            assert(environment?.kind === "environment");
            assert(
              environment.data.state.kind === "idle" ||
                environment.data.state.kind === "recovery",
            );
            await peer.call(3, "discern_status", { path });
            const response = await peer.response(3);
            assertEquals(response.error, undefined);
            const status =
              StatusResultSchema.parse(response.result).structuredContent;
            assertEquals(status.ok, true);
            if (environment.data.state.kind === "recovery") {
              assert(environment.data.state.recovery.retained_paths.length > 0);
              if (environment.data.state.recovery.children_quiescent) {
                assert(pids.every((pid) => !completionProcessAlive(pid)));
              }
              assert(
                status.data !== undefined &&
                  "execution_recovery" in status.data,
              );
              assert((status.data.execution_recovery?.length ?? 0) > 0);
            } else {
              assert(pids.every((pid) => !completionProcessAlive(pid)));
              assertEquals(
                await gitOut(path, "rev-parse", "HEAD", "HEAD^{tree}"),
                before,
              );
            }
          } finally {
            for (const pid of pids) {
              if (completionProcessAlive(pid)) Deno.kill(pid, "SIGKILL");
            }
            await peer[Symbol.asyncDispose]();
          }
        });
      });
    },
  );
}
