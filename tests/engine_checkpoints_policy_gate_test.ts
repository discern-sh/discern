/** Checkpoint policy gate journeys with independently owned fixtures. */
import { assert, assertEquals, assertStringIncludes } from "@std/assert";
import { dirname, join } from "@std/path";
import { AWAITING_DECLARATION_SLUG } from "../src/shared/declarations.ts";
import { markdownCodeSpan } from "../src/shared/markdown_code.ts";
import { assertResultDataKey, decodeCliResult } from "./decode_cli_result.ts";
import {
  CHECK_OK,
  CONFIG_ONE_CHECKPOINT,
  parseCheckpointGateJson,
  parseCheckpointsJson,
  parseGateJson,
  parseJson,
  proofMarker,
  QUESTION_API,
  QUESTION_NOTES,
  worktreeWithApiChange,
} from "./engine_checkpoints_gate_fixture.ts";
import {
  addWorktree,
  git,
  gitInit,
  runAgent,
  scaffoldEngine,
  writeConfig,
  writeExecutable,
} from "./engine_helpers.ts";
import { assertTerminalTextIncludes, withTempDir } from "./helpers.ts";

const FILE_QUESTION_PATH = "policy/$ [review] `tick`.md";

const FILE_QUESTION_REFERENCE = "project/map/`review`.md#rubric";

const FILE_QUESTION =
  "## Governing review\n\n- Does the changed API keep its documented contract?\n";

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
    assertEquals(
      Object.values(
        parseCheckpointGateJson(met.stdout).data.producer_executions ?? {},
      )
        .reduce((sum, count) => sum + count, 0),
      1,
      "strict completion must execute after a report-only run",
    );
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
    assertResultDataKey(acceptanceEnvelope, "queue");
    const pending = acceptanceEnvelope.data.pending?.map((item) => item.kind) ??
      [];
    assert(pending.includes("missing-authority"), acceptance.output);
    assert(pending.includes("missing-judgment"), acceptance.output);
    assertEquals(
      acceptanceEnvelope.data.queue?.[0]?.checkpoint_review?.declared_unmet[0]
        ?.question,
      FILE_QUESTION,
    );
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
    assertEquals(parseJson(before.stdout).error, "incomplete");
    assertEquals(
      parseGateJson(before.stdout).data.completion?.pending?.[0]?.kind,
      "environment-unavailable",
    );
    assert(!before.output.includes("risk-notes"), before.output);
    const forced = await runAgent(wt, ["done", "--rerun", "--json"]);
    assertEquals(forced.code, 1, forced.output);
    assertEquals(
      parseGateJson(forced.stdout).data.completion?.pending?.[0]?.kind,
      "environment-unavailable",
    );
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
