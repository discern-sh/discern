/**
 * The checkpoint READ surfaces (black-box, through the real engine):
 * `discern checkpoints` reports the governing policy, each episode's
 * declaration state, and a structural preview — without running a `when`
 * command, creating an episode, or recording anything — and routes an
 * awaiting question to the two valid `done` conclusions and a declared-unmet
 * one to the owner's variance review. `prepare` and `status` serve the same
 * preview through the advisory hint channel, projected from the ONE shape
 * `done --dry-run` also renders, so the three surfaces cannot disagree.
 */

import { assert, assertEquals, assertStringIncludes } from "@std/assert";
import { join } from "@std/path";
import { assertTerminalTextIncludes, withTempDir } from "./helpers.ts";
import {
  addWorktree,
  git,
  gitInit,
  runAgent,
  scaffoldEngine,
  writeConfig,
  writeExecutable,
} from "./engine_helpers.ts";
import { gitAdminStatePath } from "../src/shared/git_admin_state.ts";
import type { CheckpointsData } from "../src/shared/result_schemas.ts";
import { CheckpointsOutputSchema } from "../src/shared/result_schemas.ts";
import { HINTS } from "../src/shared/hints.ts";
import { assertHasHint, assertLacksHint } from "./hint_asserts.ts";
import { reconcileEpisode } from "../src/engine/checkpoints/episodes.ts";

/** The wire fields these assertions read from a `checkpoints` envelope. */
interface CheckpointsEnvelope {
  ok: boolean;
  verb: string;
  hints?: string[];
  data: CheckpointsData;
}

/** Decode and schema-validate one `checkpoints --json` envelope: every
 * asserted fact below is a fact about the PUBLISHED result shape. */
function parseCheckpoints(stdout: string): CheckpointsEnvelope {
  const envelope = JSON.parse(stdout.trim());
  CheckpointsOutputSchema.parse(envelope);
  return envelope as CheckpointsEnvelope;
}

/** A generic envelope carrying only what the preview assertions read. */
interface HintedEnvelope {
  ok: boolean;
  hints?: string[];
  plan?: { details?: string[] };
}

/** Decode one JSON envelope down to its hint channel. */
function parseHinted(stdout: string): HintedEnvelope {
  return JSON.parse(stdout.trim()) as HintedEnvelope;
}

const QUESTION_API =
  "A changed API surface is described in its docs before it lands.";

const CONFIG_STOP = `
[project]
slug = "engine-test"

[repository]
trunk = "main"

[jobs]
lint = "sh check.sh"

[checkpoints.api-review]
paths = ["api/**"]
question = "${QUESTION_API}"
teach = "State the failure modes; note what callers must revisit."
`;

const CONFIG_ADVISE = `
[project]
slug = "engine-test"

[repository]
trunk = "main"

[jobs]
lint = "sh check.sh"

[checkpoints.api-review]
paths = ["api/**"]
mode = "advise"
question = "${QUESTION_API}"
`;

const CONFIG_WHEN = `
[project]
slug = "engine-test"

[repository]
trunk = "main"

[jobs]
lint = "sh check.sh"

[checkpoints.api-review]
paths = ["api/**"]
when = "sh when-probe.sh"
question = "${QUESTION_API}"
`;

const CONFIG_NO_CHECKPOINTS = `
[project]
slug = "engine-test"

[repository]
trunk = "main"

[jobs]
lint = "sh check.sh"
`;

const CHECK_OK = "#!/usr/bin/env sh\nexit 0\n";

/** A `when` command that PROVES it ran by leaving a marker. A read surface
 * must never run it, so the marker must never appear from `checkpoints`. */
const WHEN_TOUCHES = "#!/usr/bin/env sh\necho ran >> ../when-ran.log\nexit 0\n";

/** Scaffold main with `config`, then a worktree carrying one committed change
 * under `api/` — the state the checkpoint's trigger holds against. */
async function worktreeWithApiChange(
  dir: string,
  config: string,
): Promise<string> {
  await scaffoldEngine(dir);
  await writeConfig(dir, config);
  await writeExecutable(join(dir, "check.sh"), CHECK_OK);
  await writeExecutable(join(dir, "when-probe.sh"), WHEN_TOUCHES);
  await gitInit(dir);
  const wt = await addWorktree(dir, "checkpointed");
  await Deno.mkdir(join(wt, "api"), { recursive: true });
  await Deno.writeTextFile(join(wt, "api", "surface.txt"), "endpoint\n");
  await git(wt, "add", "-A");
  await git(wt, "commit", "-q", "-m", "feat: extend the api", "--no-gpg-sign");
  return wt;
}

Deno.test("checkpoints: a checkpoint-free effort reports an empty governing set and stays quiet", async () => {
  await withTempDir(async (dir) => {
    const wt = await worktreeWithApiChange(dir, CONFIG_NO_CHECKPOINTS);
    const r = await runAgent(wt, ["checkpoints", "--json"]);
    assertEquals(r.code, 0, r.output);
    const env = parseCheckpoints(r.stdout);
    assertEquals(env.ok, true);
    assertEquals(env.verb, "checkpoints");
    assertEquals(env.data.checkpoints, []);
    assertEquals(env.hints, undefined);
  });
});

Deno.test("checkpoints: a governing stop checkpoint reports its policy row, preview, and declaration routing", async () => {
  await withTempDir(async (dir) => {
    const wt = await worktreeWithApiChange(dir, CONFIG_STOP);
    const r = await runAgent(wt, ["checkpoints", "--json"]);
    assertEquals(r.code, 0, r.output);
    const env = parseCheckpoints(r.stdout);
    assert(env.data.policy !== undefined, "the policy identity must resolve");
    assertEquals(env.data.checkpoints.length, 1);
    const row = env.data.checkpoints[0];
    assert(row !== undefined);
    assertEquals(row.id, "api-review");
    assertEquals(row.mode, "stop");
    assertEquals(row.question, QUESTION_API);
    assertEquals(
      row.teach,
      "State the failure modes; note what callers must revisit.",
    );
    assertEquals(row.trigger, "paths api/**");
    assertEquals(row.preview?.holds, true);
    assertEquals(row.preview?.matched, ["api/surface.txt"]);
    assertEquals(row.preview?.when_pending, undefined);
    // Nothing has fired yet, so no episode — and the report says nothing ran.
    assertEquals(row.episode, undefined);
    // Routing: the two valid done conclusions, never --variance.
    assertHasHint(env, HINTS["checkpoints-declare"], { ids: ["api-review"] });
    for (const hint of env.hints ?? []) {
      assert(
        !hint.includes("--variance"),
        `the read surface must not present --variance as agent work: ${hint}`,
      );
    }
  });
});

Deno.test("checkpoints: the report follows the episode through awaiting, declared met, declared unmet, and reopened", async () => {
  await withTempDir(async (dir) => {
    const wt = await worktreeWithApiChange(dir, CONFIG_STOP);

    // A bare done opens the episode (its refusal serves the question).
    assertEquals((await runAgent(wt, ["done", "--json"])).code, 1);
    let env = parseCheckpoints(
      (await runAgent(wt, ["checkpoints", "--json"])).stdout,
    );
    assertEquals(
      env.data.checkpoints[0]?.episode?.state,
      "awaiting_declaration",
    );
    assertHasHint(env, HINTS["checkpoints-declare"], { ids: ["api-review"] });

    // Declared met: the conclusion stands, and no routing hint fires.
    assertEquals(
      (await runAgent(wt, ["done", "--met", "api-review", "--json"])).code,
      0,
    );
    env = parseCheckpoints(
      (await runAgent(wt, ["checkpoints", "--json"])).stdout,
    );
    const met = env.data.checkpoints[0]?.episode;
    assertEquals(met?.state, "declared_met");
    assertEquals(met?.declaration?.conclusion, "met");
    assertEquals(met?.declaration?.current, true);
    assertEquals(met?.variance_required, undefined);
    // The episode names its binding — the subject a declaration binds to and
    // a variance authorization later cites.
    assert((met?.definition_hash ?? "").length > 0);
    assert((met?.subject ?? "").length > 0);
    assertLacksHint(env, HINTS["checkpoints-declare"], { ids: ["api-review"] });

    // Declared unmet: variance required, rationale carried, review routed.
    const why = "The docs lag the new surface; a follow-up covers them.";
    assertEquals(
      (await runAgent(
        wt,
        ["done", "--unmet", "api-review", "--why", why, "--json"],
      )).code,
      0,
    );
    env = parseCheckpoints(
      (await runAgent(wt, ["checkpoints", "--json"])).stdout,
    );
    const unmet = env.data.checkpoints[0]?.episode;
    assertEquals(unmet?.state, "declared_unmet");
    assertEquals(unmet?.declaration?.why, why);
    assertEquals(unmet?.variance_required, true);
    assertHasHint(env, HINTS["checkpoints-variance-review"], {
      ids: ["api-review"],
    });

    // A relevant edit unbinds the conclusion: the next done would reopen, and
    // the report says so WITHOUT writing anything.
    await Deno.writeTextFile(
      join(wt, "api", "surface.txt"),
      "endpoint\nrevised\n",
    );
    env = parseCheckpoints(
      (await runAgent(wt, ["checkpoints", "--json"])).stdout,
    );
    const reopened = env.data.checkpoints[0]?.episode;
    assertEquals(reopened?.state, "reopened");
    assertEquals(reopened?.declaration?.current, false);
    assertEquals(reopened?.variance_required, undefined);
    assertHasHint(env, HINTS["checkpoints-declare"], { ids: ["api-review"] });
  });
});

Deno.test("checkpoints: an advise checkpoint previews without interlock routing", async () => {
  await withTempDir(async (dir) => {
    const wt = await worktreeWithApiChange(dir, CONFIG_ADVISE);
    const env = parseCheckpoints(
      (await runAgent(wt, ["checkpoints", "--json"])).stdout,
    );
    const row = env.data.checkpoints[0];
    assertEquals(row?.mode, "advise");
    assertEquals(row?.preview?.holds, true);
    assertEquals(row?.episode, undefined);
    assertLacksHint(env, HINTS["checkpoints-declare"], { ids: ["api-review"] });
  });
});

Deno.test("checkpoints: a when condition is reported as undecided and never run", async () => {
  await withTempDir(async (dir) => {
    const wt = await worktreeWithApiChange(dir, CONFIG_WHEN);
    const env = parseCheckpoints(
      (await runAgent(wt, ["checkpoints", "--json"])).stdout,
    );
    const row = env.data.checkpoints[0];
    assertEquals(row?.preview?.holds, true);
    assertEquals(row?.preview?.when_pending, true);
    assertStringIncludes(row?.trigger ?? "", "when: sh when-probe.sh");
    // Undecided means unroutable: no declaration is asked for yet.
    assertLacksHint(env, HINTS["checkpoints-declare"], { ids: ["api-review"] });
    // Read-only means the command NEVER ran.
    assertEquals(
      await Deno.readTextFile(join(dir, "when-ran.log")).catch(() => ""),
      "",
      "a read surface must not run a when command",
    );
  });
});

Deno.test("checkpoints: an episode outside the governing policy stays visible", async () => {
  await withTempDir(async (dir) => {
    const wt = await worktreeWithApiChange(dir, CONFIG_STOP);
    // The engine's own episode API plants a record for a checkpoint id the
    // merge-base policy does not define — the state left behind when policy
    // lands differently than an effort expected.
    const planted = await reconcileEpisode(wt, {
      checkpoint: "ghost",
      definitionHash: "d".repeat(64),
      subject: "s".repeat(64),
      matchedPaths: ["api/surface.txt"],
    });
    assert(planted.ok, "the fixture episode must record");
    const env = parseCheckpoints(
      (await runAgent(wt, ["checkpoints", "--json"])).stdout,
    );
    assertEquals(env.data.ungoverned?.length, 1);
    assertEquals(env.data.ungoverned?.[0]?.id, "ghost");
    assertEquals(
      env.data.ungoverned?.[0]?.episode.state,
      "awaiting_declaration",
    );
    // An ungoverned episode is not declarable, so it must not be routed.
    assertLacksHint(env, HINTS["checkpoints-declare"], {
      ids: ["api-review", "ghost"],
    });
  });
});

Deno.test("checkpoints: a corrupt episode store fails open into an advisory", async () => {
  await withTempDir(async (dir) => {
    const wt = await worktreeWithApiChange(dir, CONFIG_STOP);
    const path = await gitAdminStatePath(wt, "checkpointEpisodes");
    assert(path !== undefined);
    await Deno.mkdir(join(path, ".."), { recursive: true });
    await Deno.writeTextFile(path, "not json\n");
    const r = await runAgent(wt, ["checkpoints", "--json"]);
    assertEquals(r.code, 0, r.output);
    const env = parseCheckpoints(r.stdout);
    assertEquals(env.ok, true);
    assert(
      env.data.advisories?.some((a) => a.includes("did not parse")),
      `expected the parse advisory; got ${JSON.stringify(env.data.advisories)}`,
    );
    // The policy report still stands — fail open never blanks the answer.
    assertEquals(env.data.checkpoints.length, 1);
  });
});

Deno.test("checkpoints: the markdown projection carries the declared vocabulary and the variance boundary", async () => {
  await withTempDir(async (dir) => {
    const wt = await worktreeWithApiChange(dir, CONFIG_STOP);
    assertEquals((await runAgent(wt, ["done", "--json"])).code, 1);
    const why = "The docs lag the new surface; a follow-up covers them.";
    assertEquals(
      (await runAgent(
        wt,
        ["done", "--unmet", "api-review", "--why", why, "--json"],
      )).code,
      0,
    );
    const r = await runAgent(wt, ["checkpoints", "--markdown"]);
    assertEquals(r.code, 0, r.output);
    assertTerminalTextIncludes(r.stdout, "declared unmet");
    assertTerminalTextIncludes(r.stdout, "owner variance required to land");
    assertTerminalTextIncludes(r.stdout, why);
    assertTerminalTextIncludes(r.stdout, "authorize each variance");
  });
});

Deno.test("previews: prepare, status, and done --dry-run project the one preview", async () => {
  await withTempDir(async (dir) => {
    const wt = await worktreeWithApiChange(dir, CONFIG_STOP);
    const params = {
      id: "api-review",
      question: QUESTION_API,
      matched: ["api/surface.txt"],
      whenPending: false,
    };

    const prepare = parseHinted(
      (await runAgent(wt, ["prepare", "--json"])).stdout,
    );
    const served = assertHasHint(prepare, HINTS["checkpoint-preview"], params);

    const status = parseHinted(
      (await runAgent(wt, ["status", "--json"])).stdout,
    );
    const servedByStatus = assertHasHint(
      status,
      HINTS["checkpoint-preview"],
      params,
    );
    assertEquals(
      servedByStatus,
      served,
      "prepare and status must serve the identical preview text",
    );

    const dryRun = parseHinted(
      (await runAgent(wt, ["done", "--dry-run", "--json"])).stdout,
    );
    assert(
      dryRun.plan?.details?.includes(
        "Checkpoint 'api-review' (stop): a declared conclusion will be required at done (1 matched).",
      ),
      `the dry-run plan must carry the same preview: ${
        JSON.stringify(dryRun.plan?.details)
      }`,
    );
  });
});

Deno.test("previews: an advise checkpoint rides the advisory channel on prepare and status", async () => {
  await withTempDir(async (dir) => {
    const wt = await worktreeWithApiChange(dir, CONFIG_ADVISE);
    const params = {
      id: "api-review",
      question: QUESTION_API,
      matched: ["api/surface.txt"],
    };
    const prepare = parseHinted(
      (await runAgent(wt, ["prepare", "--json"])).stdout,
    );
    assertHasHint(prepare, HINTS["checkpoint-advise"], params);
    const status = parseHinted(
      (await runAgent(wt, ["status", "--json"])).stdout,
    );
    assertHasHint(status, HINTS["checkpoint-advise"], params);
  });
});

Deno.test("previews: a when-pending stop checkpoint is served as may-require", async () => {
  await withTempDir(async (dir) => {
    const wt = await worktreeWithApiChange(dir, CONFIG_WHEN);
    const prepare = parseHinted(
      (await runAgent(wt, ["prepare", "--json"])).stdout,
    );
    const text = assertHasHint(prepare, HINTS["checkpoint-preview"], {
      id: "api-review",
      question: QUESTION_API,
      matched: ["api/surface.txt"],
      whenPending: true,
    });
    assertStringIncludes(text, "may require");
    // The preview must not have run the command.
    assertEquals(
      await Deno.readTextFile(join(dir, "when-ran.log")).catch(() => ""),
      "",
      "a preview must not run a when command",
    );
  });
});

Deno.test("previews: a checkpoint-free effort adds no checkpoint hints to prepare or status", async () => {
  await withTempDir(async (dir) => {
    const wt = await worktreeWithApiChange(dir, CONFIG_NO_CHECKPOINTS);
    for (const argv of [["prepare", "--json"], ["status", "--json"]]) {
      const env = parseHinted((await runAgent(wt, argv)).stdout);
      for (const hint of env.hints ?? []) {
        assert(
          !hint.startsWith("Checkpoint"),
          `expected no checkpoint hint on ${argv[0]}: ${hint}`,
        );
      }
    }
  });
});

Deno.test("checkpoints: the human surface labels a declaration as declared, never as Passed", async () => {
  // The terminal renderer prints the row's state as its label, and "Passed"
  // is machine-verdict vocabulary — a declared-met row must read through the
  // declared vocabulary on the human surface too.
  await withTempDir(async (dir) => {
    const wt = await worktreeWithApiChange(dir, CONFIG_STOP);
    assertEquals((await runAgent(wt, ["done", "--json"])).code, 1);
    assertEquals(
      (await runAgent(wt, ["done", "--met", "api-review", "--json"])).code,
      0,
    );
    const human = await runAgent(wt, ["checkpoints"], {
      env: { COLUMNS: "120", NO_COLOR: "1" },
    });
    assertEquals(human.code, 0, human.output);
    assertTerminalTextIncludes(human.output, "Declared met");
    assert(
      !human.output.includes("Passed"),
      `a declaration row must not carry the Passed label:\n${human.output}`,
    );
  });
});
