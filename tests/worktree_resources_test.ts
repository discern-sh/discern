/**
 * Unit coverage for the per-worktree resource layer — the identity handles, the
 * spec reader, the `.env` upsert, the ledger, and (the safety-critical part) the
 * conservative orphan GC. The end-to-end lifecycle is driven through the CLI in
 * `engine_worktree_resources_test.ts`; this pins the guards directly so a wrong
 * change to GC fails loudly: GC reclaims a vanished worktree's resource AND
 * NOTHING ELSE (never a live one, never a recycled handle, never a half-expanded
 * command, never a gc-opted-out one).
 */

import { assert, assertEquals, assertExists } from "@std/assert";
import { join } from "@std/path";
import { exists } from "@std/fs";
import { withTempDir } from "./helpers.ts";
import { addWorktree, gitInit } from "./engine_helpers.ts";
import { Logger } from "../src/lib/log.ts";
import { Config } from "../src/shared/config_read.ts";
import {
  deriveIdentity,
  type IdentitySettings,
  loadIdentitySettings,
  resolveWorktreeId,
  resourceForId,
  worktreeBase,
  type WorktreeIdentity,
} from "../src/engine/worktree/identity.ts";
import { upsertEnvLine } from "../src/engine/worktree/env_file.ts";
import {
  createResources,
  destroyResources,
  gcOrphanResources,
  listEntries,
  readResourceSpecs,
  type ResourceContext,
  resourceEnvName,
  writeEntry,
} from "../src/engine/worktree/resources.ts";
import {
  liveWorktreeGitKeys,
  liveWorktreePaths,
  resolveCommonGitDir,
  worktreeGitKey,
} from "../src/engine/worktree/git.ts";

/** A logger that doesn't clutter test output (writes to stderr, colour off). */
function quietLog(): Logger {
  return new Logger({ json: false, noColor: true, humanStream: "stderr" });
}

// ── identity handles: deterministic, unique, project-namespaced ───────────────

Deno.test("resourceForId: deterministic, unique across worktrees + resources", () => {
  // Same inputs → same handle (deterministic).
  assertEquals(
    resourceForId("app", "feat", "db"),
    resourceForId("app", "feat", "db"),
  );
  // Distinct worktree id ⇒ distinct handle.
  assert(
    resourceForId("app", "feat", "db") !== resourceForId("app", "other", "db"),
  );
  // Distinct resource name ⇒ distinct handle.
  assert(
    resourceForId("app", "feat", "db") !==
      resourceForId("app", "feat", "cache"),
  );
  // Shape: slug-id-name, sanitized.
  assertEquals(resourceForId("app", "feat", "db"), "app-feat-db");
});

Deno.test("resourceForId: project-namespaced (no cross-project collision)", () => {
  // Same worktree id + resource, different project slug ⇒ different handle.
  assert(
    resourceForId("app-a", "feat", "db") !==
      resourceForId("app-b", "feat", "db"),
  );
});

Deno.test("resourceForId/worktreeBase: sanitized for shell/CLI safety", () => {
  // Uppercase, spaces, and other unsafe chars collapse to dashes.
  assertEquals(resourceForId("app", "Feat X", "My DB"), "app-feat-x-my-db");
  assertEquals(worktreeBase("app", "feat"), "app-feat");
});

Deno.test("resourceEnvName: DISCERN_RESOURCE_<NAME> mapping", () => {
  assertEquals(resourceEnvName("db"), "DISCERN_RESOURCE_DB");
  assertEquals(resourceEnvName("dev_server"), "DISCERN_RESOURCE_DEV_SERVER");
  assertEquals(resourceEnvName("my-cache"), "DISCERN_RESOURCE_MY_CACHE");
});

// ── spec reader: document order + defaults ────────────────────────────────────

Deno.test("readResourceSpecs: document order, not alphabetical", () => {
  const cfg = new Config(`[worktree.resources.zebra]
create = "z"
[worktree.resources.alpha]
create = "a"
`);
  assertEquals(readResourceSpecs(cfg).map((s) => s.name), ["zebra", "alpha"]);
});

Deno.test("readResourceSpecs: required/gc default true; retries default 0", () => {
  const cfg = new Config(`[worktree.resources.a]
create = "x"
[worktree.resources.b]
create = "x"
required = false
gc = false
retries = 3
`);
  const specs = readResourceSpecs(cfg);
  const a = specs[0];
  const b = specs[1];
  assertExists(a);
  assertExists(b);
  assertEquals([a.required, a.gc, a.retries], [true, true, 0]);
  assertEquals([b.required, b.gc, b.retries], [false, false, 3]);
});

// ── .env upsert ───────────────────────────────────────────────────────────────

Deno.test("upsertEnvLine: replace existing / append with + without trailing NL", () => {
  // replace the first matching line, value only
  assertEquals(upsertEnvLine("A=1\nB=2\n", "A", "9"), "A=9\nB=2\n");
  // append before the trailing blank when the file ends with a newline
  assertEquals(upsertEnvLine("A=1\n", "B", "2"), "A=1\nB=2\n");
  // append onto an unterminated last line
  assertEquals(upsertEnvLine("A=1", "B", "2"), "A=1\nB=2");
});

// ── the ledger + GC: a real git repo with linked worktrees ────────────────────

/** Resolve the full identity + settings for a worktree path. */
async function identityOf(
  root: string,
  target: string,
): Promise<{ settings: IdentitySettings; identity: WorktreeIdentity }> {
  const settings = await loadIdentitySettings(root);
  const id = await resolveWorktreeId(settings, target);
  return { settings, identity: deriveIdentity(id, settings) };
}

/** The worktree's common git dir + git key, asserted present (no `!`). */
async function commonAndKey(
  wt: string,
): Promise<{ common: string; key: string }> {
  const common = await resolveCommonGitDir(wt);
  const key = await worktreeGitKey(wt);
  assertExists(common);
  assertExists(key);
  return { common, key };
}

/** A worktree config declaring one resource whose create/destroy touch markers
 * under `markers` (an absolute dir OUTSIDE the worktree, so a destroy still works
 * after the worktree is gone). */
function resourceConfig(markers: string, opts: { gc?: boolean } = {}): string {
  const gcLine = opts.gc === false ? "\ngc = false" : "";
  return `[project]
slug = "proj"

[worktree.resources.thing]
create  = "mkdir -p ${markers} && touch ${markers}/@resource@.live"
destroy = "rm -f ${markers}/@resource@.live; mkdir -p ${markers} && touch ${markers}/@resource@.gone"${gcLine}
`;
}

/** Build a ResourceContext rooted at a worktree. */
async function ctxFor(worktree: string): Promise<ResourceContext> {
  return {
    config: await Config.load(worktree),
    log: quietLog(),
    cwd: worktree,
  };
}

/** A committed main repo with a base config, so `addWorktree` has a tree to check
 * out (gitInit needs something to commit). The worktree's config is overwritten
 * per test. */
async function mainRepo(dir: string): Promise<void> {
  await Deno.writeTextFile(
    join(dir, "discern.toml"),
    '[project]\nslug = "proj"\n',
  );
  await gitInit(dir);
}

Deno.test("createResources writes a ledger entry and runs create; teardown destroys + clears", async () => {
  await withTempDir(async (dir) => {
    await mainRepo(dir);
    const wt = await addWorktree(dir, "alpha");
    const markers = join(dir, "markers");
    await Deno.writeTextFile(join(wt, "discern.toml"), resourceConfig(markers));

    const { settings, identity } = await identityOf(wt, wt);
    const { common, key } = await commonAndKey(wt);
    const ctx = await ctxFor(wt);

    await createResources(ctx, identity, settings, common, key);
    const handle = resourceForId(settings.slug, identity.id, "thing");
    assert(await exists(join(markers, `${handle}.live`)), "create did not run");
    const entries = await listEntries(common);
    assertEquals(entries.length, 1);
    const first = entries[0];
    assertExists(first);
    assertEquals(first.entry.resource_identity, handle);

    await destroyResources(ctx, common, key);
    assert(
      await exists(join(markers, `${handle}.gone`)),
      "destroy did not run",
    );
    assert(
      !(await exists(join(markers, `${handle}.live`))),
      "destroy left the live marker",
    );
    assertEquals(
      (await listEntries(common)).length,
      0,
      "ledger entry not cleared",
    );
  });
});

Deno.test("destroy is idempotent (a second teardown is a clean no-op)", async () => {
  await withTempDir(async (dir) => {
    await mainRepo(dir);
    const wt = await addWorktree(dir, "idem");
    const markers = join(dir, "markers");
    await Deno.writeTextFile(join(wt, "discern.toml"), resourceConfig(markers));
    const { settings, identity } = await identityOf(wt, wt);
    const { common, key } = await commonAndKey(wt);
    const ctx = await ctxFor(wt);
    await createResources(ctx, identity, settings, common, key);
    await destroyResources(ctx, common, key);
    // No entries remain; a second teardown must not throw and must stay empty.
    await destroyResources(ctx, common, key);
    assertEquals((await listEntries(common)).length, 0);
  });
});

Deno.test("GC reclaims a vanished worktree's resource and clears the entry", async () => {
  await withTempDir(async (dir) => {
    await mainRepo(dir);
    const wt = await addWorktree(dir, "ghost");
    const markers = join(dir, "markers");
    await Deno.writeTextFile(join(wt, "discern.toml"), resourceConfig(markers));
    const { settings, identity } = await identityOf(wt, wt);
    const { common, key } = await commonAndKey(wt);
    await createResources(await ctxFor(wt), identity, settings, common, key);
    const handle = resourceForId(settings.slug, identity.id, "thing");

    // The worktree vanishes WITHOUT a clean teardown.
    await Deno.remove(wt, { recursive: true });

    const result = await gcOrphanResources({
      commonGitDir: common,
      cwd: dir,
      liveGitKeys: await liveWorktreeGitKeys(common),
      livePaths: await liveWorktreePaths(dir),
      liveIdentities: new Set(),
      dryRun: false,
      log: quietLog(),
    });
    assertEquals(result.reclaimed, [handle]);
    assert(
      await exists(join(markers, `${handle}.gone`)),
      "GC did not run destroy",
    );
    assertEquals(
      (await listEntries(common)).length,
      0,
      "GC did not clear the entry",
    );
  });
});

Deno.test("GC keeps a LIVE worktree's resource (never reclaims it)", async () => {
  await withTempDir(async (dir) => {
    await mainRepo(dir);
    const wt = await addWorktree(dir, "live");
    const markers = join(dir, "markers");
    await Deno.writeTextFile(join(wt, "discern.toml"), resourceConfig(markers));
    const { settings, identity } = await identityOf(wt, wt);
    const { common, key } = await commonAndKey(wt);
    await createResources(await ctxFor(wt), identity, settings, common, key);
    const handle = resourceForId(settings.slug, identity.id, "thing");

    // The worktree is still alive — GC must not touch it.
    const result = await gcOrphanResources({
      commonGitDir: common,
      cwd: dir,
      liveGitKeys: await liveWorktreeGitKeys(common),
      livePaths: await liveWorktreePaths(dir),
      liveIdentities: new Set(),
      dryRun: false,
      log: quietLog(),
    });
    assertEquals(result.reclaimed.length, 0);
    assertEquals(result.kept, 1);
    assert(
      !(await exists(join(markers, `${handle}.gone`))),
      "GC destroyed a live resource",
    );
    assertEquals(
      (await listEntries(common)).length,
      1,
      "GC dropped a live entry",
    );
  });
});

Deno.test("GC recycling guard: a handle a live worktree still owns is kept", async () => {
  await withTempDir(async (dir) => {
    await mainRepo(dir);
    const wt = await addWorktree(dir, "recyc");
    const markers = join(dir, "markers");
    await Deno.writeTextFile(join(wt, "discern.toml"), resourceConfig(markers));
    const { settings, identity } = await identityOf(wt, wt);
    const { common, key } = await commonAndKey(wt);
    await createResources(await ctxFor(wt), identity, settings, common, key);
    const handle = resourceForId(settings.slug, identity.id, "thing");
    await Deno.remove(wt, { recursive: true }); // key now "gone"…

    // …but a live worktree still holds the SAME handle: refuse to reclaim it.
    const result = await gcOrphanResources({
      commonGitDir: common,
      cwd: dir,
      liveGitKeys: new Set(),
      livePaths: new Set(),
      liveIdentities: new Set([handle]),
      dryRun: false,
      log: quietLog(),
    });
    assertEquals(result.reclaimed.length, 0);
    assert(!(await exists(join(markers, `${handle}.gone`))));
    assertEquals((await listEntries(common)).length, 1);
  });
});

Deno.test("GC --dry-run reports the orphan but acts on nothing", async () => {
  await withTempDir(async (dir) => {
    await mainRepo(dir);
    const wt = await addWorktree(dir, "dry");
    const markers = join(dir, "markers");
    await Deno.writeTextFile(join(wt, "discern.toml"), resourceConfig(markers));
    const { settings, identity } = await identityOf(wt, wt);
    const { common, key } = await commonAndKey(wt);
    await createResources(await ctxFor(wt), identity, settings, common, key);
    const handle = resourceForId(settings.slug, identity.id, "thing");
    await Deno.remove(wt, { recursive: true });

    const result = await gcOrphanResources({
      commonGitDir: common,
      cwd: dir,
      liveGitKeys: await liveWorktreeGitKeys(common),
      livePaths: await liveWorktreePaths(dir),
      liveIdentities: new Set(),
      dryRun: true,
      log: quietLog(),
    });
    assertEquals(result.reclaimed, [handle]); // reported…
    assert(
      !(await exists(join(markers, `${handle}.gone`))),
      "dry-run ran destroy",
    );
    assertEquals(
      (await listEntries(common)).length,
      1,
      "dry-run cleared the entry",
    );
  });
});

Deno.test("GC never reclaims a gc=false resource (teardown-only)", async () => {
  await withTempDir(async (dir) => {
    await mainRepo(dir);
    const wt = await addWorktree(dir, "nogc");
    const markers = join(dir, "markers");
    await Deno.writeTextFile(
      join(wt, "discern.toml"),
      resourceConfig(markers, { gc: false }),
    );
    const { settings, identity } = await identityOf(wt, wt);
    const { common, key } = await commonAndKey(wt);
    await createResources(await ctxFor(wt), identity, settings, common, key);
    await Deno.remove(wt, { recursive: true });

    const result = await gcOrphanResources({
      commonGitDir: common,
      cwd: dir,
      liveGitKeys: new Set(),
      livePaths: new Set(),
      liveIdentities: new Set(),
      dryRun: false,
      log: quietLog(),
    });
    assertEquals(result.reclaimed.length, 0);
    assertEquals(
      (await listEntries(common)).length,
      1,
      "gc=false entry was reclaimed",
    );
  });
});

Deno.test("GC refuses a frozen destroy command that still carries a token", async () => {
  await withTempDir(async (dir) => {
    await mainRepo(dir);
    const wt = await addWorktree(dir, "tok");
    const { common } = await commonAndKey(wt);
    // Hand-write an entry whose destroy_command was never fully expanded.
    await writeEntry(common, {
      schema: 1,
      seq: 0,
      project_slug: "proj",
      git_key: "long-gone",
      worktree_id: "long-gone",
      worktree_path: join(dir, "gone"),
      resource_name: "thing",
      resource_identity: "proj-long-gone-thing",
      destroy_command: "rm -rf @dir@/cache", // unresolved token!
      token_map: {},
      retries: 0,
      gc: true,
      created_at: "2020-01-01T00:00:00.000Z",
    });
    const result = await gcOrphanResources({
      commonGitDir: common,
      cwd: dir,
      liveGitKeys: new Set(),
      livePaths: new Set(),
      liveIdentities: new Set(),
      dryRun: false,
      log: quietLog(),
    });
    assertEquals(result.reclaimed.length, 0);
    assert(
      result.failed,
      "an unresolved-token destroy should mark the run failed",
    );
    assertEquals(
      (await listEntries(common)).length,
      1,
      "the suspicious entry was kept",
    );
  });
});
