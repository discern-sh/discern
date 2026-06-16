/**
 * CLI tests for `icculus upgrade`'s migrate nudge (ADR 0009 follow-up). A 0.x
 * user who runs `upgrade` to get the 1.0 engine should also be pointed at
 * `icculus migrate`, because a stale `coverage_min` ratchet fails *silently*
 * under the 1.0 engine. The upgrade itself still succeeds; the nudge is advisory.
 */

import { assertEquals } from "@std/assert";
import { join } from "@std/path";
import { runCli, withTempDir } from "./helpers.ts";

/** Fresh 1.0 install in `dir`, optionally mutating the generated icculus.toml. */
async function initThen(
  dir: string,
  mutate?: (toml: string) => string,
): Promise<void> {
  assertEquals(
    (await runCli(["init", "--yes", "--slug", "demo"], dir)).code,
    0,
  );
  if (mutate) {
    const p = join(dir, "icculus.toml");
    await Deno.writeTextFile(p, mutate(await Deno.readTextFile(p)));
  }
}

Deno.test("upgrade nudges toward migrate when the config looks pre-1.0", async () => {
  await withTempDir(async (dir) => {
    await initThen(dir, (t) => `${t}\n[ratchets]\ncoverage_min = 80\n`);
    const r = await runCli(["upgrade", "--json"], dir);
    assertEquals(r.code, 0, r.stderr);
    const res = JSON.parse(r.stdout);
    assertEquals(res.ok, true); // the upgrade itself still succeeds
    assertEquals(res.migrate_suggested, true); // ...and flags the stale config
  });
});

Deno.test("upgrade does not nudge a clean 1.0 config", async () => {
  await withTempDir(async (dir) => {
    await initThen(dir);
    const r = await runCli(["upgrade", "--json"], dir);
    assertEquals(r.code, 0, r.stderr);
    assertEquals(JSON.parse(r.stdout).migrate_suggested, false);
  });
});

Deno.test("upgrade --dry-run also reports the migrate suggestion", async () => {
  await withTempDir(async (dir) => {
    await initThen(dir, (t) => `${t}\n[ratchets]\ncoverage_min = 80\n`);
    const r = await runCli(["upgrade", "--dry-run", "--json"], dir);
    assertEquals(r.code, 0, r.stderr);
    const res = JSON.parse(r.stdout);
    assertEquals(res.dry_run, true);
    assertEquals(res.migrate_suggested, true);
  });
});
