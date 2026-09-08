/** Cancellation at native capture and declared return crosses the real MCP transport. */
import { assert, assertEquals } from "@std/assert";
import { z } from "@zod/zod";
import { quoteCommandWord } from "../src/shared/command_evidence.ts";
import { readTextIfExists } from "../src/shared/fs_presence.ts";
import {
  FinishOutputSchema,
  StatusOutputSchema,
} from "../src/shared/result_schemas.ts";
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
import { firedHintsFromTexts } from "../src/shared/hints.ts";
import { readPidsIfReady } from "./process_id.ts";

const StatusResultSchema = z.object({ structuredContent: StatusOutputSchema });
const FinishResultSchema = z.object({ structuredContent: FinishOutputSchema });

for (const phase of ["enrollment", "capture", "restore"] as const) {
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
          if (phase === "enrollment") {
            await Deno.writeTextFile(aux + "/arm", "ready");
          }
          if (phase !== "restore") {
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
          let closed = false;
          try {
            await peer.call(2, "discern_done", { path });
            await waitForPendingCondition(
              peer.finished,
              async () => {
                peer.ensurePending(2);
                const ready = await readPidsIfReady([
                  aux + "/leader",
                  aux + "/descendant",
                ]);
                if (ready === undefined) return false;
                pids.push(...ready);
                return true;
              },
              "the owned " + phase + " child to establish readiness",
            );
            if (phase !== "enrollment") {
              await peer.call(10, "discern_status", { path });
              const active =
                StatusResultSchema.parse((await peer.response(10)).result)
                  .structuredContent;
              assert(
                active.data !== undefined &&
                  "execution_activity" in active.data,
              );
              assertEquals(active.data.execution_activity?.[0]?.phase, phase);
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
                return (phase === "enrollment" ||
                  records.some((record) => record.kind === "attempt")) &&
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
              assertEquals(
                firedHintsFromTexts(status.hints).some((hint) =>
                  hint.id === "status-branch-behind"
                ),
                false,
              );
              assertEquals(
                status.data.execution_recovery?.[0]?.children_quiescent,
                true,
              );
            } else {
              assert(pids.every((pid) => !completionProcessAlive(pid)));
              assertEquals(
                await gitOut(path, "rev-parse", "HEAD", "HEAD^{tree}"),
                before,
              );
            }
            const executions = await readTextIfExists(path + "/executions");
            await peer[Symbol.asyncDispose]();
            closed = true;
            await using reconnect = await completionMcpPeer(path, extraEnv);
            await reconnect.call(2, "discern_status", { path });
            const resumed =
              StatusResultSchema.parse((await reconnect.response(2)).result)
                .structuredContent;
            assertEquals(resumed.ok, true);
            if (environment.data.state.kind === "recovery") {
              await reconnect.call(3, "discern_done", {
                path,
                recover: environment.id,
              });
              const recovered =
                FinishResultSchema.parse((await reconnect.response(3)).result)
                  .structuredContent;
              assertEquals(recovered.ok, true, JSON.stringify(recovered));
              assertEquals(
                await readTextIfExists(path + "/executions"),
                executions,
                "recovery must not repeat producers",
              );
            }
            assertEquals(
              await gitOut(path, "rev-parse", "HEAD", "HEAD^{tree}"),
              before,
            );
            assert(pids.every((pid) => !completionProcessAlive(pid)));
            await reconnect.call(4, "discern_done", {
              path,
              retain_checkout: true,
            });
            const completed =
              FinishResultSchema.parse((await reconnect.response(4)).result)
                .structuredContent;
            assertEquals(completed.ok, true, JSON.stringify(completed));
            const beforeRelease = await readTextIfExists(path + "/executions");
            await reconnect.call(5, "discern_done", {
              path,
              release_checkout: true,
            });
            const released =
              FinishResultSchema.parse((await reconnect.response(5)).result)
                .structuredContent;
            assertEquals(released.ok, true, JSON.stringify(released));
            assert(released.data !== undefined && "gate_ran" in released.data);
            assertEquals(released.data.gate_ran, false);
            assertEquals(
              await readTextIfExists(path + "/executions"),
              beforeRelease,
            );
            const settled = observedRecords(await observeQueue(root, "main"));
            assert(
              settled.every((record) =>
                record.kind !== "attempt" ||
                record.data.state.kind === "finished"
              ),
            );
          } catch (error) {
            const records = observedRecords(await observeQueue(root, "main"));
            throw new Error(
              "Cancellation boundary " + phase + ": " + JSON.stringify({
                children: pids.map((pid) => ({
                  pid,
                  alive: completionProcessAlive(pid),
                })),
                stderr: peer.stderr,
                records: records.filter((record) =>
                  record.kind === "environment" || record.kind === "attempt"
                )
                  .map((record) => ({
                    kind: record.kind,
                    id: record.id,
                    state: record.data.state,
                  })),
                responses: peer.messages.filter((message) =>
                  "id" in message && message.id !== 1
                )
                  .slice(-2),
              }),
              { cause: error },
            );
          } finally {
            for (const pid of pids) {
              if (completionProcessAlive(pid)) Deno.kill(pid, "SIGKILL");
            }
            if (!closed) await peer[Symbol.asyncDispose]();
          }
        });
      });
    },
  );
}
