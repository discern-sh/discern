/** Logical lock release does not wait for the last native descriptor reference. */
import { assertEquals } from "@std/assert";
import { join } from "@std/path";
import { FileLock } from "../src/shared/file_lock.ts";
import { withTempDir } from "./temp_dir.ts";

Deno.test("file locks preserve exclusion and record bytes through idempotent release", async () => {
  await withTempDir(async (dir) => {
    const path = join(dir, "lock");
    const options = { create: true, read: true, write: true };
    using owner = await FileLock.open(path, options);
    await owner.acquire();
    using contender = await FileLock.open(path, options);
    assertEquals(await contender.tryAcquire(), false);
    contender.close();
    using next = await FileLock.open(path, options);
    assertEquals(
      await next.tryAcquire(),
      false,
      "a refused contender releases no owner's lock",
    );
    await owner.io.write(new TextEncoder().encode("record\n"));
    owner.close();
    owner.close();
    assertEquals(await next.tryAcquire(), true);
    assertEquals(await Deno.readTextFile(path), "record\n");
  });
});

Deno.test({
  name:
    "file lock release excludes a pending native read from the ownership lifetime",
  // Linux supports advisory locks on FIFOs; macOS refuses that inode type.
  ignore: Deno.build.os !== "linux",
  async fn(): Promise<void> {
    await withTempDir(async (dir) => {
      const path = join(dir, "fifo");
      const made = await new Deno.Command("mkfifo", { args: [path] }).output();
      assertEquals(made.success, true, new TextDecoder().decode(made.stderr));
      using owner = await FileLock.open(path, { read: true, write: true });
      using contender = await FileLock.open(path, { read: true, write: true });
      await owner.acquire();
      const pending = owner.io.read(new Uint8Array(1)).catch(
        (error: unknown) => {
          if (!(error instanceof Deno.errors.Interrupted)) throw error;
          return null;
        },
      );
      try {
        owner.close();
        assertEquals(await contender.tryAcquire(), true);
      } finally {
        // Release the blocked native read even when the ownership assertion fails.
        await contender.io.write(new Uint8Array([1]));
        await pending;
      }
    });
  },
});
