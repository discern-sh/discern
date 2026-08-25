/**
 * Black-box closure for the expanded checkpoint trigger vocabulary: strict
 * `done` is the only local surface that executes `when` with its bounded v1
 * facts, and ordered history — unlike otherwise-identical file evidence — is
 * part of a `min_commits` checkpoint's declaration subject.
 */

import {
  assert,
  assertEquals,
  assertNotEquals,
  assertRejects,
} from "@std/assert";
import { z } from "@zod/zod";
import { join } from "@std/path";
import { readTextIfExists } from "../src/shared/fs_presence.ts";
import { withTempDir } from "./helpers.ts";
import {
  addWorktree,
  git,
  gitInit,
  gitOut,
  runAgent,
  scaffoldEngine,
  suiteTempDir,
  writeConfig,
  writeExecutable,
} from "./engine_helpers.ts";
import type {
  CheckpointReportData,
  CheckpointsData,
  GateWireData,
} from "../src/shared/result_schemas.ts";
import {
  TEMP_ARTIFACT_KINDS,
  TEMP_ARTIFACT_SUFFIX,
} from "../src/shared/temp_artifacts.ts";
import { sha256Hex } from "../src/shared/sha256.ts";
import {
  CHECKPOINT_CHANGE_KINDS,
  CHECKPOINT_MODES,
  CHECKPOINT_WHEN_INPUT_VERSION,
} from "../src/shared/checkpoints.ts";
import { AWAITING_DECLARATION_SLUG } from "../src/shared/declarations.ts";
import {
  declarationIsCurrent,
  readOpenQuestions,
} from "../src/engine/checkpoints/open_questions.ts";
import {
  assertResultDataKey,
  decodeCliResult,
  decodeWith,
} from "./decode_cli_result.ts";

const CHECK_OK = "#!/usr/bin/env sh\nexit 0\n";
const CheckpointWhenInputSchema = z.object({
  version: z.literal(CHECKPOINT_WHEN_INPUT_VERSION),
  checkpoint: z.object({
    id: z.string(),
    mode: z.enum(CHECKPOINT_MODES),
  }),
  policy_commit: z.string(),
  changed_files: z.array(z.object({
    path: z.string(),
    kind: z.enum(CHECKPOINT_CHANGE_KINDS),
    insertions: z.number().int().nonnegative(),
    deletions: z.number().int().nonnegative(),
    binary: z.boolean(),
  })),
  history: z.object({
    count: z.number().int().nonnegative(),
    fingerprint: z.string(),
  }).optional(),
});

/** Quote one absolute fixture path for a POSIX shell script. */
function shellQuote(value: string): string {
  return `'${value.replaceAll("'", "'\\''")}'`;
}

/** Current structured-input artifacts in this module's isolated temp home. */
async function checkpointInputArtifacts(): Promise<string[]> {
  const names: string[] = [];
  for await (const entry of Deno.readDir(await suiteTempDir())) {
    if (
      entry.isFile &&
      entry.name.startsWith(TEMP_ARTIFACT_KINDS.checkpointInput) &&
      entry.name.endsWith(TEMP_ARTIFACT_SUFFIX)
    ) {
      names.push(entry.name);
    }
  }
  return names.sort();
}

/** Read optional fixture evidence without manufacturing a missing file. */
async function optionalText(path: string): Promise<string | undefined> {
  return await readTextIfExists(path);
}

/** Validate and narrow one black-box `checkpoints --json` envelope. */
function parseCheckpoints(stdout: string): CheckpointsData {
  const envelope = decodeCliResult(stdout, "checkpoints");
  assertResultDataKey(envelope, "checkpoints");
  return envelope.data;
}

/** Validate and narrow one black-box `done --json` envelope. */
function parseDone(stdout: string): {
  readonly error?: string;
  readonly data: GateWireData;
} {
  const envelope = decodeCliResult(stdout, "done");
  assertResultDataKey(envelope, "scopes_changed");
  return {
    ...(envelope.error === undefined ? {} : { error: envelope.error }),
    data: envelope.data,
  };
}

/** Find one required checkpoint row from the schema-validated read result. */
function checkpointRow(
  data: CheckpointsData,
  id: string,
): CheckpointReportData {
  const found = data.checkpoints.find((entry) => entry.id === id);
  assert(found !== undefined, `missing checkpoint report row ${id}`);
  return found;
}

Deno.test("checkpoint when input is a strict-only, narrowed and cleaned v1 boundary", async () => {
  await withTempDir(async (dir) => {
    const capture = join(dir, "captured-checkpoint-input.json");
    const capturedPath = join(dir, "captured-checkpoint-input-path.txt");
    const invocations = join(dir, "when-invocations.txt");
    const secret = "RAW_SECRET_SENTINEL_4A_E2E";
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

[checkpoints.composite]
paths = ["src/**"]
exclude_paths = ["src/excluded/**"]
kinds = ["added", "modified"]
adds_matching = ["REVIEW"]
binary = false
min_changed_files = 2
min_changed_lines = 4
min_commits = 1
when = "sh inspect-checkpoint.sh"
question = "The narrowed composite change has been reviewed."
`,
    );
    await writeExecutable(join(dir, "check.sh"), CHECK_OK);
    await writeExecutable(
      join(dir, "inspect-checkpoint.sh"),
      `#!/usr/bin/env sh
printf 'invoked\\n' >> ${shellQuote(invocations)}
cp "$DISCERN_CHECKPOINT_INPUT" ${shellQuote(capture)}
printf '%s' "$DISCERN_CHECKPOINT_INPUT" > ${shellQuote(capturedPath)}
exit 0
`,
    );
    await Deno.mkdir(join(dir, "src"), { recursive: true });
    await Deno.writeTextFile(join(dir, "src", "a.txt"), "old\nstable\n");
    await gitInit(dir);
    const policyCommit = await gitOut(dir, "rev-parse", "HEAD");

    const wt = await addWorktree(dir, "when-input-e2e");
    await Deno.writeTextFile(
      join(wt, "src", "a.txt"),
      `REVIEW changed\nstable\n${secret}\n`,
    );
    await Deno.writeTextFile(join(wt, "src", "z.txt"), "REVIEW new\n");
    await Deno.mkdir(join(wt, "src", "excluded"), { recursive: true });
    await Deno.writeTextFile(
      join(wt, "src", "excluded", "ignored.txt"),
      "REVIEW ignored\n",
    );
    await Deno.writeFile(
      join(wt, "src", "binary.dat"),
      new Uint8Array([0, 1, 2, 3]),
    );
    await git(wt, "add", "-A");
    await git(
      wt,
      "commit",
      "-q",
      "-m",
      "exercise composite checkpoint input",
      "--no-gpg-sign",
    );
    const effortCommit = await gitOut(wt, "rev-parse", "HEAD");
    const expectedHistory = {
      count: 1,
      fingerprint: await sha256Hex(
        `checkpoint-history/v1\n${effortCommit}`,
      ),
    };
    const artifactsBefore = await checkpointInputArtifacts();

    const checkpoints = await runAgent(wt, ["checkpoints", "--json"]);
    assertEquals(checkpoints.code, 0, checkpoints.output);
    decodeCliResult(checkpoints.stdout, "checkpoints");
    const status = await runAgent(wt, ["status", "--json"]);
    assertEquals(status.code, 0, status.output);
    decodeCliResult(status.stdout, "status");
    const dryRun = await runAgent(wt, ["done", "--dry-run", "--json"]);
    assertEquals(dryRun.code, 0, dryRun.output);
    decodeCliResult(dryRun.stdout, "done");
    assertEquals(await optionalText(invocations), undefined);
    assertEquals(await optionalText(capture), undefined);
    assertEquals(await optionalText(capturedPath), undefined);
    assertEquals(await checkpointInputArtifacts(), artifactsBefore);

    const strict = await runAgent(wt, ["done", "--json"]);
    assertEquals(strict.code, 1, strict.output);
    const strictEnvelope = decodeCliResult(strict.stdout, "done");
    assertEquals(strictEnvelope.error, AWAITING_DECLARATION_SLUG);
    assertEquals(await optionalText(invocations), "invoked\n");

    const capturedRaw = await Deno.readTextFile(capture);
    assert(
      !capturedRaw.includes(secret),
      "structured input leaked raw changed-file content",
    );
    const input = decodeWith(CheckpointWhenInputSchema, capturedRaw);
    assertEquals(input, {
      version: 1,
      checkpoint: { id: "composite", mode: "stop" },
      policy_commit: policyCommit,
      changed_files: [
        {
          path: "src/a.txt",
          kind: "modified",
          insertions: 2,
          deletions: 1,
          binary: false,
        },
        {
          path: "src/z.txt",
          kind: "added",
          insertions: 1,
          deletions: 0,
          binary: false,
        },
      ],
      history: expectedHistory,
    });
    assertEquals(input.policy_commit.length, policyCommit.length);
    assertEquals(input.history?.fingerprint.length, 64);
    const inputPath = await Deno.readTextFile(capturedPath);
    await assertRejects(() => Deno.stat(inputPath), Deno.errors.NotFound);
    assertEquals(await checkpointInputArtifacts(), artifactsBefore);
  });
});

Deno.test("ordered history rewrites reopen only the min_commits declaration", async () => {
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

[checkpoints.history-sensitive]
paths = ["src/**"]
min_commits = 1
question = "The source change has been reviewed."

[checkpoints.ordinary]
paths = ["src/**"]
question = "The source change has been reviewed."
`,
    );
    await writeExecutable(join(dir, "check.sh"), CHECK_OK);
    await Deno.mkdir(join(dir, "src"), { recursive: true });
    await Deno.writeTextFile(join(dir, "src", "surface.txt"), "base\n");
    await gitInit(dir);

    const wt = await addWorktree(dir, "history-rewrite-e2e");
    await Deno.writeTextFile(join(wt, "src", "surface.txt"), "final\n");
    await git(wt, "add", "src/surface.txt");
    await git(
      wt,
      "commit",
      "-q",
      "-m",
      "exercise initial history identity",
      "--no-gpg-sign",
    );

    const opened = await runAgent(wt, ["done", "--json"]);
    assertEquals(opened.code, 1, opened.output);
    const openedEnvelope = parseDone(opened.stdout);
    assertEquals(openedEnvelope.error, AWAITING_DECLARATION_SLUG);
    assertEquals(
      openedEnvelope.data.checkpoints?.outstanding?.map((entry) => entry.id)
        .sort(),
      ["history-sensitive", "ordinary"],
    );
    const declared = await runAgent(wt, [
      "done",
      "--met",
      "history-sensitive",
      "--met",
      "ordinary",
      "--json",
    ]);
    assertEquals(declared.code, 0, declared.output);
    assertEquals(
      parseDone(declared.stdout).data.checkpoints?.declared_met?.map((entry) =>
        entry.id
      ).sort(),
      ["history-sensitive", "ordinary"],
    );

    const initialReport = parseCheckpoints(
      (await runAgent(wt, ["checkpoints", "--json"])).stdout,
    );
    const initialHistory = checkpointRow(initialReport, "history-sensitive")
      .open_question;
    const initialOrdinary = checkpointRow(initialReport, "ordinary")
      .open_question;
    assertEquals(initialHistory?.state, "declared_met");
    assertEquals(initialHistory?.declaration?.current, true);
    assertEquals(initialOrdinary?.state, "declared_met");
    assertEquals(initialOrdinary?.declaration?.current, true);
    const initialHistorySubject = initialHistory?.subject;
    const ordinarySubject = initialOrdinary?.subject;
    assert(
      initialHistorySubject !== undefined && ordinarySubject !== undefined,
    );

    const initialCommit = await gitOut(wt, "rev-parse", "HEAD");
    const initialTree = await gitOut(wt, "rev-parse", "HEAD^{tree}");
    const initialBlob = await gitOut(wt, "rev-parse", "HEAD:src/surface.txt");
    const initialFingerprint = await sha256Hex(
      `checkpoint-history/v1\n${initialCommit}`,
    );

    // Changing the message guarantees a different commit object while the
    // parent and complete tree remain byte-for-byte identical.
    await git(
      wt,
      "commit",
      "--amend",
      "-q",
      "-m",
      "exercise amended history identity",
      "--no-gpg-sign",
    );
    const amendedCommit = await gitOut(wt, "rev-parse", "HEAD");
    const amendedFingerprint = await sha256Hex(
      `checkpoint-history/v1\n${amendedCommit}`,
    );
    assertNotEquals(amendedCommit, initialCommit);
    assertEquals(await gitOut(wt, "rev-parse", "HEAD^{tree}"), initialTree);
    assertEquals(
      await gitOut(wt, "rev-parse", "HEAD:src/surface.txt"),
      initialBlob,
    );
    assertNotEquals(amendedFingerprint, initialFingerprint);

    const afterAmend = await runAgent(wt, ["done", "--json"]);
    assertEquals(afterAmend.code, 1, afterAmend.output);
    const amendEnvelope = parseDone(afterAmend.stdout);
    assertEquals(amendEnvelope.error, AWAITING_DECLARATION_SLUG);
    assertEquals(
      amendEnvelope.data.checkpoints?.outstanding?.map((entry) => entry.id),
      ["history-sensitive"],
    );
    assertEquals(
      amendEnvelope.data.checkpoints?.declared_met?.map((entry) => entry.id),
      ["ordinary"],
    );
    const amendedReport = parseCheckpoints(
      (await runAgent(wt, ["checkpoints", "--json"])).stdout,
    );
    const amendedHistory = checkpointRow(amendedReport, "history-sensitive")
      .open_question;
    const amendedOrdinary = checkpointRow(amendedReport, "ordinary")
      .open_question;
    assertEquals(amendedHistory?.state, "reopened");
    assertEquals(amendedHistory?.declaration?.current, false);
    assertNotEquals(amendedHistory?.subject, initialHistorySubject);
    assertEquals(amendedOrdinary?.state, "declared_met");
    assertEquals(amendedOrdinary?.declaration?.current, true);
    assertEquals(amendedOrdinary?.subject, ordinarySubject);

    let store = await readOpenQuestions(wt);
    assert(store.status === "ok");
    const storedHistoryAfterAmend = store.openQuestions["history-sensitive"];
    const storedOrdinaryAfterAmend = store.openQuestions.ordinary;
    assert(
      storedHistoryAfterAmend !== undefined &&
        storedOrdinaryAfterAmend !== undefined,
    );
    assertEquals(
      declarationIsCurrent(storedHistoryAfterAmend),
      false,
    );
    assertEquals(declarationIsCurrent(storedOrdinaryAfterAmend), true);
    const redeclared = await runAgent(wt, [
      "done",
      "--met",
      "history-sensitive",
      "--json",
    ]);
    assertEquals(redeclared.code, 0, redeclared.output);
    parseDone(redeclared.stdout);

    // The trunk commit cannot affect either checkpoint's matched path. Rebasing
    // onto it nevertheless changes the branch commit's parent, and therefore
    // its ordered history identity, with no clock-dependent fixture trick.
    await Deno.writeTextFile(join(dir, "unrelated.txt"), "trunk only\n");
    await git(dir, "add", "unrelated.txt");
    await git(
      dir,
      "commit",
      "-q",
      "-m",
      "add unrelated trunk state",
      "--no-gpg-sign",
    );
    const unrelatedTrunk = await gitOut(dir, "rev-parse", "HEAD");
    await git(wt, "rebase", "main");
    const rebasedCommit = await gitOut(wt, "rev-parse", "HEAD");
    const rebasedFingerprint = await sha256Hex(
      `checkpoint-history/v1\n${rebasedCommit}`,
    );
    assertNotEquals(rebasedCommit, amendedCommit);
    assertEquals(await gitOut(wt, "rev-parse", "HEAD^"), unrelatedTrunk);
    assertEquals(await gitOut(wt, "rev-list", "--count", "main..HEAD"), "1");
    assertEquals(
      await gitOut(wt, "rev-parse", "HEAD:src/surface.txt"),
      initialBlob,
    );
    assertNotEquals(rebasedFingerprint, amendedFingerprint);

    const afterRebase = await runAgent(wt, ["done", "--json"]);
    assertEquals(afterRebase.code, 1, afterRebase.output);
    const rebaseEnvelope = parseDone(afterRebase.stdout);
    assertEquals(rebaseEnvelope.error, AWAITING_DECLARATION_SLUG);
    assertEquals(
      rebaseEnvelope.data.checkpoints?.outstanding?.map((entry) => entry.id),
      ["history-sensitive"],
    );
    assertEquals(
      rebaseEnvelope.data.checkpoints?.declared_met?.map((entry) => entry.id),
      ["ordinary"],
    );
    const rebasedReport = parseCheckpoints(
      (await runAgent(wt, ["checkpoints", "--json"])).stdout,
    );
    const rebasedHistory = checkpointRow(rebasedReport, "history-sensitive")
      .open_question;
    const rebasedOrdinary = checkpointRow(rebasedReport, "ordinary")
      .open_question;
    assertEquals(rebasedHistory?.state, "reopened");
    assertEquals(rebasedHistory?.declaration?.current, false);
    assertNotEquals(rebasedHistory?.subject, amendedHistory?.subject);
    assertEquals(rebasedOrdinary?.state, "declared_met");
    assertEquals(rebasedOrdinary?.declaration?.current, true);
    assertEquals(rebasedOrdinary?.subject, ordinarySubject);

    store = await readOpenQuestions(wt);
    assert(store.status === "ok");
    const storedHistory = store.openQuestions["history-sensitive"];
    const storedOrdinary = store.openQuestions.ordinary;
    assert(storedHistory !== undefined && storedOrdinary !== undefined);
    assertEquals(declarationIsCurrent(storedHistory), false);
    assertEquals(declarationIsCurrent(storedOrdinary), true);
  });
});
