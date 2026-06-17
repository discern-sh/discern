/**
 * The keystone migration-system invariant (ADR 0014): **upgrade ≡ fresh init**.
 * An install brought forward by `upgrade` must be byte-identical to a freshly
 * initialised install at the same schema version. With this property in place,
 * every future migration is validated by construction — a migration that fails
 * to converge an old install onto the current shape fails this test.
 *
 * Only schema v1 exists today (v1 == the current shape), so these assert the
 * floor: upgrade is a no-op on a current install, idempotent, and orphan removal
 * reconverges an install that drifted. When a migration first bumps the schema
 * version (Phase 1), a frozen pre-migration install is pinned under
 * `tests/fixtures/installs/<n>/` and run through the same `assertConverges`.
 *
 * Installs are created in throwaway dirs (not git repos), so `upgrade`'s
 * clean-tree guard sees a non-repo; `--allow-dirty` keeps the runs deterministic
 * regardless of where the system temp dir lives.
 */

import { assertEquals } from "@std/assert";
import { join } from "@std/path";
import { sha256Hex } from "../src/lib/manifest.ts";
import {
  assertConverges,
  runCli,
  snapshotTree,
  withTempDir,
} from "./helpers.ts";

/**
 * Scaffold a fresh install into `dir`. `--name` is pinned: it otherwise defaults
 * to the directory's basename, which differs between two throwaway temp dirs and
 * would show up (correctly) as seed-file divergence. A real in-place upgrade
 * keeps the same directory, so pinning the name models that faithfully.
 */
async function init(dir: string): Promise<void> {
  assertEquals(
    (await runCli(["init", "--yes", "--slug", "demo", "--name", "Demo"], dir))
      .code,
    0,
  );
}

/** Run `upgrade --allow-dirty --json` and return the parsed report. */
// deno-lint-ignore no-explicit-any
async function upgrade(dir: string): Promise<any> {
  const r = await runCli(["upgrade", "--allow-dirty", "--json"], dir);
  assertEquals(r.code, 0, r.stderr);
  return JSON.parse(r.stdout);
}

/** The manifest with its run-varying timestamp stripped, for equality checks. */
async function manifestSansTimestamp(dir: string): Promise<unknown> {
  const m = JSON.parse(
    await Deno.readTextFile(join(dir, ".icculus/manifest.json")),
  );
  delete m.generated_at;
  return m;
}

/** Record a pristine managed orphan: a file the templates no longer ship. */
async function recordPristineOrphan(
  dir: string,
  rel: string,
  content: string,
): Promise<void> {
  await Deno.writeTextFile(join(dir, rel), content);
  const mp = join(dir, ".icculus/manifest.json");
  const m = JSON.parse(await Deno.readTextFile(mp));
  m.managed.push({
    path: rel,
    sha256: await sha256Hex(new TextEncoder().encode(content)),
  });
  await Deno.writeTextFile(mp, `${JSON.stringify(m, null, 2)}\n`);
}

Deno.test("upgrade of a current install changes nothing (no-op)", async () => {
  await withTempDir(async (dir) => {
    await init(dir);
    const res = await upgrade(dir);
    assertEquals(res.refreshed, []);
    assertEquals(res.removed, []);
    assertEquals(res.new_files, []);
  });
});

Deno.test("upgrade ≡ fresh init at the current schema version", async () => {
  await withTempDir(async (a) => {
    await withTempDir(async (b) => {
      await init(a);
      await upgrade(a); // bring the 'existing' install forward
      await init(b); // a freshly initialised install
      assertConverges(await snapshotTree(a), await snapshotTree(b));
      assertEquals(
        await manifestSansTimestamp(a),
        await manifestSansTimestamp(b),
      );
    });
  });
});

Deno.test("orphan removal reconverges a drifted install with a fresh init", async () => {
  await withTempDir(async (a) => {
    await withTempDir(async (b) => {
      await init(a);
      // `a` carries a managed file the templates no longer ship.
      await recordPristineOrphan(a, ".icculus/engine/obsolete", "old\n");
      const res = await upgrade(a);
      assertEquals(res.removed, [".icculus/engine/obsolete"]);

      await init(b);
      // After pruning the orphan, the upgraded install matches a fresh one.
      assertConverges(await snapshotTree(a), await snapshotTree(b));
      assertEquals(
        await manifestSansTimestamp(a),
        await manifestSansTimestamp(b),
      );
    });
  });
});

Deno.test("a second upgrade is a no-op (idempotent)", async () => {
  await withTempDir(async (dir) => {
    await init(dir);
    await upgrade(dir);
    const before = await snapshotTree(dir);
    const res = await upgrade(dir);
    assertEquals(res.refreshed, []);
    assertEquals(res.removed, []);
    assertConverges(await snapshotTree(dir), before);
  });
});
