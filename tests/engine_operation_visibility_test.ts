import { decodeWith } from "./decode_cli_result.ts";
/** Real public operations retain waits, identity, cancellation, and final results. */
import { assert, assertEquals, assertNotEquals } from "@std/assert";
import { z } from "@zod/zod";
import {
  ProgressDataSchema,
  ProgressOutputSchema,
  StandardsProposeOutputSchema,
} from "../src/shared/result_schemas.ts";
import {
  addWorktree,
  engineEnv,
  engineRunArgs,
  git,
  gitInit,
  runAgent,
  scaffoldEngine,
  writeConfig,
} from "./engine_helpers.ts";
import { assertTerminalTextIncludes, withTempDir } from "./helpers.ts";
import { completionMcpPeer } from "./completion_mcp_fixture.ts";
import {
  processAllowance,
  settlePending,
  waitForPendingCondition,
  waitUntil,
} from "./waiting.ts";
import { operationProgressResult } from "../src/engine/completion/progress_result.ts";
import { GIT_ADMIN_STATE } from "../src/shared/git_admin_state.ts";

for (const surface of ["cli", "mcp"] as const) {
  Deno.test(`${surface} proposal renewal journals capacity, exact holder, and final result without a progress token`, async () => {
    await withTempDir(async (root) => {
      await scaffoldEngine(root, { agents: [] });
      await writeConfig(
        root,
        `[project]\nslug = "visibility"\nagents = []\n[repository]\ntrunk = "main"\n[gate]\nconcurrent_test_runs = 1\n[standards.sources]\ndirection = "down"\nlimit = 1\nrun = "echo DISCERN_METRIC sources 2"\ninputs = ["src/**"]\n`,
      );
      await Deno.mkdir(`${root}/src`);
      await Deno.writeTextFile(`${root}/src/base.ts`, "base\n");
      await gitInit(root);
      const path = await addWorktree(root, "visibility");
      await Deno.writeTextFile(`${path}/src/feature.ts`, "feature\n");
      await git(path, "add", "src/feature.ts");
      await git(path, "commit", "-m", "Add source");
      const args = [
        "standards",
        "propose",
        "sources",
        "--reason",
        "Additional source is required.",
        "--json",
      ];
      const created = await runAgent(path, args);
      assertEquals(created.code, 0, created.output);
      await Deno.writeTextFile(`${path}/src/feature.ts`, "updated feature\n");
      await git(path, "commit", "-am", "Update feature");
      const failed = await runAgent(path, ["done", "--json"]);
      assertEquals(failed.code, 1, failed.output);
      const preceding = await operationProgressResult(path);
      assertEquals(preceding.data?.operation.verb, "done");
      const preview = await runAgent(path, [...args, "--dry-run"]);
      assertEquals(preview.code, 0, preview.output);
      assertEquals(
        (await operationProgressResult(path)).data?.handle,
        preceding.data?.handle,
      );
      const slotDir = `${root}/.git/${GIT_ADMIN_STATE.testSlots.path}`;
      await Deno.mkdir(slotDir, { recursive: true });
      using slot = await Deno.open(`${slotDir}/slot-1`, {
        create: true,
        read: true,
        write: true,
      });
      assert(await slot.tryLock(true));
      const allowance = processAllowance();
      await using peer = surface === "mcp"
        ? await completionMcpPeer(path, {}, allowance)
        : undefined;
      const sendProposal = async (id: number): Promise<void> => {
        assert(peer);
        await peer.send({
          id,
          method: "tools/call",
          params: {
            name: "discern_standards_propose",
            arguments: {
              path,
              name: "sources",
              reason: "Additional source is required.",
            },
          },
        });
      };
      let cli: ReturnType<typeof runAgent> | undefined;
      if (surface === "cli") cli = runAgent(path, args);
      else await sendProposal(2);
      const pending: Promise<unknown> | undefined = cli ?? peer?.finished;
      assert(pending);
      try {
        await waitForPendingCondition(
          pending,
          async () => {
            peer?.ensurePending(2);
            const result = await operationProgressResult(path);
            return result.data?.operation.verb === "standards propose" &&
              result.data.waits?.some((wait) =>
                  wait.kind === "test-capacity"
                ) === true;
          },
          "renewal to retain its capacity wait",
          { allowance },
        );
        const visible = await runAgent(path, ["progress", "--json"]);
        const snapshot = decodeWith(ProgressOutputSchema, visible.stdout);
        assert(snapshot.ok);
        const snapshotData = ProgressDataSchema.parse(snapshot.data);
        const handle = snapshotData.handle;
        assert(handle);
        assertNotEquals(handle, preceding.data?.handle);
        assertEquals(snapshotData.executor, "running");
        const contender = await runAgent(path, ["prepare", "--json"]);
        assertEquals(contender.code, 1, contender.output);
        assertTerminalTextIncludes(
          contender.output,
          "Holder: standards propose",
        );
        assertTerminalTextIncludes(contender.output, handle);
        const latest = await operationProgressResult(path);
        assertEquals(latest.data?.operation.verb, "prepare");
        assertEquals(latest.data?.outcome, "failed");
        assertTerminalTextIncludes(
          z.object({ message: z.string() }).parse(latest.data?.result).message,
          handle,
        );
        // A new rejected journal is now latest. A second contender must still identify the renewal lease.
        const second = await runAgent(path, ["refresh", "--json"]);
        assertTerminalTextIncludes(second.output, handle);
        slot.unlockSync();
        const completed = cli !== undefined
          ? decodeWith(StandardsProposeOutputSchema, (await cli).stdout)
          : z.object({ structuredContent: StandardsProposeOutputSchema }).parse(
            (await peer?.response(2))?.result,
          ).structuredContent;
        assert(completed.ok, JSON.stringify(completed));
        const retained = await runAgent(path, ["progress", handle, "--json"]);
        const final = decodeWith(ProgressOutputSchema, retained.stdout);
        assert(final.ok);
        const finalData = ProgressDataSchema.parse(final.data);
        assertEquals(finalData.outcome, "completed");
        assertEquals(
          z.object({ ok: z.boolean(), verb: z.string() }).parse(
            finalData.result,
          ).ok,
          true,
        );
        assertEquals(
          z.object({ ok: z.boolean(), verb: z.string() }).parse(
            finalData.result,
          ).verb,
          "standards propose",
        );
        assertEquals(
          peer?.messages.some((message) =>
            message.method === "notifications/progress"
          ) ?? false,
          false,
        );
        if (peer !== undefined) {
          await Deno.writeTextFile(
            `${path}/src/feature.ts`,
            "next descendant\n",
          );
          await git(path, "commit", "-am", "Advance descendant");
          assert(await slot.tryLock(true));
          await sendProposal(3);
          await waitForPendingCondition(
            peer.finished,
            async () => {
              peer.ensurePending(3);
              const current = await operationProgressResult(path);
              return current.data?.handle !== handle &&
                current.data?.operation.verb === "standards propose" &&
                current.data.waits?.some((wait) =>
                    wait.kind === "test-capacity"
                  ) === true;
            },
            "next renewal to wait",
            { allowance },
          );
          const cancelledHandle = (await operationProgressResult(path)).data
            ?.handle;
          assert(cancelledHandle);
          await peer.send({
            method: "notifications/cancelled",
            params: { requestId: 3, reason: "Cancel the fixture renewal" },
          });
          await waitUntil(
            async () =>
              (await operationProgressResult(path, { handle: cancelledHandle }))
                .data?.outcome === "cancelled",
            "cancelled renewal settlement",
            { allowance },
          );
          const cancelled = await operationProgressResult(path, {
            handle: cancelledHandle,
          });
          assertEquals(
            z.object({ ok: z.boolean() }).parse(cancelled.data?.result).ok,
            false,
          );
          slot.unlockSync();
          await sendProposal(4);
          const retry =
            z.object({ structuredContent: StandardsProposeOutputSchema }).parse(
              (await peer.response(4)).result,
            ).structuredContent;
          assert(retry.ok, JSON.stringify(retry));
        }
      } finally {
        slot.unlockSync();
        if (cli !== undefined) await cli;
      }
    });
  });
}

import { shellBarrier } from "./shell_barrier.ts";
import { pathExists } from "../src/shared/fs_presence.ts";

for (
  const phase of [
    "queue-capacity",
    "queue-command",
    "start-command",
    "prepare-command",
    "scripts-command",
  ] as const
) {
  Deno.test(`CLI ${phase} cancellation settles the journal before process exit`, async () => {
    await withTempDir(async (root) =>
      await withTempDir(async (scratch) => {
        using barrier = await shellBarrier(`${scratch}/release`);
        await scaffoldEngine(root, { agents: [] });
        const command = `${
          phase === "prepare-command" ? "discern tidy --json && " : ""
        }touch '${scratch}/entered'; ${barrier.wait}`;
        await writeConfig(
          root,
          `[project]\nslug = "cancel"\nagents = []\n[gate]\nconcurrent_test_runs = 1\n${
            phase === "start-command"
              ? `[worktree.setup]\nsteps = [${JSON.stringify(command)}]\n`
              : phase === "prepare-command"
              ? `[jobs]\nformat = ${JSON.stringify(command)}\n`
              : ""
          }`,
        );
        if (phase === "scripts-command") {
          await Deno.mkdir(`${root}/discern/scripts`, { recursive: true });
          await Deno.writeTextFile(
            `${root}/discern/scripts/hold`,
            `#!/bin/sh\n${command}\n`,
          );
          await Deno.chmod(`${root}/discern/scripts/hold`, 0o755);
        }
        await gitInit(root);
        const slotDir = `${root}/.git/${GIT_ADMIN_STATE.testSlots.path}`;
        await Deno.mkdir(slotDir, { recursive: true });
        using slot = await Deno.open(`${slotDir}/slot-1`, {
          create: true,
          read: true,
          write: true,
        });
        if (phase === "queue-capacity") assert(await slot.tryLock(true));
        const args = phase === "start-command"
          ? ["start", "--name", "cancelled", "--json"]
          : phase === "prepare-command"
          ? ["prepare", "--json"]
          : phase === "scripts-command"
          ? ["scripts", "hold"]
          : ["queue", "--", "sh", "-c", command];
        const child = new Deno.Command(Deno.execPath(), {
          args: engineRunArgs(args),
          cwd: root,
          env: await engineEnv(),
          stdin: "null",
          stdout: "piped",
          stderr: "piped",
        }).spawn();
        const finished = child.output();
        try {
          await waitForPendingCondition(
            finished,
            async () =>
              phase === "queue-capacity"
                ? (await operationProgressResult(root)).data?.waits?.some((
                  wait,
                ) => wait.kind === "test-capacity") === true
                : await pathExists(`${scratch}/entered`),
            "operation to enter cancellation phase",
          );
          const progress = await operationProgressResult(root);
          assertEquals(progress.data?.operation.verb, phase.split("-")[0]);
          const handle = progress.data?.handle;
          assert(handle);
          child.kill("SIGTERM");
          const ended = await settlePending(
            finished,
            "cancelled CLI to settle",
            { allowance: processAllowance() },
          );
          assertEquals(ended.code, 143, new TextDecoder().decode(ended.stderr));
          const retained = await operationProgressResult(root, { handle });
          assertEquals(
            retained.data?.outcome,
            "cancelled",
            JSON.stringify(retained),
          );
          assertEquals(
            z.object({ ok: z.boolean() }).parse(retained.data?.result).ok,
            false,
          );
        } finally {
          slot.unlockSync();
          await barrier.release();
          await finished;
        }
      })
    );
  });
}
