/**
 * The gate markers bind to the declaration-evidence identity: a recorded
 * Proof stales at an UNCHANGED HEAD when a conclusion or rationale changes,
 * restores when the identical complete claim returns. Pre-cutover markers
 * without complete receipts remain stale.
 *
 * Guards: boundary:exact-tree-proof, claim:proof-exact-tree
 */

import { recordCompleteGateFixture } from "./complete_gate_fixture.ts";
import { assert, assertEquals, assertStringIncludes } from "@std/assert";
import { join } from "@std/path";
import { z } from "@zod/zod";
import { withTempDir } from "./helpers.ts";
import { gitInit, gitOut } from "./engine_helpers.ts";
import { gitAdminStatePath } from "../src/shared/git_admin_state.ts";
import {
  clearStandardMeasurements,
  inspectFreshStandardMeasurementEvidence,
  inspectGateProof,
  inspectLastGateRun,
  inspectLastGateRunRecord,
  inspectStandardMeasurements,
  pinValidatedTree,
  preflightAdminStateWrites,
  recordFreshStandardMeasurementEvidence,
  recordGateOutcome,
  recordLastGateRun,
  recordStandardMeasurements,
} from "../src/engine/gate/proof.ts";
import {
  reconcileOpenQuestion,
  recordDeclaration,
} from "../src/engine/checkpoints/open_questions.ts";
import { declarationEvidenceIdentity } from "../src/engine/checkpoints/evidence.ts";
import { ProofSchema } from "../src/shared/result_schemas.ts";
import { decodeWith } from "./decode_cli_result.ts";
import { ON_DISK_FORMATS } from "../src/shared/on_disk_formats.ts";

const LastGateRunMarkerSchema = z.object({
  version: z.literal(ON_DISK_FORMATS.lastGateRun.version),
  head: z.string(),
  tree: z.string().optional(),
  passed: z.boolean(),
  evidence: z.string().optional(),
  mode: z.enum(["strict", "report"]).optional(),
});

const MutableProofFixtureSchema = z.object({
  standard_proposals: z.array(z.record(z.string(), z.unknown())),
}).passthrough();

const GateProofRecordFixtureSchema = z.object({
  version: z.number(),
  head: z.string(),
  proof: z.unknown().optional(),
}).passthrough();

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
    const recorded = await recordCompleteGateFixture(
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

Deno.test("proof marker: an incomplete record stays stale when declaration evidence changes", async () => {
  await withTempDir(async (dir) => {
    await declaredRepo(dir);
    const preflight = await preflightAdminStateWrites(dir);
    assert(preflight.ok);
    const pin = await pinValidatedTree(dir);
    assertEquals(
      (await recordGateOutcome(dir, preflight.authority, true, pin)).status,
      "unavailable",
    );
    const path = await gitAdminStatePath(dir, "gateProof");
    assert(path !== undefined);
    const bytes = JSON.stringify({
      version: ON_DISK_FORMATS.gateProof.version,
      head: pin.head,
      mode: "strict",
    });
    await Deno.writeTextFile(path, bytes);
    assertEquals((await inspectGateProof(dir)).status, "stale");
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
    assertEquals((await inspectGateProof(dir)).status, "stale");
    assertEquals(await Deno.readTextFile(path), bytes);
  });
});

Deno.test("proof marker: a proposal without bound_commit is not structured Proof", async () => {
  await withTempDir(async (dir) => {
    await declaredRepo(dir);
    const head = await gitOut(dir, "rev-parse", "HEAD");
    const preflight = await preflightAdminStateWrites(dir);
    assert(preflight.ok);
    const proof = ProofSchema.parse({
      branch: "agent/incomplete-proposal",
      trunk: "main",
      head: head.slice(0, 12),
      files_total: 1,
      insertions: 1,
      deletions: 0,
      line: "Proof line.",
      markdown: "Proof page.",
      standard_proposals: [{
        standard: "sources",
        commit: head,
        bound_commit: head,
        measured_commit: head,
        definition_fingerprint: "definition-fingerprint",
        trunk: "main",
        trunk_commit: head,
        direction: "down",
        trunk_limit: 1,
        proposed_limit: 2,
        measurement: 2,
        delta: 1,
        reason: "The accepted feature adds one required source.",
        evidence_paths: ["src/feature.ts"],
      }],
    });
    const recorded = await recordCompleteGateFixture(
      dir,
      preflight.authority,
      true,
      await pinValidatedTree(dir),
      proof,
    );
    assertEquals(recorded.status, "recorded");
    assert(recorded.path !== undefined);

    const marker = decodeWith(
      GateProofRecordFixtureSchema,
      await Deno.readTextFile(recorded.path),
    );
    const data = MutableProofFixtureSchema.parse(marker.proof);
    delete data.standard_proposals[0]?.bound_commit;
    marker.proof = data;
    await Deno.writeTextFile(recorded.path, `${JSON.stringify(marker)}\n`);

    const inspected = await inspectGateProof(dir);
    assertEquals(inspected.status, "honored");
    assertEquals(inspected.proof_data, undefined);
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

    // Evidence is optional within the registered v1 record.
    const path = await gitAdminStatePath(dir, "lastGateRun");
    assert(path !== undefined);
    const raw = decodeWith(
      LastGateRunMarkerSchema,
      await Deno.readTextFile(path),
    );
    delete raw.evidence;
    await Deno.writeTextFile(path, `${JSON.stringify(raw)}\n`);
    const withoutEvidence = await inspectLastGateRun(dir);
    assert(withoutEvidence !== undefined);
    assertEquals(withoutEvidence.evidence, undefined);
  });
});

Deno.test("proof marker: corrupt and unreadable stores remain honored with durable uncertainty", async () => {
  // Both failure directions make the current identity uncertain rather than
  // inventing an empty identity. The recorded vouch remains honored, and the
  // uncertainty travels beside it as structured drop evidence.
  await withTempDir(async (dir) => {
    await declaredRepo(dir);
    const policyCommit = "a".repeat(40);
    const head = await gitOut(dir, "rev-parse", "--short=12", "HEAD");
    const preflight = await preflightAdminStateWrites(dir);
    assert(preflight.ok);
    const recorded = await recordCompleteGateFixture(
      dir,
      preflight.authority,
      true,
      await pinValidatedTree(dir),
      ProofSchema.parse({
        branch: "agent/probe",
        trunk: "main",
        head,
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

Deno.test("gate evidence written by a newer discern is diagnosed and never replaced", async () => {
  await withTempDir(async (dir) => {
    await declaredRepo(dir);
    const preflight = await preflightAdminStateWrites(dir);
    assert(preflight.ok);
    const pin = await pinValidatedTree(dir);
    assert(pin.head !== undefined && pin.clean);

    const proofPath = await gitAdminStatePath(dir, "gateProof");
    const lastRunPath = await gitAdminStatePath(dir, "lastGateRun");
    const measurementsPath = await gitAdminStatePath(
      dir,
      "standardMeasurements",
    );
    const freshPath = await gitAdminStatePath(
      dir,
      "standardMeasurementEvidence",
    );
    assert(
      proofPath !== undefined && lastRunPath !== undefined &&
        measurementsPath !== undefined && freshPath !== undefined,
    );

    const proofBytes = `${
      JSON.stringify({
        version: ON_DISK_FORMATS.gateProof.version + 1,
        head: pin.head,
        mode: "strict",
      })
    }\n`;
    await Deno.writeTextFile(proofPath, proofBytes);
    const proof = await inspectGateProof(dir);
    assertEquals(proof.status, "read_failed");
    assertStringIncludes(proof.reason ?? "", "written by a newer discern");
    assertEquals(
      (await recordCompleteGateFixture(dir, preflight.authority, true, pin))
        .status,
      "record_failed",
    );
    assertEquals(
      (await recordCompleteGateFixture(dir, preflight.authority, false, pin))
        .status,
      "clear_failed",
    );
    assertEquals(await Deno.readTextFile(proofPath), proofBytes);

    const lastRunBytes = `${
      JSON.stringify({
        version: ON_DISK_FORMATS.lastGateRun.version + 1,
        head: pin.head,
        passed: true,
      })
    }\n`;
    await Deno.writeTextFile(lastRunPath, lastRunBytes);
    const lastRun = await inspectLastGateRunRecord(dir);
    assert(lastRun.status === "newer");
    assertStringIncludes(lastRun.reason, "Update discern");
    await recordLastGateRun(dir, preflight.authority, false);
    assertEquals(await Deno.readTextFile(lastRunPath), lastRunBytes);

    const measurementBytes = `${
      JSON.stringify({
        version: ON_DISK_FORMATS.standardMeasurements.version + 1,
        head: pin.head,
        values: { coverage: 2 },
        durations: {},
        definitions: { coverage: "future-definition" },
        provenance: { coverage: pin.head },
      })
    }\n`;
    await Deno.writeTextFile(measurementsPath, measurementBytes);
    const measurements = await inspectStandardMeasurements(dir);
    assert(measurements.status === "newer");
    assertStringIncludes(measurements.reason, "written by a newer discern");
    assertEquals(
      await recordStandardMeasurements(
        dir,
        preflight.authority,
        { coverage: 2 },
        { coverage: "current-definition" },
        pin,
      ),
      false,
    );
    await clearStandardMeasurements(dir, preflight.authority);
    assertEquals(await Deno.readTextFile(measurementsPath), measurementBytes);

    const freshBytes = `${
      JSON.stringify({
        version: ON_DISK_FORMATS.freshStandardMeasurementEvidence.version + 1,
        head: pin.head,
        values: { coverage: 2 },
        failed: [],
      })
    }\n`;
    await Deno.writeTextFile(freshPath, freshBytes);
    const fresh = await inspectFreshStandardMeasurementEvidence(dir);
    assert(fresh.status === "newer");
    assertStringIncludes(fresh.reason ?? "", "written by a newer discern");
    assertEquals(
      await recordFreshStandardMeasurementEvidence(
        dir,
        preflight.authority,
        [{
          name: "coverage",
          direction: "up",
          limit: 1,
          measurement: "measured",
          value: 2,
          verdict: "improved",
        }],
        pin,
      ),
      false,
    );
    assertEquals(await Deno.readTextFile(freshPath), freshBytes);
  });
});

Deno.test("the private text Gate marker is missing evidence and a fresh stamp replaces it", async () => {
  await withTempDir(async (dir) => {
    await declaredRepo(dir);
    const preflight = await preflightAdminStateWrites(dir);
    assert(preflight.ok);
    const pin = await pinValidatedTree(dir);
    assert(pin.head !== undefined);
    const path = await gitAdminStatePath(dir, "gateProof");
    assert(path !== undefined);
    await Deno.writeTextFile(path, `${pin.head}\nline: old private marker\n`);

    const missing = await inspectGateProof(dir);
    assertEquals(missing.status, "missing");
    assertStringIncludes(missing.reason ?? "", "fresh `discern done`");
    assertEquals(
      (await recordCompleteGateFixture(dir, preflight.authority, true, pin))
        .status,
      "recorded",
    );
    const replacement = decodeWith(
      GateProofRecordFixtureSchema,
      await Deno.readTextFile(path),
    );
    assertEquals(replacement.version, ON_DISK_FORMATS.gateProof.version);
    assertEquals(replacement.head, pin.head);
  });
});
