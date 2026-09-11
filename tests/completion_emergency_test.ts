import { gitOperationMarkerPath } from "../src/shared/git_admin_paths.ts";
import { PROOF_NOTES_REF } from "../src/shared/git_conventions.ts";
import { recordExceptionNote } from "../src/engine/emergency/note.ts";
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
import { assertTerminalTextIncludes, withTempDir } from "./helpers.ts";
import { git, gitOut, runAgent } from "./engine_helpers.ts";
import { emergencyResult } from "../src/engine/emergency/action.ts";
import { lifecycleContext } from "../src/engine/worktree/lifecycle.ts";
import { Logger } from "../src/lib/log.ts";
import {
  emergencyValidationInventory,
  emergencyValidationStatus,
} from "../src/engine/emergency/obligations.ts";
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
    const beforePreview = observedRecords(await observeQueue(root, "main"));
    const cliPreview = await runAgent(path, [
      "accept",
      "emergency",
      "--reason",
      "Restore service",
      "--json",
    ]);
    const decodedPreview = decodeCliResult(cliPreview.stdout, "accept");
    assertEquals(decodedPreview.error, "awaiting_consent", cliPreview.output);
    assert(
      decodedPreview.data !== undefined && "emergency" in decodedPreview.data &&
        decodedPreview.data.emergency?.confirmation,
    );
    assertEquals(await gitOut(root, "rev-parse", "main"), before);
    assertEquals(await readEffortGrant(path), grant);
    assertEquals(
      observedRecords(await observeQueue(root, "main")),
      beforePreview,
      "native preview cannot publish completion records",
    );
    const preview = decodedPreview.data.emergency;
    const token = preview.confirmation;
    assert(token);
    assertEquals(
      preview.exceptions?.map((entry) => entry.state),
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
    assert(
      (landed.message ?? "").startsWith(
        "`agent/public-done` landed on main as an emergency, with no passing Proof.",
      ),
      landed.message,
    );
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
    await withTempDir(async (outside) => {
      const unavailable = await recordExceptionNote(outside, exception);
      assertEquals(unavailable.status, "record_failed");
      assert(unavailable.reason);
    });
    await git(root, "notes", "--ref=discern", "remove", exception.data.target);
    const notesLock = await gitOperationMarkerPath(
      root,
      `${PROOF_NOTES_REF}.lock`,
      async (cwd, args) => ({
        success: true,
        stdout: await gitOut(cwd, ...args),
      }),
    );
    assert(notesLock);
    await Deno.writeTextFile(notesLock, "another notes writer");
    const locked = await recordExceptionNote(root, exception);
    assertEquals(locked.status, "record_failed");
    assert(locked.reason);
    assertEquals(await Deno.readTextFile(notesLock), "another notes writer");
    await Deno.remove(notesLock);
    assertEquals(
      (await recordExceptionNote(root, exception)).status,
      "recorded",
    );
    assertEquals(
      (await recordExceptionNote(root, exception)).status,
      "already_present",
    );
    assertEquals(ProofNotePayloadSchema.safeParse(payload).success, false);
    // The exception note is a distinct record kind: never passing Proof, and
    // never mistaken for a format this build cannot read.
    const reading = await readProofNoteAt(root, exception.data.target);
    assertEquals(reading.status, "exception");
    assert(reading.status === "exception");
    assertEquals(reading.landing_id, exception.id);
    assert(exception.data.claim.kind === "exception");
    assertEquals(reading.reason, exception.data.claim.reason);
    assertEquals(
      (await emergencyValidationStatus(root))[0]?.state,
      "outstanding",
    );
    const pending = await runAgent(root, ["status", "--json"]);
    assertEquals(pending.code, 0, pending.output);
    const pendingStatus = decodeCliResult(pending.stdout, "status");
    assert(pendingStatus.data !== undefined, pending.output);
    assert(!("landed_proof_unsupported" in pendingStatus.data), pending.output);
    assertEquals(
      "landed_exception" in pendingStatus.data
        ? pendingStatus.data.landed_exception?.validation
        : undefined,
      "outstanding",
      pending.output,
    );
    const validation = await runAgent(root, ["done", "--rerun", "--json"]);
    assertEquals(validation.code, 0, validation.output);
    // A resolved exception leaves every projection; the durable inventory
    // retains the resolution for provenance readers.
    assertEquals(
      await emergencyValidationStatus(root),
      [],
      validation.output,
    );
    assertEquals(
      (await emergencyValidationInventory(root))[0]?.state,
      "resolved",
      validation.output,
    );
    for (const flags of [[], ["--verbose"]]) {
      const settled = await runAgent(root, ["status", ...flags, "--json"]);
      assertEquals(settled.code, 0, settled.output);
      assert(
        !settled.stdout.includes('"emergency_validation"'),
        `resolved exception must leave status ${flags.join(" ")}: ` +
          settled.stdout,
      );
      const settledStatus = decodeCliResult(settled.stdout, "status");
      assert(settledStatus.data !== undefined, settled.output);
      assertEquals(
        "landed_exception" in settledStatus.data
          ? settledStatus.data.landed_exception?.validation
          : undefined,
        "resolved",
        settled.output,
      );
    }
    const resolved = (await emergencyValidationInventory(root))[0];
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

Deno.test("emergency preparation settles runtime checkpoints without validation and rejects stale review receipts", async () => {
  await withTempDir(async (root) => {
    const path = await project(
      root,
      ["local"],
      `
[checkpoints.review]
paths = ['source']
question = 'Does this repair preserve the contract?'
when = 'case "$(cat source)" in invalid) exit 7;; mutate) printf dirty > unexpected;; esac; printf c >> executions'
mode = 'stop'
`,
    );
    const ctx = await lifecycleContext(
      path,
      new Logger({ json: true, noColor: true }),
    );
    const before = await gitOut(root, "rev-parse", "main");
    const options = { reason: "Restore service" };
    const dry = await runAgent(path, [
      "accept",
      "emergency",
      "--prepare",
      "--dry-run",
      "--reason",
      options.reason,
      "--json",
    ]);
    assertEquals(dry.code, 0, dry.output);
    const { targetExists } = await import("../src/shared/fs_presence.ts");
    assertEquals(await targetExists(`${path}/executions`), false);
    for (
      const forbidden of [
        { prepare: true, confirmed: true },
        { prepare: true, confirmation: "old" },
        { prepare: true, preparation: "old" },
        { prepare: true, recover: "old" },
        { met: ["review"] },
      ]
    ) {
      assertEquals(
        (await emergencyResult(ctx, { ...options, ...forbidden })).error,
        "invalid_arguments",
      );
    }
    const served = await runAgent(path, [
      "accept",
      "emergency",
      "--prepare",
      "--reason",
      options.reason,
      "--json",
    ]);
    assertEquals(served.code, 1, served.output);
    assertStringIncludes(served.output, "awaiting_declaration");
    assertTerminalTextIncludes(
      served.output,
      "Does this repair preserve the contract?",
    );
    const prepared = await runAgent(path, [
      "accept",
      "emergency",
      "--prepare",
      "--reason",
      options.reason,
      "--met",
      "review",
      "--json",
    ]);
    assertEquals(prepared.code, 0, prepared.output);
    const result = decodeCliResult(prepared.stdout, "accept");
    assert(result.data !== undefined && "emergency" in result.data);
    const preparation = result.data.emergency?.preparation;
    assert(preparation);
    assertEquals(await Deno.readTextFile(`${path}/executions`), "cc");
    assertEquals(observedRecords(await observeQueue(root, "main")).length, 0);
    const preview = await emergencyResult(ctx, { ...options, preparation });
    assertEquals(preview.error, "awaiting_consent", JSON.stringify(preview));
    const oldToken = preview.data?.emergency?.confirmation;
    assert(oldToken);
    assertEquals(
      await Deno.readTextFile(`${path}/executions`),
      "cc",
      "read-only preview must not rerun the trigger",
    );
    const { readEmergencyPreparation, emergencyPreparationHandle } =
      await import("../src/engine/emergency/review.ts");
    const { planEmergency } = await import("../src/engine/emergency/plan.ts");
    const plan = await planEmergency(ctx, options.reason, preparation);
    const artifact = await readEmergencyPreparation(
      path,
      ctx.config,
      plan.candidate_id,
      plan.candidate,
      preparation,
    );
    const corrupted = emergencyPreparationHandle({
      ...artifact,
      digest: "0".repeat(64),
    });
    assertEquals(
      (await emergencyResult(ctx, { ...options, preparation: corrupted }))
        .error,
      "precondition_failed",
    );
    const { runCheckpointPreflight } = await import(
      "../src/engine/checkpoints/preflight.ts"
    );
    await runCheckpointPreflight(path, ctx.config, {
      met: [],
      unmet: { id: "review", why: "Contract review remains incomplete." },
    });
    assertEquals(
      (await emergencyResult(ctx, { ...options, preparation })).error,
      "precondition_failed",
    );
    const unmet = await emergencyResult(ctx, { ...options, prepare: true });
    assertEquals(unmet.error, "precondition_failed");
    assertEquals(unmet.data?.emergency?.preparation, undefined);
    for (const source of ["invalid", "mutate"]) {
      await Deno.writeTextFile(`${path}/source`, source);
      await git(path, "add", "source");
      await git(path, "commit", "-m", `Exercise ${source} checkpoint`);
      const refusal = await emergencyResult(ctx, { ...options, prepare: true });
      assert(!refusal.ok, JSON.stringify(refusal));
      assertEquals(refusal.data?.emergency?.preparation, undefined);
      assertEquals(await gitOut(root, "rev-parse", "main"), before);
      if (source === "invalid") {
        assert((refusal.data?.checkpoint_preparation?.drops?.length ?? 0) > 0);
      } else {
        assertEquals(await Deno.readTextFile(`${path}/unexpected`), "dirty");
        await Deno.remove(`${path}/unexpected`);
      }
    }
    await Deno.writeTextFile(`${path}/source`, "repaired");
    await git(path, "add", "source");
    await git(path, "commit", "-m", "Complete repair");
    assertEquals(
      (await emergencyResult(ctx, { ...options, preparation })).error,
      "precondition_failed",
    );
    await emergencyResult(ctx, { ...options, prepare: true });
    const current = await emergencyResult(ctx, {
      ...options,
      prepare: true,
      met: ["review"],
    });
    assert(current.ok, JSON.stringify(current));
    const currentPreparation = current.data?.emergency?.preparation;
    assert(currentPreparation);
    const fresh = await emergencyResult(ctx, {
      ...options,
      preparation: currentPreparation,
      confirmed: true,
      confirmation: oldToken,
    });
    assertEquals(fresh.error, "awaiting_consent");
    assertEquals(await gitOut(root, "rev-parse", "main"), before);
    const confirmation = fresh.data?.emergency?.confirmation;
    assert(confirmation);
    const applied = await runAgent(path, [
      "accept",
      "emergency",
      "--reason",
      options.reason,
      "--preparation",
      currentPreparation,
      "--confirmed",
      "--confirmation",
      confirmation,
      "--json",
    ]);
    assertEquals(applied.code, 0, applied.output);
    const landed = decodeCliResult(applied.stdout, "accept");
    assert(
      landed.ok && landed.data !== undefined && "emergency" in landed.data,
      JSON.stringify(landed),
    );
    assertEquals(landed.data.emergency?.outcome, "landed");
    assertEquals(landed.data.emergency?.retirement, "retained");
    assertEquals(
      await gitOut(root, "rev-parse", "main"),
      await gitOut(path, "rev-parse", "HEAD"),
    );
    const recovered = await runAgent(path, [
      "accept",
      "emergency",
      "--recover",
      landed.data.emergency?.landing_id ?? "",
      "--json",
    ]);
    assertEquals(recovered.code, 0, recovered.output);
    assertEquals(decodeCliResult(recovered.stdout, "accept").ok, true);
    const records = observedRecords(await observeQueue(root, "main"));
    const landing = records.find((record) => record.kind === "landing");
    assert(
      landing?.kind === "landing" && landing.data.claim.kind === "exception",
    );
    assertEquals(
      landing.data.claim.review?.path,
      "environment/emergency-review.json",
    );
    const { ExceptionClaimSchema } = await import(
      "../src/engine/completion/exception_claim.ts"
    );
    assert(landing.data.claim.review);
    assertEquals(
      ExceptionClaimSchema.safeParse({
        ...landing.data.claim,
        review: {
          ...landing.data.claim.review,
          candidate_id: "00000000-0000-4000-a000-000000000000",
        },
      }).success,
      false,
    );
    assertEquals(records.filter((record) => record.kind === "proof").length, 0);
    assertEquals(
      records.filter((record) => record.kind === "evidence").length,
      0,
    );

    // An ordinary acceptance actor may recover the retained exception, but
    // cannot turn it into Proof or let it authorize the next source revision.
    const recoveredOrdinary = await runAgent(root, ["accept", "--json"]);
    assertEquals(recoveredOrdinary.code, 0, recoveredOrdinary.output);
    const historicalResult = decodeCliResult(
      recoveredOrdinary.stdout,
      "accept",
    );
    assert(
      historicalResult.data !== undefined && "queue" in historicalResult.data,
    );
    const historicalRow = historicalResult.data.queue?.[0];
    assertEquals(
      Reflect.get(historicalRow ?? {}, "exception"),
      landing.data.claim,
    );
    assertEquals(historicalRow?.proof_line, undefined);
    assertEquals(historicalRow?.proof_note, undefined);
    assertEquals(historicalResult.data.proof_line, undefined);
    assertTerminalTextIncludes(recoveredOrdinary.output, "no passing Proof");

    await Deno.writeTextFile(`${path}/followup`, "validated repair\n");
    await git(path, "add", "followup");
    await git(path, "commit", "-m", "Validate a later repair");
    const source = await gitOut(path, "rev-parse", "HEAD");
    const pendingReview = await runAgent(path, [
      "done",
      "--retain-checkout",
      "--json",
    ]);
    assertEquals(pendingReview.code, 1, pendingReview.output);
    assertStringIncludes(pendingReview.output, "awaiting_declaration");
    const completed = await runAgent(path, [
      "done",
      "--retain-checkout",
      "--met",
      "review",
      "--json",
    ]);
    assertEquals(completed.code, 0, completed.output);
    const unapproved = await runAgent(path, ["accept", "--json"]);
    assertEquals(unapproved.code, 1, unapproved.output);
    assertStringIncludes(unapproved.output, "missing-authority");
    assertEquals(await gitOut(root, "rev-parse", "main"), landing.data.target);
    const accepted = await runAgent(path, ["accept", "--confirmed", "--json"]);
    assertEquals(accepted.code, 0, accepted.output);
    assertEquals(await gitOut(root, "rev-parse", "main"), source);
    const acceptedResult = decodeCliResult(accepted.stdout, "accept");
    assert(acceptedResult.data !== undefined && "queue" in acceptedResult.data);
    assertEquals(acceptedResult.data.queue?.length, 2);
    assertEquals(acceptedResult.data.queue?.[0]?.proof_line, undefined);
    assertStringIncludes(
      acceptedResult.data.proof_line ?? "",
      source.slice(0, 12),
    );
    const settled = observedRecords(await observeQueue(root, "main"));
    assertEquals(settled.find((record) => record.id === landing.id), landing);
    const repeated = await runAgent(path, ["accept", "--json"]);
    assertEquals(repeated.code, 0, repeated.output);
    assertEquals(
      observedRecords(await observeQueue(root, "main")).filter((record) =>
        record.kind === "landing" || record.kind === "authority"
      ),
      settled.filter((record) =>
        record.kind === "landing" || record.kind === "authority"
      ),
    );
  });
});
