/**
 * Pool same-prefix subprocess cases onto pristine copies of ONE scaffolded
 * install. The subprocess scaffold (`setup begin` and its follow-ups) that every
 * case used to repeat runs once per top-level test; each case then edits and
 * asserts its own untouched copy, so no case can observe another's writes and
 * the copy count, not the scaffold count, grows with the case count.
 *
 * The copy is taken from a main checkout before any linked worktree exists and
 * before any Proof is recorded, so the snapshot embeds no absolute path that a
 * copy would carry to the wrong location.
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
 * directory, so each case still owns its files and keeps its original name in
 * the failure report.
 */
export async function withPristineInstalls(
  t: Deno.TestContext,
  scaffold: (dir: string) => Promise<void>,
  cases: readonly PooledInstallCase[],
): Promise<void> {
  await withTempDir(async (created) => {
    const root = await Deno.realPath(created);
    const pristine = join(root, "pristine");
    await Deno.mkdir(pristine);
    await scaffold(pristine);
    for (const [index, [name, run]] of cases.entries()) {
      await t.step(name, async () => {
        const dir = join(root, `case-${index}`);
        await copy(pristine, dir);
        await run(dir);
      });
    }
  });
}
