/**
 * The restored landing behaviour end to end: an unauthorized accept records
 * the submission and refuses read-only; the landing queue is one derived view
 * (status, the desk's source, and accept --dry-run agree row for row);
 * pre-authorized efforts sort first and a later green done lands under the
 * grant with the checkout, branch, and resources removed; an owner lands a
 * never-submitted green run only with --target and --confirmed; a submission
 * behind the branch tip lands exactly the proven commit and keeps the
 * checkout. Every landing sentence is asserted verbatim from accept.ts.
 */

import { assert, assertEquals, assertStringIncludes } from "@std/assert";
import { join } from "@std/path";
import { targetExists } from "../src/shared/fs_presence.ts";
import { inspectGateProof } from "../src/engine/gate/proof.ts";
import { readEffortGrant } from "../src/engine/worktree/effort_grant.ts";
import { grantEffort } from "../src/engine/worktree/effort_grant_writer.ts";
import { readSubmission } from "../src/engine/worktree/submission.ts";
import { recordSubmission } from "../src/engine/worktree/submission_writer.ts";
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
import { decodeCliResult } from "./decode_cli_result.ts";
import { withTempDir } from "./helpers.ts";

const CONFIG = [
  "[meta]",
  "bootstrapped = true",
  "",
  "[project]",
  'slug = "queue-test"',
  "",
  "[repository]",
  'trunk = "main"',
  "",
  "[jobs]",
  'lint = ":"',
  "",
].join("\n");

/** Scaffold one committed effort worktree over the shared queue fixture. */
async function effortWithWork(
  dir: string,
  name: string,
  file: string,
): Promise<string> {
  const wt = await addWorktree(dir, name);
  await Deno.writeTextFile(join(wt, file), `${name} work\n`);
  await git(wt, "add", "-A");
  await git(wt, "commit", "-q", "-m", `feat: ${name}`, "--no-gpg-sign");
  return wt;
}

/** The queue facts every surface must agree on, in display order. */
function queueSummary(
  rows: readonly {
    readonly branch?: unknown;
    readonly authority?: unknown;
    readonly position?: unknown;
    readonly readiness?: unknown;
  }[],
): [unknown, unknown, unknown, unknown][] {
  return rows.map(
    (row) => [row.position, row.branch, row.authority, row.readiness],
  );
}

Deno.test("an unauthorized accept records the submission, refuses read-only, and every surface reads one queue order", async () => {
  await withTempDir(async (dir) => {
    await scaffoldEngine(dir);
    await writeConfig(dir, CONFIG);
    await gitInit(dir);
    const alpha = await effortWithWork(dir, "alpha", "alpha.txt");
    const beta = await effortWithWork(dir, "beta", "beta.txt");
    const trunkBefore = await gitOut(dir, "rev-parse", "main");
    assertEquals((await runAgent(alpha, ["done", "--json"])).code, 0);
    assertEquals((await runAgent(beta, ["done", "--json"])).code, 0);

    // The unauthorized accept records alpha's submission and refuses
    // read-only: the revision waits in the landing queue for the owner.
    const refused = await runAgent(alpha, ["accept", "--json"]);
    assertEquals(refused.code, 1, refused.output);
    const refusal = decodeCliResult(refused.stdout, "accept");
    assertEquals(refusal.error, "awaiting_consent");
    assertStringIncludes(
      refusal.message ?? "",
      "The revision is submitted and waits in the landing queue for the owner.",
    );
    assertStringIncludes(
      refusal.message ?? "",
      "Nothing has been landed — the worktree, its branch, and the trunk are untouched.",
    );
    assert(await targetExists(alpha), "the refusal must keep the worktree");
    assertEquals(await gitOut(dir, "rev-parse", "main"), trunkBefore);
    const alphaSubmission = await readSubmission(alpha);
    assert(alphaSubmission.status === "submitted", refused.output);
    assertEquals(
      alphaSubmission.submission.head,
      await gitOut(alpha, "rev-parse", "HEAD"),
    );

    // Beta is pre-authorized at the desk boundary and submits later.
    const betaBranch = await gitOut(beta, "branch", "--show-current");
    await grantEffort(beta, betaBranch, "2026-09-12T10:00:00.000Z");
    const betaProof = await inspectGateProof(beta);
    assert(
      betaProof.status === "honored" &&
        betaProof.proof_data?.completion !== undefined,
    );
    await recordSubmission(beta, {
      id: crypto.randomUUID(),
      effort_id: "beta",
      branch: betaBranch,
      head: await gitOut(beta, "rev-parse", "HEAD"),
      tree: await gitOut(beta, "rev-parse", "HEAD^{tree}"),
      proof: {
        candidate_id: betaProof.proof_data.completion.candidate_id,
        proof_id: betaProof.proof_data.completion.proof_id,
      },
      submitted_at: "2026-09-12T11:00:00.000Z",
    });

    // One derivation, one order: the pre-authorized row sorts first even
    // though it submitted later; the owner-awaiting row keeps its place.
    const rows = await submissionRows(await Deno.realPath(dir), "main");
    assertEquals(queueSummary(rows), [
      [1, betaBranch, "pre-authorized", "ready"],
      [2, alphaSubmission.submission.branch, "awaiting-owner", "ready"],
    ]);
    assertEquals(rows[0]?.authority_source, "effort-grant");
    assertEquals(rows[0]?.granted_at, "2026-09-12T10:00:00.000Z");

    // `status --json` — the desk's own data source — serves the same rows in
    // the same positions.
    const status = await runAgent(dir, ["status", "--json"]);
    assertEquals(status.code, 0, status.output);
    const statusResult = decodeCliResult(status.stdout, "status");
    assert(statusResult.data !== undefined && "queue" in statusResult.data);
    assertEquals(
      queueSummary(statusResult.data.queue ?? []),
      queueSummary(rows),
    );

    // `accept --dry-run` previews the same order, one sentence per row.
    const preview = await runAgent(alpha, ["accept", "--dry-run", "--json"]);
    assertEquals(preview.code, 0, preview.output);
    const previewResult = decodeCliResult(preview.stdout, "accept");
    const details = (previewResult.plan?.details ?? []).join("\n");
    assertStringIncludes(details, "Landing queue:");
    const alphaHead = alphaSubmission.submission.head.slice(0, 12);
    const betaHead = rows[0]?.head?.slice(0, 12) ?? "";
    assertStringIncludes(
      details,
      `1. ${betaBranch} at ${betaHead} — pre-authorized`,
    );
    assertStringIncludes(
      details,
      `2. ${alphaSubmission.submission.branch} at ${alphaHead} — awaiting the owner`,
    );
  });
});

Deno.test("a pre-authorized effort lands its later green done with the grant consumed and the checkout, branch, and resources removed", async () => {
  await withTempDir(async (dir) => {
    await withTempDir(async (markers) => {
      await scaffoldEngine(dir);
      await writeConfig(dir, CONFIG);
      await gitInit(dir);
      const alpha = await effortWithWork(dir, "alpha", "alpha.txt");
      const beta = await effortWithWork(dir, "beta", "beta.txt");
      assertEquals((await runAgent(alpha, ["done", "--json"])).code, 0);

      // Alpha waits in the queue for the owner.
      assertEquals((await runAgent(alpha, ["accept", "--json"])).code, 1);

      // Beta declares a per-worktree resource, sets it up, and is granted.
      await writeConfig(
        beta,
        `${CONFIG}\n[worktree.resources.thing]\ncreate  = "mkdir -p ${markers} && touch ${markers}/created"\ndestroy = "touch ${markers}/destroyed"\n`,
      );
      assertEquals((await runAgent(beta, ["worktree", "setup"])).code, 0);
      assert(await targetExists(join(markers, "created")));
      await git(beta, "add", "-A");
      await git(
        beta,
        "commit",
        "-q",
        "-m",
        "declare resource",
        "--no-gpg-sign",
      );
      const betaBranch = await gitOut(beta, "branch", "--show-current");
      await grantEffort(beta, betaBranch, "2026-09-12T10:00:00.000Z");

      // The grant binds to the effort, not one revision: a LATER green done
      // on the branch is covered until the landing consumes it.
      await Deno.writeTextFile(join(beta, "beta-more.txt"), "more\n");
      await git(beta, "add", "-A");
      await git(beta, "commit", "-q", "-m", "later work", "--no-gpg-sign");
      assertEquals((await runAgent(beta, ["done", "--json"])).code, 0);
      const betaHead = await gitOut(beta, "rev-parse", "HEAD");
      const betaPath = await Deno.realPath(beta);
      assertEquals((await readEffortGrant(beta)).status, "granted");

      const landed = await runAgent(beta, ["accept", "--json"]);
      assertEquals(landed.code, 0, landed.output);
      const result = decodeCliResult(landed.stdout, "accept");
      assertEquals(
        result.message,
        `Landed ${betaBranch} at ${betaHead.slice(0, 12)} on main; its ` +
          `checkout, branch, and resources are gone. You are on main in ${await Deno
            .realPath(dir)}.`,
      );
      assert(result.data !== undefined && !("issues" in result.data));
      assertEquals(result.data.consent, { source: "effort-grant" });
      assertEquals(result.data.landing, {
        recovery_performed: false,
        trunk_landed: true,
        worktree_removed: true,
        branch_deleted: true,
      });
      assertEquals(await gitOut(dir, "rev-parse", "main"), betaHead);
      assertEquals(await targetExists(betaPath), false, landed.output);
      assertEquals(await gitOut(dir, "branch", "--list", betaBranch), "");
      assert(
        await targetExists(join(markers, "destroyed")),
        "the landing destroys the effort's resources",
      );

      // The consumed grant authorizes nothing further. Alpha's row stays
      // ready — a moved trunk no longer waits on the author, since one
      // accept composes and checks it in an integration worktree — and the
      // row says the composition is what its landing will do.
      const rows = await submissionRows(await Deno.realPath(dir), "main");
      assertEquals(rows.length, 1);
      assertEquals(rows[0]?.authority, "awaiting-owner");
      assertEquals(rows[0]?.readiness, "ready");
      assertEquals(rows[0]?.reason, undefined);
      assertEquals(rows[0]?.integration, true);
    });
  });
});

Deno.test("an owner lands a never-submitted green run only with --target and --confirmed", async () => {
  await withTempDir(async (dir) => {
    await scaffoldEngine(dir);
    await writeConfig(dir, CONFIG);
    await gitInit(dir);
    const gamma = await effortWithWork(dir, "gamma", "gamma.txt");
    assertEquals((await runAgent(gamma, ["done", "--json"])).code, 0);
    const gammaBranch = await gitOut(gamma, "branch", "--show-current");
    const gammaHead = await gitOut(gamma, "rev-parse", "HEAD");
    const trunkBefore = await gitOut(dir, "rev-parse", "main");

    // The green run was never submitted, so it is absent from the queue and
    // recorded grants cannot land it: the owner decides in conversation.
    assertEquals((await readSubmission(gamma)).status, "missing");
    const unconfirmed = await runAgent(dir, [
      "accept",
      "--target",
      gammaBranch,
      "--json",
    ]);
    assertEquals(unconfirmed.code, 1, unconfirmed.output);
    const refusal = decodeCliResult(unconfirmed.stdout, "accept");
    assertEquals(refusal.error, "awaiting_consent");
    assertStringIncludes(
      refusal.message ?? "",
      `${gammaBranch} has a green run its agent never submitted, so only ` +
        `the owner lands it: decide in conversation, then re-run discern ` +
        `accept --target ${gammaBranch} --confirmed. Recorded grants do not ` +
        `cover an unsubmitted revision.`,
    );
    assertEquals(await gitOut(dir, "rev-parse", "main"), trunkBefore);
    assert(await targetExists(gamma));

    const landed = await runAgent(dir, [
      "accept",
      "--target",
      gammaBranch,
      "--confirmed",
      "--json",
    ]);
    assertEquals(landed.code, 0, landed.output);
    const result = decodeCliResult(landed.stdout, "accept");
    assert(result.data !== undefined && !("issues" in result.data));
    assertEquals(result.data.consent, { source: "conversation" });
    assertEquals(await gitOut(dir, "rev-parse", "main"), gammaHead);
    assertEquals(await targetExists(gamma), false, landed.output);
  });
});

Deno.test("a branch that moved on lands exactly its proven submission and keeps its checkout for the rest", async () => {
  await withTempDir(async (dir) => {
    await scaffoldEngine(dir);
    await writeConfig(dir, CONFIG);
    await gitInit(dir);
    const delta = await effortWithWork(dir, "delta", "delta.txt");
    assertEquals((await runAgent(delta, ["done", "--json"])).code, 0);
    const submitted = await runAgent(delta, ["accept", "--json"]);
    assertEquals(submitted.code, 1, submitted.output);
    const submission = await readSubmission(delta);
    assert(submission.status === "submitted");
    const provenHead = submission.submission.head;
    const deltaBranch = submission.submission.branch;
    const deltaPath = await Deno.realPath(delta);

    // The branch moves on past its submitted revision.
    await Deno.writeTextFile(join(delta, "delta-later.txt"), "later\n");
    await git(delta, "add", "-A");
    await git(delta, "commit", "-q", "-m", "later work", "--no-gpg-sign");
    const tip = await gitOut(delta, "rev-parse", "HEAD");
    assert(tip !== provenHead);

    // The owner lands exactly the proven commit; the checkout and branch stay
    // for the later commits, with the route named verbatim.
    const landed = await runAgent(dir, [
      "accept",
      "--target",
      deltaBranch,
      "--confirmed",
      "--json",
    ]);
    assertEquals(landed.code, 0, landed.output);
    const result = decodeCliResult(landed.stdout, "accept");
    assertEquals(
      result.message,
      `Landed ${deltaBranch} at ${provenHead.slice(0, 12)} on main; the ` +
        `branch holds later commits, so its checkout and branch stay. Run ` +
        `discern done, then discern accept from ${deltaPath} for them.`,
    );
    assertEquals(await gitOut(dir, "rev-parse", "main"), provenHead);
    assert(await targetExists(delta), "the checkout stays");
    assertEquals(await gitOut(delta, "rev-parse", "HEAD"), tip);
    assertEquals(
      (await readSubmission(delta)).status,
      "missing",
      "the landing consumed the submission",
    );

    // The named route finishes the effort: done over the tip, then accept.
    assertEquals((await runAgent(delta, ["done", "--json"])).code, 0);
    const rest = await runAgent(delta, ["accept", "--confirmed", "--json"]);
    assertEquals(rest.code, 0, rest.output);
    assertEquals(await gitOut(dir, "rev-parse", "main"), tip);
    assertEquals(await targetExists(delta), false);
  });
});

Deno.test("queue recovery follows current branch Proof across older submission states", async () => {
  await withTempDir(async (dir) => {
    await scaffoldEngine(dir);
    await writeConfig(dir, CONFIG);
    await gitInit(dir);
    const wt = await effortWithWork(dir, "revised", "work.txt");
    assertEquals((await runAgent(wt, ["done", "--json"])).code, 0);
    assertEquals((await runAgent(wt, ["accept", "--json"])).code, 1);
    const submitted = await readSubmission(wt);
    assert(submitted.status === "submitted");

    await Deno.writeTextFile(join(wt, "work.txt"), "updated work\n");
    await git(wt, "add", "-A");
    // A rewritten source also differs from the submission, without ancestry.
    await git(
      wt,
      "commit",
      "--amend",
      "-q",
      "-m",
      "revise work",
      "--no-gpg-sign",
    );
    const head = await gitOut(wt, "rev-parse", "HEAD");
    const root = await Deno.realPath(dir);
    assertStringIncludes(
      (await submissionRows(root, "main"))[0]?.reason ?? "",
      "discern done",
    );
    assertEquals((await runAgent(wt, ["done", "--json"])).code, 0);

    // Trunk movement after Proof needs integration, not another author gate.
    await Deno.writeTextFile(join(dir, "trunk.txt"), "later trunk work\n");
    await git(dir, "add", "-A");
    await git(dir, "commit", "-q", "-m", "advance trunk", "--no-gpg-sign");
    const row = (await submissionRows(root, "main"))[0];
    assert(row !== undefined);
    assertEquals(row.head, submitted.submission.head);
    assertEquals(row.authority, "awaiting-owner");
    assertEquals(row.readiness, "waiting");
    assertStringIncludes(row.reason ?? "", head.slice(0, 12));
    assertStringIncludes(row.reason ?? "", "discern accept");
    assert(!(row.reason ?? "").includes("discern done"));

    for (
      const args of [
        ["status", "--json"],
        ["accept", "--dry-run", "--json"],
        ["accept", "--target", "agent/revised", "--dry-run", "--json"],
      ]
    ) {
      const view = await runAgent(dir, args);
      assertEquals(view.code, 0, view.output);
      assertStringIncludes(view.stdout, row.reason ?? "");
    }
    assertEquals(await readSubmission(wt), submitted);

    // Losing the earlier Proof must not hide the valid current Proof.
    await recordSubmission(wt, {
      ...submitted.submission,
      proof: {
        ...submitted.submission.proof,
        proof_id: crypto.randomUUID(),
      },
    });
    const unreadableSubmission = await readSubmission(wt);
    const unreadableRow = (await submissionRows(root, "main"))[0];
    assertEquals(unreadableRow?.reason, row.reason);
    assertEquals(unreadableRow?.head, row.head);
    assertEquals(await readSubmission(wt), unreadableSubmission);
    await recordSubmission(wt, submitted.submission);
    assertEquals(await readSubmission(wt), submitted);

    // An uncommitted change removes the basis for the shorter recovery.
    await Deno.writeTextFile(join(wt, "work.txt"), "unfinished work\n");
    assertStringIncludes(
      (await submissionRows(root, "main"))[0]?.reason ?? "",
      "discern done",
    );
  });
});

Deno.test("an effort grant never covers a declared-unmet variance", async () => {
  await withTempDir(async (dir) => {
    await scaffoldEngine(dir);
    await writeConfig(
      dir,
      `${CONFIG}\n[checkpoints.api-review]\npaths = ["api/**"]\nquestion = "A changed surface is described in its docs before it lands."\n`,
    );
    await gitInit(dir);
    const wt = await addWorktree(dir, "varianced");
    await Deno.mkdir(join(wt, "api"), { recursive: true });
    await Deno.writeTextFile(join(wt, "api", "surface.txt"), "endpoint\n");
    await git(wt, "add", "-A");
    await git(wt, "commit", "-q", "-m", "feat: api", "--no-gpg-sign");
    const branch = await gitOut(wt, "branch", "--show-current");
    await grantEffort(wt, branch, "2026-09-12T10:00:00.000Z");
    assertEquals(
      (await runAgent(wt, [
        "done",
        "--unmet",
        "api-review",
        "--why",
        "The docs lag the new surface; a follow-up covers them.",
        "--json",
      ])).code,
      0,
    );

    const refused = await runAgent(wt, ["accept", "--json"]);
    assertEquals(refused.code, 1, refused.output);
    const refusal = decodeCliResult(refused.stdout, "accept");
    assertEquals(refusal.error, "awaiting_variance", refused.output);
    assertStringIncludes(
      refusal.message ?? "",
      "Recorded standing and effort grants never authorize a variance.",
    );
    assert(await targetExists(wt));
    assertEquals(
      (await readEffortGrant(wt)).status,
      "granted",
      "the refusal must not consume the grant",
    );
  });
});
