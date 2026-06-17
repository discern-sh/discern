/**
 * CLI tests for `icculus upgrade`'s orphan reconciliation (ADR 0014): managed
 * files the manifest recorded that the new templates no longer ship are removed
 * when pristine, and kept (and reported) when edited. The migration fold and the
 * clean-tree guard live in upgrade_migrations_test.ts / upgrade_git_guard_test.ts.
 */

import { assert, assertEquals } from "@std/assert";
import { dirname, join } from "@std/path";
import { sha256Hex } from "../src/lib/manifest.ts";
import { readTarget, runCli, targetExists, withTempDir } from "./helpers.ts";

/** Fresh install in `dir`. */
async function initThen(dir: string): Promise<void> {
  assertEquals(
    (await runCli(["init", "--yes", "--slug", "demo"], dir)).code,
    0,
  );
}

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
