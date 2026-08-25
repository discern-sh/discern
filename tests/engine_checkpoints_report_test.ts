/**
 * The checkpoint READ surfaces (black-box, through the real engine):
 * `discern checkpoints` reports the governing policy, each open question's
 * declaration state, and a structural preview — without running a `when`
 * command, creating an open question, or recording anything — and routes an
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
import {
  readOpenQuestions,
  reconcileOpenQuestion,
} from "../src/engine/checkpoints/open_questions.ts";
import { parseLogbookLine } from "../src/engine/logbook/schema.ts";
import {
  CHECKPOINT_OBLIGATION_STATES,
  type CheckpointObligationState,
} from "../src/shared/checkpoints.ts";
import { readTextIfExists } from "../src/shared/fs_presence.ts";

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

/** Read one effort marker without creating it. */
async function markerText(
  wt: string,
  name: "checkpointOpenQuestions" | "gateProof",
): Promise<string | undefined> {
  const path = await gitAdminStatePath(wt, name);
  assert(path !== undefined);
  return await readTextIfExists(path);
}

/** Count Logbook verb events carrying checkpoint lifecycle observations. Read
 * surfaces still record their ordinary invocation event; they must never
 * counterfeit a firing, reopen, declaration, or advisory serving. */
async function checkpointObservationEvents(dir: string): Promise<number> {
  const logDir = join(dir, ".git", "discern", "logbook");
  let count = 0;
  try {
    for await (const entry of Deno.readDir(logDir)) {
      if (!entry.isFile || !entry.name.endsWith(".jsonl")) {
        continue;
      }
      const raw = await Deno.readTextFile(join(logDir, entry.name));
      for (const line of raw.split("\n").filter((item) => item !== "")) {
        const parsed = parseLogbookLine(line);
        assert(parsed.kind === "event");
        if (
          parsed.event.kind === "verb" && parsed.event.checkpoints !== undefined
        ) {
          count += 1;
        }
      }
    }
  } catch (error) {
    if (!(error instanceof Deno.errors.NotFound)) {
      throw error;
    }
  }
  return count;
}

const QUESTION_API =
  "A changed API surface is described in its docs before it lands.";

const LINE_SEPARATOR = "\u2028";
const PARAGRAPH_SEPARATOR = "\u2029";
const HOSTILE_QUESTION =
  `Does the ${LINE_SEPARATOR} changed surface preserve ${PARAGRAPH_SEPARATOR} its contract?`;

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

const CONFIG_UNLESS_CHANGED = `
[project]
slug = "engine-test"

[repository]
trunk = "main"

[jobs]
lint = "sh check.sh"

[checkpoints.api-review]
paths = ["api/**"]
unless_changed = ["docs/**"]
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

const CONFIG_HOSTILE_TERMINAL_TEXT = `
[project]
slug = "engine-test"

[repository]
trunk = "main"

[jobs]
lint = "sh check.sh"

[checkpoints.api-review]
paths = ["api/**"]
question = ${JSON.stringify(HOSTILE_QUESTION)}
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
  changedPath = "api/surface.txt",
): Promise<string> {
  await scaffoldEngine(dir);
  await writeConfig(dir, config);
  await writeExecutable(join(dir, "check.sh"), CHECK_OK);
  await writeExecutable(join(dir, "when-probe.sh"), WHEN_TOUCHES);
  await gitInit(dir);
  const wt = await addWorktree(dir, "checkpointed");
  await Deno.mkdir(join(wt, "api"), { recursive: true });
  await Deno.writeTextFile(join(wt, changedPath), "endpoint\n");
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
    assertEquals(row.trigger, "paths api/** · authored only");
    assertEquals(row.preview?.holds, true);
    assertEquals(row.preview?.matched, ["api/surface.txt"]);
    assertEquals(row.preview?.when_pending, undefined);
    // Nothing has fired yet, so no open question — and the report says nothing ran.
    assertEquals(row.open_question, undefined);
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

Deno.test("checkpoints: the report follows the open question through awaiting, declared met, declared unmet, and reopened", async () => {
  await withTempDir(async (dir) => {
    const wt = await worktreeWithApiChange(dir, CONFIG_STOP);

    // A bare done opens the open question (its refusal serves the question).
    assertEquals((await runAgent(wt, ["done", "--json"])).code, 1);
    let env = parseCheckpoints(
      (await runAgent(wt, ["checkpoints", "--json"])).stdout,
    );
    assertEquals(
      env.data.checkpoints[0]?.open_question?.state,
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
    const met = env.data.checkpoints[0]?.open_question;
    assertEquals(met?.state, "declared_met");
    assertEquals(met?.declaration?.conclusion, "met");
    assertEquals(met?.declaration?.current, true);
    assertEquals(met?.variance_required, undefined);
    // The open question names its binding — the subject a declaration binds to and
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
    const unmet = env.data.checkpoints[0]?.open_question;
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
    const reopened = env.data.checkpoints[0]?.open_question;
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
    assertEquals(row?.open_question, undefined);
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
      (await readTextIfExists(join(dir, "when-ran.log"))) ?? "",
      "",
      "a read surface must not run a when command",
    );
  });
});

Deno.test("checkpoints: an open question outside the governing policy stays visible", async () => {
  await withTempDir(async (dir) => {
    const wt = await worktreeWithApiChange(dir, CONFIG_STOP);
    // The engine's own open question API plants a record for a checkpoint id the
    // merge-base policy does not define — the state left behind when policy
    // lands differently than an effort expected.
    const planted = await reconcileOpenQuestion(wt, {
      checkpoint: "ghost",
      definitionHash: "d".repeat(64),
      subject: "s".repeat(64),
      matchedPaths: ["api/surface.txt"],
      relatedPaths: [],
    });
    assert(planted.ok, "the fixture open question must record");
    const env = parseCheckpoints(
      (await runAgent(wt, ["checkpoints", "--json"])).stdout,
    );
    assertEquals(env.data.ungoverned?.length, 1);
    assertEquals(env.data.ungoverned?.[0]?.id, "ghost");
    assertEquals(
      env.data.ungoverned?.[0]?.open_question.state,
      "awaiting_declaration",
    );
    // An ungoverned open question is not declarable, so it must not be routed.
    assertLacksHint(env, HINTS["checkpoints-declare"], {
      ids: ["api-review", "ghost"],
    });
  });
});

Deno.test("checkpoints: a corrupt open-question store fails open into an advisory", async () => {
  await withTempDir(async (dir) => {
    const wt = await worktreeWithApiChange(dir, CONFIG_STOP);
    const path = await gitAdminStatePath(wt, "checkpointOpenQuestions");
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
      related: [],
      state: "will_open" as const,
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

Deno.test("checkpoint obligations: an opened question outranks an idle structural trigger on every surface", async () => {
  await withTempDir(async (dir) => {
    const wt = await worktreeWithApiChange(dir, CONFIG_UNLESS_CHANGED);

    // The API-only change fires and opens the question. Adding its paired docs
    // then makes the current structural trigger idle, but cannot retract the
    // question the gate already served.
    assertEquals((await runAgent(wt, ["done", "--json"])).code, 1);
    await Deno.mkdir(join(wt, "docs"), { recursive: true });
    await Deno.writeTextFile(join(wt, "docs", "api.md"), "documented\n");
    await git(wt, "add", "docs/api.md");
    await git(
      wt,
      "commit",
      "-q",
      "-m",
      "docs: describe the api",
      "--no-gpg-sign",
    );

    const checkpoints = parseCheckpoints(
      (await runAgent(wt, ["checkpoints", "--json"])).stdout,
    );
    const prepare = parseHinted(
      (await runAgent(wt, ["prepare", "--json"])).stdout,
    );
    const status = parseHinted(
      (await runAgent(wt, ["status", "--json"])).stdout,
    );
    const dryRun = parseHinted(
      (await runAgent(wt, ["done", "--dry-run", "--json"])).stdout,
    );
    const done = parseHinted(
      (await runAgent(wt, ["done", "--json"])).stdout,
    ) as HintedEnvelope & {
      error?: string;
      data?: { checkpoints?: { outstanding?: { id: string }[] } };
    };

    const obligations = {
      checkpoints: checkpoints.data.checkpoints[0]?.open_question?.state ===
          "awaiting_declaration" &&
        (checkpoints.hints ?? []).some((hint) =>
          hint.includes("Awaiting: api-review")
        ),
      prepare: (prepare.hints ?? []).some((hint) =>
        hint.includes("Checkpoint 'api-review'") &&
        hint.includes("already awaits a declared conclusion")
      ),
      status: (status.hints ?? []).some((hint) =>
        hint.includes("Checkpoint 'api-review'") &&
        hint.includes("already awaits a declared conclusion")
      ),
      done_dry_run: (dryRun.plan?.details ?? []).some((line) =>
        line.includes("Checkpoint 'api-review'") &&
        line.includes("requires a declared conclusion")
      ),
      done: done.error === "awaiting_declaration" &&
        done.data?.checkpoints?.outstanding?.[0]?.id === "api-review",
    };
    assertEquals(obligations, {
      checkpoints: true,
      prepare: true,
      status: true,
      done_dry_run: true,
      done: true,
    });
  });
});

type SurfaceDecision = "requires" | "proceeds" | "unknown";

/** Reduce a prepare/status hint set to the strict checkpoint decision it
 * communicates. Presenter prose may move; the routing vocabulary may not. */
function hintedDecision(envelope: HintedEnvelope): SurfaceDecision {
  const hints = envelope.hints ?? [];
  if (
    hints.some((hint) => hint.includes("may require a declared conclusion"))
  ) {
    return "unknown";
  }
  if (
    hints.some((hint) =>
      hint.includes("will require a declared conclusion") ||
      hint.includes("already awaits a declared conclusion") ||
      hint.includes("requires a fresh declared conclusion")
    )
  ) {
    return "requires";
  }
  if (hints.some((hint) => hint.includes("strict obligation is unknown"))) {
    return "unknown";
  }
  return "proceeds";
}

/** Reduce `done --dry-run` plan facts to its checkpoint decision. */
function dryRunDecision(envelope: HintedEnvelope): SurfaceDecision {
  const details = envelope.plan?.details ?? [];
  if (
    details.some((line) =>
      line.includes("may be required") ||
      line.includes("strict obligation is unknown")
    )
  ) {
    return "unknown";
  }
  if (
    details.some((line) =>
      line.includes("declared conclusion will be required") ||
      line.includes("requires a declared conclusion") ||
      line.includes("requires a fresh declared conclusion")
    )
  ) {
    return "requires";
  }
  return "proceeds";
}

Deno.test("checkpoint obligations: the full state matrix projects through every consuming surface without read effects", async () => {
  const cases: readonly {
    name: string;
    config: string;
    obligation: CheckpointObligationState;
    readDecision: SurfaceDecision;
    strictDecision: Exclude<SurfaceDecision, "unknown">;
    establish: "none" | "idle" | "awaiting" | "met" | "unmet" | "reopened";
  }[] = [
    {
      name: "no obligation",
      config: CONFIG_UNLESS_CHANGED,
      obligation: "none",
      readDecision: "proceeds",
      strictDecision: "proceeds",
      establish: "idle",
    },
    {
      name: "will open",
      config: CONFIG_STOP,
      obligation: "will_open",
      readDecision: "requires",
      strictDecision: "requires",
      establish: "none",
    },
    {
      name: "already awaits",
      config: CONFIG_STOP,
      obligation: "awaiting_declaration",
      readDecision: "requires",
      strictDecision: "requires",
      establish: "awaiting",
    },
    {
      name: "reopened",
      config: CONFIG_STOP,
      obligation: "reopened",
      readDecision: "requires",
      strictDecision: "requires",
      establish: "reopened",
    },
    {
      name: "declared met",
      config: CONFIG_STOP,
      obligation: "declared_met",
      readDecision: "proceeds",
      strictDecision: "proceeds",
      establish: "met",
    },
    {
      name: "declared unmet",
      config: CONFIG_STOP,
      obligation: "declared_unmet",
      readDecision: "proceeds",
      strictDecision: "proceeds",
      establish: "unmet",
    },
    {
      name: "when remains unknown to reads",
      config: CONFIG_WHEN,
      obligation: "unknown",
      readDecision: "unknown",
      strictDecision: "requires",
      establish: "none",
    },
  ];

  assertEquals(
    [...new Set(cases.map((testCase) => testCase.obligation))].sort(),
    [...CHECKPOINT_OBLIGATION_STATES].sort(),
    "every canonical checkpoint obligation state needs a matrix fixture",
  );

  for (const testCase of cases) {
    await withTempDir(async (dir) => {
      const wt = await worktreeWithApiChange(dir, testCase.config);
      if (testCase.establish === "idle") {
        await Deno.mkdir(join(wt, "docs"), { recursive: true });
        await Deno.writeTextFile(join(wt, "docs", "api.md"), "documented\n");
        await git(wt, "add", "docs/api.md");
        await git(
          wt,
          "commit",
          "-q",
          "-m",
          "docs: describe the api",
          "--no-gpg-sign",
        );
      } else if (testCase.establish !== "none") {
        assertEquals(
          (await runAgent(wt, ["done", "--json"])).code,
          1,
          testCase.name,
        );
        if (testCase.establish === "met" || testCase.establish === "reopened") {
          assertEquals(
            (await runAgent(wt, ["done", "--met", "api-review", "--json"]))
              .code,
            0,
            testCase.name,
          );
        } else if (testCase.establish === "unmet") {
          assertEquals(
            (await runAgent(wt, [
              "done",
              "--unmet",
              "api-review",
              "--why",
              "The compatibility notes remain incomplete.",
              "--json",
            ])).code,
            0,
            testCase.name,
          );
        }
        if (testCase.establish === "reopened") {
          await Deno.writeTextFile(
            join(wt, "api", "surface.txt"),
            "endpoint\nrevised\n",
          );
          await git(wt, "add", "api/surface.txt");
          await git(
            wt,
            "commit",
            "-q",
            "-m",
            "feat: revise the api",
            "--no-gpg-sign",
          );
        }
      }

      const questionBefore = await markerText(wt, "checkpointOpenQuestions");
      const gateBefore = await markerText(wt, "gateProof");
      const observationsBefore = await checkpointObservationEvents(dir);

      const checkpoints = parseCheckpoints(
        (await runAgent(wt, ["checkpoints", "--json"])).stdout,
      );
      const prepare = parseHinted(
        (await runAgent(wt, ["prepare", "--json"])).stdout,
      );
      const status = parseHinted(
        (await runAgent(wt, ["status", "--json"])).stdout,
      );
      const dryRun = parseHinted(
        (await runAgent(wt, ["done", "--dry-run", "--json"])).stdout,
      );

      assertEquals(
        checkpoints.data.checkpoints[0]?.obligation,
        testCase.obligation,
        testCase.name,
      );
      assertEquals(
        hintedDecision(prepare),
        testCase.readDecision,
        testCase.name,
      );
      assertEquals(
        hintedDecision(status),
        testCase.readDecision,
        testCase.name,
      );
      assertEquals(
        dryRunDecision(dryRun),
        testCase.readDecision,
        testCase.name,
      );
      assertEquals(
        await markerText(wt, "checkpointOpenQuestions"),
        questionBefore,
        `${testCase.name}: reads changed the open-question store`,
      );
      assertEquals(
        await markerText(wt, "gateProof"),
        gateBefore,
        `${testCase.name}: reads changed the gate marker`,
      );
      assertEquals(
        await checkpointObservationEvents(dir),
        observationsBefore,
        `${testCase.name}: reads recorded a checkpoint lifecycle event`,
      );
      assertEquals(
        (await readTextIfExists(join(dir, "when-ran.log"))) ?? "",
        "",
        `${testCase.name}: a read surface ran the when command`,
      );

      const done = parseHinted(
        (await runAgent(wt, ["done", "--json"])).stdout,
      ) as HintedEnvelope & { error?: string };
      const strictDecision: SurfaceDecision = done.error ===
          "awaiting_declaration"
        ? "requires"
        : "proceeds";
      assertEquals(strictDecision, testCase.strictDecision, testCase.name);
    });
  }
});

Deno.test("previews: an advise checkpoint rides the advisory channel on prepare and status", async () => {
  await withTempDir(async (dir) => {
    const wt = await worktreeWithApiChange(dir, CONFIG_ADVISE);
    const params = {
      id: "api-review",
      question: QUESTION_API,
      matched: ["api/surface.txt"],
      related: [],
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
      related: [],
      state: "when_pending" as const,
    });
    assertStringIncludes(text, "may require");
    // The preview must not have run the command.
    assertEquals(
      (await readTextIfExists(join(dir, "when-ran.log"))) ?? "",
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
  // The terminal renderer prints the row's state as its label. Both agent
  // conclusions use declaration vocabulary; machine verdict and attention
  // remain separate facts.
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
    assertTerminalTextIncludes(human.output, "Declared: api-review");
    assertTerminalTextIncludes(human.output, "Declared met");
    assert(
      !human.output.includes("Passed"),
      `a declaration row must not carry the Passed label:\n${human.output}`,
    );

    const ascii = await runAgent(wt, ["checkpoints"], {
      env: { COLUMNS: "48", LC_ALL: "C", NO_COLOR: "1" },
    });
    assertEquals(ascii.code, 0, ascii.output);
    assertTerminalTextIncludes(ascii.output, ". Declared: api-review");
    assertTerminalTextIncludes(ascii.output, "Declared met");

    const why = "The docs lag the new surface; a follow-up covers them.";
    assertEquals(
      (await runAgent(
        wt,
        ["done", "--unmet", "api-review", "--why", why, "--json"],
      )).code,
      0,
    );
    const unmet = await runAgent(wt, ["checkpoints"], {
      env: { COLUMNS: "120", NO_COLOR: "1" },
    });
    assertEquals(unmet.code, 0, unmet.output);
    assertTerminalTextIncludes(unmet.output, "Declared: api-review");
    assertTerminalTextIncludes(unmet.output, "Declared unmet");
    assertTerminalTextIncludes(unmet.output, "owner variance required");
    assertTerminalTextIncludes(unmet.output, why);

    const unmetAscii = await runAgent(wt, ["checkpoints"], {
      env: { COLUMNS: "48", LC_ALL: "C", NO_COLOR: "1" },
    });
    assertEquals(unmetAscii.code, 0, unmetAscii.output);
    assertTerminalTextIncludes(unmetAscii.output, ". Declared: api-review");
    assertTerminalTextIncludes(unmetAscii.output, "Declared unmet");
  });
});

Deno.test("checkpoints: dynamic question, path, and rationale separators stay inside one terminal row", async () => {
  await withTempDir(async (dir) => {
    const changedPath =
      `api/surface${LINE_SEPARATOR}line${PARAGRAPH_SEPARATOR}paragraph.txt`;
    const wt = await worktreeWithApiChange(
      dir,
      CONFIG_HOSTILE_TERMINAL_TEXT,
      changedPath,
    );
    assertEquals((await runAgent(wt, ["done", "--json"])).code, 1);

    const stored = await readOpenQuestions(wt);
    assert(stored.status === "ok");
    const openQuestion = stored.openQuestions["api-review"];
    assert(openQuestion !== undefined);
    const rationale =
      `Deferred because ${LINE_SEPARATOR} evidence ${PARAGRAPH_SEPARATOR} is incomplete.`;
    const path = await gitAdminStatePath(wt, "checkpointOpenQuestions");
    assert(path !== undefined);
    // Rationale admission rejects these separators. Plant structurally valid
    // legacy/corrupt evidence to prove the terminal boundary remains the sink's
    // guarantee even when that upstream defence is bypassed.
    await Deno.writeTextFile(
      path,
      `${
        JSON.stringify({
          version: 1,
          openQuestions: {
            ...stored.openQuestions,
            "api-review": {
              ...openQuestion,
              declaration: {
                conclusion: "unmet",
                why: rationale,
                definitionHash: openQuestion.definitionHash,
                subject: openQuestion.subject,
                declaredAt: "2026-08-21T12:00:00.000Z",
              },
            },
          },
        })
      }\n`,
    );

    const human = await runAgent(wt, ["checkpoints"], {
      env: { COLUMNS: "120", NO_COLOR: "1" },
    });
    assertEquals(human.code, 0, human.output);
    assertTerminalTextIncludes(
      human.output,
      "Question: Does the <U+2028> changed surface preserve <U+2029> its contract?",
    );
    assertTerminalTextIncludes(
      human.output,
      "Changed: api/surface<U+2028>line<U+2029>paragraph.txt.",
    );
    assertTerminalTextIncludes(
      human.output,
      "Rationale: Deferred because <U+2028> evidence <U+2029> is incomplete.",
    );
    assertEquals(human.output.includes(LINE_SEPARATOR), false);
    assertEquals(human.output.includes(PARAGRAPH_SEPARATOR), false);
  });
});
