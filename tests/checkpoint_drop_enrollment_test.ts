/**
 * Checkpoint fail-open evidence is one closed, enrolled contract. Adding a
 * reason to the registry automatically runs it through every durable and
 * review projection; high-level checkpoint policy code cannot build a second
 * advisory-only channel beside the typed records.
 */

import { assert, assertEquals, assertStringIncludes } from "@std/assert";
import { join } from "@std/path";
import {
  CHECKPOINT_DROP_REASONS,
  type CheckpointDrop,
  checkpointDropMarkdown,
  ENTRY_CHECKPOINT_DROP_REASONS,
  entryCheckpointDrop,
  POLICY_CHECKPOINT_DROP_REASONS,
  policyCheckpointDrop,
} from "../src/shared/checkpoint_drops.ts";
import {
  AcceptDataSchema,
  DurableProofClaimSchema,
  GateDataSchema,
  GateProofCheckSchema,
  GateWireDataSchema,
  ProofSchema,
  StatusWireDataSchema,
} from "../src/shared/result_schemas.ts";
import {
  renderResultMarkdown,
  RESULT_MARKDOWN_PRESENTERS,
} from "../src/shared/result_markdown.ts";
import { renderProofMarkdown } from "../src/engine/gate/proof_render.ts";
import { canonicalProofNotePayload } from "../src/engine/gate/proof_notes.ts";
import {
  projectGateResult,
  projectStatusResult,
} from "../src/shared/result_wire.ts";
import { REPO_ROOT } from "./repo_authored_paths.ts";
import { structuralGuardScope } from "./structural_guard_scope.ts";
import { markdownCodeSpan } from "../src/shared/markdown_code.ts";

const POLICY_COMMIT = "a".repeat(40);

/** One valid record for every registry member, derived from its scope set. */
function enrolledDrops(): CheckpointDrop[] {
  return [
    ...POLICY_CHECKPOINT_DROP_REASONS.map((reason) =>
      policyCheckpointDrop(reason, `account for ${reason}`, POLICY_COMMIT)
    ),
    ...ENTRY_CHECKPOINT_DROP_REASONS.map((reason) =>
      entryCheckpointDrop(
        "review",
        "stop",
        POLICY_COMMIT,
        reason,
        `account for ${reason}`,
      )
    ),
  ];
}

Deno.test("checkpoint drops: every registered reason survives every public and durable projection", () => {
  const drops = enrolledDrops();
  assertEquals(
    [...new Set(drops.map((drop) => drop.reason))].sort(),
    [...CHECKPOINT_DROP_REASONS].sort(),
    "scope registries must cover the canonical reason registry exactly",
  );

  for (const [index, drop] of drops.entries()) {
    const liveDrop = drops[(index + 1) % drops.length];
    assert(liveDrop !== undefined);
    const checkpoints = {
      declared_met: [],
      declared_unmet: [],
      drops: [drop],
    };
    const gate = GateDataSchema.parse({
      failed_stage: null,
      scopes_changed: [],
      checkpoints: { drops: [drop] },
    });
    GateWireDataSchema.parse(gate);
    const gateMarkdown = renderResultMarkdown(
      { ok: true, verb: "done", data: gate },
      RESULT_MARKDOWN_PRESENTERS.gate,
    );
    assertStringIncludes(gateMarkdown, drop.reason);
    assertStringIncludes(gateMarkdown, drop.account);
    assertStringIncludes(gateMarkdown, markdownCodeSpan(drop.account));
    assertStringIncludes(
      gateMarkdown,
      `policy ${markdownCodeSpan(POLICY_COMMIT.slice(0, 12))}`,
    );
    if (drop.scope === "policy") {
      assertStringIncludes(gateMarkdown, "policy-level checkpoint enforcement");
    } else {
      assertStringIncludes(gateMarkdown, "checkpoint `review`");
      assertStringIncludes(gateMarkdown, "mode `stop`");
    }

    const proof = ProofSchema.parse({
      branch: "agent/review",
      trunk: "main",
      head: "123456789abc",
      files_total: 1,
      insertions: 1,
      deletions: 0,
      line: "Proof line.",
      markdown: "Proof page.",
      mode: "report",
      checkpoint_drops: [drop],
      checkpoints,
    });
    const gateWire = GateWireDataSchema.parse(
      projectGateResult({
        ok: true,
        verb: "done",
        data: {
          failed_stage: null,
          scopes_changed: [],
          proof,
        },
      }).data,
    );
    assertEquals(gateWire.proof?.mode, "report");
    assertEquals(gateWire.proof?.checkpoint_drops, [drop]);

    const statusWire = StatusWireDataSchema.parse(
      projectStatusResult({
        ok: true,
        verb: "status",
        data: {
          location: "worktree",
          root: "/repo",
          worktree: null,
          git: null,
          standards: [],
          gate_proof: {
            status: "honored",
            proof_data: proof,
            checkpoint_drops: [liveDrop],
          },
        },
      }, { wireProjection: "full" }).data,
    );
    assertEquals(statusWire.gate_proof?.proof?.mode, "report");
    assertEquals(statusWire.gate_proof?.proof?.checkpoint_drops, [drop]);
    assertEquals(statusWire.gate_proof?.checkpoint_drops, [liveDrop]);
    DurableProofClaimSchema.parse({
      branch: proof.branch,
      trunk: proof.trunk,
      head: proof.head,
      files_total: proof.files_total,
      insertions: proof.insertions,
      deletions: proof.deletions,
      checkpoint_drops: [drop],
    });
    const proofMarkdown = renderProofMarkdown({
      branch: proof.branch,
      trunk: proof.trunk,
      head: proof.head,
      files_total: proof.files_total,
      insertions: proof.insertions,
      deletions: proof.deletions,
      checkpoint_drops: [drop],
      checkpoints,
    }, []);
    assertStringIncludes(proofMarkdown, drop.reason);
    assertStringIncludes(proofMarkdown, drop.account);
    assertStringIncludes(proofMarkdown, markdownCodeSpan(drop.account));
    assertStringIncludes(
      proofMarkdown,
      `policy ${markdownCodeSpan(POLICY_COMMIT.slice(0, 12))}`,
    );
    if (drop.scope === "policy") {
      assertStringIncludes(
        proofMarkdown,
        "policy-level checkpoint enforcement",
      );
    } else {
      assertStringIncludes(proofMarkdown, "checkpoint `review`");
      assertStringIncludes(proofMarkdown, "mode `stop`");
    }

    const proofCheck = GateProofCheckSchema.parse({
      status: "honored",
      proof_data: proof,
      checkpoint_drops: [drop],
    });
    const statusMarkdown = renderResultMarkdown(
      {
        ok: true,
        verb: "status",
        data: {
          fleet: [{
            branch: "agent/review",
            clean: true,
            ahead: 1,
            behind: 0,
            gate_proof: proofCheck,
          }],
        },
      },
      RESULT_MARKDOWN_PRESENTERS.status,
    );
    assertStringIncludes(statusMarkdown, drop.reason);
    assertStringIncludes(statusMarkdown, drop.account);

    const accept = AcceptDataSchema.parse({ checkpoint_drops: [drop] });
    const acceptMarkdown = renderResultMarkdown(
      { ok: false, verb: "accept", data: accept },
      RESULT_MARKDOWN_PRESENTERS.accept,
    );
    assertStringIncludes(acceptMarkdown, drop.reason);
    assertStringIncludes(acceptMarkdown, drop.account);

    const payload = canonicalProofNotePayload(proof, "b".repeat(40));
    assertStringIncludes(payload, `"reason":"${drop.reason}"`);
    assertStringIncludes(payload, `"account":"${drop.account}"`);
  }
});

Deno.test("checkpoint drops: high-level fail-open owners cannot append advisory-only evidence", async () => {
  for (
    const rel of await structuralGuardScope({
      guard:
        "tests/checkpoint_drop_enrollment_test.ts#production-drop-producers",
      universe: "authored-ts",
      narrow: {
        reason:
          "Only production code emits checkpoint drops; tests contain synthetic drop shapes used to verify the detector.",
        include: (rel) => !rel.startsWith("tests/"),
      },
    })
  ) {
    const source = await Deno.readTextFile(join(REPO_ROOT, rel));
    assert(
      !/advisories\s*\.push\s*\(/.test(source),
      `${rel} appends advisory-only evidence; add a typed checkpoint drop and derive its account instead`,
    );
    const ownsCheckpointFailOpen = rel.startsWith("src/engine/checkpoints/") &&
        rel !== "src/engine/checkpoints/report.ts" ||
      rel === "src/engine/worktree/acceptance_checkpoints.ts";
    if (ownsCheckpointFailOpen) {
      assert(
        !/\badvisories\b/.test(source),
        `${rel} owns an internal advisory string channel; retain typed drops and derive copy only at a result boundary`,
      );
    }
  }
});

Deno.test("checkpoint drops: constructors normalize and bound environment error text", () => {
  const hostile = `  first [line](https://example.invalid) and \`tick\`\n${
    "x".repeat(700)
  }\u0000last  `;
  for (
    const drop of [
      policyCheckpointDrop("merge_base_unresolved", hostile),
      entryCheckpointDrop(
        "review",
        "stop",
        POLICY_COMMIT,
        "subject_unavailable",
        hostile,
      ),
    ]
  ) {
    assert(drop.account.length <= 500);
    assert(!drop.account.includes("\n"));
    assert(!drop.account.includes("\u0000"));
    assertStringIncludes(drop.account, "first [line]");
    assertStringIncludes(
      checkpointDropMarkdown(drop),
      markdownCodeSpan(drop.account),
    );
  }
  assertEquals(
    checkpointDropMarkdown({}),
    "Checkpoint drop (`unknown`): policy-level checkpoint enforcement — `no account recorded`",
  );
});
