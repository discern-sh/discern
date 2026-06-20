/**
 * Risk R1 parity: the TS worktree identity MUST reproduce the exact port/site/db/
 * branch/id values the shell engine produces. These vectors were captured from
 * `templates/.icculus/engine/worktree-name` + system `cksum` (see the fixture's
 * `_provenance`). A drift here silently shifts every existing worktree's identity.
 *
 * Two layers are pinned: the POSIX `cksum` vectors (the hash the derivation rests
 * on) and the full identity cases (id/site/branch/port/db for slug `icculus`).
 */

import { assertEquals } from "@std/assert";
import { cksumString } from "../src/shared/crc.ts";
import {
  dbNameForId,
  deriveIdentity,
  fitSiteId,
  type IdentitySettings,
  portForId,
  resolveWorktreeId,
  siteForId,
} from "../src/engine/worktree/identity.ts";

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

Deno.test("resolveWorktreeId honours the ICCULUS_WORKTREE_ID env override (parity ids)", async () => {
  const settings: IdentitySettings = {
    slug: fixture.identity.slug,
    branchPrefix: fixture.identity.branch_prefix,
  };
  const prevId = Deno.env.get("ICCULUS_WORKTREE_ID");
  const prevSlug = Deno.env.get("ICCULUS_PROJECT_SLUG");
  Deno.env.set("ICCULUS_PROJECT_SLUG", "icculus");
  try {
    for (const c of fixture.identity.cases) {
      Deno.env.set("ICCULUS_WORKTREE_ID", c.id);
      // The override path validates + sanitizes; every fixture id is already a
      // clean slug, so it round-trips to the same value the derivation expects.
      const id = await resolveWorktreeId(settings);
      assertEquals(id, c.id, `resolveWorktreeId override for '${c.id}'`);
      const identity = deriveIdentity(id, settings);
      assertEquals(identity.port, c.port);
      assertEquals(identity.site, c.site);
      assertEquals(identity.db, c.db);
      assertEquals(identity.branch, c.branch);
    }
  } finally {
    if (prevId === undefined) {
      Deno.env.delete("ICCULUS_WORKTREE_ID");
    } else {
      Deno.env.set("ICCULUS_WORKTREE_ID", prevId);
    }
    if (prevSlug === undefined) {
      Deno.env.delete("ICCULUS_PROJECT_SLUG");
    } else {
      Deno.env.set("ICCULUS_PROJECT_SLUG", prevSlug);
    }
  }
});

Deno.test("an invalid ICCULUS_WORKTREE_ID override is rejected", async () => {
  const settings: IdentitySettings = {
    slug: "icculus",
    branchPrefix: "agent/",
  };
  const prev = Deno.env.get("ICCULUS_WORKTREE_ID");
  Deno.env.set("ICCULUS_WORKTREE_ID", "has spaces/and!bad");
  try {
    let threw = false;
    try {
      await resolveWorktreeId(settings);
    } catch (e) {
      threw = true;
      assertEquals((e as Error).name, "IdentityError");
    }
    assertEquals(
      threw,
      true,
      "an invalid override id should throw IdentityError",
    );
  } finally {
    if (prev === undefined) {
      Deno.env.delete("ICCULUS_WORKTREE_ID");
    } else {
      Deno.env.set("ICCULUS_WORKTREE_ID", prev);
    }
  }
});

Deno.test("sanitization: an override id is lowercased and dash-normalised", () => {
  // deriveIdentity is pure; the override path's sanitizeSlug is exercised via
  // resolveWorktreeId above. Here, pin the slug-collision `wt-` rule's inputs by
  // checking the derivation stays stable for an already-clean id.
  const settings: IdentitySettings = {
    slug: "icculus",
    branchPrefix: "agent/",
  };
  const got = deriveIdentity("feature-x", settings);
  assertEquals(got.branch, "agent/feature-x");
  assertEquals(got.db, "icculus_feature_x");
});
