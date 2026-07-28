/**
 * Landing receipt notes: durable local recording, fetch-only opt-in transport,
 * authorship, divergence repair, and the post-fast-forward fail-open boundary.
 */

import { assert, assertEquals } from "@std/assert";
import { join } from "@std/path";
import { DISCERN_BOT } from "../src/shared/brand.ts";
import { DISCERN_NO_ATTRIBUTION } from "../src/shared/env.ts";
import { HINTS } from "../src/shared/hints.ts";
import type { DiscernResult } from "../src/shared/result.ts";
import {
  type AcceptData,
  type GateData,
  type Receipt,
  ReceiptSchema,
} from "../src/shared/result_schemas.ts";
import { runGit } from "../src/shared/subprocess.ts";
import {
  canonicalReceiptNote,
  RECEIPT_NOTES_REF,
  writeReceiptNote,
} from "../src/engine/gate/receipt_notes.ts";
import { inspectGateReceipt } from "../src/engine/gate/receipt.ts";
import { assertHasHint, assertLacksHint } from "./hint_asserts.ts";
import {
  addWorktree,
  git,
  gitInit,
  gitOut,
  runAgent,
  scaffoldEngine,
  writeConfig,
} from "./engine_helpers.ts";
import { withTempDir } from "./helpers.ts";

function receiptConfig(mode: "local" | "fetch"): string {
  return [
    "[project]",
    'slug = "engine-test"',
    "",
    "[repository]",
    'trunk = "main"',
    `receipt_notes = "${mode}"`,
    "",
    "[guidance]",
    "agents = []",
    "sources = []",
    "",
  ].join("\n");
}

interface Landing {
  readonly target: string;
  readonly receipt: Receipt;
  readonly result: DiscernResult<AcceptData>;
}

async function land(
  main: string,
  name: string,
  env: Record<string, string> = {},
): Promise<Landing> {
  const worktree = await addWorktree(main, name);
  await Deno.writeTextFile(join(worktree, `${name}.txt`), `${name}\n`);
  await git(worktree, "add", "-A");
  await git(
    worktree,
    "commit",
    "-q",
    "-m",
    `Add ${name}`,
    "--no-gpg-sign",
  );
  const target = await gitOut(worktree, "rev-parse", "HEAD");
  const done = await runAgent(worktree, ["done", "--json"]);
  assertEquals(done.code, 0, done.output);
  const doneResult = JSON.parse(done.stdout) as DiscernResult<GateData>;
  const receipt = ReceiptSchema.parse(doneResult.data?.receipt);
  const marker = await inspectGateReceipt(worktree);
  assertEquals(marker.receipt_data, receipt);

  const accepted = await runAgent(
    worktree,
    ["accept", "--confirmed", "--json"],
    { env },
  );
  assertEquals(accepted.code, 0, accepted.output);
  const result = JSON.parse(accepted.stdout) as DiscernResult<AcceptData>;
  assertEquals(result.ok, true, accepted.output);
  return { target, receipt, result };
}

async function noteAt(root: string, commit: string): Promise<Receipt> {
  const content = await gitOut(
    root,
    "notes",
    "--ref=discern",
    "show",
    commit,
  );
  return ReceiptSchema.parse(JSON.parse(content));
}

async function notesIdentity(root: string, ref = RECEIPT_NOTES_REF): Promise<
  string[]
> {
  return (await gitOut(
    root,
    "show",
    "-s",
    "--format=%an%x00%ae%x00%cn%x00%ce",
    ref,
  )).split("\0");
}

Deno.test("accept records matching receipt notes, status reads them, and later landings preserve earlier notes", async () => {
  await withTempDir(async (dir) => {
    await scaffoldEngine(dir);
    await writeConfig(dir, receiptConfig("local"));
    await gitInit(dir);

    const first = await land(dir, "first");
    assertEquals(first.result.data?.receipt_note?.fetch.status, "local");
    assertEquals(first.result.data?.receipt_note?.write.status, "recorded");
    assertEquals(await noteAt(dir, first.target), first.receipt);
    assertEquals(await notesIdentity(dir), [
      DISCERN_BOT.name,
      DISCERN_BOT.email,
      DISCERN_BOT.name,
      DISCERN_BOT.email,
    ]);
    assertLacksHint(first.result, HINTS["accept-publish-receipt-note"]);
    const firstNotesTip = await gitOut(dir, "rev-parse", RECEIPT_NOTES_REF);

    const second = await land(dir, "second", {
      [DISCERN_NO_ATTRIBUTION]: "1",
    });
    assertEquals(await noteAt(dir, first.target), first.receipt);
    assertEquals(await noteAt(dir, second.target), second.receipt);
    assertEquals(await notesIdentity(dir, firstNotesTip), [
      DISCERN_BOT.name,
      DISCERN_BOT.email,
      DISCERN_BOT.name,
      DISCERN_BOT.email,
    ]);
    assertEquals(await notesIdentity(dir), [
      "Engine Test",
      "engine-test@example.com",
      "Engine Test",
      "engine-test@example.com",
    ]);

    const status = await runAgent(dir, ["status", "--json"]);
    assertEquals(status.code, 0, status.output);
    const statusResult = JSON.parse(status.stdout);
    assertEquals(statusResult.data.landed_receipt, {
      commit: second.target,
      ref: RECEIPT_NOTES_REF,
      receipt: second.receipt,
    });
  });
});

Deno.test("receipt-note transport is opt-in, fetch-only, managed, and leaves plain push unchanged", async () => {
  await withTempDir(async (dir) => {
    await scaffoldEngine(dir);
    await writeConfig(dir, receiptConfig("local"));
    await gitInit(dir);
    const remote = join(dir, "remote.git");
    await git(dir, "init", "--bare", remote);
    await git(dir, "remote", "add", "origin", remote);
    await git(dir, "push", "-u", "origin", "main");

    const configBefore = await Deno.readTextFile(join(dir, ".git", "config"));
    const localRefresh = await runAgent(dir, ["refresh", "--json"]);
    assertEquals(localRefresh.code, 0, localRefresh.output);
    assertEquals(
      await Deno.readTextFile(join(dir, ".git", "config")),
      configBefore,
      "an install that never opts in must not change Git transport config",
    );

    const localLanding = await land(dir, "local-remote");
    assertLacksHint(
      localLanding.result,
      HINTS["accept-publish-receipt-note"],
    );
    const localFetches = await gitOut(
      dir,
      "config",
      "--local",
      "--get-all",
      "remote.origin.fetch",
    );
    assertEquals(localFetches.includes("refs/notes/discern"), false);

    await writeConfig(dir, receiptConfig("fetch"));
    await git(dir, "add", "discern.toml");
    await git(
      dir,
      "commit",
      "-q",
      "-m",
      "Enable receipt fetch",
      "--no-gpg-sign",
    );
    const wired = await runAgent(dir, ["refresh", "--json"]);
    assertEquals(wired.code, 0, wired.output);
    const wiredAgain = await runAgent(dir, ["refresh", "--json"]);
    assertEquals(wiredAgain.code, 0, wiredAgain.output);
    const fetches = (await gitOut(
      dir,
      "config",
      "--local",
      "--get-all",
      "remote.origin.fetch",
    )).split("\n");
    const receiptMapping =
      "+refs/notes/discern:refs/discern/remotes/origin/notes";
    assertEquals(fetches.filter((value) => value === receiptMapping).length, 1);
    const pushConfig = await runGit(
      ["config", "--local", "--get-all", "remote.origin.push"],
      { cwd: dir },
    );
    assertEquals(pushConfig.success, false);
    assertEquals(pushConfig.code, 1);

    const fetchedLanding = await land(dir, "fetched");
    assertEquals(
      fetchedLanding.result.data?.receipt_note?.fetch.status,
      "unchanged",
    );
    assertHasHint(
      fetchedLanding.result,
      HINTS["accept-publish-receipt-note"],
    );
    assertEquals(
      fetchedLanding.result.data?.receipt_note?.write.status,
      "recorded",
    );
    assertEquals(
      await noteAt(dir, fetchedLanding.target),
      fetchedLanding.receipt,
    );

    await git(dir, "push");
    assertEquals(
      await gitOut(remote, "rev-parse", "refs/heads/main"),
      fetchedLanding.target,
      "plain push must still publish the current branch",
    );
    const remoteNote = await runGit(
      ["rev-parse", "--verify", "-q", RECEIPT_NOTES_REF],
      { cwd: remote },
    );
    assertEquals(
      remoteNote.success,
      false,
      "plain push must not acquire a hidden receipt-note meaning",
    );

    await git(dir, "push", "origin", RECEIPT_NOTES_REF);
    assertEquals(
      await noteAt(remote, fetchedLanding.target),
      fetchedLanding.receipt,
    );
    await git(dir, "update-ref", "-d", RECEIPT_NOTES_REF);
    await git(dir, "fetch", "origin");
    const trackingRef = "refs/discern/remotes/origin/notes";
    const trackingTip = await runGit(
      ["rev-parse", "--verify", "-q", trackingRef],
      { cwd: dir },
    );
    assert(trackingTip.success, trackingTip.stderr);
    assertEquals(
      trackingTip.stdout.trim(),
      await gitOut(remote, "rev-parse", RECEIPT_NOTES_REF),
    );
    const fetchedStatus = await runAgent(dir, ["status", "--json"]);
    assertEquals(fetchedStatus.code, 0, fetchedStatus.output);
    const fetchedStatusResult = JSON.parse(fetchedStatus.stdout);
    assertEquals(
      fetchedStatusResult.data.landed_receipt.ref,
      trackingRef,
    );
    assertEquals(
      fetchedStatusResult.data.landed_receipt.receipt,
      fetchedLanding.receipt,
    );

    const foreignMapping = "+refs/tags/*:refs/discern/test-tags/*";
    await git(
      dir,
      "config",
      "--local",
      "--add",
      "remote.origin.fetch",
      foreignMapping,
    );
    await writeConfig(dir, receiptConfig("local"));
    await git(dir, "add", "discern.toml");
    await git(
      dir,
      "commit",
      "-q",
      "-m",
      "Disable receipt fetch",
      "--no-gpg-sign",
    );
    const unwired = await runAgent(dir, ["refresh", "--json"]);
    assertEquals(unwired.code, 0, unwired.output);
    const remainingFetches = (await gitOut(
      dir,
      "config",
      "--local",
      "--get-all",
      "remote.origin.fetch",
    )).split("\n");
    assertEquals(remainingFetches.includes(receiptMapping), false);
    assert(remainingFetches.includes(foreignMapping));
    const stillNoPush = await runGit(
      ["config", "--local", "--get-all", "remote.origin.push"],
      { cwd: dir },
    );
    assertEquals(stillNoPush.success, false);
  });
});

function syntheticReceipt(commit: string, branch: string): Receipt {
  return {
    branch,
    trunk: "main",
    head: commit.slice(0, 12),
    files_total: 1,
    insertions: 1,
    deletions: 0,
    line: `Receipt for ${branch}`,
    markdown: `### Receipt for ${branch}`,
  };
}

Deno.test("receipt-note recording merges fetched divergence and fails open on a conflicting note", async () => {
  await withTempDir(async (dir) => {
    await Deno.writeTextFile(join(dir, "seed.txt"), "seed\n");
    await gitInit(dir);
    const commits: string[] = [];
    for (let index = 1; index <= 6; index++) {
      await git(
        dir,
        "commit",
        "-q",
        "--allow-empty",
        "-m",
        `Commit ${index}`,
        "--no-gpg-sign",
      );
      commits.push(await gitOut(dir, "rev-parse", "HEAD"));
    }
    const [one, two, three, four, five, six] = commits;
    assert(
      one !== undefined && two !== undefined && three !== undefined &&
        four !== undefined && five !== undefined && six !== undefined,
    );

    const receiptOne = syntheticReceipt(one, "agent/one");
    assertEquals(
      (await writeReceiptNote(dir, one, receiptOne)).status,
      "recorded",
    );
    const commonNotes = await gitOut(dir, "rev-parse", RECEIPT_NOTES_REF);
    await git(
      dir,
      "update-ref",
      "refs/notes/remote-copy",
      commonNotes,
    );

    const receiptTwo = syntheticReceipt(two, "agent/two");
    assertEquals(
      (await writeReceiptNote(dir, two, receiptTwo)).status,
      "recorded",
    );
    const receiptThree = syntheticReceipt(three, "agent/three");
    await git(
      dir,
      "notes",
      "--ref=remote-copy",
      "add",
      "-m",
      canonicalReceiptNote(receiptThree),
      three,
    );
    await git(
      dir,
      "update-ref",
      "refs/discern/remotes/origin/notes",
      await gitOut(dir, "rev-parse", "refs/notes/remote-copy"),
    );

    const receiptFour = syntheticReceipt(four, "agent/four");
    const merged = await writeReceiptNote(dir, four, receiptFour);
    assertEquals(merged.status, "recorded");
    assertEquals(merged.merged_refs, [
      "refs/discern/remotes/origin/notes",
    ]);
    assertEquals(await noteAt(dir, one), receiptOne);
    assertEquals(await noteAt(dir, two), receiptTwo);
    assertEquals(await noteAt(dir, three), receiptThree);
    assertEquals(await noteAt(dir, four), receiptFour);

    const combinedNotes = await gitOut(dir, "rev-parse", RECEIPT_NOTES_REF);
    await git(
      dir,
      "update-ref",
      "refs/notes/conflicting-copy",
      combinedNotes,
    );
    const localFive = syntheticReceipt(five, "agent/five-local");
    assertEquals(
      (await writeReceiptNote(dir, five, localFive)).status,
      "recorded",
    );
    const remoteFive = syntheticReceipt(five, "agent/five-remote");
    await git(
      dir,
      "notes",
      "--ref=conflicting-copy",
      "add",
      "-m",
      canonicalReceiptNote(remoteFive),
      five,
    );
    await git(
      dir,
      "update-ref",
      "refs/discern/remotes/origin/notes",
      await gitOut(dir, "rev-parse", "refs/notes/conflicting-copy"),
    );

    const conflict = await writeReceiptNote(
      dir,
      six,
      syntheticReceipt(six, "agent/six"),
    );
    assertEquals(conflict.status, "record_failed");
    assert(conflict.reason?.includes("could not merge"));
    assertEquals(await noteAt(dir, five), localFive);
    const absentSix = await runGit(
      ["notes", "--ref=discern", "show", six],
      { cwd: dir },
    );
    assertEquals(absentSix.success, false);
  });
});

Deno.test("a post-landing note identity failure is carried without failing acceptance", async () => {
  await withTempDir(async (dir) => {
    await scaffoldEngine(dir);
    await writeConfig(dir, receiptConfig("local"));
    await gitInit(dir);
    const worktree = await addWorktree(dir, "missing-identity");
    await Deno.writeTextFile(join(worktree, "feature.txt"), "feature\n");
    await git(worktree, "add", "feature.txt");
    await git(
      worktree,
      "commit",
      "-q",
      "-m",
      "Add feature",
      "--no-gpg-sign",
    );
    const target = await gitOut(worktree, "rev-parse", "HEAD");
    const done = await runAgent(worktree, ["done", "--json"]);
    assertEquals(done.code, 0, done.output);
    await git(dir, "config", "--local", "--unset-all", "user.name");
    await git(dir, "config", "--local", "--unset-all", "user.email");
    await git(dir, "config", "--local", "user.useConfigOnly", "true");

    const accepted = await runAgent(
      worktree,
      ["accept", "--confirmed", "--json"],
      { env: { [DISCERN_NO_ATTRIBUTION]: "1" } },
    );
    assertEquals(accepted.code, 0, accepted.output);
    const result = JSON.parse(accepted.stdout) as DiscernResult<AcceptData>;
    assertEquals(result.ok, true);
    assertEquals(
      result.data?.receipt_note?.write.status,
      "record_failed",
    );
    assert((result.data?.receipt_note?.write.reason?.length ?? 0) > 0);
    assertEquals(await gitOut(dir, "rev-parse", "main"), target);
  });
});
