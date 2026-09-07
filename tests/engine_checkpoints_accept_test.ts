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
import { join } from "@std/path";
import { AWAITING_CONSENT_SLUG } from "../src/shared/consent.ts";
import { AWAITING_VARIANCE_SLUG } from "../src/shared/declarations.ts";
import { targetExists } from "../src/shared/fs_presence.ts";
import { HINTS } from "../src/shared/hints.ts";
import {
  checkpointedWorktree,
  CONFIG_WITH_GRANT,
  greenWithUnmet,
  landedNotePayload,
  parseAcceptJson,
  parseAcceptMessageJson,
  parseAppliedAcceptJson,
  QUESTION,
  RATIONALE,
} from "./engine_checkpoints_accept_fixture.ts";
import { gitOut, runAgent } from "./engine_helpers.ts";
import { withTempDir } from "./helpers.ts";
import { assertHasHint } from "./hint_asserts.ts";

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
      (env.hints ?? []).join("\n"),
      "accept --confirmed --variance api-review",
    );
    assertStringIncludes(
      (env.hints ?? []).join("\n"),
      "never authorize a variance",
    );
    assertStringIncludes(env.message, "0 prefixes landed");
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
    assertStringIncludes(confirmedEnv.message, "variance:api-review");

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
    assertEquals(env.prefix.consent, { source: "conversation" });
    // The authorized variance is distinct evidence in the result…
    assertEquals(env.prefix.variances?.length, 1);
    assertEquals(env.prefix.variances?.[0]?.checkpoint, "api-review");
    assertEquals(env.prefix.variances?.[0]?.why, RATIONALE);
    assert((env.prefix.variances?.[0]?.definition_hash.length ?? 0) > 0);
    assert((env.prefix.variances?.[0]?.subject.length ?? 0) > 0);
    // …and on the landing proof line the unmet segment resolves in place,
    // separate from consent — no "required to land" demand survives landing.
    assertStringIncludes(
      env.prefix.proof_line ?? "",
      "landed with conversation consent",
    );
    assertStringIncludes(
      env.prefix.proof_line ?? "",
      "1 declared unmet — variance authorized by the owner",
    );
    assertEquals(
      (env.prefix.proof_line ?? "").includes("required to land"),
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
      env.prefix.variances?.[0]?.definition_hash,
    );
    assertEquals(
      payload.acceptance?.variances[0]?.subject,
      env.prefix.variances?.[0]?.subject,
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
    assertEquals(env.prefix.consent?.source, "standing-grant");
    assertEquals(env.prefix.variances, []);
    assertEquals(await targetExists(wt), false);
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
    assertEquals(env.prefix.variances, []);
    const landedSha = await gitOut(dir, "rev-parse", "main");
    const payload = await landedNotePayload(dir, landedSha);
    assertEquals(payload.acceptance?.consent, { source: "conversation" });
    assertEquals(payload.acceptance?.variances, []);
  });
});
