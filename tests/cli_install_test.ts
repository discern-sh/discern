import { assert, assertEquals } from "@std/assert";
import { join } from "@std/path";
import { installExecutable, writeExecutable } from "../scripts/cli_install.ts";
import { withTempDir } from "./helpers.ts";

/** Require the exact executable bits that maintainer CLI placement promises. */
async function assertExecutable(path: string): Promise<void> {
  if (Deno.build.os === "windows") return;
  const mode = (await Deno.stat(path)).mode;
  assert(mode !== null);
  assertEquals(mode & 0o777, 0o755);
}

Deno.test("maintainer CLI placement atomically installs bytes and rendered text", async () => {
  await withTempDir(async (dir) => {
    const source = join(dir, "compiled-source");
    const destination = join(dir, "bin", "discern");
    const compiled = new Uint8Array([0x00, 0x7f, 0xff]);
    await Deno.writeFile(source, compiled);
    await installExecutable(source, destination);
    assertEquals(await Deno.readFile(destination), compiled);
    await assertExecutable(destination);

    const shim = "#!/bin/sh\nprintf 'dev shim\\n'\n";
    await writeExecutable(shim, destination);
    assertEquals(await Deno.readTextFile(destination), shim);
    await assertExecutable(destination);
  });
});
