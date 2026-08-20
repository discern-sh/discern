/**
 * The gate markers bind to the declaration-evidence identity: a recorded
 * Proof stales at an UNCHANGED HEAD when a conclusion or rationale changes,
 * restores when the identical claim returns, and fails open (stays honored)
 * for markers written before the component existed.
 */

import { assert, assertEquals, assertStringIncludes } from "@std/assert";
import { join } from "@std/path";
import { withTempDir } from "./helpers.ts";
import { gitInit } from "./engine_helpers.ts";
import { gitAdminStatePath } from "../src/shared/git_admin_state.ts";
import {
  inspectGateProof,
  inspectLastGateRun,
  pinValidatedTree,
  preflightAdminStateWrites,
  recordGateOutcome,
  recordLastGateRun,
} from "../src/engine/gate/proof.ts";
import {
  reconcileOpenQuestion,
  recordDeclaration,
} from "../src/engine/checkpoints/open_questions.ts";
import { declarationEvidenceIdentity } from "../src/engine/checkpoints/evidence.ts";
import { ProofSchema } from "../src/shared/result_schemas.ts";

const T0 = "2026-01-01T00:00:00.000Z";

/** A committed clean repo with one declared-met openQuestion. */
async function declaredRepo(dir: string): Promise<void> {
  await Deno.writeTextFile(join(dir, "seed.txt"), "seed\n");
  await gitInit(dir);
  const opened = await reconcileOpenQuestion(dir, {
    checkpoint: "probe",
    definitionHash: "def1",
    subject: "sub1",
    matchedPaths: ["seed.txt"],
    relatedPaths: [],
  }, T0);
  assert(opened.ok);
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
}

/** The current identity, asserted readable. */
async function identity(dir: string): Promise<string> {
  const evidence = await declarationEvidenceIdentity(dir);
  assert(evidence.status === "ok");
  return evidence.identity;
}

Deno.test("proof marker: a changed conclusion stales the vouch at an unchanged HEAD; the restored claim re-honors it", async () => {
  await withTempDir(async (dir) => {
    await declaredRepo(dir);
    const preflight = await preflightAdminStateWrites(dir);
    assert(preflight.ok);
    const pin = await pinValidatedTree(dir);
    const recorded = await recordGateOutcome(
      dir,
      preflight.authority,
      true,
      pin,
      undefined,
      await identity(dir),
    );
    assertEquals(recorded.status, "recorded");
    assertEquals((await inspectGateProof(dir)).status, "honored");

    // Replace the conclusion: same HEAD, different evidence — stale.
    const unmet = await recordDeclaration(
      dir,
      {
        conclusion: "unmet",
        why: "revisited on review",
        definitionHash: "def1",
        subject: "sub1",
      },
      "probe",
      T0,
    );
    assert(unmet.ok);
    const stale = await inspectGateProof(dir);
    assertEquals(stale.status, "stale");
    assertStringIncludes(stale.reason ?? "", "declarations changed");

    // A changed RATIONALE alone is also different evidence.
    const reworded = await recordDeclaration(
      dir,
      {
        conclusion: "unmet",
        why: "revisited on review; follow-up filed",
        definitionHash: "def1",
        subject: "sub1",
      },
      "probe",
      T0,
    );
    assert(reworded.ok);
    assertEquals((await inspectGateProof(dir)).status, "stale");

    // Restoring the recorded claim restores the vouch: identity is the
    // claim, never the record instance.
    const restored = await recordDeclaration(
      dir,
      {
        conclusion: "met",
        definitionHash: "def1",
        subject: "sub1",
      },
      "probe",
      T0,
    );
    assert(restored.ok);
    assertEquals((await inspectGateProof(dir)).status, "honored");
  });
});

Deno.test("proof marker: a pre-evidence marker keeps its tree-only semantics (fail open)", async () => {
  await withTempDir(async (dir) => {
    await declaredRepo(dir);
    const preflight = await preflightAdminStateWrites(dir);
    assert(preflight.ok);
    const recorded = await recordGateOutcome(
      dir,
      preflight.authority,
      true,
      await pinValidatedTree(dir),
      // No proof rendering and no evidence — the shape an older writer left.
    );
    assertEquals(recorded.status, "recorded");
    assertEquals((await inspectGateProof(dir)).status, "honored");

    // Evidence changes; the old marker has nothing to compare — still honored.
    const unmet = await recordDeclaration(
      dir,
      {
        conclusion: "unmet",
        why: "revisited",
        definitionHash: "def1",
        subject: "sub1",
      },
      "probe",
      T0,
    );
    assert(unmet.ok);
    assertEquals((await inspectGateProof(dir)).status, "honored");
  });
});

Deno.test("last-run marker: the recorded evidence identity round-trips", async () => {
  await withTempDir(async (dir) => {
    await declaredRepo(dir);
    const preflight = await preflightAdminStateWrites(dir);
    assert(preflight.ok);
    const evidence = await identity(dir);
    await recordLastGateRun(dir, preflight.authority, true, evidence);
    const last = await inspectLastGateRun(dir);
    assert(last !== undefined);
    assertEquals(last.passed, true);
    assertEquals(last.evidence, evidence);

    // A marker without the field (an older writer) still parses.
    const path = await gitAdminStatePath(dir, "lastGateRun");
    assert(path !== undefined);
    const raw = JSON.parse(await Deno.readTextFile(path));
    delete raw.evidence;
    await Deno.writeTextFile(path, `${JSON.stringify(raw)}\n`);
    const legacy = await inspectLastGateRun(dir);
    assert(legacy !== undefined);
    assertEquals(legacy.evidence, undefined);
  });
});

Deno.test("proof marker: corrupt and unreadable stores remain honored with durable uncertainty", async () => {
  // Both failure directions make the current identity uncertain rather than
  // inventing an empty identity. The recorded vouch remains honored, and the
  // uncertainty travels beside it as structured drop evidence.
  await withTempDir(async (dir) => {
    await declaredRepo(dir);
    const policyCommit = "a".repeat(40);
    const preflight = await preflightAdminStateWrites(dir);
    assert(preflight.ok);
    const recorded = await recordGateOutcome(
      dir,
      preflight.authority,
      true,
      await pinValidatedTree(dir),
      ProofSchema.parse({
        branch: "agent/probe",
        trunk: "main",
        head: "123456789abc",
        files_total: 1,
        insertions: 1,
        deletions: 0,
        line: "Proof line.",
        markdown: "Proof page.",
        checkpoints: {
          policy: policyCommit,
          declared_met: [],
          declared_unmet: [],
        },
      }),
      await identity(dir),
    );
    assertEquals(recorded.status, "recorded");
    assertEquals((await inspectGateProof(dir)).status, "honored");

    const store = await gitAdminStatePath(dir, "checkpointOpenQuestions");
    assert(store !== undefined);
    const bytes = await Deno.readTextFile(store);

    // Corrupt: the identity is unknown and the vouch retains the uncertainty.
    await Deno.writeTextFile(store, "not json\n");
    const corrupt = await inspectGateProof(dir);
    assertEquals(corrupt.status, "honored");
    assertEquals(
      corrupt.checkpoint_drops?.at(-1)?.reason,
      "declaration_evidence_unavailable",
    );
    assertEquals(
      corrupt.checkpoint_drops?.at(-1)?.policy_commit,
      policyCommit,
    );

    // Unreadable (a directory at the store path): the same durable uncertainty.
    await Deno.remove(store);
    await Deno.mkdir(store, { recursive: true });
    const unreadable = await inspectGateProof(dir);
    assertEquals(unreadable.status, "honored");
    assertEquals(
      unreadable.checkpoint_drops?.at(-1)?.reason,
      "declaration_evidence_unavailable",
    );
    assertEquals(
      unreadable.checkpoint_drops?.at(-1)?.policy_commit,
      policyCommit,
    );

    // Restored bytes restore the exact claim — honored again, symmetrically.
    await Deno.remove(store);
    await Deno.writeTextFile(store, bytes);
    assertEquals((await inspectGateProof(dir)).status, "honored");
  });
});
