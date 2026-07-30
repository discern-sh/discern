/**
 * Landing receipt notes: durable local recording, fetch-only opt-in transport,
 * authorship, divergence repair, and the post-fast-forward fail-open boundary.
 */

import { assert, assertEquals, assertStringIncludes } from "@std/assert";
import { join } from "@std/path";
import { DISCERN_MACHINE } from "../src/shared/brand.ts";
import { DISCERN_NO_ATTRIBUTION } from "../src/shared/env.ts";
import { HINTS } from "../src/shared/hints.ts";
import type { DiscernResult } from "../src/shared/result.ts";
import {
  type AcceptData,
  type GateData,
  type Receipt,
  ReceiptSchema,
  type RefreshData,
} from "../src/shared/result_schemas.ts";
import { runGit } from "../src/shared/subprocess.ts";
import {
  canonicalReceiptNote,
  findLandedReceiptNoteForBranch,
  findLatestLandedReceiptNoteForBranch,
  readReceiptNoteAt,
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
    "agents = []",
    "",
    "[repository]",
    'trunk = "main"',
    `receipt_notes = "${mode}"`,
    "",
    "[guidance]",
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

function receiptFetchMapping(remote: string): string {
  return `+refs/notes/discern*:refs/discern/remotes/${remote}/notes*`;
}

function legacyReceiptFetchMapping(remote: string): string {
  return `+refs/notes/discern:refs/discern/remotes/${remote}/notes`;
}

async function localConfigValues(
  root: string,
  key: string,
): Promise<string[]> {
  const result = await runGit(
    ["config", "--local", "--get-all", key],
    { cwd: root },
  );
  assert(
    result.success || result.code === 1,
    `could not read ${key}: ${result.stderr}`,
  );
  return result.success
    ? result.stdout.split(/\r?\n/).filter((value) => value !== "")
    : [];
}

Deno.test("accept records matching receipt notes without a remote, status reads them, and later landings preserve earlier notes", async () => {
  await withTempDir(async (dir) => {
    await scaffoldEngine(dir);
    await writeConfig(dir, receiptConfig("fetch"));
    await gitInit(dir);

    const first = await land(dir, "first");
    assertEquals(first.result.data?.receipt_note?.fetch.status, "no_remote");
    assertEquals(first.result.data?.receipt_note?.fetch.remotes, []);
    assertEquals(first.result.data?.receipt_note?.fetch.added, []);
    assertEquals(first.result.data?.receipt_note?.write.status, "recorded");
    assertEquals(await noteAt(dir, first.target), first.receipt);
    assertEquals(await notesIdentity(dir), [
      DISCERN_MACHINE.name,
      DISCERN_MACHINE.email,
      DISCERN_MACHINE.name,
      DISCERN_MACHINE.email,
    ]);
    assertLacksHint(first.result, HINTS["accept-publish-receipt-note"]);
    const firstNotesTip = await gitOut(dir, "rev-parse", RECEIPT_NOTES_REF);

    const second = await land(dir, "second", {
      [DISCERN_NO_ATTRIBUTION]: "1",
    });
    assertEquals(await noteAt(dir, first.target), first.receipt);
    assertEquals(await noteAt(dir, second.target), second.receipt);
    assertEquals(await notesIdentity(dir, firstNotesTip), [
      DISCERN_MACHINE.name,
      DISCERN_MACHINE.email,
      DISCERN_MACHINE.name,
      DISCERN_MACHINE.email,
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
    const backup = join(dir, "backup.git");
    await git(dir, "init", "--bare", backup);
    await git(dir, "remote", "add", "backup", backup);
    await git(dir, "push", "backup", "main");

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
    for (const remoteName of ["backup", "origin"]) {
      const fetches = await localConfigValues(
        dir,
        `remote.${remoteName}.fetch`,
      );
      assertEquals(
        fetches.filter((value) => value === receiptFetchMapping(remoteName))
          .length,
        1,
      );
      assertEquals(
        fetches.includes(legacyReceiptFetchMapping(remoteName)),
        false,
      );
      const emptyFetch = await runGit(["fetch", remoteName], { cwd: dir });
      assert(
        emptyFetch.success,
        `ordinary fetch from ${remoteName} must succeed before the first receipt-note publication: ${emptyFetch.stderr}`,
      );
    }

    const mirror = join(dir, "mirror.git");
    await git(dir, "init", "--bare", mirror);
    await git(dir, "remote", "add", "mirror", mirror);
    await git(dir, "push", "mirror", "main");
    const enrolled = await runAgent(dir, ["refresh", "--json"]);
    assertEquals(enrolled.code, 0, enrolled.output);
    assertEquals(
      (await localConfigValues(dir, "remote.mirror.fetch")).filter(
        (value) => value === receiptFetchMapping("mirror"),
      ).length,
      1,
    );
    const mirrorFetch = await runGit(["fetch", "mirror"], { cwd: dir });
    assert(
      mirrorFetch.success,
      `ordinary fetch from a newly enrolled remote must succeed before the first receipt-note publication: ${mirrorFetch.stderr}`,
    );
    for (const remoteName of ["backup", "mirror", "origin"]) {
      assertEquals(
        await localConfigValues(dir, `remote.${remoteName}.push`),
        [],
      );
    }

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
    const remoteNotesTip = await gitOut(
      remote,
      "rev-parse",
      RECEIPT_NOTES_REF,
    );
    await git(
      remote,
      "update-ref",
      "refs/notes/discern-preview",
      remoteNotesTip,
    );
    await git(dir, "update-ref", "-d", RECEIPT_NOTES_REF);
    await git(dir, "fetch", "origin");
    const trackingRef = "refs/discern/remotes/origin/notes";
    const siblingTrackingRef = "refs/discern/remotes/origin/notes-preview";
    const trackingTip = await runGit(
      ["rev-parse", "--verify", "-q", trackingRef],
      { cwd: dir },
    );
    assert(trackingTip.success, trackingTip.stderr);
    assertEquals(
      trackingTip.stdout.trim(),
      remoteNotesTip,
    );
    assertEquals(
      await gitOut(dir, "rev-parse", siblingTrackingRef),
      remoteNotesTip,
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

    await git(dir, "update-ref", "-d", trackingRef);
    const siblingOnlyStatus = await runAgent(dir, ["status", "--json"]);
    assertEquals(siblingOnlyStatus.code, 0, siblingOnlyStatus.output);
    assertEquals(
      JSON.parse(siblingOnlyStatus.stdout).data.landed_receipt,
      undefined,
      "receipt refs that only share discern's reserved prefix must not be read as landing receipts",
    );
    await git(dir, "fetch", "origin");

    await git(remote, "update-ref", "-d", RECEIPT_NOTES_REF);
    const fetchAfterDeletion = await runGit(["fetch", "origin"], {
      cwd: dir,
    });
    assert(
      fetchAfterDeletion.success,
      `ordinary fetch must succeed after the remote receipt ref is deleted: ${fetchAfterDeletion.stderr}`,
    );
    await git(dir, "fetch", "--prune", "origin");
    const prunedTracking = await runGit(
      ["rev-parse", "--verify", "-q", trackingRef],
      { cwd: dir },
    );
    assertEquals(prunedTracking.success, false);
    assertEquals(
      await gitOut(dir, "rev-parse", siblingTrackingRef),
      remoteNotesTip,
    );

    await git(dir, "remote", "remove", "backup");
    const removedRemote = await runAgent(dir, ["refresh", "--json"]);
    assertEquals(removedRemote.code, 0, removedRemote.output);
    assertEquals(
      (await localConfigValues(
        dir,
        "discern.receiptNotesFetchRemote",
      )).sort(),
      ["mirror", "origin"],
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
    const remainingFetches = await localConfigValues(
      dir,
      "remote.origin.fetch",
    );
    assertEquals(
      remainingFetches.includes(receiptFetchMapping("origin")),
      false,
    );
    assert(remainingFetches.includes(foreignMapping));
    assertEquals(
      (await localConfigValues(dir, "remote.mirror.fetch")).includes(
        receiptFetchMapping("mirror"),
      ),
      false,
    );
    for (const remoteName of ["mirror", "origin"]) {
      assertEquals(
        await localConfigValues(dir, `remote.${remoteName}.push`),
        [],
      );
    }
  });
});

Deno.test("receipt-note fetch reconciliation migrates managed exact mappings and explains unowned collisions", async () => {
  await withTempDir(async (dir) => {
    await scaffoldEngine(dir);
    await writeConfig(dir, receiptConfig("fetch"));
    await gitInit(dir);
    const remote = join(dir, "remote.git");
    await git(dir, "init", "--bare", remote);
    await git(dir, "remote", "add", "origin", remote);
    await git(dir, "push", "-u", "origin", "main");

    const key = "remote.origin.fetch";
    const marker = "discern.receiptNotesFetchRemote";
    const legacy = legacyReceiptFetchMapping("origin");
    const optional = receiptFetchMapping("origin");
    await git(dir, "config", "--local", "--add", marker, "origin");
    await git(dir, "config", "--local", "--add", key, legacy);
    await git(dir, "config", "--local", "--add", key, legacy);

    const migrated = await runAgent(dir, ["refresh", "--json"]);
    assertEquals(migrated.code, 0, migrated.output);
    const migratedResult = JSON.parse(
      migrated.stdout,
    ) as DiscernResult<RefreshData>;
    assertEquals(migratedResult.ok, true);
    assert(
      migratedResult.data?.receipt_notes_fetch_changed?.includes(key),
      migrated.output,
    );
    const migratedFetches = await localConfigValues(dir, key);
    assertEquals(
      migratedFetches.filter((value) => value === optional).length,
      1,
    );
    assertEquals(migratedFetches.includes(legacy), false);
    const emptyFetch = await runGit(["fetch", "origin"], { cwd: dir });
    assert(
      emptyFetch.success,
      `ordinary fetch must succeed after migration: ${emptyFetch.stderr}`,
    );

    await git(
      dir,
      "config",
      "--local",
      "--fixed-value",
      "--unset-all",
      marker,
      "origin",
    );
    await git(
      dir,
      "config",
      "--local",
      "--fixed-value",
      "--unset-all",
      key,
      optional,
    );
    await git(dir, "config", "--local", "--add", key, legacy);

    const collision = await runAgent(dir, ["refresh", "--json"]);
    assertEquals(collision.code, 1, collision.output);
    const collisionResult = JSON.parse(
      collision.stdout,
    ) as DiscernResult<RefreshData>;
    assertEquals(collisionResult.ok, false);
    assertEquals(collisionResult.error, "partial_refresh");
    const error = collisionResult.data?.errors.find((message) =>
      message.includes(key)
    );
    assert(error !== undefined, collision.output);
    assertStringIncludes(error, "git fetch origin");
    assertStringIncludes(
      error,
      `git config --local --fixed-value --unset-all ${key} ${legacy}`,
    );
    assertEquals(await localConfigValues(dir, marker), []);
    assertEquals((await localConfigValues(dir, key)).includes(legacy), true);
    assertEquals((await localConfigValues(dir, key)).includes(optional), false);

    const failedFetch = await runGit(["fetch", "origin"], { cwd: dir });
    assertEquals(failedFetch.success, false);
    assertStringIncludes(
      failedFetch.stderr,
      "couldn't find remote ref refs/notes/discern",
    );

    const landing = await land(dir, "unowned-exact");
    assertEquals(landing.result.ok, true);
    assertEquals(
      landing.result.data?.receipt_note?.fetch.status,
      "failed",
    );
    assertEquals(
      landing.result.data?.receipt_note?.fetch.errors,
      collisionResult.data?.errors,
    );
    assertEquals(
      landing.result.data?.receipt_note?.write.status,
      "recorded",
    );
    assertLacksHint(
      landing.result,
      HINTS["accept-publish-receipt-note"],
    );
    assertLacksHint(
      landing.result,
      HINTS["accept-refresh-failed"],
    );
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

Deno.test("receipt-note lookup binds the branch to newly landed trunk ancestry", async () => {
  await withTempDir(async (dir) => {
    await Deno.writeTextFile(join(dir, "seed.txt"), "seed\n");
    await gitInit(dir);
    const baseline = await gitOut(dir, "rev-parse", "HEAD");

    await git(
      dir,
      "commit",
      "-q",
      "--allow-empty",
      "-m",
      "Land wanted branch",
      "--no-gpg-sign",
    );
    const wantedCommit = await gitOut(dir, "rev-parse", "HEAD");
    const wantedReceipt = syntheticReceipt(wantedCommit, "agent/wanted");
    assertEquals(
      (await writeReceiptNote(dir, wantedCommit, wantedReceipt)).status,
      "recorded",
    );

    await git(
      dir,
      "commit",
      "-q",
      "--allow-empty",
      "-m",
      "Land other branch",
      "--no-gpg-sign",
    );
    const otherCommit = await gitOut(dir, "rev-parse", "HEAD");
    const otherReceipt = syntheticReceipt(otherCommit, "agent/other");
    assertEquals(
      (await writeReceiptNote(dir, otherCommit, otherReceipt)).status,
      "recorded",
    );

    assertEquals(await readReceiptNoteAt(dir, wantedCommit), {
      commit: wantedCommit,
      ref: RECEIPT_NOTES_REF,
      receipt: wantedReceipt,
    });
    assertEquals(
      await findLandedReceiptNoteForBranch(
        dir,
        "agent/wanted",
        "main",
        baseline,
      ),
      {
        commit: wantedCommit,
        ref: RECEIPT_NOTES_REF,
        receipt: wantedReceipt,
      },
    );
    assertEquals(
      await findLandedReceiptNoteForBranch(
        dir,
        "agent/wanted",
        "main",
        wantedCommit,
      ),
      undefined,
      "the range excludes landings at or before the continuation baseline",
    );
    assertEquals(
      await findLandedReceiptNoteForBranch(
        dir,
        "agent/missing",
        "main",
        baseline,
      ),
      undefined,
      "an unrelated receipt cannot satisfy the watched branch",
    );
    assertEquals(
      await findLatestLandedReceiptNoteForBranch(
        dir,
        "agent/wanted",
        "main",
      ),
      {
        commit: wantedCommit,
        ref: RECEIPT_NOTES_REF,
        receipt: wantedReceipt,
      },
      "the newest matching receipt wins even when another branch landed later",
    );
    assertEquals(
      await findLatestLandedReceiptNoteForBranch(
        dir,
        "agent/missing",
        "main",
      ),
      undefined,
    );

    await git(
      dir,
      "commit",
      "-q",
      "--allow-empty",
      "-m",
      "Malformed note",
      "--no-gpg-sign",
    );
    const malformedCommit = await gitOut(dir, "rev-parse", "HEAD");
    await git(
      dir,
      "notes",
      "--ref=discern",
      "add",
      "-m",
      "not a receipt",
      malformedCommit,
    );
    assertEquals(await readReceiptNoteAt(dir, malformedCommit), undefined);
    await git(
      dir,
      "notes",
      "--ref=discern",
      "add",
      "--force",
      "-m",
      canonicalReceiptNote({ ...wantedReceipt, head: "" }),
      malformedCommit,
    );
    assertEquals(
      await readReceiptNoteAt(dir, malformedCommit),
      undefined,
      "an empty receipt head cannot authenticate the commit carrying the note",
    );
    await git(
      dir,
      "notes",
      "--ref=discern",
      "add",
      "--force",
      "-m",
      canonicalReceiptNote(wantedReceipt),
      malformedCommit,
    );
    assertEquals(
      await readReceiptNoteAt(dir, malformedCommit),
      undefined,
      "a valid receipt attached to the wrong commit is not landing evidence",
    );
  });
});

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
    await git(
      dir,
      "update-ref",
      "refs/discern/remotes/origin/notes",
      commonNotes,
    );
    await git(
      dir,
      "update-ref",
      "refs/discern/remotes/origin/notes-preview",
      commonNotes,
    );
    await git(dir, "update-ref", "-d", RECEIPT_NOTES_REF);

    const receiptTwo = syntheticReceipt(two, "agent/two");
    const initialized = await writeReceiptNote(dir, two, receiptTwo);
    assertEquals(initialized.status, "recorded");
    assertEquals(initialized.merged_refs, [
      "refs/discern/remotes/origin/notes",
    ]);
    assertEquals(await noteAt(dir, one), receiptOne);
    assertEquals(await noteAt(dir, two), receiptTwo);
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
