/**
 * The checkpoint interlock at `discern done` (black-box, through the real
 * engine): a fired stop checkpoint refuses BEFORE any gate job with the
 * batched `awaiting_declaration` contract; `--met` / `--unmet --why` record
 * the caller's conclusion and proceed into the gate in the same invocation;
 * conclusions ride the Proof separately from machine results; declaration
 * changes never trip the unchanged-tree rerun guard yet stale the recorded
 * Proof; the governing policy comes from the merge-base, never the branch's
 * own config edits; and every uncertainty (a corrupt open question store) fails
 * open into a clean re-ask rather than a wedge.
 */

import { assert, assertEquals, assertStringIncludes } from "@std/assert";
import { dirname, join } from "@std/path";
import { z } from "@zod/zod";
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
import type {
  CheckpointsData,
  GateCheckpointsData,
  GateWireData,
} from "../src/shared/result_schemas.ts";
import { AWAITING_DECLARATION_SLUG } from "../src/shared/declarations.ts";
import { UNCHANGED_TREE_RERUN_SLUG } from "../src/engine/gate/proof.ts";
import { HINTS } from "../src/shared/hints.ts";
import { assertHasHint } from "./hint_asserts.ts";
import { readOpenQuestions } from "../src/engine/checkpoints/open_questions.ts";
import { parseLogbookLine } from "../src/engine/logbook/schema.ts";
import { markdownCodeSpan } from "../src/shared/markdown_code.ts";
import { readTextIfExists, targetExists } from "../src/shared/fs_presence.ts";
import {
  assertResultDataKey,
  type CliResultForCommand,
  decodeCliResult,
  decodeWith,
} from "./decode_cli_result.ts";

type DoneEnvelope = CliResultForCommand<"done">;

type GateDoneEnvelope = DoneEnvelope & {
  data: GateWireData;
};

/** The wire fields payload-specific assertions read from a `done` envelope. */
type CheckpointDoneEnvelope = GateDoneEnvelope & {
  data: GateWireData & { checkpoints: GateCheckpointsData };
};

type CheckpointsEnvelope =
  & Omit<
    CliResultForCommand<"checkpoints">,
    "data"
  >
  & { data: CheckpointsData };

const ProofMarkerDataSchema = z.object({
  checkpoints: z.object({
    declared_met: z.array(z.object({ id: z.string() }).passthrough())
      .optional(),
    declared_unmet: z.array(z.object({ why: z.string() }).passthrough())
      .optional(),
  }).passthrough(),
}).passthrough();

/** Decode one done envelope without requiring a gate payload on refusals or previews. */
function parseJson(stdout: string): DoneEnvelope {
  return decodeCliResult(stdout, "done");
}

/** Decode a done result whose assertions consume gate data but no checkpoint state. */
function parseGateJson(stdout: string): GateDoneEnvelope {
  const result = parseJson(stdout);
  assertResultDataKey(result, "failed_stage");
  return result;
}

/** Decode a done result whose assertions consume checkpoint gate data. */
function parseCheckpointGateJson(stdout: string): CheckpointDoneEnvelope {
  const result = parseGateJson(stdout);
  assert(
    result.data.checkpoints !== undefined,
    `done result must carry checkpoint data: ${stdout}`,
  );
  return {
    ...result,
    data: { ...result.data, checkpoints: result.data.checkpoints },
  };
}

/** Decode a checkpoints read result with its command-owned data present. */
function parseCheckpointsJson(stdout: string): CheckpointsEnvelope {
  const result = decodeCliResult(stdout, "checkpoints");
  assert(
    result.data !== undefined && "checkpoints" in result.data,
    `checkpoints result must carry report data: ${stdout}`,
  );
  return { ...result, data: result.data };
}

/** The recorded gate-proof marker's raw content — the full Proof page and its
 * structured `data:`/`evidence:` components (the wire envelope carries the
 * compact summary only). */
async function proofMarker(wt: string): Promise<string> {
  const path = await gitAdminStatePath(wt, "gateProof");
  assert(path !== undefined, "the gate-proof path must resolve");
  return await Deno.readTextFile(path);
}

/** Read one Git-admin marker without creating it. */
async function adminMarker(
  wt: string,
  name: "checkpointOpenQuestions" | "gateProof" | "lastGateRun",
): Promise<string | undefined> {
  const path = await gitAdminStatePath(wt, name);
  assert(path !== undefined, `${name} path must resolve`);
  return await readTextIfExists(path);
}

/** Count Logbook completion events that claim checkpoint lifecycle effects. */
async function checkpointObservationEvents(dir: string): Promise<number> {
  const logDir = join(dir, ".git", "discern", "logbook");
  let count = 0;
  try {
    for await (const entry of Deno.readDir(logDir)) {
      if (!entry.isFile || !entry.name.endsWith(".jsonl")) continue;
      const raw = await Deno.readTextFile(join(logDir, entry.name));
      for (const line of raw.split("\n").filter((item) => item !== "")) {
        const parsed = parseLogbookLine(line);
        assert(parsed.kind === "event");
        if (
          parsed.event.kind === "verb" &&
          parsed.event.checkpoints !== undefined
        ) count += 1;
      }
    }
  } catch (error) {
    if (!(error instanceof Deno.errors.NotFound)) throw error;
  }
  return count;
}

const QUESTION_API =
  "A changed API surface is described in its docs before it lands.";
const QUESTION_NOTES = "A risky change names what could break, for review.";
const FILE_QUESTION_PATH = "policy/$ [review] `tick`.md";
const FILE_QUESTION_REFERENCE = "project/map/`review`.md#rubric";
const FILE_QUESTION =
  "## Governing review\n\n- Does the changed API keep its documented contract?\n";

/** A gate whose one check always passes, plus one stop checkpoint watching
 * `api/**`. The config is committed by `gitInit`, so the worktree's
 * merge-base carries it — the governing copy. */
const CONFIG_ONE_CHECKPOINT = `
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

const CONFIG_TWO_CHECKPOINTS = `
[project]
slug = "engine-test"

[repository]
trunk = "main"

[jobs]
lint = "sh check.sh"

[checkpoints.api-review]
paths = ["api/**"]
question = "${QUESTION_API}"

[checkpoints.risk-notes]
paths = ["api/**"]
question = "${QUESTION_NOTES}"
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

const CONFIG_MIN_COMMITS = `
[project]
slug = "engine-test"

[repository]
trunk = "main"

[jobs]
lint = "sh check.sh"

[checkpoints.api-review]
paths = ["api/**"]
min_commits = 1
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

const CONFIG_FILE_CHECKPOINT = `
[project]
slug = "engine-test"

[repository]
trunk = "main"

[jobs]
lint = "sh check.sh"

[checkpoints.api-review]
paths = ["api/**"]
question_file = ${JSON.stringify(FILE_QUESTION_PATH)}
reference = ${JSON.stringify(FILE_QUESTION_REFERENCE)}
`;

const CHECK_OK = "#!/usr/bin/env sh\nexit 0\n";

/** Marker file the check job writes when it RUNS — proof of "no gate job ran". */
const CHECK_TOUCHES =
  "#!/usr/bin/env sh\necho ran >> ../gate-ran.log\nexit 0\n";

/** Scaffold main with `config`, then a worktree carrying one committed change
 * under `api/` — the state whose `done` the checkpoint governs. */
async function worktreeWithApiChange(
  dir: string,
  config: string,
  check: string = CHECK_OK,
): Promise<string> {
  await scaffoldEngine(dir);
  await writeConfig(dir, config);
  await writeExecutable(join(dir, "check.sh"), check);
  await gitInit(dir);
  const wt = await addWorktree(dir, "checkpointed");
  await Deno.mkdir(join(wt, "api"), { recursive: true });
  await Deno.writeTextFile(join(wt, "api", "surface.txt"), "endpoint\n");
  await git(wt, "add", "-A");
  await git(wt, "commit", "-q", "-m", "feat: extend the api", "--no-gpg-sign");
  return wt;
}

/** Scaffold a governing file-backed question and one matching branch change. */
async function worktreeWithFileQuestion(dir: string): Promise<string> {
  await scaffoldEngine(dir);
  await writeConfig(dir, CONFIG_FILE_CHECKPOINT);
  await writeExecutable(join(dir, "check.sh"), CHECK_OK);
  await Deno.mkdir(dirname(join(dir, FILE_QUESTION_PATH)), {
    recursive: true,
  });
  await Deno.writeTextFile(join(dir, FILE_QUESTION_PATH), FILE_QUESTION);
  await gitInit(dir);
  const wt = await addWorktree(dir, "file-question");
  await Deno.mkdir(join(wt, "api"), { recursive: true });
  await Deno.writeTextFile(join(wt, "api", "surface.txt"), "endpoint\n");
  await git(wt, "add", "-A");
  await git(wt, "commit", "-q", "-m", "change api", "--no-gpg-sign");
  return wt;
}

Deno.test("file-backed questions are self-contained on read, refusal, CI, and Proof surfaces", async () => {
  await withTempDir(async (dir) => {
    const wt = await worktreeWithFileQuestion(dir);

    const report = await runAgent(wt, ["checkpoints", "--json"]);
    assertEquals(report.code, 0, report.output);
    const reportEnvelope = parseCheckpointsJson(report.stdout);
    assertEquals(reportEnvelope.data.checkpoints[0]?.question, FILE_QUESTION);
    assertEquals(
      reportEnvelope.data.checkpoints[0]?.question_file,
      FILE_QUESTION_PATH,
    );
    assertEquals(
      reportEnvelope.data.checkpoints[0]?.reference,
      FILE_QUESTION_REFERENCE,
    );
    const markdown = await runAgent(wt, ["checkpoints", "--markdown"]);
    assertEquals(markdown.code, 0, markdown.output);
    assertTerminalTextIncludes(markdown.stdout, "## Governing review");
    assertTerminalTextIncludes(
      markdown.stdout,
      "Does the changed API keep its documented contract?",
    );
    assertTerminalTextIncludes(
      markdown.stdout,
      `Question source: ${markdownCodeSpan(FILE_QUESTION_PATH)}`,
    );
    assertTerminalTextIncludes(
      markdown.stdout,
      `Reference: ${markdownCodeSpan(FILE_QUESTION_REFERENCE)}`,
    );

    const refusal = await runAgent(wt, ["done", "--json"]);
    assertEquals(refusal.code, 1, refusal.output);
    const refused = parseJson(refusal.stdout);
    assert(typeof refused.message === "string");
    assertStringIncludes(refused.message, "## Governing review");
    assertStringIncludes(
      refused.message,
      "Does the changed API keep its documented contract?",
    );
    assertStringIncludes(
      refused.message,
      `Question source: ${markdownCodeSpan(FILE_QUESTION_PATH)}`,
    );
    assertStringIncludes(
      refused.message,
      `Reference: ${markdownCodeSpan(FILE_QUESTION_REFERENCE)}`,
    );

    const ci = await runAgent(wt, ["done", "--ci", "--json"]);
    assertEquals(ci.code, 0, ci.output);
    const ciQuestion = parseCheckpointGateJson(ci.stdout).data.checkpoints
      .review
      ?.unreviewed?.[0];
    assertEquals(ciQuestion?.question, FILE_QUESTION);
    assertEquals(ciQuestion?.question_file, FILE_QUESTION_PATH);
    assertEquals(ciQuestion?.reference, FILE_QUESTION_REFERENCE);
    const reportProof = await proofMarker(wt);
    assertStringIncludes(reportProof, "## Governing review");
    assertStringIncludes(
      reportProof,
      "Does the changed API keep its documented contract?",
    );
    assertStringIncludes(reportProof, FILE_QUESTION_PATH);
    assertStringIncludes(reportProof, FILE_QUESTION_REFERENCE);
    assertStringIncludes(
      reportProof,
      `Question source: ${markdownCodeSpan(` ${FILE_QUESTION_PATH} `)}`,
    );
    assertStringIncludes(
      reportProof,
      `Reference: ${markdownCodeSpan(` ${FILE_QUESTION_REFERENCE} `)}`,
    );

    const met = await runAgent(wt, [
      "done",
      "--met",
      "api-review",
      "--json",
    ]);
    assertEquals(met.code, 0, met.output);
    const conclusion = parseCheckpointGateJson(met.stdout).data.checkpoints
      .declared_met?.[0];
    assertEquals(conclusion?.question, FILE_QUESTION);
    assertEquals(conclusion?.question_file, FILE_QUESTION_PATH);
    assertEquals(conclusion?.reference, FILE_QUESTION_REFERENCE);
    const strictProof = await proofMarker(wt);
    assertStringIncludes(strictProof, "## Governing review");
    assertStringIncludes(
      strictProof,
      "Does the changed API keep its documented contract?",
    );
    assertStringIncludes(strictProof, FILE_QUESTION_PATH);
    assertStringIncludes(strictProof, FILE_QUESTION_REFERENCE);
    assertStringIncludes(
      strictProof,
      `Question source: ${markdownCodeSpan(` ${FILE_QUESTION_PATH} `)}`,
    );
    assertStringIncludes(
      strictProof,
      `Reference: ${markdownCodeSpan(` ${FILE_QUESTION_REFERENCE} `)}`,
    );

    const unmet = await runAgent(wt, [
      "done",
      "--unmet",
      "api-review",
      "--why",
      "The documented contract still omits one caller-visible failure mode.",
      "--json",
    ]);
    assertEquals(unmet.code, 0, unmet.output);
    const acceptance = await runAgent(wt, ["accept", "--json"]);
    assertEquals(acceptance.code, 1, acceptance.output);
    const acceptanceEnvelope = decodeCliResult(acceptance.stdout, "accept");
    assert(typeof acceptanceEnvelope.message === "string");
    assertStringIncludes(acceptanceEnvelope.message, "## Governing review");
    assertStringIncludes(
      acceptanceEnvelope.message,
      `Question source: ${markdownCodeSpan(FILE_QUESTION_PATH)}`,
    );
    assertStringIncludes(
      acceptanceEnvelope.message,
      `Reference: ${markdownCodeSpan(FILE_QUESTION_REFERENCE)}`,
    );
  });
});

Deno.test("a bad historical question source fails open into durable Proof evidence", async () => {
  await withTempDir(async (dir) => {
    await scaffoldEngine(dir);
    await writeConfig(dir, CONFIG_FILE_CHECKPOINT);
    await writeExecutable(join(dir, "check.sh"), CHECK_OK);
    // The governing commit deliberately lacks FILE_QUESTION_PATH. A later
    // branch repair makes live config strict and loadable without repairing
    // the historical obligation behind its own gate.
    await gitInit(dir);
    const wt = await addWorktree(dir, "broken-file-question");
    await writeConfig(
      wt,
      CONFIG_FILE_CHECKPOINT
        .replace(
          `question_file = ${JSON.stringify(FILE_QUESTION_PATH)}`,
          'question = "Candidate-side repair."',
        ),
    );
    await Deno.mkdir(join(wt, "api"), { recursive: true });
    await Deno.writeTextFile(join(wt, "api", "surface.txt"), "endpoint\n");
    await git(wt, "add", "-A");
    await git(wt, "commit", "-q", "-m", "repair live config", "--no-gpg-sign");

    const done = await runAgent(wt, ["done", "--json"]);
    assertEquals(done.code, 0, done.output);
    const env = parseCheckpointGateJson(done.stdout);
    const drop = env.data.checkpoints.drops?.find((entry) =>
      entry.checkpoint === "api-review"
    );
    assertEquals(drop?.reason, "checkpoint_question_file_missing");
    const marker = await proofMarker(wt);
    assertStringIncludes(marker, "checkpoint_question_file_missing");
    assertStringIncludes(marker, FILE_QUESTION_PATH);
    assertStringIncludes(marker, "does not govern this run");
  });
});

Deno.test("done: a fired stop checkpoint refuses before any job, serving the question and both recoveries", async () => {
  await withTempDir(async (dir) => {
    const wt = await worktreeWithApiChange(
      dir,
      CONFIG_ONE_CHECKPOINT,
      CHECK_TOUCHES,
    );

    const r = await runAgent(wt, ["done", "--json"]);
    assertEquals(r.code, 1, r.output);
    const env = parseCheckpointGateJson(r.stdout);
    assertEquals(env.ok, false);
    assertEquals(env.verb, "done");
    assertEquals(env.error, AWAITING_DECLARATION_SLUG);
    assert(typeof env.message === "string");
    // The serving: id, matched evidence, question, and both recoveries.
    assertStringIncludes(env.message, "api-review");
    assertStringIncludes(env.message, "api/surface.txt");
    assertStringIncludes(env.message, QUESTION_API);
    assertStringIncludes(env.message, "--met");
    assertStringIncludes(env.message, "--unmet");
    assertStringIncludes(env.message, "--why");
    // The read-only-in-effect claim, stated with its exceptions.
    assertStringIncludes(env.message, "No gate job ran");
    assertStringIncludes(env.message, "tree is unchanged");
    assertHasHint(env, HINTS["checkpoint-declare"], { ids: ["api-review"] });
    // Structured serving for machine callers.
    assertEquals(env.data.checkpoints.outstanding?.length, 1);
    assertEquals(env.data.checkpoints.outstanding?.[0]?.id, "api-review");
    assertEquals(env.data.checkpoints.outstanding?.[0]?.mode, "stop");
    assertEquals(env.data.checkpoints.outstanding?.[0]?.matched, [
      "api/surface.txt",
    ]);
    // No gate job ran: the check job's side effect never happened.
    assertEquals(
      (await readTextIfExists(join(dir, "gate-ran.log"))) ?? "",
      "",
      "the refusal must precede every gate job",
    );
    // The refusal opened the open question — the one write it claims.
    const openQuestions = await readOpenQuestions(wt);
    assert(openQuestions.status === "ok");
    assert(openQuestions.openQuestions["api-review"] !== undefined);
  });
});

Deno.test("done --ci: a fresh checkout reports a fired stop and lets machine jobs decide the exit", async () => {
  await withTempDir(async (dir) => {
    const wt = await worktreeWithApiChange(
      dir,
      CONFIG_ONE_CHECKPOINT,
      CHECK_TOUCHES,
    );

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
    assertStringIncludes(
      await Deno.readTextFile(join(wt, "..", "gate-ran.log")),
      "ran",
    );
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
    assertStringIncludes(marker, "mode: report");
    assertStringIncludes(marker, "reported, not enforced");
    // Report mode never manufactures declarations beside its review fact.
    assertEquals(env.data.checkpoints.declared_met ?? [], []);
    assertEquals(env.data.checkpoints.declared_unmet ?? [], []);
  });
});

Deno.test("done: a CI environment never selects report mode and only tailors the strict recovery", async () => {
  // The report lane is the explicit flag; environment detection improves
  // guidance only. A bare strict run under a CI marker still refuses with
  // the full serving, writes the ordinary open question, and adds the
  // CI-specific recovery hint naming both legitimate routes.
  await withTempDir(async (dir) => {
    const wt = await worktreeWithApiChange(dir, CONFIG_ONE_CHECKPOINT);
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
  });
});

Deno.test("done --ci: red jobs remain red; advise questions are reported without checkpoint writes", async () => {
  await withTempDir(async (dir) => {
    const red = await worktreeWithApiChange(
      dir,
      CONFIG_ADVISE,
      "#!/usr/bin/env sh\nexit 9\n",
    );
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
    assertEquals(
      (await readTextIfExists(join(wt, "..", "probe-ran.log"))) ?? "",
      "",
    );
    assertEquals(await adminMarker(wt, "checkpointOpenQuestions"), undefined);
    assertEquals(await adminMarker(wt, "gateProof"), undefined);
    assertEquals(await adminMarker(wt, "lastGateRun"), undefined);
    assertEquals(await checkpointObservationEvents(dir), 0);
  });
});

Deno.test("done --ci: declaration flags refuse before every checkpoint and Gate write", async () => {
  await withTempDir(async (dir) => {
    const wt = await worktreeWithApiChange(
      dir,
      CONFIG_ONE_CHECKPOINT,
      CHECK_TOUCHES,
    );
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
    assertEquals(await adminMarker(wt, "checkpointOpenQuestions"), undefined);
    assertEquals(await adminMarker(wt, "gateProof"), undefined);
    assertEquals(await adminMarker(wt, "lastGateRun"), undefined);
    assertEquals(
      (await readTextIfExists(join(wt, "..", "gate-ran.log"))) ?? "",
      "",
    );
    assertEquals(await checkpointObservationEvents(dir), 0);
  });
});

Deno.test("done: an indeterminate stop records its drop and serves full evidence", async () => {
  await withTempDir(async (dir) => {
    const config = `${CONFIG_ONE_CHECKPOINT}\nwhen = "sh probe.sh"\n`;
    const wt = await worktreeWithApiChange(dir, config);
    await writeExecutable(
      join(wt, "probe.sh"),
      "#!/usr/bin/env sh\necho probe-invalid\nexit 7\n",
    );
    await git(wt, "add", "probe.sh");
    await git(wt, "commit", "-q", "-m", "add probe", "--no-gpg-sign");

    const r = await runAgent(wt, ["done", "--json"]);
    assertEquals(r.code, 1, r.output);
    const env = parseCheckpointGateJson(r.stdout);
    assertEquals(env.error, AWAITING_DECLARATION_SLUG);
    assertEquals(env.data.checkpoints.drops?.[0]?.reason, "when_invalid_exit");
    assertEquals(env.data.checkpoints.drops?.[0]?.checkpoint, "api-review");
    assertEquals(env.data.checkpoints.outstanding?.[0]?.matched, [
      "api/surface.txt",
    ]);
    assertStringIncludes(r.output, "probe-invalid");
  });
});

Deno.test("done: --met records the conclusion and proceeds into the gate; the Proof carries it declared", async () => {
  await withTempDir(async (dir) => {
    const wt = await worktreeWithApiChange(dir, CONFIG_ONE_CHECKPOINT);

    // Serve the question (and open the open question).
    assertEquals((await runAgent(wt, ["done", "--json"])).code, 1);

    // Declare met: the same invocation runs the gate to green.
    const r = await runAgent(wt, ["done", "--met", "api-review", "--json"]);
    assertEquals(r.code, 0, r.output);
    const env = parseCheckpointGateJson(r.stdout);
    assertEquals(env.ok, true);
    assertEquals(env.data.checkpoints.declared_met?.length, 1);
    assertEquals(env.data.checkpoints.declared_met?.[0]?.id, "api-review");
    assertEquals(env.data.checkpoints.outstanding, undefined);
    // The Proof renders the conclusion separately from machine results, with
    // the policy identity, qualified as DECLARED. The wire envelope carries
    // the compact summary (its line includes the declared segment); the full
    // page and structured block live in the recorded marker.
    const proof = env.data.proof;
    assert(proof !== undefined, "a green run over a clean tree earns a Proof");
    assertStringIncludes(proof.line, "1 checkpoint declared met");
    const strictMarker = await proofMarker(wt);
    assert(
      !strictMarker.includes("mode: strict") &&
        !strictMarker.includes('"mode":"strict"'),
      "ordinary done keeps the pre-report marker and Proof shape",
    );
    assertEquals(env.data.gate_proof?.status, "recorded");
    const reported = await runAgent(wt, ["done", "--ci", "--json"]);
    assertEquals(reported.code, 0, reported.output);
    assertEquals(
      await proofMarker(wt),
      strictMarker,
      "report mode must preserve honored strict evidence for the same HEAD",
    );
    const marker = await proofMarker(wt);
    assertStringIncludes(marker, "Checkpoint conclusions");
    assertStringIncludes(marker, "declared met");
    assertStringIncludes(marker, "policy");
    assertStringIncludes(marker, "evidence: ");
    const stored = decodeWith(
      ProofMarkerDataSchema,
      marker.split("\n").find((line) => line.startsWith("data: "))
        ?.slice("data: ".length) ?? "{}",
    );
    assert(stored.checkpoints.declared_met !== undefined);
    assertEquals(stored.checkpoints.declared_met.length, 1);
    const declaredMet = stored.checkpoints.declared_met[0];
    assert(declaredMet !== undefined);
    assertEquals(declaredMet.id, "api-review");
  });
});

Deno.test("done: declarations replace conclusions, while a true green rerun reuses Proof", async () => {
  await withTempDir(async (dir) => {
    const wt = await worktreeWithApiChange(dir, CONFIG_ONE_CHECKPOINT);
    assertEquals((await runAgent(wt, ["done", "--json"])).code, 1);
    assertEquals(
      (await runAgent(wt, ["done", "--met", "api-review", "--json"])).code,
      0,
    );

    // A literal strict call on the unchanged tree reuses exact current Proof.
    const rerun = await runAgent(wt, ["done", "--json"]);
    assertEquals(rerun.code, 0, rerun.output);
    assertEquals(parseGateJson(rerun.stdout).data.gate_ran, false);

    // Replacing the conclusion is NEW evidence: it proceeds through
    // reconciliation into a fresh gate run with no --confirmed, and the new
    // Proof carries the declared-unmet conclusion and its rationale.
    const flipped = await runAgent(wt, [
      "done",
      "--unmet",
      "api-review",
      "--why",
      "The docs lag the new surface; a follow-up covers them.",
      "--json",
    ]);
    assertEquals(flipped.code, 0, flipped.output);
    const env = parseCheckpointGateJson(flipped.stdout);
    assertEquals(env.data.checkpoints.declared_unmet?.length, 1);
    assertStringIncludes(
      env.data.checkpoints.declared_unmet?.[0]?.why ?? "",
      "docs lag",
    );
    const proof = env.data.proof;
    assert(proof !== undefined);
    assertStringIncludes(proof.line, "1 declared unmet");
    assertStringIncludes(proof.line, "variance required");
    const marker = await proofMarker(wt);
    assertStringIncludes(marker, "declared unmet");
    assertStringIncludes(marker, "owner-authorized variance");
    assertHasHint(env, HINTS["gate-variance-required"], {
      ids: ["api-review"],
    });

    // A changed RATIONALE alone is also new evidence: no --confirmed needed.
    const reworded = await runAgent(wt, [
      "done",
      "--unmet",
      "api-review",
      "--why",
      "The docs lag the new surface; the follow-up lands next.",
      "--json",
    ]);
    assertEquals(reworded.code, 0, reworded.output);
  });
});

Deno.test("done: a batched refusal serves every awaiting checkpoint at once, and partial declarations narrow it", async () => {
  await withTempDir(async (dir) => {
    const wt = await worktreeWithApiChange(dir, CONFIG_TWO_CHECKPOINTS);

    const r = await runAgent(wt, ["done", "--json"]);
    assertEquals(r.code, 1);
    const env = parseCheckpointGateJson(r.stdout);
    assertEquals(env.error, AWAITING_DECLARATION_SLUG);
    assert(typeof env.message === "string");
    assertEquals(
      env.data.checkpoints.outstanding?.map((c) => c.id).sort(),
      ["api-review", "risk-notes"],
    );
    assertStringIncludes(env.message, QUESTION_API);
    assertStringIncludes(env.message, QUESTION_NOTES);

    // One declaration records FIRST; the refusal then names only the rest.
    const partial = await runAgent(wt, [
      "done",
      "--met",
      "api-review",
      "--json",
    ]);
    assertEquals(partial.code, 1, partial.output);
    const remaining = parseCheckpointGateJson(partial.stdout);
    assertEquals(remaining.error, AWAITING_DECLARATION_SLUG);
    assertEquals(
      remaining.data.checkpoints.outstanding?.map((c) => c.id),
      ["risk-notes"],
    );
    // The already-recorded conclusion survives and the whole set completes.
    const done = await runAgent(wt, ["done", "--met", "risk-notes", "--json"]);
    assertEquals(done.code, 0, done.output);
    const final = parseCheckpointGateJson(done.stdout);
    assertEquals(
      final.data.checkpoints.declared_met?.map((c) => c.id).sort(),
      ["api-review", "risk-notes"],
    );
  });
});

Deno.test("done: unknown or inactive declaration ids are errors naming the active set, and record nothing", async () => {
  await withTempDir(async (dir) => {
    const wt = await worktreeWithApiChange(dir, CONFIG_ONE_CHECKPOINT);
    assertEquals((await runAgent(wt, ["done", "--json"])).code, 1);

    const r = await runAgent(wt, [
      "done",
      "--met",
      "no-such-checkpoint",
      "--json",
    ]);
    assertEquals(r.code, 1);
    const env = parseJson(r.stdout);
    assertEquals(env.error, "invalid_value");
    assert(typeof env.message === "string");
    assertStringIncludes(env.message, "no-such-checkpoint");
    assertStringIncludes(env.message, "api-review");
    // Nothing recorded: the valid id in a LATER invocation still awaits.
    const openQuestions = await readOpenQuestions(wt);
    assert(openQuestions.status === "ok");
    assertEquals(
      openQuestions.openQuestions["api-review"]?.declaration,
      undefined,
    );
  });
});

Deno.test("done: the rationale boundary rejects shape violations before any write", async () => {
  await withTempDir(async (dir) => {
    const wt = await worktreeWithApiChange(dir, CONFIG_ONE_CHECKPOINT);
    assertEquals((await runAgent(wt, ["done", "--json"])).code, 1);

    for (
      const why of [
        "",
        "   ",
        "line one\nline two",
        "tab\there",
        "x".repeat(501),
      ]
    ) {
      const r = await runAgent(wt, [
        "done",
        "--unmet",
        "api-review",
        "--why",
        why,
        "--json",
      ]);
      assertEquals(r.code, 1, `rationale ${JSON.stringify(why)}\n${r.output}`);
      const env = parseJson(r.stdout);
      assert(
        env.error === "invalid_value" || env.error === "invalid_arguments",
        env.error,
      );
      const openQuestions = await readOpenQuestions(wt);
      assert(openQuestions.status === "ok");
      assertEquals(
        openQuestions.openQuestions["api-review"]?.declaration,
        undefined,
        "an invalid rationale must record nothing",
      );
    }

    // Flag pairing is validated at the surface: --unmet without --why, and
    // --why without --unmet, both refuse.
    const noWhy = await runAgent(wt, [
      "done",
      "--unmet",
      "api-review",
      "--json",
    ]);
    assertEquals(noWhy.code, 1);
    assertEquals(parseJson(noWhy.stdout).error, "invalid_arguments");
    const noUnmet = await runAgent(wt, ["done", "--why", "orphaned", "--json"]);
    assertEquals(noUnmet.code, 1);
    assertEquals(parseJson(noUnmet.stdout).error, "invalid_arguments");
  });
});

Deno.test("done: a rationale of shell and Markdown metacharacters round-trips opaquely", async () => {
  await withTempDir(async (dir) => {
    const wt = await worktreeWithApiChange(dir, CONFIG_ONE_CHECKPOINT);
    assertEquals((await runAgent(wt, ["done", "--json"])).code, 1);

    const hostile =
      "Docs lag `rm -rf` and $(echo pwned) | tee *.md _emphasis_ <b>&amp;</b>";
    const r = await runAgent(wt, [
      "done",
      "--unmet",
      "api-review",
      "--why",
      hostile,
      "--json",
    ]);
    assertEquals(r.code, 0, r.output);
    const env = parseCheckpointGateJson(r.stdout);
    // The exact bytes survive into the envelope (JSON escaping only)…
    assertEquals(env.data.checkpoints.declared_unmet?.[0]?.why, hostile);
    // …and the store holds them verbatim, uninterpreted — no interpolation
    // shaved or expanded the text.
    const openQuestions = await readOpenQuestions(wt);
    assert(openQuestions.status === "ok");
    const declaration = openQuestions.openQuestions["api-review"]?.declaration;
    assert(declaration !== undefined && declaration.conclusion === "unmet");
    assertEquals(declaration.why, hostile);
    // The recorded Proof page carries it through the code-span escaping
    // boundary rather than as raw markup, and the structured marker copy
    // round-trips the exact bytes.
    const marker = await proofMarker(wt);
    assertStringIncludes(marker, "rm -rf");
    const stored = decodeWith(
      ProofMarkerDataSchema,
      marker.split("\n").find((line) => line.startsWith("data: "))
        ?.slice("data: ".length) ?? "{}",
    );
    assert(stored.checkpoints.declared_unmet !== undefined);
    const declaredUnmet = stored.checkpoints.declared_unmet[0];
    assert(declaredUnmet !== undefined);
    assertEquals(declaredUnmet.why, hostile);
  });
});

Deno.test("done: advise mode serves the question through the advisory channel and never blocks", async () => {
  await withTempDir(async (dir) => {
    const wt = await worktreeWithApiChange(dir, CONFIG_ADVISE);

    const r = await runAgent(wt, ["done", "--json"]);
    assertEquals(r.code, 0, r.output);
    const env = parseCheckpointGateJson(r.stdout);
    assertEquals(env.ok, true);
    assertHasHint(env, HINTS["checkpoint-advise"], {
      id: "api-review",
      question: QUESTION_API,
      matched: ["api/surface.txt"],
      related: [],
    });
    assertEquals(env.data.checkpoints.advise?.length, 1);
    assertEquals(env.data.checkpoints.outstanding, undefined);
    // No declaration exists or is required; the recorded Proof carries no
    // conclusion block for an advise-only run.
    assert(!(await proofMarker(wt)).includes("Checkpoint conclusions"));
  });
});

Deno.test("done: an indeterminate advise predicate stays non-blocking over full evidence", async () => {
  await withTempDir(async (dir) => {
    const wt = await worktreeWithApiChange(
      dir,
      `${CONFIG_ADVISE}\nwhen = "sh probe.sh"\n`,
    );
    await writeExecutable(
      join(wt, "probe.sh"),
      "#!/usr/bin/env sh\necho advise-indeterminate\nexit 7\n",
    );
    await git(wt, "add", "probe.sh");
    await git(wt, "commit", "-q", "-m", "add advise probe", "--no-gpg-sign");

    const result = await runAgent(wt, ["done", "--json"]);
    assertEquals(result.code, 0, result.output);
    const envelope = parseCheckpointGateJson(result.stdout);
    assertEquals(envelope.data.checkpoints.outstanding, undefined);
    assertEquals(envelope.data.checkpoints.advise?.[0]?.matched, [
      "api/surface.txt",
    ]);
    assertEquals(
      envelope.data.checkpoints.drops?.some((entry) =>
        entry.reason === "when_invalid_exit" &&
        entry.checkpoint === "api-review"
      ),
      true,
    );
    assertStringIncludes(result.stdout, "advise-indeterminate");
  });
});

Deno.test("done: the branch cannot edit its own governing policy — the merge-base copy rules", async () => {
  await withTempDir(async (dir) => {
    const wt = await worktreeWithApiChange(dir, CONFIG_ONE_CHECKPOINT);

    // The branch deletes the checkpoint table and commits the edit; the
    // governing (merge-base) copy still interlocks.
    const stripped = CONFIG_ONE_CHECKPOINT.split("[checkpoints.api-review]")[0];
    await writeConfig(wt, stripped ?? "");
    await git(wt, "add", "-A");
    await git(wt, "commit", "-q", "-m", "drop the checkpoint", "--no-gpg-sign");
    const r = await runAgent(wt, ["done", "--json"]);
    assertEquals(r.code, 1, r.output);
    assertEquals(parseJson(r.stdout).error, AWAITING_DECLARATION_SLUG);
  });
});

Deno.test("done: a corrupt open-question store fails open into a clean re-ask", async () => {
  await withTempDir(async (dir) => {
    const wt = await worktreeWithApiChange(dir, CONFIG_ONE_CHECKPOINT);
    assertEquals((await runAgent(wt, ["done", "--json"])).code, 1);
    assertEquals(
      (await runAgent(wt, ["done", "--met", "api-review", "--json"])).code,
      0,
    );

    // Corrupt the store: the conclusion is gone, so the next run rebuilds
    // and asks for a fresh declaration instead of wedging or crashing.
    const path = await gitAdminStatePath(wt, "checkpointOpenQuestions");
    assert(path !== undefined);
    await Deno.writeTextFile(path, "corrupted, not json\n");
    const r = await runAgent(wt, ["done", "--json"]);
    assertEquals(r.code, 1, r.output);
    const env = parseJson(r.stdout);
    assertEquals(env.error, AWAITING_DECLARATION_SLUG);
    // The conservative direction: the fresh declaration restores the exact
    // claim the green run recorded, so the rerun guard recognises the
    // unchanged tree + unchanged evidence and the standing verdict holds.
    const redeclared = await runAgent(wt, [
      "done",
      "--met",
      "api-review",
      "--json",
    ]);
    assertEquals(redeclared.code, 1, redeclared.output);
    assertEquals(
      parseJson(redeclared.stdout).error,
      UNCHANGED_TREE_RERUN_SLUG,
      "an identical restored claim is the same run, not new evidence",
    );
    // The declaration write itself succeeded: the store holds it again.
    const openQuestions = await readOpenQuestions(wt);
    assert(openQuestions.status === "ok");
    assertEquals(
      openQuestions.openQuestions["api-review"]?.declaration?.conclusion,
      "met",
    );
  });
});

Deno.test("checkpoints: a corrupt store remains visible with zero resolved definitions", async () => {
  await withTempDir(async (dir) => {
    const wt = await worktreeWithApiChange(dir, CONFIG_NO_CHECKPOINTS);
    const path = await gitAdminStatePath(wt, "checkpointOpenQuestions");
    assert(path !== undefined);
    await Deno.mkdir(dirname(path), { recursive: true });
    await Deno.writeTextFile(path, "not json\n");

    const report = await runAgent(wt, ["checkpoints", "--json"]);
    assertEquals(report.code, 0, report.output);
    const data = parseCheckpointsJson(report.stdout).data;
    assertEquals(data.checkpoints, []);
    assertEquals(data.drops?.[0]?.scope, "policy");
    assertEquals(data.drops?.[0]?.reason, "open_question_store_corrupt");
    assert((data.drops?.[0]?.policy_commit?.length ?? 0) > 0);

    const preview = await runAgent(wt, ["accept", "--dry-run", "--json"]);
    assertEquals(preview.code, 0, preview.output);
    const previewEnvelope = decodeCliResult(preview.stdout, "accept");
    assert(
      previewEnvelope.data !== undefined &&
        "checkpoint_drops" in previewEnvelope.data,
    );
    const previewData = previewEnvelope.data;
    assertEquals(
      previewData?.checkpoint_drops?.[0]?.reason,
      "open_question_store_corrupt",
    );
  });
});

Deno.test("done: an opened stop question remains interlocked after its trigger becomes inactive", async () => {
  await withTempDir(async (dir) => {
    const wt = await worktreeWithApiChange(dir, CONFIG_UNLESS_CHANGED);

    // The API-only effort opens the open question. A later docs change makes the
    // current trigger inactive, but cannot retract a question already served.
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

    const stillAwaiting = await runAgent(wt, ["done", "--json"]);
    assertEquals(stillAwaiting.code, 1, stillAwaiting.output);
    const awaiting = parseCheckpointGateJson(stillAwaiting.stdout);
    assertEquals(awaiting.error, AWAITING_DECLARATION_SLUG);
    assertEquals(awaiting.data.checkpoints.outstanding?.[0]?.id, "api-review");
    assertEquals(awaiting.data.checkpoints.outstanding?.[0]?.matched, [
      "api/surface.txt",
    ]);

    // A conclusion recorded while the trigger remains inactive is still part
    // of this run's checkpoint evidence, including the variance requirement.
    const concluded = await runAgent(wt, [
      "done",
      "--unmet",
      "api-review",
      "--why",
      "The changed docs do not yet describe the compatibility trade-off.",
      "--json",
    ]);
    assertEquals(concluded.code, 0, concluded.output);
    const env = parseCheckpointGateJson(concluded.stdout);
    assertEquals(env.data.checkpoints.declared_unmet?.[0]?.id, "api-review");
    assertStringIncludes(env.data.proof?.line ?? "", "variance required");
  });
});

Deno.test("done: unavailable history never reopens or interlocks a declared min_commits question", async () => {
  await withTempDir(async (dir) => {
    const wt = await worktreeWithApiChange(dir, CONFIG_MIN_COMMITS);
    assertEquals((await runAgent(wt, ["done", "--json"])).code, 1);
    const concluded = await runAgent(wt, [
      "done",
      "--met",
      "api-review",
      "--json",
    ]);
    assertEquals(concluded.code, 0, concluded.output);

    // Move the effort without changing the checkpoint's matched subject, then
    // make only the ordered-history query unavailable. Every other Git command
    // still delegates to the real binary, so this is the exact fact failure.
    await Deno.mkdir(join(wt, "docs"), { recursive: true });
    await Deno.writeTextFile(join(wt, "docs", "note.md"), "unrelated\n");
    await git(wt, "add", "docs/note.md");
    await git(wt, "commit", "-q", "-m", "docs: unrelated", "--no-gpg-sign");
    const shim = join(dir, "broken-history-bin");
    await writeExecutable(
      join(shim, "git"),
      '#!/bin/sh\nfor arg do [ "$arg" = "--reverse" ] && exit 2; done\nexec /usr/bin/git "$@"\n',
    );
    const unavailable = await runAgent(wt, ["done", "--json"], {
      env: { PATH: `${shim}:${Deno.env.get("PATH") ?? ""}` },
    });
    assertEquals(unavailable.code, 0, unavailable.output);
    const envelope = parseCheckpointGateJson(unavailable.stdout);
    assertEquals(envelope.data.checkpoints.outstanding, undefined);
    assertEquals(
      envelope.data.checkpoints.drops?.[0]?.reason,
      "trigger_history_unavailable",
    );
  });
});

Deno.test("done: --dry-run never refuses; it previews the checkpoints that would require declarations", async () => {
  await withTempDir(async (dir) => {
    const wt = await worktreeWithApiChange(dir, CONFIG_ONE_CHECKPOINT);

    const r = await runAgent(wt, ["done", "--dry-run", "--json"]);
    assertEquals(r.code, 0, r.output);
    const env = parseJson(r.stdout);
    assertEquals(env.ok, true);
    assertEquals(env.dry_run, true);
    const details: string[] = env.plan?.details ?? [];
    assert(
      details.some((line) =>
        line.includes("api-review") && line.includes("required")
      ),
      JSON.stringify(details),
    );
    // Previewing wrote nothing: no open question exists yet.
    const openQuestions = await readOpenQuestions(wt);
    assert(openQuestions.status === "missing", openQuestions.status);
  });
});

Deno.test("done: an unrelated trunk update preserves a conclusion; a matched-base update reopens it", async () => {
  await withTempDir(async (dir) => {
    // The matched file exists on MAIN with room for non-conflicting edits at
    // both ends, so both trunk advances below auto-merge cleanly.
    await scaffoldEngine(dir);
    await writeConfig(dir, CONFIG_ONE_CHECKPOINT);
    await writeExecutable(join(dir, "check.sh"), CHECK_OK);
    await Deno.mkdir(join(dir, "api"), { recursive: true });
    const body = Array.from({ length: 9 }, (_, i) => `line-${i + 1}`);
    await Deno.writeTextFile(
      join(dir, "api", "surface.txt"),
      `${body.join("\n")}\n`,
    );
    await gitInit(dir);
    const wt = await addWorktree(dir, "checkpointed");
    await Deno.writeTextFile(
      join(wt, "api", "surface.txt"),
      `branch-take\n${body.slice(1).join("\n")}\n`,
    );
    await git(wt, "add", "-A");
    await git(
      wt,
      "commit",
      "-q",
      "-m",
      "feat: reshape the api",
      "--no-gpg-sign",
    );
    assertEquals((await runAgent(wt, ["done", "--json"])).code, 1);
    assertEquals(
      (await runAgent(wt, ["done", "--met", "api-review", "--json"])).code,
      0,
    );

    // Unrelated trunk advance: a file outside the matched set lands on main.
    await Deno.writeTextFile(join(dir, "unrelated.txt"), "trunk moved\n");
    await git(dir, "add", "-A");
    await git(
      dir,
      "commit",
      "-q",
      "-m",
      "unrelated trunk work",
      "--no-gpg-sign",
    );
    const updated = await runAgent(wt, ["update", "--json"]);
    assertEquals(updated.code, 0, updated.output);
    // The tree changed (merge commit), so the gate runs — but the conclusion
    // still binds: no fresh declaration is demanded.
    const after = await runAgent(wt, ["done", "--json"]);
    assertEquals(after.code, 0, after.output);
    const env = parseCheckpointGateJson(after.stdout);
    assertEquals(env.data.checkpoints.declared_met?.[0]?.id, "api-review");

    // Matched-base trunk advance: main edits the far end of the SAME matched
    // file; the update merges cleanly but moves the subject's base (and
    // merged current) state, reopening the open question.
    await Deno.writeTextFile(
      join(dir, "api", "surface.txt"),
      `${body.slice(0, -1).join("\n")}\ntrunk-take\n`,
    );
    await git(dir, "add", "-A");
    await git(
      dir,
      "commit",
      "-q",
      "-m",
      "trunk touches the api",
      "--no-gpg-sign",
    );
    const secondUpdate = await runAgent(wt, ["update", "--json"]);
    assertEquals(secondUpdate.code, 0, secondUpdate.output);
    const reopened = await runAgent(wt, ["done", "--json"]);
    assertEquals(reopened.code, 1, reopened.output);
    assertEquals(parseJson(reopened.stdout).error, AWAITING_DECLARATION_SLUG);
  });
});

Deno.test("done: a fresh install's shipped defaults govern out of the box", async () => {
  await withTempDir(async (dir) => {
    // The template's own activation, untouched: this is day one after setup.
    await scaffoldEngine(dir, { keepCheckpoints: true });
    await gitInit(dir);
    // Grow the always-loaded instructions — the knowledge-surface moment the
    // shipped `instruction-economy` stop guards.
    await Deno.mkdir(join(dir, "discern"), { recursive: true });
    await Deno.writeTextFile(
      join(dir, "discern", "instructions.md"),
      "# Project instructions\n\nAlways run the slow suite twice.\n",
    );

    const refused = await runAgent(dir, ["done", "--json"]);
    assertEquals(refused.code, 1, refused.output);
    const env = parseCheckpointGateJson(refused.stdout);
    assertEquals(env.error, AWAITING_DECLARATION_SLUG);
    assertEquals(env.data.checkpoints.outstanding?.length, 1);
    assertEquals(
      env.data.checkpoints.outstanding?.[0]?.id,
      "instruction-economy",
    );
    assert(typeof env.message === "string");
    assertStringIncludes(env.message, "always-loaded agent instructions");

    // Declaring met clears the interlock and the same invocation proceeds
    // into the gate: whatever it finds next, it is no longer the declaration.
    const declared = await runAgent(
      dir,
      ["done", "--met", "instruction-economy", "--json"],
    );
    const after = parseCheckpointGateJson(declared.stdout);
    assertEquals(after.data.checkpoints.declared_met?.length, 1);
    assertEquals(
      after.data.checkpoints.declared_met?.[0]?.id,
      "instruction-economy",
    );
    assert(after.error !== AWAITING_DECLARATION_SLUG, declared.output);
  });
});

Deno.test("done: a trunk policy edit reaches the effort only through update, and arrives beside a tree change", async () => {
  await withTempDir(async (dir) => {
    const wt = await worktreeWithApiChange(dir, CONFIG_ONE_CHECKPOINT);
    assertEquals((await runAgent(wt, ["done", "--json"])).code, 1);
    const met = await runAgent(wt, ["done", "--met", "api-review", "--json"]);
    assertEquals(met.code, 0, met.output);
    const governed = parseCheckpointGateJson(met.stdout).data.checkpoints
      .policy;

    // The trunk lands a SECOND stop checkpoint on the same paths. The effort's
    // merge-base has not moved, so its governing policy has not either.
    await writeConfig(
      dir,
      `${CONFIG_ONE_CHECKPOINT}
[checkpoints.risk-notes]
paths = ["api/**"]
question = "${QUESTION_NOTES}"
`,
    );
    await git(dir, "add", "-A");
    await git(
      dir,
      "commit",
      "-q",
      "-m",
      "trunk adds a checkpoint",
      "--no-gpg-sign",
    );

    // Before `update`, the branch is behind. Exact current Proof is no longer
    // reusable because missing integration evidence cannot become green by
    // omission. The not-yet-governing checkpoint is still absent.
    const before = await runAgent(wt, ["done", "--json"]);
    assertEquals(before.code, 1, before.output);
    assertEquals(parseJson(before.stdout).error, UNCHANGED_TREE_RERUN_SLUG);
    assert(!before.output.includes("risk-notes"), before.output);
    const forced = await runAgent(wt, ["done", "--rerun", "--json"]);
    assertEquals(forced.code, 1, forced.output);
    assertEquals(parseGateJson(forced.stdout).data.failed_stage, "merge");
    const preUpdate = await runAgent(wt, ["checkpoints", "--json"]);
    assertStringIncludes(preUpdate.stdout, `"policy":"${governed}"`);
    assert(!preUpdate.stdout.includes("risk-notes"), preUpdate.stdout);

    // `update` advances the merge-base — and with it, the policy — beside a
    // tree change (the merge commit), so the new checkpoint can never appear
    // against an already-green unchanged tree: the reopened gate is a fresh
    // run, not a rerun needing --confirmed.
    const updated = await runAgent(wt, ["update", "--json"]);
    assertEquals(updated.code, 0, updated.output);
    const after = await runAgent(wt, ["done", "--json"]);
    assertEquals(after.code, 1, after.output);
    const afterEnv = parseCheckpointGateJson(after.stdout);
    assertEquals(afterEnv.error, AWAITING_DECLARATION_SLUG);
    assertEquals(
      afterEnv.data.checkpoints.outstanding?.map((entry) => entry.id),
      ["risk-notes"],
    );
    // The untouched checkpoint's conclusion still binds across the advance.
    assertEquals(afterEnv.data.checkpoints.declared_met?.[0]?.id, "api-review");
    assert(afterEnv.data.checkpoints.policy !== governed);
    assertEquals(
      (await runAgent(wt, ["done", "--met", "risk-notes", "--json"])).code,
      0,
    );
  });
});

Deno.test("done: the when text governs from the merge-base while it executes from the worktree", async () => {
  await withTempDir(async (dir) => {
    // Trunk: a `when` probe that FIRES, named by the governing config.
    await scaffoldEngine(dir);
    await writeConfig(
      dir,
      `
[project]
slug = "engine-test"

[repository]
trunk = "main"

[jobs]
lint = "sh check.sh"

[checkpoints.spec-drift]
paths = ["api/**"]
when = "sh probe.sh"
question = "${QUESTION_API}"
`,
    );
    await writeExecutable(join(dir, "check.sh"), CHECK_OK);
    await writeExecutable(
      join(dir, "probe.sh"),
      "#!/usr/bin/env sh\necho trunk-probe >> probe-ran.log\nexit 0\n",
    );
    await gitInit(dir);
    const wt = await addWorktree(dir, "checkpointed");
    await Deno.mkdir(join(wt, "api"), { recursive: true });
    await Deno.writeTextFile(join(wt, "api", "surface.txt"), "endpoint\n");
    // The branch rewrites the probe to PASS — and tries to hijack the policy
    // by pointing its own config at a command that would fire.
    await writeExecutable(
      join(wt, "probe.sh"),
      "#!/usr/bin/env sh\necho wt-probe >> probe-ran.log\nexit 10\n",
    );
    await writeExecutable(
      join(wt, "hijack.sh"),
      "#!/usr/bin/env sh\necho hijack >> hijack-ran.log\nexit 0\n",
    );
    await writeConfig(
      wt,
      `
[project]
slug = "engine-test"

[repository]
trunk = "main"

[jobs]
lint = "sh check.sh"

[checkpoints.spec-drift]
paths = ["api/**"]
when = "sh hijack.sh"
question = "${QUESTION_API}"
`,
    );
    await git(wt, "add", "-A");
    await git(
      wt,
      "commit",
      "-q",
      "-m",
      "feat: extend the api",
      "--no-gpg-sign",
    );

    // The governing TEXT is the merge-base's `sh probe.sh`; the script it
    // resolves is the WORKTREE's copy, which passes — so nothing fires, and
    // the branch's hijack command never ran.
    const quiet = await runAgent(wt, ["done", "--json"]);
    assertEquals(quiet.code, 0, quiet.output);
    const ran = await Deno.readTextFile(join(wt, "probe-ran.log"));
    assertStringIncludes(ran, "wt-probe");
    assert(!ran.includes("trunk-probe"), ran);
    assertEquals(
      await targetExists(join(wt, "hijack-ran.log")),
      false,
      "the branch's own `when` text must never run",
    );

    // The same governing text over a firing worktree probe interlocks.
    await writeExecutable(
      join(wt, "probe.sh"),
      "#!/usr/bin/env sh\necho wt-probe >> probe-ran.log\nexit 0\n",
    );
    await git(wt, "add", "probe.sh");
    await git(wt, "commit", "-q", "-m", "probe fires", "--no-gpg-sign");
    const fired = await runAgent(wt, ["done", "--json"]);
    assertEquals(fired.code, 1, fired.output);
    const env = parseCheckpointGateJson(fired.stdout);
    assertEquals(env.error, AWAITING_DECLARATION_SLUG);
    assertEquals(env.data.checkpoints.outstanding?.[0]?.id, "spec-drift");

    // Once served, the checkpoint remains interlocked even if the same
    // worktree probe later passes. Trigger state controls opening, not erasure.
    await writeExecutable(
      join(wt, "probe.sh"),
      "#!/usr/bin/env sh\necho wt-probe >> probe-ran.log\nexit 10\n",
    );
    await git(wt, "add", "probe.sh");
    await git(wt, "commit", "-q", "-m", "probe passes", "--no-gpg-sign");
    const inactive = await runAgent(wt, ["done", "--json"]);
    assertEquals(inactive.code, 1, inactive.output);
    const inactiveEnv = parseCheckpointGateJson(inactive.stdout);
    assertEquals(inactiveEnv.error, AWAITING_DECLARATION_SLUG);
    assertEquals(
      inactiveEnv.data.checkpoints.outstanding?.[0]?.id,
      "spec-drift",
    );
  });
});

Deno.test("done: when matches cannot escape their structural selector", async () => {
  await withTempDir(async (dir) => {
    await scaffoldEngine(dir);
    await writeConfig(
      dir,
      `
[project]
slug = "engine-test"

[repository]
trunk = "main"

[jobs]
lint = "sh check.sh"

[checkpoints.api-review]
paths = ["api/**"]
when = "sh probe.sh"
question = "${QUESTION_API}"
`,
    );
    await writeExecutable(join(dir, "check.sh"), CHECK_OK);
    await writeExecutable(
      join(dir, "probe.sh"),
      "#!/usr/bin/env sh\necho 'DISCERN_MATCH README.md'\nexit 0\n",
    );
    await Deno.writeTextFile(join(dir, "README.md"), "stable context\n");
    await gitInit(dir);

    const wt = await addWorktree(dir, "checkpointed");
    await Deno.mkdir(join(wt, "api"), { recursive: true });
    await Deno.writeTextFile(join(wt, "api", "surface.txt"), "v1\n");
    await git(wt, "add", "api/surface.txt");
    await git(wt, "commit", "-q", "-m", "add api", "--no-gpg-sign");

    const opened = await runAgent(wt, ["done", "--json"]);
    assertEquals(opened.code, 1, opened.output);
    const openedEnv = parseCheckpointGateJson(opened.stdout);
    assertEquals(openedEnv.data.checkpoints.outstanding?.[0]?.matched, [
      "api/surface.txt",
    ]);
    assertEquals(
      (await runAgent(wt, ["done", "--met", "api-review", "--json"])).code,
      0,
    );

    // The selector-matched content is the subject. Revising it must reopen the
    // open question even though the probe keeps declaring an unrelated stable path.
    await Deno.writeTextFile(join(wt, "api", "surface.txt"), "v2\n");
    await git(wt, "add", "api/surface.txt");
    await git(wt, "commit", "-q", "-m", "revise api", "--no-gpg-sign");
    const reopened = await runAgent(wt, ["done", "--json"]);
    assertEquals(reopened.code, 1, reopened.output);
    assertEquals(parseJson(reopened.stdout).error, AWAITING_DECLARATION_SLUG);
  });
});

Deno.test("openQuestions: the effort's state survives session restarts — each engine process reads what the last recorded", async () => {
  // Every invocation below is its own OS process over the per-worktree store:
  // the refusal's open question, read back by a fresh `checkpoints` run, resolved by
  // a third process's declaration — the spec's session-restart claim, named.
  await withTempDir(async (dir) => {
    const wt = await worktreeWithApiChange(dir, CONFIG_ONE_CHECKPOINT);
    assertEquals((await runAgent(wt, ["done", "--json"])).code, 1);

    const read = await runAgent(wt, ["checkpoints", "--json"]);
    assertEquals(read.code, 0, read.output);
    const awaiting = parseCheckpointsJson(read.stdout);
    assertEquals(
      awaiting.data.checkpoints[0]?.open_question?.state,
      "awaiting_declaration",
    );

    assertEquals(
      (await runAgent(wt, ["done", "--met", "api-review", "--json"])).code,
      0,
    );
    const settled = await runAgent(wt, ["checkpoints", "--json"]);
    const met = parseCheckpointsJson(settled.stdout);
    assertEquals(met.data.checkpoints[0]?.open_question?.state, "declared_met");
    assertEquals(
      met.data.checkpoints[0]?.open_question?.declaration?.current,
      true,
    );
  });
});

Deno.test("done: the declaration refusal escapes matched paths on the markdown surface", async () => {
  // The refusal message renders verbatim under --markdown, and matched paths
  // are working-tree-controlled text — a hostile file name must arrive
  // inside the code-span escaping boundary, never as live Markdown.
  await withTempDir(async (dir) => {
    const wt = await worktreeWithApiChange(dir, CONFIG_ONE_CHECKPOINT);
    await Deno.writeTextFile(join(wt, "api", "*bold*.txt"), "hostile name\n");
    await git(wt, "add", "-A");
    await git(wt, "commit", "-q", "-m", "hostile path", "--no-gpg-sign");
    const md = await runAgent(wt, ["done", "--markdown"]);
    assertEquals(md.code, 1, md.output);
    assertStringIncludes(md.stdout, "`api/*bold*.txt`");
    assertStringIncludes(md.stdout, "`api/surface.txt`");
  });
});

const CONFIG_SEPARATOR_QUESTION = `
[project]
slug = "engine-test"

[repository]
trunk = "main"

[jobs]
lint = "sh check.sh"

[checkpoints.api-review]
paths = ["api/**"]
question = "Does the \u2028 changed surface preserve \u2029 its contract?"
teach = "State the failure modes; note what callers must revisit."
`;

Deno.test("done: an unpreparable when input serves full evidence and runs nothing", async () => {
  // With the engine subprocess's temp home pointed at an absent directory,
  // the registered when input file cannot be created: the input phase fails,
  // the command never runs, and the run carries the typed input drop instead
  // of a spawn or exit account.
  await withTempDir(async (dir) => {
    await scaffoldEngine(dir);
    await writeConfig(
      dir,
      `
[project]
slug = "engine-test"

[repository]
trunk = "main"

[checkpoints.api-review]
paths = ["api/**"]
when = "sh probe.sh"
question = "${QUESTION_API}"
`,
    );
    await writeExecutable(
      join(dir, "probe.sh"),
      "#!/usr/bin/env sh\necho ran >> when-ran.log\nexit 0\n",
    );
    await gitInit(dir);
    const wt = await addWorktree(dir, "poisoned-temp");
    await Deno.mkdir(join(wt, "api"), { recursive: true });
    await Deno.writeTextFile(join(wt, "api", "surface.txt"), "endpoint\n");
    await git(wt, "add", "-A");
    await git(wt, "commit", "-q", "-m", "change api", "--no-gpg-sign");

    const absent = join(dir, "absent-temp-home");
    const result = await runAgent(wt, ["done", "--json"], {
      env: { TMPDIR: absent, TMP: absent, TEMP: absent },
    });
    const envelope = parseCheckpointGateJson(result.stdout);
    const drop = envelope.data.checkpoints.drops?.find((entry) =>
      entry.reason === "when_input_failed"
    );
    assert(
      drop !== undefined,
      `expected a when_input_failed drop: ${result.output}`,
    );
    assertEquals((drop as { checkpoint?: string }).checkpoint, "api-review");
    assertEquals(
      (await readTextIfExists(join(wt, "when-ran.log"))) ?? "",
      "",
      "an unpreparable input must never run the command",
    );
    assertEquals(
      envelope.error,
      AWAITING_DECLARATION_SLUG,
      "an indeterminate stop must interlock over structural evidence",
    );
    assertEquals(envelope.data.checkpoints.outstanding?.[0]?.matched, [
      "api/surface.txt",
    ]);
  });
});

Deno.test("done: the human refusal keeps authored paragraphs and inert hostile separators", async () => {
  // The refusal is a multi-paragraph product message: its own newlines are
  // deliberate structure, while separators inside governed dynamic text stay
  // visible, inert notation. Rendering it through a single-line sink turns
  // the paragraphs into visible newline symbols — the defect this guards.
  await withTempDir(async (dir) => {
    const wt = await worktreeWithApiChange(dir, CONFIG_SEPARATOR_QUESTION);
    const human = await runAgent(wt, ["done"], {
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
    assertTerminalTextIncludes(human.output, "<U+2028>");
    assertTerminalTextIncludes(human.output, "<U+2029>");
    assert(
      !human.output.includes("\u2028") && !human.output.includes("\u2029"),
      "a raw line or paragraph separator reached the terminal",
    );
  });
});
