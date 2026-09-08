/** Bounded preservation and publication seams exercise bytes rather than nominal file size. */
import { assert, assertEquals, assertRejects } from "@std/assert";
import { dirname, join } from "@std/path";
import { withTempDir } from "./helpers.ts";
import { gitInit } from "./engine_helpers.ts";
import {
  copyRecoveryPayload,
  observeRecoveryPayload,
  recoveryPayloadPath,
  verifyRecoveryPayload,
} from "../src/engine/execution/payloads.ts";
import { snapshotValue } from "../src/engine/execution/snapshot.ts";
import { saveEnvironmentArtifact } from "../src/engine/execution/artifacts.ts";
import { artifactPath } from "../src/engine/execution/artifact_read.ts";
import {
  recoveryStoragePath,
  withRecoveryStorage,
} from "../src/engine/execution/storage_lifetime.ts";
import { currentOperationLocks } from "../src/shared/operation_lock_context.ts";
import { withCompletionPublication } from "../src/engine/operation_lock.ts";
import { environmentFixture } from "./completion_environments_fixture.ts";
import {
  releaseExecutionEnvironment,
  requireEnvironment,
} from "../src/engine/execution/registry.ts";

Deno.test("recovery streams binary bytes once into shared immutable payloads and detects mutation", async () => {
  await withTempDir(async (root) => {
    const bytes = Uint8Array.from(
      { length: 131_073 },
      (_, index) => index % 251,
    );
    const file = join(root, "private.bin");
    await Deno.writeFile(file, bytes);
    await gitInit(root);
    let chunks = 0;
    const reached = Promise.withResolvers<void>();
    const resume = Promise.withResolvers<void>();
    const capturing = observeRecoveryPayload(
      root,
      file,
      bytes.length,
      true,
      async () => {
        chunks++;
        assert(!currentOperationLocks()?.boundaries.has("common"));
        if (chunks === 1) {
          reached.resolve();
          await resume.promise;
        }
      },
    );
    try {
      await Promise.race([reached.promise, capturing]);
      await withCompletionPublication(root, () => Promise.resolve());
      await assertRejects(
        () => withRecoveryStorage(root, () => Promise.resolve(), true),
        Error,
        "Recovery storage is in use",
      );
    } finally {
      resume.resolve();
    }
    const observed = await capturing;
    assertEquals(chunks, 3);
    assertEquals(observed.bytes, bytes.length);
    const firstPath = await verifyRecoveryPayload(root, observed.reference);
    const first = await Deno.stat(firstPath);
    await withRecoveryStorage(root, async () => {
      await verifyRecoveryPayload(`${root}/.`, observed.reference);
    }, true);
    await withRecoveryStorage(root, async () => {
      await assertRejects(
        () => withRecoveryStorage(`${root}/.`, () => Promise.resolve(), true),
        Error,
        "finish capture and reference publication before reclaiming storage",
      );
    });
    const again = await observeRecoveryPayload(root, file, bytes.length, true);
    assertEquals(again, observed);
    assertEquals(
      (await Deno.stat(await recoveryPayloadPath(root, again.reference))).ino,
      first.ino,
    );
    assertEquals(await Deno.readFile(firstPath), bytes);
    // Immutable publication can change inode ctime through link creation or
    // staging unlinking without changing the digest-authorized file bytes.
    const stat = Deno.FsFile.prototype.stat;
    Deno.FsFile.prototype.stat = async function (
      this: Deno.FsFile,
    ): Promise<Deno.FileInfo> {
      const info = await stat.call(this);
      return { ...info, ctime: new Date((info.ctime?.getTime() ?? 0) + 1) };
    };
    try {
      await verifyRecoveryPayload(root, observed.reference);
      await assertRejects(
        () => observeRecoveryPayload(root, file, bytes.length, false),
        Error,
        "changed before capture",
      );
    } finally {
      Deno.FsFile.prototype.stat = stat;
    }
    const restored = join(root, "restored-index");
    await copyRecoveryPayload(root, observed.reference, restored);
    assertEquals(await Deno.readFile(restored), bytes);
    assertEquals(
      await observeRecoveryPayload(root, restored, bytes.length, true),
      observed,
    );
    const stored = await Array.fromAsync(Deno.readDir(dirname(firstPath)));
    assertEquals(stored.length, 1);
    assertEquals((await Deno.stat(firstPath)).size, bytes.length);

    await assertRejects(
      () => observeRecoveryPayload(root, file, bytes.length - 1, true),
      Error,
      "byte limit",
    );
    let changed = false;
    await assertRejects(
      () =>
        observeRecoveryPayload(root, file, bytes.length, true, async () => {
          if (!changed) {
            changed = true;
            await Deno.writeFile(file, bytes.map((value) => value ^ 255));
          }
        }),
      Error,
      "changed during capture",
    );
    assertEquals(await Deno.readFile(firstPath), bytes);
    const write = Deno.FsFile.prototype.write;
    let partialWrite = false;
    Deno.FsFile.prototype.write = async function (
      this: Deno.FsFile,
      data: Uint8Array,
    ): Promise<number> {
      if (partialWrite) throw new Error("injected partial payload write");
      partialWrite = true;
      return await write.call(this, data.subarray(0, 3));
    };
    try {
      await assertRejects(
        () => observeRecoveryPayload(root, file, bytes.length, true),
        Error,
        "injected partial payload write",
      );
    } finally {
      Deno.FsFile.prototype.write = write;
    }
    assertEquals(partialWrite, true);
    assertEquals(await Deno.readFile(firstPath), bytes);
    assertEquals(
      await Array.fromAsync(
        Deno.readDir(await recoveryStoragePath(root, "staging")),
      ),
      [],
    );
    assertEquals(
      await Array.fromAsync(Deno.readDir(dirname(firstPath))),
      stored,
    );
    const subject = {
      attempt_id: "11111111-1111-4111-8111-111111111111",
      candidate_id: "22222222-2222-4222-8222-222222222222",
      context: "local",
    };
    const retained = await saveEnvironmentArtifact(
      root,
      subject,
      "retry",
      true,
    );
    await assertRejects(
      () =>
        saveEnvironmentArtifact(root, subject, "retry", true, () => {
          throw new Error("injected stale ownership on retry");
        }),
      Error,
      "injected stale ownership on retry",
    );
    assertEquals(
      await Deno.readTextFile(
        await artifactPath(root, retained.attempt_id, retained.path),
      ),
      "true",
    );
    await assertRejects(
      () =>
        saveEnvironmentArtifact(root, subject, "interrupted", {
          retained: true,
        }, () => {
          throw new Error("injected publication interruption");
        }),
      Error,
      "injected publication interruption",
    );
    const unpublished = await artifactPath(
      root,
      subject.attempt_id,
      "environment/interrupted.json",
    );
    await assertRejects(() => Deno.stat(unpublished), Deno.errors.NotFound);
    const staging = await artifactPath(root, subject.attempt_id, "staging");
    assertEquals(await Array.fromAsync(Deno.readDir(staging)), []);
    const oversized = Array.from({ length: 12_000 }, () => "x".repeat(1000));
    for (
      const encode of [
        () => saveEnvironmentArtifact(root, subject, "oversized", oversized),
        () => snapshotValue(oversized),
      ]
    ) {
      await assertRejects(encode, Error, "bounded document format");
    }
    await Deno.writeFile(firstPath, new Uint8Array(bytes.length));
    await assertRejects(
      () => verifyRecoveryPayload(root, observed.reference),
      Error,
      "content check",
    );
  });
});

Deno.test("slow release observation holds checkout exclusion while short publications remain available", async () => {
  await withTempDir(async (root) => {
    const fixture = await environmentFixture(root, "undeclared");
    const current = await requireEnvironment(fixture.root, fixture.id);
    let observed = false;
    const workspace = new Proxy(fixture.workspace, {
      get: (target, key, receiver): unknown =>
        key === "inspect"
          ? async (...args: Parameters<typeof target.inspect>) => {
            assert(currentOperationLocks()?.boundaries.has("checkout"));
            assert(!currentOperationLocks()?.boundaries.has("common"));
            await withCompletionPublication(
              fixture.root,
              () => Promise.resolve(),
            );
            observed = true;
            return await target.inspect(...args);
          }
          : Reflect.get(target, key, receiver),
    });
    await releaseExecutionEnvironment(
      fixture.root,
      fixture.id,
      current.stamp,
      fixture.actor,
      fixture.declaration,
      { lifetime: fixture.lifetime, workspace },
    );
    assert(observed);
  });
});

Deno.test("source admission excludes actual shared resources without occupying temporary execution capacity", async () => {
  const { observeClaimCapacity } = await import(
    "../src/engine/execution/registry.ts"
  );
  await withTempDir(async (root) => {
    const fixture = await environmentFixture(root, "undeclared");
    const execution = await fixture.claim(
      fixture.plan({
        ...fixture.candidate,
        head: fixture.source.head,
        tree: fixture.source.tree,
      }),
    );
    assert(execution.environment.ownership.kind === "borrowed");
    const peer = {
      ...execution.environment,
      path: fixture.root,
      ownership: {
        ...execution.environment.ownership,
        identity: {
          ...execution.environment.ownership.identity,
          resources: { schema: "a-distinct-owned-handle" },
        },
      },
    };
    assertEquals(
      await observeClaimCapacity(fixture.root, peer, 1, fixture.clock),
      null,
    );
    assertEquals(
      (await observeClaimCapacity(
        fixture.root,
        { ...peer, ownership: execution.environment.ownership },
        1,
        fixture.clock,
      ))?.kind,
      "waiting-for-operation",
    );
    await fixture.executor.execute(execution, () => Promise.resolve(true));
  });
});
