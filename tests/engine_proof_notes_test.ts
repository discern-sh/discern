import { completeNoteProof as syntheticProof } from "./completion_note_fixtures.ts";
/**
 * Landing proof notes: durable local recording, fetch-only opt-in transport,
 * authorship, divergence repair, and the post-fast-forward fail-open boundary.
 */

import { assert, assertEquals, assertStringIncludes } from "@std/assert";
import { decodeBase64, encodeBase64 } from "@std/encoding/base64";
import { join } from "@std/path";
import { DISCERN_MACHINE } from "../src/shared/brand.ts";
import { DISCERN_NO_ATTRIBUTION } from "../src/shared/env.ts";
import { HINTS } from "../src/shared/hints.ts";
import {
  type Proof,
  ProofNotePayloadSchema,
  ProofNoteSchema,
  ProofSchema,
  ProofSummarySchema,
} from "../src/shared/result_schemas.ts";
import { PROOF_NOTE_PAYLOAD_TYPE } from "../src/shared/public_schemas.ts";
import { runGit } from "../src/shared/subprocess.ts";
import {
  canonicalProofNote,
  canonicalProofNotePayload,
  findLandedProofNoteForBranch,
  findLatestLandedProofNoteForBranch,
  PROOF_NOTES_REF,
  readProofNoteAt,
  writeProofNote,
} from "../src/engine/gate/proof_notes.ts";
import { inspectGateProof } from "../src/engine/gate/proof.ts";
import { readySentinelPath } from "../src/engine/worktree/git.ts";
import { targetExists } from "../src/shared/fs_presence.ts";
import { gitAdminStatePath } from "../src/shared/git_admin_state.ts";
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
import { assertTerminalTextIncludes, withTempDir } from "./helpers.ts";
import {
  assertResultDataKey,
  type CliResultForCommand,
  decodeCliResult,
  decodeWith,
} from "./decode_cli_result.ts";

/** Render a minimal project configured for local or fetched proof-note discovery. */
function proofConfig(mode: "local" | "fetch"): string {
  return [
    "[project]",
    'slug = "engine-test"',
    "agents = []",
    "",
    "[repository]",
    'trunk = "main"',
    `proof_notes_mode = "${mode}"`,
    "",
    "[instructions]",
    "sources = []",
    "",
  ].join("\n");
}

type AcceptWireData = Exclude<
  NonNullable<CliResultForCommand<"accept">["data"]>,
  { issues: unknown }
>;

interface Landing {
  readonly target: string;
  readonly proof: Proof;
  readonly result: Omit<CliResultForCommand<"accept">, "data"> & {
    readonly data: AcceptWireData & {
      readonly proof_note: NonNullable<AcceptWireData["proof_note"]>;
    };
  };
}

/** Match the compact Proof carried by JSON/MCP while retaining the durable page elsewhere. */
function proofWireSummary(
  proof: Proof,
): ReturnType<typeof ProofSummarySchema.parse> {
  const { markdown: _markdown, completion, ...summary } = proof;
  return {
    ...summary,
    ...(completion === undefined ? {} : {
      completion: {
        candidate_id: completion.candidate_id,
        proof_id: completion.proof_id,
      },
    }),
  };
}

/** Create, gate, and accept one branch, returning both its target commit and parsed proof. */
async function land(
  main: string,
  name: string,
  env: Record<string, string> = {},
): Promise<Landing> {
  const worktree = await addWorktree(main, name);
  await Deno.writeTextFile(join(worktree, `${name}.txt`), `${name}\n`);
  if ((env[DISCERN_NO_ATTRIBUTION] ?? "") !== "") {
    const refreshed = await runAgent(worktree, ["refresh", "--json"], {
      env,
    });
    assertEquals(refreshed.code, 0, refreshed.output);
  }
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
  const done = await runAgent(worktree, ["done", "--json"], { env });
  assertEquals(done.code, 0, done.output);
  const doneResult = decodeCliResult(done.stdout, "done");
  assertResultDataKey(doneResult, "proof");
  assert(doneResult.data.proof !== undefined);
  const proofSummary = ProofSummarySchema.parse(doneResult.data.proof);
  const marker = await inspectGateProof(worktree);
  const proof = ProofSchema.parse(marker.proof_data);
  assertEquals(proofSummary, proofWireSummary(proof));
  const accepted = await runAgent(
    worktree,
    ["accept", "--confirmed", "--json"],
    { env },
  );
  assertEquals(accepted.code, 0, accepted.output);
  const result = decodeCliResult(accepted.stdout, "accept");
  assertResultDataKey(result, "proof_note");
  assert(result.data.proof_note !== undefined);
  assertEquals(result.ok, true, accepted.output);
  return {
    target,
    proof,
    result: {
      ...result,
      data: { ...result.data, proof_note: result.data.proof_note },
    },
  };
}

/** Read one durable note and prove it is the strict current envelope, bound to
 * the commit that carries it, before handing back the proof payload. */
async function noteAt(root: string, commit: string): Promise<Proof> {
  const content = await gitOut(
    root,
    "notes",
    "--ref=discern",
    "show",
    commit,
  );
  const envelope = decodeWith(ProofNoteSchema, content);
  assertEquals(envelope.payloadType, PROOF_NOTE_PAYLOAD_TYPE);
  assertEquals(envelope.signatures, []);
  assertEquals(/[-_]/u.test(envelope.payload), false);
  assertEquals(envelope.payload.length % 4, 0);
  const payloadText = new TextDecoder().decode(decodeBase64(envelope.payload));
  const payload = decodeWith(ProofNotePayloadSchema, payloadText);
  const proof = ProofSchema.parse({
    ...payload.proof,
    ...payload.presentation,
  });
  // Byte-faithful under either writer: a direct gate-side write carries no
  // acceptance block, while a landing records consent plus its authorized
  // variances (their content is pinned by the acceptance suites).
  assertEquals(
    payloadText,
    canonicalProofNotePayload(proof, commit, payload.acceptance),
  );
  assertEquals(payload.subject.commit, commit);
  assertEquals(payload.issuer, undefined);
  assertEquals(payload.brief, undefined);
  return proof;
}

/** Read author and committer identity fields from the proof-notes ref. */
async function notesIdentity(root: string, ref = PROOF_NOTES_REF): Promise<
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

/** Render the wildcard refspec that fetches every namespaced Discern proof note. */
function proofFetchMapping(remote: string): string {
  return `+refs/notes/discern*:refs/discern/remotes/${remote}/notes*`;
}

/** Render an unrecognized single-ref mapping used to prove non-ownership. */
function unrecognizedProofFetchMapping(remote: string): string {
  return `+refs/notes/discern:refs/discern/remotes/${remote}/notes`;
}

/** Read all repository-local values for a Git config key, treating an unset key as empty. */
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

Deno.test("accept records matching proof notes without a remote, status reads them, and later landings preserve earlier notes", async () => {
  await withTempDir(async (dir) => {
    await scaffoldEngine(dir);
    await writeConfig(dir, proofConfig("fetch"));
    await gitInit(dir);

    const first = await land(dir, "first");
    assertEquals(first.result.data.proof_note.fetch.status, "no_remote");
    assertEquals(first.result.data.proof_note.fetch.remotes, []);
    assertEquals(first.result.data.proof_note.fetch.added, []);
    assertEquals(first.result.data.proof_note.write.status, "recorded");
    assertEquals(await noteAt(dir, first.target), first.proof);
    assertEquals(await notesIdentity(dir), [
      DISCERN_MACHINE.name,
      DISCERN_MACHINE.email,
      DISCERN_MACHINE.name,
      DISCERN_MACHINE.email,
    ]);
    assertLacksHint(first.result, HINTS["accept-publish-proof-note"]);
    const firstNotesTip = await gitOut(dir, "rev-parse", PROOF_NOTES_REF);

    const second = await land(dir, "second", {
      [DISCERN_NO_ATTRIBUTION]: "1",
    });
    assertEquals(await noteAt(dir, first.target), first.proof);
    assertEquals(await noteAt(dir, second.target), second.proof);
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

    const orientedStatus = await runAgent(dir, ["status", "--json"]);
    assertEquals(orientedStatus.code, 0, orientedStatus.output);
    const orientedStatusResult = decodeCliResult(
      orientedStatus.stdout,
      "status",
    );
    assertResultDataKey(orientedStatusResult, "location");
    assertEquals(orientedStatusResult.data.projection.mode, "orientation");
    assertEquals(orientedStatusResult.data.landed_proof, undefined);
    assertEquals(orientedStatusResult.data.landed_proof_unsupported, undefined);

    const status = await runAgent(dir, ["status", "--verbose", "--json"]);
    assertEquals(status.code, 0, status.output);
    const statusResult = decodeCliResult(status.stdout, "status");
    assertResultDataKey(statusResult, "location");
    assertEquals(statusResult.data.projection.mode, "full");
    assertEquals(statusResult.data.landed_proof, {
      commit: second.target,
      commit_at: await gitOut(dir, "show", "-s", "--format=%cI", second.target),
      ref: PROOF_NOTES_REF,
      proof: proofWireSummary(second.proof),
    });
    assertEquals(statusResult.data.landed_proof_unsupported, undefined);

    // A trunk tip whose note is a newer format major reports explicitly —
    // the evidence exists, this binary is too old to read it.
    await git(
      dir,
      "commit",
      "-q",
      "--allow-empty",
      "-m",
      "Landed by a newer discern",
      "--no-gpg-sign",
    );
    const newerCommit = await gitOut(dir, "rev-parse", "HEAD");
    const newerFormat = PROOF_NOTE_PAYLOAD_TYPE.replace(/\/v\d+\//u, "/v9/");
    await git(
      dir,
      "notes",
      "--ref=discern",
      "add",
      "-m",
      `${
        JSON.stringify({
          payloadType: newerFormat,
          payload: "",
          signatures: [],
        })
      }\n`,
      newerCommit,
    );
    const unreadStatus = await runAgent(dir, [
      "status",
      "--verbose",
      "--json",
    ]);
    assertEquals(unreadStatus.code, 0, unreadStatus.output);
    const unreadResult = decodeCliResult(unreadStatus.stdout, "status");
    assertResultDataKey(unreadResult, "location");
    assertEquals(unreadResult.data.landed_proof, undefined);
    assertEquals(unreadResult.data.landed_proof_unsupported, {
      commit: newerCommit,
      ref: PROOF_NOTES_REF,
      format: newerFormat,
    });
    const unreadHuman = await runAgent(dir, ["status", "--plain"]);
    assertEquals(unreadHuman.code, 0, unreadHuman.output);
    assertTerminalTextIncludes(
      unreadHuman.stdout.replaceAll(/\s+/gu, ""),
      `Proof unavailable in this discern version (${newerFormat})`.replaceAll(
        /\s+/gu,
        "",
      ),
    );
  });
});

Deno.test("proof-note transport is opt-in, fetch-only, managed, and leaves plain push unchanged", async () => {
  await withTempDir(async (dir) => {
    await scaffoldEngine(dir);
    await writeConfig(dir, proofConfig("local"));
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
      HINTS["accept-publish-proof-note"],
    );
    const localFetches = await gitOut(
      dir,
      "config",
      "--local",
      "--get-all",
      "remote.origin.fetch",
    );
    assertEquals(localFetches.includes("refs/notes/discern"), false);

    await writeConfig(dir, proofConfig("fetch"));
    await git(dir, "add", "discern.toml");
    await git(
      dir,
      "commit",
      "-q",
      "-m",
      "Enable proof fetch",
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
        fetches.filter((value) => value === proofFetchMapping(remoteName))
          .length,
        1,
      );
      assertEquals(
        fetches.includes(unrecognizedProofFetchMapping(remoteName)),
        false,
      );
      await git(dir, "fetch", remoteName);
    }

    const mirror = join(dir, "mirror.git");
    await git(dir, "init", "--bare", mirror);
    await git(dir, "remote", "add", "mirror", mirror);
    await git(dir, "push", "mirror", "main");
    const enrolled = await runAgent(dir, ["refresh", "--json"]);
    assertEquals(enrolled.code, 0, enrolled.output);
    assertEquals(
      (await localConfigValues(dir, "remote.mirror.fetch")).filter(
        (value) => value === proofFetchMapping("mirror"),
      ).length,
      1,
    );
    await git(dir, "fetch", "mirror");
    for (const remoteName of ["backup", "mirror", "origin"]) {
      assertEquals(
        await localConfigValues(dir, `remote.${remoteName}.push`),
        [],
      );
    }

    const fetchedLanding = await land(dir, "fetched");
    assertEquals(
      fetchedLanding.result.data.proof_note.fetch.status,
      "unchanged",
    );
    assertHasHint(
      fetchedLanding.result,
      HINTS["accept-publish-proof-note"],
    );
    assertEquals(
      fetchedLanding.result.data.proof_note.write.status,
      "recorded",
    );
    assertEquals(
      await noteAt(dir, fetchedLanding.target),
      fetchedLanding.proof,
    );

    await git(dir, "push");
    assertEquals(
      await gitOut(remote, "rev-parse", "refs/heads/main"),
      fetchedLanding.target,
      "plain push must still publish the current branch",
    );
    const remoteNote = await runGit(
      ["rev-parse", "--verify", "-q", PROOF_NOTES_REF],
      { cwd: remote },
    );
    assertEquals(
      remoteNote.success,
      false,
      "plain push must not acquire a hidden proof-note meaning",
    );

    await git(dir, "push", "origin", PROOF_NOTES_REF);
    assertEquals(
      await noteAt(remote, fetchedLanding.target),
      fetchedLanding.proof,
    );
    const remoteNotesTip = await gitOut(
      remote,
      "rev-parse",
      PROOF_NOTES_REF,
    );
    await git(
      remote,
      "update-ref",
      "refs/notes/discern-preview",
      remoteNotesTip,
    );
    await git(dir, "update-ref", "-d", PROOF_NOTES_REF);
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
    const fetchedStatus = await runAgent(dir, [
      "status",
      "--verbose",
      "--json",
    ]);
    assertEquals(fetchedStatus.code, 0, fetchedStatus.output);
    const fetchedStatusResult = decodeCliResult(fetchedStatus.stdout, "status");
    assertResultDataKey(fetchedStatusResult, "landed_proof");
    assert(fetchedStatusResult.data.landed_proof !== undefined);
    assertEquals(
      fetchedStatusResult.data.landed_proof.ref,
      trackingRef,
    );
    assertEquals(
      fetchedStatusResult.data.landed_proof.proof,
      proofWireSummary(fetchedLanding.proof),
    );

    await git(dir, "update-ref", "-d", trackingRef);
    const siblingOnlyStatus = await runAgent(dir, [
      "status",
      "--verbose",
      "--json",
    ]);
    assertEquals(siblingOnlyStatus.code, 0, siblingOnlyStatus.output);
    const siblingOnlyResult = decodeCliResult(
      siblingOnlyStatus.stdout,
      "status",
    );
    assertResultDataKey(siblingOnlyResult, "location");
    assertEquals(
      siblingOnlyResult.data.landed_proof,
      undefined,
      "proof refs that only share discern's reserved prefix must not be read as landing proofs",
    );
    await git(dir, "fetch", "origin");

    await git(remote, "update-ref", "-d", PROOF_NOTES_REF);
    await git(dir, "fetch", "origin");
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
        "discern.proofNotesFetchRemote",
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
    await writeConfig(dir, proofConfig("local"));
    await git(dir, "add", "discern.toml");
    await git(
      dir,
      "commit",
      "-q",
      "-m",
      "Disable proof fetch",
      "--no-gpg-sign",
    );
    const unwired = await runAgent(dir, ["refresh", "--json"]);
    assertEquals(unwired.code, 0, unwired.output);
    const remainingFetches = await localConfigValues(
      dir,
      "remote.origin.fetch",
    );
    assertEquals(
      remainingFetches.includes(proofFetchMapping("origin")),
      false,
    );
    assert(remainingFetches.includes(foreignMapping));
    assertEquals(
      (await localConfigValues(dir, "remote.mirror.fetch")).includes(
        proofFetchMapping("mirror"),
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

Deno.test("proof-note fetch reconciliation leaves unrecognized refspecs untouched", async () => {
  await withTempDir(async (dir) => {
    await scaffoldEngine(dir);
    await writeConfig(dir, proofConfig("fetch"));
    await gitInit(dir);
    const remote = join(dir, "remote.git");
    await git(dir, "init", "--bare", remote);
    await git(dir, "remote", "add", "origin", remote);
    await git(dir, "push", "-u", "origin", "main");

    const key = "remote.origin.fetch";
    const marker = "discern.proofNotesFetchRemote";
    const unrecognized = unrecognizedProofFetchMapping("origin");
    const optional = proofFetchMapping("origin");
    await git(dir, "config", "--local", "--add", marker, "origin");
    await git(dir, "config", "--local", "--add", key, unrecognized);

    const reconciled = await runAgent(dir, ["refresh", "--json"]);
    assertEquals(reconciled.code, 0, reconciled.output);
    const result = decodeCliResult(reconciled.stdout, "refresh");
    assertResultDataKey(result, "proof_notes_fetch_changed");
    assert(result.data.proof_notes_fetch_changed !== undefined);
    assertEquals(result.ok, true);
    assert(
      result.data.proof_notes_fetch_changed.includes(key),
      reconciled.output,
    );
    const fetches = await localConfigValues(dir, key);
    assertEquals(
      fetches.filter((value) => value === optional).length,
      1,
    );
    assertEquals(fetches.includes(unrecognized), true);
    assertEquals(await localConfigValues(dir, marker), ["origin"]);
  });
});

Deno.test("durable proof-note writer refuses report-only checkpoint review", async () => {
  const commit = "a".repeat(40);
  const result = await writeProofNote(".", commit, {
    ...syntheticProof(commit, "agent/report"),
    mode: "report",
  });
  assertEquals(result.status, "record_failed");
  assertStringIncludes(result.reason ?? "", "cannot become landing evidence");
});

/** Serialize proof data as standard or unpadded URL-safe Base64. */
function encodedProofPayload(
  value: unknown,
  alphabet: "standard" | "url-safe" = "standard",
): string {
  const encoded = encodeBase64(
    new TextEncoder().encode(JSON.stringify(value)),
  );
  return alphabet === "standard"
    ? encoded
    : encoded.replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/u, "");
}

Deno.test("durable proof projection excludes live proof telemetry", () => {
  const commit = "a".repeat(40);
  const proof = {
    ...syntheticProof(commit, "agent/orbit"),
    waited_ms: 70_000,
    orbit_delay: 42,
  } as Proof & { waited_ms: number; orbit_delay: number };
  const payload = decodeWith(
    ProofNotePayloadSchema,
    canonicalProofNotePayload(proof, commit),
  );

  assert(proof.completion !== undefined);
  assertEquals(payload, {
    subject: { commit },
    proof: {
      completion: proof.completion,
      branch: "agent/orbit",
      trunk: "main",
      head: commit.slice(0, 12),
      files_total: 1,
      insertions: 1,
      deletions: 0,
    },
    presentation: {
      line: "Proof for agent/orbit",
      markdown: "### Proof for agent/orbit",
    },
  });
});

Deno.test("the durable reader reads an unknown open-vocabulary member and refuses an unknown closed one", async () => {
  await withTempDir(async (dir) => {
    await Deno.writeTextFile(join(dir, "seed.txt"), "seed\n");
    await gitInit(dir);
    await git(
      dir,
      "commit",
      "-q",
      "--allow-empty",
      "-m",
      "Landing from a newer writer",
      "--no-gpg-sign",
    );
    const commit = await gitOut(dir, "rev-parse", "HEAD");
    const proof = syntheticProof(commit, "agent/newer");
    const note = (payload: unknown): string =>
      `${
        JSON.stringify({
          payloadType: PROOF_NOTE_PAYLOAD_TYPE,
          payload: encodedProofPayload(payload),
          signatures: [],
        })
      }\n`;
    const claim = {
      completion: proof.completion,
      branch: proof.branch,
      trunk: proof.trunk,
      head: proof.head,
      files_total: proof.files_total,
      insertions: proof.insertions,
      deletions: proof.deletions,
    };
    const presentation = { line: proof.line, markdown: proof.markdown };

    // Checkpoint drop reasons and consent sources are open vocabularies: a
    // member this build does not know reads as opaque and stays on the proof.
    const futureDrop = {
      scope: "policy",
      checkpoint: null,
      mode: null,
      reason: "future_reason",
      account: "a reason this build does not know",
    };
    await git(
      dir,
      "notes",
      "--ref=discern",
      "add",
      "-m",
      note({
        subject: { commit },
        proof: { ...claim, checkpoint_drops: [futureDrop] },
        presentation,
        acceptance: {
          consent: { source: "future-grant" },
          variances: [],
          standard_proposals: [],
        },
      }),
      commit,
    );
    const open = await readProofNoteAt(dir, commit);
    assertEquals(open.status, "valid");
    if (open.status === "valid") {
      assertEquals(
        open.proof.checkpoint_drops?.map((drop) => drop.reason),
        ["future_reason"],
      );
      assertEquals(open.acceptance?.consent.source, "future-grant");
    }

    // The validation mode is a closed decision vocabulary: an unknown member
    // makes the note unreadable rather than silently misread.
    await git(
      dir,
      "notes",
      "--ref=discern",
      "add",
      "--force",
      "-m",
      note({
        subject: { commit },
        proof: { ...claim, mode: "future" },
        presentation,
      }),
      commit,
    );
    assertEquals(await readProofNoteAt(dir, commit), { status: "missing" });
  });
});

Deno.test("proof-note replay keys identity to subject and stable claim", async () => {
  await withTempDir(async (dir) => {
    await Deno.writeTextFile(join(dir, "seed.txt"), "seed\n");
    await gitInit(dir);
    const commit = await gitOut(dir, "rev-parse", "HEAD");
    const proof = syntheticProof(commit, "agent/stable-claim");
    assertEquals((await writeProofNote(dir, commit, proof)).status, "recorded");
    const original = await runGit(
      ["notes", "--ref=discern", "show", commit],
      { cwd: dir },
    );
    assert(original.success);

    const presentationVariants: Proof[] = [
      { ...proof, line: "A differently rendered proof line" },
      { ...proof, markdown: "## A differently rendered proof page" },
      {
        ...proof,
        line: "A later line",
        markdown: "## A later page",
        waited_ms: 90_000,
      } as Proof & { waited_ms: number },
    ];
    for (const replay of presentationVariants) {
      assertEquals(
        (await writeProofNote(dir, commit, replay)).status,
        "already_present",
      );
      const unchanged = await runGit(
        ["notes", "--ref=discern", "show", commit],
        { cwd: dir },
      );
      assertEquals(unchanged.stdout, original.stdout);
    }

    const conflicting = await writeProofNote(dir, commit, {
      ...proof,
      insertions: proof.insertions + 1,
    });
    assertEquals(conflicting.status, "record_failed");
    assertStringIncludes(conflicting.reason ?? "", "different Proof note");
  });
});

Deno.test("proof-note lookup binds the branch to newly landed trunk ancestry", async () => {
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
    const wantedProof = syntheticProof(wantedCommit, "agent/wanted");
    assertEquals(
      (await writeProofNote(dir, wantedCommit, wantedProof)).status,
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
    const otherProof = syntheticProof(otherCommit, "agent/other");
    assertEquals(
      (await writeProofNote(dir, otherCommit, otherProof)).status,
      "recorded",
    );

    assertEquals(await readProofNoteAt(dir, wantedCommit), {
      status: "valid",
      commit: wantedCommit,
      ref: PROOF_NOTES_REF,
      proof: wantedProof,
    });
    decodeWith(ProofNoteSchema, canonicalProofNote(wantedProof, wantedCommit));
    assertEquals(
      await findLandedProofNoteForBranch(
        dir,
        "agent/wanted",
        "main",
        baseline,
      ),
      {
        commit: wantedCommit,
        ref: PROOF_NOTES_REF,
        proof: wantedProof,
      },
    );
    assertEquals(
      await findLandedProofNoteForBranch(
        dir,
        "agent/wanted",
        "main",
        wantedCommit,
      ),
      undefined,
      "the range excludes landings at or before the continuation baseline",
    );
    assertEquals(
      await findLandedProofNoteForBranch(
        dir,
        "agent/missing",
        "main",
        baseline,
      ),
      undefined,
      "an unrelated proof cannot satisfy the watched branch",
    );
    assertEquals(
      await findLatestLandedProofNoteForBranch(
        dir,
        "agent/wanted",
        "main",
      ),
      {
        commit: wantedCommit,
        ref: PROOF_NOTES_REF,
        proof: wantedProof,
      },
      "the newest matching proof wins even when another branch landed later",
    );
    assertEquals(
      await findLatestLandedProofNoteForBranch(
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
      "not a proof",
      malformedCommit,
    );
    assertEquals(await readProofNoteAt(dir, malformedCommit), {
      status: "missing",
    });
    await git(
      dir,
      "notes",
      "--ref=discern",
      "add",
      "--force",
      "-m",
      JSON.stringify({
        ...syntheticProof(malformedCommit, "agent/x"),
        head: "",
      }),
      malformedCommit,
    );
    assertEquals(
      await readProofNoteAt(dir, malformedCommit),
      { status: "missing" },
      "a bare note is not current Proof evidence",
    );
    await git(
      dir,
      "notes",
      "--ref=discern",
      "add",
      "--force",
      "-m",
      canonicalProofNote({
        ...syntheticProof(malformedCommit, "agent/x"),
        head: "",
      }, malformedCommit),
      malformedCommit,
    );
    assertEquals(
      await readProofNoteAt(dir, malformedCommit),
      { status: "missing" },
      "a current note keeps its abbreviated proof head coherent with its full subject",
    );
    await git(
      dir,
      "notes",
      "--ref=discern",
      "add",
      "--force",
      "-m",
      canonicalProofNote(wantedProof, wantedCommit),
      malformedCommit,
    );
    assertEquals(
      await readProofNoteAt(dir, malformedCommit),
      { status: "missing" },
      "a valid proof whose subject names another commit is not landing evidence",
    );
  });
});

Deno.test("the durable reader accepts additive current notes and rejects retired layouts", async () => {
  await withTempDir(async (dir) => {
    await Deno.writeTextFile(join(dir, "seed.txt"), "seed\n");
    await gitInit(dir);

    // A bare private-era Proof is not a v1 note.
    await git(
      dir,
      "commit",
      "-q",
      "--allow-empty",
      "-m",
      "Bare private-era landing",
      "--no-gpg-sign",
    );
    const bareCommit = await gitOut(dir, "rev-parse", "HEAD");
    const bareProof = syntheticProof(bareCommit, "agent/bare");
    await git(
      dir,
      "notes",
      "--ref=discern",
      "add",
      "-m",
      `${JSON.stringify({ ...bareProof, waited_ms: 70_000 })}\n`,
      bareCommit,
    );
    assertEquals(await readProofNoteAt(dir, bareCommit), { status: "missing" });

    // A pre-split payload is also retired even when its envelope is current.
    await git(
      dir,
      "commit",
      "-q",
      "--allow-empty",
      "-m",
      "Future landing",
      "--no-gpg-sign",
    );
    const futureCommit = await gitOut(dir, "rev-parse", "HEAD");
    const futureProof = syntheticProof(futureCommit, "agent/future");
    const preSplitPayload = encodedProofPayload({
      subject: { commit: futureCommit, tree: "0".repeat(40) },
      proof: { ...futureProof, waited_ms: 70_000, verdict: "green" },
      issuer: { name: "Future Owner", role: "maintainer" },
      brief: "brief-0042",
    });
    await git(
      dir,
      "notes",
      "--ref=discern",
      "add",
      "-m",
      JSON.stringify({
        payloadType: PROOF_NOTE_PAYLOAD_TYPE,
        payload: preSplitPayload,
        signatures: [],
      }),
      futureCommit,
    );
    assertEquals(await readProofNoteAt(dir, futureCommit), {
      status: "missing",
    });

    // Unknown additive fields and signature members pass within the current
    // split payload. URL-safe unpadded Base64 remains the deliberate D-76
    // future-signing tolerance.
    const futurePayload = encodedProofPayload({
      subject: { commit: futureCommit, tree: "0".repeat(40) },
      proof: {
        completion: futureProof.completion,
        branch: futureProof.branch,
        trunk: futureProof.trunk,
        head: futureProof.head,
        files_total: futureProof.files_total,
        insertions: futureProof.insertions,
        deletions: futureProof.deletions,
        verdict: "green",
      },
      presentation: {
        line: futureProof.line,
        markdown: futureProof.markdown,
      },
      issuer: { name: "Future Owner", role: "maintainer" },
      brief: "brief-0042",
      // Two astral characters guarantee a `+`/`/` sextet at every Base64
      // alignment, so the URL-safe guard below cannot rot as fields change.
      future: "\u{10FFFF}\u{10FFFF}",
    }, "url-safe");
    assert(
      /[-_]/u.test(futurePayload),
      "the fixture must exercise DSSE's URL-safe Base64 alphabet",
    );
    await git(
      dir,
      "notes",
      "--ref=discern",
      "add",
      "--force",
      "-m",
      `${
        JSON.stringify({
          payloadType: PROOF_NOTE_PAYLOAD_TYPE,
          payload: futurePayload,
          signatures: [{
            keyid: "future-key",
            sig: "AA==",
            profile: "future-profile",
          }],
          attestations: [{ kind: "external" }],
        })
      }\n`,
      futureCommit,
    );
    assertEquals(await readProofNoteAt(dir, futureCommit), {
      status: "valid",
      commit: futureCommit,
      ref: PROOF_NOTES_REF,
      proof: futureProof,
      issuer: { name: "Future Owner" },
      brief: "brief-0042",
    });

    // A proposal without its current binding is not a v1 proposal.
    await git(
      dir,
      "commit",
      "-q",
      "--allow-empty",
      "-m",
      "Incomplete proposal landing",
      "--no-gpg-sign",
    );
    const proposalCommit = await gitOut(dir, "rev-parse", "HEAD");
    const proposalProof = syntheticProof(
      proposalCommit,
      "agent/incomplete-proposal",
    );
    const incompleteProposal = {
      standard: "sources",
      commit: proposalCommit,
      measured_commit: proposalCommit,
      definition_fingerprint: "definition-fingerprint",
      trunk: "main",
      trunk_commit: proposalCommit,
      direction: "down" as const,
      trunk_limit: 1,
      proposed_limit: 2,
      measurement: 2,
      delta: 1,
      reason: "The accepted feature adds one required source.",
      evidence_paths: ["src/feature.ts"],
    };
    const incompleteProposalPayload = encodedProofPayload({
      subject: { commit: proposalCommit },
      proof: {
        branch: proposalProof.branch,
        trunk: proposalProof.trunk,
        head: proposalProof.head,
        files_total: proposalProof.files_total,
        insertions: proposalProof.insertions,
        deletions: proposalProof.deletions,
        standard_proposals: [incompleteProposal],
      },
      presentation: {
        line: proposalProof.line,
        markdown: proposalProof.markdown,
      },
    });
    await git(
      dir,
      "notes",
      "--ref=discern",
      "add",
      "-m",
      JSON.stringify({
        payloadType: PROOF_NOTE_PAYLOAD_TYPE,
        payload: incompleteProposalPayload,
        signatures: [],
      }),
      proposalCommit,
    );
    assertEquals(await readProofNoteAt(dir, proposalCommit), {
      status: "missing",
    });

    // The unsigned v1 extension is an explicitly present empty signature
    // array, not an omitted field.
    await git(
      dir,
      "notes",
      "--ref=discern",
      "add",
      "--force",
      "-m",
      JSON.stringify({
        payloadType: PROOF_NOTE_PAYLOAD_TYPE,
        payload: futurePayload,
      }),
      futureCommit,
    );
    assertEquals(await readProofNoteAt(dir, futureCommit), {
      status: "missing",
    });

    // A readable envelope still needs valid Base64, UTF-8, JSON, and the
    // required payload core. Malformed payload bytes are not proof evidence.
    const malformedPayloads = [
      "***",
      encodeBase64(new Uint8Array([0xff])),
      encodedProofPayload({ proof: futureProof }),
    ];
    for (const payload of malformedPayloads) {
      await git(
        dir,
        "notes",
        "--ref=discern",
        "add",
        "--force",
        "-m",
        `${
          JSON.stringify({
            payloadType: PROOF_NOTE_PAYLOAD_TYPE,
            payload,
            signatures: [],
          })
        }\n`,
        futureCommit,
      );
      assertEquals(await readProofNoteAt(dir, futureCommit), {
        status: "missing",
      });
    }

    // An unknown format major is an explicit refusal naming the format —
    // never a crash, never read as "no proof exists".
    await git(
      dir,
      "commit",
      "-q",
      "--allow-empty",
      "-m",
      "Unreadable landing",
      "--no-gpg-sign",
    );
    const unreadCommit = await gitOut(dir, "rev-parse", "HEAD");
    const futureFormat = PROOF_NOTE_PAYLOAD_TYPE.replace(/\/v\d+\//u, "/v9/");
    await git(
      dir,
      "notes",
      "--ref=discern",
      "add",
      "-m",
      `${
        JSON.stringify({
          payloadType: futureFormat,
          payload: "",
          signatures: [],
        })
      }\n`,
      unreadCommit,
    );
    assertEquals(await readProofNoteAt(dir, unreadCommit), {
      status: "unsupported",
      commit: unreadCommit,
      ref: PROOF_NOTES_REF,
      format: futureFormat,
    });

    // The writer refuses to publish a record whose proof contradicts the
    // commit it would annotate.
    const mismatched = await writeProofNote(
      dir,
      unreadCommit,
      syntheticProof(bareCommit, "agent/mismatch"),
    );
    assertEquals(mismatched.status, "record_failed");
    assert(mismatched.reason?.includes("does not match the landed commit"));
  });
});

Deno.test("proof-note recording merges fetched divergence and fails open on a conflicting note", async () => {
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

    const proofOne = syntheticProof(one, "agent/one");
    assertEquals(
      (await writeProofNote(dir, one, proofOne)).status,
      "recorded",
    );
    const commonNotes = await gitOut(dir, "rev-parse", PROOF_NOTES_REF);
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
    await git(dir, "update-ref", "-d", PROOF_NOTES_REF);

    const proofTwo = syntheticProof(two, "agent/two");
    const initialized = await writeProofNote(dir, two, proofTwo);
    assertEquals(initialized.status, "recorded");
    assertEquals(initialized.merged_refs, [
      "refs/discern/remotes/origin/notes",
    ]);
    assertEquals(await noteAt(dir, one), proofOne);
    assertEquals(await noteAt(dir, two), proofTwo);
    const proofThree = syntheticProof(three, "agent/three");
    await git(
      dir,
      "notes",
      "--ref=remote-copy",
      "add",
      "-m",
      canonicalProofNote(proofThree, three),
      three,
    );
    await git(
      dir,
      "update-ref",
      "refs/discern/remotes/origin/notes",
      await gitOut(dir, "rev-parse", "refs/notes/remote-copy"),
    );

    const proofFour = syntheticProof(four, "agent/four");
    const merged = await writeProofNote(dir, four, proofFour);
    assertEquals(merged.status, "recorded");
    assertEquals(merged.merged_refs, [
      "refs/discern/remotes/origin/notes",
    ]);
    assertEquals(await noteAt(dir, one), proofOne);
    assertEquals(await noteAt(dir, two), proofTwo);
    assertEquals(await noteAt(dir, three), proofThree);
    assertEquals(await noteAt(dir, four), proofFour);

    const combinedNotes = await gitOut(dir, "rev-parse", PROOF_NOTES_REF);
    await git(
      dir,
      "update-ref",
      "refs/notes/conflicting-copy",
      combinedNotes,
    );
    const localFive = syntheticProof(five, "agent/five-local");
    assertEquals(
      (await writeProofNote(dir, five, localFive)).status,
      "recorded",
    );
    const remoteFive = syntheticProof(five, "agent/five-remote");
    await git(
      dir,
      "notes",
      "--ref=conflicting-copy",
      "add",
      "-m",
      canonicalProofNote(remoteFive, five),
      five,
    );
    await git(
      dir,
      "update-ref",
      "refs/discern/remotes/origin/notes",
      await gitOut(dir, "rev-parse", "refs/notes/conflicting-copy"),
    );

    const conflict = await writeProofNote(
      dir,
      six,
      syntheticProof(six, "agent/six"),
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

const NO_ATTRIBUTION = { [DISCERN_NO_ATTRIBUTION]: "1" };

/** A landing whose Proof note failed after the trunk moved. */
interface OwedNoteLanding {
  readonly worktree: string;
  readonly target: string;
  readonly accepted: Awaited<ReturnType<typeof runAgent>>;
}

/** Prove one effort, then land it while the repository has no Git identity.
 * With attribution off the notes commit needs that identity, so the trunk
 * moves and the Proof note write fails after it. */
async function landWithoutNoteIdentity(
  dir: string,
  name: string,
): Promise<OwedNoteLanding> {
  const worktree = await addWorktree(dir, name);
  await Deno.writeTextFile(join(worktree, `${name}.txt`), `${name}\n`);
  const refreshed = await runAgent(worktree, ["refresh", "--json"], {
    env: NO_ATTRIBUTION,
  });
  assertEquals(refreshed.code, 0, refreshed.output);
  await git(worktree, "add", `${name}.txt`);
  await git(worktree, "commit", "-q", "-m", `Add ${name}`, "--no-gpg-sign");
  const target = await gitOut(worktree, "rev-parse", "HEAD");
  const done = await runAgent(worktree, ["done", "--json"], {
    env: NO_ATTRIBUTION,
  });
  assertEquals(done.code, 0, done.output);
  await git(dir, "config", "--local", "--unset-all", "user.name");
  await git(dir, "config", "--local", "--unset-all", "user.email");
  await git(dir, "config", "--local", "user.useConfigOnly", "true");

  const accepted = await runAgent(
    worktree,
    ["accept", "--confirmed", "--json"],
    { env: NO_ATTRIBUTION },
  );
  assertEquals(await gitOut(dir, "rev-parse", "main"), target);
  return { worktree, target, accepted };
}

/** Restore the identity {@link landWithoutNoteIdentity} removed. */
async function restoreNoteIdentity(dir: string): Promise<void> {
  await git(dir, "config", "--local", "user.name", "Engine Test");
  await git(dir, "config", "--local", "user.email", "engine-test@example.com");
}

/** Assert an acceptance run left the landing standing with its note owed —
 * checkout, branch, and journal kept — and that every advice surface names
 * one retry; return the checkout that sentence names. */
async function assertOwedNoteKept(
  dir: string,
  owed: OwedNoteLanding,
  run: Awaited<ReturnType<typeof runAgent>>,
): Promise<string> {
  assertEquals(run.code, 0, run.output);
  const result = decodeCliResult(run.stdout, "accept");
  assertEquals(result.ok, true);
  assertResultDataKey(result, "proof_note");
  assert(result.data.proof_note !== undefined);
  assertEquals(result.data.proof_note.write.status, "record_failed");
  assert((result.data.proof_note.write.reason ?? "").length > 0);
  assertResultDataKey(result, "landing");
  assertEquals(result.data.landing, {
    recovery_performed: false,
    trunk_landed: true,
    worktree_removed: false,
    branch_deleted: false,
  });
  assert(await targetExists(owed.worktree));
  const branch = await gitOut(owed.worktree, "branch", "--show-current");
  assertEquals(await gitOut(dir, "rev-parse", branch), owed.target);
  const journal = await gitAdminStatePath(
    owed.worktree,
    "acceptanceTransaction",
  );
  assert(journal !== undefined && await targetExists(journal));
  const named = /run `discern accept` from (.+?); it records the note/.exec(
    result.message ?? "",
  )?.[1];
  assert(named !== undefined, run.output);
  assertEquals(named, await Deno.realPath(owed.worktree), run.output);
  assert(
    result.advisories?.some((advisory) =>
      advisory.kind === "proof-recording-unavailable" &&
      advisory.next_action.includes("run `discern accept` from")
    ) ?? false,
    run.output,
  );
  return named;
}

/** Follow a kept landing's named retry and assert it settled the landing:
 * the note recorded, the checkout cleaned up, and no second landing. */
async function followNoteRetry(
  dir: string,
  owed: OwedNoteLanding,
  retryFrom: string,
  trunk: string,
): Promise<void> {
  const retried = await runAgent(retryFrom, ["accept", "--json"], {
    env: NO_ATTRIBUTION,
  });
  assertEquals(retried.code, 0, retried.output);
  const settled = decodeCliResult(retried.stdout, "accept");
  assertResultDataKey(settled, "proof_note");
  assertEquals(settled.data.proof_note?.write.status, "recorded");
  assertResultDataKey(settled, "landing");
  assertEquals(settled.data.landing, {
    recovery_performed: true,
    trunk_landed: true,
    worktree_removed: true,
    branch_deleted: true,
  });
  assertEquals(
    (await noteAt(dir, owed.target)).head,
    owed.target.slice(0, 12),
  );
  assertEquals(await gitOut(dir, "rev-parse", "main"), trunk);
  assertEquals(await targetExists(owed.worktree), false);
}

Deno.test("a post-landing note identity failure keeps the checkout until the retry it names records the note", async () => {
  await withTempDir(async (dir) => {
    await scaffoldEngine(dir);
    await writeConfig(dir, proofConfig("local"));
    await gitInit(dir);
    const owed = await landWithoutNoteIdentity(dir, "missing-identity");
    const retryFrom = await assertOwedNoteKept(dir, owed, owed.accepted);

    // Pool housekeeping keeps an owned checkout whose note is owed.
    const ready = await readySentinelPath(owed.worktree);
    assert(ready !== undefined);
    await Deno.writeTextFile(ready, "");
    const pruned = await runAgent(dir, ["worktree", "prune", "--yes"]);
    assertEquals(pruned.code, 0, pruned.output);
    assert(await targetExists(owed.worktree), pruned.output);

    // A retry that still cannot write the note keeps its own retry.
    const stillOwed = await runAgent(retryFrom, ["accept", "--json"], {
      env: NO_ATTRIBUTION,
    });
    assertEquals(await assertOwedNoteKept(dir, owed, stillOwed), retryFrom);
    assertEquals(await gitOut(dir, "rev-parse", "main"), owed.target);

    await restoreNoteIdentity(dir);
    await followNoteRetry(dir, owed, retryFrom, owed.target);
  });
});

Deno.test("a note retry after later landings records the note and leaves the trunk where they put it", async () => {
  await withTempDir(async (dir) => {
    await scaffoldEngine(dir);
    await writeConfig(dir, proofConfig("local"));
    await gitInit(dir);
    const owed = await landWithoutNoteIdentity(dir, "first");
    const retryFrom = await assertOwedNoteKept(dir, owed, owed.accepted);

    await restoreNoteIdentity(dir);
    const later = await land(dir, "second", NO_ATTRIBUTION);
    assertEquals(await gitOut(dir, "rev-parse", "main"), later.target);

    await followNoteRetry(dir, owed, retryFrom, later.target);
  });
});
