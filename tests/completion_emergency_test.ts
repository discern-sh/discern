/**
 * The emergency exchange: an owner-approved exception lands one exact repair
 * through the acceptance transaction with no passing Proof. The plan serves a
 * short-lived confirmation over the exact subject; recorded grants never cover
 * it; the landing settles an `exception` record whose note and cleanup are
 * reported separately; recovery reconciles only the recorded transition.
 */

import { decodeBase64 } from "@std/encoding/base64";
import { join } from "@std/path";
import { assert, assertEquals, assertStringIncludes } from "@std/assert";
import { targetExists } from "../src/shared/fs_presence.ts";
import { SYSTEM_CLOCK, wallTimeIso } from "../src/shared/clock.ts";
import { EmergencyNotePayloadSchema } from "../src/shared/emergency_note.ts";
import { readEffortGrant } from "../src/engine/worktree/effort_grant.ts";
import { grantEffort } from "../src/engine/worktree/effort_grant_writer.ts";
import { readCompletionRecord } from "../src/engine/completion/store.ts";
import {
  addWorktree,
  git,
  gitInit,
  gitOut,
  runAgent,
  scaffoldEngine,
  writeConfig,
  writeExecutable,
} from "./engine_helpers.ts";
import { decodeCliResult, decodeWith } from "./decode_cli_result.ts";
import { withTempDir } from "./helpers.ts";
import { z } from "@zod/zod";

/** The exact scope sentence every emergency surface repeats verbatim. */
const BOUNDARY =
  "This authorizes only the displayed local emergency integration. No passing Proof, ordinary grant, remote push, deployment, or change to external branch protections is implied.";

/** A gate whose one check fails while `taboo.txt` exists in the tree. */
const CONFIG_CHECK = [
  "[project]",
  'slug = "engine-test"',
  "",
  "[repository]",
  'trunk = "main"',
  "",
  "[jobs]",
  'lint = "sh check.sh"',
  "",
].join("\n");

const CHECK_NO_TABOO = ["#!/usr/bin/env sh", "test ! -e taboo.txt", ""].join(
  "\n",
);

const DSSE_ENVELOPE_SCHEMA = z.object({ payload: z.string() }).passthrough();

/** A repair worktree whose committed fix trips the gate deliberately. */
async function failingRepair(dir: string): Promise<string> {
  await scaffoldEngine(dir);
  await writeConfig(dir, CONFIG_CHECK);
  await writeExecutable(join(dir, "check.sh"), CHECK_NO_TABOO);
  await gitInit(dir);
  const wt = await addWorktree(dir, "repair");
  await Deno.writeTextFile(join(wt, "hotfix.txt"), "restore service\n");
  await Deno.writeTextFile(join(wt, "taboo.txt"), "known breakage\n");
  await git(wt, "add", "-A");
  await git(wt, "commit", "-q", "-m", "fix: emergency repair", "--no-gpg-sign");
  const failed = await runAgent(wt, ["done", "--json"]);
  assertEquals(failed.code, 1, failed.output);
  return wt;
}

/** Decode the accept envelope's emergency payload, requiring its presence. */
function emergencyData(
  stdout: string,
): NonNullable<
  Extract<
    NonNullable<ReturnType<typeof decodeCliResult<"accept">>["data"]>,
    { emergency?: unknown }
  >["emergency"]
> {
  const envelope = decodeCliResult(stdout, "accept");
  assert(envelope.data !== undefined && "emergency" in envelope.data, stdout);
  const emergency = envelope.data.emergency;
  assert(emergency !== undefined, stdout);
  return emergency;
}

Deno.test("emergency serves an exact confirmation, excludes recorded grants, and lands an exception record with note and cleanup reported", async () => {
  await withTempDir(async (dir) => {
    const wt = await failingRepair(dir);
    const branch = await gitOut(wt, "branch", "--show-current");
    const repairHead = await gitOut(wt, "rev-parse", "HEAD");
    const trunkBefore = await gitOut(dir, "rev-parse", "main");

    // A recorded effort grant covers ordinary green landings only: the failing
    // gate has nothing proven, and the emergency route still demands its own
    // fresh exact confirmation.
    await grantEffort(wt, branch, wallTimeIso(SYSTEM_CLOCK.wallNow()));
    const ordinary = await runAgent(wt, ["accept", "--json"]);
    assertEquals(ordinary.code, 1, ordinary.output);
    assertEquals(
      decodeCliResult(ordinary.stdout, "accept").error,
      "precondition_failed",
      ordinary.output,
    );
    assertEquals(await gitOut(dir, "rev-parse", "main"), trunkBefore);

    const reason = "Restore the broken deploy path";
    const preview = await runAgent(wt, [
      "accept",
      "emergency",
      "--reason",
      reason,
      "--json",
    ]);
    assertEquals(preview.code, 1, preview.output);
    const previewEnvelope = decodeCliResult(preview.stdout, "accept");
    assertEquals(previewEnvelope.error, "awaiting_consent");
    const previewEmergency = emergencyData(preview.stdout);
    assertEquals(previewEmergency.outcome, "preview");
    assert(previewEmergency.confirmation !== undefined, preview.output);
    assert((previewEmergency.exceptions?.length ?? 0) > 0, preview.output);
    assertStringIncludes(previewEnvelope.message ?? "", BOUNDARY);
    assertStringIncludes(
      previewEnvelope.message ?? "",
      "The confirmation expires in 15 minutes; changed subjects require another review.",
    );
    assertEquals(await gitOut(dir, "rev-parse", "main"), trunkBefore);
    assert(await targetExists(wt), "a preview lands nothing");

    // The grant survives the preview untouched, and the --confirmed flag alone
    // (without the exact confirmation token) is still only a preview refusal.
    assertEquals((await readEffortGrant(wt)).status, "granted");
    const flagOnly = await runAgent(wt, [
      "accept",
      "emergency",
      "--reason",
      reason,
      "--confirmed",
      "--json",
    ]);
    assertEquals(flagOnly.code, 1, flagOnly.output);
    assertEquals(
      decodeCliResult(flagOnly.stdout, "accept").error,
      "awaiting_consent",
    );
    assertEquals(await gitOut(dir, "rev-parse", "main"), trunkBefore);

    // The owner-approved exact exchange lands the repair with no passing Proof.
    const token = previewEmergency.confirmation;
    assert(token !== undefined);
    const landed = await runAgent(wt, [
      "accept",
      "emergency",
      "--reason",
      reason,
      "--confirmed",
      "--confirmation",
      token,
      "--json",
    ]);
    assertEquals(landed.code, 0, landed.output);
    const landedEnvelope = decodeCliResult(landed.stdout, "accept");
    assertEquals(landedEnvelope.ok, true);
    const landedEmergency = emergencyData(landed.stdout);
    assertEquals(landedEmergency.outcome, "landed");
    assertEquals(landedEmergency.note, "published");
    assertEquals(landedEmergency.cleanup, "removed");
    assert(landedEmergency.landing_id !== undefined);
    assertStringIncludes(landedEnvelope.message ?? "", BOUNDARY);
    assertStringIncludes(
      landedEnvelope.message ?? "",
      `\`${branch}\` landed on main as an emergency, with no passing Proof.`,
    );
    assertEquals(await gitOut(dir, "rev-parse", "main"), repairHead);
    assertEquals(await targetExists(wt), false, landed.output);

    // The durable exception record settled: landed, note published.
    const record = await readCompletionRecord(dir, {
      kind: "exception",
      id: landedEmergency.landing_id,
    });
    assert(record.kind === "recorded" && record.record.kind === "exception");
    assertEquals(record.record.data.outcome.kind, "landed");
    assertEquals(record.record.data.note, "published");
    assertEquals(record.record.data.target, repairHead);
    assertEquals(record.record.data.claim.reason, reason);

    // The exception note reached the landed commit under the shared notes ref.
    const note = await gitOut(
      dir,
      "notes",
      "--ref=discern",
      "show",
      repairHead,
    );
    const envelope = decodeWith(DSSE_ENVELOPE_SCHEMA, note);
    const payload = decodeWith(
      EmergencyNotePayloadSchema,
      new TextDecoder().decode(decodeBase64(envelope.payload)),
    );
    assertEquals(payload.kind, "emergency-exception");
    assertEquals(payload.landing_id, landedEmergency.landing_id);
    assertEquals(payload.claim.reason, reason);

    // The landing reports the validation still owed on the landed trunk.
    assertStringIncludes(
      landedEnvelope.message ?? "",
      "Run discern done --rerun on the current committed trunk or a repair containing it to resolve outstanding validation.",
    );

    // Recovery reconciles only the recorded transition, read-only first.
    const recoverPreview = await runAgent(dir, [
      "accept",
      "emergency",
      "--recover",
      landedEmergency.landing_id,
      "--dry-run",
      "--json",
    ]);
    assertEquals(recoverPreview.code, 0, recoverPreview.output);
    assertStringIncludes(
      decodeCliResult(recoverPreview.stdout, "accept").message ?? "",
      "Recover only this recorded emergency transition and its cleanup. No new integration or authorization is created.",
    );
    const recovered = await runAgent(dir, [
      "accept",
      "emergency",
      "--recover",
      landedEmergency.landing_id,
      "--json",
    ]);
    assertEquals(recovered.code, 0, recovered.output);
    const recoveredEmergency = emergencyData(recovered.stdout);
    assertEquals(recoveredEmergency.outcome, "landed");
    assertEquals(recoveredEmergency.note, "published");
    assertEquals(await gitOut(dir, "rev-parse", "main"), repairHead);
  });
});

Deno.test("emergency refuses a changed subject and a replayed confirmation without landing", async () => {
  await withTempDir(async (dir) => {
    const wt = await failingRepair(dir);
    const trunkBefore = await gitOut(dir, "rev-parse", "main");
    const reason = "Restore service";
    const preview = await runAgent(wt, [
      "accept",
      "emergency",
      "--reason",
      reason,
      "--json",
    ]);
    assertEquals(preview.code, 1, preview.output);
    const token = emergencyData(preview.stdout).confirmation;
    assert(token !== undefined);

    // The approved subject changes: the old confirmation covers nothing, and
    // the exchange serves a fresh preview instead of landing.
    await Deno.writeTextFile(join(wt, "hotfix.txt"), "second attempt\n");
    await git(wt, "add", "-A");
    await git(wt, "commit", "-q", "-m", "revise the repair", "--no-gpg-sign");
    const replay = await runAgent(wt, [
      "accept",
      "emergency",
      "--reason",
      reason,
      "--confirmed",
      "--confirmation",
      token,
      "--json",
    ]);
    assertEquals(replay.code, 1, replay.output);
    const replayEnvelope = decodeCliResult(replay.stdout, "accept");
    assertEquals(replayEnvelope.error, "awaiting_consent");
    const replayEmergency = emergencyData(replay.stdout);
    assertEquals(replayEmergency.outcome, "preview");
    assert(
      replayEmergency.confirmation !== undefined &&
        replayEmergency.confirmation !== token,
      "a changed subject serves a fresh confirmation",
    );
    assertEquals(await gitOut(dir, "rev-parse", "main"), trunkBefore);
    assert(await targetExists(wt));

    // A changed reason is a different subject too.
    const changedReason = await runAgent(wt, [
      "accept",
      "emergency",
      "--reason",
      "A different justification",
      "--confirmed",
      "--confirmation",
      replayEmergency.confirmation,
      "--json",
    ]);
    assertEquals(changedReason.code, 1, changedReason.output);
    assertEquals(
      decodeCliResult(changedReason.stdout, "accept").error,
      "awaiting_consent",
    );
    assertEquals(await gitOut(dir, "rev-parse", "main"), trunkBefore);
  });
});

Deno.test("emergency argument combinations refuse before any plan is read", async () => {
  await withTempDir(async (dir) => {
    const wt = await failingRepair(dir);
    // Emergency fields without the explicit action.
    const withoutAction = await runAgent(wt, [
      "accept",
      "--reason",
      "Restore service",
      "--json",
    ]);
    assertEquals(withoutAction.code, 1, withoutAction.output);
    const refusal = decodeCliResult(withoutAction.stdout, "accept");
    assertEquals(refusal.error, "invalid_arguments");
    assertStringIncludes(
      refusal.message ?? "",
      "Emergency fields require the explicit accept emergency action",
    );
    // Preparation cannot carry confirmation or recovery.
    const mixed = await runAgent(wt, [
      "accept",
      "emergency",
      "--prepare",
      "--reason",
      "Restore service",
      "--confirmed",
      "--json",
    ]);
    assertEquals(mixed.code, 1, mixed.output);
    assertStringIncludes(
      decodeCliResult(mixed.stdout, "accept").message ?? "",
      "Emergency preparation cannot be combined with a receipt, confirmation, or transition recovery.",
    );
  });
});
