/**
 * Risk R1 parity: the TS worktree identity MUST reproduce the exact port/site/db/
 * branch/id values the shell engine produces. These vectors were captured from
 * `templates/.discern/engine/identity` + system `cksum` (see the fixture's
 * `_provenance`). A drift here silently shifts every existing worktree's identity.
 *
 * Two layers are pinned: the POSIX `cksum` vectors (the hash the derivation rests
 * on) and the full identity cases (id/site/branch/port/db for slug `discern`).
 */

import { assert, assertEquals, assertMatch } from "@std/assert";
import { join } from "@std/path";
import { cksumString } from "../src/shared/crc.ts";
import {
  chooseWorktreeName,
  dbNameForId,
  deriveIdentity,
  deriveTrunkIdentity,
  fitSiteId,
  generateWorktreeId,
  type IdentitySettings,
  NAME_SLUG_MAX,
  portForId,
  resolveIdentity,
  resolveWorktreeId,
  seedForBranch,
  siteForId,
  validateOverrideId,
} from "../src/engine/worktree/identity.ts";
import { fakeEnv, withTempDir } from "./helpers.ts";
import { addWorktree, gitInit } from "./engine_helpers.ts";
import { z } from "@zod/zod";
import { decodeWith } from "./decode_cli_result.ts";

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
  seed: number;
}

interface ParityFixture {
  cksum: CksumVector[];
  identity: {
    slug: string;
    branch_prefix: string;
    cases: IdentityCase[];
  };
}

const PARITY_FIXTURE_SCHEMA = z.object({
  cksum: z.array(z.object({
    input: z.string(),
    crc: z.number().int().nonnegative(),
    octets: z.number().int().nonnegative(),
  })),
  identity: z.object({
    slug: z.string(),
    branch_prefix: z.string(),
    cases: z.array(z.object({
      id: z.string(),
      port: z.number().int().positive(),
      site: z.string(),
      db: z.string(),
      branch: z.string(),
      seed: z.number().int().nonnegative(),
    })),
  }),
}).passthrough();

const fixture: ParityFixture = decodeWith(
  PARITY_FIXTURE_SCHEMA,
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
    assertEquals(got.seed, c.seed, `seed for '${c.id}'`);
  }
});

Deno.test("the pure derivation helpers match the vectors", () => {
  const slug = fixture.identity.slug;
  for (const c of fixture.identity.cases) {
    assertEquals(portForId(c.id), c.port, `portForId('${c.id}')`);
    assertEquals(siteForId(slug, c.id), c.site, `siteForId('${c.id}')`);
    assertEquals(dbNameForId(slug, c.id), c.db, `dbNameForId('${c.id}')`);
    assertEquals(
      seedForBranch(c.branch),
      c.seed,
      `seedForBranch('${c.branch}')`,
    );
  }
});

Deno.test("the trunk identity is branch-derived and constant for one configuration", () => {
  const settings: IdentitySettings = {
    slug: "discern",
    branchPrefix: "agent/",
    trunk: "release/stable",
  };
  const first = deriveTrunkIdentity(settings);
  const second = deriveTrunkIdentity(settings);
  assertEquals(first, second);
  assertEquals(first.id, "release-stable");
  assertEquals(first.branch, "release/stable");
  assertEquals(first.seed, seedForBranch("release/stable"));
  assertEquals(first.port, portForId("release-stable"));
});

Deno.test("resolveIdentity gives the main checkout and linked worktree first-class values", async () => {
  await withTempDir(async (dir) => {
    await Deno.writeTextFile(
      join(dir, "discern.toml"),
      '[project]\nslug = "discern"\n\n[repository]\ntrunk = "main"\n',
    );
    await gitInit(dir);
    const main = await resolveIdentity(dir, dir);
    assertEquals(main.id, "main");
    assertEquals(main.branch, "main");
    assertEquals(main.seed, seedForBranch("main"));

    const worktree = await addWorktree(dir, "resolved-identity");
    const linked = await resolveIdentity(dir, worktree);
    assertEquals(linked.id, "resolved-identity");
    assertEquals(linked.branch, "agent/resolved-identity");
    assertEquals(linked.seed, seedForBranch("agent/resolved-identity"));
  });
});

Deno.test("generateWorktreeId mints a readable, valid, unique id (the discern start basis)", () => {
  // With no name: <adjective>-<noun>-<hex tail>, all slug-safe — readable like the
  // names Claude Code's hook supplies, but minted by discern for `discern start`.
  const minted = generateWorktreeId();
  assertEquals(minted.source, "codename");
  assertMatch(minted.id, /^[a-z]+-[a-z]+-[0-9a-f]{6}$/);

  // It is a valid identity id: the override validator accepts it unchanged, and the
  // derived branch is the clean `agent/<id>` `discern start` puts the worktree on.
  assertEquals(
    validateOverrideId(minted.id),
    minted.id,
    `minted id '${minted.id}' must be slug-valid`,
  );
  assertEquals(
    deriveIdentity(minted.id, { slug: "discern", branchPrefix: "agent/" })
      .branch,
    `agent/${minted.id}`,
  );

  // Fresh across calls: the hex tail makes a repeated call collide only by
  // astronomical chance, so a batch must be all-distinct (the property `discern
  // start` relies on to never re-mint a live worktree's id).
  const batch = Array.from({ length: 500 }, () => generateWorktreeId().id);
  assertEquals(new Set(batch).size, batch.length, "minted ids must be unique");
  assert(
    new Set(batch.map((i) => i.split("-").slice(0, 2).join("-"))).size > 1,
    "the word pair should vary across a large batch (not a constant prefix)",
  );
});

Deno.test("generateWorktreeId(name) builds a <slug>-<hex> id and keeps the hex unique", () => {
  const first = generateWorktreeId("fix the upload retry");
  assertEquals(first.source, "name");
  assertMatch(first.id, /^fix-the-upload-retry-[0-9a-f]{6}$/);

  // Two worktrees sharing a name still get distinct ids — the hex tail, not the
  // words, is the uniqueness. This is what lets `discern start` name freely without
  // ever re-minting a live worktree's id.
  const second = generateWorktreeId("fix the upload retry");
  assertMatch(second.id, /^fix-the-upload-retry-[0-9a-f]{6}$/);
  assert(first.id !== second.id, "same name must still mint distinct ids");
});

// The class guard for "no caller string can break `discern start`". Every hostile
// name must reduce — without throwing — to a branch- and path-safe id (or a codename
// fallback), stay within the length cap, and round-trip as a valid identity id. The
// invariant is asserted off ONE predicate over the table, so a newly-discovered hazard
// added here is automatically held to the whole contract, not just spot-checked.
const SAFE_SLUG = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

interface NameCase {
  /** The raw name a caller might pass. */
  readonly name: string;
  /** Whether it yields a name-derived slug or a codename fallback. */
  readonly source: "name" | "codename";
  /** Whether a transparency note is expected. */
  readonly note: boolean;
  /** The exact slug, when worth pinning (omitted for truncation cases). */
  readonly slug?: string;
}

const NAME_CASES: readonly NameCase[] = [
  // Clean slugs pass straight through — nothing to normalise, no note.
  {
    name: "fix-upload-retry",
    source: "name",
    note: false,
    slug: "fix-upload-retry",
  },
  { name: "a", source: "name", note: false, slug: "a" },
  // Natural-language intent becomes a slug, with a note that it changed.
  {
    name: "Fix the upload retry path",
    source: "name",
    note: true,
    slug: "fix-the-upload-retry-path",
  },
  { name: "Fix Upload", source: "name", note: true, slug: "fix-upload" },
  {
    name: "   spaced   out   ",
    source: "name",
    note: true,
    slug: "spaced-out",
  },
  {
    name: "UPPER_snake_Case",
    source: "name",
    note: true,
    slug: "upper-snake-case",
  },
  // git-ref / path hazards never survive sanitisation.
  {
    name: "feature/auth/login",
    source: "name",
    note: true,
    slug: "feature-auth-login",
  },
  { name: "../../etc/passwd", source: "name", note: true, slug: "etc-passwd" },
  {
    name: "name..with..dots",
    source: "name",
    note: true,
    slug: "name-with-dots",
  },
  {
    name: "-leading-and-trailing-",
    source: "name",
    note: true,
    slug: "leading-and-trailing",
  },
  { name: "ends.lock", source: "name", note: true, slug: "ends-lock" },
  { name: "HEAD", source: "name", note: true, slug: "head" },
  // Over-length names shorten on a word boundary, within the cap (slug not pinned).
  {
    name:
      "add a really rather quite verbose and overly long descriptive name here",
    source: "name",
    note: true,
  },
  // Fully-stripped names fall back to a codename, with a note explaining it.
  { name: "🚀🔥✨", source: "codename", note: true },
  { name: "日本語のタスク", source: "codename", note: true },
  { name: "!!!", source: "codename", note: true },
  // Whitespace-only / empty are "no name at all": codename, and nothing to report.
  { name: "   ", source: "codename", note: false },
  { name: "", source: "codename", note: false },
];

Deno.test("chooseWorktreeName neutralises every hostile name (branch-safe or codename)", () => {
  for (const c of NAME_CASES) {
    const choice = chooseWorktreeName(c.name); // must never throw
    assertEquals(choice.source, c.source, `source for '${c.name}'`);
    assertEquals(
      choice.note !== undefined,
      c.note,
      `note presence for '${c.name}'`,
    );

    if (choice.source === "name") {
      assert(
        SAFE_SLUG.test(choice.slug),
        `slug '${choice.slug}' from '${c.name}' must be branch-safe`,
      );
      assert(
        choice.slug.length <= NAME_SLUG_MAX,
        `slug '${choice.slug}' from '${c.name}' must fit ${NAME_SLUG_MAX} chars`,
      );
      if (c.slug !== undefined) {
        assertEquals(choice.slug, c.slug, `slug for '${c.name}'`);
      }
    } else {
      assertEquals(
        choice.slug,
        "",
        `codename choice for '${c.name}' is slug-less`,
      );
    }

    // The load-bearing invariant: whatever the name, the minted id is a valid identity
    // id (round-trips through the override validator) and keeps its hex tail.
    const minted = generateWorktreeId(c.name);
    assertEquals(minted.source, c.source, `minted source for '${c.name}'`);
    assertEquals(
      validateOverrideId(minted.id),
      minted.id,
      `minted id '${minted.id}' from '${c.name}' must be a valid identity id`,
    );
    if (c.source === "codename") {
      assertMatch(
        minted.id,
        /^[a-z]+-[a-z]+-[0-9a-f]{6}$/,
        `codename id '${minted.id}' keeps the <adjective>-<noun>-<hex> shape`,
      );
    } else {
      assertMatch(
        minted.id,
        new RegExp(`^${choice.slug}-[0-9a-f]{6}$`),
        `named id '${minted.id}' must be <slug>-<hex>`,
      );
    }
  }
});

Deno.test("chooseWorktreeName notes explain normalisation and fallback", () => {
  const normalised = chooseWorktreeName("Fix Upload");
  assert(
    normalised.note !== undefined &&
      normalised.note.includes("Fix Upload") &&
      normalised.note.includes("fix-upload"),
    `normalisation note should show both forms: ${normalised.note}`,
  );

  const fallback = chooseWorktreeName("🚀");
  assert(
    fallback.note !== undefined && /codename/i.test(fallback.note),
    `fallback note should mention the codename substitution: ${fallback.note}`,
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

Deno.test("the env override never renames a FOREIGN worktree inspected by path", async () => {
  const settings: IdentitySettings = {
    slug: "discern",
    branchPrefix: "agent/",
  };
  await withTempDir(async (dir) => {
    await Deno.writeTextFile(join(dir, "README.md"), "scaffold\n");
    await gitInit(dir);
    const worktree = await addWorktree(dir, "real-identity");
    // The override says what THIS process's worktree is; a foreign path (a
    // fleet row, a drop target, a sibling's port check) must keep its OWN
    // identity — honoring the override per-row collapses the whole fleet onto
    // one id, which is how `worktree drop` deleted the wrong worktree.
    assertEquals(
      await resolveWorktreeId(
        settings,
        worktree,
        fakeEnv({ DISCERN_WORKTREE_ID: "imposter" }),
        dir,
      ),
      "real-identity",
    );
  });
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
      const [identity, expected] of [
        ["discern", "wt-discern"],
        ["discern42", "wt-discern42"],
      ] as const
    ) {
      const worktree = await addWorktree(dir, identity);
      assertEquals(
        await resolveWorktreeId(settings, worktree, fakeEnv()),
        expected,
      );
    }
  });
});
