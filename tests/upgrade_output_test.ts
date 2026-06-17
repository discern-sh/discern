/**
 * The grouped `upgrade` output (developer ergonomics). The post-apply summary
 * and the `--dry-run` preview share one renderer: the unchanged bulk ("already
 * up to date") is listed first, so the files that actually changed land at the
 * bottom of the console where the eye already is. Human output goes to stderr.
 */

import { assert, assertEquals, assertStringIncludes } from "@std/assert";
import { join } from "@std/path";
import { runCli, withTempDir } from "./helpers.ts";

async function init(dir: string): Promise<void> {
  assertEquals(
    (await runCli(["init", "--yes", "--slug", "demo"], dir)).code,
    0,
  );
}

/** Remove a managed file so the next upgrade has one file to (re)create. */
async function dropManagedFile(dir: string): Promise<void> {
  await Deno.remove(join(dir, ".icculus/engine/doctor"));
}

Deno.test("upgrade --dry-run groups the plan: up-to-date before would-refresh", async () => {
  await withTempDir(async (dir) => {
    await init(dir);
    await dropManagedFile(dir); // → one "would refresh" entry
    const r = await runCli(["upgrade", "--dry-run"], dir);
    assertEquals(r.code, 0, r.stderr);
    const out = r.stderr; // human output → stderr

    // Grouped, not the old flat intermingled list: both section headers present.
    assertStringIncludes(out, "already up to date");
    assertStringIncludes(out, "would refresh");
    // ...and the unchanged bulk is listed before the change.
    assert(
      out.indexOf("already up to date") < out.indexOf("would refresh"),
      "up-to-date should be listed before would-refresh",
    );
    assertStringIncludes(out, "No files were written");
  });
});

Deno.test("upgrade summary lists refreshed after already-up-to-date", async () => {
  await withTempDir(async (dir) => {
    await init(dir);
    await dropManagedFile(dir);
    const r = await runCli(["upgrade"], dir); // non-git temp dir → proceeds
    assertEquals(r.code, 0, r.stderr);
    const out = r.stderr;

    assert(
      out.indexOf("already up to date") < out.indexOf("refreshed:"),
      "refreshed should come after up-to-date in the summary",
    );
    assertStringIncludes(out, ".icculus/engine/doctor"); // the refreshed file
  });
});
