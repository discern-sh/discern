/**
 * The emergency exchange: an owner-approved exception lands one exact repair
 * through the acceptance transaction with no passing Proof. The plan serves a
 * short-lived confirmation over the exact subject; recorded grants never cover
 * it; the landing settles an `exception` record whose note and cleanup are
 * reported separately; recovery reconciles only the recorded transition.
 */

import { decodeBase64 } from "@std/encoding/base64";
import { candidateAuthor } from "../src/engine/completion/candidate.ts";
import { dirname, join } from "@std/path";
import {
  assert,
  assertEquals,
  assertStringIncludes,
  assertThrows,
} from "@std/assert";
import { targetExists } from "../src/shared/fs_presence.ts";
import { SYSTEM_CLOCK, wallTimeIso } from "../src/shared/clock.ts";
import { EmergencyNotePayloadSchema } from "../src/shared/emergency_note.ts";
import { ON_DISK_FORMATS } from "../src/shared/on_disk_formats.ts";
import { sha256Hex } from "../src/shared/sha256.ts";
import { readEffortGrant } from "../src/engine/worktree/effort_grant.ts";
import { grantEffort } from "../src/engine/worktree/effort_grant_writer.ts";
import { readySentinelPath } from "../src/engine/worktree/git.ts";
import { recordSubmission } from "../src/engine/worktree/submission_writer.ts";
import { observeCompletionRecords } from "../src/engine/validation/runtime.ts";
import {
  readCompletionRecord,
  writeCompletionRecord,
} from "../src/engine/completion/store.ts";
import type { CompletionRecord } from "../src/engine/completion/records.ts";
import type { ExceptionRecord } from "../src/engine/completion/exception.ts";
import { emergencyId } from "../src/engine/emergency/plan.ts";
import { carriedEfforts } from "../src/engine/emergency/carried_work.ts";
import { writeParkedTaskMetadata } from "../src/engine/worktree/parked_task_metadata.ts";
import {
  PARKED_TASK_METADATA_SCHEMA_VERSION,
  TASK_METADATA_SCHEMA_VERSION,
} from "../src/shared/task_metadata.ts";
import {
  canonicalExceptionNote,
  recordExceptionNote,
} from "../src/engine/emergency/note.ts";
import {
  addWorktree,
  git,
  gitInit,
  gitOut,
  runAgent,
  scaffoldEngine,
  worktreePath,
  writeConfig,
  writeExecutable,
} from "./engine_helpers.ts";
import {
  assertResultDataKey,
  decodeCliResult,
  decodeWith,
} from "./decode_cli_result.ts";
import { BOUNDARY, emergencyData } from "./completion_emergency_helpers.ts";
import { assertTerminalTextIncludes, withTempDir } from "./helpers.ts";
import { z } from "@zod/zod";

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

/** A committed project whose one check fails while `taboo.txt` exists. */
async function checkedProject(dir: string): Promise<void> {
  await scaffoldEngine(dir);
  await writeConfig(dir, CONFIG_CHECK);
  await writeExecutable(join(dir, "check.sh"), CHECK_NO_TABOO);
  await gitInit(dir);
}

/** A repair worktree whose committed fix trips the gate deliberately. */
async function failingRepair(dir: string): Promise<string> {
  await checkedProject(dir);
  const wt = await addWorktree(dir, "repair");
  await Deno.writeTextFile(join(wt, "hotfix.txt"), "restore service\n");
  await Deno.writeTextFile(join(wt, "taboo.txt"), "known breakage\n");
  await git(wt, "add", "-A");
  await git(wt, "commit", "-q", "-m", "fix: emergency repair", "--no-gpg-sign");
  const failed = await runAgent(wt, ["done", "--json"]);
  assertEquals(failed.code, 1, failed.output);
  return wt;
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
      "--approval-token",
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
    assertTerminalTextIncludes(
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
      "--approval-token",
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
      "--approval-token",
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

/** Commit one new file in a checkout and return the resulting head. */
async function commitFile(checkout: string, file: string): Promise<string> {
  await Deno.writeTextFile(join(checkout, file), `${file}\n`);
  await git(checkout, "add", "-A");
  await git(checkout, "commit", "-q", "-m", `add ${file}`, "--no-gpg-sign");
  return await gitOut(checkout, "rev-parse", "HEAD");
}

/** Start a task from the main checkout and return its checkout path. */
async function startTask(
  dir: string,
  name: string,
  from: string,
): Promise<string> {
  const started = await runAgent(dir, [
    "start",
    "--from",
    from,
    "--name",
    name,
    "--json",
  ]);
  assertEquals(started.code, 0, started.output);
  const result = decodeCliResult(started.stdout, "start");
  assertResultDataKey(result, "path");
  return result.data.path;
}

/** Request an emergency plan from the repair; neither a preview nor a refusal
 * exits zero. Returns the JSON result. */
async function requestEmergency(repair: string): Promise<string> {
  const run = await runAgent(repair, [
    "accept",
    "emergency",
    "--reason",
    "Restore service",
    "--json",
  ]);
  assertEquals(run.code, 1, run.output);
  return run.stdout;
}

/** The exception records in the common store. */
async function exceptionRecords(dir: string): Promise<readonly unknown[]> {
  return (await observeCompletionRecords(dir, SYSTEM_CLOCK, ["exception"]))
    .records;
}

/** How the other effort `feature` records the commit a repair comes to hold:
 * `before` runs once that commit exists, `after` once the repair holds it. */
const OTHER_EFFORT_RECORDS: Readonly<
  Record<string, {
    readonly before?: (dir: string, checkout: string) => Promise<void>;
    readonly after?: (checkout: string) => Promise<void>;
  }>
> = {
  "live worktree": {},
  "submitted revision": {
    before: async (_dir, checkout) => {
      await recordSubmission(checkout, {
        id: crypto.randomUUID(),
        effort_id: "feature",
        branch: "agent/feature",
        head: await gitOut(checkout, "rev-parse", "HEAD"),
        tree: await gitOut(checkout, "rev-parse", "HEAD^{tree}"),
        proof: {
          candidate_id: crypto.randomUUID(),
          proof_id: crypto.randomUUID(),
        },
        submitted_at: wallTimeIso(SYSTEM_CLOCK.wallNow()),
      });
    },
    // The branch moves on, so only the submission names the carried commit.
    after: async (checkout) => {
      await commitFile(checkout, "later.txt");
    },
  },
  "parked branch": {
    before: async (dir, checkout) => {
      const marker = await readySentinelPath(checkout);
      assert(marker !== undefined);
      await Deno.mkdir(dirname(marker), { recursive: true });
      await Deno.writeTextFile(marker, "");
      const parked = await runAgent(dir, ["worktree", "park", "feature"]);
      assertEquals(parked.code, 0, parked.output);
    },
  },
};

/** How a repair comes to hold `feature`'s commit; returns the repair checkout. */
const CARRYING_ROUTES: Readonly<
  Record<string, (dir: string) => Promise<string>>
> = {
  "start --from": async (dir) => {
    const repair = await startTask(dir, "repair", "agent/feature");
    await commitFile(repair, "hotfix.txt");
    return repair;
  },
  "update --from": async (dir) => {
    const repair = await addWorktree(dir, "repair");
    await commitFile(repair, "hotfix.txt");
    const updated = await runAgent(repair, [
      "update",
      "--from",
      "agent/feature",
      "--json",
    ]);
    assertEquals(updated.code, 0, updated.output);
    // Keep the agent files the update refreshed, so the repair is clean.
    await git(repair, "add", "-A");
    await git(
      repair,
      "commit",
      "-q",
      "--allow-empty",
      "-m",
      "keep refreshed agent files",
      "--no-gpg-sign",
    );
    return repair;
  },
};

for (const [route, carry] of Object.entries(CARRYING_ROUTES)) {
  for (const [kind, recorded] of Object.entries(OTHER_EFFORT_RECORDS)) {
    Deno.test(`emergency refuses a source containing another recorded unlanded effort: ${route} a ${kind}`, async () => {
      await withTempDir(async (dir) => {
        await checkedProject(dir);
        const trunkBefore = await gitOut(dir, "rev-parse", "main");
        const other = await addWorktree(dir, "feature");
        const carried = await commitFile(other, "feature.txt");
        await recorded.before?.(dir, other);
        const repair = await carry(dir);
        await recorded.after?.(other);

        const refusal = decodeCliResult(
          await requestEmergency(repair),
          "accept",
        );
        assertEquals(refusal.error, "precondition_failed", refusal.message);
        assertStringIncludes(
          refusal.message ?? "",
          `The repair contains unlanded work from another effort: \`feature\` on branch \`agent/feature\` at \`${
            carried.slice(0, 12)
          }\`.`,
        );
        assertEquals(await gitOut(dir, "rev-parse", "main"), trunkBefore);
        assertEquals(await exceptionRecords(dir), []);
      });
    });
  }
}

Deno.test("emergency serves the plan when a sibling builds on the repair and unrelated work waits unlanded", async () => {
  await withTempDir(async (dir) => {
    await checkedProject(dir);
    const trunkBefore = await gitOut(dir, "rev-parse", "main");
    const repair = await addWorktree(dir, "repair");
    await commitFile(repair, "hotfix.txt");
    // Unrelated unlanded work the repair does not contain.
    await commitFile(await addWorktree(dir, "unrelated"), "unrelated.txt");
    // A sibling started from the repair holds the repair's commits beneath
    // its own; the repair carries none of the sibling's work.
    await commitFile(
      await startTask(dir, "follow-up", "agent/repair"),
      "follow-up.txt",
    );

    const preview = await requestEmergency(repair);
    assertEquals(
      decodeCliResult(preview, "accept").error,
      "awaiting_consent",
      preview,
    );
    assertEquals(emergencyData(preview).outcome, "preview");
    assertEquals(await gitOut(dir, "rev-parse", "main"), trunkBefore);
    assertEquals(await exceptionRecords(dir), []);
  });
});

/** Each record source alone: the repair `agent/repair` holds the commit
 * `carried`; `arrange` records it through one more source and returns the
 * branch the plan names as effort `feature`, or undefined for none. */
const CARRIED_RECORD_SOURCES: Readonly<
  Record<string, (dir: string, carried: string) => Promise<string | undefined>>
> = {
  "the repair's own checkout alone": () => Promise.resolve(undefined),
  "a registered checkout outside the task prefix": async (dir, carried) => {
    const path = worktreePath(dir, "feature");
    await git(dir, "worktree", "add", "-q", "-b", "feature", path, carried);
    return "feature";
  },
  "a submission whose branch moved on": async (dir, carried) => {
    const later = await gitOut(
      dir,
      "commit-tree",
      `${carried}^{tree}`,
      "-p",
      carried,
      "-m",
      "later",
    );
    const path = worktreePath(dir, "feature");
    await git(dir, "worktree", "add", "-q", "-b", "agent/feature", path, later);
    await recordSubmission(path, {
      id: crypto.randomUUID(),
      effort_id: "feature",
      branch: "agent/feature",
      head: carried,
      tree: await gitOut(dir, "rev-parse", `${carried}^{tree}`),
      proof: {
        candidate_id: crypto.randomUUID(),
        proof_id: crypto.randomUUID(),
      },
      submitted_at: wallTimeIso(SYSTEM_CLOCK.wallNow()),
    });
    return "agent/feature";
  },
  "a parked head whose branch is gone": async (dir, carried) => {
    await writeParkedTaskMetadata(dir, {
      schema_version: PARKED_TASK_METADATA_SCHEMA_VERSION,
      id: "feature",
      branch: "feature",
      head: carried,
      parked_at: wallTimeIso(SYSTEM_CLOCK.wallNow()),
      task: { schema_version: TASK_METADATA_SCHEMA_VERSION, title: "Feature" },
    });
    return "feature";
  },
  "a task branch without a checkout": async (dir, carried) => {
    await git(dir, "branch", "agent/feature", carried);
    return "agent/feature";
  },
  "a disposable integration copy": async (dir, carried) => {
    const path = worktreePath(dir, "integration");
    await git(
      dir,
      "worktree",
      "add",
      "-q",
      "-b",
      "integration/feature",
      path,
      carried,
    );
    return undefined;
  },
};

for (const [source, arrange] of Object.entries(CARRIED_RECORD_SOURCES)) {
  Deno.test(`the emergency plan attributes a carried commit recorded by ${source}`, async () => {
    await withTempDir(async (dir) => {
      await Deno.writeTextFile(join(dir, "seed.txt"), "seed\n");
      await gitInit(dir);
      const carried = await gitOut(
        dir,
        "commit-tree",
        "HEAD^{tree}",
        "-p",
        "HEAD",
        "-m",
        "feature work",
      );
      const repair = worktreePath(dir, "repair");
      await git(
        dir,
        "worktree",
        "add",
        "-q",
        "-b",
        "agent/repair",
        repair,
        carried,
      );
      const branch = await arrange(dir, carried);
      assertEquals(
        await carriedEfforts(dir, "agent/repair", "agent/", [
          { commit: carried, subject: "feature work" },
        ]),
        branch === undefined
          ? []
          : [{ effort: "feature", branch, revision: carried }],
      );
    });
  });
}

/**
 * The exception record the exchange writes before its transition, rebuilt from
 * a served preview — the durable shape an interruption between record
 * publication and the trunk transition leaves behind for --recover.
 */
function plannedExceptionRecord(
  preview: ReturnType<typeof emergencyData>,
  id: string,
  reason: string,
): CompletionRecord {
  const candidate = preview.candidate;
  const exceptions = preview.exceptions;
  assert(candidate !== undefined && exceptions !== undefined);
  const now = SYSTEM_CLOCK.wallNow();
  return {
    version: ON_DISK_FORMATS.completionRecord.version,
    kind: "exception",
    id,
    revision: 1,
    data: {
      claim: {
        kind: "exception",
        authorization_id: id,
        authorized_at: now,
        actual_trunk: candidate.predecessor,
        source: candidateAuthor(candidate),
        candidate_id: preview.candidate_id ?? candidate.attempt_id,
        candidate_head: candidate.head,
        policy: candidate.policy,
        reason,
        exceptions,
      },
      executor: {
        operation_id: crypto.randomUUID(),
        originating_effort: candidateAuthor(candidate).effort_id,
        started_at: now,
      },
      expected_trunk: candidate.predecessor,
      target: candidate.head,
      outcome: { kind: "planned" },
      note: "pending",
    },
  };
}

Deno.test("a recorded authorization refuses confirmation replay, and recovery settles a never-advanced transition as not landed", async () => {
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
    const served = emergencyData(preview.stdout);
    const token = served.confirmation;
    assert(token !== undefined);

    // A dry-run preview serves the same plan shape and consumes nothing.
    const dry = await runAgent(wt, [
      "accept",
      "emergency",
      "--reason",
      reason,
      "--dry-run",
      "--json",
    ]);
    assertEquals(dry.code, 0, dry.output);
    const dryEnvelope = decodeCliResult(dry.stdout, "accept");
    assertEquals(dryEnvelope.dry_run, true);
    assertEquals(emergencyData(dry.stdout).outcome, "preview");
    assertStringIncludes(dryEnvelope.message ?? "", BOUNDARY);
    assertEquals(await gitOut(dir, "rev-parse", "main"), trunkBefore);

    // The crash shape: the authorization record exists, planned, and the
    // transition never ran. Replaying the owner's confirmation refuses.
    const id = emergencyId(await sha256Hex(token));
    const written = await writeCompletionRecord(
      dir,
      plannedExceptionRecord(served, id, reason),
      null,
    );
    assertEquals(written.kind, "written", JSON.stringify(written));
    const replay = await runAgent(wt, [
      "accept",
      "emergency",
      "--reason",
      reason,
      "--confirmed",
      "--approval-token",
      token,
      "--json",
    ]);
    assertEquals(replay.code, 1, replay.output);
    const replayEnvelope = decodeCliResult(replay.stdout, "accept");
    assertEquals(replayEnvelope.error, "precondition_failed");
    assertStringIncludes(
      replayEnvelope.message ?? "",
      `This emergency authorization already has a record. Use discern accept emergency --recover ${id}; do not replay confirmation.`,
    );
    assert(
      (replayEnvelope.hints ?? []).some((hint) =>
        hint.includes(
          "Resolve the reported precondition, then prepare a new emergency plan.",
        )
      ),
      replay.output,
    );
    assertEquals(await gitOut(dir, "rev-parse", "main"), trunkBefore);

    // Recovery settles the recorded transition: the trunk never advanced.
    const recovered = await runAgent(dir, [
      "accept",
      "emergency",
      "--recover",
      id,
      "--json",
    ]);
    assertEquals(recovered.code, 1, recovered.output);
    const recoveredEnvelope = decodeCliResult(recovered.stdout, "accept");
    assertEquals(recoveredEnvelope.error, "precondition_failed");
    assertStringIncludes(
      recoveredEnvelope.message ?? "",
      "did not land; the emergency was not applied and no Proof was issued.",
    );
    assertStringIncludes(
      recoveredEnvelope.message ?? "",
      "The unlanded outcome is settled. Return to the repair worktree and prepare a new emergency plan for fresh owner review.",
    );
    assertEquals(emergencyData(recovered.stdout).outcome, "not-landed");
    assert(
      (recoveredEnvelope.hints ?? []).some((hint) =>
        hint.includes(
          "No integration occurred. Return to the repair worktree and prepare a new emergency plan for fresh owner review.",
        )
      ),
      recovered.output,
    );
    const settled = await readCompletionRecord(dir, {
      kind: "exception",
      id,
    });
    assert(settled.kind === "recorded" && settled.record.kind === "exception");
    assert(settled.record.data.outcome.kind === "not-landed");
    assertEquals(
      settled.record.data.outcome.reason,
      "the recorded transition never advanced the trunk",
    );
    assertEquals(await gitOut(dir, "rev-parse", "main"), trunkBefore);
    assert(await targetExists(wt), "a not-landed recovery keeps the repair");

    // The settled outcome reads the same on a repeated recovery.
    const again = await runAgent(dir, [
      "accept",
      "emergency",
      "--recover",
      id,
      "--json",
    ]);
    assertEquals(again.code, 1, again.output);
    assertEquals(emergencyData(again.stdout).outcome, "not-landed");

    // An unknown landing id names no record.
    const unknown = await runAgent(dir, [
      "accept",
      "emergency",
      "--recover",
      crypto.randomUUID(),
      "--json",
    ]);
    assertEquals(unknown.code, 1, unknown.output);
    assertTerminalTextIncludes(
      decodeCliResult(unknown.stdout, "accept").message ?? "",
      "No readable emergency landing exists at that id. Preserve the records and inspect status.",
    );
  });
});

Deno.test("recovery completes an advanced-but-unsettled transition: note collision reported, then published, checkout kept then removed", async () => {
  await withTempDir(async (dir) => {
    const wt = await failingRepair(dir);
    const repairHead = await gitOut(wt, "rev-parse", "HEAD");
    const reason = "Restore the broken deploy path";
    const preview = await runAgent(wt, [
      "accept",
      "emergency",
      "--reason",
      reason,
      "--json",
    ]);
    assertEquals(preview.code, 1, preview.output);
    const id = crypto.randomUUID();
    const written = await writeCompletionRecord(
      dir,
      plannedExceptionRecord(emergencyData(preview.stdout), id, reason),
      null,
    );
    assertEquals(written.kind, "written", JSON.stringify(written));

    // The crash happened after the trunk advanced: reproduce that exact state
    // by hand, with a foreign note already on the landed commit and work
    // still sitting uncommitted in the repair's checkout.
    await git(dir, "merge", "--ff-only", repairHead);
    await git(
      dir,
      "notes",
      "--ref=discern",
      "add",
      "-m",
      "prior claim",
      repairHead,
    );
    await Deno.writeTextFile(join(wt, "follow-up.txt"), "unfinished\n");

    const first = await runAgent(dir, [
      "accept",
      "emergency",
      "--recover",
      id,
      "--json",
    ]);
    assertEquals(first.code, 1, first.output);
    const firstEnvelope = decodeCliResult(first.stdout, "accept");
    assertEquals(firstEnvelope.error, "partial_acceptance");
    const firstEmergency = emergencyData(first.stdout);
    assertEquals(firstEmergency.outcome, "landed");
    assertEquals(firstEmergency.note, "failed");
    assertEquals(firstEmergency.cleanup, "kept");
    assertStringIncludes(
      firstEnvelope.message ?? "",
      `The exception note was not recorded. Run discern accept emergency --recover ${id} after repairing Git notes access.`,
    );
    // The foreign claim survives untouched.
    assertEquals(
      await gitOut(dir, "notes", "--ref=discern", "show", repairHead),
      "prior claim",
    );
    assert(
      (firstEnvelope.hints ?? []).some((hint) =>
        hint.includes(
          `Run discern accept emergency --recover ${id} to inspect and reconcile this recorded transition.`,
        )
      ),
      first.output,
    );

    // With the collision cleared and the checkout clean, the same recovery
    // publishes the note and finishes cleanup.
    await git(dir, "notes", "--ref=discern", "remove", repairHead);
    await Deno.remove(join(wt, "follow-up.txt"));
    const second = await runAgent(dir, [
      "accept",
      "emergency",
      "--recover",
      id,
      "--json",
    ]);
    assertEquals(second.code, 0, second.output);
    const secondEmergency = emergencyData(second.stdout);
    assertEquals(secondEmergency.note, "published");
    assertEquals(secondEmergency.cleanup, "removed");
    assertTerminalTextIncludes(
      decodeCliResult(second.stdout, "accept").message ?? "",
      "Run discern done --rerun on the current committed trunk or a repair containing it to resolve outstanding validation.",
    );
    assertEquals(await targetExists(wt), false, second.output);
    const payload = decodeWith(
      EmergencyNotePayloadSchema,
      new TextDecoder().decode(
        decodeBase64(
          decodeWith(
            DSSE_ENVELOPE_SCHEMA,
            await gitOut(dir, "notes", "--ref=discern", "show", repairHead),
          ).payload,
        ),
      ),
    );
    assertEquals(payload.landing_id, id);
    const settled = await readCompletionRecord(dir, {
      kind: "exception",
      id,
    });
    assert(settled.kind === "recorded" && settled.record.kind === "exception");
    assertEquals(settled.record.data.outcome.kind, "landed");
    assertEquals(settled.record.data.note, "published");
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
    assertTerminalTextIncludes(
      decodeCliResult(mixed.stdout, "accept").message ?? "",
      "Emergency preparation cannot be combined with a receipt, confirmation, or transition recovery.",
    );
  });
});

/** A schema-valid landed exception whose note targets `head`. */
function landedException(head: string): ExceptionRecord {
  const now = SYSTEM_CLOCK.wallNow();
  const trunk = "a".repeat(40);
  return {
    claim: {
      kind: "exception",
      authorization_id: crypto.randomUUID(),
      authorized_at: now,
      actual_trunk: trunk,
      source: {
        effort_id: "repair",
        branch: "refs/heads/agent/repair",
        head,
        tree: "b".repeat(40),
      },
      candidate_id: crypto.randomUUID(),
      candidate_head: head,
      policy: "c".repeat(64),
      reason: "Restore service",
      exceptions: [{
        requirement: { id: "lint", kind: "job", definition: "d".repeat(64) },
        state: "failed",
        evidence_id: null,
      }],
    },
    executor: {
      operation_id: crypto.randomUUID(),
      originating_effort: "repair",
      started_at: now,
    },
    expected_trunk: trunk,
    target: head,
    outcome: { kind: "landed", at: now },
    note: "pending",
  };
}

Deno.test("an exception note exists only for a landed integration", () => {
  const record = landedException("e".repeat(40));
  assertThrows(
    () =>
      canonicalExceptionNote(crypto.randomUUID(), {
        ...record,
        outcome: { kind: "planned" },
      }),
    Error,
    "An exception note requires its landed integration.",
  );
});

Deno.test("exception note publication is create-only: recorded once, idempotent after, and never replaces another claim", async () => {
  await withTempDir(async (dir) => {
    await Deno.writeTextFile(join(dir, "seed.txt"), "seed\n");
    await gitInit(dir);
    const head = await gitOut(dir, "rev-parse", "HEAD");
    const record = landedException(head);
    const id = record.claim.authorization_id;

    const first = await recordExceptionNote(dir, id, record);
    assertEquals(first.status, "recorded", JSON.stringify(first));
    assertEquals(
      await gitOut(dir, "notes", "--ref=discern", "show", head),
      canonicalExceptionNote(id, record).trimEnd(),
    );

    // The same bytes already on the commit are a settled publication.
    const second = await recordExceptionNote(dir, id, record);
    assertEquals(second.status, "already_present", JSON.stringify(second));

    // A different claim on the commit is preserved, never replaced.
    await git(
      dir,
      "notes",
      "--ref=discern",
      "add",
      "-f",
      "-m",
      "prior claim",
      head,
    );
    const third = await recordExceptionNote(dir, id, record);
    assertEquals(third.status, "record_failed");
    assertEquals(
      third.reason,
      "The integrated commit already has a different note. Preserve it and the durable exception record; no existing claim was replaced.",
    );
    assertEquals(
      await gitOut(dir, "notes", "--ref=discern", "show", head),
      "prior claim",
    );

    // A target this repository cannot inspect (a SHA-256 object id against a
    // SHA-1 object store) reports the inspection failure instead of writing.
    const missing = await recordExceptionNote(
      dir,
      id,
      { ...record, target: "f".repeat(64), claim: record.claim },
    );
    assertEquals(missing.status, "record_failed");
    assert(
      missing.status === "record_failed" && missing.reason !== undefined &&
        missing.reason.length > 0 &&
        !missing.reason.startsWith("The integrated commit"),
      JSON.stringify(missing),
    );
  });
});

Deno.test("a failed note write reports the publication failure instead of claiming the note", async () => {
  await withTempDir(async (dir) => {
    await Deno.writeTextFile(join(dir, "seed.txt"), "seed\n");
    await gitInit(dir);
    const head = await gitOut(dir, "rev-parse", "HEAD");
    const record = landedException(head);
    const objects = join(dir, ".git", "objects");
    try {
      await Deno.chmod(objects, 0o555);
      const written = await recordExceptionNote(
        dir,
        record.claim.authorization_id,
        record,
      );
      assertEquals(written.status, "record_failed");
      assert(
        written.status === "record_failed" && written.reason !== undefined &&
          written.reason.length > 0,
        JSON.stringify(written),
      );
    } finally {
      await Deno.chmod(objects, 0o755);
    }
    assertEquals(
      (await gitOut(dir, "notes", "--ref=discern", "list")).trim(),
      "",
      "no note was published",
    );
  });
});
