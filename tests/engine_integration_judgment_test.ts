/**
 * Integration checkpoint judgments, end to end through the public CLI: when a
 * composed landing's only obstacle is a checkpoint question about the combined
 * result, acceptance retains the composition, serves the exact question, and a
 * follow-up `accept --met`/`--unmet` answers it and continues the landing —
 * without an author-side update, a new author Proof, or a repeat of work the
 * gate already proved. Real conflicts and red checks keep the author repair
 * route; a changed composition never inherits a judgment made about another.
 */

import { assert, assertEquals, assertStringIncludes } from "@std/assert";
import { join } from "@std/path";
import { targetExists } from "../src/shared/fs_presence.ts";
import { listIntegrationLandingRecords } from "../src/engine/worktree/integration_record.ts";
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
import { decodeCliResult } from "./decode_cli_result.ts";
import { withTempDir } from "./helpers.ts";

const QUESTION =
  "A changed shared record keeps every other row's meaning intact.";

/** A gate whose one job counts its executions, plus one stop checkpoint
 * watching the shared record file both efforts edit. */
function config(): string {
  return [
    "[meta]",
    "bootstrapped = true",
    "",
    "[project]",
    'slug = "judgment-test"',
    "",
    "[repository]",
    'trunk = "main"',
    "",
    "[jobs]",
    'lint = "sh count-producer.sh"',
    "",
    "[checkpoints.record-review]",
    'paths = ["notes/**"]',
    `question = "${QUESTION}"`,
    "",
  ].join("\n");
}

/** Scaffold a refresh-converged repository whose trunk carries a shared
 * two-row record file, with a producer-counting gate job. */
async function judgmentFixture(dir: string, counter: string): Promise<void> {
  await scaffoldEngine(dir);
  await writeConfig(dir, config());
  await Deno.writeTextFile(
    join(dir, "count-producer.sh"),
    `printf x >> "${counter}"\n`,
  );
  await Deno.mkdir(join(dir, "notes"), { recursive: true });
  // The two rows sit far enough apart that independent edits merge cleanly;
  // the checkpoint watches the whole file, so a clean merge still changes
  // the judged subject.
  await Deno.writeTextFile(
    join(dir, "notes", "index.md"),
    [
      "# Shared record",
      "",
      "- alpha: pending",
      "",
      "The rows are kept apart by this prose",
      "so that independent single-row edits",
      "merge cleanly, while any edit to the",
      "file still moves the judged subject.",
      "",
      "- beta: pending",
      "",
    ].join("\n"),
  );
  await gitInit(dir);
  assertEquals((await runAgent(dir, ["refresh", "--json"])).code, 0);
  await git(dir, "add", "-A");
  if ((await gitOut(dir, "status", "--porcelain")) !== "") {
    await git(dir, "commit", "-q", "-m", "converge artifacts", "--no-gpg-sign");
  }
}

/** One effort that flips its own row of the shared record. */
async function effortFlippingRow(
  dir: string,
  name: "alpha" | "beta",
): Promise<string> {
  const wt = await addWorktree(dir, name);
  const record = join(wt, "notes", "index.md");
  const current = await Deno.readTextFile(record);
  await Deno.writeTextFile(
    record,
    current.replace(`- ${name}: pending`, `- ${name}: complete`),
  );
  await git(wt, "add", "-A");
  await git(wt, "commit", "-q", "-m", `complete: ${name}`, "--no-gpg-sign");
  return wt;
}

/** The producer executions recorded so far. */
async function producerRuns(counter: string): Promise<number> {
  try {
    return (await Deno.readTextFile(counter)).length;
  } catch {
    return 0;
  }
}

/** No integration worktree, branch, or record survives. */
async function assertNoIntegrationRemains(dir: string): Promise<void> {
  const root = await Deno.realPath(dir);
  assertEquals(await listIntegrationLandingRecords(root), []);
  assertEquals(await gitOut(dir, "branch", "--list", "integration/*"), "");
}

/** The one retained awaiting-judgment record, when exactly one exists. */
async function retainedRecord(dir: string): Promise<
  | {
    readonly phase: string;
    readonly worktreePath: string;
    readonly submissionId: string;
  }
  | undefined
> {
  const root = await Deno.realPath(dir);
  const records = (await listIntegrationLandingRecords(root))
    .filter((entry) => entry.reading.status === "recorded")
    .map((entry) =>
      entry.reading.status === "recorded" ? entry.reading.record : undefined
    )
    .filter((record) => record !== undefined);
  const awaiting = records.filter((record) =>
    record.phase === "awaiting-judgment"
  );
  const record = awaiting[0];
  if (awaiting.length !== 1 || record === undefined) return undefined;
  return {
    phase: record.phase,
    worktreePath: record.worktree.path,
    submissionId: record.landing.submission_id,
  };
}

Deno.test("a renewed integration judgment is served, answered with accept --met, and the landing continues without author-side work", async () => {
  await withTempDir(async (dir) => {
    await withTempDir(async (scratch) => {
      const counter = join(scratch, "producer-runs");
      await judgmentFixture(dir, counter);
      const alpha = await effortFlippingRow(dir, "alpha");
      const beta = await effortFlippingRow(dir, "beta");

      // Both prove against the same trunk, each declaring its own judgment.
      assertEquals(
        (await runAgent(alpha, ["done", "--met", "record-review", "--json"]))
          .code,
        0,
      );
      assertEquals(
        (await runAgent(beta, ["done", "--met", "record-review", "--json"]))
          .code,
        0,
      );
      const authorRunsAfterProofs = await producerRuns(counter);
      const betaHead = await gitOut(beta, "rev-parse", "HEAD");
      const betaBranch = await gitOut(beta, "branch", "--show-current");
      assertEquals(
        (await runAgent(alpha, ["accept", "--confirmed", "--json"])).code,
        0,
      );
      const movedTip = await gitOut(dir, "rev-parse", "main");

      // Beta's landing composes; the independent alpha row moved the shared
      // file's state, so the checkpoint subject changed and the question is
      // served again — about the exact combined result, with a callable
      // continuation. This is a judgment stop, not an executed-check failure.
      const served = await runAgent(beta, ["accept", "--confirmed", "--json"]);
      assertEquals(served.code, 1, served.output);
      const refusal = decodeCliResult(served.stdout, "accept");
      assertEquals(refusal.error, "awaiting_declaration", served.output);
      assert(refusal.message !== undefined);
      assertStringIncludes(refusal.message, QUESTION);
      assertStringIncludes(refusal.message, "discern accept --met");
      assertStringIncludes(refusal.message, "record-review");

      // Nothing landed and the author's checkout is untouched; the frozen
      // submission still stands; the composition is retained for the answer.
      assertEquals(await gitOut(dir, "rev-parse", "main"), movedTip);
      assertEquals(await gitOut(beta, "rev-parse", "HEAD"), betaHead);
      assertEquals(await gitOut(beta, "status", "--porcelain"), "");
      assertEquals((await readSubmission(beta)).status, "submitted");
      const retained = await retainedRecord(dir);
      assert(retained !== undefined, "the composition is retained");
      assert(await targetExists(retained.worktreePath));

      // No gate producer ran for the judgment stop: the question is served
      // before any job, exactly as `done` serves it.
      assertEquals(await producerRuns(counter), authorRunsAfterProofs);

      // The queue names the awaited judgment and its continuation.
      const rows = await submissionRows(await Deno.realPath(dir), "main");
      assertEquals(rows.length, 1);
      const row = rows[0];
      assert(row !== undefined);
      assertEquals(row.readiness, "waiting");
      assert(row.reason !== undefined);
      assertStringIncludes(row.reason, "record-review");
      assertStringIncludes(row.reason, "discern accept --met");

      // The judgment answered in place continues the landing: the retained
      // composition is proven and lands, with no author-side update, no new
      // author Proof, and exactly one combined producer execution.
      const landed = await runAgent(beta, [
        "accept",
        "--met",
        "record-review",
        "--confirmed",
        "--json",
      ]);
      assertEquals(landed.code, 0, landed.output);
      const result = decodeCliResult(landed.stdout, "accept");
      assert(result.ok, landed.output);
      assert(result.message !== undefined);
      assertStringIncludes(
        result.message,
        `Landed ${betaBranch}'s submission ${betaHead.slice(0, 12)}, composed`,
      );
      const tip = await gitOut(dir, "rev-parse", "main");
      await git(dir, "merge-base", "--is-ancestor", betaHead, tip);
      await git(dir, "merge-base", "--is-ancestor", movedTip, tip);
      const landedRecord = await Deno.readTextFile(
        join(dir, "notes", "index.md"),
      );
      assertStringIncludes(landedRecord, "- alpha: complete");
      assertStringIncludes(landedRecord, "- beta: complete");
      assertEquals(
        await producerRuns(counter),
        authorRunsAfterProofs + 1,
        "one combined check proves the retained composition; the author re-ran nothing",
      );
      await assertNoIntegrationRemains(dir);
      assertEquals(await submissionRows(await Deno.realPath(dir), "main"), []);
    });
  });
});

Deno.test("an unmet integration judgment routes to the owner's variance, and the composition continues under it", async () => {
  await withTempDir(async (dir) => {
    await withTempDir(async (scratch) => {
      const counter = join(scratch, "producer-runs");
      await judgmentFixture(dir, counter);
      const alpha = await effortFlippingRow(dir, "alpha");
      const beta = await effortFlippingRow(dir, "beta");
      assertEquals(
        (await runAgent(alpha, ["done", "--met", "record-review", "--json"]))
          .code,
        0,
      );
      assertEquals(
        (await runAgent(beta, ["done", "--met", "record-review", "--json"]))
          .code,
        0,
      );
      assertEquals(
        (await runAgent(alpha, ["accept", "--confirmed", "--json"])).code,
        0,
      );
      assertEquals(
        (await runAgent(beta, ["accept", "--confirmed", "--json"])).code,
        1,
      );

      // The agent judges the combined result and concludes the question does
      // not hold: the gate still proves the composition, and the landing then
      // waits for the owner's variance — recorded grants never cover it.
      const declared = await runAgent(beta, [
        "accept",
        "--unmet",
        "record-review",
        "--why",
        "The combined record reorders rows; a follow-up restores the index.",
        "--confirmed",
        "--json",
      ]);
      assertEquals(declared.code, 1, declared.output);
      const varianceStop = decodeCliResult(declared.stdout, "accept");
      assertEquals(varianceStop.error, "awaiting_variance", declared.output);
      assert(varianceStop.message !== undefined);
      assertStringIncludes(varianceStop.message, "record-review");
      assertStringIncludes(
        varianceStop.message,
        "--confirmed --variance record-review",
      );
      const retained = await retainedRecord(dir);
      assert(retained !== undefined, "the proven composition is retained");

      // The owner's complete decision lands the retained composition.
      const landed = await runAgent(beta, [
        "accept",
        "--confirmed",
        "--variance",
        "record-review",
        "--json",
      ]);
      assertEquals(landed.code, 0, landed.output);
      const result = decodeCliResult(landed.stdout, "accept");
      assert(result.ok, landed.output);
      assert(result.data !== undefined && !("issues" in result.data));
      const variances = result.data.variances;
      assert(variances !== undefined && variances.length === 1);
      assertEquals(variances[0]?.checkpoint, "record-review");
      await assertNoIntegrationRemains(dir);
    });
  });
});

Deno.test("a composition that changed while its judgment waited is discarded: the answer never transfers, and a fresh question is served", async () => {
  await withTempDir(async (dir) => {
    await withTempDir(async (scratch) => {
      const counter = join(scratch, "producer-runs");
      await judgmentFixture(dir, counter);
      const alpha = await effortFlippingRow(dir, "alpha");
      const beta = await effortFlippingRow(dir, "beta");
      const gamma = await addWorktree(dir, "gamma");
      await Deno.writeTextFile(join(gamma, "gamma.txt"), "gamma\n");
      await git(gamma, "add", "-A");
      await git(gamma, "commit", "-q", "-m", "feat: gamma", "--no-gpg-sign");

      assertEquals(
        (await runAgent(alpha, ["done", "--met", "record-review", "--json"]))
          .code,
        0,
      );
      assertEquals(
        (await runAgent(beta, ["done", "--met", "record-review", "--json"]))
          .code,
        0,
      );
      assertEquals((await runAgent(gamma, ["done", "--json"])).code, 0);
      assertEquals(
        (await runAgent(alpha, ["accept", "--confirmed", "--json"])).code,
        0,
      );
      assertEquals(
        (await runAgent(beta, ["accept", "--confirmed", "--json"])).code,
        1,
        "beta's judgment is served and its composition retained",
      );
      const firstRetained = await retainedRecord(dir);
      assert(firstRetained !== undefined);

      // While beta's judgment waits, a sibling lands freely: the wait holds
      // no lock. Its landing moves the trunk past beta's retained composition.
      assertEquals(
        (await runAgent(gamma, ["accept", "--confirmed", "--json"])).code,
        0,
        "a sibling lands while the judgment waits",
      );

      // The answered judgment binds to the composition that was served; that
      // composition is stale now, so the answer is refused, the stale copy is
      // discarded, and a fresh accept serves the question about the new
      // composition.
      const stale = await runAgent(beta, [
        "accept",
        "--met",
        "record-review",
        "--confirmed",
        "--json",
      ]);
      assertEquals(stale.code, 1, stale.output);
      const staleResult = decodeCliResult(stale.stdout, "accept");
      assert(staleResult.message !== undefined);
      assertStringIncludes(staleResult.message, "discern accept");
      assertEquals(
        await targetExists(firstRetained.worktreePath),
        false,
        "the stale composition is discarded, not answered",
      );

      const reserved = await runAgent(beta, [
        "accept",
        "--confirmed",
        "--json",
      ]);
      assertEquals(reserved.code, 1, reserved.output);
      const reservedResult = decodeCliResult(reserved.stdout, "accept");
      assertEquals(reservedResult.error, "awaiting_declaration");
      const secondRetained = await retainedRecord(dir);
      assert(secondRetained !== undefined);
      assert(secondRetained.worktreePath !== firstRetained.worktreePath);

      // Answering the freshly served question lands the current composition.
      const landed = await runAgent(beta, [
        "accept",
        "--met",
        "record-review",
        "--confirmed",
        "--json",
      ]);
      assertEquals(landed.code, 0, landed.output);
      await assertNoIntegrationRemains(dir);
      assertEquals(
        await producerRuns(counter),
        3 + 1 + 1,
        [
          "three author proofs, one discarded-composition producer never ran",
          "(both judgment stops fire before jobs), one combined check per",
          "landed composition: gamma landed direct off its own proof.",
        ].join(" "),
      );
    });
  });
});

Deno.test("declarations without an awaited integration judgment are refused, and a direct landing never consumes them", async () => {
  await withTempDir(async (dir) => {
    await withTempDir(async (scratch) => {
      const counter = join(scratch, "producer-runs");
      await judgmentFixture(dir, counter);
      const alpha = await effortFlippingRow(dir, "alpha");
      assertEquals(
        (await runAgent(alpha, ["done", "--met", "record-review", "--json"]))
          .code,
        0,
      );
      const refused = await runAgent(alpha, [
        "accept",
        "--met",
        "record-review",
        "--confirmed",
        "--json",
      ]);
      assertEquals(refused.code, 1, refused.output);
      const result = decodeCliResult(refused.stdout, "accept");
      assertEquals(result.error, "invalid_value");
      assert(result.message !== undefined);
      assertStringIncludes(result.message, "no integration judgment");
      // The refusal changed nothing: the ordinary direct landing follows.
      assertEquals(
        (await runAgent(alpha, ["accept", "--confirmed", "--json"])).code,
        0,
      );
    });
  });
});

Deno.test("a replacement submission supersedes the retained composition: the author's rebuilt work lands directly and the stale copy is discarded", async () => {
  await withTempDir(async (dir) => {
    await withTempDir(async (scratch) => {
      const counter = join(scratch, "producer-runs");
      await judgmentFixture(dir, counter);
      const alpha = await effortFlippingRow(dir, "alpha");
      const beta = await effortFlippingRow(dir, "beta");
      assertEquals(
        (await runAgent(alpha, ["done", "--met", "record-review", "--json"]))
          .code,
        0,
      );
      assertEquals(
        (await runAgent(beta, ["done", "--met", "record-review", "--json"]))
          .code,
        0,
      );
      assertEquals(
        (await runAgent(alpha, ["accept", "--confirmed", "--json"])).code,
        0,
      );
      assertEquals(
        (await runAgent(beta, ["accept", "--confirmed", "--json"])).code,
        1,
        "beta's judgment is served and its composition retained",
      );
      const retained = await retainedRecord(dir);
      assert(retained !== undefined);

      // The author chooses the manual route instead of answering: update,
      // add more work, and prove the rebuilt tree. The renewed author-side
      // question is served by done, exactly as before.
      assertEquals((await runAgent(beta, ["update", "--json"])).code, 0);
      const updated = await gitOut(beta, "status", "--porcelain");
      assertEquals(updated, "", "update leaves a committed tree");
      await Deno.writeTextFile(join(beta, "beta-extra.txt"), "more\n");
      await git(beta, "add", "-A");
      await git(beta, "commit", "-q", "-m", "more work", "--no-gpg-sign");
      assertEquals(
        (await runAgent(beta, ["done", "--met", "record-review", "--json"]))
          .code,
        0,
      );

      // The replacement submission contains the trunk, so it lands directly —
      // and the superseded retained composition is discarded with it, not
      // left behind for prune.
      const landed = await runAgent(beta, ["accept", "--confirmed", "--json"]);
      assertEquals(landed.code, 0, landed.output);
      const result = decodeCliResult(landed.stdout, "accept");
      assert(result.ok, landed.output);
      assertEquals(await targetExists(retained.worktreePath), false);
      await assertNoIntegrationRemains(dir);
      const record = await Deno.readTextFile(join(dir, "notes", "index.md"));
      assertStringIncludes(record, "- alpha: complete");
      assertStringIncludes(record, "- beta: complete");
      assert(await targetExists(join(dir, "beta-extra.txt")));
    });
  });
});
