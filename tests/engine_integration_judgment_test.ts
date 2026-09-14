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
import { readOpenQuestions } from "../src/engine/checkpoints/open_questions.ts";
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
    readonly id: string;
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
    id: record.id,
    phase: record.phase,
    worktreePath: record.worktree.path,
    submissionId: record.landing.submission_id,
  };
}

Deno.test("a variance receipt cannot follow a recomposition even when the unmet subject is unchanged", async () => {
  await withTempDir(async (dir) => {
    await withTempDir(async (scratch) => {
      const counter = join(scratch, "runs");
      await judgmentFixture(dir, counter);
      const beta = await effortFlippingRow(dir, "beta");
      const done = await runAgent(beta, [
        "done",
        "--unmet",
        "record-review",
        "--why",
        "The record needs a follow-up.",
        "--json",
      ]);
      assertEquals(done.code, 0, done.output);
      const advance = async (name: string): Promise<void> => {
        const sibling = await addWorktree(dir, name);
        await Deno.writeTextFile(join(sibling, `${name}.txt`), `${name}\n`);
        await git(sibling, "add", "-A");
        await git(sibling, "commit", "-q", "-m", name, "--no-gpg-sign");
        assertEquals((await runAgent(sibling, ["done", "--json"])).code, 0);
        assertEquals(
          (await runAgent(sibling, ["accept", "--confirmed", "--json"])).code,
          0,
        );
      };
      await advance("alpha");
      const first = await runAgent(beta, ["accept", "--confirmed", "--json"]);
      assertEquals(
        decodeCliResult(first.stdout, "accept").error,
        "awaiting_variance",
        first.output,
      );
      const served = await retainedRecord(dir);
      assert(served !== undefined);
      await advance("gamma");
      const trunk = await gitOut(dir, "rev-parse", "main");
      const runs = await producerRuns(counter);
      const stale = await runAgent(beta, [
        "accept",
        "--confirmed",
        "--variance",
        "record-review",
        "--composition",
        served.id,
        "--json",
      ]);
      assertEquals(stale.code, 1, stale.output);
      assertEquals(
        decodeCliResult(stale.stdout, "accept").error,
        "precondition_failed",
      );
      assertEquals(await gitOut(dir, "rev-parse", "main"), trunk);
      assertEquals(
        await producerRuns(counter),
        runs,
        "a stale receipt never starts another combined check",
      );
      const fresh = await runAgent(beta, ["accept", "--confirmed", "--json"]);
      assertEquals(
        decodeCliResult(fresh.stdout, "accept").error,
        "awaiting_variance",
        fresh.output,
      );
      const replacement = await retainedRecord(dir);
      assert(replacement !== undefined && replacement.id !== served.id);
      // Move the trunk at the compare-and-swap itself, after the receipt has
      // been adopted. The bounded retry must not carry this decision either.
      const shim = join(scratch, "move-at-publication.sh");
      const moved = join(scratch, "moved-at-publication");
      await Deno.writeTextFile(
        shim,
        [
          "#!/bin/sh",
          'for arg in "$@"; do',
          '  if [ "$arg" = "--stdin" ]; then',
          "    payload=$(cat)",
          '    case "$payload" in *"update refs/heads/main "*)',
          `      if [ ! -e "${moved}" ]; then`,
          `        git -C "${await Deno.realPath(
            dir,
          )}" commit -q --allow-empty -m outside --no-gpg-sign || exit 1`,
          `        touch "${moved}"`,
          "      fi ;;",
          "    esac",
          '    printf "%s\\n" "$payload" | git "$@"',
          "    exit $?",
          "  fi",
          "done",
          'exec git "$@"',
          "",
        ].join("\n"),
        { mode: 0o700 },
      );
      const checkedRuns = await producerRuns(counter);
      const raced = await runAgent(beta, [
        "accept",
        "--confirmed",
        "--variance",
        "record-review",
        "--composition",
        replacement.id,
        "--json",
      ], { env: { GIT_BIN: shim } });
      assertEquals(raced.code, 1, raced.output);
      assertEquals(
        decodeCliResult(raced.stdout, "accept").error,
        "precondition_failed",
      );
      assert(await targetExists(moved), "the trunk moved at publication");
      assertEquals(
        await producerRuns(counter),
        checkedRuns,
        "a receipt never starts the bounded recomposition",
      );
      await assertNoIntegrationRemains(dir);
      const reServed = await runAgent(beta, [
        "accept",
        "--confirmed",
        "--json",
      ]);
      assertEquals(
        decodeCliResult(reServed.stdout, "accept").error,
        "awaiting_variance",
        reServed.output,
      );
      const current = await retainedRecord(dir);
      assert(current !== undefined && current.id !== replacement.id);
      const landed = await runAgent(beta, [
        "accept",
        "--confirmed",
        "--variance",
        "record-review",
        "--composition",
        current.id,
        "--json",
      ]);
      assertEquals(landed.code, 0, landed.output);
      await assertNoIntegrationRemains(dir);
    });
  });
});

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
      // Direct-landing refusals retain the proved revision and its judgments.
      const directTip = await gitOut(dir, "rev-parse", "main");
      const alphaHead = await gitOut(alpha, "rev-parse", "HEAD");
      const directQuestions = await readOpenQuestions(alpha);
      assertEquals(directQuestions.status, "ok");
      const refused = await runAgent(alpha, [
        "accept",
        "--met",
        "record-review",
        "--confirmed",
        "--json",
      ]);
      assertEquals(refused.code, 1, refused.output);
      const directResult = decodeCliResult(refused.stdout, "accept");
      assertEquals(directResult.error, "invalid_value");
      assert(directResult.message !== undefined);
      assertStringIncludes(directResult.message, "no integration judgment");
      // Accept freezes the submission before rejecting the declaration.
      // Later refusals preserve that same submission as well as the proof state.
      const directSubmission = await readSubmission(alpha);
      assert(directSubmission.status === "submitted");
      assertEquals(directSubmission.submission.head, alphaHead);
      const assertDirectState = async (): Promise<void> => {
        assertEquals(await gitOut(dir, "rev-parse", "main"), directTip);
        assertEquals(await gitOut(alpha, "rev-parse", "HEAD"), alphaHead);
        assertEquals(await readSubmission(alpha), directSubmission);
        assertEquals(await readOpenQuestions(alpha), directQuestions);
        assertEquals(await producerRuns(counter), authorRunsAfterProofs);
        await assertNoIntegrationRemains(dir);
      };
      await assertDirectState();
      // A bare receipt is refused the same way, and a receipt without any
      // decision to bind is an argument error before anything runs.
      assertEquals(
        (await runAgent(alpha, [
          "accept",
          "--met",
          "record-review",
          "--composition",
          "0000",
          "--confirmed",
          "--json",
        ])).code,
        1,
      );
      await assertDirectState();
      const dangling = await runAgent(alpha, [
        "accept",
        "--composition",
        "0000",
        "--confirmed",
        "--json",
      ]);
      assertEquals(dangling.code, 1, dangling.output);
      assertEquals(
        decodeCliResult(dangling.stdout, "accept").error,
        "invalid_arguments",
      );
      await assertDirectState();

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
      const servedRecord = await retainedRecord(dir);
      assert(servedRecord !== undefined);
      // The serving carries the composition receipt, in the message's exact
      // continuation commands and machine-readably in the data block.
      assertStringIncludes(
        refusal.message,
        `--composition ${servedRecord.id}`,
      );
      assert(refusal.data !== undefined && !("issues" in refusal.data));
      assertEquals(refusal.data.integration_judgment, {
        composition: servedRecord.id,
        decision: "declaration",
        awaiting: ["record-review"],
      });

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

      // The queue names the awaited judgment and routes through the serving
      // moment — an arriving agent has not been served, so it never suggests
      // answering blind.
      const rows = await submissionRows(await Deno.realPath(dir), "main");
      assertEquals(rows.length, 1);
      const row = rows[0];
      assert(row !== undefined);
      assertEquals(row.readiness, "waiting");
      assert(row.reason !== undefined);
      assertStringIncludes(row.reason, "record-review");
      assertStringIncludes(
        row.reason,
        "run discern accept from its worktree to be served",
      );

      // An answer without its receipt is refused unrecorded: answers bind to
      // the composition that served them.
      const unbound = await runAgent(beta, [
        "accept",
        "--met",
        "record-review",
        "--confirmed",
        "--json",
      ]);
      assertEquals(unbound.code, 1, unbound.output);
      const unboundResult = decodeCliResult(unbound.stdout, "accept");
      assertEquals(unboundResult.error, "invalid_value");
      assert(unboundResult.message !== undefined);
      assertStringIncludes(unboundResult.message, "--composition");

      // The judgment answered in place continues the landing: the retained
      // composition is proven and lands, with no author-side update, no new
      // author Proof, and exactly one combined producer execution.
      const landed = await runAgent(beta, [
        "accept",
        "--met",
        "record-review",
        "--composition",
        servedRecord.id,
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

      const servedRecord = await retainedRecord(dir);
      assert(servedRecord !== undefined);

      // The agent judges the combined result and concludes the question does
      // not hold: the gate still proves the composition, and the landing then
      // waits for the owner's variance — recorded grants never cover it.
      const declared = await runAgent(beta, [
        "accept",
        "--unmet",
        "record-review",
        "--why",
        "The combined record reorders rows; a follow-up restores the index.",
        "--composition",
        servedRecord.id,
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
        `--confirmed --variance record-review --composition ${servedRecord.id}`,
      );
      assert(
        varianceStop.data !== undefined && !("issues" in varianceStop.data),
      );
      assertEquals(varianceStop.data.integration_judgment, {
        composition: servedRecord.id,
        decision: "variance",
        awaiting: ["record-review"],
      });
      const retained = await retainedRecord(dir);
      assert(retained !== undefined, "the proven composition is retained");

      // The owner's decision binds through the served receipt: without it,
      // the confirmation cannot be shown to cover THIS composition, and the
      // decision moment is re-served instead of inherited.
      const unbound = await runAgent(beta, [
        "accept",
        "--confirmed",
        "--variance",
        "record-review",
        "--json",
      ]);
      assertEquals(unbound.code, 1, unbound.output);
      const unboundResult = decodeCliResult(unbound.stdout, "accept");
      assertEquals(unboundResult.error, "awaiting_variance");
      assert(unboundResult.message !== undefined);
      assertStringIncludes(unboundResult.message, "--composition");

      // The owner's complete, receipt-bound decision lands the retained
      // composition.
      const landed = await runAgent(beta, [
        "accept",
        "--confirmed",
        "--variance",
        "record-review",
        "--composition",
        servedRecord.id,
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

Deno.test("prune preserves a retained composition while its submission stands and reclaims it once the effort is gone", async () => {
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
      const retained = await retainedRecord(dir);
      assert(retained !== undefined);

      // The retained composition is deliberate state, not an interrupted
      // landing: prune preserves it while the exact submission it composes
      // still stands — and the author, whose commits necessarily ride inside
      // the retained integration branch, is never offered as a spent
      // contained stage because of it.
      const kept = await runAgent(dir, ["worktree", "prune", "--json"]);
      assertEquals(kept.code, 0, kept.output);
      const keptResult = decodeCliResult(kept.stdout, "worktree prune");
      assert(
        (keptResult.steps ?? []).every((step) =>
          !(step.note ?? "").includes("contained in integration/")
        ),
        kept.stdout,
      );
      assert(await targetExists(retained.worktreePath));
      const preserved = await retainedRecord(dir);
      assert(preserved !== undefined);

      // Once the effort is gone — its worktree dropped, submission and all —
      // nothing can answer the question, and prune reclaims the copy.
      const betaBranch = await gitOut(beta, "branch", "--show-current");
      const dropped = await runAgent(dir, [
        "worktree",
        "drop",
        betaBranch,
        "--force",
        "--json",
      ]);
      assertEquals(dropped.code, 0, dropped.output);
      const reclaimed = await runAgent(dir, [
        "worktree",
        "prune",
        "--yes",
        "--json",
      ]);
      assertEquals(reclaimed.code, 0, reclaimed.output);
      assertEquals(await targetExists(retained.worktreePath), false);
      await assertNoIntegrationRemains(dir);
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

Deno.test("stale answers before and after replacement serving never approve another composition", async () => {
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
        "beta's first composition is served and retained",
      );
      const reviewed = await retainedRecord(dir);
      assert(reviewed !== undefined);

      // While the answer is being prepared, a sibling materially changes the
      // judged file and lands, and a second call for the same effort (a
      // retry, or another session) replaces the stale composition — the SAME
      // checkpoint id now asks about materially different content.
      const gamma = await addWorktree(dir, "gamma");
      const gammaRecord = join(gamma, "notes", "index.md");
      await Deno.writeTextFile(
        gammaRecord,
        (await Deno.readTextFile(gammaRecord)).replace(
          "- alpha: complete",
          "- alpha: deferred pending removal",
        ),
      );
      await git(gamma, "add", "-A");
      await git(gamma, "commit", "-q", "-m", "revise", "--no-gpg-sign");
      assertEquals(
        (await runAgent(gamma, ["done", "--met", "record-review", "--json"]))
          .code,
        0,
      );
      assertEquals(
        (await runAgent(gamma, ["accept", "--confirmed", "--json"])).code,
        0,
      );
      assertEquals(
        (await runAgent(beta, ["accept", "--confirmed", "--json"])).code,
        1,
        "the replacement composition is served and retained",
      );
      const replacement = await retainedRecord(dir);
      assert(replacement !== undefined);
      assert(replacement.id !== reviewed.id);

      // The answer prepared for the first composition arrives — with its
      // receipt, and without one. Neither records anything or lands.
      const trunkBefore = await gitOut(dir, "rev-parse", "main");
      const authorHead = await gitOut(beta, "rev-parse", "HEAD");
      const submission = await readSubmission(beta);
      const questions = await readOpenQuestions(replacement.worktreePath);
      assertEquals(questions.status, "ok");
      const runsBefore = await producerRuns(counter);
      const assertReplacementPreserved = async (): Promise<void> => {
        assertEquals(await gitOut(dir, "rev-parse", "main"), trunkBefore);
        assertEquals(await gitOut(beta, "rev-parse", "HEAD"), authorHead);
        assertEquals(await readSubmission(beta), submission);
        assertEquals(await retainedRecord(dir), replacement);
        assertEquals(
          await readOpenQuestions(replacement.worktreePath),
          questions,
        );
        assertEquals(await producerRuns(counter), runsBefore);
      };
      const stale = await runAgent(beta, [
        "accept",
        "--met",
        "record-review",
        "--composition",
        reviewed.id,
        "--confirmed",
        "--json",
      ]);
      assertEquals(stale.code, 1, stale.output);
      assertEquals(
        decodeCliResult(stale.stdout, "accept").error,
        "precondition_failed",
      );
      await assertReplacementPreserved();
      const unreceipted = await runAgent(beta, [
        "accept",
        "--met",
        "record-review",
        "--confirmed",
        "--json",
      ]);
      assertEquals(unreceipted.code, 1, unreceipted.output);
      assertEquals(
        decodeCliResult(unreceipted.stdout, "accept").error,
        "invalid_value",
      );
      await assertReplacementPreserved();

      // A later sibling moves the trunk again. This time the answer arrives
      // BEFORE a replacement has been served, exercising stale-copy disposal.
      const delta = await addWorktree(dir, "delta");
      await Deno.writeTextFile(join(delta, "delta.txt"), "delta\n");
      await git(delta, "add", "-A");
      await git(delta, "commit", "-q", "-m", "delta", "--no-gpg-sign");
      assertEquals((await runAgent(delta, ["done", "--json"])).code, 0);
      assertEquals(
        (await runAgent(delta, ["accept", "--confirmed", "--json"])).code,
        0,
        "a sibling lands while the judgment waits",
      );
      const advancedTip = await gitOut(dir, "rev-parse", "main");

      // The answered judgment binds to the composition that was served; that
      // composition is stale now, so the answer is refused, the stale copy is
      // discarded, and a fresh accept serves the question about the new
      // composition.
      const early = await runAgent(beta, [
        "accept",
        "--met",
        "record-review",
        "--composition",
        replacement.id,
        "--confirmed",
        "--json",
      ]);
      assertEquals(early.code, 1, early.output);
      const earlyResult = decodeCliResult(early.stdout, "accept");
      assertEquals(earlyResult.error, "precondition_failed");
      assert(earlyResult.message !== undefined);
      assertStringIncludes(earlyResult.message, "discern accept");
      assertEquals(
        await targetExists(replacement.worktreePath),
        false,
        "the stale composition is discarded, not answered",
      );

      assertEquals(await gitOut(dir, "rev-parse", "main"), advancedTip);
      assertEquals(await readSubmission(beta), submission);
      assertEquals(await producerRuns(counter), runsBefore + 1);

      const reserved = await runAgent(beta, [
        "accept",
        "--confirmed",
        "--json",
      ]);
      assertEquals(reserved.code, 1, reserved.output);
      const reservedResult = decodeCliResult(reserved.stdout, "accept");
      assertEquals(reservedResult.error, "awaiting_declaration");
      const fresh = await retainedRecord(dir);
      assert(fresh !== undefined);
      assert(fresh.worktreePath !== replacement.worktreePath);
      assert(fresh.id !== replacement.id);

      const freshQuestions = await readOpenQuestions(fresh.worktreePath);
      assertEquals(freshQuestions.status, "ok");

      // The discarded composition's receipt never answers the new one.
      const transferred = await runAgent(beta, [
        "accept",
        "--met",
        "record-review",
        "--composition",
        replacement.id,
        "--confirmed",
        "--json",
      ]);
      assertEquals(transferred.code, 1, transferred.output);
      const transferredResult = decodeCliResult(transferred.stdout, "accept");
      assertEquals(transferredResult.error, "precondition_failed");
      assert(transferredResult.message !== undefined);
      assertStringIncludes(transferredResult.message, "no longer retained");

      assertEquals(await gitOut(dir, "rev-parse", "main"), advancedTip);
      assertEquals(await readSubmission(beta), submission);
      assertEquals(await retainedRecord(dir), fresh);
      assertEquals(await readOpenQuestions(fresh.worktreePath), freshQuestions);
      assertEquals(await producerRuns(counter), runsBefore + 1);

      // Judging the replacement itself — with its own receipt — lands it.
      const landed = await runAgent(beta, [
        "accept",
        "--met",
        "record-review",
        "--composition",
        fresh.id,
        "--confirmed",
        "--json",
      ]);
      assertEquals(landed.code, 0, landed.output);
      await assertNoIntegrationRemains(dir);
      assertEquals(
        await producerRuns(counter),
        5,
        "four author proofs and one final combined check; judgment stops run no jobs",
      );
    });
  });
});

Deno.test("a superseded composition whose cleanup fails blocks replacement: one continuation, the failures reported, prune reclaiming what nothing can answer", async () => {
  await withTempDir(async (dir) => {
    await withTempDir(async (scratch) => {
      const counter = join(scratch, "producer-runs");
      await judgmentFixture(dir, counter);
      // One per-worktree resource whose destroy fails while the flag file
      // exists — the deterministic stand-in for external teardown failure.
      await writeConfig(
        dir,
        config() +
          [
            "[worktree.resources.thing]",
            'create = ":"',
            `destroy = 'sh -c "test ! -f ${scratch}/fail"'`,
            "",
          ].join("\n"),
      );
      assertEquals((await runAgent(dir, ["refresh", "--json"])).code, 0);
      await git(dir, "add", "-A");
      if ((await gitOut(dir, "status", "--porcelain")) !== "") {
        await git(dir, "commit", "-q", "-m", "resource", "--no-gpg-sign");
      }
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
        "beta's composition is served and retained",
      );
      const retained = await retainedRecord(dir);
      assert(retained !== undefined);

      // Another landing supersedes the retained composition; its teardown is
      // then made to fail.
      const gamma = await addWorktree(dir, "gamma");
      await Deno.writeTextFile(join(gamma, "gamma.txt"), "gamma\n");
      await git(gamma, "add", "-A");
      await git(gamma, "commit", "-q", "-m", "gamma", "--no-gpg-sign");
      assertEquals((await runAgent(gamma, ["done", "--json"])).code, 0);
      assertEquals(
        (await runAgent(gamma, ["accept", "--confirmed", "--json"])).code,
        0,
      );
      await Deno.writeTextFile(join(scratch, "fail"), "block teardown\n");

      // Replacement waits for settled cleanup: the failure is the result,
      // and no second retained composition appears.
      const blocked = await runAgent(beta, ["accept", "--confirmed", "--json"]);
      assertEquals(blocked.code, 1, blocked.output);
      const blockedResult = decodeCliResult(blocked.stdout, "accept");
      assertEquals(blockedResult.error, "precondition_failed", blocked.output);
      assert(blockedResult.message !== undefined);
      assertStringIncludes(blockedResult.message, "cleanup did not finish");
      assertStringIncludes(blockedResult.message, "discern worktree prune");
      const records = (await listIntegrationLandingRecords(
        await Deno.realPath(dir),
      )).filter((entry) => entry.reading.status === "recorded");
      assertEquals(records.length, 1, blocked.output);
      const survivor = records[0];
      assert(
        survivor !== undefined && survivor.reading.status === "recorded" &&
          survivor.reading.record.id === retained.id,
        "the superseded record stays the single continuation",
      );

      // Its copy is already gone, so nothing can answer it: once the owner
      // fixes the destroy command, prune reclaims it even though the
      // submission still stands.
      await Deno.remove(join(scratch, "fail"));
      const pruned = await runAgent(dir, [
        "worktree",
        "prune",
        "--yes",
        "--json",
      ]);
      assertEquals(pruned.code, 0, pruned.output);
      assertEquals(
        (await listIntegrationLandingRecords(await Deno.realPath(dir)))
          .length,
        0,
        pruned.output,
      );

      // With the store settled and teardown healthy again, acceptance serves
      // a fresh composition and its answer lands.
      const reserved = await runAgent(beta, [
        "accept",
        "--confirmed",
        "--json",
      ]);
      assertEquals(reserved.code, 1, reserved.output);
      assertEquals(
        decodeCliResult(reserved.stdout, "accept").error,
        "awaiting_declaration",
      );
      const fresh = await retainedRecord(dir);
      assert(fresh !== undefined);
      assert(fresh.id !== retained.id);
      const landed = await runAgent(beta, [
        "accept",
        "--met",
        "record-review",
        "--composition",
        fresh.id,
        "--confirmed",
        "--json",
      ]);
      assertEquals(landed.code, 0, landed.output);
      await assertNoIntegrationRemains(dir);
    });
  });
});
