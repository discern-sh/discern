/**
 * Pool same-prefix subprocess cases onto pristine copies of ONE scaffolded
 * install. The subprocess scaffold (`setup begin` and its follow-ups) that every
 * case used to repeat runs once per top-level test; each case then edits and
 * asserts its own untouched copy, so no case can observe another's writes and
 * the copy count, not the scaffold count, grows with the case count.
 *
 * Callers snapshot a main checkout before linked worktrees or Proof introduce
 * path-bound state. Fixture configuration must not name case-specific absolute
 * paths. Each copy keeps the seed checkout's basename, preserving generated
 * references to its sibling worktree directory.
 *
 * Every path handed out is fully symlink-resolved: a spawned CLI observes its
 * cwd kernel-resolved, so cases that drive a result core in-process must
 * receive the same canonical root the subprocess seam would report.
 */

import { copy } from "@std/fs";
import { join } from "@std/path";
import { withTempDir } from "./temp_dir.ts";

/** One pooled case: its test name and the body that drives its own copy. */
export type PooledInstallCase = readonly [
  name: string,
  run: (dir: string) => Promise<void>,
];

/**
 * Scaffold one install through `scaffold`, then run every case as a step over
 * a fresh copy of it. Steps run in sequence under the parent test's temp
 * directory. Each step removes its copy and sibling worktrees before the next
 * step starts, and keeps its original name in the failure report.
 */
export async function withPristineInstalls(
  t: Deno.TestContext,
  scaffold: (dir: string) => Promise<void>,
  cases: readonly PooledInstallCase[],
): Promise<void> {
  await withTempDir(async (created) => {
    const root = await Deno.realPath(created);
    const checkoutName = "pristine";
    const pristine = join(root, checkoutName);
    await Deno.mkdir(pristine);
    await scaffold(pristine);
    for (const [name, run] of cases) {
      await t.step(name, async () => {
        await withTempDir(async (createdCase) => {
          const dir = join(await Deno.realPath(createdCase), checkoutName);
          await copy(pristine, dir);
          await run(dir);
        }, { parent: root });
      });
    }
  });
}
