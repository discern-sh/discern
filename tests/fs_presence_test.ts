import { assertEquals, assertRejects, assertThrows } from "@std/assert";
import { join } from "@std/path";
import {
  bestEffortFs,
  directoryExists,
  fileExists,
  lstatIfExists,
  pathExists,
  readBytesIfExists,
  readDirIfExists,
  readLinkIfExists,
  readTextIfExists,
  realPathIfExists,
  statIfExists,
  targetExists,
} from "../src/shared/fs_presence.ts";
import { withTempDir } from "./helpers.ts";

Deno.test("presence reads distinguish missing paths from present entries", async () => {
  await withTempDir(async (dir) => {
    const file = join(dir, "present.txt");
    const subdir = join(dir, "present-dir");
    const missing = join(dir, "missing");
    await Deno.writeTextFile(file, "present\n");
    await Deno.mkdir(subdir);

    assertEquals(await pathExists(file), true);
    assertEquals(await pathExists(subdir), true);
    assertEquals(await pathExists(missing), false);
    assertEquals(await fileExists(file), true);
    assertEquals(await fileExists(subdir), false);
    assertEquals(await fileExists(missing), false);
    assertEquals(await directoryExists(file), false);
    assertEquals(await directoryExists(subdir), true);
    assertEquals(await directoryExists(missing), false);
    assertEquals(await targetExists(file), true);
    assertEquals(await targetExists(missing), false);
    assertEquals(await readTextIfExists(file), "present\n");
    assertEquals(await readTextIfExists(missing), undefined);
    assertEquals(
      await readBytesIfExists(file),
      new TextEncoder().encode("present\n"),
    );
    assertEquals(await readBytesIfExists(missing), undefined);
    assertEquals((await lstatIfExists(file))?.isFile, true);
    assertEquals(await lstatIfExists(missing), undefined);
    assertEquals((await statIfExists(file))?.isFile, true);
    assertEquals(await statIfExists(missing), undefined);
    assertEquals(await realPathIfExists(file), await Deno.realPath(file));
    assertEquals(await realPathIfExists(missing), undefined);
    if (Deno.build.os !== "windows") {
      const link = join(dir, "present-link");
      await Deno.symlink(file, link);
      assertEquals(await readLinkIfExists(link), file);
    }
    assertEquals(await readLinkIfExists(missing), undefined);
    assertEquals(
      (await readDirIfExists(dir))?.map((entry) => entry.name).sort(),
      Deno.build.os === "windows"
        ? ["present-dir", "present.txt"]
        : ["present-dir", "present-link", "present.txt"],
    );
    assertEquals(await readDirIfExists(missing), undefined);
  });
});

Deno.test("presence reads rethrow permission failures", async (t) => {
  if (Deno.build.os === "windows") {
    await t.step({
      name: "mode 0o000 cannot simulate permission denial on Windows",
      ignore: true,
      fn: () => {},
    });
    return;
  }
  await withTempDir(async (dir) => {
    const protectedDir = join(dir, "protected");
    const file = join(protectedDir, "present.txt");
    await Deno.mkdir(protectedDir);
    await Deno.writeTextFile(file, "present\n");
    await Deno.chmod(protectedDir, 0o000);
    try {
      let denied: unknown;
      try {
        await Deno.stat(file);
      } catch (error) {
        denied = error;
      }
      if (!(denied instanceof Deno.errors.PermissionDenied)) {
        await t.step({
          name:
            "the current user can traverse mode-0o000 directories, so permission denial cannot be simulated",
          ignore: true,
          fn: () => {},
        });
        return;
      }
      for (
        const [name, read] of [
          ["pathExists", () => pathExists(file)],
          ["fileExists", () => fileExists(file)],
          ["directoryExists", () => directoryExists(file)],
          ["targetExists", () => targetExists(file)],
          ["readTextIfExists", () => readTextIfExists(file)],
          ["readBytesIfExists", () => readBytesIfExists(file)],
          ["lstatIfExists", () => lstatIfExists(file)],
          ["statIfExists", () => statIfExists(file)],
          ["realPathIfExists", () => realPathIfExists(file)],
          ["readLinkIfExists", () => readLinkIfExists(file)],
          ["readDirIfExists", () => readDirIfExists(file)],
        ] as const
      ) {
        await t.step(name, async () => {
          await assertRejects(read, Deno.errors.PermissionDenied);
        });
      }
    } finally {
      await Deno.chmod(protectedDir, 0o700);
    }
  });
});

Deno.test("best-effort reads require a reason and expose their fallback", async () => {
  assertThrows(
    () =>
      bestEffortFs(
        () => Promise.reject(new Deno.errors.PermissionDenied("denied")),
        { onFailure: false, reason: "" },
      ),
    TypeError,
    "requires a reason",
  );
  assertEquals(
    await bestEffortFs(
      () => Promise.reject(new Deno.errors.PermissionDenied("denied")),
      {
        onFailure: "unavailable",
        reason: "This test proves the caller-visible suppression boundary.",
      },
    ),
    "unavailable",
  );
});
