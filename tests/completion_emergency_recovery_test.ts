/**
 * Landings whose cleanup or convergence did not finish must say so and stay
 * recoverable. The emergency exchange reports a failed main-checkout
 * convergence as its own unresolved obligation (never a generic step count),
 * and `accept emergency --recover` retries convergence — even after the
 * repair's checkout is gone — succeeding only when the commands actually
 * converge. An ordinary landing whose resource destroy failed keeps the
 * landing but states the incomplete cleanup in its first sentence, naming
 * `discern worktree prune`.
 */

import { assert, assertEquals, assertStringIncludes } from "@std/assert";
import { join } from "@std/path";
import { targetExists } from "../src/shared/fs_presence.ts";
import { writeDiscernToml } from "../src/lib/tidy_format.ts";
import { readCompletionRecord } from "../src/engine/completion/store.ts";
import {
  addWorktree,
  git,
  gitInit,
  gitOut,
  runAgent,
  scaffoldEngine,
  writeConfig,
} from "./engine_helpers.ts";
import { decodeCliResult } from "./decode_cli_result.ts";
import { BOUNDARY, emergencyData } from "./completion_emergency_helpers.ts";
import { withTempDir } from "./helpers.ts";

/** A gate whose one check always fails, so the emergency route is the only landing. */
const FAILING_GATE = [
  "[project]",
  'slug = "engine-test"',
  "",
  "[repository]",
  'trunk = "main"',
  "",
  "[jobs]",
  'lint = "false"',
  "",
].join("\n");

/** {@link FAILING_GATE} plus a repository ensure command that always fails,
 * so post-landing convergence of the main checkout cannot complete. */
const FAILING_GATE_AND_ENSURE = FAILING_GATE.replace(
  'trunk = "main"',
  ['trunk = "main"', 'ensure = ["false"]'].join("\n"),
);

/** A repair worktree with one committed fix whose gate run failed. */
async function committedRepair(dir: string, config: string): Promise<string> {
  await scaffoldEngine(dir);
  await writeConfig(dir, config);
  await gitInit(dir);
  const wt = await addWorktree(dir, "repair");
  await Deno.writeTextFile(join(wt, "hotfix.txt"), "restore service\n");
  await git(wt, "add", "-A");
  await git(wt, "commit", "-q", "-m", "fix: emergency repair", "--no-gpg-sign");
  const failed = await runAgent(wt, ["done", "--json"]);
  assertEquals(failed.code, 1, failed.output);
  return wt;
}

/** Append the suite's one external resource to a worktree's scaffolded config. */
async function declareFailingDestroyResource(wt: string): Promise<void> {
  const path = join(wt, "discern.toml");
  const cfg = await Deno.readTextFile(path);
  await writeDiscernToml(
    path,
    `${cfg}\n[worktree.resources.thing]\ncreate = "true"\ndestroy = "false"\n`,
  );
}

/** Run the owner-approved exchange: preview for the confirmation, then confirm. */
async function approvedExchange(
  wt: string,
  reason: string,
): Promise<Awaited<ReturnType<typeof runAgent>>> {
  const preview = await runAgent(wt, [
    "accept",
    "emergency",
    "--reason",
    reason,
    "--json",
  ]);
  assertEquals(preview.code, 1, preview.output);
  const token = emergencyData(preview.stdout).confirmation;
  assert(token !== undefined, preview.output);
  return await runAgent(wt, [
    "accept",
    "emergency",
    "--reason",
    reason,
    "--confirmed",
    "--confirmation",
    token,
    "--json",
  ]);
}

/** The exact unresolved-convergence sentence the emergency result must carry. */
function convergenceOwedSentence(root: string, landingId: string): string {
  return `The main checkout at ${root} did not converge on the landed tree; the failed steps are in this result. Fix their cause, then run discern accept emergency --recover ${landingId} to retry convergence.`;
}

Deno.test("a failed convergence outlives the repair checkout: the landing names it, recovery retries it, and success requires actual convergence", async () => {
  await withTempDir(async (dir) => {
    const wt = await committedRepair(dir, FAILING_GATE_AND_ENSURE);
    const root = await Deno.realPath(dir);
    const repairHead = await gitOut(wt, "rev-parse", "HEAD");

    // The approved exchange lands the repair, but the failing ensure command
    // leaves the main checkout unconverged. The result says exactly that —
    // not a generic failed-step count — and routes to --recover.
    const landed = await approvedExchange(wt, "Restore service");
    assertEquals(landed.code, 1, landed.output);
    const landedEnvelope = decodeCliResult(landed.stdout, "accept");
    assertEquals(landedEnvelope.error, "partial_acceptance", landed.output);
    const landedEmergency = emergencyData(landed.stdout);
    const landingId = landedEmergency.landing_id;
    assert(landingId !== undefined, landed.output);
    assertEquals(landedEmergency.outcome, "landed");
    assertEquals(landedEmergency.note, "published");
    assertEquals(landedEmergency.cleanup, "removed");
    assertStringIncludes(
      landedEnvelope.message ?? "",
      "`agent/repair` landed on main as an emergency, with no passing Proof.",
    );
    assertStringIncludes(landedEnvelope.message ?? "", BOUNDARY);
    assertStringIncludes(
      landedEnvelope.message ?? "",
      convergenceOwedSentence(root, landingId),
    );
    assert(
      !(landedEnvelope.message ?? "").includes(
        "required step(s) failed or were cancelled.",
      ),
      `the convergence obligation was normalized away:\n${landed.output}`,
    );
    const landedEnsure = landedEnvelope.steps?.find((step) =>
      step.kind === "repository-ensure"
    );
    assertEquals(landedEnsure?.outcome, "failed", landed.output);
    assert(
      (landedEnvelope.hints ?? []).some((hint) =>
        hint.includes(
          `Run discern accept emergency --recover ${landingId} to inspect and reconcile this recorded transition.`,
        )
      ),
      landed.output,
    );
    // The landing itself stands: the trunk advanced and the repair is gone.
    assertEquals(await gitOut(dir, "rev-parse", "main"), repairHead);
    assertEquals(await targetExists(wt), false, landed.output);

    // Recovery with the checkout gone still retries convergence, reports the
    // retried steps, and refuses to call the obligation resolved while the
    // ensure command fails.
    const broken = await runAgent(dir, [
      "accept",
      "emergency",
      "--recover",
      landingId,
      "--json",
    ]);
    assertEquals(broken.code, 1, broken.output);
    const brokenEnvelope = decodeCliResult(broken.stdout, "accept");
    assertEquals(brokenEnvelope.error, "partial_acceptance", broken.output);
    assertStringIncludes(
      brokenEnvelope.message ?? "",
      convergenceOwedSentence(root, landingId),
    );
    const retriedEnsure = brokenEnvelope.steps?.find((step) =>
      step.kind === "repository-ensure"
    );
    assertEquals(retriedEnsure?.outcome, "failed", broken.output);
    assertEquals(await gitOut(dir, "rev-parse", "main"), repairHead);

    // Fix the ensure command in the landed tree and commit the fix; the same
    // recovery now converges the main checkout and settles.
    const configPath = join(dir, "discern.toml");
    await Deno.writeTextFile(
      configPath,
      (await Deno.readTextFile(configPath)).replace(
        'ensure = ["false"]',
        'ensure = ["true"]',
      ),
    );
    await git(dir, "add", "-A");
    await git(dir, "commit", "-q", "-m", "Fix ensure", "--no-gpg-sign");
    const recovered = await runAgent(dir, [
      "accept",
      "emergency",
      "--recover",
      landingId,
      "--json",
    ]);
    assertEquals(recovered.code, 0, recovered.output);
    const recoveredEnvelope = decodeCliResult(recovered.stdout, "accept");
    assertEquals(recoveredEnvelope.ok, true, recovered.output);
    assertStringIncludes(
      recoveredEnvelope.message ?? "",
      "Run discern done --rerun on the current committed trunk or a repair containing it to resolve outstanding validation.",
    );
    const convergedEnsure = recoveredEnvelope.steps?.find((step) =>
      step.kind === "repository-ensure"
    );
    assertEquals(convergedEnsure?.outcome, "ok", recovered.output);
    const recoveredEmergency = emergencyData(recovered.stdout);
    assertEquals(recoveredEmergency.outcome, "landed");
    assertEquals(recoveredEmergency.note, "published");
    assertEquals(recoveredEmergency.cleanup, "removed");

    // The durable exception record stayed settled throughout.
    const record = await readCompletionRecord(dir, {
      kind: "exception",
      id: landingId,
    });
    assert(record.kind === "recorded" && record.record.kind === "exception");
    assertEquals(record.record.data.outcome.kind, "landed");
    assertEquals(record.record.data.note, "published");
  });
});

Deno.test("an ordinary landing with a failed resource destroy states the incomplete cleanup and names worktree prune in its first sentence", async () => {
  await withTempDir(async (dir) => {
    await scaffoldEngine(dir);
    await gitInit(dir);
    const wt = await addWorktree(dir, "cleanup-headline");
    await declareFailingDestroyResource(wt);
    assertEquals((await runAgent(wt, ["worktree", "setup"])).code, 0);
    await git(wt, "add", "-A");
    await git(wt, "commit", "-q", "-m", "declare resource", "--no-gpg-sign");
    const completion = await runAgent(wt, ["done", "--json"]);
    assertEquals(completion.code, 0, completion.output);
    const head = await gitOut(wt, "rev-parse", "HEAD");
    const root = await Deno.realPath(dir);

    const accepted = await runAgent(wt, ["accept", "--confirmed", "--json"]);
    assertEquals(accepted.code, 0, accepted.output);
    const envelope = decodeCliResult(accepted.stdout, "accept");
    assertEquals(envelope.ok, true, accepted.output);
    const message = envelope.message ?? "";
    // The whole first paragraph, verbatim: the landing stands, and the
    // headline states the incomplete cleanup instead of claiming the
    // resources are gone.
    assertStringIncludes(
      message,
      `Landed agent/cleanup-headline at ${
        head.slice(0, 12)
      } on main, but resource teardown failed for thing: run discern worktree prune from ${root} after fixing the failed destroy command. Its checkout and branch are gone, and you are on main in ${root}.`,
    );
    const firstSentence = message.slice(0, message.indexOf(". ") + 1);
    assertStringIncludes(firstSentence, "run discern worktree prune from");
    assert(
      !message.includes("its checkout, branch, and resources are gone"),
      `the headline still claims complete cleanup:\n${accepted.output}`,
    );
    // The detailed retained-failure advisory stays alongside the headline.
    const teardown = envelope.steps?.find((step) =>
      step.kind === "resource-destroy"
    );
    assertEquals(teardown?.outcome, "failed", accepted.output);
    assertEquals(teardown?.advisory?.kind, "acceptance-cleanup-incomplete");
    assertEquals(await gitOut(dir, "rev-parse", "main"), head);
    assertEquals(await targetExists(wt), false, accepted.output);
    assert(envelope.data !== undefined && "landing" in envelope.data);
    assertEquals(envelope.data.landing, {
      recovery_performed: false,
      trunk_landed: true,
      worktree_removed: true,
      branch_deleted: true,
    });
  });
});

Deno.test("an emergency landing with a failed resource destroy reports incomplete cleanup and names worktree prune", async () => {
  await withTempDir(async (dir) => {
    await scaffoldEngine(dir);
    await writeConfig(dir, FAILING_GATE);
    await gitInit(dir);
    const wt = await addWorktree(dir, "repair");
    await declareFailingDestroyResource(wt);
    assertEquals((await runAgent(wt, ["worktree", "setup"])).code, 0);
    await git(wt, "add", "-A");
    await git(
      wt,
      "commit",
      "-q",
      "-m",
      "fix: emergency repair",
      "--no-gpg-sign",
    );
    const failed = await runAgent(wt, ["done", "--json"]);
    assertEquals(failed.code, 1, failed.output);
    const repairHead = await gitOut(wt, "rev-parse", "HEAD");
    const root = await Deno.realPath(dir);

    const landed = await approvedExchange(wt, "Restore service");
    assertEquals(landed.code, 1, landed.output);
    const envelope = decodeCliResult(landed.stdout, "accept");
    assertEquals(envelope.error, "partial_acceptance", landed.output);
    const emergency = emergencyData(landed.stdout);
    assertEquals(emergency.outcome, "landed");
    assertEquals(emergency.note, "published");
    assertEquals(emergency.cleanup, "failed");
    assertStringIncludes(
      envelope.message ?? "",
      "`agent/repair` landed on main as an emergency, with no passing Proof.",
    );
    assertStringIncludes(
      envelope.message ?? "",
      `The repair's checkout and branch are gone, but resource teardown failed for thing. Run discern worktree prune from ${root}.`,
    );
    const teardown = envelope.steps?.find((step) =>
      step.kind === "resource-destroy"
    );
    assertEquals(teardown?.outcome, "failed", landed.output);
    assertEquals(teardown?.advisory?.kind, "acceptance-cleanup-incomplete");
    // The landing stands; only the external resource outlived the repair.
    assertEquals(await gitOut(dir, "rev-parse", "main"), repairHead);
    assertEquals(await targetExists(wt), false, landed.output);
  });
});
