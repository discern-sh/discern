/** Native death recovery is independent of the validation watchdog and preserves exclusive return. */
import { assert, assertEquals, assertStringIncludes } from "@std/assert";
import { exists } from "@std/fs";
import { join } from "@std/path";
import { assertTerminalTextIncludes, withTempDir } from "./helpers.ts";
import { project } from "./completion_public_fixture.ts";
import { git, gitOut, runAgent } from "./engine_helpers.ts";
import { processAllowance, waitUntil } from "./waiting.ts";
import {
  DEATH_DECLARATION as DECLARATION,
  environmentId,
  pausedExecutor,
} from "./fixtures/completion_death_fixture.ts";
import {
  observedRecords,
  requireQueue,
} from "../src/engine/landing_queue/repository.ts";
import { observeCompletionRecords } from "../src/engine/validation/runtime.ts";
import {
  executionStatus,
  recoverCompletionResult,
} from "../src/engine/execution/public_recovery.ts";
import { requireEnvironment } from "../src/engine/execution/registry.ts";
import { COMPLETION_CLAIM_BOUNDARIES } from "../src/engine/landing_queue/public_completion.ts";
import { RECOVERY_PUBLICATION_BOUNDARIES } from "../src/engine/execution/executor.ts";
import { executionChildrenQuiescent } from "../src/engine/execution/lifetime.ts";
import {
  readCompletionRecord,
  writeCompletionRecord,
} from "../src/engine/completion/store.ts";
import { loadExecutionIntent } from "../src/engine/execution/intent.ts";
import { SYSTEM_CLOCK } from "../src/shared/clock.ts";
import { ON_DISK_FORMATS } from "../src/shared/on_disk_formats.ts";
import { completionFixtures } from "./completion_fixtures.ts";
import { SYSTEM_SECURE_ENTROPY } from "../src/shared/entropy.ts";
import { completionMcpPeer } from "./completion_mcp_fixture.ts";
import { z } from "@zod/zod";
import { FinishOutputSchema } from "../src/shared/result_schemas.ts";
import { shellBarrier } from "./shell_barrier.ts";
import { artifactPath } from "../src/engine/execution/artifact_read.ts";
import { StartedChildSchema } from "../src/engine/execution/artifact_contracts.ts";
import { decodeWith } from "./decode_cli_result.ts";

for (const boundary of [...COMPLETION_CLAIM_BOUNDARIES, "validate"] as const) {
  Deno.test(`native death at ${boundary} recovers before the watchdog without validation or authority effects`, async () => {
    await withTempDir(async (root) => {
      await withTempDir(async (aux) => {
        const path = await project(root, ["local"], DECLARATION);
        const head = await gitOut(path, "rev-parse", "HEAD");
        const engine = await pausedExecutor(path, join(aux, "ready"), boundary);
        const id = await environmentId(path);
        try {
          const before = await requireEnvironment(path, id);
          const busy = await recoverCompletionResult(path, id);
          assert(!busy.ok, JSON.stringify(busy));
          assertEquals(
            (await requireEnvironment(path, id)).stamp,
            before.stamp,
          );
          if (boundary === "execution") {
            const delegation = decodeWith(
              z.record(z.string(), z.string()),
              await Deno.readTextFile(join(aux, "ready.delegation")),
            );
            const nested = await runAgent(path, [
              "done",
              "--recover",
              id,
              "--json",
            ], { env: delegation });
            assert(nested.code !== 0, nested.output);
            assertTerminalTextIncludes(
              nested.output,
              "delegated checkout lease",
            );
            assertEquals(
              (await requireEnvironment(path, id)).stamp,
              before.stamp,
            );
          }
          const status = await executionStatus(path);
          if (boundary !== "reservation") {
            assertEquals(status.execution_activity?.[0]?.ownership, "held");
            assert(before.record.data.state.kind === "executing");
            assert(
              before.record.data.state.claim.expires_at -
                  SYSTEM_CLOCK.wallNow() >
                10 * 3600_000,
            );
          } else {
            assertEquals(status.execution_recovery?.[0]?.environment_id, id);
          }
          assert(!(await recoverCompletionResult(path, id)).ok);
          assertEquals(
            (await requireEnvironment(path, id)).stamp,
            before.stamp,
          );
        } finally {
          await engine.stop();
        }
        const prior = observedRecords(await observeCompletionRecords(path));
        const protectedRecords = prior.filter((record) =>
          record.kind === "authority" || record.kind === "evidence" ||
          record.kind === "proof" || record.kind === "landing"
        );
        const interrupted = await requireEnvironment(path, id);
        if (interrupted.record.data.state.kind === "executing") {
          const state = interrupted.record.data.state;
          assert(await executionChildrenQuiescent(path, state.attempt_id));
          const status = await executionStatus(path);
          assertEquals(status.execution_activity?.[0]?.ownership, "available");
          assertEquals(
            status.execution_activity?.[0]?.children_quiescent,
            true,
          );
        }
        const preview = await recoverCompletionResult(path, id, true);
        assert(preview.ok, JSON.stringify(preview));
        assertEquals(
          (await requireEnvironment(path, id)).stamp,
          interrupted.stamp,
        );
        if (boundary === "execution") {
          await using peer = await completionMcpPeer(path);
          await peer.call(2, "discern_done", { path, recover: id });
          const result = z.object({ structuredContent: FinishOutputSchema })
            .parse((await peer.response(2)).result);
          assert(result.structuredContent.ok, JSON.stringify(result));
        } else {
          const result = await runAgent(path, [
            "done",
            "--recover",
            id,
            "--json",
          ]);
          assertEquals(result.code, 0, result.output);
        }
        const returned = await requireEnvironment(path, id);
        assertEquals(returned.record.data.state.kind, "idle");
        assertEquals(returned.record.data.release.kind, "held");
        assertEquals(await gitOut(path, "rev-parse", "HEAD"), head);
        assertEquals(await gitOut(path, "status", "--porcelain"), "");
        assertEquals(
          await exists(join(path, "executions")),
          boundary === "validate",
        );
        if (boundary === "validate") {
          assertEquals(await Deno.readTextFile(join(path, "executions")), "v");
        }
        const records = observedRecords(await observeCompletionRecords(path));
        assertEquals(
          records.filter((record) =>
            record.kind === "authority" || record.kind === "evidence" ||
            record.kind === "proof" || record.kind === "landing"
          ),
          protectedRecords,
        );
        for (const record of records) {
          if (record.kind === "attempt") {
            assertEquals(record.data.state.kind, "finished");
            if (record.data.state.kind === "finished") {
              assertEquals(record.data.state.outcome, "cancelled");
            }
          }
        }
        const queue = await requireQueue(path);
        assert(
          queue.record.data.entries.every((entry) => entry.state !== "active"),
        );
        assert((await recoverCompletionResult(path, id)).ok);
        assertEquals(
          (await requireEnvironment(path, id)).stamp,
          returned.stamp,
        );
        assertEquals((await requireQueue(path)).stamp, queue.stamp);
        if (interrupted.record.data.state.kind === "executing") {
          const state = interrupted.record.data.state;
          const intent = await loadExecutionIntent(path, state.attempt_id, id);
          for (
            const specimen of [
              completionFixtures().evidence,
              completionFixtures().proof,
            ]
          ) {
            assert(specimen.kind === "evidence" || specimen.kind === "proof");
            const record = specimen.kind === "evidence"
              ? {
                ...specimen,
                id: SYSTEM_SECURE_ENTROPY.uuid(),
                data: {
                  ...specimen.data,
                  attempt_id: state.attempt_id,
                  candidate_id: intent.candidate_id,
                  sequence: intent.attempt.identity.sequence,
                  artifacts: specimen.data.artifacts.map((artifact) => ({
                    ...artifact,
                    attempt_id: state.attempt_id,
                    candidate_id: intent.candidate_id,
                  })),
                },
              }
              : {
                ...specimen,
                id: SYSTEM_SECURE_ENTROPY.uuid(),
                data: {
                  ...specimen.data,
                  attempt_id: state.attempt_id,
                  candidate_id: intent.candidate_id,
                  receipts: specimen.data.receipts.map((receipt) => ({
                    ...receipt,
                    candidate_id: intent.candidate_id,
                  })),
                },
              };
            const stale = await writeCompletionRecord(
              path,
              {
                ...record,
                version: ON_DISK_FORMATS.completionRecord.version,
              },
              null,
              { attempt_id: state.attempt_id, token: state.claim.token },
            );
            assertEquals(stale.kind, "claim-lost", JSON.stringify(stale));
          }
        }
      });
    });
  });
}

for (
  const boundary of [
    ...RECOVERY_PUBLICATION_BOUNDARIES,
    "capture",
    "restore",
    "returned",
  ] as const
) {
  Deno.test(`native recovery interrupted at ${boundary} resumes the frozen temporary return and retains capacity`, async () => {
    await withTempDir(async (root) => {
      await withTempDir(async (aux) => {
        const path = await project(root, ["local"], DECLARATION);
        await Deno.writeTextFile(join(root, "predecessor"), "new trunk\n");
        await git(root, "add", "predecessor");
        await git(root, "commit", "-m", "Advance predecessor");
        const originalHead = await gitOut(path, "rev-parse", "HEAD");
        const original = await pausedExecutor(
          path,
          join(aux, "executing"),
          "validate",
        );
        await original.stop();
        const id = await environmentId(path);
        const current = await requireEnvironment(path, id);
        assert(current.record.data.state.kind === "executing");
        const interruptedAttempt = current.record.data.state.attempt_id;
        const recovery = await pausedExecutor(
          path,
          join(aux, "recovering"),
          boundary,
          id,
        );
        try {
          const queue = await requireQueue(path);
          assert(
            queue.record.data.entries.some((entry) => entry.state === "active"),
          );
          const competing = await recoverCompletionResult(path, id);
          assert(!competing.ok, JSON.stringify(competing));
          assertEquals((await requireQueue(path)).stamp, queue.stamp);
        } finally {
          await recovery.stop();
        }
        const result = await runAgent(path, [
          "done",
          "--recover",
          id,
          "--json",
        ]);
        assertEquals(result.code, 0, result.output);
        assertEquals(
          (await requireEnvironment(path, id)).record.data.release.kind,
          "held",
        );
        assertEquals(await gitOut(path, "rev-parse", "HEAD"), originalHead);
        assertEquals(await exists(join(path, "predecessor")), false);
        assertEquals(await Deno.readTextFile(join(path, "executions")), "v");
        const attempt = await readCompletionRecord(path, {
          kind: "attempt",
          id: interruptedAttempt,
        });
        assert(
          attempt.kind === "recorded" && attempt.record.kind === "attempt",
        );
        assertEquals(attempt.record.data.state.kind, "finished");
        assert(
          (await requireQueue(path)).record.data.entries.every((entry) =>
            entry.state !== "active"
          ),
        );
      });
    });
  });
}

Deno.test("a killed native executor with a surviving child cannot restore until that recorded group stops", async () => {
  await withTempDir(async (root) => {
    await withTempDir(async (aux) => {
      const path = await project(root, ["local"], DECLARATION);
      const marker = join(aux, "child");
      using barrier = await shellBarrier(marker + ".fifo");
      const engine = await pausedExecutor(path, marker, "surviving-child");
      const id = await environmentId(path);
      const current = await requireEnvironment(path, id);
      assert(current.record.data.state.kind === "executing");
      const attemptId = current.record.data.state.attempt_id;
      const directory = await artifactPath(
        path,
        attemptId,
        "environment/children",
      );
      try {
        await waitUntil(
          async () => {
            for await (const entry of Deno.readDir(directory)) {
              if (!entry.name.startsWith("started-")) continue;
              const started = decodeWith(
                StartedChildSchema,
                await Deno.readTextFile(join(directory, entry.name)),
              );
              // The job is the only unsettled started group at this observed barrier.
              if (
                started.isolated &&
                !await exists(
                  join(directory, entry.name.replace("started-", "settled-")),
                )
              ) return true;
            }
            return false;
          },
          "the child's durable start receipt",
          { allowance: processAllowance() },
        );
        await engine.stop();
        assertEquals(await executionChildrenQuiescent(path, attemptId), false);
        const blocked = await recoverCompletionResult(path, id);
        assert(!blocked.ok, JSON.stringify(blocked));
        assertStringIncludes(blocked.message ?? "", "child");
        assert(
          (await requireQueue(path)).record.data.entries.some((entry) =>
            entry.state === "active"
          ),
        );
        assertEquals(await Deno.readTextFile(join(path, "executions")), "v");
        await barrier.release();
        await waitUntil(
          () => executionChildrenQuiescent(path, attemptId),
          "orphaned group to exit after its owner releases the barrier",
          { allowance: processAllowance() },
        );
        const returned = await recoverCompletionResult(path, id);
        assert(returned.ok, JSON.stringify(returned));
        assertEquals(
          (await requireEnvironment(path, id)).record.data.release.kind,
          "held",
        );
        assertEquals(await Deno.readTextFile(join(path, "executions")), "v");
      } finally {
        await barrier.release();
        await engine.stop();
      }
    });
  });
});
