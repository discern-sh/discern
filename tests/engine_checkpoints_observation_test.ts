/**
 * Checkpoint **observation** through the real engine (black-box): the Logbook
 * records the open question lifecycle as metadata — fired, reopened, declared
 * (with the unchanged/revised split and elapsed time), abandoned open
 * questions — while the unmet rationale, which the SAME invocations carry as
 * Proof evidence in their envelopes, never reaches a single Logbook byte.
 * Recording is observation, never a gate: every assertion here rides runs
 * whose outcomes the interlock already decided. The authorized-landing and
 * advise-serving observations ride the accept and report journeys that
 * already reach those states.
 *
 * Guards: boundary:local-private-evidence, claim:local-logbook
 */

import { assert, assertEquals } from "@std/assert";
import { join } from "@std/path";
import { withTempDir } from "./helpers.ts";
import {
  addWorktree,
  git,
  gitInit,
  runAgent,
  scaffoldEngine,
  writeConfig,
  writeExecutable,
} from "./engine_helpers.ts";
import { readLogbook } from "./engine_checkpoints_gate_fixture.ts";
import type { LogbookEvent, VerbEvent } from "../src/engine/logbook/schema.ts";

const QUESTION = "A changed surface is described in its docs before it lands.";

/** A rationale no other fixture text contains — the exclusion sentinel. */
const RATIONALE_SENTINEL =
  "Rationale-sentinel-2b9d1 the docs lag this surface.";

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

/** The abandoned-openQuestion flow runs `update`, which re-materializes provider
 * artifacts into the worktree; `agents = []` keeps that flow free of
 * untracked provider files so acceptance judges only the effort's own tree. */
const CONFIG_RETIREABLE = `
[project]
slug = "engine-test"
agents = []

[repository]
trunk = "main"

[jobs]
lint = "sh check.sh"

[checkpoints.api-review]
paths = ["api/**"]
question = "${QUESTION}"
`;

/** The same gate with no checkpoint at all — the trunk edit that retires one. */
const CONFIG_RETIRED = `
[project]
slug = "engine-test"
agents = []

[repository]
trunk = "main"

[jobs]
lint = "sh check.sh"
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
  const wt = await addWorktree(dir, "observed");
  await Deno.mkdir(join(wt, "api"), { recursive: true });
  await Deno.writeTextFile(join(wt, "api", "surface.txt"), "endpoint\n");
  await git(wt, "add", "-A");
  await git(wt, "commit", "-q", "-m", "feat: extend the api", "--no-gpg-sign");
  return wt;
}

/** The `done` verb events carrying a checkpoints block, in order. */
function checkpointDones(events: LogbookEvent[]): VerbEvent[] {
  return events.filter((event): event is VerbEvent =>
    event.kind === "verb" && event.verb === "done" &&
    event.checkpoints !== undefined
  );
}

Deno.test("observation: the open-question lifecycle records as metadata and the rationale never enters the Logbook", async () => {
  await withTempDir(async (dir) => {
    const wt = await checkpointedWorktree(dir);

    // 1. The serving: a bare `done` refuses and opens the open question (fired).
    assertEquals((await runAgent(wt, ["done", "--json"])).code, 1);
    // 2. Declared unmet on the unchanged subject — the rationale rides the
    //    envelope and the Proof; the Logbook must never see it.
    assertEquals(
      (await runAgent(wt, [
        "done",
        "--unmet",
        "api-review",
        "--why",
        RATIONALE_SENTINEL,
        "--json",
      ])).code,
      0,
    );
    // 3. A relevant revision, then declared met in the same invocation: the
    //    reconciliation reopens the subject and the declaration binds to the
    //    revised one.
    await Deno.writeTextFile(
      join(wt, "api", "surface.txt"),
      "endpoint\ndocumented\n",
    );
    await git(wt, "add", "-A");
    await git(wt, "commit", "-q", "-m", "docs: describe it", "--no-gpg-sign");
    assertEquals(
      (await runAgent(wt, ["done", "--met", "api-review", "--json"])).code,
      0,
    );

    const { raw, events } = await readLogbook(dir);
    assert(
      !raw.includes(RATIONALE_SENTINEL),
      "the unmet rationale is Proof evidence and must never reach the Logbook",
    );
    // The flag NAME `why` is legitimate metadata (values never land); a
    // rationale FIELD — a `why` key on any object — must never exist.
    assert(
      !raw.includes('"why":'),
      "no Logbook object may carry a rationale field",
    );

    const dones = checkpointDones(events);
    // The refusal that served the checkpoint records the firing.
    const fired = dones.find((event) => event.checkpoints?.fired !== undefined);
    assert(fired !== undefined, "the serving run must record a fired entry");
    assertEquals(fired.outcome, "refused");
    const firing = fired.checkpoints?.fired?.[0];
    assertEquals(firing?.id, "api-review");
    assert(typeof firing?.definition === "string");
    assert(typeof firing?.subject === "string");

    // The unmet declaration: unchanged subject, conclusion only, timed.
    const declarations = dones.flatMap((event) =>
      event.checkpoints?.declared ?? []
    );
    assertEquals(declarations.length, 2);
    const unmet = declarations[0];
    assertEquals(unmet?.conclusion, "unmet");
    assertEquals(unmet?.revised, false);
    assert(typeof unmet?.elapsed_ms === "number" && unmet.elapsed_ms >= 0);
    assertEquals(unmet?.subject, firing?.subject);

    // The met declaration after the relevant revision: the same invocation
    // reopened the subject first, and the declaration binds to the new one.
    const met = declarations[1];
    assertEquals(met?.conclusion, "met");
    assertEquals(met?.revised, true);
    const reopened = dones.flatMap((event) =>
      event.checkpoints?.reopened ?? []
    );
    assertEquals(reopened.length, 1);
    assertEquals(reopened[0]?.id, "api-review");
    assert(reopened[0]?.subject !== firing?.subject);
    assertEquals(met?.subject, reopened[0]?.subject);
  });
});

Deno.test("observation: an open question the effort ends on records as abandoned at the landing", async () => {
  await withTempDir(async (dir) => {
    const wt = await checkpointedWorktree(dir, CONFIG_RETIREABLE);
    // The serving opens the open question; no conclusion is ever declared.
    assertEquals((await runAgent(wt, ["done", "--json"])).code, 1);

    // The trunk retires the checkpoint; `update` advances the governing
    // policy, so the open question is no longer a governing stop — the gate runs
    // green and the landing may proceed, ending the effort on an open question
    // still awaiting its conclusion.
    await writeConfig(dir, CONFIG_RETIRED);
    await git(dir, "add", "-A");
    await git(
      dir,
      "commit",
      "-q",
      "-m",
      "retire the checkpoint",
      "--no-gpg-sign",
    );
    assertEquals((await runAgent(wt, ["update", "--json"])).code, 0);
    assertEquals((await runAgent(wt, ["done", "--json"])).code, 0);
    const landed = await runAgent(wt, ["accept", "--confirmed", "--json"]);
    assertEquals(landed.code, 0, landed.output);

    const { events } = await readLogbook(dir);
    const accept = events.find((event): event is VerbEvent =>
      event.kind === "verb" && event.verb === "accept" &&
      event.checkpoints !== undefined
    );
    assert(accept !== undefined, "the landing must record its observations");
    assertEquals(accept.checkpoints?.abandoned, [{ id: "api-review" }]);
    assertEquals(accept.checkpoints?.variances, undefined);
  });
});
