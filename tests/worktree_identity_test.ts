/**
 * Risk R1 parity: the TS worktree identity MUST reproduce the exact port/site/db/
 * branch/id values the shell engine produces. These vectors were captured from
 * `templates/.discern/engine/worktree-name` + system `cksum` (see the fixture's
 * `_provenance`). A drift here silently shifts every existing worktree's identity.
 *
 * Two layers are pinned: the POSIX `cksum` vectors (the hash the derivation rests
 * on) and the full identity cases (id/site/branch/port/db for slug `discern`).
 */

import { assert, assertEquals, assertMatch } from "@std/assert";
import { join } from "@std/path";
import { cksumString } from "../src/shared/crc.ts";
import {
  dbNameForId,
  deriveIdentity,
  fitSiteId,
  generateWorktreeId,
  type IdentitySettings,
  portForId,
  resolveWorktreeId,
  siteForId,
  validateOverrideId,
} from "../src/engine/worktree/identity.ts";
import { fakeEnv, withTempDir } from "./helpers.ts";
import { addWorktree, gitInit } from "./engine_helpers.ts";

interface CksumVector {
  input: string;
  crc: number;
  octets: number;
}

interface IdentityCase {
  id: string;
  port: number;
  site: string;
  db: string;
  branch: string;
}

interface ParityFixture {
  cksum: CksumVector[];
  identity: {
    slug: string;
    branch_prefix: string;
    cases: IdentityCase[];
  };
}

const fixture: ParityFixture = JSON.parse(
  await Deno.readTextFile(
    new URL(
      "./fixtures/parity/worktree-identity.json",
      import.meta.url,
    ),
  ),
);

Deno.test("POSIX cksum parity vectors", () => {
  for (const v of fixture.cksum) {
    assertEquals(
      cksumString(v.input),
      v.crc,
      `cksum('${v.input}') should be ${v.crc}`,
    );
  }
});

Deno.test("deriveIdentity reproduces the shell engine's identity vectors", () => {
  const settings: IdentitySettings = {
    slug: fixture.identity.slug,
    branchPrefix: fixture.identity.branch_prefix,
  };
  for (const c of fixture.identity.cases) {
    const got = deriveIdentity(c.id, settings);
    assertEquals(got.id, c.id, `id for '${c.id}'`);
    assertEquals(got.port, c.port, `port for '${c.id}'`);
    assertEquals(got.site, c.site, `site for '${c.id}'`);
    assertEquals(got.db, c.db, `db for '${c.id}'`);
    assertEquals(got.branch, c.branch, `branch for '${c.id}'`);
  }
});

Deno.test("the pure derivation helpers match the vectors", () => {
  const slug = fixture.identity.slug;
  for (const c of fixture.identity.cases) {
    assertEquals(portForId(c.id), c.port, `portForId('${c.id}')`);
    assertEquals(siteForId(slug, c.id), c.site, `siteForId('${c.id}')`);
    assertEquals(dbNameForId(slug, c.id), c.db, `dbNameForId('${c.id}')`);
  }
});

Deno.test("generateWorktreeId mints a readable, valid, unique id (the discern start basis)", () => {
  // Shape: <adjective>-<noun>-<hex tail>, all slug-safe — readable like the names
  // Claude Code's hook supplies, but minted by discern for `discern start`.
  const id = generateWorktreeId();
  assertMatch(id, /^[a-z]+-[a-z]+-[0-9a-f]{6}$/);

  // It is a valid identity id: the override validator accepts it unchanged, and the
  // derived branch is the clean `agent/<id>` `discern start` puts the worktree on.
  assertEquals(
    validateOverrideId(id),
    id,
    `minted id '${id}' must be slug-valid`,
  );
  assertEquals(
    deriveIdentity(id, { slug: "discern", branchPrefix: "agent/" }).branch,
    `agent/${id}`,
  );

  // Fresh across calls: the hex tail makes a repeated call collide only by
  // astronomical chance, so a batch must be all-distinct (the property `discern
  // start` relies on to never re-mint a live worktree's id).
  const batch = Array.from({ length: 500 }, () => generateWorktreeId());
  assertEquals(new Set(batch).size, batch.length, "minted ids must be unique");
  assert(
    new Set(batch.map((i) => i.split("-").slice(0, 2).join("-"))).size > 1,
    "the word pair should vary across a large batch (not a constant prefix)",
  );
});

Deno.test("the long-id case triggers the fit_site_id tail hash (documented double dash)", () => {
  const slug = fixture.identity.slug;
  const longCase = fixture.identity.cases.find((c) => c.id.length > 55);
  if (!longCase) {
    throw new Error("expected a long-id case in the fixture");
  }
  // max_id_len = 63 - 7 - 1 = 55; the id is 67 chars, so it clamps + hashes.
  const fitted = fitSiteId(slug, longCase.id);
  assertEquals(`${slug}-${fitted}`, longCase.site);
  // The clamp lands on a dash boundary, producing the documented `--` join.
  if (!longCase.site.includes("--")) {
    throw new Error("expected the documented double-dash in the long-id site");
  }
  // db must NOT clamp (the full id survives, underscore-joined).
  assertEquals(dbNameForId(slug, longCase.id), longCase.db);
});

Deno.test("resolveWorktreeId honours the DISCERN_WORKTREE_ID env override (parity ids)", async () => {
  const settings: IdentitySettings = {
    slug: fixture.identity.slug,
    branchPrefix: fixture.identity.branch_prefix,
  };
  for (const c of fixture.identity.cases) {
    // The override path validates + sanitizes; every fixture id is already a
    // clean slug, so it round-trips to the same value the derivation expects.
    // The override is injected, not set on the process env, so the case loop is
    // safe to interleave with other files under `deno test --parallel`.
    const id = await resolveWorktreeId(
      settings,
      undefined,
      fakeEnv({ DISCERN_WORKTREE_ID: c.id }),
    );
    assertEquals(id, c.id, `resolveWorktreeId override for '${c.id}'`);
    const identity = deriveIdentity(id, settings);
    assertEquals(identity.port, c.port);
    assertEquals(identity.site, c.site);
    assertEquals(identity.db, c.db);
    assertEquals(identity.branch, c.branch);
  }
});

Deno.test("an invalid DISCERN_WORKTREE_ID override is rejected", async () => {
  const settings: IdentitySettings = {
    slug: "discern",
    branchPrefix: "agent/",
  };
  let threw = false;
  try {
    await resolveWorktreeId(
      settings,
      undefined,
      fakeEnv({ DISCERN_WORKTREE_ID: "has spaces/and!bad" }),
    );
  } catch (e) {
    threw = true;
    assertEquals((e as Error).name, "IdentityError");
  }
  assertEquals(
    threw,
    true,
    "an invalid override id should throw IdentityError",
  );
});

Deno.test("sanitization: an override id is lowercased and dash-normalised", async () => {
  const settings: IdentitySettings = {
    slug: "discern",
    branchPrefix: "agent/",
  };
  const id = await resolveWorktreeId(
    settings,
    undefined,
    fakeEnv({ DISCERN_WORKTREE_ID: "Feat.X" }),
  );
  assertEquals(id, "feat-x");
  const got = deriveIdentity(id, settings);
  assertEquals(got.branch, "agent/feat-x");
  assertEquals(got.db, "discern_feat_x");
});

Deno.test("metadata ids colliding with the project slug get a wt- prefix", async () => {
  const settings: IdentitySettings = {
    slug: "discern",
    branchPrefix: "agent/",
  };
  await withTempDir(async (dir) => {
    await Deno.writeTextFile(join(dir, "README.md"), "scaffold\n");
    await gitInit(dir);
    for (
      const [worktreeName, expected] of [
        ["discern", "wt-discern"],
        ["discern42", "wt-discern42"],
      ] as const
    ) {
      const worktree = await addWorktree(dir, worktreeName);
      assertEquals(
        await resolveWorktreeId(settings, worktree, fakeEnv()),
        expected,
      );
    }
  });
});
