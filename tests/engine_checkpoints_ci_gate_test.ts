/** Checkpoint ci gate journeys with independently owned fixtures. */
import { assert, assertEquals, assertStringIncludes } from "@std/assert";
import { join } from "@std/path";
import { readOpenQuestions } from "../src/engine/checkpoints/open_questions.ts";
import { AWAITING_DECLARATION_SLUG } from "../src/shared/declarations.ts";
import { HINTS } from "../src/shared/hints.ts";
import {
  adminMarker,
  CHECK_RED,
  CHECK_TOUCHES,
  checkpointObservationEvents,
  CONFIG_ADVISE,
  CONFIG_ONE_CHECKPOINT,
  decodedProofMarker,
  parseCheckpointGateJson,
  parseJson,
  proofMarker,
  sidecarMarker,
  worktreeWithApiChange,
} from "./engine_checkpoints_gate_fixture.ts";
import { git, runAgent, writeExecutable } from "./engine_helpers.ts";
import { withTempDir } from "./helpers.ts";
import { assertHasHint } from "./hint_asserts.ts";

Deno.test("done --ci: report mode reports a fired stop without recording review, and a CI environment never selects it", async (t) => {
  await withTempDir(async (dir) => {
    const wt = await worktreeWithApiChange(
      dir,
      CONFIG_ONE_CHECKPOINT,
      CHECK_TOUCHES,
    );

    await t.step(
      "done --ci: declaration flags refuse before every checkpoint and Gate write",
      async () => {
        const invocations = [
          ["done", "--ci", "--met", "api-review", "--json"],
          [
            "done",
            "--ci",
            "--unmet",
            "api-review",
            "--why",
            "not ready",
            "--json",
          ],
          ["done", "--ci", "--why", "not ready", "--json"],
        ];
        for (const args of invocations) {
          const result = await runAgent(wt, args);
          assertEquals(result.code, 1, result.output);
          assertEquals(parseJson(result.stdout).error, "invalid_arguments");
        }
        assertEquals(
          await adminMarker(wt, "checkpointOpenQuestions"),
          undefined,
        );
        assertEquals(await adminMarker(wt, "gateProof"), undefined);
        assertEquals(await adminMarker(wt, "lastGateRun"), undefined);
        assertEquals(await sidecarMarker(wt, "gate-ran.log"), "");
        assertEquals(await checkpointObservationEvents(dir), 0);
      },
    );

    await t.step(
      "done --ci: a fresh checkout reports a fired stop and lets machine jobs decide the exit",
      async () => {
        const openBefore = await adminMarker(wt, "checkpointOpenQuestions");
        const observationsBefore = await checkpointObservationEvents(dir);
        const r = await runAgent(wt, ["done", "--ci", "--json"]);
        assertEquals(r.code, 0, r.output);
        const env = parseCheckpointGateJson(r.stdout);
        assertEquals(env.ok, true);
        assertEquals(env.data.checkpoints.review?.enforcement, "reported");
        assertEquals(
          env.data.checkpoints.review?.unreviewed?.[0]?.id,
          "api-review",
        );
        assertStringIncludes(await sidecarMarker(wt, "gate-ran.log"), "ran");
        assertEquals((await readOpenQuestions(wt)).status, "missing");
        assertEquals(
          await adminMarker(wt, "checkpointOpenQuestions"),
          openBefore,
          "report mode must preserve every open-question/declaration byte",
        );
        assertEquals(
          await checkpointObservationEvents(dir),
          observationsBefore,
          "report mode must record no checkpoint lifecycle event",
        );
        const marker = await proofMarker(wt);
        assertEquals(decodedProofMarker(marker).mode, "report");
        assertStringIncludes(marker, "reported, not enforced");
        // Report mode never manufactures declarations beside its review fact.
        assertEquals(env.data.checkpoints.declared_met ?? [], []);
        assertEquals(env.data.checkpoints.declared_unmet ?? [], []);
      },
    );

    await t.step(
      "done: a CI environment never selects report mode and only tailors the strict recovery",
      async () => {
        // The report lane is the explicit flag; environment detection improves
        // guidance only. A bare strict run under a CI marker still refuses with
        // the full serving, writes the ordinary open question, and adds the
        // CI-specific recovery hint naming both legitimate routes.
        const ci = await runAgent(wt, ["done", "--json"], {
          env: { CI: "true" },
        });
        assertEquals(ci.code, 1, ci.output);
        const envelope = parseCheckpointGateJson(ci.stdout);
        assertEquals(envelope.error, AWAITING_DECLARATION_SLUG);
        assertEquals(
          envelope.data.checkpoints.review,
          undefined,
          "a CI environment must not switch the strict gate into report mode",
        );
        assertHasHint(envelope, HINTS["checkpoint-ci-recovery"]);
        assertEquals(
          (await readOpenQuestions(wt)).status,
          "ok",
          "the strict refusal still records its open question under CI",
        );

        const local = await runAgent(wt, ["done", "--json"]);
        assertEquals(local.code, 1, local.output);
        const localEnvelope = parseJson(local.stdout);
        const ciHint = (localEnvelope.hints ?? []).filter((hint) =>
          hint.includes("--ci")
        );
        assertEquals(
          ciHint,
          [],
          "outside CI the refusal keeps the ordinary declaration guidance only",
        );
      },
    );
  });
});

Deno.test("done --ci: red jobs remain red; advise questions are reported without checkpoint writes", async () => {
  await withTempDir(async (dir) => {
    const red = await worktreeWithApiChange(dir, CONFIG_ADVISE, CHECK_RED);
    const result = await runAgent(red, ["done", "--ci", "--json"]);
    assertEquals(result.code, 1, result.output);
    const env = parseCheckpointGateJson(result.stdout);
    assertEquals(env.ok, false);
    assertEquals(env.data.checkpoints.review?.enforcement, "reported");
    assertEquals(env.data.checkpoints.review?.unreviewed, undefined);
    assertEquals(env.data.checkpoints.advise?.[0]?.id, "api-review");
    assertEquals(await adminMarker(red, "checkpointOpenQuestions"), undefined);
    assertEquals(await checkpointObservationEvents(dir), 0);
  });
});

Deno.test("done --dry-run --ci: previews report mode without running when or writing state", async () => {
  await withTempDir(async (dir) => {
    const config = `${CONFIG_ONE_CHECKPOINT}\nwhen = "sh probe.sh"\n`;
    const wt = await worktreeWithApiChange(dir, config);
    await writeExecutable(
      join(wt, "probe.sh"),
      "#!/usr/bin/env sh\necho ran > ../probe-ran.log\nexit 0\n",
    );
    await git(wt, "add", "probe.sh");
    await git(wt, "commit", "-q", "-m", "add probe", "--no-gpg-sign");

    const result = await runAgent(wt, ["done", "--dry-run", "--ci", "--json"]);
    assertEquals(result.code, 0, result.output);
    const env = parseJson(result.stdout);
    assertEquals(env.dry_run, true);
    assert(env.plan?.details?.includes("mode: report"));
    assertEquals(await sidecarMarker(wt, "probe-ran.log"), "");
    assertEquals(await adminMarker(wt, "checkpointOpenQuestions"), undefined);
    assertEquals(await adminMarker(wt, "gateProof"), undefined);
    assertEquals(await adminMarker(wt, "lastGateRun"), undefined);
    assertEquals(await checkpointObservationEvents(dir), 0);
  });
});
