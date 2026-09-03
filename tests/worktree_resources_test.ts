/**
 * Unit coverage for the per-worktree resource layer — the identity handles, the
 * spec reader, the `.env` upsert, the ledger, and (the safety-critical part) the
 * conservative orphan GC. The end-to-end lifecycle is driven through the CLI in
 * `engine_worktree_resources_test.ts`; this pins the guards directly so a wrong
 * change to GC fails loudly: GC reclaims a vanished worktree's resource AND
 * NOTHING ELSE (never a live one, never a recycled handle, never a half-expanded
 * command, never a gc-opted-out one).
 */

import { assert, assertEquals, assertExists, assertRejects } from "@std/assert";
import { join } from "@std/path";
import { targetExists } from "../src/shared/fs_presence.ts";
import { fakeEnv, pinnedTerminal, withTempDir } from "./helpers.ts";
import { addWorktree, gitInit } from "./engine_helpers.ts";
import { Logger } from "../src/lib/log.ts";
import { loadConfig, parseConfigOrThrow } from "../src/shared/config_schema.ts";
import {
  deriveIdentity,
  type IdentitySettings,
  loadIdentitySettings,
  resolveWorktreeId,
  resourceForId,
  worktreeBase,
  type WorktreeIdentity,
} from "../src/engine/worktree/identity.ts";
import {
  upsertEnvLine,
  WORKTREE_ENVIRONMENT_MARKER_SUBJECT,
  writeEnvVar,
} from "../src/engine/worktree/env_file.ts";
import { managedValuesMarker } from "../src/shared/brand.ts";
import { ARTIFACT_PROVENANCE_SOURCES } from "../src/shared/file_ownership.ts";
import { DISCERN_NO_ATTRIBUTION } from "../src/shared/env.ts";
import {
  createResources,
  destroyResources,
  ensureResources,
  entriesForWorktree,
  gcOrphanResources,
  listEntries,
  readEntry,
  readResourceSpecs,
  resourceCommandEnv,
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

/** A logger that doesn't clutter test output (writes to stderr, colour off),
 * with a pinned terminal context so nothing floats with the ambient locale. */
function quietLog(): Logger {
  return new Logger({
    json: false,
    noColor: true,
    humanStream: "stderr",
    terminal: pinnedTerminal(),
  });
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

Deno.test("resourceForId: differing project slugs produce different handles", () => {
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
  const cfg = parseConfigOrThrow(`[worktree.resources.zebra]
create = "z"
[worktree.resources.alpha]
create = "a"
`);
  assertEquals(readResourceSpecs(cfg).map((s) => s.name), ["zebra", "alpha"]);
});

Deno.test("readResourceSpecs: required/gc default true; retries default 0", () => {
  const cfg = parseConfigOrThrow(`[worktree.resources.a]
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
  const env = fakeEnv();
  const marker = managedValuesMarker(
    WORKTREE_ENVIRONMENT_MARKER_SUBJECT,
    ARTIFACT_PROVENANCE_SOURCES.worktreeEnvironment,
    env,
  );
  // replace the first matching line, value only
  assertEquals(
    upsertEnvLine("A=1\nB=2\n", "A", "9", env),
    `${marker}\nA=9\nB=2\n`,
  );
  // append before the trailing blank when the file ends with a newline
  assertEquals(
    upsertEnvLine("A=1\n", "B", "2", env),
    `${marker}\nA=1\nB=2\n`,
  );
  // append onto an unterminated last line
  assertEquals(
    upsertEnvLine("A=1", "B", "2", env),
    `${marker}\nA=1\nB=2`,
  );
});

Deno.test("upsertEnvLine replaces the opposite attribution mode", () => {
  const attributedEnv = fakeEnv();
  const sourceOnlyEnv = fakeEnv({ [DISCERN_NO_ATTRIBUTION]: "1" });
  const attributed = managedValuesMarker(
    WORKTREE_ENVIRONMENT_MARKER_SUBJECT,
    ARTIFACT_PROVENANCE_SOURCES.worktreeEnvironment,
    attributedEnv,
  );
  const sourceOnly = managedValuesMarker(
    WORKTREE_ENVIRONMENT_MARKER_SUBJECT,
    ARTIFACT_PROVENANCE_SOURCES.worktreeEnvironment,
    sourceOnlyEnv,
  );

  assertEquals(
    upsertEnvLine(`${attributed}\nA=1\n`, "A", "2", sourceOnlyEnv),
    `${sourceOnly}\nA=2\n`,
  );
  assertEquals(
    upsertEnvLine(`${sourceOnly}\nA=2\n`, "A", "3", attributedEnv),
    `${attributed}\nA=3\n`,
  );
});

Deno.test("worktree env writes create only on request at 0600 and preserve existing modes", async () => {
  await withTempDir(async (root) => {
    const envPath = join(root, ".env");
    assertEquals(await writeEnvVar(root, "A", "1"), false);
    assertEquals(await targetExists(envPath), false);

    assertEquals(
      await writeEnvVar(root, "A", "1", [".env"], { create: true }),
      true,
    );
    assertEquals(((await Deno.stat(envPath)).mode ?? 0) & 0o777, 0o600);

    await Deno.chmod(envPath, 0o640);
    assertEquals(await writeEnvVar(root, "A", "2", [".env"]), true);
    assertEquals(((await Deno.stat(envPath)).mode ?? 0) & 0o777, 0o640);
  });
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

/** Like {@link resourceConfig} but with a create that APPENDS a line each run, so a
 * test can prove create ran exactly once across repeated setups. */
function countingResourceConfig(markers: string): string {
  return `[project]
slug = "proj"

[worktree.resources.thing]
create  = "mkdir -p ${markers} && echo c >> ${markers}/@resource@.create"
destroy = "rm -f ${markers}/@resource@.create"
`;
}

/** A create-only counting resource. Its ready entry is the durable run-once
 * evidence even though it has no destroy action. */
function createOnlyCountingConfig(markers: string): string {
  return `[project]
slug = "proj"

[worktree.resources.thing]
create = "mkdir -p ${markers} && echo c >> ${markers}/@resource@.create"
`;
}

/** Build a ResourceContext rooted at a worktree. */
async function ctxFor(worktree: string): Promise<ResourceContext> {
  return {
    config: await loadConfig(worktree),
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
    assert(
      await targetExists(join(markers, `${handle}.live`)),
      "create did not run",
    );
    const entries = await listEntries(common);
    assertEquals(entries.length, 1);
    const first = entries[0];
    assertExists(first);
    assertEquals(first.entry.resource_identity, handle);
    assertEquals(first.entry.phase, "ready");
    assertEquals(
      first.entry.worktree_handle,
      worktreeBase(settings.slug, identity.id),
    );

    await destroyResources(ctx, await entriesForWorktree(common, key));
    assert(
      await targetExists(join(markers, `${handle}.gone`)),
      "destroy did not run",
    );
    assert(
      !(await targetExists(join(markers, `${handle}.live`))),
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
    await destroyResources(ctx, await entriesForWorktree(common, key));
    // No entries remain; a second teardown must not throw and must stay empty.
    await destroyResources(ctx, await entriesForWorktree(common, key));
    assertEquals((await listEntries(common)).length, 0);
  });
});

Deno.test("createResources is idempotent: a provisioned resource skips create on re-run", async () => {
  await withTempDir(async (dir) => {
    await mainRepo(dir);
    const wt = await addWorktree(dir, "idem-create");
    const markers = join(dir, "markers");
    await Deno.writeTextFile(
      join(wt, "discern.toml"),
      countingResourceConfig(markers),
    );
    const { settings, identity } = await identityOf(wt, wt);
    const { common, key } = await commonAndKey(wt);
    const ctx = await ctxFor(wt);

    await createResources(ctx, identity, settings, common, key);
    // Re-entering setup must not re-run create: the ready entry proves completion.
    await createResources(ctx, identity, settings, common, key);

    const handle = resourceForId(settings.slug, identity.id, "thing");
    assertEquals(
      await Deno.readTextFile(join(markers, `${handle}.create`)),
      "c\n",
      "create must run exactly once across two setups",
    );
    assertEquals(
      (await listEntries(common)).length,
      1,
      "the re-run must not write a second ledger entry",
    );
  });
});

Deno.test("a failed optional create leaves intent, then cleanup runs before a successful retry", async () => {
  await withTempDir(async (dir) => {
    await mainRepo(dir);
    const wt = await addWorktree(dir, "retry-intent");
    const markers = join(dir, "markers");
    await Deno.writeTextFile(
      join(wt, "discern.toml"),
      `[project]
slug = "proj"

[worktree.resources.thing]
create = "mkdir -p ${markers} && echo create >> ${markers}/attempts && touch ${markers}/partial && test -f ${markers}/allow"
destroy = "echo cleanup >> ${markers}/cleanups && rm -f ${markers}/partial"
required = false
`,
    );
    const { settings, identity } = await identityOf(wt, wt);
    const { common, key } = await commonAndKey(wt);
    const ctx = await ctxFor(wt);

    assertEquals(
      (await createResources(ctx, identity, settings, common, key)).failed,
      ["thing"],
    );
    assertEquals((await listEntries(common))[0]?.entry.phase, "intent");
    await Deno.writeTextFile(join(markers, "allow"), "");

    assertEquals(
      (await createResources(ctx, identity, settings, common, key)).failed,
      [],
    );
    assertEquals(
      await Deno.readTextFile(join(markers, "cleanups")),
      "cleanup\n",
    );
    assertEquals(
      await Deno.readTextFile(join(markers, "attempts")),
      "create\ncreate\n",
    );
    assertEquals((await listEntries(common))[0]?.entry.phase, "ready");
  });
});

Deno.test("uncertain create intent without a frozen cleanup refuses a replay", async () => {
  await withTempDir(async (dir) => {
    await mainRepo(dir);
    const wt = await addWorktree(dir, "unsafe-intent");
    const attempts = join(dir, "attempts");
    await Deno.writeTextFile(
      join(wt, "discern.toml"),
      `[project]
slug = "proj"

[worktree.resources.thing]
create = "echo create >> ${attempts} && false"
required = false
`,
    );
    const { settings, identity } = await identityOf(wt, wt);
    const { common, key } = await commonAndKey(wt);
    const ctx = await ctxFor(wt);

    await createResources(ctx, identity, settings, common, key);
    await assertRejects(
      () => createResources(ctx, identity, settings, common, key),
      Error,
      "cleanup could not prove a safe reset",
    );
    assertEquals(await Deno.readTextFile(attempts), "create\n");
    assertEquals((await listEntries(common))[0]?.entry.phase, "intent");
  });
});

Deno.test("resource create, ensure, and destroy derive the same two environment keys", async () => {
  assertEquals(
    resourceCommandEnv("thing", "resource-handle", "worktree-handle"),
    {
      DISCERN_RESOURCE_THING: "resource-handle",
      DISCERN_WORKTREE: "worktree-handle",
    },
  );

  await withTempDir(async (dir) => {
    await mainRepo(dir);
    const wt = await addWorktree(dir, "env-contract");
    const markers = join(dir, "markers");
    const capture =
      `mkdir -p ${markers} && env | sed -n '/^DISCERN_RESOURCE_THING=/p; /^DISCERN_WORKTREE=/p' | sort`;
    await Deno.writeTextFile(
      join(wt, "discern.toml"),
      `[project]
slug = "proj"

[worktree.resources.thing]
create = "${capture} > ${markers}/create"
ensure = "${capture} > ${markers}/ensure"
destroy = "${capture} > ${markers}/destroy"
`,
    );
    const { settings, identity } = await identityOf(wt, wt);
    const { common, key } = await commonAndKey(wt);
    const ctx = await ctxFor(wt);
    await createResources(ctx, identity, settings, common, key);
    await ensureResources(ctx, identity, settings);
    await destroyResources(ctx, await entriesForWorktree(common, key));

    const expected = await Deno.readTextFile(join(markers, "create"));
    assertEquals(await Deno.readTextFile(join(markers, "ensure")), expected);
    assertEquals(await Deno.readTextFile(join(markers, "destroy")), expected);
    assertEquals(expected.split("\n").filter(Boolean).length, 2);

    // Recreate, then let orphan GC use the same frozen destroy boundary.
    await createResources(ctx, identity, settings, common, key);
    await Deno.remove(wt, { recursive: true });
    const gc = await gcOrphanResources({
      commonGitDir: common,
      cwd: dir,
      liveGitKeys: new Set(),
      livePaths: new Set(),
      liveIdentities: new Set(),
      dryRun: false,
      log: quietLog(),
    });
    assertEquals(gc.failed, false);
    assertEquals(await Deno.readTextFile(join(markers, "destroy")), expected);
  });
});

Deno.test("createResources is idempotent for a CREATE-ONLY resource (no destroy): create runs exactly once across re-entries", async () => {
  // Ready evidence enrolls every managed resource, including one with no
  // cleanup command.
  await withTempDir(async (dir) => {
    await mainRepo(dir);
    const wt = await addWorktree(dir, "create-only");
    const markers = join(dir, "markers");
    await Deno.writeTextFile(
      join(wt, "discern.toml"),
      createOnlyCountingConfig(markers),
    );
    const { settings, identity } = await identityOf(wt, wt);
    const { common, key } = await commonAndKey(wt);
    const ctx = await ctxFor(wt);

    // Three setup entries; create must fire on the first and be skipped after.
    await createResources(ctx, identity, settings, common, key);
    await createResources(ctx, identity, settings, common, key);
    await createResources(ctx, identity, settings, common, key);

    const handle = resourceForId(settings.slug, identity.id, "thing");
    assertEquals(
      await Deno.readTextFile(join(markers, `${handle}.create`)),
      "c\n",
      "a create-only resource re-ran create across setups (no run-once marker)",
    );
    // Exactly one ready entry exists, with an empty destroy action.
    const entries = await listEntries(common);
    assertEquals(
      entries.length,
      1,
      "create-only resource left no run-once marker",
    );
    assertEquals(entries[0]?.entry.destroy_command, "");
    assertEquals(entries[0]?.entry.phase, "ready");
  });
});

Deno.test("GC reclaims a non-ready orphan through its frozen cleanup", async () => {
  await withTempDir(async (dir) => {
    await mainRepo(dir);
    const wt = await addWorktree(dir, "intent-orphan");
    const marker = join(dir, "partial");
    await Deno.writeTextFile(
      join(wt, "discern.toml"),
      `[project]
slug = "proj"

[worktree.resources.thing]
create = "touch ${marker} && false"
destroy = "rm -f ${marker}"
required = false
`,
    );
    const { settings, identity } = await identityOf(wt, wt);
    const { common, key } = await commonAndKey(wt);
    await createResources(await ctxFor(wt), identity, settings, common, key);
    assertEquals((await listEntries(common))[0]?.entry.phase, "intent");
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
    assertEquals(result.reclaimed.length, 1);
    assertEquals(await targetExists(marker), false);
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
      await targetExists(join(markers, `${handle}.gone`)),
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
      !(await targetExists(join(markers, `${handle}.gone`))),
      "GC destroyed a live resource",
    );
    assertEquals(
      (await listEntries(common)).length,
      1,
      "GC dropped a live entry",
    );
  });
});

Deno.test("GC re-checks liveness on disk and keeps a resource the snapshot wrongly omitted (C1 race)", async () => {
  await withTempDir(async (dir) => {
    await mainRepo(dir);
    const wt = await addWorktree(dir, "racy");
    const markers = join(dir, "markers");
    await Deno.writeTextFile(join(wt, "discern.toml"), resourceConfig(markers));
    const { settings, identity } = await identityOf(wt, wt);
    const { common, key } = await commonAndKey(wt);
    await createResources(await ctxFor(wt), identity, settings, common, key);
    const handle = resourceForId(settings.slug, identity.id, "thing");

    // The worktree is LIVE on disk, but the liveness SNAPSHOT wrongly omits it (a
    // stale snapshot taken before a concurrent create registered/recycled the
    // key). The fresh per-entry re-check must keep it — never destroy a live one.
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
      !(await targetExists(join(markers, `${handle}.gone`))),
      "GC destroyed a live resource despite a stale snapshot",
    );
    assertEquals((await listEntries(common)).length, 1);
  });
});

Deno.test("GC re-checks HANDLE liveness on disk and keeps an orphan whose handle a mid-loop create recycled (M1)", async () => {
  await withTempDir(async (dir) => {
    await mainRepo(dir);
    const wt = await addWorktree(dir, "recycled");
    const markers = join(dir, "markers");
    await Deno.writeTextFile(join(wt, "discern.toml"), resourceConfig(markers));
    const { settings, identity } = await identityOf(wt, wt);
    const { common, key } = await commonAndKey(wt);
    await createResources(await ctxFor(wt), identity, settings, common, key);
    const handle = resourceForId(settings.slug, identity.id, "thing");

    // The owning worktree is GENUINELY gone (its git_key is dead, the entry is a
    // true orphan the snapshot + gitKeyIsLive both classify as reclaimable). But a
    // worktree created DURING the destroy loop now owns the same HANDLE under a
    // different git_key — modelled by recheckIdentityLive returning true. The
    // freshest guard (M1) must veto the destroy, else GC kills the live tenant.
    await Deno.remove(wt, { recursive: true });

    const result = await gcOrphanResources({
      commonGitDir: common,
      cwd: dir,
      liveGitKeys: await liveWorktreeGitKeys(common),
      livePaths: await liveWorktreePaths(dir),
      liveIdentities: new Set(), // snapshot: handle NOT yet live
      recheckIdentityLive: (id) => Promise.resolve(id === handle), // fresh: now live
      dryRun: false,
      log: quietLog(),
    });

    assertEquals(
      result.reclaimed.length,
      0,
      "M1: destroyed a recycled-live handle",
    );
    assert(result.kept >= 1);
    assert(
      !(await targetExists(join(markers, `${handle}.gone`))),
      "M1: GC ran destroy on a handle a live worktree now owns",
    );
    assertEquals(
      (await listEntries(common)).length,
      1,
      "M1: GC dropped the entry of a recycled-live handle",
    );
  });
});

Deno.test("GC reclaims ONLY the orphaned worktree's resource when a live one coexists (path-reuse keystone)", async () => {
  await withTempDir(async (dir) => {
    await mainRepo(dir);
    const markers = join(dir, "markers");
    const a = await addWorktree(dir, "gone");
    const b = await addWorktree(dir, "alive");
    for (const wt of [a, b]) {
      await Deno.writeTextFile(
        join(wt, "discern.toml"),
        resourceConfig(markers),
      );
      const { settings, identity } = await identityOf(wt, wt);
      const { common, key } = await commonAndKey(wt);
      await createResources(await ctxFor(wt), identity, settings, common, key);
    }
    const { settings: sa, identity: ia } = await identityOf(a, a);
    const { settings: sb, identity: ib } = await identityOf(b, b);
    const ha = resourceForId(sa.slug, ia.id, "thing");
    const hb = resourceForId(sb.slug, ib.id, "thing");
    const { common } = await commonAndKey(b);

    await Deno.remove(a, { recursive: true }); // A vanishes; B stays live.

    const result = await gcOrphanResources({
      commonGitDir: common,
      cwd: dir,
      liveGitKeys: await liveWorktreeGitKeys(common),
      livePaths: await liveWorktreePaths(dir),
      liveIdentities: new Set(),
      dryRun: false,
      log: quietLog(),
    });
    assertEquals(result.reclaimed, [ha]); // A's only
    assert(
      await targetExists(join(markers, `${ha}.gone`)),
      "A's orphan not reclaimed",
    );
    assert(
      !(await targetExists(join(markers, `${hb}.gone`))),
      "B's LIVE resource was destroyed",
    );
    const remaining = await listEntries(common);
    assertEquals(remaining.length, 1);
    assertEquals(remaining[0]?.entry.resource_identity, hb);
  });
});

Deno.test("two worktrees set up concurrently write two distinct ledger entries (no corruption)", async () => {
  await withTempDir(async (dir) => {
    await mainRepo(dir);
    const markers = join(dir, "markers");
    const a = await addWorktree(dir, "one");
    const b = await addWorktree(dir, "two");
    await Promise.all([a, b].map(async (wt) => {
      await Deno.writeTextFile(
        join(wt, "discern.toml"),
        resourceConfig(markers),
      );
      const { settings, identity } = await identityOf(wt, wt);
      const { common, key } = await commonAndKey(wt);
      await createResources(await ctxFor(wt), identity, settings, common, key);
    }));
    const { common } = await commonAndKey(a);
    const entries = await listEntries(common);
    assertEquals(
      entries.length,
      2,
      "concurrent setups did not produce 2 entries",
    );
    assertEquals(new Set(entries.map((e) => e.entry.git_key)).size, 2);
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
    assert(!(await targetExists(join(markers, `${handle}.gone`))));
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
      !(await targetExists(join(markers, `${handle}.gone`))),
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
      phase: "ready",
      seq: 0,
      project_slug: "proj",
      git_key: "long-gone",
      worktree_id: "long-gone",
      worktree_handle: "proj-long-gone",
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

// ── ledger validation: a file is trusted only if it is a well-formed entry ─────

/** A complete, well-formed ledger entry — the baseline the validation tests mutate. */
const VALID_ENTRY = {
  schema: 1,
  phase: "ready",
  seq: 0,
  project_slug: "proj",
  git_key: "gone",
  worktree_id: "gone",
  worktree_handle: "proj-gone",
  worktree_path: "/tmp/gone",
  resource_name: "thing",
  resource_identity: "proj-gone-thing",
  destroy_command: "destroy-thing proj-gone-thing",
  token_map: {},
  retries: 0,
  gc: true,
  created_at: "2020-01-01T00:00:00.000Z",
};

Deno.test("readEntry validates the entry shape: a well-formed file loads", async () => {
  await withTempDir(async (dir) => {
    const path = join(dir, "ok.json");
    await Deno.writeTextFile(path, JSON.stringify(VALID_ENTRY));
    const entry = await readEntry(path);
    assertExists(entry);
    assertEquals(entry.resource_name, "thing");
  });
});

Deno.test("readEntry skips a malformed, incomplete, foreign-major, or non-JSON file", async () => {
  await withTempDir(async (dir) => {
    const write = async (name: string, value: unknown): Promise<string> => {
      const path = join(dir, name);
      await Deno.writeTextFile(
        path,
        typeof value === "string" ? value : JSON.stringify(value),
      );
      return path;
    };
    // Right `schema` marker but a wrong-typed field — the old cast trusted this;
    // the schema rejects it rather than handing GC a half-formed entry.
    assertEquals(
      await readEntry(
        await write("badtype.json", { ...VALID_ENTRY, retries: "lots" }),
      ),
      undefined,
    );
    // A required field missing.
    const withoutKey = { ...VALID_ENTRY } as Record<string, unknown>;
    delete withoutKey.git_key;
    assertEquals(
      await readEntry(await write("missing.json", withoutKey)),
      undefined,
    );
    // A future format major — skipped (forward-compat), as before.
    assertEquals(
      await readEntry(
        await write("future.json", { ...VALID_ENTRY, schema: 2 }),
      ),
      undefined,
    );
    // Not even JSON.
    assertEquals(
      await readEntry(await write("corrupt.json", "{not json")),
      undefined,
    );
  });
});
