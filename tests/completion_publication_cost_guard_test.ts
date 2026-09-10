/** Publication paths that only need atomic visibility flush nothing to disk. */
import { assertEquals, assertNotEquals, assertRejects } from "@std/assert";
import { join } from "@std/path";
import { completionId } from "./completion_producers_fixtures.ts";
import { withRecordedExecutionChildren } from "../src/engine/execution/lifetime.ts";
import { withCompletionPublication } from "../src/engine/operation_lock.ts";
import { runGit } from "../src/shared/subprocess.ts";
import { gitInit } from "./engine_helpers.ts";
import {
  saveEnvironmentArtifact,
  saveExecutionChildReceipt,
} from "../src/engine/execution/artifacts.ts";
import { withTempDir } from "./helpers.ts";
import {
  invalidateCompletionPublication,
  readCompletionPublication,
} from "../src/engine/completion/publication_witness.ts";

/** One count per flush entry point, so a new barrier cannot hide behind another. */
interface FileSyncCounts {
  sync: number;
  syncData: number;
  syncSync: number;
  syncDataSync: number;
}

const NO_FLUSH: FileSyncCounts = {
  sync: 0,
  syncData: 0,
  syncSync: 0,
  syncDataSync: 0,
};

/** Count every file flush until `restore` runs; each wrapper still performs the flush. */
function countFileSyncs(): {
  counts: FileSyncCounts;
  restore: () => void;
} {
  const proto = Deno.FsFile.prototype;
  const original = {
    sync: proto.sync,
    syncData: proto.syncData,
    syncSync: proto.syncSync,
    syncDataSync: proto.syncDataSync,
  };
  const counts: FileSyncCounts = { ...NO_FLUSH };
  proto.sync = function (this: Deno.FsFile): Promise<void> {
    counts.sync++;
    return original.sync.call(this);
  };
  proto.syncData = function (this: Deno.FsFile): Promise<void> {
    counts.syncData++;
    return original.syncData.call(this);
  };
  proto.syncSync = function (this: Deno.FsFile): void {
    counts.syncSync++;
    original.syncSync.call(this);
  };
  proto.syncDataSync = function (this: Deno.FsFile): void {
    counts.syncDataSync++;
    original.syncDataSync.call(this);
  };
  return {
    counts,
    restore: (): void => {
      proto.sync = original.sync;
      proto.syncData = original.syncData;
      proto.syncSync = original.syncSync;
      proto.syncDataSync = original.syncDataSync;
    },
  };
}

/** A minimal project whose common Git administration can hold locks and receipts. */
async function receiptFixture(root: string, slug: string): Promise<void> {
  await Deno.writeTextFile(
    join(root, "discern.toml"),
    `[project]\nslug = '${slug}'\n`,
  );
  await gitInit(root);
}

Deno.test("publication tokens change atomically without flushing recovery-independent markers", async () => {
  await withTempDir(async (root) => {
    const path = join(root, "publication.json");
    assertEquals(await readCompletionPublication(path), null);
    const syncs = countFileSyncs();
    try {
      await invalidateCompletionPublication(path);
      const first = await readCompletionPublication(path);
      assertNotEquals(first, null);
      await invalidateCompletionPublication(path);
      assertNotEquals(await readCompletionPublication(path), first);
      assertEquals(
        syncs.counts,
        NO_FLUSH,
        "Live graph invalidation must not flush per publication",
      );
    } finally {
      syncs.restore();
    }
    for (const raw of ["", "{}", '{"version":999,"token":"future"}']) {
      await Deno.writeTextFile(path, raw);
      await assertRejects(() => readCompletionPublication(path));
      await assertRejects(() => invalidateCompletionPublication(path));
      assertEquals(await Deno.readTextFile(path), raw);
    }
  });
});

Deno.test("operation lock acquisition and release flush nothing", async () => {
  await withTempDir(async (root) => {
    await receiptFixture(root, "lock-fixture");
    const syncs = countFileSyncs();
    try {
      for (let round = 0; round < 3; round++) {
        await withCompletionPublication(root, () => Promise.resolve());
        assertEquals(
          syncs.counts,
          NO_FLUSH,
          `Lock round ${round}: the lease record is inert; only the OS lock on the open handle establishes exclusion`,
        );
      }
    } finally {
      syncs.restore();
    }
  });
});

Deno.test("child receipt durability never weakens recovery artifact durability", async () => {
  await withTempDir(async (root) => {
    await receiptFixture(root, "receipt-fixture");
    const subject = {
      attempt_id: completionId(700),
      candidate_id: completionId(701),
      context: "local",
    };
    const syncs = countFileSyncs();
    try {
      for (
        const receipt of [
          { kind: "enrolled", key: completionId(702) },
          { kind: "planned", key: completionId(703), token: completionId(702) },
          { kind: "started", key: completionId(703), pid: 123, isolated: true },
          { kind: "settled", key: completionId(703) },
        ] as const
      ) {
        await saveExecutionChildReceipt(root, subject, receipt);
        assertEquals(
          syncs.counts,
          NO_FLUSH,
          `Child ${receipt.kind} only needs atomic visibility`,
        );
      }
      const child = await withRecordedExecutionChildren(
        root,
        subject,
        completionId(704),
        () =>
          runGit(["status", "--porcelain"], {
            cwd: root,
            quiesceDescendants: true,
          }),
      );
      assertEquals(child.code, 0);
      assertEquals(
        syncs.counts,
        NO_FLUSH,
        "Native enrollment must use the lifecycle publication boundary",
      );
      await saveEnvironmentArtifact(root, subject, "future-recovery-kind", {
        required: "bytes",
      });
      assertEquals(
        syncs.counts,
        { ...NO_FLUSH, sync: 1 },
        "Every general recovery publication must still sync its data",
      );
      await assertRejects(
        () =>
          saveExecutionChildReceipt(root, subject, {
            kind: "started",
            key: completionId(703),
            pid: 456,
            isolated: true,
          }),
        Error,
        "different bytes",
      );
      await assertRejects(() =>
        saveExecutionChildReceipt(root, subject, {
          kind: "settled",
          key: "../../outside",
        })
      );
    } finally {
      syncs.restore();
    }
  });
});
