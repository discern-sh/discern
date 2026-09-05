/** Local size readings require the canonical target's successful build. */
import { assertEquals, assertRejects } from "@std/assert";
import { join } from "@std/path";
import { measureBinarySize } from "../scripts/binary_size.ts";
import { BUILD_TARGETS } from "../scripts/build_targets.ts";
import { withTempDir } from "./helpers.ts";

Deno.test("E16: every representative target measures exactly its freshly built regular output", async () => {
  await withTempDir(async (root) => {
    await Deno.mkdir(join(root, "dist"));
    for (const target of BUILD_TARGETS) {
      let builds = 0;
      const size = await measureBinarySize(
        target.triple,
        root,
        async (triple, cwd) => {
          builds++;
          assertEquals(triple, target.triple);
          assertEquals(cwd, root);
          await Deno.writeFile(
            join(root, "dist", target.output),
            new Uint8Array(137),
          );
        },
      );
      assertEquals(builds, 1);
      assertEquals(size, 137);
    }
  });
});

Deno.test("E16: failed, missing and non-regular builds cannot borrow an earlier binary reading", async () => {
  const target = BUILD_TARGETS[0];
  if (target === undefined) throw new Error("the release registry is empty");
  for (
    const outcome of ["failed", "missing", "directory", "symlink"] as const
  ) {
    await withTempDir(async (root) => {
      await Deno.mkdir(join(root, "dist"));
      const output = join(root, "dist", target.output);
      await Deno.writeFile(output, new Uint8Array(137));
      let builds = 0;
      await assertRejects(() =>
        measureBinarySize(target.triple, root, async () => {
          builds++;
          if (outcome === "failed") throw new Error("compilation failed");
          if (outcome === "directory") await Deno.mkdir(output);
          if (outcome === "symlink") {
            await Deno.writeFile(join(root, "other"), new Uint8Array(1));
            await Deno.symlink(join(root, "other"), output);
          }
        })
      );
      assertEquals(builds, 1, outcome);
      if (outcome === "directory") {
        assertEquals((await Deno.lstat(output)).isDirectory, true);
      }
      if (outcome === "symlink") {
        assertEquals((await Deno.lstat(output)).isSymlink, true);
      }
    });
  }
  let builds = 0;
  await assertRejects(() =>
    measureBinarySize("unregistered-target", "/unused", () => {
      builds++;
      return Promise.resolve();
    })
  );
  assertEquals(builds, 0);
});
