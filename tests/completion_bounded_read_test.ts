/** Recovery and producer capture share one complete, byte-bounded reader. */
import { assertEquals, assertRejects } from "@std/assert";
import { join } from "@std/path";
import { withTempDir } from "./helpers.ts";
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
    const read = Deno.FsFile.prototype.read;
    let changed = false;
    Deno.FsFile.prototype.read = async function (
      this: Deno.FsFile,
      buffer: Uint8Array,
    ): Promise<number | null> {
      if (!changed) {
        changed = true;
        await Deno.writeTextFile(path, "growth", { append: true });
      }
      return await read.call(this, buffer);
    };
    try {
      await assertRejects(
        () => readBoundedFile(path, 3),
        Error,
        "changed while being read",
      );
    } finally {
      Deno.FsFile.prototype.read = read;
    }
    await Deno.writeFile(path, Uint8Array.of(255));
    await assertRejects(() => readBoundedText(path, 1), TypeError);
    await Deno.writeFile(path, new Uint8Array());
    assertEquals(await readBoundedFile(path, 0), new Uint8Array());
  });
});
