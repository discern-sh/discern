/**
 * The declaration-evidence identity (`src/engine/checkpoints/evidence.ts`):
 * one hash over the episode store's current claims, timestamp-free, so gate
 * markers can bind to the agent's recorded judgments. Identity moves with any
 * changed conclusion or rationale, stays put across identical re-records, and
 * reads a missing or rebuilt-from-empty store as the one stable empty value.
 */

import { assert, assertEquals, assertNotEquals } from "@std/assert";
import { join } from "@std/path";
import { withTempDir } from "./helpers.ts";
import { gitInit } from "./engine_helpers.ts";
import { gitAdminStatePath } from "../src/shared/git_admin_state.ts";
import {
  reconcileEpisode,
  recordDeclaration,
} from "../src/engine/checkpoints/episodes.ts";
import {
  declarationEvidenceIdentity,
  evidenceIdentityOf,
} from "../src/engine/checkpoints/evidence.ts";

const T0 = "2026-01-01T00:00:00.000Z";
const T1 = "2026-01-01T01:00:00.000Z";

/** A seeded repo for the store to live in. */
async function repo(dir: string): Promise<void> {
  await Deno.writeTextFile(join(dir, "seed.txt"), "seed\n");
  await gitInit(dir);
}

/** The identity at `dir`, asserting the store was readable. */
async function identityAt(dir: string): Promise<string> {
  const evidence = await declarationEvidenceIdentity(dir);
  assert(evidence.status === "ok", JSON.stringify(evidence));
  return evidence.identity;
}

Deno.test("evidence: a missing store is the stable empty identity", async () => {
  await withTempDir(async (dir) => {
    await repo(dir);
    assertEquals(await identityAt(dir), await evidenceIdentityOf({}));
  });
});

Deno.test("evidence: conclusions and rationales move the identity; identical claims do not", async () => {
  await withTempDir(async (dir) => {
    await repo(dir);
    const empty = await identityAt(dir);

    await reconcileEpisode(dir, {
      checkpoint: "probe",
      definitionHash: "def1",
      subject: "sub1",
      matchedPaths: ["a.txt"],
    }, T0);
    const opened = await identityAt(dir);
    assertNotEquals(opened, empty, "an opened episode is new evidence");

    const met = await recordDeclaration(
      dir,
      {
        conclusion: "met",
        definitionHash: "def1",
        subject: "sub1",
      },
      "probe",
      T0,
    );
    assert(met.ok);
    const declaredMet = await identityAt(dir);
    assertNotEquals(declaredMet, opened, "a conclusion is new evidence");

    // Re-recording the identical claim (even at a later time) is the SAME
    // evidence: identity is the claim, never its timestamp.
    const repeat = await recordDeclaration(
      dir,
      {
        conclusion: "met",
        definitionHash: "def1",
        subject: "sub1",
      },
      "probe",
      T1,
    );
    assert(repeat.ok && !repeat.changed);
    assertEquals(await identityAt(dir), declaredMet);

    // The other conclusion, and then a changed rationale, each move it.
    const unmet = await recordDeclaration(
      dir,
      {
        conclusion: "unmet",
        why: "the docs lag the new surface",
        definitionHash: "def1",
        subject: "sub1",
      },
      "probe",
      T1,
    );
    assert(unmet.ok);
    const declaredUnmet = await identityAt(dir);
    assertNotEquals(declaredUnmet, declaredMet);

    const reworded = await recordDeclaration(
      dir,
      {
        conclusion: "unmet",
        why: "the docs lag the new surface; follow-up planned",
        definitionHash: "def1",
        subject: "sub1",
      },
      "probe",
      T1,
    );
    assert(reworded.ok);
    assertNotEquals(await identityAt(dir), declaredUnmet);
  });
});

Deno.test("evidence: returning to a prior claim restores its identity", async () => {
  await withTempDir(async (dir) => {
    await repo(dir);
    await reconcileEpisode(dir, {
      checkpoint: "probe",
      definitionHash: "def1",
      subject: "sub1",
      matchedPaths: ["a.txt"],
    }, T0);
    const met = {
      conclusion: "met" as const,
      definitionHash: "def1",
      subject: "sub1",
    };
    assert((await recordDeclaration(dir, met, "probe", T0)).ok);
    const declaredMet = await identityAt(dir);
    assert(
      (await recordDeclaration(
        dir,
        {
          conclusion: "unmet",
          why: "revisited",
          definitionHash: "def1",
          subject: "sub1",
        },
        "probe",
        T1,
      )).ok,
    );
    assertNotEquals(await identityAt(dir), declaredMet);
    assert((await recordDeclaration(dir, met, "probe", T1)).ok);
    assertEquals(
      await identityAt(dir),
      declaredMet,
      "the same semantic claim is the same evidence, whenever recorded",
    );
  });
});

Deno.test("evidence: a corrupt store reads as empty (the rebuild-from-empty direction)", async () => {
  await withTempDir(async (dir) => {
    await repo(dir);
    await reconcileEpisode(dir, {
      checkpoint: "probe",
      definitionHash: "def1",
      subject: "sub1",
      matchedPaths: ["a.txt"],
    }, T0);
    const path = await gitAdminStatePath(dir, "checkpointEpisodes");
    assert(path !== undefined);
    await Deno.writeTextFile(path, "not json\n");
    assertEquals(
      await identityAt(dir),
      await evidenceIdentityOf({}),
      "a store the next write rebuilds from empty carries no standing claims",
    );
  });
});
