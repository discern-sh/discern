/**
 * The main-checkout lookup answers only from what Git and the filesystem
 * show: a linked worktree names its canonical main checkout, no repository
 * reads as undefined rather than a guessed path, and a missing path
 * canonicalizes to itself while every other filesystem failure surfaces.
 */

import { assertEquals, assertRejects } from "@std/assert";
import { join } from "@std/path";
import { assertNamedCasesAsync } from "./assert_cases.ts";
import { git, gitInit } from "./engine_helpers.ts";
import { withTempDir } from "./helpers.ts";
import {
  firstWorktreePath,
  mainRepoPath,
  realPathOr,
} from "../src/shared/main_repo.ts";

/** A committed repository at `path`. */
async function repository(path: string): Promise<string> {
  await Deno.mkdir(path);
  await Deno.writeTextFile(join(path, "README.md"), "fixture\n");
  await gitInit(path);
  return path;
}

Deno.test("the main-checkout lookup reports only what it can observe", async () => {
  await assertNamedCasesAsync({
    "a linked worktree resolves the canonical main checkout": async () => {
      await withTempDir(async (dir) => {
        const main = await repository(join(dir, "main"));
        await git(main, "worktree", "add", "-q", join(dir, "linked"));
        assertEquals(
          await mainRepoPath(join(dir, "linked")),
          await Deno.realPath(main),
        );
      });
    },
    "outside any repository there is no main checkout": async () => {
      await withTempDir(async (dir) => {
        assertEquals(await firstWorktreePath(dir), undefined);
        assertEquals(await mainRepoPath(dir), undefined);
      });
    },
    "a missing path canonicalizes to itself; other failures surface":
      async () => {
        await withTempDir(async (dir) => {
          const missing = join(dir, "missing", "path");
          assertEquals(await realPathOr(missing), missing);
          const file = join(dir, "file");
          await Deno.writeTextFile(file, "");
          await assertRejects(() => realPathOr(join(file, "child")));
        });
      },
  });
});
