import { assert, assertEquals, assertRejects } from "@std/assert";
import { join } from "@std/path";
import {
  atomicReplaceBytes,
  atomicReplaceJson,
  atomicReplaceText,
  isAtomicReplaceTempName,
} from "../src/shared/atomic_write.ts";
import { withTempDir } from "./helpers.ts";

/** Return the names of target-adjacent temporary siblings left in a directory. */
async function tempSiblings(dir: string): Promise<string[]> {
  const names: string[] = [];
  for await (const entry of Deno.readDir(dir)) {
    if (isAtomicReplaceTempName(entry.name)) names.push(entry.name);
  }
  return names.sort();
}

Deno.test("atomic replacement wrappers preserve bytes and requested JSON layout", async () => {
  await withTempDir(async (dir) => {
    const bytesPath = join(dir, "bytes.bin");
    await Deno.writeTextFile(bytesPath, "old");
    await atomicReplaceBytes(
      bytesPath,
      new Uint8Array([0x00, 0x7f, 0xff]),
      { mode: 0o600, sync: false },
    );
    assertEquals(
      [...await Deno.readFile(bytesPath)],
      [0x00, 0x7f, 0xff],
    );

    const textPath = join(dir, "text.txt");
    await atomicReplaceText(textPath, "complete text\n", {
      mode: 0o600,
      sync: true,
    });
    assertEquals(await Deno.readTextFile(textPath), "complete text\n");

    const jsonPath = join(dir, "state.json");
    await atomicReplaceJson(jsonPath, { version: 1, values: ["a"] }, {
      mode: 0o600,
      sync: false,
      space: 2,
      trailingNewline: true,
    });
    assertEquals(
      await Deno.readTextFile(jsonPath),
      '{\n  "version": 1,\n  "values": [\n    "a"\n  ]\n}\n',
    );
    assertEquals(await tempSiblings(dir), []);
  });
});

Deno.test("atomic replacement can preserve an exact executable mode", async () => {
  if (Deno.build.os === "windows") return;
  await withTempDir(async (dir) => {
    const path = join(dir, "tool");
    await atomicReplaceText(path, "#!/bin/sh\n", {
      mode: 0o755,
      sync: false,
      exactMode: true,
    });
    const mode = (await Deno.stat(path)).mode;
    assert(mode !== null);
    assertEquals(mode & 0o777, 0o755);
  });
});

Deno.test("atomic replacement cleans a sibling when rename fails", async () => {
  await withTempDir(async (dir) => {
    const target = join(dir, "standing-state");
    await Deno.mkdir(target);
    await assertRejects(() =>
      atomicReplaceText(target, "replacement\n", {
        mode: 0o600,
        sync: false,
      })
    );
    assertEquals(await tempSiblings(dir), []);
  });
});
