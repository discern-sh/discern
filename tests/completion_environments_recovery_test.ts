import {
  assert,
  assertEquals,
  assertRejects,
  assertStringIncludes,
} from "@std/assert";
import { join } from "@std/path";
import { withTempDir } from "./helpers.ts";
import { gitOut } from "./engine_helpers.ts";
import { environmentFixture } from "./completion_environments_fixture.ts";
import { createEnvironmentExecutor } from "../src/engine/execution/executor.ts";
import { requireEnvironment } from "../src/engine/execution/registry.ts";
import {
  completionRecordPath,
  readCompletionRecord,
} from "../src/engine/completion/store.ts";
import { EnvironmentSchema } from "../src/engine/completion/environment.ts";
import { completionId } from "./completion_fixtures.ts";
import { ON_DISK_FORMATS } from "../src/shared/on_disk_formats.ts";

// The canonical phase enum enrolls every later durable phase in this exercise.
const phases = EnvironmentSchema.shape.state.options.flatMap((option) =>
  "phase" in option.shape ? option.shape.phase.options : []
);
for (const phase of phases) {
  Deno.test(`V07 interrupted ${phase} retains provenance and refuses active children before replacement recovery`, async () => {
    await withTempDir(async (base) => {
      const isolated = phase === "reset" || phase === "dispose";
      const f = await environmentFixture(
        base,
        isolated ? "isolated" : "borrowed",
        phase !== "dispose",
      );
      let hit = false;
      const executor = createEnvironmentExecutor({
        ...f.options,
        afterPhase: (current) => {
          if (current === phase) {
            hit = true;
            f.lifetime.children = true;
            throw new Error(`interruption at durable ${phase}`);
          }
          return Promise.resolve();
        },
      });
      const execution = await f.claim(f.plan(), executor);
      const stopped = await executor.execute(
        execution,
        () => Promise.resolve(true),
      );
      assert(hit);
      assertEquals(stopped.returned.kind, "recovery-incomplete");
      const recovery = await requireEnvironment(f.root, f.id);
      assertEquals(recovery.record.data.state.kind, "recovery");
      const replacement = createEnvironmentExecutor(f.options);
      const blocked = await replacement.recover(f.id, recovery.stamp, {
        ...f.actor,
        operation_id: completionId(90),
      });
      assertEquals(blocked.kind, "recovery-incomplete");
      f.lifetime.children = false;
      const next = await requireEnvironment(f.root, f.id);
      const returned = await replacement.recover(f.id, next.stamp, {
        ...f.actor,
        operation_id: completionId(91),
      });
      assertEquals(
        returned.kind,
        phase === "dispose" ? "disposed" : isolated ? "reset" : "restored",
        JSON.stringify(returned),
      );
      if (!isolated) {
        assertEquals(
          await gitOut(f.path, "symbolic-ref", "HEAD"),
          f.source.branch,
        );
      }
      const settled = await requireEnvironment(f.root, f.id);
      const repeated = await replacement.recover(f.id, settled.stamp, f.actor);
      assertEquals(repeated.kind, returned.kind);
      assertEquals(
        (await requireEnvironment(f.root, f.id)).stamp,
        settled.stamp,
      );
    });
  });
}

Deno.test("V06 required preparation failure restores source and records failed validation without invoking its producer", async () => {
  await withTempDir(async (base) => {
    const f = await environmentFixture(base, "borrowed", true, {
      prepare: "exit 7",
    });
    const execution = await f.claim();
    let ran = false;
    const result = await f.executor.execute(execution, () => {
      ran = true;
      return Promise.resolve(true);
    });
    assertEquals(ran, false);
    assertEquals(result.validation, null);
    assertEquals(result.returned.kind, "restored", JSON.stringify(result));
    assertEquals(await Deno.readTextFile(f.resourcePath), "1\n");
    const record = await readCompletionRecord(f.root, {
      kind: "attempt",
      id: execution.fence.attempt_id,
    });
    assert(
      record.kind === "recorded" && record.record.kind === "attempt" &&
        record.record.data.state.kind === "finished",
    );
    assertEquals(record.record.data.state.outcome, "failed");
  });
});

for (const operation of ["restore", "reset", "dispose"] as const) {
  Deno.test(`V06 failed ${operation} stays unavailable and resumes the frozen command after repair`, async () => {
    await withTempDir(async (base) => {
      const marker = join(await Deno.realPath(base), "repaired");
      const resource = `'${
        join(await Deno.realPath(base), "resources")
      }'/"$DISCERN_RESOURCE_SCHEMA"`;
      const effect = operation === "restore"
        ? `cat schema > ${resource}`
        : operation === "reset"
        ? `printf '0\\n' > ${resource}`
        : `rm -f ${resource}`;
      const command = `test -f '${marker}' && ${effect}`;
      const f = await environmentFixture(
        base,
        operation === "restore" ? "borrowed" : "isolated",
        operation !== "dispose",
        { [operation]: command },
      );
      const execution = await f.claim();
      const result = await f.executor.execute(
        execution,
        () => Promise.resolve(true),
      );
      assertEquals(result.returned.kind, "recovery-incomplete");
      if (result.returned.kind === "recovery-incomplete") {
        assertEquals(result.returned.recovery.phase, operation);
        assertStringIncludes(result.returned.recovery.reason, command);
        assertEquals(result.returned.recovery.drift.kind, "captured");
      }
      await assertRejects(() => f.claim(), Error, "recovery-incomplete");
      await Deno.writeTextFile(marker, "repair verified");
      const current = await requireEnvironment(f.root, f.id);
      const restored = await createEnvironmentExecutor(f.options).recover(
        f.id,
        current.stamp,
        { ...f.actor, operation_id: completionId(98) },
      );
      assertEquals(
        restored.kind,
        operation === "dispose"
          ? "disposed"
          : operation === "reset"
          ? "reset"
          : "restored",
        JSON.stringify(restored),
      );
    });
  });
}

Deno.test("V07 cancellation and claim expiry restore source, and newer environment bytes are never overwritten", async () => {
  await withTempDir(async (base) => {
    const f = await environmentFixture(base);
    const controller = new AbortController();
    const executor = createEnvironmentExecutor({
      ...f.options,
      signal: controller.signal,
    });
    const execution = await f.claim(f.plan(), executor);
    const result = await executor.execute(execution, () => {
      controller.abort();
      return Promise.resolve(true);
    });
    assertEquals(result.returned.kind, "restored");
    const attempt = await readCompletionRecord(f.root, {
      kind: "attempt",
      id: execution.fence.attempt_id,
    });
    assert(
      attempt.kind === "recorded" && attempt.record.kind === "attempt" &&
        attempt.record.data.state.kind === "finished",
    );
    assertEquals(attempt.record.data.state.outcome, "cancelled");
    await f.release();
    const claimed = await f.claim();
    const live = await requireEnvironment(f.root, f.id);
    const active = await f.executor.recover(f.id, live.stamp, f.actor);
    assertEquals(active.kind, "recovery-incomplete");
    const expired = createEnvironmentExecutor({
      ...f.options,
      clock: { wallNow: () => 100000, monotonicNow: () => 20 },
    });
    const expiredPlan = expired.plan({
      trunk: "main",
      observed_at: 100000,
      records: [{
        selector: { kind: "environment", id: f.id },
        reading: await expired.observe(f.id),
      }],
    }, f.plan());
    assert("kind" in expiredPlan && expiredPlan.kind === "recovery-incomplete");
    const returned = await expired.recover(f.id, live.stamp, f.actor);
    assertEquals(returned.kind, "restored", JSON.stringify(returned));
    const recordPath = await completionRecordPath(f.root, {
      kind: "environment",
      id: f.id,
    });
    assert(recordPath !== undefined);
    const newer = JSON.stringify({
      version: ON_DISK_FORMATS.completionRecord.version + 1,
      preserve: "replacement session",
    });
    await Deno.writeTextFile(recordPath, newer);
    assertEquals((await f.executor.observe(f.id)).kind, "newer");
    assertEquals(
      (await f.executor.recover(f.id, live.stamp, f.actor)).kind,
      "recovery-incomplete",
    );
    const refused = await f.executor.execute(
      claimed,
      () => Promise.resolve(true),
    );
    assertEquals(refused.returned.kind, "recovery-incomplete");
    assertEquals(await Deno.readTextFile(recordPath), newer);
  });
});

Deno.test("V04 a forged candidate and writes after claim cannot enter validation or be removed", async () => {
  await withTempDir(async (base) => {
    const f = await environmentFixture(base);
    const execution = await f.claim();
    const forged = await f.executor.execute({
      ...execution,
      candidate: {
        ...execution.candidate,
        head: f.source.head,
        tree: f.source.tree,
      },
    }, () => Promise.resolve(true));
    assertEquals(forged.returned.kind, "recovery-incomplete");
    assertEquals(await gitOut(f.path, "rev-parse", "HEAD"), f.source.head);
    await Deno.writeTextFile(join(f.path, "unfamiliar"), "created after claim");
    let validated = false;
    const result = await f.executor.execute(execution, () => {
      validated = true;
      return Promise.resolve(true);
    });
    assertEquals(validated, false);
    assertEquals(result.returned.kind, "recovery-incomplete");
    assertEquals(
      await Deno.readTextFile(join(f.path, "unfamiliar")),
      "created after claim",
    );
  });
});
