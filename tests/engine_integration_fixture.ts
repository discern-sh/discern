/** Pristine integration repositories with one explicitly owned producer counter. */
import { assertEquals } from "@std/assert";
import { join } from "@std/path";
import { targetExists } from "../src/shared/fs_presence.ts";
import { withTempDir } from "./temp_dir.ts";
import { withPristineInstalls } from "./engine_surface_fixture.ts";

type CountedInstallCase = readonly [
  name: string,
  run: (dir: string, counter: string) => Promise<void>,
];

/**
 * Own the counter outside the copied checkout for the whole named journey.
 * Every step awaits its real producers, then removes their counter even on
 * failure. The next case must observe absence before driving its own copy.
 * Select this helper using project/map/80-development/test-execution-review.md.
 */
export async function withCountedPristineInstalls(
  t: Deno.TestContext,
  scaffold: (dir: string, counter: string) => Promise<void>,
  cases: readonly CountedInstallCase[],
): Promise<void> {
  await withTempDir(async (scratch) => {
    const counter = join(scratch, "producer-runs");
    await withPristineInstalls(
      t,
      (dir) => scaffold(dir, counter),
      cases.map(
        ([name, run]) =>
          [name, async (dir) => {
            assertEquals(
              await targetExists(counter),
              false,
              `${name}: fresh counter`,
            );
            try {
              await run(dir, counter);
            } finally {
              if (await targetExists(counter)) await Deno.remove(counter);
            }
          }] as const,
      ),
    );
    assertEquals(await targetExists(counter), false);
  });
}
