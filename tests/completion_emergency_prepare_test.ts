/**
 * Emergency checkpoint preparation: `accept emergency --prepare` runs only the
 * canonical checkpoint triggers, serves questions, records `--met`
 * conclusions, and returns a receipt binding that judgment evidence to the
 * exact repair and trunk. The receipt conveys no landing authority; the
 * owner-review plan consumes it with `--preparation` and refuses a receipt
 * from another candidate or from since-changed declarations.
 */

import { join } from "@std/path";
import { assert, assertEquals, assertStringIncludes } from "@std/assert";
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
import { decodeCliResult } from "./decode_cli_result.ts";
import { assertTerminalTextIncludes, withTempDir } from "./helpers.ts";

const QUESTION =
  "A changed API surface is described in its docs before it lands.";

/** A gate whose one check fails while `taboo.txt` exists, plus one stop
 * checkpoint watching `api/**` — committed at the trunk, so the governing
 * copy carries both. */
const CONFIG_CHECKPOINT = [
  "[project]",
  'slug = "engine-test"',
  "",
  "[repository]",
  'trunk = "main"',
  "",
  "[jobs]",
  'lint = "sh check.sh"',
  "",
  "[checkpoints.api-review]",
  'paths = ["api/**"]',
  `question = "${QUESTION}"`,
  'teach = "State the failure modes; note what callers must revisit."',
  "",
].join("\n");

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

/** Run `accept emergency` with the given trailing arguments, JSON mode. */
async function emergency(
  cwd: string,
  ...args: string[]
): Promise<{ code: number; output: string; stdout: string }> {
  return await runAgent(cwd, ["accept", "emergency", ...args, "--json"]);
}

Deno.test("checkpoint preparation serves the question, records --met, and its receipt binds the exact candidate and declarations", async () => {
  await withTempDir(async (dir) => {
    await scaffoldEngine(dir);
    await writeConfig(dir, CONFIG_CHECKPOINT);
    await writeExecutable(
      join(dir, "check.sh"),
      ["#!/usr/bin/env sh", "test ! -e taboo.txt", ""].join("\n"),
    );
    await gitInit(dir);
    const wt = await addWorktree(dir, "repair");
    await Deno.mkdir(join(wt, "api"), { recursive: true });
    await Deno.writeTextFile(join(wt, "api", "surface.txt"), "changed api\n");
    await Deno.writeTextFile(join(wt, "taboo.txt"), "known breakage\n");
    await git(wt, "add", "-A");
    await git(wt, "commit", "-q", "-m", "fix: api repair", "--no-gpg-sign");
    const reason = "Restore the broken API path";

    // Without settled judgment, the integration plan itself refuses.
    const unprepared = await emergency(wt, "--reason", reason);
    assertEquals(unprepared.code, 1, unprepared.output);
    assertTerminalTextIncludes(
      decodeCliResult(unprepared.stdout, "accept").message ?? "",
      "Checkpoint judgment or its evidence is outstanding. Run accept emergency --prepare --reason <text> to settle checkpoint triggers and answer the served questions. Emergency integration cannot supply a judgment or variance.",
    );

    // A dry-run names exactly what preparation will and will not do.
    const dry = await emergency(
      wt,
      "--prepare",
      "--reason",
      reason,
      "--dry-run",
    );
    assertEquals(dry.code, 0, dry.output);
    const dryEnvelope = decodeCliResult(dry.stdout, "accept");
    assertEquals(dryEnvelope.dry_run, true);
    assertEquals(
      dryEnvelope.message,
      "Preparation will run checkpoint triggers, serve or record agent conclusions, and retain review evidence for this exact repair and trunk. No validation jobs or integration will run.",
    );

    // Preparation serves the outstanding question and stops there.
    const served = await emergency(wt, "--prepare", "--reason", reason);
    assertEquals(served.code, 1, served.output);
    const servedEnvelope = decodeCliResult(served.stdout, "accept");
    assertEquals(servedEnvelope.error, "awaiting_declaration");
    assertStringIncludes(
      servedEnvelope.message ?? "",
      `api-review: ${QUESTION}`,
    );
    assertStringIncludes(servedEnvelope.message ?? "", "Changed:");
    assertStringIncludes(
      servedEnvelope.message ?? "",
      "Answer only satisfied questions with accept emergency --prepare --reason <text> --met <id> (repeatable). An unmet question remains a stop for emergency integration. No validation or integration ran.",
    );
    assert(
      (servedEnvelope.hints ?? []).some((hint) =>
        hint.includes(
          "Follow the preparation result. Repeat accept emergency --prepare with --met only for satisfied served questions; then request the owner-review plan with its preparation receipt.",
        )
      ),
      served.output,
    );

    // An id outside the active set is refused before any write.
    const bogus = await emergency(
      wt,
      "--prepare",
      "--reason",
      reason,
      "--met",
      "bogus",
    );
    assertEquals(bogus.code, 1, bogus.output);
    const bogusEnvelope = decodeCliResult(bogus.stdout, "accept");
    assertEquals(bogusEnvelope.error, "invalid_arguments");
    assertStringIncludes(
      bogusEnvelope.message ?? "",
      "'bogus' is not a checkpoint awaiting a conclusion here;",
    );

    // A declared-unmet question blocks preparation without granting anything.
    // (Declared through the ordinary done flow, which also records the
    // candidate — the same durable identity preparation binds to.)
    const declaredUnmet = await runAgent(wt, [
      "done",
      "--unmet",
      "api-review",
      "--why",
      "The docs are not updated yet.",
      "--json",
    ]);
    assertEquals(declaredUnmet.code, 1, declaredUnmet.output);
    const blocked = await emergency(wt, "--prepare", "--reason", reason);
    assertEquals(blocked.code, 1, blocked.output);
    const blockedEnvelope = decodeCliResult(blocked.stdout, "accept");
    assertEquals(blockedEnvelope.error, "precondition_failed");
    assertStringIncludes(
      blockedEnvelope.message ?? "",
      "Checkpoint evidence or an unmet question still blocks emergency integration. Resolve the recorded condition; preparation cannot grant a variance or weaken policy.",
    );

    // A recorded met conclusion completes preparation with a receipt.
    const prepared = await emergency(
      wt,
      "--prepare",
      "--reason",
      reason,
      "--met",
      "api-review",
    );
    assertEquals(prepared.code, 0, prepared.output);
    const receipt = emergencyData(prepared.stdout).preparation;
    assert(receipt !== undefined && receipt.startsWith("emergency-review-v1."));
    assertEquals(emergencyData(prepared.stdout).outcome, "prepared");
    assertEquals(
      decodeCliResult(prepared.stdout, "accept").message,
      `Checkpoint preparation is complete. No validation jobs, passing Proof, or integration were produced. Run accept emergency --reason <text> --preparation ${receipt} for the exact owner-review plan. This receipt grants no landing authority.`,
    );

    // Only a receipt from --prepare is honored.
    const garbage = await emergency(
      wt,
      "--reason",
      reason,
      "--preparation",
      "not-a-receipt",
    );
    assertEquals(garbage.code, 1, garbage.output);
    assertTerminalTextIncludes(
      decodeCliResult(garbage.stdout, "accept").message ?? "",
      "Use the preparation receipt returned by accept emergency --prepare.",
    );

    // The receipt reaches the owner-review plan, whose repeat instruction
    // carries the receipt alongside the confirmation.
    const preview = await emergency(
      wt,
      "--reason",
      reason,
      "--preparation",
      receipt,
    );
    assertEquals(preview.code, 1, preview.output);
    const previewEnvelope = decodeCliResult(preview.stdout, "accept");
    assertEquals(previewEnvelope.error, "awaiting_consent");
    assertStringIncludes(
      previewEnvelope.message ?? "",
      `--preparation ${receipt}, --confirmed, and --confirmation`,
    );

    // A conclusion revised after preparation invalidates the receipt: the
    // review must carry the judgment the plan is served under.
    const revised = await runAgent(wt, [
      "done",
      "--unmet",
      "api-review",
      "--why",
      "Second thoughts: one caller is still undocumented.",
      "--json",
    ]);
    assertEquals(revised.code, 1, revised.output);
    const changed = await emergency(
      wt,
      "--reason",
      reason,
      "--preparation",
      receipt,
    );
    assertEquals(changed.code, 1, changed.output);
    assertTerminalTextIncludes(
      decodeCliResult(changed.stdout, "accept").message ?? "",
      "Checkpoint declarations changed after preparation. Prepare the current repair again.",
    );

    // A new commit is another candidate: any earlier receipt is dead first.
    await Deno.writeTextFile(join(wt, "api", "surface.txt"), "revised api\n");
    await git(wt, "add", "-A");
    await git(wt, "commit", "-q", "-m", "revise the api", "--no-gpg-sign");
    const stale = await emergency(
      wt,
      "--reason",
      reason,
      "--preparation",
      receipt,
    );
    assertEquals(stale.code, 1, stale.output);
    assertTerminalTextIncludes(
      decodeCliResult(stale.stdout, "accept").message ?? "",
      "Emergency preparation belongs to another candidate. Prepare the current repair again.",
    );

    // A fresh met conclusion prepares the revised candidate, and the
    // receipt-backed exchange lands with the review retained in the claim.
    const final = await emergency(
      wt,
      "--prepare",
      "--reason",
      reason,
      "--met",
      "api-review",
    );
    assertEquals(final.code, 0, final.output);
    const receipt3 = emergencyData(final.stdout).preparation;
    assert(receipt3 !== undefined);
    const plan = await emergency(
      wt,
      "--reason",
      reason,
      "--preparation",
      receipt3,
    );
    assertEquals(plan.code, 1, plan.output);
    const token = emergencyData(plan.stdout).confirmation;
    assert(token !== undefined, plan.output);
    const landed = await emergency(
      wt,
      "--reason",
      reason,
      "--preparation",
      receipt3,
      "--confirmed",
      "--confirmation",
      token,
    );
    assertEquals(landed.code, 0, landed.output);
    const landedEmergency = emergencyData(landed.stdout);
    assertEquals(landedEmergency.outcome, "landed");
    assert(landedEmergency.landing_id !== undefined);
    const record = await readCompletionRecord(dir, {
      kind: "exception",
      id: landedEmergency.landing_id,
    });
    assert(record.kind === "recorded" && record.record.kind === "exception");
    assertEquals(
      record.record.data.claim.review?.path,
      "environment/emergency-review.json",
    );
    assertEquals(
      await gitOut(dir, "rev-parse", "main"),
      record.record.data.target,
    );
  });
});
