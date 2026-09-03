/** End-to-end lifecycle coverage for supported repository path forms. */

import { assert, assertEquals } from "@std/assert";
import { join } from "@std/path";
import { targetExists } from "../src/shared/fs_presence.ts";
import { assertResultDataKey, decodeCliResult } from "./decode_cli_result.ts";
import {
  addWorktree,
  git,
  gitInit,
  gitOut,
  runAgent,
  scaffoldEngine,
} from "./engine_helpers.ts";
import { PATH_SHAPES, withPathShapeTempDir } from "./temp_dir.ts";

for (const shape of PATH_SHAPES) {
  Deno.test(`lifecycle path shape: ${shape.id} supports start, done, accept, and drop`, async () => {
    await withPathShapeTempDir(shape, async (dir) => {
      await scaffoldEngine(dir);
      await gitInit(dir);

      const started = await runAgent(dir, [
        "start",
        "--name",
        `path-${shape.id}`,
        "--json",
      ]);
      assertEquals(started.code, 0, started.output);
      const startResult = decodeCliResult(started.stdout, "start");
      assertResultDataKey(startResult, "path");
      const worktree = startResult.data.path;
      await Deno.writeTextFile(
        join(worktree, "path-shape.txt"),
        `${shape.id}\n`,
      );
      await git(worktree, "add", "-A");
      await git(
        worktree,
        "commit",
        "-q",
        "-m",
        `exercise ${shape.id}`,
        "--no-gpg-sign",
      );
      const done = await runAgent(worktree, ["done", "--json"]);
      assertEquals(done.code, 0, done.output);
      const accepted = await runAgent(
        worktree,
        ["accept", "--confirmed", "--json"],
      );
      assertEquals(accepted.code, 0, accepted.output);
      assertEquals(await targetExists(worktree), false, accepted.output);
      assertEquals(
        await Deno.readTextFile(join(dir, "path-shape.txt")),
        `${shape.id}\n`,
      );

      const dropped = await addWorktree(dir, `drop-${shape.id}`);
      const droppedBranch = await gitOut(dropped, "branch", "--show-current");
      const drop = await runAgent(dir, [
        "worktree",
        "drop",
        `drop-${shape.id}`,
        "--json",
      ]);
      assertEquals(drop.code, 0, drop.output);
      assertEquals(await targetExists(dropped), false, drop.output);
      assert(
        (await gitOut(dir, "branch", "--list", droppedBranch)) === "",
        drop.output,
      );
    });
  });
}
