/**
 * Landing supersession and the exact-submission rule, end to end.
 *
 * The completion store's newest strict verdict is the one authority every
 * landing surface reads: a genuinely failed rerun supersedes the earlier
 * green Proof for the honored-marker inspection, the landing queue, and an
 * owner's `accept --target` — without revoking the effort's recorded
 * permission — and a deliberate green rerun restores landability. A
 * submission is exact: recorded grants (effort and standing alike) cover
 * only the submitted revision, so a later green HEAD the agent never
 * submitted lands only by the owner's `--target --confirmed`. Green Proof
 * reuse requires the trunk's exact tip as the Proof's recorded predecessor,
 * so a supported trunk fast-forward makes `done` re-prove and acceptance
 * proceed. Refusal sentences are asserted verbatim from accept.ts and
 * submissions_view.ts.
 *
 * Guards: boundary:landing-authority, boundary:local-git-landing
 */

import { assert, assertEquals, assertStringIncludes } from "@std/assert";
import { join } from "@std/path";
import { inspectGateProof } from "../src/engine/gate/proof.ts";
import { readEffortGrant } from "../src/engine/worktree/effort_grant.ts";
import { grantEffort } from "../src/engine/worktree/effort_grant_writer.ts";
import { readSubmission } from "../src/engine/worktree/submission.ts";
import { submissionRows } from "../src/engine/worktree/submissions_view.ts";
import {
  addWorktree,
  git,
  gitInit,
  gitOut,
  runAgent,
  scaffoldEngine,
  writeConfig,
} from "./engine_helpers.ts";
import {
  assertResultDataKey,
  type CliResultForCommand,
  decodeCliResult,
} from "./decode_cli_result.ts";
import type { GateWireData } from "../src/shared/result_schemas.ts";
import { assertTerminalTextIncludes, withTempDir } from "./helpers.ts";

const SHORT = 12;

/** Render the shared minimal config, with an optional custom lint command. */
function config(lint = ":"): string {
  return [
    "[meta]",
    "bootstrapped = true",
    "",
    "[project]",
    'slug = "supersession-test"',
    "",
    "[repository]",
    'trunk = "main"',
    "",
    "[jobs]",
    `lint = ${JSON.stringify(lint)}`,
    "",
  ].join("\n");
}

/** The standing-grant config: docs are a pre-authorized neutral scope. */
const STANDING_CONFIG = [
  "[meta]",
  "bootstrapped = true",
  "",
  "[project]",
  'slug = "supersession-test"',
  "",
  "[repository]",
  'trunk = "main"',
  "",
  "[jobs]",
  'lint = ":"',
  "",
  "[scopes.map]",
  'paths = ["docs/**"]',
  "neutral = true",
  "",
  "[scopes.engine]",
  'paths = ["src/**"]',
  "",
  "[acceptance]",
  'pre_authorized = ["map"]',
  "",
].join("\n");

/** Decode one done envelope, requiring its gate payload. */
function parseGateJson(
  stdout: string,
): CliResultForCommand<"done"> & { data: GateWireData } {
  const result = decodeCliResult(stdout, "done");
  assertResultDataKey(result, "failed_stage");
  return result;
}

/** Commit one file on the worktree's branch. */
async function commitFile(
  wt: string,
  file: string,
  contents: string,
  message: string,
): Promise<void> {
  await Deno.mkdir(join(wt, ...file.split("/").slice(0, -1)), {
    recursive: true,
  });
  await Deno.writeTextFile(join(wt, file), contents);
  await git(wt, "add", "-A");
  await git(wt, "commit", "-q", "-m", message, "--no-gpg-sign");
}

Deno.test("a genuinely failed rerun supersedes the green Proof for landing, keeps the permission, and a deliberate green rerun restores landability", async () => {
  await withTempDir(async (dir) => {
    await withTempDir(async (aux) => {
      const marker = join(aux, "fail");
      await scaffoldEngine(dir);
      await writeConfig(dir, config(`test ! -f ${marker}`));
      await gitInit(dir);
      const wt = await addWorktree(dir, "supersede");
      await commitFile(wt, "a.txt", "submitted A\n", "A");
      assertEquals((await runAgent(wt, ["done", "--json"])).code, 0);
      const a = await gitOut(wt, "rev-parse", "HEAD");
      const branch = await gitOut(wt, "branch", "--show-current");
      const trunkBefore = await gitOut(dir, "rev-parse", "main");

      // The unauthorized accept records the submission read-only, and the
      // owner then pre-authorizes the effort at the desk.
      assertEquals((await runAgent(wt, ["accept", "--json"])).code, 1);
      assertEquals((await readSubmission(wt)).status, "submitted");
      await grantEffort(wt, branch, "2026-09-12T12:00:00.000Z");

      // The rerun genuinely fails: an external dependency of the lint
      // command broke while the tree stayed exactly the proven commit.
      await Deno.writeTextFile(marker, "fail now\n");
      const red = await runAgent(wt, ["done", "--rerun", "--json"]);
      assertEquals(red.code, 1, red.output);
      assertEquals(parseGateJson(red.stdout).data.failed_stage, "check");

      // The earlier green is superseded for every landing surface: the
      // marker inspection, the queue row, and the owner's --target refusal
      // all read the store's newest strict verdict.
      const inspected = await inspectGateProof(wt);
      assertEquals(inspected.status, "stale");
      assertStringIncludes(
        inspected.reason ?? "",
        "a newer strict gate run judged this revision red",
      );
      const root = await Deno.realPath(dir);
      const waiting = await submissionRows(root, "main");
      assertEquals(waiting.length, 1);
      assertEquals(waiting[0]?.readiness, "waiting");
      assertEquals(
        waiting[0]?.reason,
        "A newer strict gate run judged its submitted revision red; " +
          "resolve the failure and run discern done --rerun from its " +
          "worktree, then discern accept.",
      );
      // Readiness loss never silently revokes the recorded permission.
      assertEquals(waiting[0]?.authority, "pre-authorized");
      assertEquals(waiting[0]?.authority_source, "effort-grant");
      assertEquals((await readEffortGrant(wt)).status, "granted");

      const refused = await runAgent(dir, [
        "accept",
        "--target",
        branch,
        "--json",
      ]);
      assertEquals(refused.code, 1, refused.output);
      const refusal = decodeCliResult(refused.stdout, "accept");
      assertEquals(refusal.error, "precondition_failed");
      assertStringIncludes(
        refusal.message ?? "",
        `${branch} submitted ${a.slice(0, SHORT)}, but a newer strict gate ` +
          `run judged that revision red, so its earlier Proof is not ` +
          `landable. Resolve the failure and run discern done --rerun from ${await Deno
            .realPath(wt)}, then discern accept.`,
      );
      assertEquals(await gitOut(dir, "rev-parse", "main"), trunkBefore);

      // The sticky-red veto still routes a bare done to --rerun: the veto
      // and the landing supersession read the same durable records.
      const bare = await runAgent(wt, ["done", "--json"]);
      assertEquals(bare.code, 1, bare.output);
      assertTerminalTextIncludes(
        bare.output,
        "the gate already judged this exact candidate red",
      );

      // A deliberate green rerun restores landability under the SAME grant:
      // permission was preserved throughout, only readiness moved.
      await Deno.remove(marker);
      const green = await runAgent(wt, ["done", "--rerun", "--json"]);
      assertEquals(green.code, 0, green.output);
      assertEquals((await inspectGateProof(wt)).status, "honored");
      const ready = await submissionRows(root, "main");
      assertEquals(ready[0]?.readiness, "ready");
      assertEquals(ready[0]?.authority, "pre-authorized");

      const landed = await runAgent(dir, [
        "accept",
        "--target",
        branch,
        "--json",
      ]);
      assertEquals(landed.code, 0, landed.output);
      const result = decodeCliResult(landed.stdout, "accept");
      assert(result.data !== undefined && !("issues" in result.data));
      assertEquals(result.data.consent, { source: "effort-grant" });
      assertEquals(await gitOut(dir, "rev-parse", "main"), a);
    });
  });
});

Deno.test("an effort grant covers only the recorded submission: an unsubmitted later green lands only with --target --confirmed", async () => {
  await withTempDir(async (dir) => {
    await scaffoldEngine(dir);
    await writeConfig(dir, config());
    await gitInit(dir);
    const wt = await addWorktree(dir, "exact");
    await commitFile(wt, "a.txt", "submitted A\n", "A");
    assertEquals((await runAgent(wt, ["done", "--json"])).code, 0);
    assertEquals((await runAgent(wt, ["accept", "--json"])).code, 1);
    const a = await gitOut(wt, "rev-parse", "HEAD");
    const branch = await gitOut(wt, "branch", "--show-current");
    await grantEffort(wt, branch, "2026-09-12T12:00:00.000Z");

    // A later green revision exists that the agent never submitted.
    await commitFile(wt, "b.txt", "unsubmitted B\n", "B");
    assertEquals((await runAgent(wt, ["done", "--json"])).code, 0);
    const b = await gitOut(wt, "rev-parse", "HEAD");
    const trunkBefore = await gitOut(dir, "rev-parse", "main");

    const refused = await runAgent(dir, [
      "accept",
      "--target",
      branch,
      "--json",
    ]);
    assertEquals(refused.code, 1, refused.output);
    const refusal = decodeCliResult(refused.stdout, "accept");
    assertEquals(refusal.error, "awaiting_consent");
    assertStringIncludes(
      refusal.message ?? "",
      `${branch} has a green run at ${b.slice(0, SHORT)} its agent never ` +
        `submitted — its recorded submission names ${a.slice(0, SHORT)} — ` +
        `so only the owner lands it: decide in conversation, then re-run ` +
        `discern accept --target ${branch} --confirmed. Recorded grants ` +
        `cover only the submitted revision.`,
    );
    assertEquals(await gitOut(dir, "rev-parse", "main"), trunkBefore);

    // The owner's explicit act lands the diverged revision.
    const landed = await runAgent(dir, [
      "accept",
      "--target",
      branch,
      "--confirmed",
      "--json",
    ]);
    assertEquals(landed.code, 0, landed.output);
    const result = decodeCliResult(landed.stdout, "accept");
    assert(result.data !== undefined && !("issues" in result.data));
    assertEquals(result.data.consent, { source: "conversation" });
    assertEquals(await gitOut(dir, "rev-parse", "main"), b);
  });
});

Deno.test("a standing scope grant covers only the recorded submission until the agent submits the later green", async () => {
  await withTempDir(async (dir) => {
    await scaffoldEngine(dir);
    await writeConfig(dir, STANDING_CONFIG);
    await gitInit(dir);
    const wt = await addWorktree(dir, "standing");

    // Revision A also touches an uncovered scope, so the unauthorized accept
    // records the submission without landing it.
    await commitFile(wt, "docs/guide.md", "covered docs\n", "A docs");
    await commitFile(wt, "src/tool.ts", "// uncovered\n", "A src");
    const a = await gitOut(wt, "rev-parse", "HEAD");
    assertEquals((await runAgent(wt, ["done", "--json"])).code, 0);
    assertEquals((await runAgent(wt, ["accept", "--json"])).code, 1);
    assertEquals((await readSubmission(wt)).status, "submitted");

    // Revision B narrows the change to the pre-authorized docs scope, so the
    // standing grant covers HEAD — but the submission still names A.
    await git(wt, "rm", "-q", "src/tool.ts");
    await git(wt, "commit", "-q", "-m", "B docs only", "--no-gpg-sign");
    const b = await gitOut(wt, "rev-parse", "HEAD");
    const branch = await gitOut(wt, "branch", "--show-current");
    assertEquals((await runAgent(wt, ["done", "--json"])).code, 0);
    const trunkBefore = await gitOut(dir, "rev-parse", "main");

    const refused = await runAgent(dir, [
      "accept",
      "--target",
      branch,
      "--json",
    ]);
    assertEquals(refused.code, 1, refused.output);
    const refusal = decodeCliResult(refused.stdout, "accept");
    assertEquals(refusal.error, "awaiting_consent");
    assertStringIncludes(
      refusal.message ?? "",
      `${branch} has a green run at ${b.slice(0, SHORT)} its agent never ` +
        `submitted — its recorded submission names ${a.slice(0, SHORT)} — ` +
        `so only the owner lands it: decide in conversation, then re-run ` +
        `discern accept --target ${branch} --confirmed. Recorded grants ` +
        `cover only the submitted revision.`,
    );
    assertEquals(await gitOut(dir, "rev-parse", "main"), trunkBefore);

    // Once its agent submits the later green, the same standing grant lands
    // it flagless from the worktree: the exact-submission rule bites only
    // pre-recorded-submission divergence.
    const landed = await runAgent(wt, ["accept", "--json"]);
    assertEquals(landed.code, 0, landed.output);
    const result = decodeCliResult(landed.stdout, "accept");
    assert(result.data !== undefined && !("issues" in result.data));
    assertEquals(result.data.consent, {
      source: "standing-grant",
      scopes: ["map"],
    });
    assertEquals(await gitOut(dir, "rev-parse", "main"), b);
  });
});

Deno.test("green Proof reuse requires the trunk's exact tip as predecessor, so done re-proves after a trunk fast-forward and acceptance proceeds", async () => {
  await withTempDir(async (dir) => {
    await scaffoldEngine(dir);
    await writeConfig(dir, config());
    await gitInit(dir);
    const wt = await addWorktree(dir, "stale-proof");
    await commitFile(wt, "one", "one\n", "one");
    assertEquals((await runAgent(wt, ["done", "--json"])).code, 0);
    await commitFile(wt, "two", "two\n", "two");
    assertEquals((await runAgent(wt, ["done", "--json"])).code, 0);
    const a = await gitOut(wt, "rev-parse", "HEAD~1");
    const b = await gitOut(wt, "rev-parse", "HEAD");

    // With the trunk unmoved, the exact green Proof still reuses.
    const reused = await runAgent(wt, ["done", "--json"]);
    assertEquals(reused.code, 0, reused.output);
    const reuse = parseGateJson(reused.stdout);
    assertEquals(reuse.data.gate_ran, false);
    assertEquals(
      reuse.message,
      "Current green Proof covers this exact tree; no gate job ran.",
    );

    // The owner fast-forwards the trunk to a commit the branch already
    // contains: ancestry still holds, but the Proof's recorded predecessor
    // is no longer the trunk's tip — exactly what acceptance requires.
    await git(dir, "merge", "--ff-only", a);

    const reproved = await runAgent(wt, ["done", "--json"]);
    assertEquals(reproved.code, 0, reproved.output);
    const rerun = parseGateJson(reproved.stdout);
    assertEquals(rerun.data.gate_ran, true, reproved.output);

    const landed = await runAgent(wt, ["accept", "--confirmed", "--json"]);
    assertEquals(landed.code, 0, landed.output);
    assertEquals(await gitOut(dir, "rev-parse", "main"), b);
  });
});
