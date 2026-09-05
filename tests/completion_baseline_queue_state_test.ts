/** Recovery and owner actions preserve queue capacity and exact source authority. */
import { assert, assertEquals } from "@std/assert";
import { RecoverySchema } from "../src/engine/completion/environment.ts";
import { join } from "@std/path";
import { withTempDir } from "./helpers.ts";
import { gitInit, gitOut } from "./engine_helpers.ts";
import {
  COMPLETION_CLOCK,
  COMPLETION_RECOVERY,
  completionFixtures,
  completionId,
} from "./completion_fixtures.ts";
import { COMPLETION_FAMILIES } from "../src/engine/completion/records.ts";
import {
  readCompletionRecord,
  writeCompletionRecord,
} from "../src/engine/completion/store.ts";
import {
  initializeQueue,
  replaceQueue,
  requireQueue,
} from "../src/engine/landing_queue/repository.ts";
import { reconcileQueueWork } from "../src/engine/landing_queue/recovery.ts";
import { mutateQueue } from "../src/engine/landing_queue/mutations.ts";
import { queueExample } from "./completion_queue_fixture.ts";

const EXPIRED = { ...COMPLETION_CLOCK, wallNow: (): number => 300 };

Deno.test("completion baseline: queue recovery requires a returned environment, not an expired actor", async () => {
  for (
    const state of ["live", "missing", "executing", "recovery", "idle"] as const
  ) {
    await withTempDir(async (root) => {
      await Deno.writeTextFile(
        join(root, "discern.toml"),
        '[project]\nslug="queue-recovery"\n',
      );
      await gitInit(root);
      const trunk = await gitOut(root, "rev-parse", "HEAD");
      await initializeQueue(root, trunk);
      const fixtures = completionFixtures();
      const queue = COMPLETION_FAMILIES.queue.schema.parse(fixtures.queue).data;
      const entry = queue.entries[0];
      assert(entry !== undefined);
      await replaceQueue(root, await requireQueue(root), {
        ...queue,
        trunk,
        entries: [{ ...entry, state: "active" }],
      }, COMPLETION_CLOCK);
      const attempt = COMPLETION_FAMILIES.attempt.schema.parse(
        fixtures.attempt,
      );
      assert(attempt.data.state.kind === "claimed");
      assertEquals(
        (await writeCompletionRecord(
          root,
          attempt,
          null,
          undefined,
          COMPLETION_CLOCK,
        )).kind,
        "written",
      );
      const environment = COMPLETION_FAMILIES.environment.schema.parse(
        fixtures.environment,
      );
      if (state !== "missing" && state !== "live") {
        environment.data = {
          ...environment.data,
          state: state === "idle" ? { kind: "idle" } : state === "recovery"
            ? {
              kind: "recovery",
              attempt_id: attempt.id,
              recovery: RecoverySchema.parse(COMPLETION_RECOVERY),
            }
            : {
              kind: "executing",
              attempt_id: attempt.id,
              candidate_id: attempt.data.identity.candidate_id,
              release_id: completionId(22),
              claim: attempt.data.state.claim,
              phase: "validate",
            },
        };
        assertEquals(
          (await writeCompletionRecord(
            root,
            environment,
            null,
            undefined,
            COMPLETION_CLOCK,
          )).kind,
          "written",
        );
      }
      const before = await requireQueue(root);
      const result = await reconcileQueueWork({
        root,
        trunk: "main",
        effort: entry.source.effort_id,
        expected_stamp: before.stamp,
        clock: state === "live" ? COMPLETION_CLOCK : EXPIRED,
      });
      const expected = state === "live"
        ? "waiting-for-operation"
        : state === "recovery"
        ? "recovery-incomplete"
        : state === "idle"
        ? "released"
        : "environment-unavailable";
      assertEquals(result.kind, expected, state);
      const after = await requireQueue(root);
      if (state === "idle") {
        assertEquals(after.record.data.entries[0]?.state, "eligible");
        const returned = await readCompletionRecord(root, attempt);
        assert(
          returned.kind === "recorded" && returned.record.kind === "attempt",
        );
        assertEquals(returned.record.data.state, {
          kind: "finished",
          outcome: "cancelled",
          finished_at: 300,
        });
        assertEquals(
          (await reconcileQueueWork({
            root,
            trunk: "main",
            effort: entry.source.effort_id,
            expected_stamp: after.stamp,
            clock: EXPIRED,
          })).kind,
          "replan",
        );
      } else {
        assertEquals(
          after.stamp,
          before.stamp,
          "blocked recovery must retain capacity",
        );
      }
    });
  }
});

Deno.test("completion baseline: queue approvals require recorded matching sources and invalidation follows owner actions", async () => {
  await withTempDir(async (root) => {
    await Deno.writeTextFile(
      join(root, "discern.toml"),
      '[project]\nslug="queue-actions"\n',
    );
    await gitInit(root);
    const trunk = await gitOut(root, "rev-parse", "HEAD");
    await initializeQueue(root, trunk);
    const { queue } = queueExample(2);
    await replaceQueue(
      root,
      await requireQueue(root),
      { ...queue, trunk },
      COMPLETION_CLOCK,
    );
    const first = queue.entries[0];
    assert(first !== undefined);
    const authority = COMPLETION_FAMILIES.authority.schema.parse(
      completionFixtures().authority,
    );
    const approvals = new Map([[first.source.effort_id, authority.id]]);
    const act = async (
      mutation: Parameters<typeof mutateQueue>[0]["mutation"],
    ): Promise<Awaited<ReturnType<typeof mutateQueue>>> =>
      await mutateQueue({
        root,
        trunk: "main",
        expected_stamp: (await requireQueue(root)).stamp,
        mutation,
        clock: COMPLETION_CLOCK,
      });
    const approval = {
      kind: "approve",
      batch: completionId(30),
      approvals,
    } as const;
    assertEquals((await act(approval)).kind, "missing-authority");
    authority.data = { ...authority.data, sources: [first.source] };
    assertEquals(
      (await writeCompletionRecord(
        root,
        authority,
        null,
        undefined,
        COMPLETION_CLOCK,
      )).kind,
      "written",
    );
    assertEquals((await act(approval)).kind, "changed");
    assertEquals(
      (await requireQueue(root)).record.data.entries[0]?.authority_id,
      authority.id,
    );
    const replacement = { ...first.source, head: "e".repeat(40) };
    assertEquals(
      (await act({ kind: "select", source: replacement, dependencies: [] }))
        .kind,
      "stale-evidence",
    );
    assertEquals(
      (await act({
        kind: "source-replaced",
        source: replacement,
        dependencies: [],
      })).kind,
      "changed",
    );
    const replaced = (await requireQueue(root)).record.data.entries[0];
    assertEquals(replaced?.source, replacement);
    assertEquals(replaced?.authority_id, null);
    for (const kind of ["policy-changed", "judgment-changed"] as const) {
      assertEquals(
        (await act({ kind, effort: first.source.effort_id })).kind,
        "changed",
      );
      assertEquals(
        (await requireQueue(root)).record.data.entries[0]?.invalidation,
        kind,
      );
    }
    assertEquals((await act({ kind: "trunk-moved" })).kind, "changed");
    assertEquals((await requireQueue(root)).record.data.trunk, trunk);
    const before = await requireQueue(root);
    assertEquals(
      (await mutateQueue({
        root,
        trunk: "main",
        expected_stamp: "stale",
        mutation: approval,
        clock: COMPLETION_CLOCK,
      })).kind,
      "replan",
    );
    assertEquals((await requireQueue(root)).stamp, before.stamp);
  });
});
