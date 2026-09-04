/**
 * The variance contract at `discern accept` (black-box, through the real
 * engine): a current declared-unmet conclusion refuses landing before any
 * effect with the `awaiting_variance` contract — question, evidence, and
 * rationale served, one complete decision required — until
 * `--confirmed --variance <id>` covers the exact declared-unmet set. Standing
 * grants never authorize a variance; the variance-id set must be exact; the
 * authorized landing binds the variances into the acceptance journal and the
 * landed Proof note's DSSE payload; and declared-met conclusions land through
 * ordinary acceptance untouched.
 *
 * Guards: boundary:landing-authority, claim:gate-grants-no-authority
 */

import { assert, assertEquals, assertStringIncludes } from "@std/assert";
import { targetExists } from "../src/shared/fs_presence.ts";
import { join } from "@std/path";
import { decodeBase64 } from "@std/encoding/base64";
import { assertTerminalTextIncludes, withTempDir } from "./helpers.ts";
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
import { ProofNotePayloadSchema } from "../src/shared/result_schemas.ts";
import { AWAITING_CONSENT_SLUG } from "../src/shared/consent.ts";
import { HINTS } from "../src/shared/hints.ts";
import { assertHasHint } from "./hint_asserts.ts";
import { gitAdminStatePath } from "../src/shared/git_admin_state.ts";
import { z } from "@zod/zod";
import {
  assertResultDataKey,
  type CliResultForCommand,
  decodeCliResult,
  decodeWith,
} from "./decode_cli_result.ts";

type AcceptEnvelope = CliResultForCommand<"accept">;

type AcceptWireData = Exclude<
  NonNullable<AcceptEnvelope["data"]>,
  { issues: unknown }
>;

type AcceptMessageEnvelope = AcceptEnvelope & { message: string };

type CheckpointDropAcceptEnvelope = Omit<AcceptEnvelope, "data"> & {
  data: AcceptWireData & {
    checkpoint_drops: NonNullable<AcceptWireData["checkpoint_drops"]>;
  };
};

type AppliedAcceptEnvelope = Omit<AcceptEnvelope, "data"> & {
  data: AcceptWireData & {
    root: string;
    consent: NonNullable<AcceptWireData["consent"]>;
  };
};

const DSSE_ENVELOPE_SCHEMA = z.object({ payload: z.string() }).passthrough();

/** Decode one accept envelope without requiring review or landing data. */
function parseAcceptJson(stdout: string): AcceptEnvelope {
  return decodeCliResult(stdout, "accept");
}

/** Decode an accept refusal whose assertions consume its authored message. */
function parseAcceptMessageJson(stdout: string): AcceptMessageEnvelope {
  const result = parseAcceptJson(stdout);
  assert(typeof result.message === "string");
  return { ...result, message: result.message };
}

/** Decode an accept review whose assertions consume checkpoint-drop evidence. */
function parseCheckpointDropAcceptJson(
  stdout: string,
): CheckpointDropAcceptEnvelope {
  const result = parseAcceptJson(stdout);
  assertResultDataKey(result, "checkpoint_drops");
  assert(result.data.checkpoint_drops !== undefined);
  return {
    ...result,
    data: {
      ...result.data,
      checkpoint_drops: result.data.checkpoint_drops,
    },
  };
}

/** Decode an acceptance that crossed the landing boundary. */
function parseAppliedAcceptJson(stdout: string): AppliedAcceptEnvelope {
  const result = parseAcceptJson(stdout);
  assertResultDataKey(result, "root");
  assert(typeof result.data.root === "string");
  assert(result.data.consent !== undefined);
  return {
    ...result,
    data: {
      ...result.data,
      root: result.data.root,
      consent: result.data.consent,
    },
  };
}

const QUESTION = "A changed surface is described in its docs before it lands.";
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
question = "${QUESTION}"
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
question = "${QUESTION}"

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

/** Decode the landed Proof note's DSSE payload at `commit`. */
async function landedNotePayload(
  dir: string,
  commit: string,
): Promise<z.output<typeof ProofNotePayloadSchema>> {
  const note = await gitOut(
    dir,
    "notes",
    "--ref=discern",
    "show",
    commit,
  );
  const envelope = decodeWith(DSSE_ENVELOPE_SCHEMA, note);
  return decodeWith(
    ProofNotePayloadSchema,
    new TextDecoder().decode(decodeBase64(envelope.payload)),
  );
}

Deno.test("accept: a declared-unmet conclusion refuses with the complete owner decision, before any effect", async () => {
  await withTempDir(async (dir) => {
    const wt = await checkpointedWorktree(dir);
    await greenWithUnmet(wt);

    // Flagless: the variance contract leads (one complete decision), not the
    // bare consent refusal.
    const bare = await runAgent(wt, ["accept", "--json"]);
    assertEquals(bare.code, 1, bare.output);
    const env = parseAcceptMessageJson(bare.stdout);
    assertEquals(env.ok, false);
    assertEquals(env.verb, "accept");
    assertEquals(env.error, AWAITING_VARIANCE_SLUG);
    // The serving: question, evidence, rationale, and the one decision.
    assertStringIncludes(env.message, "api-review");
    assertStringIncludes(env.message, QUESTION);
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
    assert(await targetExists(wt));
    assertEquals(await targetExists(join(dir, "api", "surface.txt")), false);

    // --confirmed alone cannot land either: the decision must cover the
    // variance.
    const confirmedOnly = await runAgent(wt, [
      "accept",
      "--confirmed",
      "--json",
    ]);
    assertEquals(confirmedOnly.code, 1, confirmedOnly.output);
    const confirmedEnv = parseAcceptMessageJson(confirmedOnly.stdout);
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
    assertEquals(
      parseAcceptJson(varianceOnly.stdout).error,
      AWAITING_VARIANCE_SLUG,
    );
    assert(await targetExists(wt), "no refusal may touch the worktree");
  });
});

Deno.test("accept: report-mode Proof is non-landable in preview and apply", async () => {
  await withTempDir(async (dir) => {
    const wt = await checkpointedWorktree(dir);
    const reported = await runAgent(wt, ["done", "--ci", "--json"]);
    assertEquals(reported.code, 0, reported.output);

    const store = await gitAdminStatePath(wt, "checkpointOpenQuestions");
    assert(store !== undefined);
    await Deno.writeTextFile(store, "not json\n");

    const preview = await runAgent(wt, ["accept", "--dry-run", "--json"]);
    assertEquals(preview.code, 1, preview.output);
    const previewResult = parseAcceptMessageJson(preview.stdout);
    assertEquals(previewResult.error, "report_only_proof");
    assertTerminalTextIncludes(
      previewResult.message,
      "discern done",
    );

    const apply = await runAgent(wt, ["accept", "--confirmed", "--json"]);
    assertEquals(apply.code, 1, apply.output);
    assertEquals(parseAcceptJson(apply.stdout).error, "report_only_proof");
    assert(await targetExists(wt), "report-mode Proof must land nothing");
  });
});

Deno.test("accept: an indeterminate stop serves full evidence and excludes recorded grants", async () => {
  await withTempDir(async (dir) => {
    const config = CONFIG_WITH_GRANT.replace(
      `question = "${QUESTION}"`,
      `question = "${QUESTION}"\nwhen = "exit 7"`,
    );
    const wt = await checkpointedWorktree(dir, config);
    const served = await runAgent(wt, ["done", "--json"]);
    assertEquals(served.code, 1, served.output);
    const servedResult = decodeCliResult(served.stdout, "done");
    assertEquals(servedResult.error, AWAITING_DECLARATION_SLUG);
    assertStringIncludes(servedResult.message ?? "", "api/surface.txt");

    const gate = await runAgent(wt, [
      "done",
      "--met",
      "api-review",
      "--json",
    ]);
    assertEquals(gate.code, 0, gate.output);

    const preview = await runAgent(wt, ["accept", "--dry-run", "--json"]);
    assertEquals(preview.code, 0, preview.output);
    assertEquals(
      parseCheckpointDropAcceptJson(preview.stdout).data.checkpoint_drops[0]
        ?.reason,
      "when_invalid_exit",
    );

    // The standing grant covers the changed scope, but indeterminate stop
    // evidence deliberately requires this conversation's boolean attestation.
    const review = await runAgent(wt, ["accept", "--json"]);
    assertEquals(review.code, 1, review.output);
    const reviewEnv = parseCheckpointDropAcceptJson(review.stdout);
    assertEquals(reviewEnv.error, AWAITING_CONSENT_SLUG);
    assertEquals(
      reviewEnv.data.checkpoint_drops?.[0]?.reason,
      "when_invalid_exit",
    );

    const landedSha = await gitOut(wt, "rev-parse", "HEAD");
    const apply = await runAgent(wt, ["accept", "--confirmed", "--json"]);
    assertEquals(apply.code, 0, apply.output);
    const applied = parseAppliedAcceptJson(apply.stdout);
    assertEquals(applied.data.root, await Deno.realPath(dir));
    assertEquals(applied.data.consent, { source: "conversation" });
    assertEquals(
      applied.data.checkpoint_drops?.[0]?.reason,
      "when_invalid_exit",
    );

    const payload = await landedNotePayload(dir, landedSha);
    assertEquals(
      payload.proof?.checkpoint_drops?.[0]?.reason,
      "when_invalid_exit",
    );
  });
});

Deno.test("accept: unreadable declaration evidence refuses before landing", async () => {
  await withTempDir(async (dir) => {
    const wt = await checkpointedWorktree(dir);
    const gate = await runAgent(wt, [
      "done",
      "--met",
      "api-review",
      "--json",
    ]);
    assertEquals(gate.code, 0, gate.output);
    const policyCommit = await gitOut(wt, "merge-base", "main", "HEAD");

    // The strict Proof was recorded against readable declaration state. This
    // corruption is first observable by proof inspection and acceptance.
    const store = await gitAdminStatePath(wt, "checkpointOpenQuestions");
    assert(store !== undefined);
    await Deno.writeTextFile(store, "not json\n");
    const liveDrop = (envelope: CheckpointDropAcceptEnvelope) =>
      envelope.data.checkpoint_drops.find((drop) =>
        drop.reason === "open_question_store_corrupt"
      );
    const declarationDrop = (envelope: CheckpointDropAcceptEnvelope) =>
      envelope.data.checkpoint_drops.find((drop) =>
        drop.reason === "declaration_evidence_unavailable"
      );

    const preview = await runAgent(wt, ["accept", "--dry-run", "--json"]);
    assertEquals(preview.code, 0, preview.output);
    assertEquals(
      liveDrop(parseCheckpointDropAcceptJson(preview.stdout))?.policy_commit,
      policyCommit,
    );

    const review = await runAgent(wt, ["accept", "--json"]);
    assertEquals(review.code, 1, review.output);
    const reviewEnv = parseCheckpointDropAcceptJson(review.stdout);
    assertEquals(reviewEnv.error, "checkpoint_evidence_unavailable");
    assertStringIncludes(
      declarationDrop(reviewEnv)?.account ?? "",
      "declaration evidence could not be read",
    );

    const apply = await runAgent(wt, ["accept", "--confirmed", "--json"]);
    assertEquals(apply.code, 1, apply.output);
    assertEquals(
      parseAcceptJson(apply.stdout).error,
      "checkpoint_evidence_unavailable",
    );
    assert(
      parseCheckpointDropAcceptJson(apply.stdout).data.checkpoint_drops.some(
        (drop) => drop.reason === "declaration_evidence_unavailable",
      ),
    );
    assert(await targetExists(wt), "unreadable declarations must land nothing");
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
    const env = parseAppliedAcceptJson(r.stdout);
    assertEquals(env.ok, true);
    assertEquals(env.data.consent, { source: "conversation" });
    // The authorized variance is distinct evidence in the result…
    assertEquals(env.data.variances?.length, 1);
    assertEquals(env.data.variances?.[0]?.checkpoint, "api-review");
    assertEquals(env.data.variances?.[0]?.why, RATIONALE);
    assert((env.data.variances?.[0]?.definition_hash.length ?? 0) > 0);
    assert((env.data.variances?.[0]?.subject.length ?? 0) > 0);
    // …and on the landing proof line the unmet segment resolves in place,
    // separate from consent — no "required to land" demand survives landing.
    assertStringIncludes(
      env.data.proof_line ?? "",
      "landed with conversation consent",
    );
    assertStringIncludes(
      env.data.proof_line ?? "",
      "1 declared unmet — variance authorized by the owner",
    );
    assertEquals(
      (env.data.proof_line ?? "").includes("required to land"),
      false,
    );

    // The landing happened.
    assertEquals(await targetExists(wt), false, r.output);
    assert(await targetExists(join(dir, "api", "surface.txt")));

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
    const unknownEnv = parseAcceptMessageJson(unknown.stdout);
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
    const metEnv = parseAcceptMessageJson(met.stdout);
    assertEquals(metEnv.error, "invalid_value");
    assertStringIncludes(metEnv.message, "declared met");
    assert(
      await targetExists(wt),
      "an invalid-variance error must land nothing",
    );
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
    assertEquals(
      parseAcceptJson(granted.stdout).error,
      AWAITING_VARIANCE_SLUG,
    );
    assert(await targetExists(wt));

    // Control: replace the conclusion with declared met — the same grant now
    // lands without any conversation flag, proving the grant itself works and
    // only the variance forced the conversation.
    assertEquals(
      (await runAgent(wt, ["done", "--met", "api-review", "--json"])).code,
      0,
    );
    const landed = await runAgent(wt, ["accept", "--json"]);
    assertEquals(landed.code, 0, landed.output);
    const env = parseAppliedAcceptJson(landed.stdout);
    assertEquals(env.data.consent?.source, "standing-grant");
    assertEquals(env.data.variances, undefined);
    assertEquals(await targetExists(wt), false);
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
    // Reconcile the open question to the new subject (and get served again).
    const reserved = await runAgent(wt, ["done", "--json"]);
    assertEquals(reserved.code, 1, reserved.output);
    const reservedResult = decodeCliResult(reserved.stdout, "done");
    assertEquals(reservedResult.verb, "done");
    assertEquals(reservedResult.error, AWAITING_DECLARATION_SLUG);

    const r = await runAgent(wt, [
      "accept",
      "--confirmed",
      "--variance",
      "api-review",
      "--json",
    ]);
    assertEquals(r.code, 1, r.output);
    const env = parseAcceptMessageJson(r.stdout);
    assertEquals(env.error, AWAITING_DECLARATION_SLUG);
    assertStringIncludes(env.message, "api-review");
    assertStringIncludes(env.message, "discern done");
    assertHasHint(env, HINTS["accept-declarations-stale"], {
      ids: ["api-review"],
    });
    assert(await targetExists(wt), "a precondition refusal must land nothing");
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
    assertEquals(parseAcceptJson(bare.stdout).error, AWAITING_CONSENT_SLUG);

    // A variance id with nothing to vary is an error, not a landing.
    const spurious = await runAgent(wt, [
      "accept",
      "--confirmed",
      "--variance",
      "api-review",
      "--json",
    ]);
    assertEquals(spurious.code, 1, spurious.output);
    assertEquals(parseAcceptJson(spurious.stdout).error, "invalid_value");

    // The clean decision lands, with no variance evidence anywhere.
    const landed = await runAgent(wt, ["accept", "--confirmed", "--json"]);
    assertEquals(landed.code, 0, landed.output);
    const env = parseAppliedAcceptJson(landed.stdout);
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
    assertTerminalTextIncludes(md.stdout, "Rationale: ``" + hostile + "``");
    assertStringIncludes(md.stdout, "`api/*wild*.txt`");
  });
});

Deno.test("accept: the human variance refusal keeps authored paragraphs on real lines", async () => {
  // The owner review moment is a multi-paragraph product message; its authored
  // newlines must reach the terminal as line structure, never as visible
  // newline symbols from a single-line sink.
  await withTempDir(async (dir) => {
    const wt = await checkpointedWorktree(dir);
    await greenWithUnmet(wt);
    const human = await runAgent(wt, ["accept"], {
      env: { COLUMNS: "200", NO_COLOR: "1" },
    });
    assertEquals(human.code, 1, human.output);
    assert(
      !human.output.includes("␊"),
      `authored refusal newlines leaked as visible symbols:\n${human.output}`,
    );
    assert(
      /\n\s*Question: /.test(human.output),
      `the question must open its own line:\n${human.output}`,
    );
    assert(
      /\n\s*Rationale: /.test(human.output),
      `the rationale must open its own line:\n${human.output}`,
    );
    assertTerminalTextIncludes(human.output, RATIONALE);
  });
});
