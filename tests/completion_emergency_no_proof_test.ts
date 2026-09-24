/**
 * An emergency landing never supplies Proof, whatever the owner approves with
 * it. Carried work, a looser standard limit, and a variance over an unmet
 * checkpoint all land as one exception record and one exception note: no
 * Proof record, Proof note, or proof line exists for the landed commit, and
 * status reads the trunk tip as a landed exception.
 */

import { join } from "@std/path";
import { assert, assertEquals } from "@std/assert";
import { SYSTEM_CLOCK } from "../src/shared/clock.ts";
import { observeCompletionRecords } from "../src/engine/validation/runtime.ts";
import { readProofNoteAt } from "../src/engine/gate/proof_notes.ts";
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
import { assertResultDataKey, decodeCliResult } from "./decode_cli_result.ts";
import { emergencyData } from "./completion_emergency_helpers.ts";
import { withTempDir } from "./helpers.ts";

/** One gate job, a `hotspots` ceiling the repair breaches, and a stop
 * checkpoint the repair trips. */
const CONFIG = [
  "[project]",
  'slug = "engine-test"',
  "",
  "[repository]",
  'trunk = "main"',
  "",
  "[jobs]",
  'lint = "sh check.sh"',
  "",
  "[standards.hotspots]",
  'direction = "down"',
  "limit = 5",
  'run = "echo DISCERN_METRIC hotspots 7"',
  'inputs = ["hotfix.txt"]',
  "",
  "[checkpoints.api-review]",
  'paths = ["api/**"]',
  'question = "A changed API surface is described in its docs before it lands."',
  "",
].join("\n");

/** Commit every change in a checkout. */
async function commitAll(checkout: string, message: string): Promise<void> {
  await git(checkout, "add", "-A");
  await git(checkout, "commit", "-q", "-m", message, "--no-gpg-sign");
}

Deno.test("an emergency landing supplies no Proof, whatever the owner approves with it", async () => {
  await withTempDir(async (dir) => {
    await scaffoldEngine(dir);
    await writeConfig(dir, CONFIG);
    await writeExecutable(
      join(dir, "check.sh"),
      ["#!/usr/bin/env sh", "test ! -e taboo.txt", ""].join("\n"),
    );
    await gitInit(dir);

    // Another task's unlanded commit, which the repair builds on.
    const feature = await addWorktree(dir, "feature");
    await Deno.writeTextFile(join(feature, "feature.txt"), "feature\n");
    await commitAll(feature, "add feature");
    const started = await runAgent(dir, [
      "start",
      "--from",
      "agent/feature",
      "--name",
      "repair",
      "--json",
    ]);
    assertEquals(started.code, 0, started.output);
    const start = decodeCliResult(started.stdout, "start");
    assertResultDataKey(start, "path");
    const repair = start.data.path;

    // The repair trips the checkpoint and breaches the standard; the owner
    // agrees to the looser limit, which the agent records as a proposal.
    await Deno.mkdir(join(repair, "api"), { recursive: true });
    await Deno.writeTextFile(join(repair, "api", "surface.txt"), "fixed\n");
    await Deno.writeTextFile(join(repair, "hotfix.txt"), "restore service\n");
    await commitAll(repair, "fix: restore service");
    const proposed = await runAgent(repair, [
      "standards",
      "propose",
      "hotspots",
      "--reason",
      "The outage fix needs these hotspots until the follow-up task.",
      "--json",
    ]);
    assertEquals(proposed.code, 0, proposed.output);
    const emergency = (...args: string[]) =>
      runAgent(repair, [
        "accept",
        "emergency",
        "--reason",
        "Restore service",
        ...args,
        "--json",
      ]);
    const prepared = await emergency(
      "--prepare",
      "--unmet",
      "api-review",
      "--why",
      "The docs trail the fix; the follow-up task updates them.",
    );
    assertEquals(prepared.code, 0, prepared.output);
    const receipt = emergencyData(prepared.stdout).preparation;
    assert(receipt !== undefined, prepared.output);

    // The plan carries every kind of owner decision at once.
    const preview = await emergency("--preparation-receipt", receipt);
    assertEquals(preview.code, 1, preview.output);
    const planned = decodeCliResult(preview.stdout, "accept");
    assertResultDataKey(planned, "standard_approvals_required");
    const approval = planned.data.standard_approvals_required?.[0]?.token;
    const token = emergencyData(preview.stdout).confirmation;
    assert(approval !== undefined && token !== undefined, preview.output);
    const landed = await emergency(
      "--preparation-receipt",
      receipt,
      "--confirmed",
      "--approval-token",
      token,
      "--approve-standard",
      approval,
      "--variance",
      "api-review",
    );
    assertEquals(landed.code, 0, landed.output);
    const head = await gitOut(dir, "rev-parse", "main");
    const recorded = emergencyData(landed.stdout);
    assertEquals(recorded.outcome, "landed");
    assertEquals(recorded.carried?.length, 1);
    assertEquals(recorded.standard_approvals?.length, 1);
    assertEquals(recorded.variances?.length, 1);

    // Nothing reads the landing as Proof: no Proof record, no proof line,
    // and the landed commit's note is an exception.
    const result = decodeCliResult(landed.stdout, "accept");
    assertResultDataKey(result, "emergency");
    assertEquals(result.data.proof_line, undefined);
    assertEquals(result.data.proof_note, undefined);
    assertEquals(result.data.gate_validation, undefined);
    assertEquals(
      (await observeCompletionRecords(dir, SYSTEM_CLOCK, ["proof"])).records,
      [],
    );
    assertEquals((await readProofNoteAt(dir, head)).status, "exception");
    const status = await runAgent(dir, ["status", "--json"]);
    assertEquals(status.code, 0, status.output);
    const survey = decodeCliResult(status.stdout, "status");
    assertResultDataKey(survey, "landed_exception");
    assertEquals(survey.data.landed_exception?.commit, head);
  });
});
