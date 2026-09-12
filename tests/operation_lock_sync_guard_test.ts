/** Operation-lock exclusion comes from the OS lock on the open handle; the
 * inert lease record must never buy a filesystem flush. */
import { assertEquals } from "@std/assert";
import { join } from "@std/path";
import { withCompletionPublication } from "../src/engine/operation_lock.ts";
import { gitInit } from "./engine_helpers.ts";
import { withTempDir } from "./helpers.ts";

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

/** A minimal project whose common Git administration can hold operation locks. */
async function lockFixture(root: string, slug: string): Promise<void> {
  await Deno.writeTextFile(
    join(root, "discern.toml"),
    `[project]\nslug = '${slug}'\n`,
  );
  await gitInit(root);
}

Deno.test("operation lock acquisition and release flush nothing", async () => {
  await withTempDir(async (root) => {
    await lockFixture(root, "lock-fixture");
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
