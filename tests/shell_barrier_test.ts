/** Kernel acknowledgements hold transient fixture states independently of time. */
import { assertEquals } from "@std/assert";
import { join } from "@std/path";
import { targetExists } from "../src/shared/fs_presence.ts";
import { shellBarrier } from "./shell_barrier.ts";
import { withTempDir } from "./temp_dir.ts";
import { waitForPendingCondition } from "./waiting.ts";

Deno.test({
  name:
    "shell barriers hold every phase until its observed-state acknowledgement",
  ignore: Deno.build.os === "windows",
  fn: async () => {
    await withTempDir(async (dir) => {
      using barrier = await shellBarrier(join(dir, "phases.fifo"));
      const child = new Deno.Command("sh", {
        args: [
          "-c",
          `touch first; ${barrier.wait}; touch second; ${barrier.wait}; touch finished; exit 7`,
        ],
        cwd: dir,
        stdin: "null",
        stdout: "null",
        stderr: "null",
      }).spawn();
      const pending = child.status;
      try {
        await waitForPendingCondition(
          pending,
          () => targetExists(join(dir, "first")),
          "first held phase",
        );
        assertEquals(await targetExists(join(dir, "second")), false);
        await barrier.release();
        await waitForPendingCondition(
          pending,
          () => targetExists(join(dir, "second")),
          "second held phase",
        );
        assertEquals(await targetExists(join(dir, "finished")), false);
        await barrier.release();
        assertEquals((await pending).code, 7);
        assertEquals(await targetExists(join(dir, "finished")), true);
      } finally {
        try {
          child.kill("SIGTERM");
        } catch { /* A completed child needs no signal. */ }
        await pending;
      }
    });
  },
});

Deno.test({
  name:
    "shell barrier acknowledgements are safe before a reader opens and after it exits",
  ignore: Deno.build.os === "windows",
  fn: async () => {
    await withTempDir(async (dir) => {
      using barrier = await shellBarrier(join(dir, "buffered.fifo"));
      await barrier.release();
      const result = await new Deno.Command("sh", {
        args: ["-c", `${barrier.wait}; exit 3`],
        cwd: dir,
        stdin: "null",
        stdout: "null",
        stderr: "null",
      }).output();
      assertEquals(result.code, 3);
      await barrier.release();
    });
  },
});
