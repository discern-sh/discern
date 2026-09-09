/** Reservation recovery preserves ownership uncertainty before any checkout return. */
import {
  assert,
  assertEquals,
  assertRejects,
  assertStringIncludes,
} from "@std/assert";
import { join } from "@std/path";
import { withTempDir } from "./helpers.ts";
import { project } from "./completion_public_fixture.ts";
import { completionFixtures } from "./completion_fixtures.ts";
import { withPublicCompletion } from "../src/engine/landing_queue/public_completion.ts";
import { recoverCompletionResult } from "../src/engine/execution/public_recovery.ts";
import { recoverUnexecutedReservation } from "../src/engine/execution/reservation_recovery.ts";
import {
  replaceEnvironment,
  requireEnvironment,
} from "../src/engine/execution/registry.ts";
import {
  observedRecords,
  requireQueue,
} from "../src/engine/landing_queue/repository.ts";
import { observeCompletionRecords } from "../src/engine/validation/runtime.ts";
import {
  completionRecordPath,
  writeCompletionRecord,
} from "../src/engine/completion/store.ts";
import { COMPLETION_FAMILIES } from "../src/engine/completion/records.ts";
import { loadConfig } from "../src/shared/config_schema.ts";
import { SYSTEM_CLOCK } from "../src/shared/clock.ts";
import { SYSTEM_SECURE_ENTROPY } from "../src/shared/entropy.ts";

for (
  const scenario of [
    "changed files",
    "stale observation",
    "unknown record",
    "producing attempt",
    "competing actors",
    "unreleased claim",
    "claim settlement",
    "settlement retry",
  ] as const
) {
  Deno.test(`unexecuted reservation recovery checks ${scenario} before releasing capacity`, async () => {
    await withTempDir(async (root) => {
      const path = await project(root, ["local"]);
      await assertRejects(
        () =>
          withPublicCompletion(path, {
            context: "local",
            mode: "strict",
            afterClaim: (boundary) =>
              boundary === "reservation"
                ? Promise.reject(new Error("controlled reservation boundary"))
                : Promise.resolve(),
          }, () => {
            throw new Error("No producer may run");
          }),
        Error,
        "controlled reservation boundary",
      );
      const records = observedRecords(await observeCompletionRecords(path));
      const environment = records.find((record) =>
        record.kind === "environment"
      );
      assert(environment?.kind === "environment");
      const id = environment.id;
      const queue = await requireQueue(path);
      const candidate = queue.record.data.entries.find((entry) =>
        entry.state === "active"
      )?.candidate_id;
      assert(candidate !== undefined && candidate !== null);
      const template = COMPLETION_FAMILIES.attempt.schema.parse(
        completionFixtures().attempt,
      );
      let expected = "";
      if (scenario === "changed files") {
        await Deno.writeFile(
          join(path, "preserve.bin"),
          new Uint8Array([0, 255, 13, 10]),
        );
        expected = "Preserve authoring changes";
      } else if (scenario === "unknown record") {
        const recordPath = await completionRecordPath(path, template);
        assert(recordPath !== undefined);
        await Deno.mkdir(join(recordPath, ".."), { recursive: true });
        await Deno.writeTextFile(recordPath, '{"version":999}');
        expected = "Unreadable completion state";
      } else if (scenario !== "stale observation") {
        for (
          let index = 0;
          index < (scenario === "competing actors" ? 2 : 1);
          index++
        ) {
          const attemptId = SYSTEM_SECURE_ENTROPY.uuid();
          const actor = {
            ...template.data.identity.executor,
            operation_id: SYSTEM_SECURE_ENTROPY.uuid(),
          };
          const record = {
            ...template,
            id: attemptId,
            data: {
              ...template.data,
              identity: {
                ...template.data.identity,
                id: attemptId,
                candidate_id: candidate,
                sequence: index + 1,
                executor: actor,
              },
              environment_id: id,
              subjects: scenario === "producing attempt"
                ? template.data.subjects
                : [],
              state: scenario === "settlement retry"
                ? {
                  kind: "finished" as const,
                  outcome: "cancelled" as const,
                  finished_at: SYSTEM_CLOCK.wallNow(),
                }
                : {
                  kind: "claimed" as const,
                  claim: {
                    token: SYSTEM_SECURE_ENTROPY.uuid(),
                    executor: actor,
                    acquired_at: SYSTEM_CLOCK.wallNow(),
                    expires_at: SYSTEM_CLOCK.wallNow() + 50_000_000,
                  },
                },
            },
          };
          assertEquals(
            (await writeCompletionRecord(path, record, null)).kind,
            "written",
          );
        }
        if (
          scenario === "unreleased claim" || scenario === "settlement retry"
        ) {
          const current = await requireEnvironment(path, id);
          await replaceEnvironment(path, current, {
            ...current.record.data,
            release: { kind: "held" },
          }, SYSTEM_CLOCK);
        }
        expected = scenario === "producing attempt"
          ? "execution evidence"
          : scenario === "competing actors"
          ? "Another operation"
          : scenario === "unreleased claim"
          ? "no verified release"
          : "";
      }
      const config = await loadConfig(path);
      const before = await requireEnvironment(path, id);
      const priorRecords = await observeCompletionRecords(path);
      if (scenario === "stale observation") {
        await assertRejects(
          () => recoverUnexecutedReservation(path, id, "stale", config, false),
          Error,
          "ownership changed",
        );
      } else {
        const result = await recoverCompletionResult(path, id);
        assertEquals(result.ok, expected === "", JSON.stringify(result));
        if (expected !== "") {
          assertStringIncludes(result.message ?? "", expected);
        }
      }
      if (expected !== "" || scenario === "stale observation") {
        assertEquals((await requireEnvironment(path, id)).stamp, before.stamp);
        assertEquals((await requireQueue(path)).stamp, queue.stamp);
        assertEquals(
          observedRecords(await observeCompletionRecords(path)),
          observedRecords(priorRecords),
        );
        if (scenario === "changed files") {
          assertEquals(
            await Deno.readFile(join(path, "preserve.bin")),
            new Uint8Array([0, 255, 13, 10]),
          );
        }
      } else {
        assertEquals(
          (await requireEnvironment(path, id)).record.data.release.kind,
          "held",
        );
        assert(
          !(await requireQueue(path)).record.data.entries.some((entry) =>
            entry.state === "active"
          ),
        );
        for (
          const record of observedRecords(await observeCompletionRecords(path))
        ) {
          if (record.kind === "attempt") {
            assertEquals(record.data.state.kind, "finished");
          }
        }
      }
    });
  });
}
