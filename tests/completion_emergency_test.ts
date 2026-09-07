import { decodeBase64 } from "@std/encoding/base64";
import { decodeJson } from "../src/shared/runtime_decode.ts";
import {
  EmergencyNoteEnvelopeSchema,
  EmergencyNotePayloadSchema,
} from "../src/shared/emergency_note.ts";
import { ProofNotePayloadSchema } from "../src/shared/result_schemas.ts";
import { readProofNoteAt } from "../src/engine/gate/proof_notes.ts";
import {
  EmergencyResolutionSchema,
  resolveEmergencyValidation,
} from "../src/engine/emergency/obligations.ts";
import { artifactPath } from "../src/engine/execution/artifact_read.ts";
/** Emergency integration uses exact fresh consent and the shared durable transition. */
import {
  assert,
  assertEquals,
  assertRejects,
  assertStringIncludes,
} from "@std/assert";
import { project } from "./completion_public_fixture.ts";
import { withTempDir } from "./helpers.ts";
import { git, gitOut, runAgent } from "./engine_helpers.ts";
import { emergencyResult } from "../src/engine/emergency/action.ts";
import { lifecycleContext } from "../src/engine/worktree/lifecycle.ts";
import { Logger } from "../src/lib/log.ts";
import { emergencyValidationStatus } from "../src/engine/emergency/obligations.ts";
import {
  observedRecords,
  observeQueue,
} from "../src/engine/landing_queue/repository.ts";
import { LANDING_BOUNDARIES } from "../src/engine/landing_queue/publication.ts";
import { grantEffort } from "../src/engine/worktree/effort_grant_writer.ts";
import { readEffortGrant } from "../src/engine/worktree/effort_grant.ts";
import { SYSTEM_CLOCK, wallTimeIso } from "../src/shared/clock.ts";
import { decodeCliResult } from "./decode_cli_result.ts";

Deno.test("emergency preview rejects ordinary grants, changed reason and source; later validation retains the exception", async () => {
  await withTempDir(async (root) => {
    const path = await project(root, ["local"]);
    const ctx = await lifecycleContext(
      path,
      new Logger({ json: true, noColor: true }),
    );
    const before = await gitOut(root, "rev-parse", "main");
    await grantEffort(
      path,
      "agent/public-done",
      wallTimeIso(SYSTEM_CLOCK.wallNow()),
    );
    const grant = await readEffortGrant(path);
    const preview = await emergencyResult(ctx, { reason: "Restore service" });
    assertEquals(preview.error, "awaiting_consent", JSON.stringify(preview));
    const token = preview.data?.emergency?.confirmation;
    assert(token);
    assertEquals(
      preview.data?.emergency?.exceptions?.map((entry) => entry.state),
      ["unrun", "unrun"],
    );
    const { planEmergency, emergencyToken } = await import(
      "../src/engine/emergency/plan.ts"
    );
    const expired = await emergencyToken(
      await planEmergency(ctx, "Restore service"),
      SYSTEM_CLOCK.wallNow() - 1,
    );
    assertEquals(
      (await emergencyResult(ctx, {
        reason: "Restore service",
        confirmed: true,
        confirmation: expired,
      })).error,
      "awaiting_consent",
    );
    assertEquals(await readEffortGrant(path), grant);
    assertEquals(await gitOut(root, "rev-parse", "main"), before);
    const wrongReason = await emergencyResult(ctx, {
      reason: "Another reason",
      confirmed: true,
      confirmation: token,
    });
    assertEquals(wrongReason.error, "awaiting_consent");
    await Deno.writeTextFile(`${path}/source`, "revised\n");
    await git(path, "add", "source");
    await git(path, "commit", "-m", "Revise repair");
    const stale = await emergencyResult(ctx, {
      reason: "Restore service",
      confirmed: true,
      confirmation: token,
    });
    assertEquals(stale.error, "awaiting_consent");
    const fresh = stale.data?.emergency?.confirmation;
    assert(fresh);
    const landed = await emergencyResult(ctx, {
      reason: "Restore service",
      confirmed: true,
      confirmation: fresh,
    });
    assert(landed.ok, JSON.stringify(landed));
    assertEquals(landed.data?.emergency?.outcome, "landed");
    assertEquals(landed.data?.proof, undefined);
    assertEquals(
      await readEffortGrant(path),
      grant,
      "Emergency cannot consume an ordinary grant",
    );
    const records = observedRecords(await observeQueue(root, "main"));
    const exception = records.find((record) => record.kind === "landing");
    assert(exception?.kind === "landing");
    assertEquals(exception.data.claim.kind, "exception");
    assertEquals(records.filter((record) => record.kind === "proof").length, 0);
    const note = await gitOut(
      root,
      "notes",
      "--ref=discern",
      "show",
      await gitOut(root, "rev-parse", "main"),
    );
    assertStringIncludes(note, '"signatures":[]');
    const envelope = decodeJson(
      EmergencyNoteEnvelopeSchema,
      note,
      "exception note",
    );
    const payload = decodeJson(
      EmergencyNotePayloadSchema,
      new TextDecoder().decode(decodeBase64(envelope.payload)),
      "exception payload",
    );
    assertEquals(payload.claim, exception.data.claim);
    assertEquals(ProofNotePayloadSchema.safeParse(payload).success, false);
    assertEquals(
      (await readProofNoteAt(root, exception.data.target)).status,
      "unsupported",
    );
    assertEquals(
      (await emergencyValidationStatus(root))[0]?.state,
      "outstanding",
    );
    const validation = await runAgent(root, ["done", "--rerun", "--json"]);
    assertEquals(validation.code, 0, validation.output);
    assertEquals(
      (await emergencyValidationStatus(root))[0]?.state,
      "resolved",
      validation.output,
    );
    const resolved = (await emergencyValidationStatus(root))[0];
    assert(resolved?.resolved_by);
    const receiptPath = await artifactPath(
      root,
      exception.data.attempt_id,
      `environment/emergency-validation-${exception.id}.json`,
    );
    const receiptBytes = await Deno.readTextFile(receiptPath);
    await Deno.remove(receiptPath);
    await Promise.all([
      resolveEmergencyValidation(root, resolved.resolved_by),
      resolveEmergencyValidation(root, resolved.resolved_by),
    ]);
    for (
      const corrupt of ["missing-proof", "wrong-head", "malformed"] as const
    ) {
      const value = decodeJson(
        EmergencyResolutionSchema,
        await Deno.readTextFile(receiptPath),
        receiptPath,
      );
      assert(typeof value === "object" && value !== null);
      if (corrupt === "wrong-head") Reflect.set(value, "head", before);
      else if (corrupt === "missing-proof") {
        Reflect.set(value, "proof", {
          ...resolved.resolved_by,
          proof_id: "aaaaaaaa-aaaa-4aaa-aaaa-aaaaaaaaaaaa",
        });
      }
      await Deno.writeTextFile(
        receiptPath,
        corrupt === "malformed" ? "{" : JSON.stringify(value),
      );
      await assertRejects(() => emergencyValidationStatus(root));
      await Deno.writeTextFile(receiptPath, receiptBytes);
    }
    const historical = observedRecords(await observeQueue(root, "main")).find((
      record,
    ) => record.id === exception.id);
    assertEquals(historical, exception);
    assertEquals(
      await gitOut(
        root,
        "notes",
        "--ref=discern",
        "show",
        exception.data.target,
      ),
      note,
    );
  });
});

for (const boundary of LANDING_BOUNDARIES) {
  Deno.test(`emergency interruption after ${boundary} preserves the exact transition and recovers without Proof`, async () => {
    await withTempDir(async (root) => {
      const path = await project(root, ["local"]);
      const ctx = await lifecycleContext(
        path,
        new Logger({ json: true, noColor: true }),
      );
      const before = await gitOut(root, "rev-parse", "main");
      const preview = await emergencyResult(ctx, { reason: "Restore service" });
      const confirmation = preview.data?.emergency?.confirmation;
      assert(confirmation, JSON.stringify(preview));
      const result = await emergencyResult(ctx, {
        reason: "Restore service",
        confirmation,
        confirmed: true,
        converge: () =>
          Promise.resolve({
            ok: true,
            steps: [],
            diagnostics: [],
            hints: [],
          }),
        afterBoundary: (at) => {
          if (at === boundary) throw new Error(`interrupted at ${at}`);
          return Promise.resolve();
        },
      });
      assert(!result.ok, JSON.stringify(result));
      const landing = observedRecords(await observeQueue(root, "main")).find((
        record,
      ) => record.kind === "landing");
      assert(landing?.kind === "landing", JSON.stringify(result));
      assertEquals(landing.data.claim.kind, "exception");
      const recovered = await emergencyResult(
        await lifecycleContext(root, ctx.log),
        { recover: landing.id },
      );
      if (boundary === "planned" || boundary === "grant") {
        assertEquals(
          recovered.data?.emergency?.outcome,
          "not-landed",
          JSON.stringify(recovered),
        );
        assertEquals(await gitOut(root, "rev-parse", "main"), before);
        assertStringIncludes(
          recovered.hints?.join(" ") ?? "",
          "new emergency plan",
        );
      } else {
        assert(recovered.ok, JSON.stringify(recovered));
        assertEquals(
          await gitOut(root, "rev-parse", "main"),
          landing.data.target,
        );
      }
      assertEquals(
        observedRecords(await observeQueue(root, "main")).filter((record) =>
          record.kind === "proof"
        ).length,
        0,
      );
    });
  });
}

Deno.test("CLI emergency is a read-only review before its exact confirmation", async () => {
  await withTempDir(async (root) => {
    const path = await project(root, ["local"]);
    const result = await runAgent(path, [
      "accept",
      "emergency",
      "--reason",
      "Restore service",
      "--json",
    ]);
    const decoded = decodeCliResult(result.stdout, "accept");
    assertEquals(decoded.error, "awaiting_consent", result.output);
    assert(
      decoded.data !== undefined && "emergency" in decoded.data &&
        decoded.data.emergency?.confirmation,
    );
  });
});

Deno.test("emergency inventory distinguishes failed, unrun contexts, and stale evidence", async () => {
  await withTempDir(async (root) => {
    const path = await project(
      root,
      ["local", "ci"],
      "",
      "printf 'DISCERN_METRIC coverage 80\\n'",
    );
    const failed = await runAgent(path, [
      "done",
      "--retain-checkout",
      "--json",
    ]);
    assertEquals(failed.code, 1, failed.output);
    const ctx = await lifecycleContext(
      path,
      new Logger({ json: true, noColor: true }),
    );
    const preview = await emergencyResult(ctx, { reason: "Restore service" });
    assertEquals(preview.error, "awaiting_consent", JSON.stringify(preview));
    const exceptions = preview.data?.emergency?.exceptions ?? [];
    assertEquals(
      exceptions.filter((entry) => entry.requirement.context === "ci").map((
        entry,
      ) => entry.state),
      ["unrun", "unrun"],
    );
    assertEquals(
      exceptions.filter((entry) => entry.requirement.context === "local").map((
        entry,
      ) => entry.state),
      ["failed"],
    );
    await Deno.writeTextFile(`${path}/source`, "changed inputs\n");
    await git(path, "add", "source");
    await git(path, "commit", "-m", "Change validation inputs");
    const stale = await emergencyResult(ctx, { reason: "Restore service" });
    assertEquals(stale.error, "awaiting_consent", JSON.stringify(stale));
    assertEquals(
      stale.data?.emergency?.exceptions?.filter((entry) =>
        entry.requirement.context === "local"
      ).map((entry) => entry.state),
      ["stale", "stale"],
    );
  });
});

Deno.test("emergency retains checkout collisions, failed convergence, and unrelated queue predictions", async () => {
  await withTempDir(async (root) => {
    const peer = await project(root, ["local"]);
    const completed = await runAgent(peer, [
      "done",
      "--retain-checkout",
      "--json",
    ]);
    assertEquals(completed.code, 0, completed.output);
    const { addWorktree } = await import("./engine_helpers.ts");
    const path = await addWorktree(root, "repair");
    await Deno.writeTextFile(`${path}/repair`, "urgent fix\n");
    await git(path, "add", "repair");
    await git(path, "commit", "-m", "Repair service");
    const ctx = await lifecycleContext(
      path,
      new Logger({ json: true, noColor: true }),
    );
    const preview = await emergencyResult(ctx, { reason: "Restore service" });
    const token = preview.data?.emergency?.confirmation;
    assert(token, JSON.stringify(preview));
    const before = await gitOut(root, "rev-parse", "main");
    await Deno.writeTextFile(`${root}/repair`, "unrelated user data\n");
    const collision = await emergencyResult(ctx, {
      reason: "Restore service",
      confirmed: true,
      confirmation: token,
    });
    assert(!collision.ok, JSON.stringify(collision));
    assertEquals(await gitOut(root, "rev-parse", "main"), before);
    assertEquals(
      await Deno.readTextFile(`${root}/repair`),
      "unrelated user data\n",
    );
    await Deno.remove(`${root}/repair`);
    const retry = await emergencyResult(ctx, { reason: "Restore service" });
    const confirmation = retry.data?.emergency?.confirmation;
    assert(confirmation, JSON.stringify(retry));
    const landed = await emergencyResult(ctx, {
      reason: "Restore service",
      confirmed: true,
      confirmation,
      converge: () =>
        Promise.resolve({ ok: false, steps: [], diagnostics: [], hints: [] }),
    });
    assertEquals(landed.error, "partial_acceptance", JSON.stringify(landed));
    assertEquals(landed.data?.emergency?.outcome, "landed");
    assertStringIncludes(landed.message ?? "", "--recover");
    const records = observedRecords(await observeQueue(root, "main"));
    const queue = records.find((record) => record.kind === "queue");
    assert(queue?.kind === "queue");
    assert(
      queue.data.entries.every((entry) => entry.state !== "landed"),
      "Emergency must not batch unrelated work",
    );
    assertEquals(queue.data.entries[0]?.invalidation, "external-trunk");
    const id = landed.data?.emergency?.landing_id;
    assert(id);
    const next = await addWorktree(root, "next-repair");
    await Deno.writeTextFile(`${next}/next-repair`, "another repair\n");
    await git(next, "add", "next-repair");
    await git(next, "commit", "-m", "Repair another component");
    const nextContext = await lifecycleContext(next, ctx.log);
    const blocked = await emergencyResult(nextContext, {
      reason: "Restore another component",
    });
    assert(!blocked.ok, JSON.stringify(blocked));
    assertStringIncludes(blocked.message ?? "", `--recover ${id}`);
    const recovered = await emergencyResult(
      await lifecycleContext(root, ctx.log),
      {
        recover: id,
        converge: () =>
          Promise.resolve({ ok: true, steps: [], diagnostics: [], hints: [] }),
      },
    );
    assert(recovered.ok, JSON.stringify(recovered));
    const available = await emergencyResult(nextContext, {
      reason: "Restore another component",
    });
    assert(available.data?.emergency?.confirmation, JSON.stringify(available));
    assertEquals(
      await gitOut(root, "rev-parse", "main"),
      await gitOut(path, "rev-parse", "HEAD"),
    );
    const status = await runAgent(root, ["status", "--json"]);
    assertEquals(status.code, 0, status.output);
    assertStringIncludes(status.stdout, '"emergency_validation"');
    assertStringIncludes(status.stdout, '"outstanding"');
  });
});

for (const changed of ["source", "candidate", "trunk"] as const) {
  Deno.test(`emergency refuses a changed ${changed} ref at the shared transition boundary`, async () => {
    await withTempDir(async (root) => {
      const path = await project(root, ["local"]);
      const ctx = await lifecycleContext(
        path,
        new Logger({ json: true, noColor: true }),
      );
      const before = await gitOut(root, "rev-parse", "main");
      const preview = await emergencyResult(ctx, { reason: "Restore service" });
      const confirmation = preview.data?.emergency?.confirmation;
      assert(confirmation);
      const result = await emergencyResult(ctx, {
        reason: "Restore service",
        confirmation,
        confirmed: true,
        afterBoundary: async (boundary, record) => {
          if (boundary !== "planned") return;
          if (changed === "source") {
            await git(
              root,
              "update-ref",
              record.data.source.branch,
              before,
              record.data.source.head,
            );
          } else if (changed === "candidate") {
            const records = observedRecords(await observeQueue(root, "main"));
            const candidate = records.find((entry) =>
              entry.kind === "candidate" &&
              entry.id === record.data.candidate_id
            );
            assert(candidate?.kind === "candidate");
            const { candidateRef } = await import(
              "../src/engine/completion/identity.ts"
            );
            await git(
              root,
              "update-ref",
              candidateRef(candidate.id, candidate.data.attempt_id),
              before,
              candidate.data.head,
            );
          } else {
            await Deno.writeTextFile(`${root}/owner`, "owner change\n");
            await git(root, "add", "owner");
            await git(root, "commit", "-m", "Owner trunk change");
          }
        },
      });
      assert(!result.ok, JSON.stringify(result));
      assertEquals(
        result.data?.emergency?.outcome,
        "not-landed",
        JSON.stringify(result),
      );
      if (changed !== "trunk") {
        assertEquals(await gitOut(root, "rev-parse", "main"), before);
      } else {assertEquals(
          await Deno.readTextFile(`${root}/owner`),
          "owner change\n",
        );}
    });
  });
}

Deno.test("emergency review preserves actual-trunk, checkpoint, and protected-standard preconditions", async () => {
  await withTempDir(async (root) => {
    const path = await project(
      root,
      ["local"],
      `
[checkpoints.review]
paths = ['source']
question = 'Does the repair preserve the published contract?'
mode = 'stop'
`,
    );
    const ctx = await lifecycleContext(
      path,
      new Logger({ json: true, noColor: true }),
    );
    const blocked = await emergencyResult(ctx, { reason: "Restore service" });
    assertEquals(blocked.error, "precondition_failed", JSON.stringify(blocked));
    assertStringIncludes(blocked.message ?? "", "Checkpoint");
    const question = await runAgent(path, ["done", "--json"]);
    assertEquals(question.code, 1, question.output);
    const cfg = await Deno.readTextFile(`${path}/discern.toml`);
    await Deno.writeTextFile(
      `${path}/discern.toml`,
      cfg.replace("limit = 90", "limit = 80"),
    );
    await git(path, "add", "discern.toml");
    await git(path, "commit", "-m", "Propose weaker limit without approval");
    const weaker = await emergencyResult(
      await lifecycleContext(path, ctx.log),
      { reason: "Restore service" },
    );
    assertStringIncludes(weaker.message ?? "", "protected policy");
    await Deno.writeTextFile(`${root}/owner`, "new trunk\n");
    await git(root, "add", "owner");
    await git(root, "commit", "-m", "Advance actual trunk");
    const behind = await emergencyResult(ctx, { reason: "Restore service" });
    assertStringIncludes(behind.message ?? "", "discern update");
    assertEquals(
      (await emergencyResult(await lifecycleContext(root, ctx.log), {
        reason: "Restore service",
      })).error,
      "precondition_failed",
    );
    assertEquals(
      (await emergencyResult(ctx, { reason: "" })).error,
      "precondition_failed",
    );
  });
});
