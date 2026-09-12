/**
 * Outstanding emergency validation and its resolution: a landed exception is
 * reported outstanding on status and completion surfaces until a later strict
 * complete run on the integrated trunk resolves it. Resolution writes an
 * independent receipt naming the later Proof; the exception record and its
 * note stay the durable history, and a corrupt or mismatched receipt throws
 * so it is preserved rather than silently reported either way.
 */

import { join } from "@std/path";
import {
  assert,
  assertEquals,
  assertRejects,
  assertStringIncludes,
} from "@std/assert";
import { artifactPath } from "../src/engine/completion/artifact_paths.ts";
import { readCompletionRecord } from "../src/engine/completion/store.ts";
import {
  emergencyValidationInventory,
  emergencyValidationStatus,
  parseEmergencyResolution,
  resolveEmergencyValidation,
} from "../src/engine/emergency/obligations.ts";
import type { EmergencyValidation } from "../src/shared/emergency.ts";
import {
  newerOnDiskFormatMessage,
  ON_DISK_FORMATS,
} from "../src/shared/on_disk_formats.ts";
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
import { withTempDir } from "./helpers.ts";

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

const OUTSTANDING_ACTION =
  "Run discern done --rerun on the current committed trunk or a repair containing it. The emergency exception remains historical.";
const RESOLVED_ACTION =
  "A later complete run resolved this validation. The exception record and its note remain the durable history; it never becomes passing Proof for the emergency landing.";

/** The status result's emergency_validation rows, decoded. */
async function statusValidation(dir: string): Promise<EmergencyValidation[]> {
  const status = await runAgent(dir, ["status", "--json"]);
  assertEquals(status.code, 0, status.output);
  const data = decodeCliResult(status.stdout, "status").data;
  assert(data !== undefined && "location" in data, status.output);
  return [...data.emergency_validation ?? []];
}

Deno.test("a later strict done on the integrated trunk resolves outstanding validation without erasing the exception", async () => {
  await withTempDir(async (dir) => {
    await scaffoldEngine(dir);
    await writeConfig(dir, CONFIG_CHECK);
    await writeExecutable(
      join(dir, "check.sh"),
      ["#!/usr/bin/env sh", "test ! -e taboo.txt", ""].join("\n"),
    );
    await gitInit(dir);
    const trunkBefore = await gitOut(dir, "rev-parse", "main");
    const wt = await addWorktree(dir, "repair");
    await Deno.writeTextFile(join(wt, "hotfix.txt"), "restore service\n");
    await Deno.writeTextFile(join(wt, "taboo.txt"), "known breakage\n");
    await git(wt, "add", "-A");
    await git(wt, "commit", "-q", "-m", "fix: repair", "--no-gpg-sign");
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
    assert(
      previewEnvelope.data !== undefined && "emergency" in previewEnvelope.data,
    );
    const token = previewEnvelope.data.emergency?.confirmation;
    assert(token !== undefined, preview.output);
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
    assert(
      landedEnvelope.data !== undefined && "emergency" in landedEnvelope.data,
    );
    const landingId = landedEnvelope.data.emergency?.landing_id;
    assert(landingId !== undefined, landed.output);
    assertEquals(
      landedEnvelope.data.emergency_validation?.map((row) => row.state),
      ["outstanding"],
      landed.output,
    );

    // Status reports the one outstanding validation with its next action.
    const outstanding = await statusValidation(dir);
    assertEquals(outstanding.length, 1);
    assertEquals(outstanding[0]?.landing_id, landingId);
    assertEquals(outstanding[0]?.state, "outstanding");
    assertEquals(outstanding[0]?.next_action, OUTSTANDING_ACTION);

    // Repair the trunk and complete a strict run on it.
    await Deno.remove(join(dir, "taboo.txt"));
    await git(dir, "add", "-A");
    await git(
      dir,
      "commit",
      "-q",
      "-m",
      "remove the breakage",
      "--no-gpg-sign",
    );
    const done = await runAgent(dir, ["done", "--json"]);
    assertEquals(done.code, 0, done.output);
    const doneData = decodeCliResult(done.stdout, "done").data;
    assert(doneData !== undefined, done.output);
    assertEquals(
      "emergency_validation" in doneData
        ? doneData.emergency_validation
        : undefined,
      undefined,
      "a resolved exception leaves the completion projection",
    );

    // The resolution receipt names this landing and the later Proof's head.
    const receiptPath = await artifactPath(
      await Deno.realPath(dir),
      landingId,
      `environment/emergency-validation-${landingId}.json`,
    );
    const receiptRaw = await Deno.readTextFile(receiptPath);
    const receipt = parseEmergencyResolution(receiptRaw, receiptPath);
    assertEquals(receipt.landing_id, landingId);
    assertEquals(receipt.head, await gitOut(dir, "rev-parse", "main"));

    // Status no longer reports the exception; the durable inventory keeps it
    // as resolved history with the later Proof recorded.
    assertEquals(await statusValidation(dir), []);
    assertEquals(await emergencyValidationStatus(dir), []);
    const inventory = await emergencyValidationInventory(dir);
    assertEquals(inventory.length, 1);
    assertEquals(inventory[0]?.state, "resolved");
    assertEquals(inventory[0]?.landing_id, landingId);
    assert(inventory[0]?.resolved_by !== undefined);
    assertEquals(inventory[0]?.next_action, RESOLVED_ACTION);

    // The exception record and its note are never erased by resolution.
    const record = await readCompletionRecord(dir, {
      kind: "exception",
      id: landingId,
    });
    assert(record.kind === "recorded" && record.record.kind === "exception");
    assertEquals(record.record.data.outcome.kind, "landed");
    assertEquals(record.record.data.note, "published");
    assertStringIncludes(
      await gitOut(dir, "notes", "--ref=discern", "list"),
      record.record.data.target,
    );

    // Resolving again against the same Proof is a no-op: the receipt stands.
    await resolveEmergencyValidation(dir, receipt.proof);
    assertEquals(await Deno.readTextFile(receiptPath), receiptRaw);

    // A receipt naming another landing is preserved, never reinterpreted.
    const tampered = { ...receipt, landing_id: crypto.randomUUID() };
    await Deno.writeTextFile(receiptPath, JSON.stringify(tampered));
    await assertRejects(
      () => emergencyValidationInventory(dir),
      Error,
      "The emergency validation receipt names another landing. Preserve it for recovery.",
    );

    // A receipt whose head does not match the retained Proof is preserved too.
    await Deno.writeTextFile(
      receiptPath,
      JSON.stringify({ ...receipt, head: trunkBefore }),
    );
    await assertRejects(
      () => emergencyValidationInventory(dir),
      Error,
      "The emergency validation receipt lacks matching later complete Proof. Preserve it and restore its evidence before treating validation as resolved.",
    );

    // A receipt from a newer engine reports forward skew instead of guessing.
    const newer = ON_DISK_FORMATS.emergencyResolution.version + 1;
    await Deno.writeTextFile(
      receiptPath,
      JSON.stringify({ ...receipt, version: newer }),
    );
    await assertRejects(
      () => emergencyValidationInventory(dir),
      Error,
      newerOnDiskFormatMessage("emergencyResolution", newer),
    );

    // Restoring the original bytes restores the resolved reading.
    await Deno.writeTextFile(receiptPath, receiptRaw);
    assertEquals(
      (await emergencyValidationInventory(dir))[0]?.state,
      "resolved",
    );
  });
});

Deno.test("the validation inventory is empty outside a work tree", async () => {
  await withTempDir(async (dir) => {
    assertEquals(await emergencyValidationInventory(dir), []);
  });
});
