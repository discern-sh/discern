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
 * Each journey builds one declared fixture and walks the refusals it serves
 * before its one landing; the variance contract's surface matrix rides the
 * first journey, driven off `VARIANCE_GATED_ACCEPTANCE`.
 *
 * Guards: boundary:landing-authority, claim:gate-grants-no-authority
 */

import { assert, assertEquals, assertStringIncludes } from "@std/assert";
import { join } from "@std/path";
import { AWAITING_CONSENT_SLUG } from "../src/shared/consent.ts";
import {
  AWAITING_DECLARATION_SLUG,
  AWAITING_VARIANCE_SLUG,
  VARIANCE_GATED_ACCEPTANCE,
} from "../src/shared/declarations.ts";
import { targetExists } from "../src/shared/fs_presence.ts";
import { HINTS } from "../src/shared/hints.ts";
import { decodeCliResult } from "./decode_cli_result.ts";
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
import { readLogbook } from "./engine_checkpoints_gate_fixture.ts";
import {
  jsonSurface,
  markdownSurface,
  mcpSurface,
  runMcp,
  type SurfaceObservation,
  terminalSurface,
} from "./engine_checkpoints_surfaces.ts";
import { git, gitOut, runAgent } from "./engine_helpers.ts";
import { assertTerminalTextIncludes, withTempDir } from "./helpers.ts";
import { assertHasHint } from "./hint_asserts.ts";

type VarianceSurface = (typeof VARIANCE_GATED_ACCEPTANCE.surfaces)[number];

Deno.test("accept: a declared-unmet conclusion refuses with the complete owner decision on every surface, and the variance-id set must be exact", async (t) => {
  await withTempDir(async (dir) => {
    const wt = await checkpointedWorktree(dir);
    await greenWithUnmet(wt);
    const surfaces: Partial<Record<VarianceSurface, SurfaceObservation>> = {};

    await t.step(
      "a declared-unmet conclusion refuses with the complete owner decision, before any effect",
      async () => {
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
        assertEquals(
          await targetExists(join(dir, "api", "surface.txt")),
          false,
        );
        surfaces.json = jsonSurface(bare, env);
        surfaces.markdown = markdownSurface(bare, env, "accept");

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
      },
    );

    await t.step(
      "the human variance refusal keeps authored paragraphs on real lines",
      async () => {
        // The owner review moment is a multi-paragraph product message; its
        // authored newlines must reach the terminal as line structure, never as
        // visible newline symbols from a single-line sink.
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
        surfaces.terminal = terminalSurface(human, AWAITING_VARIANCE_SLUG);
      },
    );

    await t.step(
      "variance contract: every declared surface serves the same complete decision",
      async () => {
        surfaces.mcp = mcpSurface(await runMcp("discern_accept", wt, {}));
        const meaning = [
          "api-review",
          QUESTION,
          RATIONALE,
          "declared unmet",
          "--confirmed",
          "--variance",
          "never authorize a variance",
          "0 prefixes landed",
        ];
        assertEquals(
          Object.keys(surfaces).sort(),
          [...VARIANCE_GATED_ACCEPTANCE.surfaces].sort(),
          "observe every declared public surface",
        );
        for (const surface of VARIANCE_GATED_ACCEPTANCE.surfaces) {
          const observation = surfaces[surface];
          assert(observation !== undefined, `missing ${surface} observation`);
          assert(observation.refused, `${surface} must refuse`);
          assertEquals(
            observation.slug,
            AWAITING_VARIANCE_SLUG,
            `${surface} must carry the variance slug`,
          );
          for (const fact of meaning) {
            assertTerminalTextIncludes(
              observation.evidence,
              surface === "mcp" && fact.startsWith("--")
                ? fact.slice(2) + ":"
                : fact,
              `${surface} omits ${JSON.stringify(fact)}`,
            );
          }
        }
        // Every refusal above was read-only: worktree intact, trunk untouched.
        assert(await targetExists(wt));
        assertEquals(
          await targetExists(join(dir, "api", "surface.txt")),
          false,
        );
      },
    );

    await t.step(
      "the variance-id set must be exact — an unknown id is an error",
      async () => {
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
      },
    );

    await t.step(
      "the variance refusal escapes the rationale and paths on the markdown surface",
      async () => {
        // The refusal message is the owner's consent moment and renders verbatim
        // under --markdown, so the agent's opaque rationale and the working-tree
        // path names must arrive inside the code-span escaping boundary, never
        // as live Markdown (links, emphasis, broken spans). The hostile path
        // joins the matched set and reopens the question; the hostile rationale
        // concludes it unmet again.
        await Deno.writeTextFile(
          join(wt, "api", "*wild*.txt"),
          "hostile name\n",
        );
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
      },
    );

    await t.step(
      "the variance-id set must be exact — a declared-met id is not variable, and a variance with nothing to vary is an error",
      async () => {
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
      },
    );
  });
});

Deno.test("accept: declared-met work needs no variance and keeps the ordinary consent contract", async () => {
  // Its own fixture on purpose: an acceptance attempt followed by a head move
  // invalidates the queue entry, and a later landing then demands composition
  // in a released environment — so the clean landing cannot ride the refusal
  // journey above.
  await withTempDir(async (dir) => {
    const wt = await checkpointedWorktree(dir);
    assertEquals(
      (await runAgent(wt, ["done", "--met", "api-review", "--json"])).code,
      0,
    );

    // No variance in play: the ordinary awaiting-consent contract leads.
    const bare = await runAgent(wt, ["accept", "--json"]);
    assertEquals(bare.code, 1, bare.output);
    assertEquals(parseAcceptJson(bare.stdout).error, AWAITING_CONSENT_SLUG);

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

Deno.test("accept: a stale conclusion routes back to done, and the owner's complete decision lands binding the variance into the journal's note, the result, and the Logbook", async (t) => {
  await withTempDir(async (dir) => {
    const wt = await checkpointedWorktree(dir);
    await greenWithUnmet(wt);
    let landed = "";

    await t.step(
      "a stale conclusion routes back to done before any effect",
      async () => {
        // A further committed edit to the matched path stales the conclusion
        // (the subject moved) — acceptance must route back to done, not serve a
        // variance decision for evidence that no longer stands.
        await Deno.writeTextFile(
          join(wt, "api", "surface.txt"),
          "endpoint v2\n",
        );
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
        assertEquals(env.error, AWAITING_DECLARATION_SLUG, r.stdout);
        assertStringIncludes(env.message, "api-review");
        assertStringIncludes((env.hints ?? []).join("\n"), "discern done");
        assertHasHint(env, HINTS["accept-declarations-stale"], {
          ids: ["api-review"],
        });
        assert(
          await targetExists(wt),
          "a precondition refusal must land nothing",
        );
      },
    );

    await t.step(
      "the owner's complete decision lands, binding the variance into the journal's note and the result",
      async () => {
        // The revised subject concludes unmet again with the same rationale:
        // the current declared-unmet set the owner's decision must cover.
        const redeclared = await runAgent(wt, [
          "done",
          "--unmet",
          "api-review",
          "--why",
          RATIONALE,
          "--json",
        ]);
        assertEquals(redeclared.code, 0, redeclared.output);
        const landedSha = await gitOut(wt, "rev-parse", "HEAD");

        const r = await runAgent(wt, [
          "accept",
          "--confirmed",
          "--variance",
          "api-review",
          "--json",
        ]);
        assertEquals(r.code, 0, r.output);
        landed = r.stdout;
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
        assertEquals(
          payload.acceptance?.variances[0]?.checkpoint,
          "api-review",
        );
        assertEquals(payload.acceptance?.variances[0]?.why, RATIONALE);
        assertEquals(
          payload.acceptance?.variances[0]?.definition_hash,
          env.prefix.variances?.[0]?.definition_hash,
        );
        assertEquals(
          payload.acceptance?.variances[0]?.subject,
          env.prefix.variances?.[0]?.subject,
        );
      },
    );

    await t.step(
      "observation: an authorized landing records its variances by fingerprint, never by rationale",
      async () => {
        // The CONTRAST that defines the boundary: the landing's own envelope
        // serves the rationale as Proof evidence…
        assert(landed.includes(RATIONALE));

        // …while its Logbook event carries the variance as id + fingerprints
        // only. The rationale is Proof evidence; no Logbook byte may hold it,
        // and no Logbook object may carry a rationale field (the flag NAME
        // `why` is legitimate metadata; values never land).
        const { raw, events } = await readLogbook(dir);
        assert(!raw.includes(RATIONALE));
        assert(
          !raw.includes('"why":'),
          "no Logbook object may carry a rationale field",
        );
        const accept = events.find((event) =>
          event.kind === "verb" && event.verb === "accept" &&
          event.checkpoints !== undefined
        );
        assert(
          accept !== undefined && accept.kind === "verb",
          "the landing must record its observations",
        );
        assertEquals(accept.outcome, "ok");
        const variance = accept.checkpoints?.variances?.[0];
        assertEquals(variance?.id, "api-review");
        assert(typeof variance?.definition === "string");
        assert(typeof variance?.subject === "string");
        assertEquals(accept.checkpoints?.abandoned, undefined);
        const retry = await runAgent(dir, ["accept", "--json"]);
        assertEquals(retry.code, 0, retry.output);
        const repeated = await readLogbook(dir);
        assertEquals(
          repeated.events.filter((event) =>
            event.kind === "verb" && event.verb === "accept" &&
            event.checkpoints?.variances !== undefined
          ).length,
          1,
          "publication and cleanup retries cannot repeat the landing observation",
        );
        assert(!repeated.raw.includes(RATIONALE));
      },
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
