/** Isolation and teardown boundaries for reusable install fixtures. */

import { assertEquals, assertExists } from "@std/assert";
import { basename, dirname, join, relative, resolve } from "@std/path";
import { targetExists } from "../src/shared/fs_presence.ts";
import { withPristineInstalls } from "./engine_surface_fixture.ts";
import { withCountedPristineInstalls } from "./engine_integration_fixture.ts";

Deno.test("pristine installs isolate copies and complete each case's teardown before the next", async (t) => {
  let scaffolds = 0;
  let pristine: string | undefined;
  let first: string | undefined;
  let second: string | undefined;
  const seed = "unchanged seed\n";

  await withPristineInstalls(t, async (dir) => {
    scaffolds++;
    pristine = dir;
    await Deno.writeTextFile(join(dir, "seed.txt"), seed);
    await Deno.writeTextFile(
      join(dir, "sibling-root.txt"),
      relative(dir, `${dir}.worktrees`),
    );
  }, [
    ["a case mutates its copy and creates sibling worktrees", async (dir) => {
      first = dir;
      assertExists(pristine);
      assertEquals(basename(dir), basename(pristine));
      assertEquals(
        resolve(dir, await Deno.readTextFile(join(dir, "sibling-root.txt"))),
        `${dir}.worktrees`,
      );
      assertEquals(await Deno.readTextFile(join(dir, "seed.txt")), seed);
      await Deno.writeTextFile(join(dir, "seed.txt"), "first case's edit\n");
      await Deno.writeTextFile(join(dir, "first-only.txt"), "local\n");
      await Deno.mkdir(`${dir}.worktrees`);
      await Deno.writeTextFile(
        join(`${dir}.worktrees`, "pending.txt"),
        "local\n",
      );
    }],
    [
      "the next copy follows teardown and retains the pristine seed",
      async (dir) => {
        second = dir;
        assertExists(first);
        assertExists(pristine);
        assertEquals(await targetExists(first), false);
        assertEquals(await targetExists(`${first}.worktrees`), false);
        assertEquals(await Deno.readTextFile(join(pristine, "seed.txt")), seed);
        assertEquals(await Deno.readTextFile(join(dir, "seed.txt")), seed);
        assertEquals(await targetExists(join(dir, "first-only.txt")), false);
        assertEquals(await targetExists(`${dir}.worktrees`), false);
      },
    ],
  ]);

  assertEquals(scaffolds, 1);
  assertExists(pristine);
  assertExists(first);
  assertExists(second);
  for (const dir of [pristine, first, second]) {
    assertEquals(await targetExists(dir), false);
    assertEquals(await targetExists(`${dir}.worktrees`), false);
  }
});

Deno.test("counted pristine installs reset observations between copies and remove the journey's counter", async (t) => {
  let scaffolds = 0;
  let counterPath: string | undefined;
  let first: string | undefined;
  let seed: string | undefined;
  await withCountedPristineInstalls(t, async (dir, counter) => {
    scaffolds++;
    seed = dir;
    counterPath = counter;
    await Deno.writeTextFile(join(dir, "counter-path.txt"), counter);
  }, [
    ["a producer writes outside its repository copy", async (dir, counter) => {
      first = dir;
      assertEquals(await targetExists(counter), false);
      assertEquals(
        await Deno.readTextFile(join(dir, "counter-path.txt")),
        counter,
      );
      await Deno.writeTextFile(counter, "xxx");
      await Deno.writeTextFile(
        join(dir, "counter-path.txt"),
        "case-local edit",
      );
    }],
    [
      "the next copy starts with no observations and its original counter path",
      async (dir, counter) => {
        assertExists(first);
        assertEquals(await targetExists(first), false);
        assertEquals(await targetExists(counter), false);
        assertEquals(
          await Deno.readTextFile(join(dir, "counter-path.txt")),
          counter,
        );
        await Deno.writeTextFile(counter, "x");
      },
    ],
    [
      "a case without producers leaves no counter to remove",
      async (_dir, counter) => {
        assertEquals(await targetExists(counter), false);
      },
    ],
  ]);
  assertEquals(scaffolds, 1);
  assertExists(counterPath);
  assertExists(seed);
  assertEquals(await targetExists(seed), false);
  assertEquals(await targetExists(counterPath), false);
  assertEquals(await targetExists(dirname(counterPath)), false);
});
