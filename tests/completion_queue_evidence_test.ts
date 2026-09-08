/** Real producers pause while a separate actor changes the queue or lands trunk. */
import { assert, assertEquals } from "@std/assert";
import { withTempDir } from "./helpers.ts";
import { project } from "./completion_public_fixture.ts";
import { shellBarrier } from "./shell_barrier.ts";
import { git } from "./engine_helpers.ts";
import { loadConfig } from "../src/shared/config_schema.ts";
import { withPublicCompletion } from "../src/engine/landing_queue/public_completion.ts";
import { executePublicValidation } from "../src/engine/validation/public_run.ts";
import { configuredValidation } from "../src/engine/validation/configuration.ts";
import {
  observedRecords,
  requireQueue,
} from "../src/engine/landing_queue/repository.ts";
import { mutateQueue } from "../src/engine/landing_queue/mutations.ts";
import { observeCompletionRecords } from "../src/engine/validation/runtime.ts";
import { SYSTEM_CLOCK } from "../src/shared/clock.ts";

for (const movement of ["unrelated", "trunk", "revoked"] as const) {
  for (const failed of [false, true]) {
    Deno.test(`producer truth survives ${movement} during validation, failed=${failed}`, async () => {
      await withTempDir(async (root) =>
        await withTempDir(async (aux) => {
          using barrier = await shellBarrier(`${aux}/producer`);
          const path = await project(
            root,
            ["local"],
            "",
            `${barrier.wait}; ${
              failed ? "exit 1" : "printf 'DISCERN_METRIC coverage 93\\n'"
            }`,
            ["source"],
          );
          const config = await loadConfig(path);
          const graph = await configuredValidation(config, []);
          const started = Promise.withResolvers<void>();
          const running = withPublicCompletion(path, {
            context: "local",
            mode: "strict",
            retainCheckout: true,
          }, async (session) => {
            const validation = await executePublicValidation({
              root: path,
              config,
              scopes: [],
              claimed: session.execution,
              demand: {
                kind: "done",
                context: "local",
                mode: "strict",
                requirements: graph.obligations.map((o) => o.requirement),
              },
              bindComposition: true,
              onProgress: (fact) => {
                if (fact.state === "running") started.resolve();
              },
            });
            return {
              value: true,
              passed: validation.outcome.blockers.length === 0,
              validation,
            };
          });
          try {
            await Promise.race([
              started.promise,
              running.then((result) => {
                throw new Error(
                  `No producer started: ${JSON.stringify(result)}`,
                );
              }),
            ]);
            const before = observedRecords(
              await observeCompletionRecords(path),
            );
            const producer = before.find((r) =>
              r.kind === "attempt" && r.data.subjects.length > 0
            );
            assert(
              producer?.kind === "attempt" &&
                producer.data.state.kind === "claimed",
            );
            assert(
              producer.data.state.claim.expires_at > SYSTEM_CLOCK.wallNow(),
            );
            const queue = await requireQueue(path);
            const source = queue.record.data.entries[0]?.source;
            assert(source !== undefined);
            if (movement === "trunk") {
              await Deno.writeTextFile(`${root}/sibling`, "landed sibling\n");
              await git(root, "add", "sibling");
              await git(
                root,
                "commit",
                "-m",
                "Land sibling while producer waits",
              );
            }
            const changed = await mutateQueue({
              root: path,
              trunk: "main",
              expected_stamp: queue.stamp,
              mutation: movement === "trunk"
                ? { kind: "trunk-moved" }
                : movement === "revoked"
                ? { kind: "authority-revoked", effort: source.effort_id }
                : {
                  kind: "select",
                  source: {
                    ...source,
                    effort_id: "unrelated",
                    branch: "refs/heads/unrelated",
                  },
                  dependencies: [],
                },
            });
            assertEquals(changed.kind, "changed");
            await barrier.release();
            const result = await running;
            const after = observedRecords(await observeCompletionRecords(path));
            const receipts = after.filter((r) =>
              r.kind === "evidence" && r.data.attempt_id === producer.id
            );
            assertEquals(
              receipts.length,
              graph.obligations.length,
              JSON.stringify(result),
            );
            assert(
              receipts.every((r) =>
                r.kind === "evidence" &&
                r.data.outcome.kind === (failed ? "failed" : "passed")
              ),
              JSON.stringify(receipts),
            );
            const settled = after.find((r) => r.id === producer.id);
            assert(
              settled?.kind === "attempt" &&
                settled.data.state.kind === "finished",
              JSON.stringify(result),
            );
            assertEquals(
              settled.data.state.outcome,
              failed ? "failed" : "passed",
            );
            if (movement !== "unrelated") {
              assertEquals(after.filter((r) => r.kind === "proof").length, 0);
              assertEquals(
                (await requireQueue(path)).record.data.entries[0]?.state ===
                  "failed",
                false,
              );
            }
          } finally {
            await barrier.release();
            await running;
          }
        })
      );
    });
  }
}
