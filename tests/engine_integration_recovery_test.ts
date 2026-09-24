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
import {
  commitIsMerged,
  fastForwardCheckedOutBranch,
} from "../src/engine/worktree/git.ts";
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
import { submissionRows } from "../src/engine/worktree/submissions_view.ts";
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
import { readOperationJournal } from "../src/engine/completion/operation_journal.ts";
import { TEST_CLI_MODEL } from "./cli_model.ts";
import { decodeCliResult } from "./decode_cli_result.ts";
import { waitForPendingCondition, waitUntil } from "./waiting.ts";
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
    assertEquals(retried.code, 0, retried.output);
    const retriedResult = decodeCliResult(retried.stdout, "accept");
    assertStringIncludes(
      retriedResult.message ?? "",
      "resumed the recorded landing",
    );
    assertStringIncludes(
      retriedResult.message ?? "",
      "No landing authority was replayed.",
    );

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
    assertEquals(await submissionRows(effort.mainRepo, "main"), []);
    assertEquals(await listIntegrationLandingRecords(effort.mainRepo), []);
    assertEquals(
      await gitOut(dir, "branch", "--list", green.record.worktree.branch),
      "",
    );
    assertEquals(await targetExists(green.record.worktree.path), false);
    // The author's branch held only the submitted revision the composed
    // commit contains, so the retry finishes the ordinary cleanup too.
    assert(await commitIsMerged(dir, frozenHead, "main"));
    assertEquals(await targetExists(beta), false);
    assertEquals(await gitOut(dir, "branch", "--list", effort.branch), "");
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
    assertEquals(retried.code, 0, retried.output);
    const retriedResult = decodeCliResult(retried.stdout, "accept");
    assertStringIncludes(
      retriedResult.message ?? "",
      "resumed the recorded landing",
    );
    // The newer commit is later work, so the checkout stays for it.
    assertStringIncludes(
      retriedResult.message ?? "",
      "the branch holds later commits",
    );
    assert(await targetExists(beta));

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

    let waiting:
      | Promise<
        { code: number; stdout: string; stderr: string; output: string }
      >
      | undefined;
    const betaPath = await Deno.realPath(beta);
    await withAcceptanceTransactionLock(root, async () => {
      // The predecessor holds the landing boundary; beta's accept queues.
      waiting = runAgent(beta, ["accept", "--confirmed", "--json"]);
      // The waiter's own journal records the landing-turn wait lifecycle —
      // the positive condition that it reached the boundary.
      await waitUntil(async () => {
        const reading = await readOperationJournal(betaPath);
        return reading.kind === "found" &&
          Object.values(reading.record.waits ?? {}).some((wait) =>
            wait.kind === "landing-turn" && wait.state === "waiting"
          );
      }, "the second accept reports waiting behind the running landing");
      // Land its exact submission the way a queue walk's direct path does.
      const landed = await fastForwardCheckedOutBranch(
        root,
        "main",
        tip,
        read.submission.head,
      );
      assertEquals(landed.kind, "updated");
      await clearSubmission(betaPath);
    });
    assert(waiting !== undefined);
    const settled = await waiting;
    assertEquals(settled.code, 0, settled.output);
    const settledResult = decodeCliResult(settled.stdout, "accept");
    assertStringIncludes(
      settledResult.message ?? "",
      "already landed on main through a preceding landing",
    );
    assertStringIncludes(
      settledResult.message ?? "",
      "verified that outcome and changed nothing",
    );
    assertEquals(await gitOut(dir, "rev-parse", "main"), read.submission.head);
  });
});
Deno.test("a waiting acceptance lands the submission it entered with when the author commits during the wait", async () => {
  await withTempDir(async (dir) => {
    await fixture(dir);
    const beta = await provenEffort(dir, "beta");
    assertEquals((await runAgent(beta, ["accept", "--json"])).code, 1);
    const entered = await readSubmission(await Deno.realPath(beta));
    assert(entered.status === "submitted");
    const betaPath = await Deno.realPath(beta);
    const root = await Deno.realPath(dir);

    let pending:
      | ReturnType<typeof runAgent>
      | undefined;
    await withAcceptanceTransactionLock(root, async () => {
      // The predecessor holds the boundary; beta's accept queues, and the
      // author commits more work while it waits.
      pending = runAgent(beta, ["accept", "--confirmed", "--json"]);
      await waitUntil(async () => {
        const reading = await readOperationJournal(betaPath);
        return reading.kind === "found" &&
          Object.values(reading.record.waits ?? {}).some((wait) =>
            wait.kind === "landing-turn" && wait.state === "waiting"
          );
      }, "the second accept reports waiting behind the running landing");
      await Deno.writeTextFile(join(beta, "later.txt"), "later\n");
      await git(beta, "add", "-A");
      await git(beta, "commit", "-q", "-m", "later work", "--no-gpg-sign");
    });
    assert(pending !== undefined);
    const landed = await pending;
    assertEquals(landed.code, 0, landed.output);
    const result = decodeCliResult(landed.stdout, "accept");

    // The waiting request kept its identity: exactly the entered submission
    // landed, the later commit stayed on the branch, and the kept checkout
    // is told its next step.
    assertEquals(
      await gitOut(dir, "rev-parse", "main"),
      entered.submission.head,
    );
    assertStringIncludes(result.message ?? "", "holds later commits");
    assert(await targetExists(betaPath));
    assertStringIncludes(
      await Deno.readTextFile(join(beta, "later.txt")),
      "later",
    );
  });
});
Deno.test("a first acceptance freezes its proven revision before waiting to submit", async () => {
  await withTempDir(async (dir) => {
    await fixture(dir);
    const beta = await provenEffort(dir, "beta");
    const entered = await gitOut(beta, "rev-parse", "HEAD");
    // No submission exists yet: the first accept must freeze the subject
    // itself before its wait.
    assertEquals((await readSubmission(beta)).status, "missing");
    const betaPath = await Deno.realPath(beta);
    const root = await Deno.realPath(dir);

    let pending:
      | ReturnType<typeof runAgent>
      | undefined;
    await withAcceptanceTransactionLock(root, async () => {
      pending = runAgent(beta, ["accept", "--confirmed", "--json"]);
      await waitUntil(async () => {
        const reading = await readOperationJournal(betaPath);
        return reading.kind === "found" &&
          Object.values(reading.record.waits ?? {}).some((wait) =>
            wait.kind === "landing-turn" && wait.state === "waiting"
          );
      }, "the first accept reports waiting behind the running landing");
      await Deno.writeTextFile(join(beta, "later.txt"), "later\n");
      await git(beta, "add", "-A");
      await git(beta, "commit", "-q", "-m", "later work", "--no-gpg-sign");
    });
    assert(pending !== undefined);
    const landed = await pending;
    assertEquals(landed.code, 0, landed.output);
    const result = decodeCliResult(landed.stdout, "accept");
    assertEquals(await gitOut(dir, "rev-parse", "main"), entered);
    assertStringIncludes(result.message ?? "", "holds later commits");
    assert(await targetExists(betaPath));
  });
});
Deno.test("a running done in the author checkout is never deadlocked by acceptance", async () => {
  await withTempDir(async (dir) => {
    await withTempDir(async (scratch) => {
      await scaffoldEngine(dir);
      await writeConfig(
        dir,
        CONFIG.replace('lint = ":"', 'lint = "sh author-pause.sh"'),
      );
      await gitInit(dir);
      await Deno.writeTextFile(
        join(dir, "author-pause.sh"),
        [
          "#!/bin/sh",
          `if [ -f "${scratch}/pause" ]; then`,
          '  case "$(pwd)" in',
          "    *integration*) ;;",
          "    *)",
          `      touch "${scratch}/started"`,
          `      until [ -f "${scratch}/release" ]; do sleep 0.1; done ;;`,
          "  esac",
          "fi",
          "exit 0",
          "",
        ].join("\n"),
      );
      await git(dir, "add", "-A");
      await git(
        dir,
        "commit",
        "-q",
        "-m",
        "wire pausing lint",
        "--no-gpg-sign",
      );
      assertEquals((await runAgent(dir, ["refresh", "--json"])).code, 0);
      await git(dir, "add", "-A");
      if ((await gitOut(dir, "status", "--porcelain")) !== "") {
        await git(dir, "commit", "-q", "-m", "converge", "--no-gpg-sign");
      }
      const beta = await provenEffort(dir, "beta");
      const tip = await gitOut(dir, "rev-parse", "main");

      // A rerun holds beta's checkout mid-gate; acceptance must neither
      // wait for that checkout while serialized nor starve the rerun's
      // completion publication.
      await Deno.writeTextFile(join(scratch, "pause"), "on\n");
      const rerun = runAgent(beta, ["done", "--rerun", "--json"]);
      await waitForPendingCondition(
        rerun,
        () => targetExists(join(scratch, "started")),
        "the rerun reached its paused check",
        {
          settledError: (value) =>
            new Error(`the rerun settled before pausing: ${value.output}`),
        },
      );

      const refused = await runAgent(beta, ["accept", "--confirmed", "--json"]);
      assertEquals(refused.code, 1, refused.output);
      const result = decodeCliResult(refused.stdout, "accept");
      assertStringIncludes(result.message ?? "", "checkout boundary");
      assertStringIncludes(result.message ?? "", "Retry");
      assertEquals(await gitOut(dir, "rev-parse", "main"), tip);

      await Deno.writeTextFile(join(scratch, "release"), "go\n");
      const finished = await rerun;
      assertEquals(finished.code, 0, finished.output);

      const landed = await runAgent(beta, ["accept", "--confirmed", "--json"]);
      assertEquals(landed.code, 0, landed.output);
    });
  });
});
