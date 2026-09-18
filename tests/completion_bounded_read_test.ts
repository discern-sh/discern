/** Recovery and producer capture share one complete, byte-bounded reader. */
import { assertEquals, assertRejects } from "@std/assert";
import { join } from "@std/path";
import { withTempDir } from "./helpers.ts";
import { growOnNextRead } from "./read_growth.ts";
import {
  readBoundedFile,
  readBoundedText,
} from "../src/shared/bounded_file.ts";

Deno.test("bounded artifact reads reject growth, substitution, unsupported paths and invalid text", async () => {
  await withTempDir(async (root) => {
    const path = join(root, "payload");
    await Deno.writeTextFile(path, "abc");
    assertEquals(await readBoundedText(path, 3), "abc");
    await assertRejects(() => readBoundedFile(path, 2), Error, "byte bound");
    await assertRejects(() => readBoundedFile(path, NaN), TypeError);
    const link = join(root, "link");
    await Deno.symlink(path, link);
    await assertRejects(() => readBoundedFile(link, 3), Error, "regular file");
    const restore = await growOnNextRead(path, "growth");
    try {
      await assertRejects(
        () => readBoundedFile(path, 3),
        Error,
        "changed while being read",
      );
    } finally {
      restore();
    }
    await Deno.writeFile(path, Uint8Array.of(255));
    await assertRejects(() => readBoundedText(path, 1), TypeError);
    await Deno.writeFile(path, new Uint8Array());
    assertEquals(await readBoundedFile(path, 0), new Uint8Array());
  });
});
