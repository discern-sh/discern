/**
 * CLI tests for `icculus upgrade`'s migrate nudge (ADR 0009 follow-up). A 0.x
 * user who runs `upgrade` to get the 1.0 engine should also be pointed at
 * `icculus migrate`, because a stale `coverage_min` ratchet fails *silently*
 * under the 1.0 engine. The upgrade itself still succeeds; the nudge is advisory.
 */

import { assert, assertEquals } from "@std/assert";
import { dirname, join } from "@std/path";
import { sha256Hex } from "../src/lib/manifest.ts";
import { readTarget, runCli, targetExists, withTempDir } from "./helpers.ts";

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

// ---- orphan reconciliation (ADR 0014) -------------------------------------

/**
 * Simulate a managed file the install once had but the current templates no
 * longer ship: write it on disk and record it in the manifest. With no
 * `recordedHash`, the recorded hash matches the bytes (a pristine orphan); pass
 * a different hash to make it look user-edited.
 */
async function injectOrphan(
  dir: string,
  rel: string,
  content: string,
  recordedHash?: string,
): Promise<void> {
  const abs = join(dir, rel);
  await Deno.mkdir(dirname(abs), { recursive: true });
  await Deno.writeTextFile(abs, content);
  const manifestPath = join(dir, ".icculus/manifest.json");
  const m = JSON.parse(await readTarget(dir, ".icculus/manifest.json"));
  const sha = recordedHash ??
    await sha256Hex(new TextEncoder().encode(content));
  m.managed.push({ path: rel, sha256: sha });
  await Deno.writeTextFile(manifestPath, `${JSON.stringify(m, null, 2)}\n`);
}

Deno.test("upgrade removes a pristine orphan and drops it from the manifest", async () => {
  await withTempDir(async (dir) => {
    await initThen(dir);
    await injectOrphan(dir, ".icculus/engine/obsolete", "#!/usr/bin/env sh\n");
    const r = await runCli(["upgrade", "--json"], dir);
    assertEquals(r.code, 0, r.stderr);
    const res = JSON.parse(r.stdout);

    assertEquals(res.removed, [".icculus/engine/obsolete"]);
    assertEquals(await targetExists(dir, ".icculus/engine/obsolete"), false);
    const m = JSON.parse(await readTarget(dir, ".icculus/manifest.json"));
    assert(
      !m.managed.some((e: { path: string }) =>
        e.path === ".icculus/engine/obsolete"
      ),
      "the removed orphan must not remain in the manifest",
    );
  });
});

Deno.test("upgrade keeps an edited orphan and reports it, deleting nothing", async () => {
  await withTempDir(async (dir) => {
    await initThen(dir);
    // Recorded hash differs from the on-disk bytes → looks user-edited.
    await injectOrphan(dir, ".icculus/engine/edited", "mine\n", "0".repeat(64));
    const r = await runCli(["upgrade", "--json"], dir);
    assertEquals(r.code, 0, r.stderr);
    const res = JSON.parse(r.stdout);

    assertEquals(res.orphans_kept, [".icculus/engine/edited"]);
    assertEquals(res.removed, []);
    assertEquals(await targetExists(dir, ".icculus/engine/edited"), true);
  });
});

Deno.test("upgrade --check flags a pristine orphan as drift to remove", async () => {
  await withTempDir(async (dir) => {
    await initThen(dir);
    await injectOrphan(dir, ".icculus/engine/obsolete", "#!/usr/bin/env sh\n");
    const r = await runCli(["upgrade", "--check", "--json"], dir);
    assertEquals(r.code, 1); // drift → non-zero
    const res = JSON.parse(r.stdout);
    assertEquals(res.ok, false);
    assert(
      res.drifted.some((d: { path: string; action: string }) =>
        d.path === ".icculus/engine/obsolete" && d.action === "remove"
      ),
      "the orphan should be reported as remove-drift",
    );
    // --check writes nothing.
    assertEquals(await targetExists(dir, ".icculus/engine/obsolete"), true);
  });
});
