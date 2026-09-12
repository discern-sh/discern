/** Complete versioned notes retain their evidence after checkout state is disposable. */
import { assert, assertEquals, assertThrows } from "@std/assert";
import { decodeBase64, encodeBase64 } from "@std/encoding/base64";
import {
  ProofNotePayloadSchema,
  ProofNoteSchema,
  TolerantProofNoteSchema,
} from "../src/shared/result_schemas.ts";
import { PROOF_NOTE_PAYLOAD_TYPE } from "../src/shared/public_schemas.ts";
import {
  canonicalProofNotePayload,
  readProofNoteAt,
  writeProofNote,
} from "../src/engine/gate/proof_notes.ts";
import { completeNoteProof } from "./completion_note_fixtures.ts";
import { decodeWith } from "./decode_cli_result.ts";
import { fakeEnv, withTempDir } from "./helpers.ts";
import { git, gitInit, gitOut } from "./engine_helpers.ts";

Deno.test("versioned Proof note retains candidate, receipts, executors and consent evidence without altering the unsigned envelope", async () => {
  await withTempDir(async (root) => {
    await Deno.writeTextFile(`${root}/source`, "authored\n");
    await gitInit(root);
    const commit = await gitOut(root, "rev-parse", "HEAD");
    const proof = completeNoteProof(commit, "agent/note");
    const acceptance = {
      consent: { source: "effort-grant" as const },
      variances: [],
      standard_proposals: [],
    };
    assertEquals(
      (await writeProofNote(root, commit, proof, fakeEnv({}), acceptance))
        .status,
      "recorded",
    );
    const text = await gitOut(root, "notes", "--ref=discern", "show", commit);
    const envelope = decodeWith(ProofNoteSchema, text);
    assertEquals(envelope.payloadType, PROOF_NOTE_PAYLOAD_TYPE);
    assertEquals(envelope.signatures, []);
    const payload = decodeWith(
      ProofNotePayloadSchema,
      new TextDecoder().decode(decodeBase64(envelope.payload)),
    );
    assertEquals(payload.proof.completion, proof.completion);
    assertEquals(payload.acceptance, acceptance);
    assertEquals(
      (await writeProofNote(
        root,
        commit,
        { ...proof, markdown: "another rendering" },
        fakeEnv({}),
        acceptance,
      )).status,
      "already_present",
    );
    assertEquals(
      (await writeProofNote(root, commit, proof, fakeEnv({}), {
        ...acceptance,
        consent: { source: "conversation" as const },
      })).status,
      "record_failed",
    );
    // Additive durable fields do not create a second contract or weaken known-field validation.
    const extended = {
      ...payload,
      extension: true,
      proof: {
        ...payload.proof,
        completion: {
          ...payload.proof.completion,
          extension: true,
          candidate: { ...payload.proof.completion.candidate, extension: true },
        },
      },
    };
    await git(
      root,
      "notes",
      "--ref=discern",
      "add",
      "-f",
      "-m",
      JSON.stringify({
        ...envelope,
        payload: encodeBase64(
          new TextEncoder().encode(JSON.stringify(extended)),
        ),
      }),
      commit,
    );
    const reading = await readProofNoteAt(root, commit);
    assert(reading.status === "valid", JSON.stringify(reading));
    assertEquals(reading.proof, proof);
    assertEquals(reading.acceptance, acceptance);
  });
});

Deno.test("current note rejects incomplete and substituted facts; prelaunch notes missing evidence remain stale", async () => {
  const proof = completeNoteProof("a".repeat(40), "agent/note");
  const acceptance = {
    consent: { source: "effort-grant" as const },
    variances: [],
    standard_proposals: [],
  };
  const payload = decodeWith(
    ProofNotePayloadSchema,
    canonicalProofNotePayload(proof, "a".repeat(40), acceptance),
  );
  const { completion, ...incomplete } = payload.proof;
  for (
    const altered of [
      { ...payload, proof: incomplete },
      {
        ...payload,
        proof: {
          ...payload.proof,
          completion: { ...completion, attempts: [] },
        },
      },
      {
        ...payload,
        proof: {
          ...payload.proof,
          completion: {
            ...completion,
            components: completion.components.map((component) => ({
              ...component,
              evidence: {
                ...component.evidence,
                applicability: {
                  ...component.evidence.applicability,
                  policy: "substituted",
                },
              },
            })),
          },
        },
      },
      { ...payload, subject: { commit: "b".repeat(40) } },
      {
        ...payload,
        acceptance: {
          ...acceptance,
          consent: { source: "self-approval" },
        },
      },
    ]
  ) {
    assertEquals(ProofNotePayloadSchema.safeParse(altered).success, false);
  }
  const { completion: _missingCompletion, ...incompleteProof } = proof;
  assertThrows(() =>
    canonicalProofNotePayload(incompleteProof, "a".repeat(40))
  );
  await withTempDir(async (root) => {
    await Deno.writeTextFile(`${root}/source`, "authored\n");
    await gitInit(root);
    const commit = await gitOut(root, "rev-parse", "HEAD");
    const current = decodeWith(
      ProofNotePayloadSchema,
      canonicalProofNotePayload(
        completeNoteProof(commit, "agent/incompleteNote"),
        commit,
      ),
    );
    const { completion: _completion, ...claim } = current.proof;
    const incompleteNote = {
      ...current,
      proof: claim,
      issuer: { name: "incompleteNote issuer", extension: "preserved" },
      brief: "original intent",
    };
    await git(
      root,
      "notes",
      "--ref=discern",
      "add",
      "-m",
      JSON.stringify({
        payloadType: PROOF_NOTE_PAYLOAD_TYPE,
        payload: encodeBase64(
          new TextEncoder().encode(
            JSON.stringify(incompleteNote),
          ),
        ),
        signatures: [],
      }),
      commit,
    );
    const original = await gitOut(
      root,
      "notes",
      "--ref=discern",
      "show",
      commit,
    );
    const reading = await readProofNoteAt(root, commit);
    assert(reading.status === "stale");
    const originalEnvelope = decodeWith(TolerantProofNoteSchema, original);
    assertEquals(originalEnvelope.payloadType, PROOF_NOTE_PAYLOAD_TYPE);
    assertEquals(
      (await writeProofNote(
        root,
        commit,
        completeNoteProof(commit, "agent/note"),
      )).status,
      "record_failed",
    );
    assertEquals(
      await gitOut(root, "notes", "--ref=discern", "show", commit),
      original,
    );
    for (
      const invalid of [
        { ...incompleteNote, subject: { commit: "b".repeat(40) } },
        {
          ...incompleteNote,
          proof: { ...incompleteNote.proof, head: "b".repeat(12) },
        },
        { subject: { commit }, proof: { head: commit.slice(0, 12) } },
      ]
    ) {
      await git(
        root,
        "notes",
        "--ref=discern",
        "add",
        "-f",
        "-m",
        JSON.stringify({
          ...originalEnvelope,
          payload: encodeBase64(
            new TextEncoder().encode(JSON.stringify(invalid)),
          ),
        }),
        commit,
      );
      assertEquals((await readProofNoteAt(root, commit)).status, "missing");
    }
  });
});

Deno.test("complete report-only evidence cannot be written as a landing note", async () => {
  const proof = completeNoteProof("a".repeat(40), "agent/report");
  assertEquals(
    (await writeProofNote(".", "a".repeat(40), { ...proof, mode: "report" }))
      .status,
    "record_failed",
  );
});
