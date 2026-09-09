/** Graph invalidation is visible to live planners without a durability barrier. */
import { assertEquals, assertNotEquals, assertRejects } from "@std/assert";
import { join } from "@std/path";
import { completionId } from "./completion_producers_fixtures.ts";
import { withRecordedExecutionChildren } from "../src/engine/execution/lifetime.ts";
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

Deno.test("publication tokens change atomically without flushing recovery-independent markers", async () => {
  await withTempDir(async (root) => {
    const path = join(root, "publication.json");
    assertEquals(await readCompletionPublication(path), null);
    const original = Deno.FsFile.prototype.sync;
    let syncs = 0;
    Deno.FsFile.prototype.sync = function (): Promise<void> {
      syncs++;
      return original.call(this);
    };
    try {
      await invalidateCompletionPublication(path);
      const first = await readCompletionPublication(path);
      assertNotEquals(first, null);
      await invalidateCompletionPublication(path);
      assertNotEquals(await readCompletionPublication(path), first);
      assertEquals(
        syncs,
        0,
        "Live graph invalidation must not fsync per publication",
      );
    } finally {
      Deno.FsFile.prototype.sync = original;
    }
    for (const raw of ["", "{}", '{"version":999,"token":"future"}']) {
      await Deno.writeTextFile(path, raw);
      await assertRejects(() => readCompletionPublication(path));
      await assertRejects(() => invalidateCompletionPublication(path));
      assertEquals(await Deno.readTextFile(path), raw);
    }
  });
});

Deno.test("child receipt durability never weakens recovery artifact durability", async () => {
  await withTempDir(async (root) => {
    await Deno.writeTextFile(
      join(root, "discern.toml"),
      "[project]\nslug = 'receipt-fixture'\n",
    );
    await gitInit(root);
    const subject = {
      attempt_id: completionId(700),
      candidate_id: completionId(701),
      context: "local",
    };
    const original = Deno.FsFile.prototype.sync;
    let syncs = 0;
    Deno.FsFile.prototype.sync = function (): Promise<void> {
      syncs++;
      return original.call(this);
    };
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
          syncs,
          0,
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
        syncs,
        0,
        "Native enrollment must use the lifecycle publication boundary",
      );
      await saveEnvironmentArtifact(root, subject, "future-recovery-kind", {
        required: "bytes",
      });
      assertEquals(
        syncs,
        1,
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
      Deno.FsFile.prototype.sync = original;
    }
  });
});
