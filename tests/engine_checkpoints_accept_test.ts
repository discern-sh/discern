/**
 * The variance contract at `discern accept` (black-box, through the real
 * engine): a current declared-unmet conclusion refuses landing before any
 * effect with the `awaiting_variance` contract — criterion, evidence, and
 * rationale served, one complete decision required — until
 * `--confirmed --variance <id>` covers the exact declared-unmet set. Standing
 * grants never authorize a variance; the variance-id set must be exact; the
 * authorized landing binds the variances into the acceptance journal and the
 * landed Proof note's DSSE payload; and declared-met conclusions land through
 * ordinary acceptance untouched.
 */

import { assert, assertEquals, assertStringIncludes } from "@std/assert";
import { exists } from "@std/fs";
import { join } from "@std/path";
import { decodeBase64 } from "@std/encoding/base64";
import { withTempDir } from "./helpers.ts";
import {
  addWorktree,
  git,
  gitInit,
  gitOut,
  runAgent,
  scaffoldEngine,
  writeConfig,
  writeExecutable,
} from "./engine_helpers.ts";
import {
  AWAITING_DECLARATION_SLUG,
  AWAITING_VARIANCE_SLUG,
} from "../src/shared/declarations.ts";
import type {
  AcceptanceEvidenceData,
  AuthorizedVarianceData,
} from "../src/shared/result_schemas.ts";
import { AWAITING_CONSENT_SLUG } from "../src/shared/consent.ts";
import { HINTS } from "../src/shared/hints.ts";
import { assertHasHint } from "./hint_asserts.ts";

/** The wire fields these black-box assertions read from an `accept`
 * envelope. Presence claims are static; a field the engine omits fails its
 * assertion at runtime with `undefined`, which is the signal wanted. */
interface AcceptEnvelope {
  ok: boolean;
  verb: string;
  error?: string;
  message: string;
  hints?: string[];
  data: {
    consent?: { source: string; scopes?: string[] };
    variances?: AuthorizedVarianceData[];
    proof_line?: string;
  };
}

/** Decode a JSON result envelope. */
function parseJson(stdout: string): AcceptEnvelope {
  return JSON.parse(stdout.trim()) as AcceptEnvelope;
}

const CRITERION = "A changed surface is described in its docs before it lands.";
const RATIONALE = "The docs lag the new surface; a follow-up covers them.";

const CONFIG = `
[project]
slug = "engine-test"

[repository]
trunk = "main"

[jobs]
lint = "sh check.sh"

[checkpoints.api-review]
paths = ["api/**"]
criterion = "${CRITERION}"
`;

/** The same gate plus a trunk-recorded standing grant covering EVERY path the
 * effort changes — the authority that must still never cover a variance. */
const CONFIG_WITH_GRANT = `
[project]
slug = "engine-test"

[repository]
trunk = "main"

[jobs]
lint = "sh check.sh"

[scopes.api]
paths = ["api/**"]

[checkpoints.api-review]
scope = "api"
criterion = "${CRITERION}"

[acceptance]
pre_authorized = ["api"]
`;

const CHECK_OK = "#!/usr/bin/env sh\nexit 0\n";

/** Scaffold main + a worktree with one committed change under `api/`. */
async function checkpointedWorktree(
  dir: string,
  config: string = CONFIG,
): Promise<string> {
  await scaffoldEngine(dir);
  await writeConfig(dir, config);
  await writeExecutable(join(dir, "check.sh"), CHECK_OK);
  await gitInit(dir);
  const wt = await addWorktree(dir, "varianced");
  await Deno.mkdir(join(wt, "api"), { recursive: true });
  await Deno.writeTextFile(join(wt, "api", "surface.txt"), "endpoint\n");
  await git(wt, "add", "-A");
  await git(wt, "commit", "-q", "-m", "feat: extend the api", "--no-gpg-sign");
  return wt;
}

/** Drive the worktree to a green gate with a declared-unmet conclusion. */
async function greenWithUnmet(wt: string): Promise<void> {
  assertEquals((await runAgent(wt, ["done", "--json"])).code, 1);
  const green = await runAgent(wt, [
    "done",
    "--unmet",
    "api-review",
    "--why",
    RATIONALE,
    "--json",
  ]);
  assertEquals(green.code, 0, green.output);
}

/** The payload fields the landed-note assertions read. */
interface LandedNotePayload {
  subject: { commit: string };
  acceptance?: AcceptanceEvidenceData;
}

/** Decode the landed Proof note's DSSE payload at `commit`. */
async function landedNotePayload(
  dir: string,
  commit: string,
): Promise<LandedNotePayload> {
  const note = await gitOut(
    dir,
    "notes",
    "--ref=discern",
    "show",
    commit,
  );
  const envelope = JSON.parse(note) as { payload: string };
  return JSON.parse(
    new TextDecoder().decode(decodeBase64(envelope.payload)),
  ) as LandedNotePayload;
}

Deno.test("accept: a declared-unmet conclusion refuses with the complete owner decision, before any effect", async () => {
  await withTempDir(async (dir) => {
    const wt = await checkpointedWorktree(dir);
    await greenWithUnmet(wt);

    // Flagless: the variance contract leads (one complete decision), not the
    // bare consent refusal.
    const bare = await runAgent(wt, ["accept", "--json"]);
    assertEquals(bare.code, 1, bare.output);
    const env = parseJson(bare.stdout);
    assertEquals(env.ok, false);
    assertEquals(env.verb, "accept");
    assertEquals(env.error, AWAITING_VARIANCE_SLUG);
    // The serving: criterion, evidence, rationale, and the one decision.
    assertStringIncludes(env.message, "api-review");
    assertStringIncludes(env.message, CRITERION);
    assertStringIncludes(env.message, "api/surface.txt");
    assertStringIncludes(env.message, RATIONALE);
    assertStringIncludes(env.message, "declared unmet");
    assertStringIncludes(
      env.message,
      "accept --confirmed --variance api-review",
    );
    assertStringIncludes(env.message, "never authorize a variance");
    assertStringIncludes(env.message, "Nothing has been landed");
    assertHasHint(env, HINTS["accept-authorize-variance"], {
      ids: ["api-review"],
    });
    // No effects: worktree intact, nothing on the trunk.
    assert(await exists(wt));
    assertEquals(await exists(join(dir, "api", "surface.txt")), false);

    // --confirmed alone cannot land either: the decision must cover the
    // variance.
    const confirmedOnly = await runAgent(wt, [
      "accept",
      "--confirmed",
      "--json",
    ]);
    assertEquals(confirmedOnly.code, 1, confirmedOnly.output);
    const confirmedEnv = parseJson(confirmedOnly.stdout);
    assertEquals(confirmedEnv.error, AWAITING_VARIANCE_SLUG);
    assertStringIncludes(confirmedEnv.message, "missing: api-review");

    // --variance without --confirmed cannot land.
    const varianceOnly = await runAgent(wt, [
      "accept",
      "--variance",
      "api-review",
      "--json",
    ]);
    assertEquals(varianceOnly.code, 1, varianceOnly.output);
    assertEquals(parseJson(varianceOnly.stdout).error, AWAITING_VARIANCE_SLUG);
    assert(await exists(wt), "no refusal may touch the worktree");
  });
});

Deno.test("accept: the owner's complete decision lands, binding the variance into the journal's note and the result", async () => {
  await withTempDir(async (dir) => {
    const wt = await checkpointedWorktree(dir);
    await greenWithUnmet(wt);
    const landedSha = await gitOut(wt, "rev-parse", "HEAD");

    const r = await runAgent(wt, [
      "accept",
      "--confirmed",
      "--variance",
      "api-review",
      "--json",
    ]);
    assertEquals(r.code, 0, r.output);
    const env = parseJson(r.stdout);
    assertEquals(env.ok, true);
    assertEquals(env.data.consent, { source: "conversation" });
    // The authorized variance is distinct evidence in the result…
    assertEquals(env.data.variances?.length, 1);
    assertEquals(env.data.variances?.[0]?.checkpoint, "api-review");
    assertEquals(env.data.variances?.[0]?.why, RATIONALE);
    assert((env.data.variances?.[0]?.definition_hash.length ?? 0) > 0);
    assert((env.data.variances?.[0]?.subject.length ?? 0) > 0);
    // …and on the landing proof line, separate from consent.
    assertStringIncludes(
      env.data.proof_line ?? "",
      "landed with conversation consent",
    );
    assertStringIncludes(
      env.data.proof_line ?? "",
      "1 variance authorized by the owner",
    );
    assertStringIncludes(env.data.proof_line ?? "", "declared unmet");

    // The landing happened.
    assertEquals(await exists(wt), false, r.output);
    assert(await exists(join(dir, "api", "surface.txt")));

    // The landed Proof note's DSSE payload records the structured acceptance
    // evidence: conversation consent plus the exact variance binding.
    const payload = await landedNotePayload(dir, landedSha);
    assertEquals(payload.subject.commit, landedSha);
    assertEquals(payload.acceptance?.consent, { source: "conversation" });
    assertEquals(payload.acceptance?.variances.length, 1);
    assertEquals(payload.acceptance?.variances[0]?.checkpoint, "api-review");
    assertEquals(payload.acceptance?.variances[0]?.why, RATIONALE);
    assertEquals(
      payload.acceptance?.variances[0]?.definition_hash,
      env.data.variances?.[0]?.definition_hash,
    );
    assertEquals(
      payload.acceptance?.variances[0]?.subject,
      env.data.variances?.[0]?.subject,
    );
  });
});

Deno.test("accept: the variance-id set must be exact — extra, unknown, or declared-met ids are errors", async () => {
  await withTempDir(async (dir) => {
    const wt = await checkpointedWorktree(dir);
    await greenWithUnmet(wt);

    // Unknown id.
    const unknown = await runAgent(wt, [
      "accept",
      "--confirmed",
      "--variance",
      "api-review",
      "--variance",
      "no-such-checkpoint",
      "--json",
    ]);
    assertEquals(unknown.code, 1, unknown.output);
    const unknownEnv = parseJson(unknown.stdout);
    assertEquals(unknownEnv.error, "invalid_value");
    assertStringIncludes(unknownEnv.message, "no-such-checkpoint");
    assertStringIncludes(unknownEnv.message, "api-review");

    // A declared-met id is not variable: flip the conclusion, then name it.
    const flipped = await runAgent(wt, [
      "done",
      "--met",
      "api-review",
      "--json",
    ]);
    assertEquals(flipped.code, 0, flipped.output);
    const met = await runAgent(wt, [
      "accept",
      "--confirmed",
      "--variance",
      "api-review",
      "--json",
    ]);
    assertEquals(met.code, 1, met.output);
    const metEnv = parseJson(met.stdout);
    assertEquals(metEnv.error, "invalid_value");
    assertStringIncludes(metEnv.message, "declared met");
    assert(await exists(wt), "an invalid-variance error must land nothing");
  });
});

Deno.test("accept: standing grants land declared-met work but never authorize a variance", async () => {
  await withTempDir(async (dir) => {
    const wt = await checkpointedWorktree(dir, CONFIG_WITH_GRANT);
    await greenWithUnmet(wt);

    // The trunk-recorded grant covers every changed path — yet the unmet
    // conclusion still forces the owner's current-conversation decision.
    const granted = await runAgent(wt, ["accept", "--json"]);
    assertEquals(granted.code, 1, granted.output);
    assertEquals(parseJson(granted.stdout).error, AWAITING_VARIANCE_SLUG);
    assert(await exists(wt));

    // Control: replace the conclusion with declared met — the same grant now
    // lands without any conversation flag, proving the grant itself works and
    // only the variance forced the conversation.
    assertEquals(
      (await runAgent(wt, ["done", "--met", "api-review", "--json"])).code,
      0,
    );
    const landed = await runAgent(wt, ["accept", "--json"]);
    assertEquals(landed.code, 0, landed.output);
    const env = parseJson(landed.stdout);
    assertEquals(env.data.consent?.source, "standing-grant");
    assertEquals(env.data.variances, undefined);
    assertEquals(await exists(wt), false);
  });
});

Deno.test("accept: a stale conclusion routes back to done before any effect", async () => {
  await withTempDir(async (dir) => {
    const wt = await checkpointedWorktree(dir);
    await greenWithUnmet(wt);

    // A further committed edit to the matched path stales the conclusion
    // (the subject moved) — acceptance must route back to done, not serve a
    // variance decision for evidence that no longer stands.
    await Deno.writeTextFile(join(wt, "api", "surface.txt"), "endpoint v2\n");
    await git(wt, "add", "-A");
    await git(wt, "commit", "-q", "-m", "revise the api", "--no-gpg-sign");
    // Reconcile the episode to the new subject (and get served again).
    const reserved = await runAgent(wt, ["done", "--json"]);
    assertEquals(reserved.code, 1, reserved.output);
    assertEquals(parseJson(reserved.stdout).error, AWAITING_DECLARATION_SLUG);

    const r = await runAgent(wt, [
      "accept",
      "--confirmed",
      "--variance",
      "api-review",
      "--json",
    ]);
    assertEquals(r.code, 1, r.output);
    const env = parseJson(r.stdout);
    assertEquals(env.error, AWAITING_DECLARATION_SLUG);
    assertStringIncludes(env.message, "api-review");
    assertStringIncludes(env.message, "discern done");
    assertHasHint(env, HINTS["accept-declarations-stale"], {
      ids: ["api-review"],
    });
    assert(await exists(wt), "a precondition refusal must land nothing");
  });
});

Deno.test("accept: declared-met work needs no variance and keeps the ordinary consent contract", async () => {
  await withTempDir(async (dir) => {
    const wt = await checkpointedWorktree(dir);
    assertEquals((await runAgent(wt, ["done", "--json"])).code, 1);
    assertEquals(
      (await runAgent(wt, ["done", "--met", "api-review", "--json"])).code,
      0,
    );

    // No variance in play: the ordinary awaiting-consent contract leads.
    const bare = await runAgent(wt, ["accept", "--json"]);
    assertEquals(bare.code, 1, bare.output);
    assertEquals(parseJson(bare.stdout).error, AWAITING_CONSENT_SLUG);

    // A variance id with nothing to vary is an error, not a landing.
    const spurious = await runAgent(wt, [
      "accept",
      "--confirmed",
      "--variance",
      "api-review",
      "--json",
    ]);
    assertEquals(spurious.code, 1, spurious.output);
    assertEquals(parseJson(spurious.stdout).error, "invalid_value");

    // The clean decision lands, with no variance evidence anywhere.
    const landed = await runAgent(wt, ["accept", "--confirmed", "--json"]);
    assertEquals(landed.code, 0, landed.output);
    const env = parseJson(landed.stdout);
    assertEquals(env.data.variances, undefined);
    const landedSha = await gitOut(dir, "rev-parse", "main");
    const payload = await landedNotePayload(dir, landedSha);
    assertEquals(payload.acceptance?.consent, { source: "conversation" });
    assertEquals(payload.acceptance?.variances, []);
  });
});

Deno.test("accept: the variance refusal escapes the rationale and paths on the markdown surface", async () => {
  // The refusal message is the owner's consent moment and renders verbatim
  // under --markdown, so the agent's opaque rationale and the working-tree
  // path names must arrive inside the code-span escaping boundary, never as
  // live Markdown (links, emphasis, broken spans).
  await withTempDir(async (dir) => {
    const wt = await checkpointedWorktree(dir);
    await Deno.writeTextFile(join(wt, "api", "*wild*.txt"), "hostile name\n");
    await git(wt, "add", "-A");
    await git(wt, "commit", "-q", "-m", "hostile path", "--no-gpg-sign");
    assertEquals((await runAgent(wt, ["done", "--json"])).code, 1);
    const hostile =
      "Docs lag [x](https://evil.example) and *break* callers of `handler`.";
    assertEquals(
      (await runAgent(wt, [
        "done",
        "--unmet",
        "api-review",
        "--why",
        hostile,
        "--json",
      ])).code,
      0,
    );
    const md = await runAgent(wt, ["accept", "--markdown"]);
    assertEquals(md.code, 1, md.output);
    assertStringIncludes(md.stdout, "Rationale: ``" + hostile + "``");
    assertStringIncludes(md.stdout, "`api/*wild*.txt`");
  });
});
