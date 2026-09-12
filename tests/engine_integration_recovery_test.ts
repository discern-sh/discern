/**
 * Interrupted and contended integration landings: a kill after the trunk
 * moved retries into completed Proof recording, exact submission
 * consumption, and integration cleanup without a second landing; a
 * replacement submission survives settling the older snapshot; a dead
 * owner's integration copy is pruned while a live one never is; a revoked
 * grant refuses before the trunk moves; and two simultaneous accepts both
 * land with the second waiting its turn — including the case where the
 * predecessor already landed the waiting call's submission.
 */

import { assert, assertEquals, assertStringIncludes } from "@std/assert";
import { join } from "@std/path";
import { targetExists } from "../src/shared/fs_presence.ts";
import { SYSTEM_SECURE_ENTROPY } from "../src/shared/entropy.ts";
import { grantEffort } from "../src/engine/worktree/effort_grant_writer.ts";
import { clearEffortGrant } from "../src/engine/worktree/effort_grant_cleanup.ts";
import {
  performAcceptanceTransition,
  withAcceptanceTransactionLock,
} from "../src/engine/worktree/acceptance_transaction.ts";
import { fastForwardCheckedOutBranch } from "../src/engine/worktree/git.ts";
import { loadIdentitySettings } from "../src/engine/worktree/identity.ts";
import {
  type IntegrationAttempt,
  runIntegrationAttempt,
} from "../src/engine/worktree/integration_landing.ts";
import {
  listIntegrationLandingRecords,
  writeIntegrationLandingRecord,
} from "../src/engine/worktree/integration_record.ts";
import { readSubmission } from "../src/engine/worktree/submission.ts";
import {
  clearSubmission,
  recordSubmission,
} from "../src/engine/worktree/submission_writer.ts";
import { Logger } from "../src/lib/log.ts";
import {
  addWorktree,
  git,
  gitInit,
  gitOut,
  runAgent,
  scaffoldEngine,
  writeConfig,
} from "./engine_helpers.ts";
import { TEST_CLI_MODEL } from "./cli_model.ts";
import { withTempDir } from "./helpers.ts";

const CONFIG = [
  "[meta]",
  "bootstrapped = true",
  "",
  "[project]",
  'slug = "recovery-test"',
  "",
  "[repository]",
  'trunk = "main"',
  "",
  "[jobs]",
  'lint = ":"',
  "",
].join("\n");

/** Scaffold a refresh-converged repository. */
async function fixture(dir: string): Promise<void> {
  await scaffoldEngine(dir);
  await writeConfig(dir, CONFIG);
  await gitInit(dir);
  assertEquals((await runAgent(dir, ["refresh", "--json"])).code, 0);
  await git(dir, "add", "-A");
  if ((await gitOut(dir, "status", "--porcelain")) !== "") {
    await git(dir, "commit", "-q", "-m", "converge artifacts", "--no-gpg-sign");
  }
}

/** One committed, proven effort worktree. */
async function provenEffort(
  dir: string,
  name: string,
): Promise<string> {
  const wt = await addWorktree(dir, name);
  await Deno.writeTextFile(join(wt, `${name}.txt`), `${name} work\n`);
  await git(wt, "add", "-A");
  await git(wt, "commit", "-q", "-m", `feat: ${name}`, "--no-gpg-sign");
  assertEquals((await runAgent(wt, ["done", "--json"])).code, 0);
  return wt;
}

/** The author-effort facts the in-process integration phase needs. */
async function integrationEffort(dir: string, wt: string): Promise<{
  path: string;
  branch: string;
  id: string;
  mainRepo: string;
  trunk: string;
  settings: Awaited<ReturnType<typeof loadIdentitySettings>>;
}> {
  const path = await Deno.realPath(wt);
  return {
    path,
    branch: await gitOut(wt, "branch", "--show-current"),
    id: path.split("/").pop() as string,
    mainRepo: await Deno.realPath(dir),
    trunk: "main",
    settings: await loadIdentitySettings(path),
  };
}

/** Compose the frozen submission against the current tip, in process, and
 * stop before the trunk transition — the state a kill leaves behind. */
async function composeGreen(
  dir: string,
  wt: string,
): Promise<{
  effort: Awaited<ReturnType<typeof integrationEffort>>;
  green: Extract<IntegrationAttempt, { kind: "green" }>;
  frozenId: string;
  frozenHead: string;
  tip: string;
}> {
  const effort = await integrationEffort(dir, wt);
  const read = await readSubmission(effort.path);
  assert(read.status === "submitted");
  const tip = await gitOut(dir, "rev-parse", "main");
  const composed = await withAcceptanceTransactionLock(
    effort.path,
    () =>
      runIntegrationAttempt({
        effort,
        submission: read.submission,
        expectedTrunk: tip,
        log: new Logger({ json: true, noColor: true }),
        cliModel: TEST_CLI_MODEL,
      }),
  );
  assert(composed.kind === "green", JSON.stringify(composed));
  return {
    effort,
    green: composed,
    frozenId: read.submission.id,
    frozenHead: read.submission.head,
    tip,
  };
}

Deno.test("a kill after the trunk moved retries into Proof, exact consumption, and integration cleanup without a second landing", async () => {
  await withTempDir(async (dir) => {
    await fixture(dir);
    const alpha = await provenEffort(dir, "alpha");
    const beta = await provenEffort(dir, "beta");
    assertEquals((await runAgent(beta, ["accept", "--json"])).code, 1);
    assertEquals(
      (await runAgent(alpha, ["accept", "--confirmed", "--json"])).code,
      0,
    );

    const { effort, green, frozenHead, frozenId, tip } = await composeGreen(
      dir,
      beta,
    );
    const transition = await withAcceptanceTransactionLock(
      effort.path,
      () =>
        performAcceptanceTransition(effort.path, {
          mainRepo: effort.mainRepo,
          trunk: "main",
          worktreeBranch: effort.branch,
          expectedTrunk: tip,
          target: green.head,
          effortClaim: false,
          submissionId: frozenId,
          proof: { ...green.proofPointer },
          integration: {
            worktree_id: green.record.worktree.id,
            worktree_branch: green.record.worktree.branch,
            worktree_path: green.record.worktree.path,
          },
          consent: { source: "conversation" },
          variances: [],
          standardProposals: [],
        }),
    );
    assert(
      transition.kind === "attempted" && transition.outcome.kind === "updated",
    );
    // The simulated kill: trunk advanced, journal recorded, nothing settled.
    assertEquals(await gitOut(dir, "rev-parse", "main"), green.head);
    assertEquals((await readSubmission(effort.path)).status, "submitted");

    const retried = await runAgent(beta, ["accept", "--json"]);
    assertEquals(retried.code, 1, retried.output);
    assertStringIncludes(
      retried.output,
      "completed the interrupted landing",
    );
    assertStringIncludes(retried.output, "No landing authority was replayed.");

    // The retry recorded the Proof note for the exact composed commit from
    // the journal's own pointer, consumed exactly the recorded submission,
    // and removed the integration copy — without a second landing.
    assertEquals(await gitOut(dir, "rev-parse", "main"), green.head);
    const note = await gitOut(
      dir,
      "notes",
      "--ref=discern",
      "show",
      green.head,
    );
    assert(note.length > 0);
    assertEquals((await readSubmission(effort.path)).status, "missing");
    assertEquals(await listIntegrationLandingRecords(effort.mainRepo), []);
    assertEquals(
      await gitOut(dir, "branch", "--list", green.record.worktree.branch),
      "",
    );
    assertEquals(await targetExists(green.record.worktree.path), false);
    // The author's checkout and branch still hold the submitted work; the
    // recovery message named `discern worktree prune` as the cleanup route.
    assertEquals(await gitOut(beta, "rev-parse", "HEAD"), frozenHead);
    assertStringIncludes(retried.output, "discern worktree prune");
  });
});

Deno.test("a replacement submission survives settling the older snapshot's landing", async () => {
  await withTempDir(async (dir) => {
    await fixture(dir);
    const alpha = await provenEffort(dir, "alpha");
    const beta = await provenEffort(dir, "beta");
    assertEquals((await runAgent(beta, ["accept", "--json"])).code, 1);
    assertEquals(
      (await runAgent(alpha, ["accept", "--confirmed", "--json"])).code,
      0,
    );

    const { effort, green, frozenId, tip } = await composeGreen(dir, beta);
    const transition = await withAcceptanceTransactionLock(
      effort.path,
      () =>
        performAcceptanceTransition(effort.path, {
          mainRepo: effort.mainRepo,
          trunk: "main",
          worktreeBranch: effort.branch,
          expectedTrunk: tip,
          target: green.head,
          effortClaim: false,
          submissionId: frozenId,
          proof: { ...green.proofPointer },
          integration: {
            worktree_id: green.record.worktree.id,
            worktree_branch: green.record.worktree.branch,
            worktree_path: green.record.worktree.path,
          },
          consent: { source: "conversation" },
          variances: [],
          standardProposals: [],
        }),
    );
    assert(
      transition.kind === "attempted" && transition.outcome.kind === "updated",
    );

    // A newer accept replaced the durable submission after the kill: the
    // author committed more and asked to land the new revision.
    await Deno.writeTextFile(join(beta, "beta-more.txt"), "more\n");
    await git(beta, "add", "-A");
    await git(beta, "commit", "-q", "-m", "more", "--no-gpg-sign");
    const newerHead = await gitOut(beta, "rev-parse", "HEAD");
    const replacement = await recordSubmission(effort.path, {
      id: SYSTEM_SECURE_ENTROPY.uuid(),
      effort_id: effort.id,
      branch: effort.branch,
      head: newerHead,
      tree: await gitOut(beta, "rev-parse", `${newerHead}^{tree}`),
      proof: green.record.landing.proof,
      submitted_at: "2026-09-12T12:00:00.000Z",
    });

    const retried = await runAgent(beta, ["accept", "--json"]);
    assertEquals(retried.code, 1, retried.output);
    assertStringIncludes(retried.output, "completed the interrupted landing");

    // Settling the older snapshot consumed nothing of the newer record.
    const current = await readSubmission(effort.path);
    assert(current.status === "submitted");
    assertEquals(current.submission.id, replacement.id);
    assertEquals(current.submission.head, newerHead);
  });
});

Deno.test("prune reclaims a dead owner's integration copy and never a live one", async () => {
  await withTempDir(async (dir) => {
    await fixture(dir);
    const alpha = await provenEffort(dir, "alpha");
    const beta = await provenEffort(dir, "beta");
    assertEquals((await runAgent(beta, ["accept", "--json"])).code, 1);
    assertEquals(
      (await runAgent(alpha, ["accept", "--confirmed", "--json"])).code,
      0,
    );

    // A composition this process owns: the record's owner is live.
    const { effort, green } = await composeGreen(dir, beta);
    const live = await runAgent(dir, ["worktree", "prune", "--yes", "--json"]);
    assertEquals(live.code, 0, live.output);
    assert(
      await targetExists(green.record.worktree.path),
      "a live integration worktree is never pruned",
    );
    const kept = await listIntegrationLandingRecords(effort.mainRepo);
    assertEquals(kept.length, 1);

    // The same record with a provably dead owner is an interrupted
    // integration: prune reclaims the copy, its branch, and the record,
    // touching neither the author nor the trunk.
    const tipBefore = await gitOut(dir, "rev-parse", "main");
    const betaHead = await gitOut(beta, "rev-parse", "HEAD");
    await writeIntegrationLandingRecord(effort.mainRepo, {
      ...green.record,
      operation: { pid: 2 ** 22 - 7 },
    });
    const reclaimed = await runAgent(dir, [
      "worktree",
      "prune",
      "--yes",
      "--json",
    ]);
    assertEquals(reclaimed.code, 0, reclaimed.output);
    assertEquals(await targetExists(green.record.worktree.path), false);
    assertEquals(
      await gitOut(dir, "branch", "--list", green.record.worktree.branch),
      "",
    );
    assertEquals(await listIntegrationLandingRecords(effort.mainRepo), []);
    assertEquals(await gitOut(dir, "rev-parse", "main"), tipBefore);
    assertEquals(await gitOut(beta, "rev-parse", "HEAD"), betaHead);
    assertEquals((await readSubmission(effort.path)).status, "submitted");
  });
});

Deno.test("a grant revoked during checks refuses at the boundary before the trunk moves", async () => {
  await withTempDir(async (dir) => {
    await fixture(dir);
    const alpha = await provenEffort(dir, "alpha");
    const beta = await provenEffort(dir, "beta");
    assertEquals((await runAgent(beta, ["accept", "--json"])).code, 1);
    await grantEffort(beta, "agent/beta", "2026-09-12T10:00:00.000Z");
    assertEquals(
      (await runAgent(alpha, ["accept", "--confirmed", "--json"])).code,
      0,
    );

    const { effort, green, frozenId, tip } = await composeGreen(dir, beta);
    // The desk revokes while the combined check runs.
    await clearEffortGrant(effort.path);
    const transition = await withAcceptanceTransactionLock(
      effort.path,
      () =>
        performAcceptanceTransition(effort.path, {
          mainRepo: effort.mainRepo,
          trunk: "main",
          worktreeBranch: effort.branch,
          expectedTrunk: tip,
          target: green.head,
          effortClaim: true,
          submissionId: frozenId,
          proof: { ...green.proofPointer },
          consent: { source: "effort-grant" },
          variances: [],
          standardProposals: [],
        }),
    );
    assert(transition.kind === "authority-changed");
    assertEquals(await gitOut(dir, "rev-parse", "main"), tip);
  });
});

Deno.test("two simultaneous accepts both land, the second waiting its turn and composing", async () => {
  await withTempDir(async (dir) => {
    await fixture(dir);
    const alpha = await provenEffort(dir, "alpha");
    const beta = await provenEffort(dir, "beta");

    const [first, second] = await Promise.all([
      runAgent(alpha, ["accept", "--confirmed", "--json"]),
      runAgent(beta, ["accept", "--confirmed", "--json"]),
    ]);
    assertEquals(first.code, 0, first.output);
    assertEquals(second.code, 0, second.output);
    const tip = await gitOut(dir, "rev-parse", "main");
    await git(
      dir,
      "merge-base",
      "--is-ancestor",
      await gitOut(dir, "rev-parse", `${tip}^{commit}`),
      tip,
    );
    assert(await targetExists(join(dir, "alpha.txt")));
    assert(await targetExists(join(dir, "beta.txt")));
    assertEquals(
      await listIntegrationLandingRecords(await Deno.realPath(dir)),
      [],
    );
    assertEquals(await gitOut(dir, "branch", "--list", "agent/alpha"), "");
    assertEquals(await gitOut(dir, "branch", "--list", "agent/beta"), "");
  });
});

Deno.test("a waiting accept whose submission a predecessor landed returns that settled outcome", async () => {
  await withTempDir(async (dir) => {
    await fixture(dir);
    const beta = await provenEffort(dir, "beta");
    assertEquals((await runAgent(beta, ["accept", "--json"])).code, 1);
    const read = await readSubmission(await Deno.realPath(beta));
    assert(read.status === "submitted");
    const tip = await gitOut(dir, "rev-parse", "main");
    const root = await Deno.realPath(dir);

    let waiting: Promise<
      { code: number; stdout: string; stderr: string; output: string }
    >;
    await withAcceptanceTransactionLock(root, async () => {
      // The predecessor holds the landing boundary; beta's accept queues.
      waiting = runAgent(beta, ["accept", "--confirmed", "--json"]);
      // Give the waiter time to reach the boundary, then land its exact
      // submission the way a queue walk's direct path does.
      await new Promise((resolve) => setTimeout(resolve, 3000));
      const landed = await fastForwardCheckedOutBranch(
        root,
        "main",
        tip,
        read.submission.head,
      );
      assertEquals(landed.kind, "updated");
      await clearSubmission(await Deno.realPath(beta));
    });
    const settled = await waiting!;
    assertEquals(settled.code, 0, settled.output);
    assertStringIncludes(
      settled.output,
      "already landed on main through a preceding landing",
    );
    assertStringIncludes(
      settled.output,
      "verified that outcome and changed nothing",
    );
    assertEquals(await gitOut(dir, "rev-parse", "main"), read.submission.head);
  });
});
